/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  executeResearchJob,
  isResearchJobMessage,
  reconcileResearchQueue,
  type ResearchJobMessage,
} from "../lib/research-queue";
import {
  executeConceptArchiveJob,
  type ConceptArchiveJobMessage,
} from "../lib/lovart";
import { cleanupOperationalData, ensureSchema } from "../lib/database";
import { allowedApiOrigin } from "../lib/api-origin";

export { DecisionCoordinator } from "../lib/decision-coordinator";

interface Env {
  ALLOWED_API_ORIGINS?: string;
  ASSETS: Fetcher;
  DB: D1Database;
  PRODUCT_IMAGES?: R2Bucket;
  RESEARCH_QUEUE: {
    send(message: ResearchJobMessage): Promise<void>;
  };
  CONCEPT_ARCHIVE_QUEUE: {
    send(message: ConceptArchiveJobMessage): Promise<void>;
  };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface QueueMessage<T> {
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface QueueBatch<T> {
  queue: string;
  messages: QueueMessage<T>[];
}

type WorkerQueueMessage = ResearchJobMessage | ConceptArchiveJobMessage;

function isConceptArchiveJob(message: unknown): message is ConceptArchiveJobMessage {
  return message !== null && typeof message === "object" &&
    !Array.isArray(message) && "kind" in message &&
    (message as { kind?: unknown }).kind === "concept_archive";
}

const API_CORS_BASE_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, If-None-Match",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Type, ETag, Retry-After, Server-Timing, X-Request-Id",
};

function apiCorsHeaders(request: Request, configuredOrigins = ""): Record<string, string> {
  const origin = allowedApiOrigin(request, configuredOrigins);
  return origin
    ? { ...API_CORS_BASE_HEADERS, "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : API_CORS_BASE_HEADERS;
}

function withApiCors(request: Request, response: Response, configuredOrigins = ""): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(apiCorsHeaders(request, configuredOrigins))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function withRequestMetadata(
  request: Request,
  response: Response,
  requestId: string,
  startedAt: number,
): Response {
  const durationMs = Math.max(0, performance.now() - startedAt);
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  headers.set("server-timing", `app;dur=${durationMs.toFixed(1)}`);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  const isApiRequest = new URL(request.url).pathname.startsWith("/api/");
  const sampleSuccessfulRequest = crypto.getRandomValues(new Uint8Array(1))[0] < 13;
  if (isApiRequest && (response.status >= 400 || sampleSuccessfulRequest)) {
    const cf = (request as Request & { cf?: { colo?: string } }).cf;
    console.log(JSON.stringify({
      event: "api_request",
      request_id: requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      duration_ms: Number(durationMs.toFixed(1)),
      colo: cf?.colo || "unknown",
    }));
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startedAt = performance.now();
    const url = new URL(request.url);
    const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
    let response: Response;

    if (
      url.pathname.startsWith("/api/") &&
      request.headers.has("origin") &&
      !allowedApiOrigin(request, env.ALLOWED_API_ORIGINS)
    ) {
      response = new Response("CORS origin denied", { status: 403 });
    } else if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      response = new Response(null, { status: 204, headers: apiCorsHeaders(request, env.ALLOWED_API_ORIGINS) });
    } else if (url.pathname === "/_vinext/image") {
      if (!env.IMAGES) {
        response = new Response("Image optimization is not configured", { status: 503 });
      } else {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        response = await handleImageOptimization(request, {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
            return result.response();
          },
        }, allowedWidths);
      }
    } else {
      response = await handler.fetch(request, env, ctx);
    }

    const corsResponse = url.pathname.startsWith("/api/") ? withApiCors(request, response, env.ALLOWED_API_ORIGINS) : response;
    return withRequestMetadata(request, corsResponse, requestId, startedAt);
  },

  async queue(batch: QueueBatch<WorkerQueueMessage>): Promise<void> {
    for (const message of batch.messages) {
      if (!isConceptArchiveJob(message.body) && !isResearchJobMessage(message.body)) {
        console.error(JSON.stringify({
          event: "queue_delivery",
          queue: batch.queue,
          outcome: "invalid_message_acknowledged",
          attempts: message.attempts,
        }));
        message.ack();
        continue;
      }
      try {
        const result = isConceptArchiveJob(message.body)
          ? await executeConceptArchiveJob(message.body, message.attempts)
          : await executeResearchJob(message.body, message.attempts);
        if (result.outcome === "busy") {
          message.retry({ delaySeconds: result.retryAfterSeconds });
        } else {
          message.ack();
        }
        console.log(JSON.stringify({
          event: isConceptArchiveJob(message.body)
            ? "concept_archive_queue_delivery"
            : "research_queue_delivery",
          queue: batch.queue,
          run_id: "runId" in result ? result.runId : message.body.runId,
          concept_id: "conceptId" in result ? result.conceptId : null,
          outcome: result.outcome,
          attempts: message.attempts,
          retry_after_seconds: result.outcome === "busy" ? result.retryAfterSeconds : 0,
        }));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error || "queue failure");
        const providerRetryAfterMs = Number(
          error && typeof error === "object" && "retryAfterMs" in error
            ? (error as { retryAfterMs?: unknown }).retryAfterMs
            : 0,
        );
        const retryDelaySeconds = Math.min(300, Math.max(
          1,
          Number.isFinite(providerRetryAfterMs) ? Math.ceil(providerRetryAfterMs / 1_000) : 0,
          2 ** Math.min(message.attempts, 5),
        ));
        console.error(JSON.stringify({
          event: isConceptArchiveJob(message.body)
            ? "concept_archive_queue_delivery"
            : "research_queue_delivery",
          queue: batch.queue,
          outcome: "retry",
          attempts: message.attempts,
          retry_after_seconds: retryDelaySeconds,
          error: detail.slice(0, 500),
        }));
        message.retry({ delaySeconds: retryDelaySeconds });
      }
    }
  },

  async scheduled(_controller: unknown, _env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      await ensureSchema();
      const reconciliation = await reconcileResearchQueue();
      await cleanupOperationalData();
      console.log(JSON.stringify({
        event: "operational_cleanup",
        outcome: "completed",
        research_queue: reconciliation,
      }));
    })());
  },
};

export default worker;

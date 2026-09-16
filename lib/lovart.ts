import { env } from "cloudflare:workers";
import {
  database,
  getLatestConcept,
  hydrateConcept,
  type AppUser,
  type ConceptImageRecord,
  type RunRecord,
} from "@/lib/database";
import {
  buildLovartRelayPayload,
  lovartTransportReadiness,
  parseLovartRelayEnvelope,
} from "@/lib/lovart-relay";
import { conceptGenerationBlockReason } from "@/lib/report";

// Lovart responses vary by tool and model, so they are normalized after this boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonObject = Record<string, any>;

type LovartConfig = {
  accessKey: string;
  secretKey: string;
  baseUrl: string;
  proxyUrl: string;
  proxyToken: string;
  projectId: string;
  model: string;
};

type QueueSender<T> = {
  send(message: T): Promise<void>;
};

type SceneArtifactMetadata = {
  asset_id: string;
  role: string;
  title: string;
  sequence: number;
  required: boolean;
  role_assignment: string;
};

export type ConceptArchiveJobMessage = {
  kind: "concept_archive";
  conceptId: number;
  runId: number;
  tenantId: number;
  queuedAt: number;
};

export type ConceptArchiveJobResult =
  | { outcome: "completed" | "failed" | "stale"; conceptId: number }
  | { outcome: "busy"; conceptId: number; retryAfterSeconds: number };

class TransientLovartError extends Error {}
class ConceptArchiveBudgetError extends Error {}

async function readResponseTextBounded(response: Response, maxBytes = 1_000_000): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    await response.body?.cancel("response too large").catch(() => undefined);
    throw new TransientLovartError("Lovart 响应内容过大");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("response too large").catch(() => undefined);
      throw new TransientLovartError("Lovart 响应内容过大");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const ACTIVE_CONCEPT_STATUSES = [
  "queued",
  "generating",
  "archiving",
  "awaiting_confirmation",
  "submission_unknown",
  "confirmation_unknown",
] as const;
const ACTIVE_CONCEPT_STATUS_SQL = ACTIVE_CONCEPT_STATUSES
  .map((status) => `'${status}'`)
  .join(", ");
const CONCEPT_SYNC_LEASE_SECONDS = 360;
const CONCEPT_POLL_INTERVAL_SECONDS = 10;
const CONCEPT_TRANSIENT_RETRY_SECONDS = 30;
const CONCEPT_ARCHIVE_MAX_BYTES = 20_000_000;
const CONCEPT_ARCHIVE_MAX_TOTAL_BYTES = 72_000_000;
const CONCEPT_ARCHIVE_MAX_ATTEMPTS = 4;
const CONCEPT_MAX_ARTIFACTS = 6;
const CONCEPT_DESIGN_DNA_VERSION = "metis-design-dna-v3";
const LEGACY_SCENE_SUITE_VERSION = "legacy-unversioned";
export const CONCEPT_SCENE_SUITE_VERSION = "metis-scene-suite-v1";
export const CONCEPT_SCENE_SUITE_SLOTS = [
  {
    asset_id: "scene-01-hero-master",
    role: "hero_master",
    title: "主视觉｜工作室 3/4 Master",
    sequence: 1,
    required: true,
    aspect_ratio: "16:10",
    purpose: "锁定唯一 SKU 的轮廓、比例、门抽、腿、拉手、缝隙与木纹方向",
    scene_constraints: "暖白中性工作室背景；完整产品与全部脚点入镜；无人物、文字、Logo 或尺寸线",
  },
  {
    asset_id: "scene-02-primary-lifestyle",
    role: "primary_lifestyle",
    title: "主场景｜核心空间应用",
    sequence: 2,
    required: true,
    aspect_ratio: "16:10",
    purpose: "展示目标消费者最核心的使用情境与真实空间尺度",
    scene_constraints: "克制、可落地的完整室内空间；产品是视觉主体；道具只解释尺度与用途",
  },
  {
    asset_id: "scene-03-secondary-lifestyle",
    role: "secondary_lifestyle",
    title: "副场景｜扩展空间应用",
    sequence: 3,
    required: true,
    aspect_ratio: "16:10",
    purpose: "验证同一 SKU 在第二高价值空间或使用任务中的适配性",
    scene_constraints: "与主场景形成明确用途差异；保持完全相同的产品几何、CMF 与五金",
  },
  {
    asset_id: "scene-04-functional-open-state",
    role: "functional_open_state",
    title: "功能场景｜开合与收纳",
    sequence: 4,
    required: true,
    aspect_ratio: "16:10",
    purpose: "解释真实开门、开抽、分区、导轨、铰链或核心使用动作",
    scene_constraints: "活动件数量、方向和结构必须可信；不得穿模、悬浮或虚构内部空间",
  },
  {
    asset_id: "scene-05-detail-cmf",
    role: "detail_cmf",
    title: "细节特写｜材质与工艺",
    sequence: 5,
    required: true,
    aspect_ratio: "16:10",
    purpose: "展示木纹、边部、缝隙、拉手、连接与表面光泽的可制造细节",
    scene_constraints: "只放大 Master 已存在的真实细节；不得新增装饰、五金、接口或认证标志",
  },
  {
    asset_id: "scene-06-packaging-logistics",
    role: "packaging_logistics",
    title: "履约视图｜包装与交付",
    sequence: 6,
    required: true,
    aspect_ratio: "16:10",
    purpose: "呈现平板包装、分箱、易损面保护和可执行的跨境物流方向",
    scene_constraints: "包装结构只表达方向，不生成尺寸、测试结果或认证；产品身份必须可核对",
  },
] as const;
const POLLABLE_CONCEPT_STATUSES = new Set([
  "queued",
  "generating",
  "archiving",
  "submission_unknown",
  "confirmation_unknown",
]);

const runtimeEnv = env as unknown as Record<string, unknown>;

function envText(key: string, fallback = ""): string {
  return String(runtimeEnv[key] || fallback).trim();
}

function config(): LovartConfig {
  return {
    accessKey: envText("LOVART_ACCESS_KEY"),
    secretKey: envText("LOVART_SECRET_KEY"),
    baseUrl: envText("LOVART_BASE_URL", "https://lgw.lovart.ai").replace(/\/+$/, ""),
    proxyUrl: envText("LOVART_PROXY_URL"),
    proxyToken: envText("LOVART_PROXY_TOKEN"),
    projectId: envText("LOVART_PROJECT_ID"),
    model: envText("LOVART_IMAGE_MODEL", "generate_image_gpt_image_2_high"),
  };
}

export function lovartProviderStatus(): JsonObject {
  const value = config();
  const readiness = lovartTransportReadiness(value);
  return {
    id: "lovart",
    name: "Lovart Design Agent",
    role: "产品概念设计",
    model: value.model,
    configured: readiness.configured,
    mode: "thinking",
    transport: readiness.transport,
    project_mode: value.projectId ? "fixed" : "auto",
    storage: runtimeEnv.PRODUCT_IMAGES ? "R2" : "source_url",
  };
}

export function productImageStorageConfigured(): boolean {
  return Boolean(runtimeEnv.PRODUCT_IMAGES);
}

export function conceptArchiveQueueConfigured(): boolean {
  return Boolean(conceptArchiveQueue());
}

function conceptArchiveQueue(): QueueSender<ConceptArchiveJobMessage> | null {
  const queue = runtimeEnv.CONCEPT_ARCHIVE_QUEUE as QueueSender<ConceptArchiveJobMessage> | undefined;
  return queue?.send ? queue : null;
}

async function enqueueConceptArchive(record: ConceptImageRecord): Promise<void> {
  const queue = conceptArchiveQueue();
  if (!queue) throw new Error("概念图存档队列未配置");
  await queue.send({
    kind: "concept_archive",
    conceptId: record.id,
    runId: record.run_id,
    tenantId: record.tenant_id,
    queuedAt: Date.now() / 1000,
  });
}

async function signature(secret: string, method: string, path: string, timestamp: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`${method}\n${path}\n${timestamp}`)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function relayResponse(
  value: LovartConfig,
  method: "GET" | "POST",
  path: string,
  body: JsonObject | undefined,
  params: Record<string, string> | undefined,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetch(value.proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildLovartRelayPayload(
      value.proxyToken,
      method,
      path,
      params,
      body,
      idempotencyKey,
    )),
    redirect: "follow",
    signal,
  });
  const raw = await readResponseTextBounded(response);
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || payload == null) {
    const status = response.ok ? 502 : response.status;
    const message = response.ok
      ? "Lovart 中继返回了无效响应"
      : `Lovart 中继 HTTP ${response.status}`;
    return new Response(JSON.stringify({ message }), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const envelope = parseLovartRelayEnvelope(payload);
    return new Response(envelope.body, {
      status: envelope.status,
      headers: { "Content-Type": envelope.contentType },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      message: error instanceof Error ? error.message : "Lovart 中继响应格式无效",
    }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

async function directResponse(
  value: LovartConfig,
  method: "GET" | "POST",
  path: string,
  url: URL,
  body: JsonObject | undefined,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<Response> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signed = await signature(value.secretKey, method, path, timestamp);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) LovartAgentSkill/1.0",
    "X-Access-Key": value.accessKey,
    "X-Timestamp": timestamp,
    "X-Signature": signed,
    "X-Signed-Method": method,
    "X-Signed-Path": path,
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // Custom credential headers must never be forwarded to a redirect target.
    redirect: "error",
    signal,
  });
}

async function lovartRequest(
  method: "GET" | "POST",
  path: string,
  body?: JsonObject,
  params?: Record<string, string>,
  options: { idempotencyKey?: string } = {},
): Promise<JsonObject> {
  const value = config();
  const readiness = lovartTransportReadiness(value);
  if (readiness.error) throw new Error(readiness.error);
  const url = new URL(`${value.baseUrl}${path}`);
  for (const [key, item] of Object.entries(params || {})) url.searchParams.set(key, item);
  // Status reads are safe to retry. Creation/confirmation calls may consume
  // credits, so never repeat them when the remote outcome is uncertain.
  const attempts = method === "GET" ? 3 : 1;
  const idempotencyKey = method === "POST"
    ? options.idempotencyKey || crypto.randomUUID().replaceAll("-", "")
    : "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    let raw = "";
    try {
      response = readiness.transport === "relay"
        ? await relayResponse(value, method, path, body, params, idempotencyKey, controller.signal)
        : await directResponse(value, method, path, url, body, idempotencyKey, controller.signal);
      raw = await readResponseTextBounded(response);
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
        continue;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TransientLovartError("Lovart 请求超时");
      }
      throw new TransientLovartError("Lovart 网络请求失败");
    }
    clearTimeout(timeout);
    let payload: JsonObject = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { message: raw };
    }
    if (!response.ok) {
      if ([408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
        continue;
      }
      // Upstream error bodies can reflect deployment credentials. Only expose
      // transport status, never provider-supplied diagnostic text.
      const message = `Lovart HTTP ${response.status}: 请求被拒绝`;
      if ([408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        throw new TransientLovartError(message);
      }
      throw new Error(message);
    }
    if (payload.code != null && Number(payload.code) !== 0) {
      throw new Error("Lovart 返回业务错误，请检查供应商配置和额度");
    }
    return (payload.data || payload) as JsonObject;
  }
  throw new Error("Lovart 请求重试后仍未成功");
}

async function createLovartProject(name: string, idempotencyKey: string): Promise<string> {
  const result = await lovartRequest("POST", "/v1/openapi/project/save", {
    project_id: "",
    canvas: "",
    project_cover_list: [],
    pic_count: 0,
    project_type: 3,
    project_name: cleanText(name, 120),
  }, undefined, { idempotencyKey });
  const projectId = cleanText(result.project_id, 200);
  if (!projectId) throw new TransientLovartError("Lovart 未返回项目 ID");
  return projectId;
}

export async function testLovartProvider(): Promise<JsonObject> {
  const value = config();
  const readiness = lovartTransportReadiness(value);
  if (!readiness.configured) {
    return {
      id: "lovart",
      name: "Lovart Design Agent",
      model: value.model,
      ok: false,
      detail: readiness.error || "未配置",
    };
  }
  const startedAt = Date.now();
  try {
    await lovartRequest("POST", "/v1/openapi/mode/query", {});
    return {
      id: "lovart",
      name: "Lovart Design Agent",
      model: value.model,
      ok: true,
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: "lovart",
      name: "Lovart Design Agent",
      model: value.model,
      ok: false,
      detail: errorMessage(error),
    };
  }
}

function cleanText(value: unknown, limit = 500): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function stableIdPart(value: unknown, fallback: string): string {
  const normalized = cleanText(value, 160)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || fallback;
}

function sceneSuiteSlots(brief: JsonObject): JsonObject[] {
  const slots = brief.scene_suite?.slots;
  if (!Array.isArray(slots)) return [];
  return slots.slice(0, CONCEPT_MAX_ARTIFACTS).map((slot: JsonObject, index: number) => ({
    asset_id: cleanText(slot?.asset_id, 80) || `scene-${String(index + 1).padStart(2, "0")}`,
    role: cleanText(slot?.role, 80) || `scene_${String(index + 1).padStart(2, "0")}`,
    title: cleanText(slot?.title, 160) || `场景图 ${index + 1}`,
    sequence: index + 1,
    required: slot?.required !== false,
    aspect_ratio: cleanText(slot?.aspect_ratio, 20) || "16:10",
    purpose: cleanText(slot?.purpose, 320),
    scene_constraints: cleanText(slot?.scene_constraints, 500),
  }));
}

function artifactSceneMetadata(
  artifact: Record<string, unknown>,
  index: number,
  slots: JsonObject[],
): SceneArtifactMetadata {
  const requestedAssetId = cleanText(artifact.asset_id, 80);
  const requestedRole = cleanText(artifact.role, 80);
  const requestedSequence = Number(artifact.sequence);
  const slot = slots.find((candidate) => (
    (requestedAssetId && candidate.asset_id === requestedAssetId) ||
    (requestedRole && candidate.role === requestedRole) ||
    (Number.isInteger(requestedSequence) && candidate.sequence === requestedSequence)
  )) || slots[index];
  const isSuiteArtifact = Boolean(slot);
  const sequence = Number.isInteger(requestedSequence) && requestedSequence > 0
    ? requestedSequence
    : Number(slot?.sequence) || index + 1;
  return {
    asset_id: requestedAssetId || slot?.asset_id || `legacy-concept-${String(index + 1).padStart(2, "0")}`,
    role: requestedRole || slot?.role || (index === 0 ? "hero_master" : "legacy_alternate"),
    title: cleanText(artifact.title, 160) || slot?.title || `产品概念图 ${index + 1}`,
    sequence,
    required: typeof artifact.required === "boolean"
      ? artifact.required
      : isSuiteArtifact ? slot.required !== false : index === 0,
    role_assignment: cleanText(artifact.role_assignment, 80) ||
      (isSuiteArtifact ? "positional_unverified" : "legacy_unassigned"),
  };
}

function topCandidate(report: JsonObject): JsonObject {
  const candidates = report.modules?.CPT_VERIFY?.scorecard?.candidates;
  if (Array.isArray(candidates)) {
    return [...candidates].sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99))[0] || {};
  }
  const concept = report.modules?.board_concept || {};
  const board = report.modules?.board_decision || {};
  return {
    id: "board-selected",
    name: concept.title,
    targetPrice: board.decision_table?.rows?.find?.((row: unknown[]) => /目标价/.test(String(row?.[0])))?.[1],
    weightedTotal: board.score,
    verdict: concept.thesis,
    specs: concept.specs,
    manufacturability: concept.manufacturability,
    image_url: concept.image_url,
  };
}

function topPainPoints(report: JsonObject): JsonObject[] {
  const rows = report.modules?.MIND_DECODE?.absa_12;
  if (Array.isArray(rows)) {
    return [...rows]
      .sort((a, b) => Number(b.neg_ratio || 0) - Number(a.neg_ratio || 0))
      .slice(0, 6)
      .map((row) => ({
        problem: cleanText(row.aspect_cn || row.aspect, 80),
        negative_ratio: row.neg_ratio,
        mentions: row.neg_count,
        strategic: Boolean(row.strategic),
      }));
  }
  const evidenceRows = report.modules?.voc_raw_data?.evidence_log?.rows;
  if (!Array.isArray(evidenceRows)) return [];
  const negative = evidenceRows.filter((row: unknown[]) => row?.[4] === "负向");
  const counts = new Map<string, number>();
  for (const row of negative) counts.set(String(row?.[5] || "其他体验"), (counts.get(String(row?.[5] || "其他体验")) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([problem, mentions]) => ({ problem, mentions, strategic: true, note: "编码观察数，不是市场发生率" }));
}

export function buildProductConceptBrief(report: JsonObject, runTitle = ""): JsonObject {
  const modules = report.modules || {};
  const executive = modules.exec_summary_decision_scorecard || {};
  const boardDecision = modules.board_decision || {};
  const decision = Object.keys(executive.decision || {}).length ? executive.decision : boardDecision;
  const candidate = topCandidate(report);
  const finance = modules.output_unit_economics_finance || modules.financial_model || {};
  const consensus = modules.ai_consensus || modules.aigc_grounded_synthesis || {};
  const opportunity = modules.OP_SCAN || modules.framework_opportunity_scan || {};
  const finalVerdict = modules.CPT_VERIFY?.finalVerdict || boardDecision;
  const riskRows = Array.isArray(consensus.risk_review)
    ? consensus.risk_review.slice(0, 5).map((item: JsonObject) => ({
        risk: cleanText(item.title, 120),
        mitigation: cleanText(item.mitigation, 180),
      }))
    : [];
  const actions = Array.isArray(consensus.priority_actions)
    ? consensus.priority_actions.slice(0, 6).map((item: JsonObject) => cleanText(item.action, 180))
    : [];
  const gates = Array.isArray(decision.gating_conditions)
    ? decision.gating_conditions.slice(0, 6).map((item: unknown) => cleanText(item, 220))
    : [];
  const category = cleanText(report.category || runTitle, 160);
  const conceptId = cleanText(candidate.id, 40) || "board-selected";
  const conceptName = cleanText(candidate.name || finalVerdict.chosenPlan, 180) || category;
  const brandDna = modules.aigc_design_system?.brand_dna || {
    family: "Example Modern Organic",
    colors: ["natural oak", "warm walnut", "cream", "matte charcoal"],
    form: ["controlled vertical rhythm", "soft radiused end details", "shallow modular depth", "restrained dark hardware"],
    exclusions: ["mixed farmhouse + gold-luxury + modern-fluted languages", "neon lighting", "impossible one-piece bent shells"],
  };
  const geometryLock = {
    specs: candidate.specs || modules.board_concept?.specs || [],
    manufacturability: candidate.manufacturability || modules.board_concept?.manufacturability || [],
    consistency_rule: "全部场景必须保持同一 SKU 的轮廓、比例、门、抽屉、腿、拉手、木纹方向、缝隙、颜色与五金完全一致。",
  };
  const designDnaId = `metis-dna-${stableIdPart(category, "product")}-${stableIdPart(conceptId || conceptName, "selected")}-v3`;
  const sceneSlots = CONCEPT_SCENE_SUITE_SLOTS.map((slot) => ({ ...slot }));

  return {
    brief_version: "metis-product-concept-v3-scene-suite",
    category,
    marketplace: cleanText(report.marketplace, 80),
    commercial_decision: {
      verdict: cleanText(report.verdict || decision.verdict, 80),
      confidence: cleanText(decision.confidence, 40),
      product_thesis: cleanText(decision.one_liner || finalVerdict.oneLiner || modules.board_concept?.thesis, 700),
      opportunity_score: opportunity.opportunity_score || boardDecision.score,
    },
    selected_concept: {
      id: conceptId,
      name: conceptName,
      target_price: cleanText(candidate.targetPrice, 60),
      price_band: cleanText(candidate.priceBand, 60),
      score: candidate.weightedTotal || finalVerdict.score,
      rationale: cleanText(candidate.verdict, 500),
    },
    customer_problems: topPainPoints(report),
    must_win_requirements: gates,
    recommended_actions: actions,
    risks_and_mitigations: riskRows,
    unit_economics: {
      target_price: finance.unit_price || finance.target_price,
      currency: finance.currency,
      landed_cost: Math.abs(Number(
        finance.waterfall?.find?.((row: JsonObject) => /到岸|landed/i.test(String(row.step)))?.amount || 0,
      )),
      current_net_margin_pct: finance.margins?.net_margin_pct,
      margin_note: cleanText(finance.margins?.note, 360),
    },
    industrial_design_requirements: [
      "概念必须能由常规量产工艺实现；结构连续、受力路径清楚、零件可装配、可维护。",
      "优先标准件和成熟材料体系，避免无依据的悬浮结构、超薄承力件与不可达公差。",
      "关键连接、活动机构、承力点和易损件必须在局部放大图中解释。",
      "尺寸比例符合真实人体工学与运输包装约束；未知尺寸标注为建议值，不冒充工程定稿。",
      "材料、表面处理、CMF 与成本带匹配，并明确需要打样验证的假设。",
    ],
    brand_dna: brandDna,
    design_dna: {
      id: designDnaId,
      version: CONCEPT_DESIGN_DNA_VERSION,
      status: "locked_for_visual_generation",
      concept_id: conceptId,
      concept_name: conceptName,
      identity_contract: {
        category,
        brand_language: brandDna,
        geometry: geometryLock.specs,
        manufacturability: geometryLock.manufacturability,
      },
      immutable_rules: [
        "轮廓、长宽高比例与板件厚度在全部场景一致",
        "门、抽屉、腿、拉手、开孔和内部隔断的数量与位置一致",
        "木纹方向、颜色、光泽、五金和边部处理一致",
        "任何派生场景不得新增 Master 中不存在的功能、结构、配件或认证",
      ],
      consistency_status: "pending_human_review",
    },
    geometry_lock: geometryLock,
    scene_suite: {
      version: CONCEPT_SCENE_SUITE_VERSION,
      design_dna_id: designDnaId,
      generation_strategy: "master_first_single_thread",
      expected_asset_count: CONCEPT_MAX_ARTIFACTS,
      max_asset_count: CONCEPT_MAX_ARTIFACTS,
      role_assignment: "positional_unverified",
      consistency_status: "pending_human_review",
      slots: sceneSlots,
    },
    deliverable: {
      format: "six separate 16:10 renders of one geometry-locked SKU",
      views: sceneSlots.map((slot) => `${slot.sequence}. ${slot.role}: ${slot.title}`),
      annotations: "图片内禁止生成文字、数字、Logo、尺寸线或认证；由报告 HTML/SVG 确定性叠加",
      visual_style: "国际一线工业设计咨询公司 master render；暖白中性背景、克制专业、真实材质、准确重力与连接，无霓虹",
      exclusions: ["虚构品牌或认证标志", "不可能制造的结构", "单图混拼不一致的多视图", "生成文字与乱码", "无关道具与人物喧宾夺主"],
    },
    evidence_boundary: "基于 Metis 研究报告生成概念方向；概念图用于打样评审，不能替代结构工程图、模具图或认证测试。",
  };
}

function conceptPrompt(brief: JsonObject): string {
  const slots = sceneSuiteSlots(brief);
  const orderedViews = slots.map((slot) => (
    `${slot.sequence}. ${slot.role}｜${slot.title}｜用途：${slot.purpose}｜场景约束：${slot.scene_constraints}`
  ));
  return [
    "你是资深工业设计总监、结构工程师、场景设计师和 DFM 专家。请基于以下研究简报，制作同一产品设计 DNA 的专业场景套图。",
    "",
    "执行顺序：必须先完成第 1 张 hero_master，并以它作为唯一 Master SKU 锁定设计 DNA；确认轮廓、比例、门/抽屉/腿/拉手、木纹、缝隙、颜色、五金和内部结构后，再派生其余五张。在 Master 自检通过前，不得开始第 2—6 张；工具支持参考图或一致性种子时，必须复用 Master。",
    "输出要求：严格按以下顺序输出 6 张彼此独立的 16:10 图片；不要拼成 contact sheet，不要在一张图里混排多个视图，也不要输出第 7 张图片。",
    ...orderedViews,
    "",
    "一致性硬约束：六张图必须是同一个 SKU，而不是同风格的六个变体。每张都必须复用 Master 的全部不可变身份特征；镜头、空间、道具和开合状态可以变化，产品几何与 CMF 不得变化。",
    "设计约束：比例真实；结构连续；受力合理；板件厚度可信；零件可装配；优先常规量产工艺与标准件；不得悬浮、穿模、重复零件或出现不可制造的一体弯曲壳。",
    "视觉要求：国际一线工业设计咨询公司效果图品质，克制高级、摄影级材质与自然灯光，真实空间尺度，不要荧光、赛博朋克、过度戏剧化或纯氛围空镜。",
    "图片中禁止任何文字、数字、Logo、认证、尺寸线或乱码；尺寸和说明由项目 HTML/SVG 叠加。若简报缺参数，保持保守几何，不要自行发明工程事实。",
    "输出前自检：逐张核对设计 DNA。无法确认一致的细节应回到 Master 的保守方案，不得自行补造；图像一致性最终仍标记为待人工评审。",
    "",
    "研究简报（唯一事实来源）：",
    JSON.stringify(brief),
  ].join("\n");
}

type ConceptWriteResult = {
  changed: boolean;
  record: ConceptImageRecord | null;
};

async function writeConcept(
  id: number,
  values: Record<string, unknown>,
  expectedStatus = "",
  expectedUpdatedAt?: number,
  expectedPendingConfirmation?: Record<string, unknown> | null,
  expectedSyncLeaseToken?: string,
): Promise<ConceptWriteResult> {
  const columns: Record<string, string> = {
    status: "status",
    model: "model",
    lovart_project_id: "lovart_project_id",
    lovart_thread_id: "lovart_thread_id",
    pending_confirmation: "pending_confirmation",
    artifacts: "artifacts",
    error: "error",
    sync_lease_token: "sync_lease_token",
    sync_lease_until: "sync_lease_until",
    next_poll_at: "next_poll_at",
  };
  const assignments: string[] = [];
  const bound: unknown[] = [];
  for (const [key, value] of Object.entries(values)) {
    const column = columns[key];
    if (!column) continue;
    assignments.push(`${column} = ?`);
    bound.push(
      ["pending_confirmation", "artifacts"].includes(key) && value != null
        ? JSON.stringify(value)
        : value,
    );
  }
  assignments.push("updated_at = ?");
  bound.push(Date.now() / 1000, id);
  const whereStatus = expectedStatus ? " AND status = ?" : "";
  if (expectedStatus) bound.push(expectedStatus);
  const whereUpdatedAt = Number.isFinite(expectedUpdatedAt) ? " AND updated_at = ?" : "";
  if (Number.isFinite(expectedUpdatedAt)) bound.push(expectedUpdatedAt);
  const wherePending = expectedPendingConfirmation !== undefined
    ? " AND pending_confirmation = ?"
    : "";
  if (expectedPendingConfirmation !== undefined) {
    bound.push(expectedPendingConfirmation == null ? null : JSON.stringify(expectedPendingConfirmation));
  }
  const whereSyncLease = expectedSyncLeaseToken !== undefined
    ? " AND sync_lease_token = ?"
    : "";
  if (expectedSyncLeaseToken !== undefined) bound.push(expectedSyncLeaseToken);
  const result = await database()
    .prepare(`UPDATE concept_images SET ${assignments.join(", ")} WHERE id = ?${whereStatus}${whereUpdatedAt}${wherePending}${whereSyncLease}`)
    .bind(...bound)
    .run();
  const row = await database()
    .prepare("SELECT * FROM concept_images WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
  return {
    changed: Number(result.meta.changes || 0) === 1,
    record: hydrateConcept(row),
  };
}

async function claimConceptSync(record: ConceptImageRecord): Promise<{
  token: string;
  record: ConceptImageRecord;
} | null> {
  const now = Date.now() / 1000;
  if (Number(record.sync_lease_until || 0) > now) return null;
  const scheduledPollAt = Number(record.next_poll_at);
  if (Number.isFinite(scheduledPollAt) && scheduledPollAt > now) return null;
  const token = crypto.randomUUID();
  const leaseUntil = now + CONCEPT_SYNC_LEASE_SECONDS;
  const nextPollAt = now + CONCEPT_POLL_INTERVAL_SECONDS;
  const result = await database()
    .prepare(`UPDATE concept_images SET sync_lease_token = ?, sync_lease_until = ?, next_poll_at = ?
      WHERE id = ? AND status = ? AND updated_at = ?
        AND (sync_lease_until IS NULL OR sync_lease_until <= ?)
        AND (next_poll_at IS NULL OR next_poll_at <= ?
          OR typeof(next_poll_at) NOT IN ('integer', 'real'))`)
    .bind(token, leaseUntil, nextPollAt, record.id, record.status, record.updated_at, now, now)
    .run();
  if (Number(result.meta.changes || 0) !== 1) return null;
  return {
    token,
    record: {
      ...record,
      sync_lease_token: token,
      sync_lease_until: leaseUntil,
      next_poll_at: nextPollAt,
    },
  };
}

async function claimConceptArchive(record: ConceptImageRecord): Promise<{
  token: string;
  record: ConceptImageRecord;
} | null> {
  const now = Date.now() / 1000;
  if (record.status !== "archiving" || Number(record.sync_lease_until || 0) > now) return null;
  const token = crypto.randomUUID();
  const leaseUntil = now + CONCEPT_SYNC_LEASE_SECONDS;
  const nextPollAt = now + CONCEPT_TRANSIENT_RETRY_SECONDS;
  const result = await database()
    .prepare(`UPDATE concept_images SET sync_lease_token = ?, sync_lease_until = ?, next_poll_at = ?
      WHERE id = ? AND tenant_id = ? AND run_id = ? AND status = 'archiving'
        AND updated_at = ? AND (sync_lease_until IS NULL OR sync_lease_until <= ?)`)
    .bind(
      token,
      leaseUntil,
      nextPollAt,
      record.id,
      record.tenant_id,
      record.run_id,
      record.updated_at,
      now,
    )
    .run();
  if (Number(result.meta.changes || 0) !== 1) return null;
  return {
    token,
    record: {
      ...record,
      sync_lease_token: token,
      sync_lease_until: leaseUntil,
      next_poll_at: nextPollAt,
    },
  };
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error || "未知错误");
  return cleanText(text, 500) || "Lovart 生成失败";
}

function operationIdempotencyKey(
  record: ConceptImageRecord,
  operation: "project" | "chat" | "confirm",
): string {
  return `metis-${operation}-${record.public_token}`;
}

async function retainSubmissionUnknown(
  record: ConceptImageRecord,
  values: Record<string, unknown>,
): Promise<ConceptImageRecord> {
  const retainedValues = {
    status: "submission_unknown",
    ...values,
  };
  const fallback = {
    ...record,
    ...retainedValues,
    updated_at: Date.now() / 1000,
  } as ConceptImageRecord;
  try {
    const retained = await writeConcept(
      record.id,
      retainedValues,
      "submission_unknown",
    );
    return retained.record || fallback;
  } catch {
    // The pre-POST claim is already durable, so an extended D1 outage remains non-retryable.
    return fallback;
  }
}

async function retainConfirmationUnknown(
  record: ConceptImageRecord,
  error: string,
): Promise<ConceptImageRecord> {
  const nextPollAt = Date.now() / 1000 + CONCEPT_TRANSIENT_RETRY_SECONDS;
  const fallback = {
    ...record,
    status: "confirmation_unknown",
    next_poll_at: nextPollAt,
    error,
    updated_at: Date.now() / 1000,
  } as ConceptImageRecord;
  try {
    const retained = await writeConcept(record.id, {
      next_poll_at: nextPollAt,
      error,
    }, "confirmation_unknown");
    return retained.record || fallback;
  } catch {
    return fallback;
  }
}

async function sendConcept(record: ConceptImageRecord): Promise<ConceptImageRecord> {
  const value = config();
  const initialProjectId = cleanText(record.lovart_project_id || value.projectId, 200);
  const claim = await writeConcept(record.id, {
    status: "submission_unknown",
    model: value.model,
    lovart_project_id: initialProjectId || null,
    next_poll_at: null,
    error: null,
  }, "queued", record.updated_at);
  if (!claim.changed) return claim.record || record;
  let claimedRecord = claim.record || {
    ...record,
    status: "submission_unknown",
    model: value.model,
    lovart_project_id: initialProjectId || null,
    next_poll_at: null,
    error: null,
  };

  const category = cleanText(record.design_brief?.category, 100) || `Run ${record.run_id}`;
  let projectId = initialProjectId;
  if (!projectId) {
    try {
      projectId = await createLovartProject(
        `Metis · ${category}`,
        operationIdempotencyKey(record, "project"),
      );
    } catch (error) {
      if (error instanceof TransientLovartError) {
        return retainSubmissionUnknown(claimedRecord, {
          next_poll_at: null,
          error: `${errorMessage(error)}。Lovart 可能已创建项目；为避免重复提交，系统不会自动重试，请先核验远端。`,
        });
      }
      const failed = await writeConcept(record.id, {
        status: "failed",
        next_poll_at: null,
        error: errorMessage(error),
      }, "submission_unknown");
      return failed.record || claimedRecord;
    }
    try {
      const savedProject = await writeConcept(record.id, {
        model: value.model,
        lovart_project_id: projectId,
      }, "submission_unknown");
      if (!savedProject.changed) return savedProject.record || claimedRecord;
      claimedRecord = savedProject.record || {
        ...claimedRecord,
        model: value.model,
        lovart_project_id: projectId,
      };
    } catch {
      return retainSubmissionUnknown(claimedRecord, {
        model: value.model,
        lovart_project_id: projectId,
        next_poll_at: null,
        error: "Lovart 已创建项目，但本地状态保存失败。系统不会自动重复创建，请先核验远端。",
      });
    }
  }

  let result: JsonObject;
  try {
    result = await lovartRequest("POST", "/v1/openapi/chat", {
      prompt: record.prompt,
      project_id: projectId,
      mode: "thinking",
      tool_config: {
        prefer_tool_categories: {
          IMAGE: [
            value.model,
            "generate_image_nano_banana_pro",
            "generate_image_seedream_v5_pro",
          ],
        },
      },
    }, undefined, {
      idempotencyKey: operationIdempotencyKey(record, "chat"),
    });
  } catch (error) {
    if (error instanceof TransientLovartError) {
      return retainSubmissionUnknown(claimedRecord, {
        model: value.model,
        lovart_project_id: projectId,
        next_poll_at: null,
        error: `${errorMessage(error)}。Lovart 可能已接收任务；为避免重复扣费，系统不会自动重新提交，请先核验远端项目。`,
      });
    }
    const failed = await writeConcept(record.id, {
      status: "failed",
      next_poll_at: null,
      error: errorMessage(error),
    }, "submission_unknown");
    return failed.record || claimedRecord;
  }

  const threadId = cleanText(result.thread_id, 200);
  if (!threadId) {
    return retainSubmissionUnknown(claimedRecord, {
      model: value.model,
      lovart_project_id: projectId,
      next_poll_at: null,
      error: "Lovart 可能已接收任务，但未返回线程 ID。为避免重复扣费，系统不会自动重新提交；请先在 Lovart 项目中核验。",
    });
  }
  try {
    const settled = await writeConcept(record.id, {
      status: "generating",
      model: value.model,
      lovart_project_id: projectId,
      lovart_thread_id: threadId,
      next_poll_at: Date.now() / 1000 + CONCEPT_POLL_INTERVAL_SECONDS,
      error: null,
    }, "submission_unknown");
    return settled.record || claimedRecord;
  } catch {
    return retainSubmissionUnknown(claimedRecord, {
      model: value.model,
      lovart_project_id: projectId,
      lovart_thread_id: threadId,
      next_poll_at: Date.now() / 1000 + CONCEPT_TRANSIENT_RETRY_SECONDS,
      error: "Lovart 已接收任务并返回线程 ID，但本地状态保存失败。系统将只读核验远端状态，不会重复提交。",
    });
  }
}

export async function startProductConcept(
  run: RunRecord,
  user: AppUser,
  regenerate = false,
): Promise<ConceptImageRecord> {
  if (run.data_scope === "private_only") {
    throw new Error("私有数据模式禁止向 Lovart 发送研究内容");
  }
  if (!run.report) throw new Error("研究报告尚未生成");
  const blockReason = conceptGenerationBlockReason(run.report);
  if (blockReason) throw new Error(blockReason);
  const existing = await getLatestConcept(run.id, user.tenant_id);
  if (existing && !regenerate) return existing;
  const brief = buildProductConceptBrief(run.report, run.title);
  const prompt = conceptPrompt(brief);
  const now = Date.now() / 1000;
  const db = database();
  const result = await db
    .prepare(`INSERT INTO concept_images(
      run_id, tenant_id, user_id, status, prompt, design_brief,
      model, lovart_project_id, public_token, created_at, updated_at
    ) SELECT ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM concept_images
        WHERE run_id = ? AND tenant_id = ?
          AND status IN (${ACTIVE_CONCEPT_STATUS_SQL})
      ) AND (
        SELECT COUNT(*) FROM concept_images
        WHERE tenant_id = ?2 AND status IN (${ACTIVE_CONCEPT_STATUS_SQL})
      ) < 2
      `)
    .bind(
      run.id,
      user.tenant_id,
      user.id,
      prompt,
      JSON.stringify(brief),
      config().model,
      config().projectId,
      crypto.randomUUID().replaceAll("-", ""),
      now,
      now,
      run.id,
      user.tenant_id,
    )
    .run();
  if (Number(result.meta.changes || 0) !== 1) {
    const activeRow = await db
      .prepare(`SELECT * FROM concept_images
        WHERE run_id = ? AND tenant_id = ?
          AND status IN (${ACTIVE_CONCEPT_STATUS_SQL})
        ORDER BY id DESC LIMIT 1`)
      .bind(run.id, user.tenant_id)
      .first<Record<string, unknown>>();
    const active = hydrateConcept(activeRow) || await getLatestConcept(run.id, user.tenant_id);
    if (active) return active;
    throw new Error("当前工作区同时最多生成 2 个概念图任务，请稍后重试");
  }
  const row = await db
    .prepare("SELECT * FROM concept_images WHERE id = ?")
    .bind(Number(result.meta.last_row_id))
    .first<Record<string, unknown>>();
  const record = hydrateConcept(row);
  if (!record) throw new Error("创建概念图任务失败");
  return sendConcept(record);
}

function resultArtifacts(
  result: JsonObject,
  brief: JsonObject,
): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const slots = sceneSuiteSlots(brief);
  for (const item of Array.isArray(result.items) ? result.items : []) {
    for (const artifact of Array.isArray(item?.artifacts) ? item.artifacts : []) {
      const sourceUrl = cleanText(artifact?.content, 3000);
      const type = cleanText(artifact?.type || "image", 40);
      if (!sourceUrl || type !== "image" || seen.has(sourceUrl)) continue;
      seen.add(sourceUrl);
      const index = output.length;
      output.push({
        type,
        source_url: sourceUrl,
        ...artifactSceneMetadata({}, index, slots),
      });
      if (output.length >= CONCEPT_MAX_ARTIFACTS) return output;
    }
  }
  return output;
}

function extensionFor(url: string, contentType: string): string {
  if (/jpe?g/i.test(contentType)) return "jpg";
  if (/webp/i.test(contentType)) return "webp";
  if (/gif/i.test(contentType)) return "gif";
  const matched = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
  return matched?.[1]?.toLowerCase() || "png";
}

function safeRemoteImageUrl(value: unknown): string {
  const text = cleanText(value, 3_000);
  if (!text) return "";
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    // Artifact delivery uses public DNS names. Reject all address literals so
    // WHATWG normalization (including IPv4-mapped IPv6) cannot bypass the rule.
    const addressLiteral = host.includes(":") || /^[\d.]+$/.test(host);
    const localName = !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host);
    if (url.protocol !== "https:" || url.username || url.password || url.port || addressLiteral || localName) return "";
    url.hostname = host;
    return url.toString();
  } catch {
    return "";
  }
}

function digestHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function archiveSizeLimitError(suiteBudgetLimited: boolean): Error {
  return suiteBudgetLimited
    ? new ConceptArchiveBudgetError("概念图套图文件合计超过 72MB")
    : new Error("概念图文件超过 20MB");
}

async function readImageBodyBounded(
  response: Response,
  maxBytes = CONCEPT_ARCHIVE_MAX_BYTES,
  suiteBudgetLimited = false,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  if (!response.body) throw new Error("Lovart 返回的素材没有文件内容");
  const contentLength = response.headers.get("content-length")?.trim() || "";
  const declaredSize = /^\d+$/.test(contentLength) ? Number(contentLength) : 0;
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > maxBytes) {
    await response.body.cancel("image response too large").catch(() => undefined);
    throw archiveSizeLimitError(suiteBudgetLimited);
  }

  let bytes = new Uint8Array(declaredSize || Math.min(1_048_576, maxBytes));
  const reader = response.body.getReader();
  const digestStream = typeof DigestStream === "function" ? new DigestStream("SHA-256") : null;
  const digestWriter = digestStream?.getWriter() || null;
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const nextTotal = total + chunk.value.byteLength;
      if (nextTotal > maxBytes) {
        await reader.cancel("image response too large").catch(() => undefined);
        throw archiveSizeLimitError(suiteBudgetLimited);
      }
      if (nextTotal > bytes.byteLength) {
        let nextCapacity = Math.max(1, bytes.byteLength);
        while (nextCapacity < nextTotal) {
          nextCapacity = Math.min(maxBytes, Math.max(nextTotal, nextCapacity * 2));
        }
        const expanded = new Uint8Array(nextCapacity);
        expanded.set(bytes.subarray(0, total));
        bytes = expanded;
      }
      bytes.set(chunk.value, total);
      total = nextTotal;
      await digestWriter?.write(chunk.value);
    }
    if (declaredSize && total !== declaredSize) {
      throw new Error("概念图文件长度与响应头不一致");
    }
    if (total === 0) throw new Error("Lovart 返回了空白素材文件");
    await digestWriter?.close();
    const body = bytes.subarray(0, total);
    const digest = digestStream
      ? await digestStream.digest
      : await crypto.subtle.digest("SHA-256", body);
    return { bytes: body, sha256: digestHex(digest) };
  } catch (error) {
    await reader.cancel("image archive aborted").catch(() => undefined);
    await digestWriter?.abort(error).catch(() => undefined);
    throw error;
  }
}

async function persistArtifacts(
  record: ConceptImageRecord,
  artifacts: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const bucket = runtimeEnv.PRODUCT_IMAGES as R2Bucket | undefined;
  const stored: Array<Record<string, unknown>> = [];
  let totalBytes = 0;
  let suiteBudgetError = "";
  for (const [index, artifact] of artifacts.entries()) {
    const sourceUrl = safeRemoteImageUrl(artifact.source_url);
    const item: Record<string, unknown> = { ...artifact, source_url: sourceUrl };
    delete item.storage_error;
    if (suiteBudgetError) {
      delete item.r2_key;
      delete item.sha256;
      delete item.byte_size;
      delete item.content_type;
      item.storage_error = suiteBudgetError;
      stored.push(item);
      continue;
    }
    const existingKey = cleanText(artifact.r2_key, 1_000);
    const existingSha256 = cleanText(artifact.sha256, 64).toLowerCase();
    if (bucket && existingKey && /^[a-f0-9]{64}$/.test(existingSha256)) {
      const existing = await bucket.head(existingKey);
      const metadataSize = Number(existing?.customMetadata?.byte_size || 0);
      if (
        existing && existing.customMetadata?.sha256 === existingSha256 &&
        metadataSize === existing.size && existing.size > 0 &&
        existing.size <= CONCEPT_ARCHIVE_MAX_BYTES
      ) {
        if (totalBytes + existing.size > CONCEPT_ARCHIVE_MAX_TOTAL_BYTES) {
          suiteBudgetError = errorMessage(archiveSizeLimitError(true));
          delete item.r2_key;
          delete item.sha256;
          delete item.byte_size;
          delete item.content_type;
          item.storage_error = suiteBudgetError;
          stored.push(item);
          continue;
        }
        totalBytes += existing.size;
        stored.push({
          ...item,
          r2_key: existingKey,
          sha256: existingSha256,
          byte_size: existing.size,
          content_type: existing.httpMetadata?.contentType || artifact.content_type || "image/png",
        });
        continue;
      }
    }
    delete item.r2_key;
    delete item.sha256;
    delete item.byte_size;
    delete item.content_type;
    if (!sourceUrl) {
      item.storage_error = "Lovart 返回的素材地址无效";
      stored.push(item);
      continue;
    }
    if (bucket) {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 30_000);
        const response = await fetch(sourceUrl, {
          redirect: "manual",
          headers: {
            "User-Agent": "Mozilla/5.0 MetisVOC/1.2",
            Referer: "https://www.lovart.ai/",
          },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`素材下载失败 (${response.status})`);
        const contentType = response.headers.get("content-type") || "image/png";
        if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(contentType.split(";")[0].trim())) {
          throw new Error("Lovart 返回的素材不是受支持的图片");
        }
        const remainingSuiteBytes = CONCEPT_ARCHIVE_MAX_TOTAL_BYTES - totalBytes;
        if (remainingSuiteBytes <= 0) throw archiveSizeLimitError(true);
        const suiteBudgetLimited = remainingSuiteBytes < CONCEPT_ARCHIVE_MAX_BYTES;
        const { bytes, sha256: assetSha256 } = await readImageBodyBounded(
          response,
          Math.min(CONCEPT_ARCHIVE_MAX_BYTES, remainingSuiteBytes),
          suiteBudgetLimited,
        );
        const extension = extensionFor(sourceUrl, contentType);
        const key = `concepts/${record.tenant_id}/${record.run_id}/${record.id}/${index}.${extension}`;
        await bucket.put(key, bytes, {
          httpMetadata: {
            contentType,
            cacheControl: "public, max-age=31536000, immutable",
          },
          customMetadata: {
            run_id: String(record.run_id),
            concept_id: String(record.id),
            source: "lovart",
            sha256: assetSha256,
            byte_size: String(bytes.byteLength),
          },
        });
        item.r2_key = key;
        item.content_type = contentType;
        item.byte_size = bytes.byteLength;
        item.sha256 = assetSha256;
        totalBytes += bytes.byteLength;
      } catch (error) {
        const detail = errorMessage(error);
        item.storage_error = detail;
        if (error instanceof ConceptArchiveBudgetError) suiteBudgetError = detail;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    stored.push(item);
  }
  return stored;
}

function validConceptArchiveJob(message: ConceptArchiveJobMessage): boolean {
  return message.kind === "concept_archive" &&
    Number.isInteger(message.conceptId) && message.conceptId > 0 &&
    Number.isInteger(message.runId) && message.runId > 0 &&
    Number.isInteger(message.tenantId) && message.tenantId > 0 &&
    Number.isFinite(message.queuedAt) && message.queuedAt > 0;
}

export async function executeConceptArchiveJob(
  message: ConceptArchiveJobMessage,
  deliveryAttempt = 1,
): Promise<ConceptArchiveJobResult> {
  if (!validConceptArchiveJob(message)) throw new Error("概念图存档队列消息无效");
  const row = await database()
    .prepare(`SELECT * FROM concept_images
      WHERE id = ? AND tenant_id = ? AND run_id = ?`)
    .bind(message.conceptId, message.tenantId, message.runId)
    .first<Record<string, unknown>>();
  const record = hydrateConcept(row);
  if (!record || record.status === "done" || record.status === "failed") {
    return { outcome: "stale", conceptId: message.conceptId };
  }
  if (record.status !== "archiving") {
    return { outcome: "stale", conceptId: message.conceptId };
  }

  const lease = await claimConceptArchive(record);
  if (!lease) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(Number(record.sync_lease_until || 0) - Date.now() / 1000) || 5,
    );
    return { outcome: "busy", conceptId: message.conceptId, retryAfterSeconds };
  }

  const settleFailure = async (
    detail: string,
    artifacts: Array<Record<string, unknown>> = lease.record.artifacts || [],
  ): Promise<ConceptArchiveJobResult> => {
    const finalAttempt = deliveryAttempt >= CONCEPT_ARCHIVE_MAX_ATTEMPTS;
    const result = await writeConcept(lease.record.id, {
      status: finalAttempt ? "failed" : "archiving",
      artifacts,
      error: finalAttempt
        ? `概念图永久存档失败：${detail}`
        : `概念图永久存档暂时失败，系统会自动重试：${detail}`,
      sync_lease_token: null,
      sync_lease_until: null,
      next_poll_at: finalAttempt ? null : Date.now() / 1000 + CONCEPT_TRANSIENT_RETRY_SECONDS,
    }, "archiving", undefined, undefined, lease.token);
    if (!result.changed) return { outcome: "stale", conceptId: message.conceptId };
    return finalAttempt
      ? { outcome: "failed", conceptId: message.conceptId }
      : {
          outcome: "busy",
          conceptId: message.conceptId,
          retryAfterSeconds: CONCEPT_TRANSIENT_RETRY_SECONDS,
        };
  };

  try {
    const artifacts = Array.isArray(lease.record.artifacts) ? lease.record.artifacts : [];
    if (!artifacts.length) return settleFailure("队列消息没有可存档的图片素材");
    const stored = await persistArtifacts(lease.record, artifacts);
    const failures = stored
      .filter((artifact) => artifact.storage_error || !artifact.r2_key ||
        !/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || "")))
      .map((artifact) => cleanText(artifact.storage_error, 240) || "R2 存档未完成");
    if (failures.length) return settleFailure(failures.join("；"), stored);
    const completed = await writeConcept(lease.record.id, {
      status: "done",
      artifacts: stored,
      pending_confirmation: null,
      error: null,
      sync_lease_token: null,
      sync_lease_until: null,
      next_poll_at: null,
    }, "archiving", undefined, undefined, lease.token);
    return {
      outcome: completed.changed ? "completed" : "stale",
      conceptId: message.conceptId,
    };
  } catch (error) {
    return settleFailure(errorMessage(error));
  }
}

export async function syncProductConcept(
  record: ConceptImageRecord,
): Promise<ConceptImageRecord> {
  if (record.status === "archiving") {
    const lease = await claimConceptSync(record);
    if (!lease) return record;
    try {
      await enqueueConceptArchive(lease.record);
      const scheduled = await writeConcept(record.id, {
        error: null,
        sync_lease_token: null,
        sync_lease_until: null,
        next_poll_at: Date.now() / 1000 + CONCEPT_TRANSIENT_RETRY_SECONDS,
      }, "archiving", undefined, undefined, lease.token);
      return scheduled.record || lease.record;
    } catch (error) {
      const deferred = await writeConcept(record.id, {
        error: `${errorMessage(error)}，系统将在下一轮状态检查时重新提交存档任务`,
        sync_lease_token: null,
        sync_lease_until: null,
        next_poll_at: Date.now() / 1000 + CONCEPT_TRANSIENT_RETRY_SECONDS,
      }, "archiving", undefined, undefined, lease.token);
      return deferred.record || lease.record;
    }
  }
  if (!record.lovart_thread_id) {
    if (record.status === "queued" && Date.now() / 1000 - record.updated_at > 60) {
      const interrupted = await writeConcept(record.id, {
        status: "submission_unknown",
        next_poll_at: null,
        error: "任务在保存 Lovart 线程编号前中断，远端结果无法确认；为避免重复扣费，系统不会自动重新提交。",
      }, "queued", record.updated_at);
      return interrupted.record || record;
    }
    return record;
  }
  if (!["queued", "generating", "submission_unknown", "confirmation_unknown"].includes(record.status)) {
    return record;
  }
  const lease = await claimConceptSync(record);
  if (!lease) return record;
  record = lease.record;
  const settle = async (
    values: Record<string, unknown>,
    retryAfterSeconds = CONCEPT_POLL_INTERVAL_SECONDS,
  ): Promise<ConceptImageRecord> => {
    const nextStatus = typeof values.status === "string" ? values.status : record.status;
    const nextPollAt = POLLABLE_CONCEPT_STATUSES.has(nextStatus)
      ? Date.now() / 1000 + retryAfterSeconds
      : null;
    const result = await writeConcept(record.id, {
      ...values,
      sync_lease_token: null,
      sync_lease_until: null,
      next_poll_at: nextPollAt,
    }, "", undefined, undefined, lease.token);
    return result.record || record;
  };
  try {
    const threadId = String(record.lovart_thread_id);
    const statusResult = await lovartRequest(
      "GET",
      "/v1/openapi/chat/status",
      undefined,
      { thread_id: threadId },
    );
    const remoteStatus = String(statusResult.status || "running");
    let result: JsonObject = {};
    let resultReadError = "";
    if (remoteStatus === "done" || remoteStatus === "running") {
      try {
        result = await lovartRequest(
          "GET",
          "/v1/openapi/chat/result",
          undefined,
          { thread_id: threadId },
        );
      } catch (error) {
        if (!(error instanceof TransientLovartError)) throw error;
        result = {};
        resultReadError = errorMessage(error);
      }
    }
    if (result.pending_confirmation) {
      if (record.status === "confirmation_unknown") {
        return settle({
          error: "上次付费确认结果仍无法核验；系统不会再次提交确认，请先在 Lovart 项目中人工对账。",
        });
      }
      return settle({
        status: "awaiting_confirmation",
        pending_confirmation: result.pending_confirmation,
        error: null,
      });
    }
    if (remoteStatus === "abort") {
      const agentMessage = (result.items || [])
        .map((item: JsonObject) => cleanText(item.text, 240))
        .filter(Boolean)
        .join(" ");
      return settle({
        status: "failed",
        error: agentMessage || "Lovart 已终止本次生成",
      });
    }
    const artifacts = resultArtifacts(result, record.design_brief);
    if (artifacts.length) {
      const archived = await settle({
        status: "archiving",
        artifacts,
        pending_confirmation: null,
        error: null,
      }, CONCEPT_TRANSIENT_RETRY_SECONDS);
      if (archived.status !== "archiving") return archived;
      try {
        await enqueueConceptArchive(archived);
        return archived;
      } catch (error) {
        const deferred = await writeConcept(archived.id, {
          error: `${errorMessage(error)}，系统将在下一轮状态检查时重新提交存档任务`,
          next_poll_at: Date.now() / 1000 + CONCEPT_TRANSIENT_RETRY_SECONDS,
        }, "archiving", archived.updated_at);
        return deferred.record || archived;
      }
    }
    if (["submission_unknown", "confirmation_unknown"].includes(record.status) &&
        remoteStatus === "running" && !resultReadError) {
      return settle({
        status: "generating",
        pending_confirmation: null,
        error: null,
      });
    }
    if (resultReadError) {
      return settle({
        error: remoteStatus === "done"
          ? `${resultReadError}，任务已完成但结果暂不可读取，系统会继续同步`
          : `${resultReadError}，任务仍在生成但结果暂不可读取，系统会继续同步`,
      }, CONCEPT_TRANSIENT_RETRY_SECONDS);
    }
    if (remoteStatus === "done" && Date.now() / 1000 - record.created_at > 120) {
      const agentMessage = (result.items || [])
        .map((item: JsonObject) => cleanText(item.text, 240))
        .filter(Boolean)
        .join(" ");
      return settle({
        status: "failed",
        error: agentMessage || "Lovart 已完成任务，但未返回可用图片",
      });
    }
    return settle({});
  } catch (error) {
    if (error instanceof TransientLovartError) {
      return settle({
        error: `${errorMessage(error)}，系统会自动重试`,
      }, CONCEPT_TRANSIENT_RETRY_SECONDS);
    }
    return settle({
      status: "failed",
      error: errorMessage(error),
    });
  }
}

export async function confirmProductConcept(
  record: ConceptImageRecord,
): Promise<ConceptImageRecord> {
  if (record.status !== "awaiting_confirmation" || !record.lovart_thread_id) return record;
  const claim = await writeConcept(record.id, {
    status: "confirmation_unknown",
    next_poll_at: Date.now() / 1000 + CONCEPT_TRANSIENT_RETRY_SECONDS,
    error: null,
  }, "awaiting_confirmation", record.updated_at, record.pending_confirmation);
  if (!claim.changed) return claim.record || record;
  const claimedRecord = claim.record || {
    ...record,
    status: "confirmation_unknown",
  };
  try {
    await lovartRequest("POST", "/v1/openapi/chat/confirm", {
      thread_id: claimedRecord.lovart_thread_id,
    }, undefined, {
      idempotencyKey: operationIdempotencyKey(claimedRecord, "confirm"),
    });
  } catch (error) {
    if (error instanceof TransientLovartError) {
      return retainConfirmationUnknown(
        claimedRecord,
        `${errorMessage(error)}。确认结果尚未返回，系统将通过只读状态查询核验，不会重复提交确认。`,
      );
    }
    const failed = await writeConcept(record.id, {
      status: "failed",
      next_poll_at: null,
      error: errorMessage(error),
    }, "confirmation_unknown");
    return failed.record || claimedRecord;
  }
  try {
    const settled = await writeConcept(record.id, {
      status: "generating",
      pending_confirmation: null,
      next_poll_at: Date.now() / 1000 + CONCEPT_POLL_INTERVAL_SECONDS,
      error: null,
    }, "confirmation_unknown");
    return settled.record || claimedRecord;
  } catch {
    return retainConfirmationUnknown(
      claimedRecord,
      "Lovart 已接受付费确认，但本地状态保存失败。系统将通过只读状态查询核验，不会重复提交确认。",
    );
  }
}

export function conceptForClient(
  record: ConceptImageRecord | null,
  assetOrigin = "",
): JsonObject | null {
  if (!record) return null;
  const brief = (record.design_brief || {}) as JsonObject;
  const slots = sceneSuiteSlots(brief);
  const isLegacyRecord = slots.length === 0;
  const rawArtifacts = Array.isArray(record.artifacts)
    ? record.artifacts.slice(0, CONCEPT_MAX_ARTIFACTS)
    : [];
  const assets = rawArtifacts.map((artifact, index) => ({
    index,
    type: artifact.type || "image",
    url: artifact.r2_key
      ? new URL(`/api/concept-assets/${record.public_token}/${index}`, assetOrigin || "http://metis.local").toString()
          .replace(/^http:\/\/metis\.local/, "")
      : safeRemoteImageUrl(artifact.source_url),
    stored: Boolean(artifact.r2_key),
    sha256: artifact.r2_key && /^[a-f0-9]{64}$/i.test(String(artifact.sha256 || ""))
      ? String(artifact.sha256)
      : null,
    ...artifactSceneMetadata(artifact, index, slots),
  }));
  const requiredSlots = slots.filter((slot) => slot.required !== false);
  const fulfilledRequiredSlots = requiredSlots.filter((slot) => assets.some((asset) => (
    asset.asset_id === slot.asset_id || asset.role === slot.role || asset.sequence === slot.sequence
  )));
  const expectedAssetCount = isLegacyRecord
    ? CONCEPT_MAX_ARTIFACTS
    : Math.min(
        CONCEPT_MAX_ARTIFACTS,
        Math.max(slots.length, Number(brief.scene_suite?.expected_asset_count) || 0),
      );
  const sceneSuite = {
    version: cleanText(brief.scene_suite?.version || brief.scene_suite?.suite_version, 80) ||
      (isLegacyRecord ? LEGACY_SCENE_SUITE_VERSION : CONCEPT_SCENE_SUITE_VERSION),
    design_dna_id: cleanText(brief.scene_suite?.design_dna_id || brief.design_dna?.id, 160) || null,
    generation_strategy: cleanText(brief.scene_suite?.generation_strategy, 80) ||
      (isLegacyRecord ? "legacy_unknown" : "master_first_single_thread"),
    expected_asset_count: expectedAssetCount,
    required_asset_count: isLegacyRecord ? CONCEPT_MAX_ARTIFACTS : requiredSlots.length,
    asset_count: assets.length,
    completed_required_count: isLegacyRecord ? 0 : fulfilledRequiredSlots.length,
    is_complete: !isLegacyRecord && requiredSlots.length > 0 &&
      fulfilledRequiredSlots.length === requiredSlots.length,
    role_assignment: cleanText(brief.scene_suite?.role_assignment, 80) ||
      (isLegacyRecord ? "legacy_unassigned" : "positional_unverified"),
    consistency_status: cleanText(brief.scene_suite?.consistency_status, 80) ||
      (isLegacyRecord ? "legacy_unverified" : "pending_human_review"),
    legacy_record: isLegacyRecord,
    slots: isLegacyRecord ? [] : slots.map((slot) => ({
      ...slot,
      available: assets.some((asset) => (
        asset.asset_id === slot.asset_id || asset.role === slot.role || asset.sequence === slot.sequence
      )),
    })),
  };
  const pending = record.pending_confirmation || null;
  const scheduledPollAt = Number(record.next_poll_at);
  const retryAfterSeconds = POLLABLE_CONCEPT_STATUSES.has(record.status) && Number.isFinite(scheduledPollAt)
    ? Math.max(0, Math.ceil(scheduledPollAt - Date.now() / 1000))
    : 0;
  return {
    id: record.id,
    run_id: record.run_id,
    status: record.status,
    model: record.model,
    design_brief: record.design_brief,
    design_dna: isLegacyRecord ? null : brief.design_dna || null,
    scene_suite: sceneSuite,
    pending_confirmation: pending,
    estimated_cost:
      pending?.estimated_cost ??
      pending?.cost ??
      pending?.credits ??
      null,
    assets,
    error: record.error || null,
    retry_after_seconds: retryAfterSeconds,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export async function conceptAssetForAdoption(
  record: ConceptImageRecord,
  index: number,
): Promise<{ ok: true; r2Key: string; sha256: string; contentType: string; byteSize: number } | { ok: false; reason: string }> {
  if (record.status !== "done") {
    return { ok: false, reason: "概念图任务尚未完成，不能写入正式报告" };
  }
  const artifact = (record.artifacts || [])[index];
  if (!artifact) return { ok: false, reason: "所选概念图不存在" };
  const r2Key = cleanText(artifact.r2_key, 1_000);
  const sha256 = cleanText(artifact.sha256, 64).toLowerCase();
  if (!r2Key || !/^[a-f0-9]{64}$/.test(sha256)) {
    return { ok: false, reason: "该图片只有临时源链接，尚未完成永久存档，不能采用为终审概念" };
  }
  const bucket = runtimeEnv.PRODUCT_IMAGES as R2Bucket | undefined;
  if (!bucket) {
    return { ok: false, reason: "概念图永久存储尚未配置，不能采用为终审概念" };
  }
  const storedObject = await bucket.head(r2Key);
  if (!storedObject) {
    return { ok: false, reason: "概念图存档文件缺失，请重新生成后再采用" };
  }
  const storedSha256 = cleanText(storedObject.customMetadata?.sha256, 64).toLowerCase();
  const storedMetadataSize = Number(storedObject.customMetadata?.byte_size || 0);
  const recordedSize = Number(artifact.byte_size || 0);
  if (
    storedSha256 !== sha256 || storedMetadataSize !== storedObject.size ||
    (recordedSize > 0 && recordedSize !== storedObject.size) ||
    storedObject.size <= 0 || storedObject.size > CONCEPT_ARCHIVE_MAX_BYTES
  ) {
    return { ok: false, reason: "概念图存档完整性校验失败，请重新生成后再采用" };
  }
  const storedContentType = cleanText(storedObject.httpMetadata?.contentType, 100) ||
    cleanText(artifact.content_type, 100) || "image/png";
  if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(storedContentType.split(";")[0].trim())) {
    return { ok: false, reason: "概念图存档格式校验失败，请重新生成后再采用" };
  }
  return {
    ok: true,
    r2Key,
    sha256: storedSha256,
    contentType: storedContentType,
    byteSize: storedObject.size,
  };
}

export async function conceptAsset(
  publicToken: string,
  index: number,
): Promise<Response | null> {
  const row = await database()
    .prepare("SELECT artifacts FROM concept_images WHERE public_token = ?")
    .bind(publicToken)
    .first<{ artifacts: string | null }>();
  if (!row?.artifacts) return null;
  let artifacts: Array<Record<string, unknown>> = [];
  try {
    artifacts = JSON.parse(row.artifacts);
  } catch {
    return null;
  }
  const artifact = artifacts[index];
  if (!artifact) return null;
  const bucket = runtimeEnv.PRODUCT_IMAGES as R2Bucket | undefined;
  if (artifact.r2_key && bucket) {
    const object = await bucket.get(String(artifact.r2_key));
    if (!object) return null;
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("content-length", String(object.size));
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  }
  if (artifact.source_url) {
    const sourceUrl = safeRemoteImageUrl(artifact.source_url);
    if (sourceUrl) return Response.redirect(sourceUrl, 302);
  }
  return null;
}

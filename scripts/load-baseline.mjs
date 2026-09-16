import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { Agent, request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createLocalCredentials } from "./setup-local.mjs";
import { smokeConfiguration } from "./smoke-local.mjs";
import { parseJsonConfig } from "./check-deploy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const wranglerVersion = JSON.parse(
  readFileSync(join(root, "node_modules", "wrangler", "package.json"), "utf8"),
).version;
const host = "127.0.0.1";
const profileName = process.env.METIS_LOAD_PROFILE || "baseline";
const outputPath = process.env.METIS_LOAD_OUTPUT || join(root, "tmp", "load-baseline", "latest.json");
const keepTemporary = process.env.METIS_LOAD_KEEP_TEMP === "1";
export const READY_HEALTH_REQUEST_TIMEOUT_MS = 2_000;
const diagnosticSecrets = new Set();
function sanitizeDiagnostics(value) {
  let text = String(value);
  for (const secret of diagnosticSecrets) if (secret) text = text.replaceAll(secret, "[redacted]");
  return text;
}

export function loadEnvironment(parentEnvironment, temporaryRoot, logPath) {
  const environment = Object.fromEntries(Object.entries(parentEnvironment).filter(([name]) =>
    /^(?:PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|LANG)$/i.test(name)));
  return {
    ...environment,
    CI: "true", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: logPath, MINIFLARE_REGISTRY_PATH: join(temporaryRoot, "registry"),
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  };
}

export function loadConfiguration(built, builtPath) {
  // Reuse the explicit local-binding allowlist; never spread build vars or
  // deployment resource bindings into a test configuration.
  return { ...smokeConfiguration(built, builtPath), name: "metis-load-baseline" };
}

export async function prepareLoadIsolation(directory, temporaryRoot) {
  const redirectPath = join(directory, ".wrangler", "deploy", "config.json");
  const redirect = JSON.parse(readFileSync(redirectPath, "utf8"));
  if (!redirect.configPath) throw new Error("Build redirect has no configPath. Run pnpm build first.");
  const builtPath = resolve(dirname(redirectPath), redirect.configPath);
  const built = parseJsonConfig(readFileSync(builtPath, "utf8"), builtPath);
  const config = loadConfiguration(built, builtPath);
  if (!existsSync(config.main)) throw new Error("Built Worker entry missing. Run pnpm build first.");
  const credentials = createLocalCredentials("load-admin@example.test");
  for (const secret of [credentials.password, credentials.passwordHash, credentials.encryptionKey]) diagnosticSecrets.add(secret);
  const configPath = join(temporaryRoot, "wrangler.json");
  const variables = {
    BOOTSTRAP_ADMIN_EMAIL: credentials.email, BOOTSTRAP_ADMIN_PASSWORD_HASH: credentials.passwordHash,
    BOOTSTRAP_ADMIN_NAME: "Load fixture administrator", SETTINGS_ENCRYPTION_KEY: credentials.encryptionKey,
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await writeFile(join(temporaryRoot, ".dev.vars"),
    Object.entries(variables).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
  await writeFile(join(temporaryRoot, ".env"), "# Isolated load test: no inherited environment.\n", { mode: 0o600 });
  return { configPath, temporaryRoot, credentials };
}

export function createLoadReport() {
  // Only inserted into the disposable local D1. Verified flags are a control
  // fixture for signing/export concurrency, never a claim about market data.
  return {
    synthetic: true, fixture_notice: "SYNTHETIC LOAD TEST ONLY — not market evidence",
    category: "Load fixture", marketplace: "Amazon US", verdict: "有条件进入",
    evidence_mode: "verified_research", decision_readiness: "ready_for_review",
    report_version: "synthetic-load-fixture-v1", title: "Synthetic local load fixture",
    order: ["exec_summary_decision_scorecard"],
    modules: {
      exec_summary_decision_scorecard: {
        decision: { verdict: "conditional_go", confidence: "Medium", one_liner: "Synthetic signing control fixture" },
        fixture_rows: Array.from({ length: 5000 }, (_, index) => [
          index, "Synthetic load fixture, not market evidence. ".repeat(4),
        ]),
      },
    },
    ext_meta: {},
  };
}

export async function seedLoadReport(temporaryRoot, persistencePath, email) {
  const relativePath = relative(resolve(temporaryRoot), resolve(persistencePath));
  if (!basename(temporaryRoot).startsWith("metis-load-baseline-") ||
      !relativePath || relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath)) {
    throw new Error("Refusing to seed outside the isolated load-test directory.");
  }
  const databases = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(join(directory, entry.name));
      else if (entry.isFile() && entry.name.endsWith(".sqlite")) databases.push(join(directory, entry.name));
    }
  };
  await visit(persistencePath);
  for (const filename of databases) {
    const db = new DatabaseSync(filename);
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get()) continue;
      const user = db.prepare("SELECT id, tenant_id FROM users WHERE email = ?").get(email);
      if (!user) throw new Error("Isolated load-test administrator is missing.");
      const report = createLoadReport();
      const now = Date.now() / 1000;
      const inserted = db.prepare(`INSERT INTO runs(
        tenant_id, user_id, title, input_mode, input_payload, marketplace, view_profile,
        data_scope, status, verdict, research_plan, report, evidence_mode, decision_readiness,
        created_at, updated_at
      ) VALUES(?, ?, ?, 'category_keyword', ?, 'US', 'P1', 'public_ok', 'done', ?, '{}', ?, ?, ?, ?, ?)`)
        .run(user.tenant_id, user.id, report.title, JSON.stringify(report.category), report.verdict,
          JSON.stringify(report), report.evidence_mode, report.decision_readiness, now, now);
      return Number(inserted.lastInsertRowid);
    } finally { db.close(); }
  }
  throw new Error("Isolated D1 database has not initialized its report schema.");
}
function createLocalHttpAgent() {
  return new Agent({
    keepAlive: true,
    keepAliveMsecs: 1_000,
    maxSockets: 64,
    maxFreeSockets: 16,
    scheduling: "lifo",
  });
}

let localHttpAgent = createLocalHttpAgent();

const profiles = {
  smoke: {
    health: [20, 4],
    staticJs: [12, 3],
    staticLarge: [6, 2],
    runList: [12, 3],
    reportRead: [4, 2],
    conditionalReportRead: [8, 4],
    createRun: [8, 8],
    exportJson: [3, 1],
    reviewCas: [4, 4],
  },
  baseline: {
    health: [200, 32],
    staticJs: [100, 16],
    staticLarge: [36, 6],
    runList: [100, 16],
    reportRead: [24, 4],
    conditionalReportRead: [100, 20],
    createRun: [20, 20],
    exportJson: [12, 2],
    reviewCas: [12, 12],
  },
};

const profile = profiles[profileName];
if (!profile) {
  throw new Error(`Unknown METIS_LOAD_PROFILE ${profileName}; use smoke or baseline.`);
}

function assertLocalUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== host) {
    throw new Error(`Load baseline refuses non-local target: ${url.origin}`);
  }
  return url;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function percentile(sorted, percentileValue) {
  if (!sorted.length) return null;
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return Number(sorted[index].toFixed(2));
}

function statusCounts(samples) {
  const counts = {};
  for (const sample of samples) {
    const key = String(sample.status || "transport_error");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function optionalString(value) {
  return value === undefined || value === null ? null : String(value);
}

function errorDetails(error) {
  const errorRecord = error && typeof error === "object" ? error : {};
  const cause = errorRecord.cause && typeof errorRecord.cause === "object"
    ? errorRecord.cause
    : null;
  return {
    name: optionalString(errorRecord.name) || typeof error,
    message: error instanceof Error ? error.message : String(error),
    cause: cause
      ? {
          name: optionalString(cause.name),
          message: optionalString(cause.message),
          code: optionalString(cause.code),
          syscall: optionalString(cause.syscall),
        }
      : null,
  };
}

function summarize(name, samples, wallTimeMs, concurrency, expectedStatuses) {
  const latencies = samples.map((sample) => sample.latencyMs).sort((left, right) => left - right);
  const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);
  const operationalErrors = samples.filter((sample) => sample.status === 0 || sample.status >= 500).length;
  const unexpected = samples.filter((sample) => !expectedStatuses.includes(sample.status)).length;
  const seconds = Math.max(wallTimeMs / 1_000, 0.001);
  const first = samples[0] || {};
  const failureSamples = samples
    .filter((sample) => sample.status === 0 || sample.status >= 500 || !expectedStatuses.includes(sample.status))
    .slice(0, 5)
    .map((sample) => ({
      status: sample.status,
      response_status_before_failure: sample.responseStatusBeforeFailure || null,
      received_bytes_before_failure: sample.bytes || 0,
      error: sample.error || null,
      error_details: sample.errorDetails || null,
      body: sample.body
        ? Buffer.from(sample.body).toString("utf8").replace(/\s+/g, " ").slice(0, 500)
        : null,
      request_id: sample.headers?.requestId || null,
      content_length: sample.headers?.contentLength || null,
      server_timing: sample.headers?.serverTiming || null,
      transport: sample.transport || null,
    }));
  return {
    name,
    requests: samples.length,
    concurrency,
    wall_time_ms: Number(wallTimeMs.toFixed(2)),
    throughput_rps: Number((samples.length / seconds).toFixed(2)),
    latency_ms: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length ? Number(latencies.at(-1).toFixed(2)) : null,
    },
    status_counts: statusCounts(samples),
    expected_statuses: expectedStatuses,
    operational_error_rate: Number((operationalErrors / Math.max(samples.length, 1)).toFixed(4)),
    unexpected_status_rate: Number((unexpected / Math.max(samples.length, 1)).toFixed(4)),
    failure_samples: failureSamples,
    response_bytes: {
      average: Math.round(totalBytes / Math.max(samples.length, 1)),
      total: totalBytes,
    },
    transfer_mib_per_second: Number((totalBytes / 1_048_576 / seconds).toFixed(2)),
    response_headers: {
      cache_control: first.headers?.cacheControl || null,
      etag: first.headers?.etag || null,
      content_encoding: first.headers?.contentEncoding || null,
      content_type: first.headers?.contentType || null,
      request_id_present: Boolean(first.headers?.requestId),
      server_timing: first.headers?.serverTiming || null,
    },
  };
}

async function timedFetch(url, init = {}, timeoutMs = 120_000) {
  assertLocalUrl(url);
  const startedAt = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    let responseStatus = 0;
    let responseBytes = 0;
    let responseHeaders = {};
    const requestHeaders = init.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : { ...(init.headers || {}) };
    const requestBody = init.body == null
      ? null
      : Buffer.isBuffer(init.body)
        ? init.body
        : Buffer.from(String(init.body));
    if (requestBody && !Object.keys(requestHeaders).some((name) => name.toLowerCase() === "content-length")) {
      requestHeaders["content-length"] = String(requestBody.byteLength);
    }
    const finish = (sample) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(sample);
    };
    const fail = (error) => {
      const details = errorDetails(error);
      finish({
        status: 0,
        bytes: responseBytes,
        latencyMs: performance.now() - startedAt,
        error: details.message,
        errorDetails: details,
        responseStatusBeforeFailure: responseStatus,
        headers: responseHeaders,
      });
    };
    const request = httpRequest(new URL(url), {
      method: init.method || "GET",
      headers: requestHeaders,
      agent: init.agent === false ? false : localHttpAgent,
    }, (response) => {
      const chunks = [];
      let byteLength = 0;
      const header = (name) => {
        const value = response.headers[name];
        return Array.isArray(value) ? value.join(", ") : value || null;
      };
      responseStatus = response.statusCode || 0;
      responseHeaders = {
        cacheControl: header("cache-control"),
        etag: header("etag"),
        contentEncoding: header("content-encoding"),
        contentLength: header("content-length"),
        contentType: header("content-type"),
        requestId: header("x-request-id"),
        serverTiming: header("server-timing"),
      };
      response.on("data", (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buffer);
        byteLength += buffer.byteLength;
        responseBytes = byteLength;
      });
      response.once("aborted", () => fail(new Error("Response aborted")));
      response.once("error", fail);
      response.once("end", () => {
        finish({
          status: response.statusCode || 0,
          bytes: byteLength,
          latencyMs: performance.now() - startedAt,
          body: Buffer.concat(chunks, byteLength),
          headers: responseHeaders,
        });
      });
    });
    request.once("error", fail);
    const timeout = setTimeout(() => {
      const error = new Error(`Request timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      error.code = "ETIMEDOUT";
      request.destroy(error);
    }, timeoutMs);
    if (requestBody) request.write(requestBody);
    request.end();
  });
}

function curlHeader(responseHeaders, name) {
  const entry = Object.entries(responseHeaders || {})
    .find(([headerName]) => headerName.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  return Array.isArray(value) ? value.at(-1) || null : optionalString(value);
}

export function curlTransferSample(index, record, processDetails = {}) {
  const metadata = record?.metadata || {};
  const responseHeaders = record?.response_headers || {};
  const curlExitCode = Number(metadata.exitcode);
  const httpStatus = Number(metadata.http_code || 0);
  const bytes = Number(metadata.size_download || 0);
  const declaredLength = Number(curlHeader(responseHeaders, "content-length") || 0);
  const latencyMs = Number(metadata.time_total || 0) * 1_000 ||
    Number(processDetails.fallbackLatencyMs || 0);
  let status = Number.isFinite(curlExitCode) && curlExitCode === 0 ? httpStatus : 0;
  let error = null;
  let errorName = null;
  if (!record) {
    errorName = "CurlMetadataError";
    error = processDetails.error || `curl parallel transfer ${index} produced no metadata`;
  } else if (!Number.isFinite(curlExitCode) || curlExitCode !== 0) {
    errorName = "CurlError";
    error = String(metadata.errormsg || processDetails.error || `curl exited with code ${curlExitCode}`);
  } else if (status === 200 && (!Number.isFinite(declaredLength) || declaredLength <= 0)) {
    status = 0;
    errorName = "IncompleteTransferError";
    error = "curl response did not include a positive Content-Length";
  } else if (status === 200 && bytes !== declaredLength) {
    status = 0;
    errorName = "IncompleteTransferError";
    error = `curl transferred ${bytes} bytes but Content-Length was ${declaredLength}`;
  }
  const transport = {
    client: "curl_parallel",
    request_index: index,
    process_exit_code: processDetails.exitCode ?? null,
    curl_exit_code: Number.isFinite(curlExitCode) ? curlExitCode : null,
    curl_error: optionalString(metadata.errormsg),
    http_code: httpStatus,
    http_version: optionalString(metadata.http_version),
    local_ip: optionalString(metadata.local_ip),
    local_port: Number(metadata.local_port || 0) || null,
    remote_ip: optionalString(metadata.remote_ip),
    remote_port: Number(metadata.remote_port || 0) || null,
    num_connects: Number(metadata.num_connects || 0),
    time_namelookup_ms: Number(metadata.time_namelookup || 0) * 1_000,
    time_connect_ms: Number(metadata.time_connect || 0) * 1_000,
    time_pretransfer_ms: Number(metadata.time_pretransfer || 0) * 1_000,
    time_starttransfer_ms: Number(metadata.time_starttransfer || 0) * 1_000,
    time_total_ms: Number(metadata.time_total || 0) * 1_000,
    declared_content_length: declaredLength || null,
    transferred_bytes: bytes,
  };
  return {
    status,
    bytes,
    latencyMs,
    error,
    errorDetails: error ? {
      name: errorName,
      message: error,
      cause: {
        code: Number.isFinite(curlExitCode) ? String(curlExitCode) : optionalString(processDetails.exitCode),
        name: null,
        message: null,
        syscall: null,
      },
    } : null,
    body: Buffer.alloc(0),
    headers: {
      cacheControl: curlHeader(responseHeaders, "cache-control"),
      etag: curlHeader(responseHeaders, "etag"),
      contentEncoding: curlHeader(responseHeaders, "content-encoding"),
      contentLength: curlHeader(responseHeaders, "content-length"),
      contentType: curlHeader(responseHeaders, "content-type") || optionalString(metadata.content_type),
      requestId: curlHeader(responseHeaders, "x-request-id"),
      serverTiming: curlHeader(responseHeaders, "server-timing"),
    },
    transport,
  };
}

export function parseCurlTransferRecords(rawOutput) {
  const records = new Map();
  const recordPattern = /METIS_CURL_(\d+):(\{[\s\S]*?\})(?=\s*METIS_CURL_\d+:|$)/g;
  for (const match of String(rawOutput || "").trim().matchAll(recordPattern)) {
    try {
      records.set(Number(match[1]), JSON.parse(match[2]));
    } catch {
      // Missing metadata becomes a fail-closed sample below.
    }
  }
  return records;
}

async function runCurlDownloadScenario({
  name,
  total,
  concurrency,
  url,
  headers = {},
  timeoutMs = 30_000,
}) {
  assertLocalUrl(url);
  const startedAt = performance.now();
  const executable = process.platform === "win32"
    ? join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe")
    : "curl";
  const sink = process.platform === "win32" ? "NUL" : "/dev/null";
  const args = buildCurlDownloadArgs({
    total,
    concurrency,
    url,
    headers,
    timeoutMs,
    sink,
  });

  return new Promise((resolve) => {
    let settled = false;
    const stdout = [];
    const stderr = [];
    const child = spawn(executable, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const finish = (exitCode, processError = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const elapsedMs = performance.now() - startedAt;
      const records = parseCurlTransferRecords(Buffer.concat(stdout).toString("utf8"));
      const detail = processError || Buffer.concat(stderr).toString("utf8").trim() || null;
      const samples = Array.from({ length: total }, (_, index) => curlTransferSample(
        index,
        records.get(index),
        { exitCode, error: detail, fallbackLatencyMs: elapsedMs },
      ));
      resolve(summarize(name, samples, elapsedMs, concurrency, [200]));
    };
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => {
      const details = errorDetails(error);
      finish(null, details.message);
    });
    child.once("close", (code) => finish(code));
    const timeout = setTimeout(() => {
      child.kill();
      finish(null, `curl parallel scenario timed out after ${timeoutMs + 15_000}ms`);
    }, timeoutMs + 15_000);
  });
}

export function buildCurlDownloadArgs({
  total,
  concurrency,
  url,
  headers = {},
  timeoutMs = 30_000,
  sink = process.platform === "win32" ? "NUL" : "/dev/null",
}) {
  assertLocalUrl(url);
  const args = [
    // curl reads its rc file before most command-line processing, so this
    // global option must remain first. Per-transfer options are repeated after
    // every --next below because curl resets local options between transfers.
    "--disable",
    "--parallel",
    "--parallel-immediate",
    "--parallel-max",
    String(concurrency),
  ];
  for (let index = 0; index < total; index += 1) {
    if (index > 0) args.push("--next");
    const transferUrl = new URL(url);
    transferUrl.searchParams.set("__metis_load_request", String(index));
    args.push(
      "--silent",
      "--show-error",
      "--noproxy",
      "*",
      "--http1.1",
      "--connect-timeout",
      "5",
      "--max-time",
      String(Math.max(1, Math.ceil(timeoutMs / 1_000))),
      "--output",
      sink,
      "--write-out",
      `METIS_CURL_${index}:{"metadata":%{json},"response_headers":%{header_json}}\\n`,
    );
    for (const [headerName, value] of Object.entries(headers)) {
      args.push("--header", `${headerName}: ${value}`);
    }
    args.push(transferUrl.toString());
  }
  return args;
}

export async function runScenario({
  name,
  total,
  concurrency,
  expectedStatuses = [200],
  request,
  runtime = null,
}) {
  // A scenario owns its connection pool. Wrangler can retire idle HTTP/1.1
  // sockets between unrelated scenarios; reusing those sockets would measure a
  // local harness artifact instead of this scenario's Worker behavior.
  localHttpAgent.destroy();
  localHttpAgent = createLocalHttpAgent();
  const samples = new Array(total);
  let cursor = 0;
  const startedAt = performance.now();
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      samples[index] = await request(index);
    }
  });
  const load = Promise.all(workers).then(() => ({ kind: "complete" }));
  const outcome = runtime
    ? await Promise.race([
        load,
        runtime.terminal.then((event) => ({ kind: "terminal", event })),
      ])
    : await load;
  if (outcome.kind === "terminal") {
    throw wranglerProcessError(runtime, outcome.event, `scenario:${name}`);
  }
  return summarize(name, samples, performance.now() - startedAt, concurrency, expectedStatuses);
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function collectProcessOutput(child) {
  const lines = [];
  const collect = (stream) => (chunk) => {
    const receivedAt = new Date().toISOString();
    for (const line of sanitizeDiagnostics(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      lines.push(`${receivedAt} [${stream}] ${line}`);
      if (lines.length > 500) lines.shift();
    }
  };
  child.stdout.on("data", collect("stdout"));
  child.stderr.on("data", collect("stderr"));
  return lines;
}

export function observeWranglerProcess(child, { phase, outputLines, logPath }) {
  const events = [];
  let firstTerminal = null;
  let resolveTerminal;
  const terminal = new Promise((resolve) => {
    resolveTerminal = resolve;
  });
  const record = (kind, code = null, signal = null, error = null) => {
    const event = {
      kind,
      code: code ?? child.exitCode ?? null,
      signal: signal ?? child.signalCode ?? null,
      error: error ? errorDetails(error) : null,
      at: new Date().toISOString(),
    };
    events.push(event);
    if (!firstTerminal) {
      firstTerminal = event;
      resolveTerminal(event);
    }
  };
  child.on("error", (error) => record("error", null, null, error));
  child.on("exit", (code, signal) => record("exit", code, signal));
  child.on("close", (code, signal) => record("close", code, signal));
  return {
    phase,
    outputLines,
    logPath,
    events,
    terminal,
    firstTerminal: () => firstTerminal,
  };
}

export function wranglerProcessError(runtime, event, stage = "runtime") {
  const outputTail = runtime.outputLines.slice(-160);
  const eventDetail = event.error?.message || [
    event.code == null ? null : `code=${event.code}`,
    event.signal ? `signal=${event.signal}` : null,
  ].filter(Boolean).join(", ") || "no exit detail";
  const error = new Error([
    `Wrangler child ${event.kind} during phase=${runtime.phase} stage=${stage}: ${eventDetail}.`,
    `Wrangler log path: ${runtime.logPath}`,
    `Wrangler output tail:\n${outputTail.length ? outputTail.join("\n") : "(no captured output)"}`,
  ].join("\n"));
  error.name = "WranglerProcessError";
  error.wrangler = {
    phase: runtime.phase,
    stage,
    log_path: runtime.logPath,
    event,
    events: runtime.events,
    output_tail: outputTail,
  };
  return error;
}

async function stopProcess(child) {
  if (process.platform === "win32" && child.pid) {
    const taskkill = join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await Promise.race([
      new Promise((resolve) => killer.once("exit", resolve)),
      sleep(15_000),
    ]);
    child.stdout.destroy();
    child.stderr.destroy();
    return;
  }
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(5_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export async function waitForReady(baseUrl, runtime) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const existingTerminal = runtime.firstTerminal();
    if (existingTerminal) throw wranglerProcessError(runtime, existingTerminal, "readiness");
    const outcome = await Promise.race([
      timedFetch(
        `${baseUrl}/api/health`,
        {},
        READY_HEALTH_REQUEST_TIMEOUT_MS,
      ).then((sample) => ({ kind: "health", sample })),
      runtime.terminal.then((event) => ({ kind: "terminal", event })),
    ]);
    if (outcome.kind === "terminal") {
      throw wranglerProcessError(runtime, outcome.event, "readiness");
    }
    const sample = outcome.sample;
    if (sample.status === 200) return sample;
    if (sample.status !== 0 && sample.status < 500) {
      throw new Error(`Unexpected health status during startup: ${sample.status}`);
    }
    const pause = await Promise.race([
      sleep(300).then(() => null),
      runtime.terminal,
    ]);
    if (pause) throw wranglerProcessError(runtime, pause, "readiness_backoff");
  }
  throw new Error([
    `Wrangler readiness timed out during phase=${runtime.phase}.`,
    `Wrangler log path: ${runtime.logPath}`,
    `Wrangler output tail:\n${runtime.outputLines.slice(-160).join("\n") || "(no captured output)"}`,
  ].join("\n"));
}

function authHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function jsonRequest(url, init = {}) {
  const sample = await timedFetch(url, init);
  let body = null;
  try {
    body = sample.body ? JSON.parse(Buffer.from(sample.body).toString("utf8")) : null;
  } catch {
    body = null;
  }
  return { ...sample, json: body };
}

function requireStatus(sample, expected, label) {
  if (!expected.includes(sample.status)) {
    const detail = sample.json?.detail || sample.error || "no detail";
    throw new Error(`${label} returned ${sample.status}: ${detail}`);
  }
}

async function waitForRunTerminal(baseUrl, runId, token, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  const startedAt = performance.now();
  const timeline = [];
  let latest = null;
  let transportErrors = 0;
  let attempts = 0;
  const diagnostics = () => ({
    total_attempts: attempts,
    transport_errors: transportErrors,
    timeline,
  });
  const attachDiagnostics = () => {
    if (!latest) return latest;
    latest.pollTransportErrors = transportErrors;
    latest.pollDiagnostics = diagnostics();
    return latest;
  };
  while (Date.now() < deadline) {
    latest = await jsonRequest(`${baseUrl}/api/runs/${runId}/status`, {
      headers: authHeaders(token),
    });
    attempts += 1;
    timeline.push({
      attempt: attempts,
      at_ms: Number((performance.now() - startedAt).toFixed(2)),
      status: latest.status,
      latency_ms: Number(latest.latencyMs.toFixed(2)),
      run_status: latest.json?.status || null,
      error: latest.error || null,
      error_details: latest.errorDetails || null,
      request_id: latest.headers?.requestId || null,
      server_timing: latest.headers?.serverTiming || null,
    });
    if (latest.status === 0) {
      transportErrors += 1;
      const error = new Error("run status polling had a transport error");
      error.pollDiagnostics = diagnostics();
      throw error;
    }
    try {
      requireStatus(latest, [200], "run status poll");
    } catch (error) {
      if (error && typeof error === "object") error.pollDiagnostics = diagnostics();
      throw error;
    }
    if (["done", "failed"].includes(latest.json?.status)) {
      return attachDiagnostics();
    }
    await sleep(250);
  }
  return attachDiagnostics();
}

async function waitForRuntimeStability(baseUrl, timeoutMs = 15_000) {
  const startedAt = Date.now();
  for (let attempts = 1; attempts <= 3; attempts += 1) {
    const sample = await timedFetch(`${baseUrl}/api/health`, {}, 3_000);
    if (sample.status !== 200) {
      const detail = sample.error || `HTTP ${sample.status}`;
      throw new Error(`Local Wrangler health check failed after Queue delivery: ${detail}`);
    }
    if (attempts < 3) await sleep(250);
  }
  return {
    passed: true,
    attempts: 3,
    consecutive_healthy: 3,
    elapsed_ms: Date.now() - startedAt,
    timeout_ms: timeoutMs,
  };
}

export function loadWranglerOptions(wrangler, port, persistencePath, wranglerLogPath, isolation, parentEnvironment = process.env) {
  return { command: process.execPath, args: [
    wrangler, "dev", "--config", isolation.configPath,
    "--local", "--ip", host, "--port", String(port),
    "--persist-to", persistencePath, "--log-level", "error",
    "--show-interactive-dev-session=false",
  ], options: {
    cwd: isolation.temporaryRoot,
    env: loadEnvironment(parentEnvironment, isolation.temporaryRoot, wranglerLogPath),
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  } };
}

function spawnWrangler(wrangler, port, persistencePath, wranglerLogPath, isolation) {
  const { command, args, options } = loadWranglerOptions(wrangler, port, persistencePath, wranglerLogPath, isolation);
  return spawn(command, args, options);
}

function startWrangler(wrangler, port, persistencePath, wranglerLogPath, phase, isolation) {
  const child = spawnWrangler(wrangler, port, persistencePath, wranglerLogPath, isolation);
  const outputLines = collectProcessOutput(child);
  return {
    child,
    ...observeWranglerProcess(child, {
      phase,
      outputLines,
      logPath: wranglerLogPath,
    }),
  };
}

async function persistResult(result) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${sanitizeDiagnostics(JSON.stringify(result, null, 2))}\n`, "utf8");
}

async function main() {
  const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  const clientEntry = join(root, "dist", "client", "app.js");
  if (!existsSync(wrangler)) throw new Error("Wrangler is not installed. Run pnpm install first.");
  if (!existsSync(clientEntry)) throw new Error("dist/client is missing. Run pnpm run build first.");

  const temporaryRoot = await mkdtemp(join(tmpdir(), "metis-load-baseline-"));
  if (!basename(temporaryRoot).startsWith("metis-load-baseline-")) {
    throw new Error("Refusing to use unexpected persistence directory.");
  }
  const isolation = await prepareLoadIsolation(root, temporaryRoot);
  const { credentials } = isolation;
  const bulkPersistencePath = join(temporaryRoot, "bulk-d1");
  const bulkWranglerLogPath = join(temporaryRoot, "bulk-wrangler.log");
  const exportWranglerLogPath = join(temporaryRoot, "export-wrangler.log");
  const queueWranglerLogPath = join(temporaryRoot, "queue-wrangler.log");
  let wranglerLogPath = bulkWranglerLogPath;
  const bulkPort = await availablePort();
  let baseUrl = `http://${host}:${bulkPort}`;
  assertLocalUrl(baseUrl);

  let runtime = startWrangler(
    wrangler,
    bulkPort,
    bulkPersistencePath,
    wranglerLogPath,
    "bulk_cas",
    isolation,
  );
  let child = runtime.child;
  let outputLines = runtime.outputLines;
  const runtimeOutput = { bulk_cas: outputLines };
  const runtimeMonitors = { bulk_cas: runtime };

  const result = {
    generated_at: new Date().toISOString(),
    target: baseUrl,
    isolation: {
      local_only: true,
      production_requests: 0,
      temporary_d1: true,
      external_provider_keys_forced_empty: true,
      paid_provider_calls: false,
      isolated_config_and_environment: true,
      synthetic_report_fixtures: true,
      profile: profileName,
      wrangler_version: wranglerVersion,
      fresh_runtime_per_phase: true,
      phases: ["bulk_cas", "export_transfer", "queue_e2e"],
    },
    startup: {},
    scenarios: [],
    invariants: {},
    caveats: [
      "Local Wrangler throughput is a regression baseline, not a Cloudflare production capacity guarantee.",
      "Lovart calls are disabled locally; concept-adoption CAS is covered by the injected-D1 lifecycle tests, not paid-provider HTTP throughput.",
    ],
  };

  try {
    const startupAt = performance.now();
    const startupHealth = await waitForReady(baseUrl, runtime);
    if (JSON.parse(startupHealth.body.toString()).dependencies?.paid_provider_calls !== "paused") {
      throw new Error("Isolated load test requires all paid providers to be paused.");
    }
    await seedLoadReport(temporaryRoot, bulkPersistencePath, credentials.email);
    result.startup.bulk_cas = {
      cold_schema_and_seed_ms: Number((performance.now() - startupAt).toFixed(2)),
      health_status: startupHealth.status,
      target: baseUrl,
      runtime_pid: runtime.child.pid || null,
    };

    const runMeasuredScenario = (options) => runScenario({ ...options, runtime });

    for (let index = 0; index < 3; index += 1) {
      requireStatus(await jsonRequest(`${baseUrl}/api/health`), [200], "health warmup");
    }

    const [healthTotal, healthConcurrency] = profile.health;
    result.scenarios.push(await runMeasuredScenario({
      name: "health",
      total: healthTotal,
      concurrency: healthConcurrency,
      request: () => timedFetch(`${baseUrl}/api/health`),
    }));

    const [staticJsTotal, staticJsConcurrency] = profile.staticJs;
    result.scenarios.push(await runMeasuredScenario({
      name: "static_app_js",
      total: staticJsTotal,
      concurrency: staticJsConcurrency,
      request: () => timedFetch(`${baseUrl}/app.js`),
    }));

    const [staticLargeTotal, staticLargeConcurrency] = profile.staticLarge;
    result.scenarios.push(await runMeasuredScenario({
      name: "static_vendor_bundle",
      total: staticLargeTotal,
      concurrency: staticLargeConcurrency,
      request: () => timedFetch(`${baseUrl}/vendor/metis-vendor.js`),
    }));

    const login = await jsonRequest(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "198.51.100.1",
      },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
    });
    requireStatus(login, [200], "admin login");
    const token = login.json?.token;
    if (!token) throw new Error("Admin login did not return a token.");
    diagnosticSecrets.add(token);

    const limiterSamples = [];
    const limiterStartedAt = performance.now();
    const limiterEmail = `load-limit-${Date.now()}@invalid.example`;
    for (let index = 0; index < 6; index += 1) {
      limiterSamples.push(await timedFetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "198.51.100.2",
        },
        body: JSON.stringify({ email: limiterEmail, password: "not-the-password" }),
      }));
    }
    const limiterSummary = summarize(
      "login_sliding_window",
      limiterSamples,
      performance.now() - limiterStartedAt,
      1,
      [401, 429],
    );
    result.scenarios.push(limiterSummary);
    result.invariants.login_rate_limit = {
      expected: { 401: 5, 429: 1 },
      actual: limiterSummary.status_counts,
      passed: limiterSummary.status_counts[401] === 5 && limiterSummary.status_counts[429] === 1,
    };

    const accountFailureSamples = [];
    const accountFailureStartedAt = performance.now();
    for (let index = 0; index < 10; index += 1) {
      accountFailureSamples.push(await timedFetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": `198.51.100.${20 + index}`,
        },
        body: JSON.stringify({ email: credentials.email, password: "wrong-password" }),
      }));
    }
    const validAfterFailures = await timedFetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "198.51.100.99",
      },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
    });
    accountFailureSamples.push(validAfterFailures);
    const accountFailureSummary = summarize(
      "valid_login_after_distributed_failures",
      accountFailureSamples,
      performance.now() - accountFailureStartedAt,
      1,
      [200, 401],
    );
    result.scenarios.push(accountFailureSummary);
    result.invariants.valid_login_not_account_locked = {
      failed_password_statuses: accountFailureSamples.slice(0, -1).map((sample) => sample.status),
      valid_password_status: validAfterFailures.status,
      passed: accountFailureSamples.slice(0, -1).every((sample) => sample.status === 401) &&
        validAfterFailures.status === 200,
    };

    const runsResponse = await jsonRequest(`${baseUrl}/api/runs`, {
      headers: authHeaders(token),
    });
    requireStatus(runsResponse, [200], "run list setup");
    const runs = Array.isArray(runsResponse.json) ? runsResponse.json : [];
    const verifiedRun = runs.find((run) =>
      run.evidence_mode === "verified_research" &&
      run.decision_readiness === "ready_for_review" &&
      !run.reviewed
    );
    if (!verifiedRun?.id) throw new Error("No unsigned verified report exists in isolated seed data.");

    const [runListTotal, runListConcurrency] = profile.runList;
    result.scenarios.push(await runMeasuredScenario({
      name: "authenticated_run_list",
      total: runListTotal,
      concurrency: runListConcurrency,
      request: () => timedFetch(`${baseUrl}/api/runs`, { headers: authHeaders(token) }),
    }));

    const [reportTotal, reportConcurrency] = profile.reportRead;
    const reportReadScenario = await runMeasuredScenario({
      name: "concurrent_report_read",
      total: reportTotal,
      concurrency: reportConcurrency,
      request: () => timedFetch(`${baseUrl}/api/runs/${verifiedRun.id}`, {
        headers: authHeaders(token),
      }),
    });
    result.scenarios.push(reportReadScenario);
    const reportEtag = reportReadScenario.response_headers.etag;
    if (!reportEtag) throw new Error("Full report response did not include an ETag.");

    const [conditionalTotal, conditionalConcurrency] = profile.conditionalReportRead;
    result.scenarios.push(await runMeasuredScenario({
      name: "conditional_report_read_304",
      total: conditionalTotal,
      concurrency: conditionalConcurrency,
      expectedStatuses: [304],
      request: () => timedFetch(`${baseUrl}/api/runs/${verifiedRun.id}`, {
        headers: authHeaders(token, { "if-none-match": reportEtag }),
      }),
    }));

    const createBody = JSON.stringify({
      mode: "category_keyword",
      payload: `isolated-load-${Date.now()}`,
      marketplace: "US",
      view_profile: "P1",
      data_scope: "public_ok",
    });
    const createKey = `load-create-${Date.now()}`;
    const createdIds = [];
    const [createTotal, createConcurrency] = profile.createRun;
    const createScenario = await runMeasuredScenario({
      name: "idempotent_run_create",
      total: createTotal,
      concurrency: createConcurrency,
      expectedStatuses: [200, 201],
      request: async () => {
        const sample = await timedFetch(`${baseUrl}/api/runs`, {
          method: "POST",
          headers: authHeaders(token, {
            "content-type": "application/json",
            "idempotency-key": createKey,
          }),
          body: createBody,
        });
        try {
          const payload = JSON.parse(Buffer.from(sample.body || []).toString("utf8"));
          if (payload?.id) createdIds.push(payload.id);
        } catch {
          // Status and response-size assertions retain the parsing failure signal.
        }
        return sample;
      },
    });
    result.scenarios.push(createScenario);
    const distinctCreatedIds = new Set(createdIds);
    result.invariants.create_run_idempotency = {
      successful_creates: createScenario.status_counts[201] || 0,
      replay_responses: createScenario.status_counts[200] || 0,
      distinct_run_ids: distinctCreatedIds.size,
      passed: createScenario.status_counts[201] === 1 &&
        createScenario.status_counts[200] === createTotal - 1 &&
        distinctCreatedIds.size === 1,
    };
    const exportCheck = await jsonRequest(`${baseUrl}/api/runs/${verifiedRun.id}/export-check`, {
      headers: authHeaders(token),
    });
    requireStatus(exportCheck, [200], "review CAS setup");
    const reviewBody = {
      decision_outcome: "有条件",
      outcome_note: "Isolated load baseline CAS validation.",
      review_checks: { evidence: true, economics: true, risk: true },
      reviewed: true,
      expected_report_hash: exportCheck.json.report_sha256,
      expected_report_version: exportCheck.json.report_version,
    };
    const [reviewTotal, reviewConcurrency] = profile.reviewCas;
    const reviewScenario = await runMeasuredScenario({
      name: "review_signing_cas",
      total: reviewTotal,
      concurrency: reviewConcurrency,
      expectedStatuses: [200, 409, 429],
      request: () => timedFetch(`${baseUrl}/api/runs/${verifiedRun.id}`, {
        method: "PATCH",
        headers: authHeaders(token, { "content-type": "application/json" }),
        body: JSON.stringify(reviewBody),
      }),
    });
    result.scenarios.push(reviewScenario);
    const signedCheck = await jsonRequest(`${baseUrl}/api/runs/${verifiedRun.id}/export-check`, {
      headers: authHeaders(token),
    });
    result.invariants.review_signing_cas = {
      successful_writers: reviewScenario.status_counts[200] || 0,
      conflicts: reviewScenario.status_counts[409] || 0,
      throttled: reviewScenario.status_counts[429] || 0,
      final_edition: signedCheck.json?.edition,
      passed: reviewScenario.status_counts[200] === 1 &&
        (reviewScenario.status_counts[409] || 0) +
          (reviewScenario.status_counts[429] || 0) === reviewTotal - 1 &&
        signedCheck.status === 200 && signedCheck.json?.edition === "signed",
    };

    result.invariants.concept_adoption_cas = {
      http_load_tested: false,
      functional_test: "tests/api-decision-lifecycle.test.mjs",
      reason: "Lovart credentials are forced empty; permanent R2 adoption is covered without paid provider calls in the lifecycle suite.",
    };

    result.invariants.same_run_execution_claim = {
      http_load_tested: false,
      functional_test: "tests/api-decision-lifecycle.test.mjs",
      reason: "The injected-D1 lifecycle suite owns the 12-way claim race; local Queue E2E sends one confirm.",
    };

    // Export transfer gets a fresh process and fresh D1. Reusing bulk state
    // after Windows taskkill would make SQLite flush timing part of the test,
    // while keeping export in the bulk runtime previously produced ambiguous
    // pre-header stalls. This phase performs one explicit signing write and
    // never retries it.
    await stopProcess(child);
    child = null;
    runtime = null;

    const exportPort = await availablePort();
    baseUrl = `http://${host}:${exportPort}`;
    assertLocalUrl(baseUrl);
    wranglerLogPath = exportWranglerLogPath;
    runtime = startWrangler(
      wrangler,
      exportPort,
      join(temporaryRoot, "export-d1"),
      wranglerLogPath,
      "export_transfer",
      isolation,
    );
    child = runtime.child;
    outputLines = runtime.outputLines;
    runtimeOutput.export_transfer = outputLines;
    runtimeMonitors.export_transfer = runtime;

    const exportStartupAt = performance.now();
    const exportStartupHealth = await waitForReady(baseUrl, runtime);
    await seedLoadReport(temporaryRoot, join(temporaryRoot, "export-d1"), credentials.email);
    result.startup.export_transfer = {
      cold_schema_and_seed_ms: Number((performance.now() - exportStartupAt).toFixed(2)),
      health_status: exportStartupHealth.status,
      target: baseUrl,
      runtime_pid: runtime.child.pid || null,
    };

    const exportLogin = await jsonRequest(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "198.51.100.4",
      },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
    });
    requireStatus(exportLogin, [200], "Export transfer admin login");
    const exportToken = exportLogin.json?.token;
    if (!exportToken) throw new Error("Export transfer admin login did not return a token.");
    diagnosticSecrets.add(exportToken);

    const exportRunsResponse = await jsonRequest(`${baseUrl}/api/runs`, {
      headers: authHeaders(exportToken),
    });
    requireStatus(exportRunsResponse, [200], "Export transfer run lookup");
    const exportRuns = Array.isArray(exportRunsResponse.json) ? exportRunsResponse.json : [];
    const exportRun = exportRuns.find((run) =>
      run.evidence_mode === "verified_research" &&
      run.decision_readiness === "ready_for_review" &&
      !run.reviewed
    );
    if (!exportRun?.id) {
      throw new Error("No unsigned verified report exists in fresh export seed data.");
    }

    const exportFixtureCheck = await jsonRequest(
      `${baseUrl}/api/runs/${exportRun.id}/export-check`,
      { headers: authHeaders(exportToken) },
    );
    requireStatus(exportFixtureCheck, [200], "Export transfer signing setup");
    const exportFixtureSign = await jsonRequest(`${baseUrl}/api/runs/${exportRun.id}`, {
      method: "PATCH",
      headers: authHeaders(exportToken, { "content-type": "application/json" }),
      body: JSON.stringify({
        decision_outcome: "有条件",
        outcome_note: "Fresh-runtime export transfer fixture.",
        review_checks: { evidence: true, economics: true, risk: true },
        reviewed: true,
        expected_report_hash: exportFixtureCheck.json.report_sha256,
        expected_report_version: exportFixtureCheck.json.report_version,
      }),
    });
    requireStatus(exportFixtureSign, [200], "Export transfer one-shot signing");
    const exportFixtureSignedCheck = await jsonRequest(
      `${baseUrl}/api/runs/${exportRun.id}/export-check`,
      { headers: authHeaders(exportToken) },
    );
    requireStatus(exportFixtureSignedCheck, [200], "Export transfer signed fixture check");
    if (exportFixtureSignedCheck.json?.edition !== "signed") {
      throw new Error("Fresh export fixture did not reach the signed edition.");
    }
    result.invariants.export_transfer_fixture = {
      fresh_runtime: true,
      fresh_d1: true,
      signing_write_requests: 1,
      signing_status: exportFixtureSign.status,
      final_edition: exportFixtureSignedCheck.json.edition,
      passed: true,
    };

    const [exportTotal, exportConcurrency] = profile.exportJson;
    result.scenarios.push(await runCurlDownloadScenario({
      name: "large_signed_json_export",
      total: exportTotal,
      concurrency: exportConcurrency,
      url: `${baseUrl}/api/runs/${exportRun.id}/export.json`,
      headers: authHeaders(exportToken),
      timeoutMs: 30_000,
    }));

    // Queue delivery also owns a fresh process and D1. A local Queue consumer
    // can replace Wrangler's proxy URL, so no producer load follows it.
    await stopProcess(child);
    child = null;
    runtime = null;

    const queuePort = await availablePort();
    baseUrl = `http://${host}:${queuePort}`;
    assertLocalUrl(baseUrl);
    wranglerLogPath = queueWranglerLogPath;
    runtime = startWrangler(
      wrangler,
      queuePort,
      join(temporaryRoot, "queue-d1"),
      wranglerLogPath,
      "queue_e2e",
      isolation,
    );
    child = runtime.child;
    outputLines = runtime.outputLines;
    runtimeOutput.queue_e2e = outputLines;
    runtimeMonitors.queue_e2e = runtime;

    const queueStartupAt = performance.now();
    const queueStartupHealth = await waitForReady(baseUrl, runtime);
    result.startup.queue_e2e = {
      cold_schema_and_seed_ms: Number((performance.now() - queueStartupAt).toFixed(2)),
      health_status: queueStartupHealth.status,
      target: baseUrl,
      runtime_pid: runtime.child.pid || null,
    };

    const queueLogin = await jsonRequest(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "198.51.100.3",
      },
      body: JSON.stringify({ email: credentials.email, password: credentials.password }),
    });
    requireStatus(queueLogin, [200], "Queue E2E admin login");
    const queueToken = queueLogin.json?.token;
    if (!queueToken) throw new Error("Queue E2E admin login did not return a token.");
    diagnosticSecrets.add(queueToken);

    const queueCreate = await jsonRequest(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: authHeaders(queueToken, {
        "content-type": "application/json",
        "idempotency-key": `queue-e2e-${Date.now()}`,
      }),
      body: JSON.stringify({
        mode: "category_keyword",
        payload: `isolated-queue-e2e-${Date.now()}`,
        marketplace: "US",
        view_profile: "P1",
        data_scope: "public_ok",
      }),
    });
    requireStatus(queueCreate, [201], "Queue E2E run create");
    const queueRunId = queueCreate.json?.id;
    if (!queueRunId) throw new Error("Queue E2E run create did not return an id.");

    const confirmStartedAt = performance.now();
    const queueConfirm = await jsonRequest(`${baseUrl}/api/runs/${queueRunId}/confirm`, {
      method: "POST",
      headers: authHeaders(queueToken, { "content-type": "application/json" }),
      body: JSON.stringify({ research_plan: queueCreate.json.research_plan }),
    });
    const queueConfirmScenario = summarize(
      "single_message_queue_confirm",
      [queueConfirm],
      performance.now() - confirmStartedAt,
      1,
      [202],
    );
    result.scenarios.push(queueConfirmScenario);
    requireStatus(queueConfirm, [202], "Queue E2E confirm");

    const queueTerminal = await waitForRunTerminal(baseUrl, queueRunId, queueToken);
    result.invariants.single_message_queue_e2e = {
      create_requests: 1,
      confirm_requests: 1,
      confirm_status: queueConfirm.status,
      confirm_response_bytes: queueConfirm.bytes,
      confirm_contains_report: Object.hasOwn(queueConfirm.json || {}, "report"),
      final_status: queueTerminal?.json?.status,
      poll_transport_errors: queueTerminal?.pollTransportErrors || 0,
      poll_diagnostics: queueTerminal?.pollDiagnostics || null,
      passed: queueConfirm.status === 202 &&
        queueConfirm.bytes < 2_048 &&
        !Object.hasOwn(queueConfirm.json || {}, "report") &&
        queueTerminal?.status === 200 &&
        queueTerminal.json?.status === "done" &&
        (queueTerminal?.pollTransportErrors || 0) === 0,
    };
    result.invariants.local_queue_runtime_stability = await waitForRuntimeStability(baseUrl);

    result.passed = result.scenarios.every((scenario) =>
      scenario.operational_error_rate === 0 && scenario.unexpected_status_rate === 0
    ) && Object.values(result.invariants)
      .filter((invariant) => "passed" in invariant)
      .every((invariant) => invariant.passed === true);

    if (!result.passed) {
      result.diagnostics = {
        wrangler_output_tail: Object.fromEntries(
          Object.entries(runtimeOutput).map(([phase, lines]) => [phase, lines.slice(-160)]),
        ),
        wrangler_process_events: Object.fromEntries(
          Object.entries(runtimeMonitors).map(([phase, monitor]) => [phase, monitor.events]),
        ),
        temporary_root: temporaryRoot,
        wrangler_log_paths: {
          bulk_cas: bulkWranglerLogPath,
          export_transfer: exportWranglerLogPath,
          queue_e2e: queueWranglerLogPath,
        },
      };
    }
    await persistResult(result);

    console.table(result.scenarios.map((scenario) => ({
      scenario: scenario.name,
      requests: scenario.requests,
      concurrency: scenario.concurrency,
      rps: scenario.throughput_rps,
      p50_ms: scenario.latency_ms.p50,
      p95_ms: scenario.latency_ms.p95,
      p99_ms: scenario.latency_ms.p99,
      avg_bytes: scenario.response_bytes.average,
      errors: scenario.operational_error_rate,
      statuses: JSON.stringify(scenario.status_counts),
    })));
    console.log(`Result: ${outputPath}`);
    console.log(`Passed: ${result.passed}`);
    if (!result.passed) process.exitCode = 1;
  } catch (caughtError) {
    const terminal = runtime?.firstTerminal();
    const error = terminal && caughtError?.name !== "WranglerProcessError"
      ? wranglerProcessError(runtime, terminal, "load_gate")
      : caughtError;
    result.passed = false;
    result.failure = {
      ...errorDetails(error),
      poll_diagnostics: error && typeof error === "object"
        ? error.pollDiagnostics || null
        : null,
    };
    result.diagnostics = {
      wrangler_output_tail: Object.fromEntries(
        Object.entries(runtimeOutput).map(([phase, lines]) => [phase, lines.slice(-160)]),
      ),
      wrangler_process_events: Object.fromEntries(
        Object.entries(runtimeMonitors).map(([phase, monitor]) => [phase, monitor.events]),
      ),
      temporary_root: temporaryRoot,
      wrangler_log_paths: {
        bulk_cas: bulkWranglerLogPath,
        export_transfer: exportWranglerLogPath,
        queue_e2e: queueWranglerLogPath,
      },
    };
    try {
      await persistResult(result);
    } catch (persistError) {
      console.error(`Could not persist failed load result: ${errorDetails(persistError).message}`);
    }
    if (outputLines.length) {
      console.error(`Wrangler output tail:\n${outputLines.slice(-160).join("\n")}`);
    }
    throw error;
  } finally {
    localHttpAgent.destroy();
    if (child) await stopProcess(child);
    if (keepTemporary || result.passed === false) {
      console.warn(`Temporary load-test data retained for diagnostics: ${temporaryRoot}`);
    } else {
      try {
        await rm(temporaryRoot, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 250,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`Temporary load-test cleanup deferred: ${detail}`);
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

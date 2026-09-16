import * as XLSX from "xlsx";
import { env } from "cloudflare:workers";
import {
  createSession,
  currentUser,
  hashPassword,
  revokeSession,
  verifyPassword,
} from "@/lib/auth";
import {
  database,
  ensureSchema,
  getActiveResearchCounts,
  getLatestConcept,
  getRun,
  getRunByRequestKey,
  getRunConceptGate,
  getRunStatus,
  listArchivedRuns,
  listRuns,
  RUN_LIST_DEFAULT_LIMIT,
  RUN_LIST_MAX_LIMIT,
  SchemaInitializationInProgressError,
  type AppUser,
  type RunConceptGateRecord,
  type RunRecord,
} from "@/lib/database";
import {
  categoryLabel,
  generateResearchPlan,
  reportToMarkdown,
} from "@/lib/report";
import {
  assertReportIntegrity,
  finalizeReportForPersistence,
  ReportIntegrityError,
  REPORT_INTEGRITY_CONTRACT_VERSION,
  reportForDiagnosticDelivery,
} from "@/lib/report-integrity";
import {
  boardReportSeedForSlug,
  REVIEWABLE_DECISION_READINESS,
  VERIFIED_EVIDENCE_MODE,
} from "@/lib/board-reports";
import {
  modelProviderStatus,
  testModelProviders,
} from "@/lib/llm";
import {
  CONCEPT_SCENE_SUITE_SLOTS,
  conceptArchiveQueueConfigured,
  conceptAsset,
  conceptAssetForAdoption,
  conceptForClient,
  confirmProductConcept,
  lovartProviderStatus,
  productImageStorageConfigured,
  startProductConcept,
  syncProductConcept,
  testLovartProvider,
} from "@/lib/lovart";
import {
  mergeAndEncryptSecretSettings,
  readSecretSettings,
  SecretSettingsCryptoError,
  settingsForClient,
} from "@/lib/settings";
import {
  consumeSlidingWindow,
  rateLimitBucket,
  type SlidingWindowRule,
} from "@/lib/rate-limit";
import { consumeEdgeRateLimit } from "@/lib/edge-rate-limit";
import {
  acquireDecisionLease,
  decisionCoordinatorConfigured,
} from "@/lib/decision-admission";
import {
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "@/lib/request-body";
import {
  validateXlsxArchive,
  XlsxArchiveValidationError,
} from "@/lib/xlsx-archive";
import {
  KeepaMoreExportImportError,
  parseKeepaMoreExport,
} from "@/lib/keepamore-export-import";
import { KEEPAMORE_ADAPTER_ID } from "@/lib/keepamore";
import {
  buildKeepaMoreReferenceReport,
  keepaMoreProductToEvidence,
  type KeepaMoreResearchDataset,
} from "@/lib/keepamore-report";
import { buildResearchDataAdapterRegistry } from "@/lib/research-data-adapters";
import { evaluateHealthReadiness } from "@/lib/health-readiness";
import {
  enqueueResearchJob,
  MAX_ACTIVE_RESEARCH_PER_TENANT,
  researchQueueConfigured,
} from "@/lib/research-queue";
import {
  paidProviderCallsEnabled,
  tenantPlanAllowsPaidProviders,
} from "@/lib/provider-access";
import {
  ADMIN_USER_DEFAULT_LIMIT,
  ADMIN_USER_MAX_LIMIT,
  applyCreditAdjustment,
  createManagedUser,
  CreditDomainError,
  CREDIT_LEDGER_DEFAULT_LIMIT,
  CREDIT_LEDGER_MAX_LIMIT,
  debitCreditsForRule,
  getManagedUser,
  getMyCredits,
  listCreditRules,
  listManagedUsers,
  listUserCreditLedger,
  refundCreditTransaction,
  setManagedUserStatus,
  updateCreditRule,
} from "@/lib/credits";

export const dynamic = "force-dynamic";

const DUMMY_PASSWORD_HASH =
  "pbkdf2$100000$9ad533237271206e91c13a95f0124b5d$5cbb7b16bcfef3389866383484f493d5d0f00c762d3614bf25c507910e74d9af";
const activeDecisionMutations = new Set<string>();
const MAX_ACTIVE_RESEARCH_GLOBAL = 32;
const runtimeEnv = env as unknown as {
  SETTINGS_ENCRYPTION_KEY?: string;
};

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers: HeadersInit = {},
  ) {
    super(message);
  }
}

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("cache-control")) responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  return Response.json(data, { status, headers: responseHeaders });
}

function text(data: string, contentType: string, filename: string): Response {
  const body = new TextEncoder().encode(data);
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(body.byteLength),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function bodyJson(request: Request, maxBytes = 256_000): Promise<Record<string, unknown>> {
  const mediaType = String(request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApiError("请求 Content-Type 必须为 application/json", 415);
  }
  try {
    const raw = await readBoundedRequestText(request, maxBytes);
    if (!raw) return {};
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApiError("请求格式无效", 400);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof RequestBodyTooLargeError) throw new ApiError("请求内容过大", 413);
    throw new ApiError("请求 JSON 无效", 400);
  }
}

function boundedText(value: unknown, field: string, maxLength: number, required = false): string {
  const textValue = String(value ?? "").trim();
  if (required && !textValue) throw new ApiError(`${field}不能为空`, 400);
  if (textValue.length > maxLength) throw new ApiError(`${field}不能超过 ${maxLength} 个字符`, 400);
  return textValue;
}

function runFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "研究执行失败");
  return message.trim().slice(0, 1_000) || "研究执行失败";
}

async function persistRunFailure(
  runId: number,
  tenantId: number,
  message: string,
  clearOutput = false,
): Promise<void> {
  const now = Date.now() / 1000;
  const outputReset = clearOutput ? ", report = NULL, verdict = NULL" : "";
  await database()
    .prepare(`UPDATE runs SET status = 'failed', error_message = ?, failed_at = ?,
      updated_at = ?${outputReset} WHERE id = ? AND tenant_id = ?
        AND status IN ('await_clarify', 'failed') AND deleted_at IS NULL`)
    .bind(message.slice(0, 1_000), now, now, runId, tenantId)
    .run();
}

function trustedClientIp(request: Request): string {
  const value = String(request.headers.get("cf-connecting-ip") || "unknown").trim().toLowerCase();
  return value.slice(0, 128) || "unknown";
}

async function enforceSlidingWindow(rules: SlidingWindowRule[], message: string): Promise<void> {
  const result = await consumeSlidingWindow(database(), rules);
  if (!result.allowed) {
    throw new ApiError(message, 429, {
      "retry-after": String(result.retryAfterSeconds),
    });
  }
}

async function enforceEdgeWindow(binding: string, key: string, message: string): Promise<void> {
  if (!(await consumeEdgeRateLimit(binding, key))) {
    throw new ApiError(message, 429, { "retry-after": "60" });
  }
}

async function enforceRegistrationLimit(request: Request): Promise<void> {
  const ipBucket = await rateLimitBucket("register:ip", trustedClientIp(request));
  await enforceEdgeWindow("REGISTER_RATE_LIMIT", ipBucket, "注册请求过多，请稍后再试");
  await enforceSlidingWindow([
    { bucket: ipBucket, limit: 5, windowSeconds: 60 * 60 },
    { bucket: "register:global", limit: 100, windowSeconds: 24 * 60 * 60 },
  ], "注册请求过多，请稍后再试");
}

async function enforceLoginRequestLimit(request: Request, email: string): Promise<void> {
  const ip = trustedClientIp(request);
  const [ipBucket, pairBucket] = await Promise.all([
    rateLimitBucket("login:ip", ip),
    rateLimitBucket("login:account-ip-request", `${email}\0${ip}`),
  ]);
  await enforceEdgeWindow("LOGIN_RATE_LIMIT", ipBucket, "登录尝试过多，请稍后重试");
  await enforceSlidingWindow([
    { bucket: ipBucket, limit: 50, windowSeconds: 15 * 60 },
    { bucket: pairBucket, limit: 20, windowSeconds: 15 * 60 },
    { bucket: "login:global-request", limit: 500, windowSeconds: 15 * 60 },
  ], "登录尝试过多，请稍后重试");
}

async function enforceLoginFailureLimit(request: Request, email: string): Promise<void> {
  const ip = trustedClientIp(request);
  const [accountBucket, pairBucket] = await Promise.all([
    rateLimitBucket("login:account", email),
    rateLimitBucket("login:account-ip", `${email}\0${ip}`),
  ]);
  await enforceSlidingWindow([
    { bucket: accountBucket, limit: 10, windowSeconds: 15 * 60 },
    { bucket: pairBucket, limit: 5, windowSeconds: 15 * 60 },
  ], "登录尝试过多，请稍后重试");
}

function settingsEncryptionConfigured(): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(String(runtimeEnv.SETTINGS_ENCRYPTION_KEY || ""));
}

function settingsEncryptionKey(): string {
  if (!settingsEncryptionConfigured()) {
    throw new ApiError("数据源凭证安全存储暂不可用", 503, { "retry-after": "30" });
  }
  return String(runtimeEnv.SETTINGS_ENCRYPTION_KEY);
}

async function enforceProviderTestLimit(user: AppUser): Promise<void> {
  const userKey = `${user.tenant_id}:${user.id}`;
  const [minuteBucket, dayBucket] = await Promise.all([
    rateLimitBucket("providers-test:user-minute", userKey),
    rateLimitBucket("providers-test:user-day", userKey),
  ]);
  await enforceEdgeWindow("PROVIDER_RATE_LIMIT", minuteBucket, "模型连接测试过于频繁，请稍后再试");
  await enforceSlidingWindow([
    { bucket: minuteBucket, limit: 1, windowSeconds: 60 },
    { bucket: dayBucket, limit: 10, windowSeconds: 24 * 60 * 60 },
    { bucket: "providers-test:global-day", limit: 100, windowSeconds: 24 * 60 * 60 },
  ], "模型连接测试过于频繁，请稍后再试");
}

async function enforceResearchExecutionLimit(user: AppUser): Promise<void> {
  const userKey = `${user.tenant_id}:${user.id}`;
  const [minuteBucket, dayBucket, tenantBucket] = await Promise.all([
    rateLimitBucket("research:user-minute", userKey),
    rateLimitBucket("research:user-day", userKey),
    rateLimitBucket("research:tenant-day", String(user.tenant_id)),
  ]);
  await enforceEdgeWindow("RESEARCH_RATE_LIMIT", minuteBucket, "研究任务提交过于频繁，请稍后再试");
  await enforceSlidingWindow([
    { bucket: minuteBucket, limit: 2, windowSeconds: 60 },
    { bucket: dayBucket, limit: 30, windowSeconds: 24 * 60 * 60 },
    { bucket: tenantBucket, limit: 60, windowSeconds: 24 * 60 * 60 },
    { bucket: "research:global-day", limit: 500, windowSeconds: 24 * 60 * 60 },
  ], "研究任务提交过于频繁，请稍后再试");
}

async function enforceConceptGenerationLimit(user: AppUser): Promise<void> {
  const userKey = `${user.tenant_id}:${user.id}`;
  const [minuteBucket, dayBucket, tenantBucket] = await Promise.all([
    rateLimitBucket("concept:user-minute", userKey),
    rateLimitBucket("concept:user-day", userKey),
    rateLimitBucket("concept:tenant-day", String(user.tenant_id)),
  ]);
  await enforceEdgeWindow("CONCEPT_RATE_LIMIT", minuteBucket, "概念图任务提交过于频繁，请稍后再试");
  await enforceSlidingWindow([
    { bucket: minuteBucket, limit: 1, windowSeconds: 60 },
    { bucket: dayBucket, limit: 10, windowSeconds: 24 * 60 * 60 },
    { bucket: tenantBucket, limit: 20, windowSeconds: 24 * 60 * 60 },
    { bucket: "concept:global-day", limit: 100, windowSeconds: 24 * 60 * 60 },
  ], "概念图任务提交过于频繁，请稍后再试");
}

async function withDecisionMutationAdmission<T>(
  user: AppUser,
  runId: number,
  operation: () => Promise<T>,
): Promise<T> {
  requireAdmin(user);
  const mutationKey = `${user.tenant_id}:${runId}`;
  const userEdgeKey = await rateLimitBucket(
    "decision:user",
    `${user.tenant_id}:${user.id}`,
  );
  await enforceEdgeWindow(
    "DECISION_RATE_LIMIT",
    userEdgeKey,
    "决策变更过于频繁，请稍后重试",
  );
  if (!await getRunStatus(runId, user.tenant_id)) {
    throw new ApiError("运行不存在", 404);
  }
  const edgeKey = await rateLimitBucket("decision:run", mutationKey);
  await enforceEdgeWindow(
    "DECISION_RATE_LIMIT",
    edgeKey,
    "同一研究的决策变更过于频繁，请稍后重试",
  );
  if (activeDecisionMutations.has(mutationKey)) {
    throw new ApiError(
      "同一研究正在处理决策变更，请稍后重试",
      429,
      { "retry-after": "1" },
    );
  }
  let lease: Awaited<ReturnType<typeof acquireDecisionLease>>;
  try {
    lease = await acquireDecisionLease(mutationKey);
  } catch (error) {
    console.error("decision coordinator acquire failed", error);
    throw new ApiError(
      "决策写入协调服务暂不可用，请稍后重试",
      503,
      { "retry-after": "2" },
    );
  }
  if (!lease.acquired) {
    throw new ApiError(
      "同一研究正在处理决策变更，请稍后重试",
      429,
      { "retry-after": String(lease.retryAfterSeconds) },
    );
  }
  activeDecisionMutations.add(mutationKey);
  try {
    return await operation();
  } finally {
    activeDecisionMutations.delete(mutationKey);
    try {
      await lease.release();
    } catch (error) {
      console.error("decision coordinator release failed", error);
    }
  }
}

function requireAdmin(user: AppUser): void {
  if (user.role !== "admin") throw new ApiError("仅工作区管理员可执行此操作", 403);
}

function requirePaidProviderAccess(user: AppUser): void {
  if (!tenantPlanAllowsPaidProviders(user.plan)) {
    throw new ApiError("当前试用工作区未开通付费模型与概念图调用", 403);
  }
  if (!paidProviderCallsEnabled()) {
    throw new ApiError("付费供应商调用已由系统暂停", 503, { "retry-after": "60" });
  }
}

function requireProductImageStorage(): void {
  if (!productImageStorageConfigured()) {
    throw new ApiError(
      "概念图永久存储尚未开通，当前暂停生成，避免产生无法归档的付费结果",
      503,
      { "retry-after": "3600" },
    );
  }
}

function validateRunInput(body: Record<string, unknown>) {
  const mode = String(body.mode || "category_keyword");
  if (!["category_keyword", "asin_list"].includes(mode)) throw new ApiError("输入方式无效", 400);
  let payload: string | string[];
  if (mode === "asin_list") {
    if (!Array.isArray(body.payload)) throw new ApiError("ASIN 列表格式无效", 400);
    payload = Array.from(new Set(body.payload.map((item: unknown) => String(item).trim().toUpperCase())))
      .filter(Boolean);
    if (!payload.length || payload.length > 50) throw new ApiError("请输入 1–50 个 ASIN", 400);
    const invalid = payload.find((asin) => !/^[A-Z0-9]{10}$/.test(asin));
    if (invalid) throw new ApiError(`ASIN 格式无效：${invalid}`, 400);
  } else {
    payload = boundedText(body.payload, "品类关键词", 160, true);
  }
  const marketplace = String(body.marketplace || "US").toUpperCase();
  const allowedMarkets = ["US", "UK", "DE", "FR", "IT", "ES", "JP", "CA", "MX", "AU"];
  if (!allowedMarkets.includes(marketplace)) throw new ApiError("目标站点无效", 400);
  const viewProfile = String(body.view_profile || "P1").toUpperCase();
  if (!["P1", "P4"].includes(viewProfile)) throw new ApiError("交付视图无效", 400);
  const dataScope = String(body.data_scope || "public_ok");
  if (!["public_ok", "private_only"].includes(dataScope)) throw new ApiError("数据范围无效", 400);
  const brief = body.brief && typeof body.brief === "object" && !Array.isArray(body.brief)
    ? body.brief as Record<string, unknown>
    : {};
  return { mode, payload, marketplace, viewProfile, dataScope, brief };
}

async function changePassword(request: Request, user: AppUser): Promise<Response> {
  const body = await bodyJson(request, 16_000);
  const currentPassword = String(body.current_password || "");
  const newPassword = String(body.new_password || "");
  if (newPassword.length < 8 || newPassword.length > 128) {
    throw new ApiError("新密码需要 8–128 位", 400);
  }
  const row = await database()
    .prepare("SELECT pw_hash FROM users WHERE id = ? AND tenant_id = ?")
    .bind(user.id, user.tenant_id)
    .first<{ pw_hash: string }>();
  if (!row || !(await verifyPassword(currentPassword, row.pw_hash))) {
    throw new ApiError("当前密码不正确", 401);
  }
  const passwordHash = await hashPassword(newPassword);
  const db = database();
  const results = await db.batch([
    db.prepare(`UPDATE users SET pw_hash = ?
      WHERE id = ? AND tenant_id = ? AND pw_hash = ?`)
      .bind(passwordHash, user.id, user.tenant_id, row.pw_hash),
    db.prepare(`DELETE FROM sessions WHERE user_id = ?
      AND EXISTS (
        SELECT 1 FROM users WHERE id = ? AND tenant_id = ? AND pw_hash = ?
      )`).bind(user.id, user.id, user.tenant_id, passwordHash),
  ]);
  if (Number(results[0]?.meta.changes || 0) !== 1) {
    throw new ApiError("密码已被其他会话修改，请重新登录后再试", 409);
  }
  const token = await createSession(user.id, user.tenant_id);
  return json({ token, user });
}

function parseContentLength(request: Request): number {
  const value = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(value) ? value : 0;
}

function ensureRunCanExecute(run: RunRecord): void {
  if (run.status === "queued") throw new ApiError("研究已进入队列，请勿重复提交", 409);
  if (run.status === "executing") throw new ApiError("研究正在执行，请勿重复提交", 409);
  if (run.status === "done" && run.report) throw new ApiError("研究已经完成", 409);
  if (!["await_clarify", "failed"].includes(run.status)) {
    throw new ApiError("当前研究状态无法执行", 409);
  }
}

function confirmRunStatus(run: RunRecord): {
  id: number;
  status: string;
  updated_at: number;
  has_report: number;
} {
  return {
    id: run.id,
    status: run.status,
    updated_at: run.updated_at,
    has_report: run.report == null ? 0 : 1,
  };
}

async function compensateAcceptedCredit(
  charge: Awaited<ReturnType<typeof debitCreditsForRule>>,
  user: AppUser,
  reason: string,
): Promise<void> {
  if (!charge.charged || !charge.transaction) return;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await refundCreditTransaction({
        tenantId: user.tenant_id,
        actorUserId: user.id,
        transaction: charge.transaction,
        reason,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  console.error("credit compensation failed", lastError);
  throw new ApiError("业务受理失败且积分自动退回暂未完成，请联系管理员核对流水", 503);
}

function runConceptBlockReason(
  run: Pick<RunRecord, "data_scope" | "evidence_mode" | "decision_readiness"> | RunConceptGateRecord,
): string {
  if (run.data_scope === "private_only") {
    return "私有数据模式禁止向 Lovart 发送研究内容；请先启用经批准的私有设计适配器。";
  }
  if (["template_demo", "synthetic_fixture"].includes(String(run.evidence_mode))) {
    return "当前报告为框架演示，不含可验证的真实市场证据，禁止启动 Lovart 概念图。";
  }
  if (run.decision_readiness === "insufficient_evidence") {
    return "当前报告包含部分实证，但关键 VOC、需求、单位经济或工程证据尚未齐备，暂不启动 Lovart 概念图。";
  }
  if (
    run.evidence_mode !== VERIFIED_EVIDENCE_MODE ||
    run.decision_readiness !== REVIEWABLE_DECISION_READINESS
  ) {
    return "报告证据状态未达到概念设计标准，禁止向 Lovart 发送研究内容。";
  }
  return "";
}

function requireReportReadyForDecision(report: unknown): void {
  try {
    assertReportIntegrity(report);
  } catch (error) {
    if (error instanceof ReportIntegrityError) {
      throw new ApiError(error.message, 409);
    }
    throw error;
  }
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    (report as Record<string, unknown>).evidence_mode !== VERIFIED_EVIDENCE_MODE ||
    (report as Record<string, unknown>).decision_readiness !== REVIEWABLE_DECISION_READINESS
  ) {
    throw new ApiError(
      "报告证据尚未达到人工终审与正式导出标准；仅已验证且明确可审阅的研究报告可以继续。",
      409,
    );
  }
}

function runForDiagnosticDelivery(run: RunRecord | null): RunRecord | null {
  if (!run || run.report == null) return run;
  return {
    ...run,
    report: reportForDiagnosticDelivery(run.report),
  };
}

type ReviewChecks = {
  evidence: true;
  economics: true;
  risk: true;
};

function requireCompletedReviewChecks(value: unknown): ReviewChecks {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("审核前必须提交完整的终审检查记录", 400);
  }
  const checks = value as Record<string, unknown>;
  if (checks.evidence !== true || checks.economics !== true || checks.risk !== true) {
    throw new ApiError("证据边界、单位经济、风险与执行三项检查必须全部完成", 400);
  }
  return { evidence: true, economics: true, risk: true };
}

function hasCompleteSignedReview(run: RunRecord): boolean {
  const checks = run.review_checks;
  return Boolean(
    run.reviewed &&
    run.decision_outcome &&
    run.outcome_note &&
    run.reviewer_id &&
    run.reviewer_name &&
    run.reviewed_at &&
    checks?.evidence === true &&
    checks?.economics === true &&
    checks?.risk === true &&
    /^[a-f0-9]{64}$/i.test(String(run.review_report_hash || "")),
  );
}

async function sha256Json(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireUser(request: Request, tokenOverride = ""): Promise<AppUser> {
  const user = await currentUser(request, tokenOverride);
  if (!user) throw new ApiError("token 无效或过期", 401);
  return user;
}

function runIdFrom(path: string[]): number {
  const runId = Number(path[1]);
  if (!Number.isInteger(runId) || runId <= 0) throw new ApiError("运行编号无效", 400);
  return runId;
}

function runListPage(request: Request, archived = false): {
  limit: number;
  beforeId?: number;
  beforeDeletedAt?: number;
} {
  const search = new URL(request.url).searchParams;
  const rawLimit = search.get("limit");
  const limit = rawLimit == null ? RUN_LIST_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > RUN_LIST_MAX_LIMIT) {
    throw new ApiError(`列表 limit 必须为 1-${RUN_LIST_MAX_LIMIT} 的整数`, 400);
  }
  const rawCursor = String(search.get("cursor") || "").trim();
  if (!rawCursor) return { limit };
  if (!archived) {
    const beforeId = Number(rawCursor);
    if (!/^\d+$/.test(rawCursor) || !Number.isSafeInteger(beforeId) || beforeId <= 0) {
      throw new ApiError("列表 cursor 无效", 400);
    }
    return { limit, beforeId };
  }
  const match = rawCursor.match(/^(\d+(?:\.\d+)?):(\d+)$/);
  const beforeDeletedAt = Number(match?.[1]);
  const beforeId = Number(match?.[2]);
  if (
    !match || !Number.isFinite(beforeDeletedAt) || beforeDeletedAt <= 0 ||
    !Number.isSafeInteger(beforeId) || beforeId <= 0
  ) {
    throw new ApiError("归档列表 cursor 无效", 400);
  }
  return { limit, beforeId, beforeDeletedAt };
}

function paginatedRunList(
  rows: RunRecord[],
  limit: number,
  archived = false,
): Response {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  const nextCursor = hasMore && last
    ? archived ? `${Number(last.deleted_at)}:${last.id}` : String(last.id)
    : "";
  return json(items, 200, {
    "x-page-limit": String(limit),
    "x-has-more": hasMore ? "1" : "0",
    ...(nextCursor ? { "x-next-cursor": nextCursor } : {}),
  });
}

function runEntityTag(runId: number, updatedAt: number): string {
  return `W/"run-${runId}-${Math.round(updatedAt * 1_000)}-${REPORT_INTEGRITY_CONTRACT_VERSION}"`;
}

function conditionalNotModified(request: Request, etag: string): Response | null {
  const candidates = String(request.headers.get("if-none-match") || "")
    .split(",")
    .map((value) => value.trim());
  if (!candidates.includes("*") && !candidates.includes(etag)) return null;
  return new Response(null, {
    status: 304,
    headers: {
      etag,
      "cache-control": "private, no-cache, max-age=0",
      vary: "Authorization",
    },
  });
}

function runCacheHeaders(runId: number, updatedAt: number): HeadersInit {
  return {
    etag: runEntityTag(runId, updatedAt),
    "cache-control": "private, no-cache, max-age=0",
    vary: "Authorization",
  };
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function idempotencyKey(request: Request, operation: string): string | null {
  const value = String(request.headers.get("idempotency-key") || "").trim();
  if (!value) return null;
  if (value.length < 8 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ApiError("Idempotency-Key 格式无效", 400);
  }
  return `${operation}:${value}`;
}

async function register(request: Request): Promise<Response> {
  await enforceRegistrationLimit(request);
  const body = await bodyJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ApiError("请输入有效邮箱", 400);
  }
  if (password.length < 8 || password.length > 128) throw new ApiError("密码需要 8–128 位", 400);
  const existing = await database()
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first();
  if (existing) throw new ApiError("该邮箱已注册", 400);

  const organization = boundedText(body.org || email.split("@")[0], "公司 / 团队", 100, true);
  const name = boundedText(body.name || email.split("@")[0], "姓名", 80, true);
  const passwordHash = await hashPassword(password);
  const now = Date.now() / 1000;
  const tenantResult = await database()
    .prepare("INSERT INTO tenants(name, created_at) VALUES(?, ?)")
    .bind(organization, now)
    .run();
  const tenantId = Number(tenantResult.meta.last_row_id);
  let userResult;
  try {
    userResult = await database()
      .prepare(`INSERT INTO users(
        tenant_id, email, pw_hash, name, role, created_at
      ) VALUES(?, ?, ?, ?, 'admin', ?)`)
      .bind(tenantId, email, passwordHash, name, now)
      .run();
  } catch (error) {
    await database().prepare("DELETE FROM tenants WHERE id = ?").bind(tenantId).run();
    const duplicate = await database()
      .prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first();
    if (duplicate) throw new ApiError("该邮箱已注册", 400);
    throw error;
  }
  const userId = Number(userResult.meta.last_row_id);
  const token = await createSession(userId, tenantId);
  return json({
    token,
    user: {
      id: userId,
      email,
      name,
      tenant_id: tenantId,
      role: "admin",
      status: "active",
      plan: "trial",
    },
  });
}

async function login(request: Request): Promise<Response> {
  const body = await bodyJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  await enforceLoginRequestLimit(request, email);
  const validInput = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    email.length <= 254 && password.length > 0 && password.length <= 128;
  const row = await database()
    .prepare(`SELECT u.id, u.tenant_id, u.email, u.pw_hash, COALESCE(u.name, '') AS name,
      COALESCE(u.role, 'member') AS role, COALESCE(u.status, 'active') AS status,
      COALESCE(t.plan, 'trial') AS plan
      FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.email = ?`)
    .bind(validInput ? email : "")
    .first<{
      id: number;
      tenant_id: number;
      email: string;
      pw_hash: string;
      name: string;
      role: string;
      status: string;
      plan: string;
    }>();
  const passwordValid = validInput &&
    await verifyPassword(password, row?.pw_hash || DUMMY_PASSWORD_HASH);
  if (!row || !passwordValid) {
    await enforceLoginFailureLimit(request, email.slice(0, 254));
    throw new ApiError("邮箱或密码错误", 401);
  }
  if (row.status !== "active") {
    throw new ApiError("账号已停用，请联系工作区管理员", 403);
  }
  const token = await createSession(row.id, row.tenant_id);
  return json({
    token,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      tenant_id: row.tenant_id,
      role: row.role,
      status: row.status,
      plan: row.plan,
    },
  });
}

async function createRun(request: Request, user: AppUser): Promise<Response> {
  const body = await bodyJson(request);
  const { mode, payload, marketplace, viewProfile, dataScope, brief } = validateRunInput(body);
  const plan = generateResearchPlan(mode, payload, marketplace, brief);
  const requestKey = idempotencyKey(request, "create-run");
  const now = Date.now() / 1000;
  const result = await database()
    .prepare(`INSERT OR IGNORE INTO runs(
      tenant_id, user_id, title, input_mode, input_payload, marketplace,
      view_profile, data_scope, status, research_plan, request_key, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'await_clarify', ?, ?, ?, ?)`)
    .bind(
      user.tenant_id,
      user.id,
      String(plan.category_scope),
      mode,
      JSON.stringify(payload),
      marketplace,
      viewProfile,
      dataScope,
      JSON.stringify(plan),
      requestKey,
      now,
      now,
    )
    .run();
  if (Number(result.meta.changes || 0) !== 1) {
    const existing = requestKey ? await getRunByRequestKey(user.tenant_id, requestKey) : null;
    if (existing) return json(existing);
    throw new ApiError("研究创建冲突，请刷新后重试", 409);
  }
  const run = await getRun(Number(result.meta.last_row_id), user.tenant_id);
  return json(run, 201);
}

async function confirmRun(request: Request, user: AppUser, runId: number): Promise<Response> {
  const run = await getRun(runId, user.tenant_id);
  if (!run) throw new ApiError("运行不存在", 404);
  // The Queue consumer charges run.user_id. Keep the HTTP confirmer and that
  // account identical; workspace/admin visibility does not authorize spending.
  if (run.user_id !== user.id) throw new ApiError("仅研究创建者本人可确认执行此任务", 403);
  if (run.data_scope === "private_only") {
    const message =
      "私有数据适配器尚未启用，本次研究已停止：系统不会混入公共样例，也不会把研究简报发送给外部模型或 Lovart。请接入私有数据源后重试。";
    await persistRunFailure(runId, user.tenant_id, message, true);
    throw new ApiError(message, 409);
  }
  if (run.status === "done" && run.report) return json(confirmRunStatus(run));
  if (["queued", "executing"].includes(run.status)) {
    return json(confirmRunStatus(run), 202, { "retry-after": "2" });
  }
  ensureRunCanExecute(run);
  if (!researchQueueConfigured()) {
    throw new ApiError("研究任务队列暂不可用，请稍后重试", 503, { "retry-after": "10" });
  }
  const body = await bodyJson(request);
  const plan = (body.research_plan || run.research_plan || {}) as Record<string, unknown>;
  const category = boundedText(
    plan.category_scope || categoryLabel(run.input_mode, run.input_payload),
    "研究品类",
    160,
    true,
  );
  await enforceResearchExecutionLimit(user);
  const now = Date.now() / 1000;
  const claimed = await database()
    .prepare(`UPDATE runs SET research_plan = ?, status = 'queued',
      error_message = NULL, failed_at = NULL, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND status IN ('await_clarify', 'failed')
        AND deleted_at IS NULL
        AND (
          SELECT COUNT(*) FROM runs AS active_run
          WHERE active_run.tenant_id = ? AND active_run.status IN ('queued', 'executing')
            AND active_run.deleted_at IS NULL
        ) < ?
        AND (
          SELECT COUNT(*) FROM runs AS global_active_run
          WHERE global_active_run.status IN ('queued', 'executing')
            AND global_active_run.deleted_at IS NULL
        ) < ?`)
    .bind(
      JSON.stringify({ ...plan, category_scope: category }),
      now,
      runId,
      user.tenant_id,
      user.tenant_id,
      MAX_ACTIVE_RESEARCH_PER_TENANT,
      MAX_ACTIVE_RESEARCH_GLOBAL,
    )
    .run();
  if (!Number(claimed.meta.changes || 0)) {
    const latest = await getRun(runId, user.tenant_id);
    if (latest && ["queued", "executing"].includes(latest.status)) {
      return json(confirmRunStatus(latest), 202, { "retry-after": "2" });
    }
    const active = await getActiveResearchCounts(user.tenant_id);
    if (active.tenant_active >= MAX_ACTIVE_RESEARCH_PER_TENANT) {
      throw new ApiError(
        `当前工作区同时最多执行 ${MAX_ACTIVE_RESEARCH_PER_TENANT} 个研究任务，请稍后再试`,
        429,
        { "retry-after": "10" },
      );
    }
    if (active.global_active >= MAX_ACTIVE_RESEARCH_GLOBAL) {
      throw new ApiError(
        `系统研究队列当前已达到 ${MAX_ACTIVE_RESEARCH_GLOBAL} 个活跃任务，请稍后再试`,
        429,
        { "retry-after": "45" },
      );
    }
    throw new ApiError("研究状态已变化，请刷新后重试", 409);
  }
  try {
    await debitCreditsForRule({
      tenantId: user.tenant_id,
      userId: user.id,
      ruleKey: "research_generation",
      businessId: `research:${runId}:${Math.round(now * 1_000)}`,
    });
  } catch (error) {
    await database()
      .prepare(`UPDATE runs SET status = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = 'queued'
          AND updated_at = ? AND deleted_at IS NULL`)
      .bind(run.status, Date.now() / 1000, runId, user.tenant_id, now)
      .run();
    throw error;
  }
  try {
    await enqueueResearchJob({ runId, tenantId: user.tenant_id, claimedAt: now });
    return json({
      id: runId,
      status: "queued",
      updated_at: now,
      has_report: run.report == null ? 0 : 1,
    }, 202, { "retry-after": "2" });
  } catch (error) {
    console.error(JSON.stringify({
      event: "research_queue_submission",
      outcome: "deferred_to_reconciliation",
      run_id: runId,
      tenant_id: user.tenant_id,
      error: runFailureMessage(error),
    }));
    return json({
      id: runId,
      status: "queued",
      updated_at: now,
      has_report: run.report == null ? 0 : 1,
    }, 202, { "retry-after": "5" });
  }
}

async function patchRun(request: Request, user: AppUser, runId: number): Promise<Response> {
  requireAdmin(user);
  const existing = await getRun(runId, user.tenant_id);
  if (!existing) throw new ApiError("运行不存在", 404);
  if (["queued", "executing"].includes(existing.status)) {
    throw new ApiError("研究正在排队或执行，完成后才能编辑，避免中断 Agent 任务", 409);
  }
  const body = await bodyJson(request);
  if (
    "decision_outcome" in body ||
    "outcome_note" in body ||
    body.reviewed === true
  ) {
    requireReportReadyForDecision(existing.report);
  }
  if (
    existing.reviewed &&
    ("decision_outcome" in body || "outcome_note" in body) &&
    body.reviewed !== false
  ) {
    throw new ApiError("已签核记录不可直接修改，请由管理员先取消审核", 409);
  }
  const mapping: Record<string, string> = {
    title: "title",
    decision_outcome: "decision_outcome",
    outcome_note: "outcome_note",
  };
  const assignments: string[] = [];
  const values: unknown[] = [];
  let reviewEvent: {
    action: "signed" | "revoked";
    outcome: string;
    note: string;
    checks: ReviewChecks | null;
    reportHash: string;
    reportVersion: string;
    createdAt: number;
  } | null = null;
  for (const [key, column] of Object.entries(mapping)) {
    if (!(key in body) || body[key] == null) continue;
    assignments.push(`${column} = ?`);
    if (key === "title") {
      values.push(boundedText(body[key], "研究标题", 160, true));
    } else if (key === "decision_outcome") {
      const outcome = boundedText(body[key], "决策结果", 20);
      if (!["进入", "有条件", "放弃", "观望"].includes(outcome)) {
        throw new ApiError("决策结果无效", 400);
      }
      values.push(outcome);
    } else {
      values.push(boundedText(body[key], "决策备注", 2_000));
    }
  }
  if ("reviewed" in body) {
    if (typeof body.reviewed !== "boolean") throw new ApiError("审核状态必须为布尔值", 400);
    const reviewed = body.reviewed;
    if (reviewed) {
      if (existing.reviewed) {
        throw new ApiError("报告已经签核；如需重新签核，请先撤销原签核并填写原因", 409);
      }
      const outcome = "decision_outcome" in body
        ? String(body.decision_outcome || "").trim()
        : String(existing.decision_outcome || "").trim();
      const note = "outcome_note" in body
        ? String(body.outcome_note || "").trim()
        : String(existing.outcome_note || "").trim();
      if (!["进入", "有条件", "放弃", "观望"].includes(outcome)) {
        throw new ApiError("审核前必须填写有效的决策结果", 400);
      }
      if (!note) throw new ApiError("审核前必须填写非空的决策备注", 400);
      const checks = requireCompletedReviewChecks(body.review_checks);
      const reviewedAt = Date.now() / 1000;
      const reportHash = await sha256Json(existing.report);
      const reportVersion = String(existing.report?.report_version || existing.report?.schema_version || "unknown");
      const expectedReportHash = boundedText(body.expected_report_hash, "终审报告哈希", 64);
      const expectedReportVersion = boundedText(body.expected_report_version, "终审报告版本", 160);
      if (!/^[a-f0-9]{64}$/i.test(expectedReportHash)) {
        throw new ApiError("终审必须携带当前可见报告的 SHA-256", 400);
      }
      if (expectedReportHash !== reportHash || expectedReportVersion !== reportVersion) {
        throw new ApiError("报告内容或版本已变化，请刷新并重新完成终审", 409);
      }
      assignments.push(
        "reviewed = ?",
        "reviewer_id = ?",
        "reviewer_name = ?",
        "reviewed_at = ?",
        "review_checks = ?",
        "review_report_hash = ?",
      );
      values.push(1, user.id, user.name, reviewedAt, JSON.stringify(checks), reportHash);
      reviewEvent = {
        action: "signed",
        outcome,
        note,
        checks,
        reportHash,
        reportVersion,
        createdAt: reviewedAt,
      };
    } else {
      if (!existing.reviewed) throw new ApiError("报告当前未签核，无需撤销", 409);
      const reason = boundedText(body.review_reason, "撤销签核原因", 2_000);
      if (!reason) throw new ApiError("撤销签核必须填写原因", 400);
      const revokedAt = Date.now() / 1000;
      assignments.push(
        "reviewed = 0",
        "reviewer_id = NULL",
        "reviewer_name = NULL",
        "reviewed_at = NULL",
        "review_checks = NULL",
        "review_report_hash = NULL",
      );
      reviewEvent = {
        action: "revoked",
        outcome: String(existing.decision_outcome || ""),
        note: reason,
        checks: existing.review_checks as ReviewChecks | null,
        reportHash: String(existing.review_report_hash || await sha256Json(existing.report)),
        reportVersion: String(existing.report?.report_version || existing.report?.schema_version || "unknown"),
        createdAt: revokedAt,
      };
    }
  }
  if (assignments.length) {
    const updatedAt = Date.now() / 1000;
    const mutationToken = crypto.randomUUID();
    const expectedReviewed = existing.reviewed ? 1 : 0;
    assignments.push("updated_at = ?", "mutation_token = ?");
    values.push(updatedAt, mutationToken, runId, user.tenant_id, expectedReviewed, existing.updated_at);
    const db = database();
    const updateStatement = db
      .prepare(`UPDATE runs SET ${assignments.join(", ")}
        WHERE id = ? AND tenant_id = ? AND reviewed = ?
          AND updated_at = ? AND deleted_at IS NULL`)
      .bind(...values);
    if (reviewEvent) {
      const postReviewState = reviewEvent.action === "signed" ? 1 : 0;
      const eventStatement = db
        .prepare(`INSERT INTO review_events(
          run_id, tenant_id, reviewer_id, reviewer_name, action,
          decision_outcome, outcome_note, review_checks, report_hash,
          report_version, created_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM runs
            WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
              AND updated_at = ? AND reviewed = ? AND mutation_token = ?
          )`)
        .bind(
          runId,
          user.tenant_id,
          user.id,
          user.name,
          reviewEvent.action,
          reviewEvent.outcome || null,
          reviewEvent.note || null,
          reviewEvent.checks ? JSON.stringify(reviewEvent.checks) : null,
          reviewEvent.reportHash || null,
          reviewEvent.reportVersion || null,
          reviewEvent.createdAt,
          runId,
          user.tenant_id,
          updatedAt,
          postReviewState,
          mutationToken,
        );
      const results = await db.batch([updateStatement, eventStatement]);
      if (Number(results[0]?.meta.changes || 0) !== 1 || Number(results[1]?.meta.changes || 0) !== 1) {
        throw new ApiError("研究状态已变化，请刷新后重试", 409);
      }
    } else {
      const result = await updateStatement.run();
      if (Number(result.meta.changes || 0) !== 1) {
        throw new ApiError("研究状态已变化，请刷新后重试", 409);
      }
    }
  }
  return json(await getRun(runId, user.tenant_id));
}

async function rerun(request: Request, user: AppUser, runId: number): Promise<Response> {
  requireAdmin(user);
  const run = await getRun(runId, user.tenant_id);
  if (!run) throw new ApiError("运行不存在", 404);
  if (run.reviewed) throw new ApiError("已签核报告不可直接重跑，请先撤销签核并记录原因", 409);
  if (run.input_mode === "board_research_2026") {
    const inputPayload = run.input_payload && typeof run.input_payload === "object" && !Array.isArray(run.input_payload)
      ? run.input_payload as Record<string, unknown>
      : {};
    const seed = boardReportSeedForSlug(inputPayload.slug);
    if (!seed) {
      throw new ApiError("董事会报告种子不存在，无法按当前框架重跑", 409);
    }
    const now = Date.now() / 1000;
    const refreshed = await database()
      .prepare(`UPDATE runs SET input_payload = ?, status = 'done', verdict = ?,
        research_plan = ?, report = ?, decision_outcome = NULL, outcome_note = NULL,
        reviewed = 0, reviewer_id = NULL,
        reviewer_name = NULL, reviewed_at = NULL, review_checks = NULL,
        review_report_hash = NULL, error_message = NULL, failed_at = NULL, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND input_mode = 'board_research_2026'
          AND reviewed = 0 AND updated_at = ? AND deleted_at IS NULL`)
      .bind(
        JSON.stringify({ slug: seed.slug, version: seed.version }),
        seed.verdict,
        JSON.stringify(seed.research_plan),
        JSON.stringify(seed.report),
        now,
        runId,
        user.tenant_id,
        run.updated_at,
      )
      .run();
    if (Number(refreshed.meta.changes || 0) !== 1) {
      throw new ApiError("研究状态已变化，请刷新后重试", 409);
    }
    return json(await getRun(runId, user.tenant_id));
  }
  const researchBrief = run.research_plan?.research_brief || {};
  const plan = generateResearchPlan(run.input_mode, run.input_payload, run.marketplace, researchBrief);
  const requestKey = idempotencyKey(request, `rerun-${runId}`);
  const now = Date.now() / 1000;
  const result = await database()
    .prepare(`INSERT OR IGNORE INTO runs(
      tenant_id, user_id, title, input_mode, input_payload, marketplace,
      view_profile, data_scope, status, research_plan, request_key, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'await_clarify', ?, ?, ?, ?)`)
    .bind(
      user.tenant_id,
      user.id,
      run.title,
      run.input_mode,
      JSON.stringify(run.input_payload),
      run.marketplace,
      run.view_profile,
      run.data_scope,
      JSON.stringify(plan),
      requestKey,
      now,
      now,
    )
    .run();
  if (Number(result.meta.changes || 0) !== 1) {
    const existing = requestKey ? await getRunByRequestKey(user.tenant_id, requestKey) : null;
    if (existing) return json(existing);
    throw new ApiError("重跑创建冲突，请刷新后重试", 409);
  }
  return json(await getRun(Number(result.meta.last_row_id), user.tenant_id), 201);
}

function reportOrThrow(run: RunRecord | null, requireDecisionReady = false): Record<string, unknown> {
  if (!run) throw new ApiError("运行不存在", 404);
  if (!run.report) throw new ApiError("报告尚未生成", 400);
  if (requireDecisionReady) requireReportReadyForDecision(run.report);
  return run.report;
}

type ExportExpectation = {
  edition: "review" | "signed" | null;
  reportHash: string;
  reportVersion: string;
};

function exportExpectation(request: Request): ExportExpectation {
  const params = new URL(request.url).searchParams;
  const editionValue = params.get("edition");
  if (editionValue && !["review", "signed"].includes(editionValue)) {
    throw new ApiError("导出版本必须为 review 或 signed", 400);
  }
  const reportHash = String(params.get("expected_report_hash") || "").trim();
  if (reportHash && !/^[a-f0-9]{64}$/i.test(reportHash)) {
    throw new ApiError("导出报告哈希无效", 400);
  }
  return {
    edition: editionValue as ExportExpectation["edition"],
    reportHash,
    reportVersion: String(params.get("expected_report_version") || "").trim(),
  };
}

async function reportForOfficialExport(
  run: RunRecord | null,
  expectation: ExportExpectation = { edition: null, reportHash: "", reportVersion: "" },
): Promise<Record<string, unknown>> {
  const report = reportOrThrow(run, true);
  if (!run) throw new ApiError("运行不存在", 404);
  const reviewed = hasCompleteSignedReview(run);
  const reportHash = await sha256Json(report);
  const reportVersion = String(report.report_version || report.schema_version || "unknown");
  const edition = reviewed ? "signed" : "review";
  if (reviewed && String(run.review_report_hash) !== reportHash) {
    throw new ApiError("报告内容在签核后发生变化，请撤销原签核并重新终审", 409);
  }
  if (expectation.edition && expectation.edition !== edition) {
    throw new ApiError(
      edition === "signed" ? "报告已完成签核，请刷新后导出签核版" : "报告签核状态已变化，请刷新后导出审阅稿",
      409,
    );
  }
  if (expectation.reportHash && expectation.reportHash !== reportHash) {
    throw new ApiError("报告内容已变化，请刷新后重新导出", 409);
  }
  if (expectation.reportVersion && expectation.reportVersion !== reportVersion) {
    throw new ApiError("报告版本已变化，请刷新后重新导出", 409);
  }
  return {
    ...report,
    ai_verdict: report.verdict || null,
    final_decision: reviewed ? {
      outcome: run.decision_outcome,
      note: run.outcome_note,
    } : null,
    decision_record: {
      status: reviewed ? "signed" : "pending_review",
      outcome: reviewed ? run.decision_outcome : null,
      note: reviewed ? run.outcome_note : null,
      checks: reviewed ? run.review_checks : null,
      reviewer_id: reviewed ? run.reviewer_id : null,
      reviewer_name: reviewed ? run.reviewer_name : null,
      reviewed_at: reviewed ? run.reviewed_at : null,
      export_edition: edition,
      report_version: reportVersion,
      report_sha256: reportHash,
      hash_scope: "report_without_decision_record",
      hash_canonicalization: "utf8-json-stringify-v1",
    },
  };
}

async function exportBrief(request: Request): Promise<Response> {
  const body = await bodyJson(request);
  const rows = (value: unknown): unknown[][] => {
    if (!Array.isArray(value) || value.length === 0) return [];
    return Array.isArray(value[0]) ? (value as unknown[][]) : [value];
  };
  const workbook = XLSX.utils.book_new();
  const mainSheet = XLSX.utils.aoa_to_sheet([
    ["键 key（勿修改）", "分区", "字段", "值（在此填写）", "填写说明 / 可选值"],
    ...rows(body.main),
  ]);
  mainSheet["!cols"] = [{ wch: 26 }, { wch: 14 }, { wch: 28 }, { wch: 30 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(workbook, mainSheet, "研究简报输入");

  const competitors = XLSX.utils.aoa_to_sheet([
    ...(Array.isArray(body.comps_cols) && body.comps_cols.length
      ? [body.comps_cols]
      : [["竞品ASIN", "售价$", "预估月销", "主打卖点", "备注"]]),
    ...rows(body.comps_rows),
    ...Array.from({ length: 5 }, () => ["", "", "", "", ""]),
  ]);
  competitors["!cols"] = Array.from({ length: 5 }, () => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(workbook, competitors, "竞品明细");

  const bands = XLSX.utils.aoa_to_sheet([
    ...(Array.isArray(body.bands_cols) && body.bands_cols.length
      ? [body.bands_cols]
      : [["赛道名", "下限$", "上限$", "关键特征", "场景/人群"]]),
    ...rows(body.bands_rows),
    ...Array.from({ length: 5 }, () => ["", "", "", "", ""]),
  ]);
  bands["!cols"] = Array.from({ length: 5 }, () => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(workbook, bands, "价格带切分");

  const instructions = XLSX.utils.aoa_to_sheet([
    ["Metis · 研究简报输入模板 使用说明"],
    [""],
    ["1) 在「研究简报输入」页的『值（在此填写）』列填写/修改内容；第一列 key 请勿修改。"],
    ["2) 多选/列表用英文逗号或、分隔；是否类用 是 / 否。"],
    ["3) 竞品逐行填在「竞品明细」页；价格带逐行填在「价格带切分」页。"],
    ["4) 填好后回到 Metis「新建研究」页，点击『导入表格』一键回填。"],
  ]);
  instructions["!cols"] = [{ wch: 96 }];
  XLSX.utils.book_append_sheet(workbook, instructions, "使用说明");

  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Response(bytes, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="Metis-brief-template.xlsx"',
    },
  });
}

async function importBrief(request: Request): Promise<Response> {
  if (parseContentLength(request) > 5_000_000) throw new ApiError("Excel 文件不能超过 5MB", 413);
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") throw new ApiError("请选择 Excel 文件", 400);
  if (file.size > 5_000_000) throw new ApiError("Excel 文件不能超过 5MB", 413);
  const bytes = await file.arrayBuffer();
  try {
    validateXlsxArchive(bytes);
  } catch (error) {
    if (error instanceof XlsxArchiveValidationError) {
      const message = error.limitExceeded
        ? "Excel 解压后体积、压缩比或条目数量超过安全限制"
        : "Excel 文件压缩结构无效或不受支持";
      throw new ApiError(message, error.limitExceeded ? 413 : 400);
    }
    throw error;
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array" });
  } catch {
    throw new ApiError("Excel 文件解析失败", 400);
  }
  const main: Record<string, unknown> = {};
  const mainSheet = workbook.Sheets["研究简报输入"] || workbook.Sheets[workbook.SheetNames[0]];
  const mainRows = XLSX.utils.sheet_to_json<unknown[]>(mainSheet, { header: 1, defval: "" });
  if (mainRows.length > 1_000) throw new ApiError("Excel 行数过多", 413);
  for (const row of mainRows.slice(1)) {
    const key = String(row[0] || "").trim();
    if (key) main[key] = row[3] ?? "";
  }

  const competitorSheet = workbook.Sheets["竞品明细"];
  const competitorRows = competitorSheet
    ? XLSX.utils.sheet_to_json<unknown[]>(competitorSheet, { header: 1, defval: "" })
    : [];
  if (competitorRows.length > 500) throw new ApiError("竞品明细不能超过 500 行", 413);
  const bandSheet = workbook.Sheets["价格带切分"];
  const bandRows = bandSheet
    ? XLSX.utils.sheet_to_json<unknown[]>(bandSheet, { header: 1, defval: "" })
    : [];
  if (bandRows.length > 100) throw new ApiError("价格带不能超过 100 行", 413);
  return json({
    main,
    comps_cols: competitorRows[0] || [],
    comps: competitorRows.slice(1).filter((row) => row.some((value) => value !== "")),
    bands: bandRows.slice(1).filter((row) => row.slice(0, 2).some((value) => value !== "")),
  });
}

async function importKeepaMoreResearch(request: Request, user: AppUser): Promise<Response> {
  const requestKey = idempotencyKey(request, "keepamore-import");
  if (!requestKey) throw new ApiError("KeepaMore 导入必须携带 Idempotency-Key", 400);
  const replay = await getRunByRequestKey(user.tenant_id, requestKey);
  if (replay) {
    return json({
      id: replay.id,
      status: replay.status,
      updated_at: replay.updated_at,
      has_report: replay.report == null ? 0 : 1,
      import_summary: { replayed: true, accepted: null },
    });
  }

  await enforceResearchExecutionLimit(user);
  if (parseContentLength(request) > 5_500_000) {
    throw new ApiError("KeepaMore 导出文件不能超过 5MB", 413);
  }
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") throw new ApiError("请选择 KeepaMore CSV 或 Excel 导出文件", 400);
  if (file.size > 5_000_000) throw new ApiError("KeepaMore 导出文件不能超过 5MB", 413);

  const category = boundedText(formData.get("category") || "cat bed", "研究品类", 80, true);
  const marketplace = boundedText(formData.get("marketplace") || "US", "站点", 32, true);
  const currency = boundedText(formData.get("currency") || "USD", "币种", 16, true);
  let imported: Awaited<ReturnType<typeof parseKeepaMoreExport>>;
  try {
    imported = await parseKeepaMoreExport(await file.arrayBuffer(), {
      filename: file.name,
      category,
      marketplace,
      currency,
      limits: { maxRows: 1_000 },
    });
  } catch (error) {
    if (error instanceof KeepaMoreExportImportError) {
      const tooLarge = [
        "FILE_SIZE_LIMIT",
        "SHEET_LIMIT",
        "ROW_LIMIT",
        "COLUMN_LIMIT",
        "CELL_SIZE_LIMIT",
      ].includes(error.code);
      throw new ApiError(`KeepaMore 导出校验失败：${error.message}`, tooLarge ? 413 : 400);
    }
    throw error;
  }
  if (!imported.products.length) {
    throw new ApiError("KeepaMore 导出中没有通过校验的猫窝商品记录", 400);
  }

  const reportProducts = imported.products.slice(0, 1_000);
  const capped = imported.products.length - reportProducts.length;
  const sourceQueries = [...new Set(
    reportProducts.flatMap((product) => product.sourceQueries || []),
  )];
  const searchObservationCount = reportProducts.reduce(
    (total, product) => total + (product.searchObservations?.length || 0),
    0,
  );
  const issueSummaries = imported.rowIssues.slice(0, 50).map((issue) =>
    `row ${issue.row}${issue.asin ? ` · ${issue.asin}` : ""} · ${issue.code} · ${issue.message}`
  );
  if (imported.rowIssues.length > issueSummaries.length) {
    issueSummaries.push(`另有 ${imported.rowIssues.length - issueSummaries.length} 条坏行明细未展开`);
  }
  const dataset: KeepaMoreResearchDataset = {
    keyword: imported.category,
    marketplace: imported.marketplace,
    domain: imported.domainId,
    observed_at: imported.observedAt,
    products: reportProducts.map(keepaMoreProductToEvidence),
    source_urls: [
      imported.sourceRef,
      ...sourceQueries.map((query) =>
        `https://next.keepamore.com/keepa/search?country=us&keyword=${encodeURIComponent(query)}`
      ),
    ],
    estimated_units: 0,
    warnings: [
      ...imported.warnings,
      ...(capped > 0 ? [`导出含 ${imported.products.length} 条有效商品；报告按安全上限展示前 1,000 条`] : []),
    ],
    provider_errors: issueSummaries,
    acquisition: "free_export",
    source_file: imported.filename,
    queries: sourceQueries.length ? sourceQueries : [imported.category],
    batch_count: sourceQueries.length || 1,
  };
  const researchBrief = {
    category: imported.category,
    marketplaces: ["US"],
    sources: { keepamore: true },
    import_mode: "free_web_export",
    source_hash: imported.sourceHash,
    row_quality: imported.rowQuality,
    query_count: sourceQueries.length || 1,
    search_observation_count: searchObservationCount,
  };
  const report = buildKeepaMoreReferenceReport(dataset, researchBrief);
  const plan = {
    category_scope: imported.category,
    marketplace_scope: ["US"],
    data_window_days: 90,
    research_brief: researchBrief,
  };
  const now = Date.now() / 1_000;
  const charge = await debitCreditsForRule({
    tenantId: user.tenant_id,
    userId: user.id,
    ruleKey: "research_generation",
    businessId: requestKey,
  });
  try {
    const result = await database()
      .prepare(`INSERT OR IGNORE INTO runs(
        tenant_id, user_id, title, input_mode, input_payload, marketplace,
        view_profile, data_scope, status, verdict, research_plan, report,
        evidence_mode, decision_readiness, request_key, created_at, updated_at
      ) VALUES(?, ?, ?, 'category_keyword', ?, 'US', 'P1', 'public_ok', 'done', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        user.tenant_id,
        user.id,
        `${imported.category}｜KeepaMore 免费导出`,
        JSON.stringify(imported.category),
        String(report.verdict || "部分实证完成，关键决策待补证"),
        JSON.stringify(plan),
        JSON.stringify(report),
        String(report.evidence_mode || "partial_verified_research"),
        String(report.decision_readiness || "insufficient_evidence"),
        requestKey,
        now,
        now,
      )
      .run();
    let run: RunRecord | null;
    if (Number(result.meta.changes || 0) === 1) {
      run = await getRun(Number(result.meta.last_row_id), user.tenant_id);
    } else {
      run = await getRunByRequestKey(user.tenant_id, requestKey);
    }
    if (!run) throw new ApiError("KeepaMore 导入记录创建冲突，请重新选择文件", 409);
    return json({
      id: run.id,
      status: run.status,
      updated_at: run.updated_at,
      has_report: run.report == null ? 0 : 1,
      import_summary: {
        replayed: Number(result.meta.changes || 0) !== 1,
        received: imported.rowQuality.received,
        accepted: imported.rowQuality.accepted,
        rejected: imported.rowQuality.rejected,
        duplicates: imported.duplicateCount,
        report_products: reportProducts.length,
        source_hash: imported.sourceHash,
      },
    }, Number(result.meta.changes || 0) === 1 ? 201 : 200);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      await compensateAcceptedCredit(charge, user, "KeepaMore 导入记录创建失败自动退回");
    } else if (!(error instanceof ApiError)) {
      await compensateAcceptedCredit(charge, user, "KeepaMore 导入记录创建失败自动退回");
    }
    throw error;
  }
}

async function getConcept(request: Request, user: AppUser, runId: number): Promise<Response> {
  const run = await getRunConceptGate(runId, user.tenant_id);
  if (!run) throw new ApiError("运行不存在", 404);
  if (!run.has_report) throw new ApiError("研究报告尚未生成", 400);
  const blockReason = runConceptBlockReason(run);
  if (blockReason) {
    return json({
      run_id: run.id,
      status: "blocked",
      assets: [],
      error: null,
      generation_available: false,
      blocked_reason: blockReason,
      retryable: false,
    });
  }
  const concept = await getLatestConcept(runId, user.tenant_id);
  const capabilityBlockReason = !productImageStorageConfigured()
    ? "概念图永久存储尚未开通，当前不会调用 Lovart，也不会扣除生成积分。"
    : !tenantPlanAllowsPaidProviders(user.plan)
      ? "当前工作区方案未开通付费模型与概念图调用。"
      : !paidProviderCallsEnabled()
        ? "付费供应商调用已由系统暂停，当前不会提交或扣费。"
        : "";
  if (capabilityBlockReason) {
    const cachedConcept = concept
      ? conceptForClient(concept, new URL(request.url).origin)
      : { run_id: run.id, assets: [], error: null };
    return json({
      ...cachedConcept,
      status: "unavailable",
      last_known_status: concept?.status || null,
      generation_available: false,
      blocked_reason: capabilityBlockReason,
      retryable: false,
    });
  }
  if (!concept) {
    return json({
      run_id: run.id,
      status: "not_started",
      assets: [],
      error: null,
      generation_available: true,
      retryable: false,
    });
  }
  const syncedConcept = await syncProductConcept(concept);
  return json({
    ...conceptForClient(syncedConcept, new URL(request.url).origin),
    generation_available: true,
  });
}

async function requireGenerationConfirmation(
  request: Request,
  user: AppUser,
): Promise<Record<string, unknown>> {
  requireAdmin(user);
  const body = await bodyJson(request, 16_000);
  if (body.confirm_generation !== true) {
    throw new ApiError("必须明确确认生成概念图，且该操作可能消耗 Lovart 额度", 400);
  }
  return body;
}

async function startConcept(request: Request, user: AppUser, runId: number): Promise<Response> {
  await requireGenerationConfirmation(request, user);
  requireProductImageStorage();
  requirePaidProviderAccess(user);
  const run = await getRun(runId, user.tenant_id);
  if (!run) throw new ApiError("运行不存在", 404);
  if (!run.report) throw new ApiError("研究报告尚未生成", 400);
  const blockReason = runConceptBlockReason(run);
  if (blockReason) throw new ApiError(blockReason, 409);
  const current = await getLatestConcept(runId, user.tenant_id);
  if (current) return json(conceptForClient(current, new URL(request.url).origin));
  await enforceConceptGenerationLimit(user);
  const creditCharge = await debitCreditsForRule({
    tenantId: user.tenant_id,
    userId: user.id,
    ruleKey: "scene_suite_generation",
    businessId: `scene-start:${runId}`,
  });
  try {
    const concept = await startProductConcept(run, user);
    return json(conceptForClient(concept, new URL(request.url).origin), 201);
  } catch (error) {
    await compensateAcceptedCredit(creditCharge, user, "场景套图任务创建失败自动退回");
    throw error;
  }
}

async function regenerateConcept(
  request: Request,
  user: AppUser,
  runId: number,
): Promise<Response> {
  await requireGenerationConfirmation(request, user);
  requireProductImageStorage();
  requirePaidProviderAccess(user);
  const run = await getRun(runId, user.tenant_id);
  if (!run) throw new ApiError("运行不存在", 404);
  if (!run.report) throw new ApiError("研究报告尚未生成", 400);
  const blockReason = runConceptBlockReason(run);
  if (blockReason) throw new ApiError(blockReason, 409);
  const current = await getLatestConcept(runId, user.tenant_id);
  if (current && [
    "queued",
    "generating",
    "awaiting_confirmation",
    "submission_unknown",
    "confirmation_unknown",
  ].includes(current.status)) {
    throw new ApiError("当前概念图任务尚未结束", 409);
  }
  await enforceConceptGenerationLimit(user);
  const creditCharge = await debitCreditsForRule({
    tenantId: user.tenant_id,
    userId: user.id,
    ruleKey: "scene_suite_generation",
    businessId: `scene-regen:${runId}:${current?.id || 0}`,
  });
  try {
    const concept = await startProductConcept(run, user, true);
    return json(conceptForClient(concept, new URL(request.url).origin), 201);
  } catch (error) {
    await compensateAcceptedCredit(creditCharge, user, "场景套图重生成失败自动退回");
    throw error;
  }
}

/*
 * Remote awaiting_confirmation remains a separate Lovart-side approval. The
 * local confirmation above only authorizes creating a new billable task.
 */

function conceptEstimatedCost(concept: { pending_confirmation?: Record<string, unknown> | null }): number | null {
  const pending = concept.pending_confirmation || {};
  const value = pending.estimated_cost ?? pending.cost ?? pending.credits;
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

async function approveConcept(request: Request, user: AppUser, runId: number): Promise<Response> {
  const body = await requireGenerationConfirmation(request, user);
  requireProductImageStorage();
  requirePaidProviderAccess(user);
  const run = await getRun(runId, user.tenant_id);
  if (!run) throw new ApiError("运行不存在", 404);
  const blockReason = runConceptBlockReason(run);
  if (blockReason) throw new ApiError(blockReason, 409);
  const concept = await getLatestConcept(runId, user.tenant_id);
  if (!concept) throw new ApiError("概念图任务不存在", 404);
  if (concept.status !== "awaiting_confirmation") {
    throw new ApiError("当前任务不需要付费确认", 409);
  }
  if (Number(body.concept_id) !== concept.id) {
    throw new ApiError("概念图任务已变化，请刷新后重新确认", 409);
  }
  const expectedUpdatedAt = Number(body.expected_concept_updated_at);
  if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== concept.updated_at) {
    throw new ApiError("Lovart 报价或任务状态已变化，请刷新后重新确认", 409);
  }
  const estimatedCost = conceptEstimatedCost(concept);
  if (estimatedCost == null) {
    if (body.expected_estimated_cost !== null || body.confirm_unknown_cost !== true) {
      throw new ApiError("Lovart 未返回可核对的点数；必须明确接受未知点数风险后才能继续", 400);
    }
  } else {
    const expectedCost = Number(body.expected_estimated_cost);
    if (!Number.isFinite(expectedCost) || expectedCost < 0 || expectedCost !== estimatedCost) {
      throw new ApiError("Lovart 预计点数已变化，请刷新后重新确认", 409);
    }
  }
  return json(conceptForClient(
    await confirmProductConcept(concept),
    new URL(request.url).origin,
  ));
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type VerifiedAdoptionAsset = {
  sha256: string;
  contentType: string;
  byteSize: number;
};

type AdoptedSceneAsset = {
  artifactIndex: number;
  assetId: string;
  role: string;
  title: string;
  sequence: number;
  required: boolean;
  designDnaId: string;
  assetUrl: string;
  asset: VerifiedAdoptionAsset;
};

const REQUIRED_SCENE_SUITE_SLOTS = CONCEPT_SCENE_SUITE_SLOTS
  .filter((slot) => slot.required)
  .map((slot) => ({
    role: slot.role,
    title: slot.title,
    sequence: slot.sequence,
  }));

function conceptMetadataText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function conceptDesignDnaId(concept: NonNullable<Awaited<ReturnType<typeof getLatestConcept>>>): string {
  const brief = objectRecord(concept.design_brief);
  return conceptMetadataText(objectRecord(brief.scene_suite).design_dna_id, 160) ||
    conceptMetadataText(objectRecord(brief.design_dna).id, 160);
}

async function verifiedSceneSuiteForAdoption(
  body: Record<string, unknown>,
  concept: NonNullable<Awaited<ReturnType<typeof getLatestConcept>>>,
  requestUrl: string,
): Promise<AdoptedSceneAsset[]> {
  if (!Array.isArray(body.artifact_indices)) {
    throw new ApiError("采用场景套图必须提交完整的素材索引", 400);
  }
  const artifactIndices = body.artifact_indices.map(Number);
  if (
    artifactIndices.length !== REQUIRED_SCENE_SUITE_SLOTS.length ||
    artifactIndices.some((index) => !Number.isInteger(index) || index < 0)
  ) {
    throw new ApiError(`场景套图必须包含 ${REQUIRED_SCENE_SUITE_SLOTS.length} 个有效素材索引`, 400);
  }
  if (new Set(artifactIndices).size !== artifactIndices.length) {
    throw new ApiError("场景套图不能重复采用同一素材", 400);
  }

  const heroArtifactIndex = Number(body.hero_artifact_index);
  if (!Number.isInteger(heroArtifactIndex) || heroArtifactIndex < 0) {
    throw new ApiError("场景套图主视觉索引无效", 400);
  }
  if (!artifactIndices.includes(heroArtifactIndex)) {
    throw new ApiError("场景套图主视觉必须包含在所选素材中", 400);
  }

  const designDnaId = conceptDesignDnaId(concept);
  if (!designDnaId) {
    throw new ApiError("场景套图缺少设计 DNA 标识，不能采用为正式套图", 409);
  }
  const artifacts = Array.isArray(concept.artifacts) ? concept.artifacts : [];
  const selected = artifactIndices.map((artifactIndex) => {
    const metadata = objectRecord(artifacts[artifactIndex]);
    const role = conceptMetadataText(metadata.role, 80);
    const title = conceptMetadataText(metadata.title, 160);
    const assetId = conceptMetadataText(metadata.asset_id, 120);
    const artifactDesignDnaId = conceptMetadataText(metadata.design_dna_id, 160);
    if (!role || !title || !assetId || metadata.required !== true) {
      throw new ApiError("场景套图素材角色元数据不完整，不能采用为正式套图", 409);
    }
    if (artifactDesignDnaId && artifactDesignDnaId !== designDnaId) {
      throw new ApiError("场景套图包含不同设计 DNA 的素材，不能采用", 409);
    }
    return { artifactIndex, role, title, assetId, metadata };
  });

  const selectedRoles = selected.map((item) => item.role);
  if (new Set(selectedRoles).size !== selectedRoles.length) {
    throw new ApiError("场景套图包含重复角色，不能采用", 409);
  }
  if (new Set(selected.map((item) => item.assetId)).size !== selected.length) {
    throw new ApiError("场景套图包含重复资产标识，不能采用", 409);
  }
  const missingRoles = REQUIRED_SCENE_SUITE_SLOTS
    .map((slot) => slot.role)
    .filter((role) => !selectedRoles.includes(role));
  const unexpectedRoles = selectedRoles.filter((role) =>
    !REQUIRED_SCENE_SUITE_SLOTS.some((slot) => slot.role === role)
  );
  if (missingRoles.length || unexpectedRoles.length) {
    throw new ApiError(
      `场景套图角色不完整（缺少：${missingRoles.join("、") || "无"}；异常：${unexpectedRoles.join("、") || "无"}）`,
      409,
    );
  }
  const heroMetadata = selected.find((item) => item.artifactIndex === heroArtifactIndex);
  if (heroMetadata?.role !== "hero_master") {
    throw new ApiError("场景套图主视觉必须选择 hero_master 素材", 409);
  }

  const verified = await Promise.all(selected.map(async (item) => {
    const asset = await conceptAssetForAdoption(concept, item.artifactIndex);
    if (!asset.ok) throw new ApiError(asset.reason, 409);
    return { ...item, asset };
  }));
  if (new Set(verified.map((item) => item.asset.sha256)).size !== verified.length) {
    throw new ApiError("场景套图包含内容重复的存档素材，不能采用", 409);
  }

  const byRole = new Map(verified.map((item) => [item.role, item]));
  return REQUIRED_SCENE_SUITE_SLOTS.map((slot) => {
    const item = byRole.get(slot.role);
    if (!item) throw new ApiError("场景套图角色校验失败，请重新生成", 409);
    return {
      artifactIndex: item.artifactIndex,
      assetId: item.assetId,
      role: slot.role,
      title: item.title || slot.title,
      sequence: slot.sequence,
      required: true,
      designDnaId,
      assetUrl: new URL(
        `/api/concept-assets/${concept.public_token}/${item.artifactIndex}`,
        requestUrl,
      ).toString(),
      asset: item.asset,
    };
  });
}

function reportWithAdoptedConcept(
  report: Record<string, unknown>,
  concept: NonNullable<Awaited<ReturnType<typeof getLatestConcept>>>,
  adoptedAssets: AdoptedSceneAsset[],
  heroArtifactIndex: number,
  user: AppUser,
  adoptedAt: number,
): Record<string, unknown> {
  const next = structuredClone(report);
  const modules = objectRecord(next.modules);
  next.modules = modules;
  const boardConcept = objectRecord(modules.board_concept);
  const baseVersion = String(next.base_report_version || next.report_version || next.schema_version || "unknown");
  const revision = Math.max(0, Number(next.report_revision || 0)) + 1;
  const heroAsset = adoptedAssets.find((item) => item.artifactIndex === heroArtifactIndex);
  if (!heroAsset) throw new ApiError("正式概念主视觉不存在", 409);
  const provenanceFor = (item: AdoptedSceneAsset) => ({
    concept_id: concept.id,
    artifact_index: item.artifactIndex,
    asset_sha256: item.asset.sha256,
    asset_url: item.assetUrl,
    role: item.role,
    asset_id: item.assetId,
    design_dna_id: item.designDnaId,
    model: concept.model || null,
    storage: "R2",
    content_type: item.asset.contentType,
    byte_size: item.asset.byteSize,
    adopted_by_id: user.id,
    adopted_by_name: user.name,
    adopted_at: adoptedAt,
  });
  const sceneSuite = adoptedAssets.map((item) => ({
    asset_id: item.assetId,
    role: item.role,
    title: item.title,
    sequence: item.sequence,
    required: item.required,
    image_url: item.assetUrl,
    url: item.assetUrl,
    asset_sha256: item.asset.sha256,
    concept_id: concept.id,
    artifact_index: item.artifactIndex,
    design_dna_id: item.designDnaId,
    content_type: item.asset.contentType,
    byte_size: item.asset.byteSize,
    asset_provenance: provenanceFor(item),
  }));
  const provenance = provenanceFor(heroAsset);
  const adoptedConcept = {
    ...boardConcept,
    image_url: heroAsset.assetUrl,
    image_source: "lovart_r2",
    asset_provenance: provenance,
    scene_suite: sceneSuite,
  };
  modules.board_concept = adoptedConcept;

  const updateProductConcept = (moduleId: string) => {
    const moduleValue = { ...objectRecord(modules[moduleId]) };
    moduleValue.product_concept = adoptedConcept;
    modules[moduleId] = moduleValue;
    return moduleValue;
  };
  const productMatrix = updateProductConcept("pd_concept_matrix");
  const problemSolver = updateProductConcept("problem_solver_concept");

  const updateDesignPack = (value: unknown) => {
    const pack = { ...objectRecord(value) };
    pack.master_asset = {
      ...objectRecord(pack.master_asset),
      image: heroAsset.assetUrl,
      provenance: `Lovart R2 asset · SHA-256 ${heroAsset.asset.sha256} · adopted ${new Date(adoptedAt * 1000).toISOString()}`,
      asset_provenance: provenance,
    };
    pack.scene_suite = sceneSuite;
    if (adoptedAssets.length === REQUIRED_SCENE_SUITE_SLOTS.length) {
      pack.scene_suite_contract = {
        ...objectRecord(pack.scene_suite_contract),
        design_dna_id: heroAsset.designDnaId,
        required_asset_count: REQUIRED_SCENE_SUITE_SLOTS.length,
        consistency_status: "ADOPTED-PENDING-HUMAN-REVIEW",
        hero_compatibility_alias: heroAsset.assetUrl,
      };
    }
    return pack;
  };
  const updatePortfolio = (value: unknown) => {
    const portfolio = { ...objectRecord(value) };
    portfolio.selected_direction = {
      ...objectRecord(portfolio.selected_direction),
      image_url: heroAsset.assetUrl,
      asset_provenance: provenance,
      scene_suite: sceneSuite,
    };
    return portfolio;
  };
  const updateQualityAudit = (value: unknown) => ({
    ...objectRecord(value),
    terminal_asset: {
      status: "adopted_for_human_review",
      note: "已采用为正式报告概念图；仍不替代工程图、DFM、样机、成本、合规与人工签样。",
      ...provenance,
    },
  });

  modules.aigc_design_review_pack = updateDesignPack(modules.aigc_design_review_pack);
  modules.aigc_concept_portfolio = updatePortfolio(modules.aigc_concept_portfolio);
  modules.aigc_quality_audit = updateQualityAudit(modules.aigc_quality_audit);
  productMatrix.aigc_design_review_pack = updateDesignPack(productMatrix.aigc_design_review_pack);
  productMatrix.aigc_concept_portfolio = updatePortfolio(productMatrix.aigc_concept_portfolio);
  productMatrix.aigc_quality_audit = updateQualityAudit(productMatrix.aigc_quality_audit);
  problemSolver.aigc_design_review_pack = updateDesignPack(problemSolver.aigc_design_review_pack);

  next.base_report_version = baseVersion;
  next.report_revision = revision;
  next.report_version = `${baseVersion}+concept-r${revision}`;
  return finalizeReportForPersistence(next);
}

async function adoptConcept(request: Request, user: AppUser, runId: number): Promise<Response> {
  requireAdmin(user);
  const body = await bodyJson(request, 32_000);
  if (body.confirm_adoption !== true) throw new ApiError("必须明确确认采用该图片为正式报告概念", 400);
  const run = await getRun(runId, user.tenant_id);
  if (!run) throw new ApiError("运行不存在", 404);
  if (run.reviewed) throw new ApiError("报告已签核；请先撤销签核，再更换正式概念图", 409);
  requireReportReadyForDecision(run.report);
  if (!run.report) throw new ApiError("研究报告尚未生成", 400);

  const reportHash = await sha256Json(run.report);
  const reportVersion = String(run.report.report_version || run.report.schema_version || "unknown");
  const expectedHash = boundedText(body.expected_report_hash, "当前报告哈希", 64);
  const expectedVersion = boundedText(body.expected_report_version, "当前报告版本", 160);
  const expectedRunUpdatedAt = Number(body.expected_run_updated_at);
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) throw new ApiError("采用前必须携带当前报告 SHA-256", 400);
  if (
    expectedHash !== reportHash ||
    expectedVersion !== reportVersion ||
    !Number.isFinite(expectedRunUpdatedAt) ||
    expectedRunUpdatedAt !== run.updated_at
  ) {
    throw new ApiError("报告内容或状态已变化，请刷新后重新采用", 409);
  }

  const concept = await getLatestConcept(runId, user.tenant_id);
  if (!concept || Number(body.concept_id) !== concept.id) {
    throw new ApiError("概念图任务已变化，请刷新后重新选择", 409);
  }
  const expectedConceptUpdatedAt = Number(body.expected_concept_updated_at);
  if (!Number.isFinite(expectedConceptUpdatedAt) || expectedConceptUpdatedAt !== concept.updated_at) {
    throw new ApiError("概念图状态已变化，请刷新后重新选择", 409);
  }
  const adoptSuite = body.adopt_suite === true;
  let heroArtifactIndex: number;
  let adoptedAssets: AdoptedSceneAsset[];
  if (adoptSuite) {
    heroArtifactIndex = Number(body.hero_artifact_index);
    adoptedAssets = await verifiedSceneSuiteForAdoption(body, concept, request.url);
  } else {
    const assetIndex = Number(body.artifact_index);
    if (!Number.isInteger(assetIndex) || assetIndex < 0) throw new ApiError("概念图索引无效", 400);
    const verifiedAsset = await conceptAssetForAdoption(concept, assetIndex);
    if (!verifiedAsset.ok) throw new ApiError(verifiedAsset.reason, 409);
    const metadata = objectRecord((concept.artifacts || [])[assetIndex]);
    heroArtifactIndex = assetIndex;
    adoptedAssets = [{
      artifactIndex: assetIndex,
      assetId: conceptMetadataText(metadata.asset_id, 120) || `legacy-concept-${assetIndex + 1}`,
      role: conceptMetadataText(metadata.role, 80) || "hero_master",
      title: conceptMetadataText(metadata.title, 160) ||
        conceptMetadataText(objectRecord(objectRecord(run.report.modules).board_concept).title, 160) ||
        "正式概念主图",
      sequence: 1,
      required: true,
      designDnaId: conceptDesignDnaId(concept) || `legacy-concept-${concept.id}`,
      assetUrl: new URL(
        `/api/concept-assets/${concept.public_token}/${assetIndex}`,
        request.url,
      ).toString(),
      asset: verifiedAsset,
    }];
  }

  const currentBoardConcept = objectRecord(objectRecord(run.report.modules).board_concept);
  if (adoptSuite) {
    const currentSuite = Array.isArray(currentBoardConcept.scene_suite)
      ? currentBoardConcept.scene_suite.map(objectRecord)
      : [];
    const suiteIsCurrent = currentSuite.length === adoptedAssets.length && adoptedAssets.every((item) =>
      currentSuite.some((current) =>
        Number(current.concept_id) === concept.id &&
        Number(current.artifact_index) === item.artifactIndex &&
        String(current.role || "") === item.role &&
        String(current.asset_sha256 || "") === item.asset.sha256
      )
    );
    if (suiteIsCurrent) return json(run);
  } else {
    const currentAsset = objectRecord(currentBoardConcept.asset_provenance);
    const selectedAsset = adoptedAssets[0];
    if (
      Number(currentAsset.concept_id) === concept.id &&
      Number(currentAsset.artifact_index) === heroArtifactIndex &&
      String(currentAsset.asset_sha256 || "") === selectedAsset.asset.sha256
    ) {
      return json(run);
    }
  }

  const adoptedAt = Date.now() / 1000;
  const nextReport = reportWithAdoptedConcept(
    run.report,
    concept,
    adoptedAssets,
    heroArtifactIndex,
    user,
    adoptedAt,
  );
  const nextHash = await sha256Json(nextReport);
  const nextVersion = String(nextReport.report_version);
  const mutationToken = crypto.randomUUID();
  const db = database();
  const updateStatement = db
    .prepare(`UPDATE runs SET report = ?, decision_outcome = NULL, outcome_note = NULL,
      reviewed = 0, reviewer_id = NULL, reviewer_name = NULL, reviewed_at = NULL,
      review_checks = NULL, review_report_hash = NULL, updated_at = ?, mutation_token = ?
      WHERE id = ? AND tenant_id = ? AND reviewed = 0
        AND updated_at = ? AND deleted_at IS NULL`)
    .bind(
      JSON.stringify(nextReport),
      adoptedAt,
      mutationToken,
      runId,
      user.tenant_id,
      run.updated_at,
    );
  const auditStatement = db
    .prepare(`INSERT INTO review_events(
      run_id, tenant_id, reviewer_id, reviewer_name, action,
      decision_outcome, outcome_note, review_checks, report_hash,
      report_version, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM runs WHERE id = ? AND tenant_id = ?
          AND updated_at = ? AND reviewed = ? AND mutation_token = ?
          AND deleted_at IS NULL
      )`)
    .bind(
      runId,
      user.tenant_id,
      user.id,
      user.name,
      "concept_adopted",
      null,
      adoptSuite
        ? `采用 Lovart 概念 #${concept.id} 场景套图 ${adoptedAssets.length} 张（Hero 素材 ${heroArtifactIndex + 1}；SHA-256 ${adoptedAssets.find((item) => item.artifactIndex === heroArtifactIndex)?.asset.sha256 || "unknown"}）`
        : `采用 Lovart 概念 #${concept.id} 素材 ${heroArtifactIndex + 1}（SHA-256 ${adoptedAssets[0].asset.sha256}）`,
      null,
      nextHash,
      nextVersion,
      adoptedAt,
      runId,
      user.tenant_id,
      adoptedAt,
      0,
      mutationToken,
    );
  const results = await db.batch([updateStatement, auditStatement]);
  if (Number(results[0]?.meta.changes || 0) !== 1 || Number(results[1]?.meta.changes || 0) !== 1) {
    throw new ApiError("报告状态已变化，请刷新后重新采用", 409);
  }
  return json(await getRun(runId, user.tenant_id));
}

function managedUserId(path: string[]): number {
  const userId = Number(path[2]);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ApiError("用户编号无效", 400);
  }
  return userId;
}

function cursorPage(
  request: Request,
  defaultLimit: number,
  maxLimit: number,
): { limit: number; beforeId?: number } {
  const search = new URL(request.url).searchParams;
  const rawLimit = search.get("limit");
  const limit = rawLimit == null ? defaultLimit : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new ApiError(`列表 limit 必须为 1-${maxLimit} 的整数`, 400);
  }
  const rawCursor = String(search.get("cursor") || "").trim();
  if (!rawCursor) return { limit };
  const beforeId = Number(rawCursor);
  if (!/^\d+$/.test(rawCursor) || !Number.isSafeInteger(beforeId) || beforeId <= 0) {
    throw new ApiError("列表 cursor 无效", 400);
  }
  return { limit, beforeId };
}

async function adminListUsers(request: Request, user: AppUser): Promise<Response> {
  requireAdmin(user);
  const page = cursorPage(request, ADMIN_USER_DEFAULT_LIMIT, ADMIN_USER_MAX_LIMIT);
  const search = new URL(request.url).searchParams;
  const query = boundedText(search.get("q"), "搜索内容", 100);
  const rawStatus = String(search.get("status") || "").trim();
  if (rawStatus && rawStatus !== "active" && rawStatus !== "disabled") {
    throw new ApiError("用户状态筛选无效", 400);
  }
  return json(await listManagedUsers({
    tenantId: user.tenant_id,
    query,
    status: rawStatus ? rawStatus as "active" | "disabled" : undefined,
    ...page,
  }));
}

async function adminCreateUser(request: Request, user: AppUser): Promise<Response> {
  requireAdmin(user);
  const body = await bodyJson(request, 32_000);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const role = String(body.role || "member");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ApiError("请输入有效邮箱", 400);
  }
  if (password.length < 8 || password.length > 128) {
    throw new ApiError("密码需要 8–128 位", 400);
  }
  if (role !== "member") throw new ApiError("当前仅支持创建普通成员", 400);
  const initialCredits = body.initial_credits === undefined ? 0 : body.initial_credits;
  if (!Number.isSafeInteger(initialCredits) || Number(initialCredits) < 0) {
    throw new ApiError("初始积分必须是非负整数", 400);
  }
  const duplicate = await database()
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first();
  if (duplicate) throw new ApiError("该邮箱已存在", 409);
  const name = boundedText(body.name || email.split("@")[0], "姓名", 80, true);
  try {
    const created = await createManagedUser({
      tenantId: user.tenant_id,
      email,
      passwordHash: await hashPassword(password),
      name,
      actorUserId: user.id,
      initialCredits: Number(initialCredits),
    });
    return json({ user: created }, 201);
  } catch (error) {
    if (error instanceof CreditDomainError) throw error;
    const raced = await database()
      .prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first();
    if (raced) throw new ApiError("该邮箱已存在", 409);
    throw error;
  }
}

async function adminSetUserStatus(
  request: Request,
  user: AppUser,
  targetUserId: number,
): Promise<Response> {
  requireAdmin(user);
  const body = await bodyJson(request, 8_000);
  const status = String(body.status || "");
  if (status !== "active" && status !== "disabled") {
    throw new ApiError("用户状态无效", 400);
  }
  const updated = await setManagedUserStatus({
    tenantId: user.tenant_id,
    userId: targetUserId,
    actorUserId: user.id,
    status,
  });
  return json({ user: updated });
}

async function adminResetUserPassword(
  request: Request,
  user: AppUser,
  targetUserId: number,
): Promise<Response> {
  requireAdmin(user);
  const body = await bodyJson(request, 8_000);
  const password = String(body.password || "");
  if (password.length < 8 || password.length > 128) {
    throw new ApiError("密码需要 8–128 位", 400);
  }
  const passwordHash = await hashPassword(password);
  const db = database();
  const results = await db.batch([
    db.prepare(`UPDATE users SET pw_hash = ?
      WHERE id = ? AND tenant_id = ? AND role = 'member'`)
      .bind(passwordHash, targetUserId, user.tenant_id),
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND tenant_id = ?
      AND EXISTS (
        SELECT 1 FROM users WHERE id = ? AND tenant_id = ?
          AND role = 'member' AND pw_hash = ?
      )`)
      .bind(targetUserId, user.tenant_id, targetUserId, user.tenant_id, passwordHash),
  ]);
  if (Number(results[0]?.meta.changes || 0) !== 1) {
    const target = await getManagedUser(user.tenant_id, targetUserId);
    if (!target) throw new ApiError("用户不存在", 404);
    throw new ApiError("仅可重置普通成员的密码", 403);
  }
  return json({ ok: true, user_id: targetUserId });
}

async function adminAdjustCredits(
  request: Request,
  user: AppUser,
  targetUserId: number,
): Promise<Response> {
  requireAdmin(user);
  const body = await bodyJson(request, 16_000);
  if (!Number.isSafeInteger(body.amount) || Number(body.amount) === 0) {
    throw new ApiError("积分数量必须是非零整数", 400);
  }
  const reason = boundedText(body.reason, "积分变更原因", 160, true);
  const note = boundedText(body.note, "积分备注", 1_000);
  const clientKey = String(body.idempotency_key || request.headers.get("idempotency-key") || "").trim();
  const operationKey = clientKey ? `manual:${clientKey}` : `manual:${crypto.randomUUID()}`;
  const result = await applyCreditAdjustment({
    tenantId: user.tenant_id,
    userId: targetUserId,
    actorUserId: user.id,
    amount: Number(body.amount),
    reason,
    note,
    sourceType: "manual_adjustment",
    sourceId: String(targetUserId),
    idempotencyKey: operationKey,
  });
  return json(result, result.replayed ? 200 : 201);
}

async function adminUserCreditLedger(
  request: Request,
  user: AppUser,
  targetUserId: number,
): Promise<Response> {
  requireAdmin(user);
  const page = cursorPage(request, CREDIT_LEDGER_DEFAULT_LIMIT, CREDIT_LEDGER_MAX_LIMIT);
  return json(await listUserCreditLedger({
    tenantId: user.tenant_id,
    userId: targetUserId,
    ...page,
  }));
}

async function adminUpdateCreditRule(
  request: Request,
  user: AppUser,
  ruleKey: string,
): Promise<Response> {
  requireAdmin(user);
  const body = await bodyJson(request, 8_000);
  if (body.cost !== undefined && !Number.isSafeInteger(body.cost)) {
    throw new ApiError("规则积分必须是非负整数", 400);
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    throw new ApiError("规则启用状态必须是布尔值", 400);
  }
  const rule = await updateCreditRule({
    tenantId: user.tenant_id,
    actorUserId: user.id,
    ruleKey,
    cost: body.cost === undefined ? undefined : Number(body.cost),
    enabled: body.enabled as boolean | undefined,
  });
  return json({ rule });
}

async function dispatch(request: Request, context: RouteContext): Promise<Response> {
  await ensureSchema();
  const path = (await context.params).path || [];
  const method = request.method.toUpperCase();

  if (path[0] === "health" && method === "GET") {
    const models = modelProviderStatus();
    const lovart = lovartProviderStatus();
    const modelProvidersReady = Array.isArray(models.providers) &&
      models.providers.every((provider: Record<string, unknown>) => provider.configured === true);
    const lovartReady = lovart.configured === true;
    const paidProvidersEnabled = paidProviderCallsEnabled();
    const adapterRegistry = buildResearchDataAdapterRegistry("health-check", "Amazon US");
    const operationalEvidenceAdapters = [{
      id: KEEPAMORE_ADAPTER_ID,
      status: "operational_partial",
      evidence_scope: ["商品池", "价格", "排名", "评分与评论数聚合字段"],
      limitations: ["无评论正文", "无精确销量", "无订单退货与单位经济实绩"],
      acquisition_modes: ["tenant_api", "free_export"],
    }];
    const readiness = evaluateHealthReadiness({
      researchQueue: researchQueueConfigured(),
      settingsEncryption: settingsEncryptionConfigured(),
      modelProviders: modelProvidersReady,
      paidProviderCalls: paidProvidersEnabled,
      decisionCoordinator: decisionCoordinatorConfigured(),
      conceptArchiveQueue: conceptArchiveQueueConfigured(),
      productImageStorage: productImageStorageConfigured(),
      lovart: lovartReady,
      operationalEvidenceAdapterIds: operationalEvidenceAdapters.map((adapter) => adapter.id),
      declaredEvidenceAdapters: adapterRegistry.adapters,
    });
    return json({
      ok: readiness.serviceReady,
      ready_for_ai_research: readiness.readyForAiResearch,
      ready_for_full_evidence_research: readiness.readyForFullEvidenceResearch,
      ready_for_concept_generation: readiness.readyForConceptGeneration,
      service: "metis-voc-online",
      version: "1.6.0",
      research_evidence: {
        status: readiness.evidenceLevel,
        partial_evidence_ready: readiness.partialEvidenceReady,
        full_evidence_ready: readiness.fullEvidenceReady,
        contract_version: adapterRegistry.contract_version,
        operational_adapters: operationalEvidenceAdapters,
        pending_adapters: readiness.pendingEvidenceAdapterIds,
      },
      dependencies: {
        database: "ready",
        research_queue: researchQueueConfigured() ? "ready" : "unavailable",
        concept_archive_queue: conceptArchiveQueueConfigured() ? "ready" : "unavailable",
        decision_coordinator: decisionCoordinatorConfigured() ? "ready" : "unavailable",
        product_images: productImageStorageConfigured() ? "ready" : "unavailable",
        settings_encryption: settingsEncryptionConfigured() ? "ready" : "unavailable",
        paid_provider_calls: paidProvidersEnabled ? "enabled" : "paused",
        evidence_pipeline: readiness.evidenceLevel,
        model_providers: modelProvidersReady ? "ready" : "degraded",
        lovart: lovartReady ? "ready" : "degraded",
      },
    }, readiness.serviceReady ? 200 : 503, readiness.serviceReady
      ? {}
      : { "retry-after": "10" });
  }
  if (path[0] === "auth" && path[1] === "register" && method === "POST") return register(request);
  if (path[0] === "auth" && path[1] === "login" && method === "POST") return login(request);
  if (path[0] === "concept-assets" && method === "GET") {
    const token = String(path[1] || "");
    const index = Number(path[2] || 0);
    if (!/^[a-f0-9]{32}$/i.test(token) || !Number.isInteger(index) || index < 0) {
      throw new ApiError("概念图地址无效", 400);
    }
    const response = await conceptAsset(token, index);
    if (!response) throw new ApiError("概念图不存在", 404);
    return response;
  }

  const user = await requireUser(request);
  if (path[0] === "auth" && path[1] === "logout" && method === "POST") {
    await revokeSession(request);
    return json({ ok: true });
  }
  if (path[0] === "me" && method === "GET") return json(user);
  if (path[0] === "account" && path[1] === "password" && method === "PUT") {
    return changePassword(request, user);
  }
  if (path[0] === "credits" && path[1] === "me" && path.length === 2 && method === "GET") {
    return json(await getMyCredits(user.tenant_id, user.id));
  }
  if (path[0] === "admin" && path[1] === "credit-rules" && path.length === 2 && method === "GET") {
    requireAdmin(user);
    return json(await listCreditRules(user.tenant_id));
  }
  if (path[0] === "admin" && path[1] === "credit-rules" && path.length === 3 && method === "PATCH") {
    return adminUpdateCreditRule(request, user, String(path[2] || ""));
  }
  if (path[0] === "admin" && path[1] === "users" && path.length === 2 && method === "GET") {
    return adminListUsers(request, user);
  }
  if (path[0] === "admin" && path[1] === "users" && path.length === 2 && method === "POST") {
    return adminCreateUser(request, user);
  }
  if (path[0] === "admin" && path[1] === "users" && path.length >= 3) {
    const targetUserId = managedUserId(path);
    if (path.length === 3 && method === "PATCH") {
      return adminSetUserStatus(request, user, targetUserId);
    }
    if (path[3] === "password" && path.length === 4 && method === "PUT") {
      return adminResetUserPassword(request, user, targetUserId);
    }
    if (path[3] === "credits" && path.length === 4 && method === "POST") {
      return adminAdjustCredits(request, user, targetUserId);
    }
    if (path[3] === "credit-ledger" && path.length === 4 && method === "GET") {
      return adminUserCreditLedger(request, user, targetUserId);
    }
  }
  if (path[0] === "providers" && path.length === 1 && method === "GET") {
    const status = modelProviderStatus();
    return json({
      ...status,
      providers: [...(status.providers || []), lovartProviderStatus()],
    });
  }
  if (path[0] === "providers" && path[1] === "test" && method === "POST") {
    requireAdmin(user);
    requirePaidProviderAccess(user);
    await enforceProviderTestLimit(user);
    const result = await testModelProviders();
    const lovart = await testLovartProvider();
    return json({
      ok: result.ok && lovart.ok,
      providers: [...(result.providers || []), lovart],
    });
  }
  if (path[0] === "runs" && path.length === 1 && method === "GET") {
    const page = runListPage(request);
    const rows = await listRuns(user.tenant_id, { ...page, limit: page.limit + 1 });
    return paginatedRunList(rows, page.limit);
  }
  if (path[0] === "runs" && path[1] === "archived" && path.length === 2 && method === "GET") {
    requireAdmin(user);
    const page = runListPage(request, true);
    const rows = await listArchivedRuns(user.tenant_id, { ...page, limit: page.limit + 1 });
    return paginatedRunList(rows, page.limit, true);
  }
  if (path[0] === "runs" && path.length === 1 && method === "POST") {
    return createRun(request, user);
  }

  if (path[0] === "settings" && method === "GET") {
    requireAdmin(user);
    const row = await database()
      .prepare("SELECT settings, settings_version FROM tenants WHERE id = ?")
      .bind(user.tenant_id)
      .first<{ settings: string | null; settings_version: number }>();
    try {
      const settings = await readSecretSettings(
        row?.settings,
        user.tenant_id,
        settingsEncryptionKey(),
      );
      return json({ ...settingsForClient(settings), version: Number(row?.settings_version || 0) });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error("settings decryption failed", error instanceof Error ? error.name : "unknown");
      throw new ApiError("数据源凭证安全存储暂不可用", 503, { "retry-after": "30" });
    }
  }
  if (path[0] === "settings" && method === "PUT") {
    requireAdmin(user);
    const body = await bodyJson(request);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const row = await database()
        .prepare("SELECT settings, settings_version FROM tenants WHERE id = ?")
        .bind(user.tenant_id)
        .first<{ settings: string | null; settings_version: number }>();
      if (!row) throw new ApiError("工作区不存在", 404);
      let securedSettings: Awaited<ReturnType<typeof mergeAndEncryptSecretSettings>>;
      try {
        securedSettings = await mergeAndEncryptSecretSettings(
          row.settings,
          body.data,
          body.clear,
          user.tenant_id,
          settingsEncryptionKey(),
        );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof SecretSettingsCryptoError) {
          console.error("settings encryption failed", error.name);
          throw new ApiError("数据源凭证安全存储暂不可用", 503, { "retry-after": "30" });
        }
        throw new ApiError(runFailureMessage(error), 400);
      }
      const updated = await database()
        .prepare(`UPDATE tenants SET settings = ?, settings_version = settings_version + 1
          WHERE id = ? AND settings_version = ?`)
        .bind(JSON.stringify(securedSettings.envelope), user.tenant_id, row.settings_version)
        .run();
      if (Number(updated.meta.changes || 0) === 1) {
        return json({
          ok: true,
          ...settingsForClient(securedSettings.settings),
          version: row.settings_version + 1,
        });
      }
    }
    throw new ApiError("数据源设置正在被其他管理员更新，请重试", 409);
  }

  if (path[0] === "brief" && path[1] === "export" && method === "POST") {
    return exportBrief(request);
  }
  if (path[0] === "brief" && path[1] === "import" && method === "POST") {
    return importBrief(request);
  }
  if (path[0] === "keepamore" && path[1] === "import" && method === "POST") {
    return importKeepaMoreResearch(request, user);
  }

  if (path[0] === "runs" && path.length >= 2) {
    const runId = runIdFrom(path);
    if (path.length === 2 && method === "GET") {
      const status = await getRunStatus(runId, user.tenant_id);
      if (!status) throw new ApiError("运行不存在", 404);
      const etag = runEntityTag(runId, status.updated_at);
      const notModified = conditionalNotModified(request, etag);
      if (notModified) return notModified;
      const run = await getRun(runId, user.tenant_id);
      if (!run) throw new ApiError("运行不存在", 404);
      return json(runForDiagnosticDelivery(run), 200, runCacheHeaders(runId, run.updated_at));
    }
    if (path.length === 2 && method === "PATCH") {
      return withDecisionMutationAdmission(
        user,
        runId,
        () => patchRun(request, user, runId),
      );
    }
    if (path.length === 2 && method === "DELETE") {
      requireAdmin(user);
      const existing = await getRun(runId, user.tenant_id);
      if (!existing) throw new ApiError("运行不存在", 404);
      if (["queued", "executing"].includes(existing.status)) {
        throw new ApiError("研究正在排队或执行，暂不能归档", 409);
      }
      const now = Date.now() / 1000;
      await database()
        .prepare(`UPDATE runs SET deleted_at = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`)
        .bind(now, now, runId, user.tenant_id)
        .run();
      return json({ ok: true, archived: true });
    }
    if (path[2] === "status" && method === "GET") {
      const status = await getRunStatus(runId, user.tenant_id);
      if (!status) throw new ApiError("运行不存在", 404);
      const etag = runEntityTag(runId, status.updated_at);
      const notModified = conditionalNotModified(request, etag);
      if (notModified) return notModified;
      return json(status, 200, runCacheHeaders(runId, status.updated_at));
    }
    if (path[2] === "confirm" && method === "POST") return confirmRun(request, user, runId);
    if (path[2] === "concept" && path.length === 3 && method === "GET") {
      return getConcept(request, user, runId);
    }
    if (path[2] === "concept" && path[3] === "start" && method === "POST") {
      return withDecisionMutationAdmission(
        user,
        runId,
        () => startConcept(request, user, runId),
      );
    }
    if (path[2] === "concept" && path[3] === "regenerate" && method === "POST") {
      return withDecisionMutationAdmission(
        user,
        runId,
        () => regenerateConcept(request, user, runId),
      );
    }
    if (path[2] === "concept" && path[3] === "confirm" && method === "POST") {
      return approveConcept(request, user, runId);
    }
    if (path[2] === "concept" && path[3] === "adopt" && method === "POST") {
      return withDecisionMutationAdmission(
        user,
        runId,
        () => adoptConcept(request, user, runId),
      );
    }
    if (path[2] === "rerun" && method === "POST") return rerun(request, user, runId);
    if (path[2] === "restore" && method === "POST") {
      requireAdmin(user);
      const now = Date.now() / 1000;
      const restored = await database()
        .prepare(`UPDATE runs SET deleted_at = NULL, updated_at = ?
          WHERE id = ? AND tenant_id = ? AND deleted_at IS NOT NULL`)
        .bind(now, runId, user.tenant_id)
        .run();
      if (Number(restored.meta.changes || 0) !== 1) throw new ApiError("归档记录不存在", 404);
      return json(await getRun(runId, user.tenant_id));
    }
    if (path[2] === "export-check" && method === "GET") {
      const report = await reportForOfficialExport(
        await getRun(runId, user.tenant_id),
        exportExpectation(request),
      );
      const decisionRecord = report.decision_record as Record<string, unknown>;
      return json({
        ok: true,
        edition: decisionRecord.export_edition,
        decision_status: decisionRecord.status,
        report_sha256: decisionRecord.report_sha256,
        report_version: decisionRecord.report_version,
      });
    }
    if (path[2] === "export.json" && method === "GET") {
      const report = await reportForOfficialExport(
        await getRun(runId, user.tenant_id),
        exportExpectation(request),
      );
      return text(JSON.stringify(report, null, 2), "application/json; charset=utf-8", `metis-${runId}.json`);
    }
    if (path[2] === "export.md" && method === "GET") {
      const report = await reportForOfficialExport(
        await getRun(runId, user.tenant_id),
        exportExpectation(request),
      );
      return text(reportToMarkdown(report), "text/markdown; charset=utf-8", `metis-${runId}.md`);
    }
    if ((path[2] === "export.pdf" || path[2] === "export.pptx") && method === "GET") {
      throw new ApiError("线上版请使用报告中的“打印 / 保存为 PDF”，PPTX 将在后续版本恢复", 501);
    }
    if (path[2] === "export" && path[3] === "feishu" && method === "POST") {
      throw new ApiError("线上版暂未配置飞书凭证", 501);
    }
  }

  throw new ApiError("接口不存在", 404);
}

async function handle(request: Request, context: RouteContext): Promise<Response> {
  try {
    return await dispatch(request, context);
  } catch (error) {
    if (error instanceof ApiError) return json({ detail: error.message }, error.status, error.headers);
    if (error instanceof CreditDomainError) {
      return json({ detail: error.message, code: error.code }, error.status);
    }
    if (error instanceof SchemaInitializationInProgressError) {
      return json(
        { detail: "数据库正在完成上线初始化，请稍后重试" },
        503,
        { "retry-after": String(error.retryAfterSeconds) },
      );
    }
    console.error(error);
    return json({ detail: "服务暂时不可用，请稍后重试" }, 500);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;

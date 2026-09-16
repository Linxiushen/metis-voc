import { env } from "cloudflare:workers";
import { database, ensureSchema, getRun } from "./database";
import { enrichReportWithModels } from "./llm";
import { buildReport, categoryLabel } from "./report";
import { finalizeReportForPersistence } from "./report-integrity";
import {
  createKeepaMoreClient,
  KeepaMoreApiError,
} from "./keepamore";
import {
  buildKeepaMoreReferenceReport,
  keepaMoreProductToEvidence,
  type KeepaMoreResearchDataset,
} from "./keepamore-report";
import { readSecretSettings } from "./settings";
import {
  paidProviderCallsEnabled,
  tenantPlanAllowsPaidProviders,
} from "./provider-access";
import {
  CreditDomainError,
  debitCreditsForRule,
  refundCreditTransaction,
} from "./credits";

type QueueSender<T> = {
  send(message: T): Promise<void>;
};

export type ResearchJobMessage = {
  runId: number;
  tenantId: number;
  claimedAt: number;
};

export type ResearchJobResult =
  | { outcome: "completed" | "failed" | "stale"; runId: number }
  | { outcome: "busy"; runId: number; retryAfterSeconds: number };

const runtimeEnv = env as unknown as {
  RESEARCH_QUEUE?: QueueSender<ResearchJobMessage>;
  KEEPAMORE_API_KEY?: string;
  KEEPAMORE_BASE_URL?: string;
  SETTINGS_ENCRYPTION_KEY?: string;
};

export const MAX_ACTIVE_RESEARCH_PER_TENANT = 3;
const RESEARCH_EXECUTION_LEASE_SECONDS = 600;
const COMPLETION_WRITE_ATTEMPTS = 3;
const MAX_RESEARCH_DELIVERY_ATTEMPTS = 4;
const KEEPAMORE_MAX_PRODUCTS = 100;
const KEEPAMORE_MAX_SEARCH_PAGES = 10;
const RESEARCH_RECONCILIATION_DELAY_SECONDS = 30;
const RESEARCH_RECONCILIATION_LIMIT = 100;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function keepaMoreRequested(plan: Record<string, unknown>): boolean {
  const brief = record(plan.research_brief);
  return record(brief.sources).keepamore === true;
}

function keepaMoreDomain(marketplace: string): number {
  const code = String(marketplace || "US").replace(/^Amazon\s+/i, "").trim().toUpperCase();
  if (code !== "US") {
    throw new Error(`KeepaMore 当前仅支持 Amazon US（USD）；收到站点 ${marketplace}`);
  }
  return 1;
}

async function keepaMoreApiKey(tenantId: number): Promise<string> {
  const globalKey = String(runtimeEnv.KEEPAMORE_API_KEY || "").trim();
  const row = await database()
    .prepare("SELECT settings FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ settings: string | null }>();
  if (row?.settings) {
    const encryptionKey = String(runtimeEnv.SETTINGS_ENCRYPTION_KEY || "").trim();
    if (!encryptionKey) {
      if (!globalKey) throw new Error("数据源加密密钥未配置，无法读取 KeepaMore API Key");
    } else {
      const settings = await readSecretSettings(row.settings, tenantId, encryptionKey);
      const tenantKey = String(settings.keepamore_api_key || "").trim();
      if (tenantKey) return tenantKey;
    }
  }
  if (globalKey) {
    // Publicly registered trial tenants may supply their own key, but cannot
    // spend the deployment owner's shared subscription by selecting this source.
    if (!await tenantCanUsePaidProviders(tenantId)) {
      throw new Error("当前租户套餐无权使用平台共享的 KeepaMore API 额度；请配置自有 API Key 或使用免费导出文件");
    }
    return globalKey;
  }
  throw new Error(
    "KeepaMore API Key 未配置。KeepaMore 免费会员不含 API 额度；可在数据源设置中填入购买套餐后生成的 km_ Key，或改用免费网页导出文件。",
  );
}

async function buildKeepaMoreReport(
  tenantId: number,
  category: string,
  marketplace: string,
  plan: Record<string, unknown>,
  heartbeat: (stage: string) => Promise<void>,
): Promise<ReturnType<typeof buildReport>> {
  if (!paidProviderCallsEnabled()) {
    throw new Error("付费数据源全局安全开关当前关闭，KeepaMore 调用未执行");
  }
  const domainId = keepaMoreDomain(marketplace);
  const dataWindowDays = Math.max(30, Math.min(365, Number(plan.data_window_days) || 90));
  const client = createKeepaMoreClient({
    apiKey: await keepaMoreApiKey(tenantId),
    baseUrl: String(runtimeEnv.KEEPAMORE_BASE_URL || "").trim() || undefined,
  });

  try {
    const searchPages: Awaited<ReturnType<typeof client.searchProducts>>[] = [];
    const searchWarnings: string[] = [];
    const uniqueAsins = new Set<string>();
    const searchObservationsByAsin = new Map<string, Array<{
      query: string;
      batch: number;
      search_position: number;
      observed_at: string;
      source_url: string;
    }>>();
    for (let page = 0; page < KEEPAMORE_MAX_SEARCH_PAGES; page += 1) {
      await heartbeat(`keepamore_search_page_${page + 1}`);
      let search: Awaited<ReturnType<typeof client.searchProducts>>;
      try {
        search = await client.searchProducts({
          term: category,
          domain: domainId,
          page,
          asinsOnly: true,
          detailLevel: "summary",
        });
      } catch (error) {
        if (searchPages.length === 0) throw error;
        searchWarnings.push(
          `KeepaMore 搜索第 ${page + 1} 页未完成，已保留前 ${searchPages.length} 页：${failureMessage(error)}`,
        );
        break;
      }
      searchPages.push(search);
      let added = 0;
      for (const [position, rawAsin] of search.asins.entries()) {
        const asin = String(rawAsin || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
        if (!uniqueAsins.has(asin) && uniqueAsins.size >= KEEPAMORE_MAX_PRODUCTS) break;
        if (!uniqueAsins.has(asin)) {
          uniqueAsins.add(asin);
          added += 1;
        }
        const observations = searchObservationsByAsin.get(asin) || [];
        observations.push({
          query: search.query || category,
          batch: search.page + 1,
          search_position: position + 1,
          observed_at: search.observedAt,
          source_url: search.sourceRef,
        });
        searchObservationsByAsin.set(asin, observations);
      }
      if (
        uniqueAsins.size >= KEEPAMORE_MAX_PRODUCTS ||
        search.asins.length === 0 ||
        added === 0
      ) {
        break;
      }
    }
    const asins = [...uniqueAsins];
    if (!asins.length) throw new Error(`KeepaMore 没有找到与“${category}”匹配的 Amazon 商品`);
    await heartbeat("keepamore_product_enrichment");
    const enrichment = await client.getProducts({
      asins,
      domain: domainId,
      stats: dataWindowDays,
      history: true,
      rating: true,
      buybox: true,
      detailLevel: "full",
      method: "POST",
    });
    const products = enrichment.products.map((product) => {
      const evidence = keepaMoreProductToEvidence(product);
      const observations = searchObservationsByAsin.get(evidence.asin) || [];
      if (!observations.length) return evidence;
      const sourceQueries = [...new Set(observations.map((observation) => observation.query))];
      return {
        ...evidence,
        search_position: observations[0]?.search_position ?? evidence.search_position,
        source_queries: sourceQueries,
        query_hit_count: observations.length,
        observations,
      };
    });
    const providerErrors = [
      ...searchPages.flatMap((search) => search.errors),
      ...enrichment.errors,
    ].map((error) =>
      [error.asin, error.code, error.message, error.errorId && `errorId=${error.errorId}`]
        .filter(Boolean)
        .join(" · ")
    );
    const quota = enrichment.metadata.quota;
    const dataset: KeepaMoreResearchDataset = {
      keyword: category,
      marketplace: marketplace.replace(/^Amazon\s+/i, "").toUpperCase(),
      domain: domainId,
      observed_at: enrichment.observedAt,
      products,
      source_urls: [
        ...new Set(searchPages.map((search) => search.sourceRef).filter(Boolean)),
        enrichment.sourceRef,
      ],
      estimated_units: searchPages.length * 5 + asins.length,
      warnings: [
        ...searchPages.flatMap((search) => search.warnings),
        ...searchWarnings,
        ...enrichment.warnings,
      ],
      provider_errors: providerErrors,
      quota: {
        remaining: quota.day.remaining ?? quota.month.remaining ?? quota.minute.remaining,
        refill_at: null,
      },
      queries: [category],
      batch_count: searchPages.length,
    };
    return buildKeepaMoreReferenceReport(dataset, record(plan.research_brief)) as ReturnType<typeof buildReport>;
  } catch (error) {
    if (error instanceof KeepaMoreApiError && error.retryable) throw error;
    if (error instanceof KeepaMoreApiError && error.code === "QUOTA_NO_SUBSCRIPTION") {
      throw new Error(
        "KeepaMore 免费会员不支持 API（QUOTA_NO_SUBSCRIPTION）。请上传免费网页导出，或购买 9.9 元 / 3 天 API 试用包后重试。",
      );
    }
    if (error instanceof KeepaMoreApiError && /^QUOTA_/.test(error.code)) {
      throw new Error(`KeepaMore 额度或限流阻止了本次研究：${error.code}${error.errorId ? ` · errorId=${error.errorId}` : ""}`);
    }
    throw error;
  }
}

export function researchQueueConfigured(): boolean {
  return Boolean(runtimeEnv.RESEARCH_QUEUE?.send);
}

export async function enqueueResearchJob(message: ResearchJobMessage): Promise<void> {
  const queue = runtimeEnv.RESEARCH_QUEUE;
  if (!queue) throw new Error("研究任务队列未配置");
  await queue.send(message);
}

export async function reconcileResearchQueue(
  nowSeconds = Date.now() / 1_000,
  limit = RESEARCH_RECONCILIATION_LIMIT,
): Promise<{ scanned: number; enqueued: number; failed: number }> {
  const queue = runtimeEnv.RESEARCH_QUEUE;
  if (!queue) throw new Error("研究任务队列未配置");
  const boundedLimit = Math.max(1, Math.min(RESEARCH_RECONCILIATION_LIMIT, Math.trunc(limit)));
  const rows = await database()
    .prepare(`SELECT id, tenant_id, updated_at FROM runs
      WHERE deleted_at IS NULL AND (
        (status = 'queued' AND updated_at <= ?)
        OR (status = 'executing' AND (
          (execution_lease_until IS NOT NULL AND execution_lease_until <= ?)
          OR (execution_lease_until IS NULL AND updated_at <= ?)
        ))
      )
      ORDER BY updated_at ASC, id ASC LIMIT ?`)
    .bind(
      nowSeconds - RESEARCH_RECONCILIATION_DELAY_SECONDS,
      nowSeconds,
      nowSeconds - RESEARCH_EXECUTION_LEASE_SECONDS,
      boundedLimit,
    )
    .all<{ id: number; tenant_id: number; updated_at: number }>();
  let enqueued = 0;
  let failed = 0;
  for (const row of rows.results || []) {
    try {
      await queue.send({
        runId: Number(row.id),
        tenantId: Number(row.tenant_id),
        claimedAt: Number(row.updated_at),
      });
      enqueued += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({
        event: "research_queue_reconciliation",
        outcome: "enqueue_failed",
        run_id: Number(row.id),
        tenant_id: Number(row.tenant_id),
        error: failureMessage(error),
      }));
    }
  }
  return { scanned: (rows.results || []).length, enqueued, failed };
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "研究执行失败");
  return message.trim().slice(0, 1_000) || "研究执行失败";
}

export function isResearchJobMessage(message: unknown): message is ResearchJobMessage {
  const candidate = record(message);
  return Number.isInteger(candidate.runId) && Number(candidate.runId) > 0 &&
    Number.isInteger(candidate.tenantId) && Number(candidate.tenantId) > 0 &&
    Number.isFinite(candidate.claimedAt) && Number(candidate.claimedAt) > 0;
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 50));
}

class ResearchLeaseLostError extends Error {
  constructor(readonly stage: string) {
    super(`研究执行租约已失效：${stage}`);
    this.name = "ResearchLeaseLostError";
  }
}

async function renewResearchLease(
  message: ResearchJobMessage,
  leaseToken: string,
  stage: string,
): Promise<void> {
  const renewedUntil = Date.now() / 1_000 + RESEARCH_EXECUTION_LEASE_SECONDS;
  const renewed = await database()
    .prepare(`UPDATE runs SET execution_lease_until = ?
      WHERE id = ? AND tenant_id = ? AND status = 'executing'
        AND updated_at = ? AND execution_token = ? AND deleted_at IS NULL`)
    .bind(
      renewedUntil,
      message.runId,
      message.tenantId,
      message.claimedAt,
      leaseToken,
    )
    .run();
  if (Number(renewed.meta.changes || 0) !== 1) {
    throw new ResearchLeaseLostError(stage);
  }
}

async function expireResearchLeaseForRetry(
  message: ResearchJobMessage,
  leaseToken: string,
): Promise<boolean> {
  const expired = await database()
    .prepare(`UPDATE runs SET execution_lease_until = ?
      WHERE id = ? AND tenant_id = ? AND status = 'executing'
        AND updated_at = ? AND execution_token = ? AND deleted_at IS NULL`)
    .bind(
      Date.now() / 1_000 - 1,
      message.runId,
      message.tenantId,
      message.claimedAt,
      leaseToken,
    )
    .run();
  return Number(expired.meta.changes || 0) === 1;
}

async function tenantCanUsePaidProviders(tenantId: number): Promise<boolean> {
  if (!paidProviderCallsEnabled()) return false;
  const tenant = await database()
    .prepare("SELECT plan FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ plan: string }>();
  return tenantPlanAllowsPaidProviders(tenant?.plan);
}

type ResearchCreditCharge = Awaited<ReturnType<typeof debitCreditsForRule>>;

async function chargeResearchRun(run: {
  id: number;
  tenant_id: number;
  user_id: number;
}, claimedAt: number): Promise<ResearchCreditCharge> {
  if (!Number.isSafeInteger(run.user_id) || run.user_id <= 0) {
    throw new CreditDomainError("invalid_credit_operation", "研究任务缺少有效的发起用户", 409);
  }
  return debitCreditsForRule({
    tenantId: run.tenant_id,
    userId: run.user_id,
    actorUserId: run.user_id,
    ruleKey: "research_generation",
    businessId: `research:${run.id}:${Math.round(claimedAt * 1_000)}`,
  });
}

async function refundResearchRun(
  run: { tenant_id: number; user_id: number },
  charge: ResearchCreditCharge | null,
  reason: string,
): Promise<void> {
  if (!charge?.charged || !charge.transaction) return;
  await refundCreditTransaction({
    tenantId: run.tenant_id,
    actorUserId: run.user_id,
    transaction: charge.transaction,
    reason,
  });
}

async function persistResearchCompletion(
  message: ResearchJobMessage,
  leaseToken: string,
  report: ReturnType<typeof buildReport>,
): Promise<number> {
  const persistedReport = finalizeReportForPersistence(report);
  let lastError: unknown;
  for (let attempt = 1; attempt <= COMPLETION_WRITE_ATTEMPTS; attempt += 1) {
    try {
      const completedAt = Date.now() / 1000;
      const completed = await database()
        .prepare(`UPDATE runs SET status = 'done', report = ?, verdict = ?,
          error_message = NULL, failed_at = NULL, execution_token = NULL,
          execution_lease_until = NULL, updated_at = ?
          WHERE id = ? AND tenant_id = ? AND status = 'executing'
            AND updated_at = ? AND execution_token = ? AND deleted_at IS NULL`)
        .bind(
          JSON.stringify(persistedReport),
          String(persistedReport.verdict || ""),
          completedAt,
          message.runId,
          message.tenantId,
          message.claimedAt,
          leaseToken,
        )
        .run();
      return Number(completed.meta.changes || 0);
    } catch (error) {
      lastError = error;
      console.error(JSON.stringify({
        event: "research_job_completion_write",
        outcome: attempt < COMPLETION_WRITE_ATTEMPTS ? "retry" : "failed",
        run_id: message.runId,
        tenant_id: message.tenantId,
        attempt,
        error: failureMessage(error),
      }));
      if (attempt < COMPLETION_WRITE_ATTEMPTS) await retryDelay(attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(failureMessage(lastError));
}

export async function executeResearchJob(
  message: ResearchJobMessage,
  deliveryAttempt = 1,
): Promise<ResearchJobResult> {
  if (!isResearchJobMessage(message)) throw new Error("研究队列消息无效");
  await ensureSchema();

  const run = await getRun(message.runId, message.tenantId);
  if (!run || !["queued", "executing"].includes(run.status) || run.updated_at !== message.claimedAt) {
    return { outcome: "stale", runId: message.runId };
  }

  const leaseToken = crypto.randomUUID();
  const leaseStartedAt = Date.now() / 1000;
  const leaseUntil = leaseStartedAt + RESEARCH_EXECUTION_LEASE_SECONDS;
  let started;
  if (run.status === "queued") {
    started = await database()
      .prepare(`UPDATE runs SET status = 'executing'
          , execution_token = ?, execution_lease_until = ?
        WHERE id = ? AND tenant_id = ? AND status = 'queued'
          AND updated_at = ? AND deleted_at IS NULL`)
      .bind(leaseToken, leaseUntil, message.runId, message.tenantId, message.claimedAt)
      .run();
  } else {
    const activeUntil = Number(run.execution_lease_until || 0);
    if (activeUntil > leaseStartedAt) {
      return {
        outcome: "busy",
        runId: message.runId,
        retryAfterSeconds: Math.max(1, Math.ceil(activeUntil - leaseStartedAt)),
      };
    }
    const previousToken = String(run.execution_token || "");
    const tokenGuard = previousToken ? "execution_token = ?" : "execution_token IS NULL";
    const statement = database().prepare(`UPDATE runs
      SET execution_token = ?, execution_lease_until = ?
      WHERE id = ? AND tenant_id = ? AND status = 'executing'
        AND updated_at = ? AND ${tokenGuard} AND deleted_at IS NULL
        AND (execution_lease_until IS NULL OR execution_lease_until <= ?)`);
    started = previousToken
      ? await statement.bind(
        leaseToken,
        leaseUntil,
        message.runId,
        message.tenantId,
        message.claimedAt,
        previousToken,
        leaseStartedAt,
      ).run()
      : await statement.bind(
        leaseToken,
        leaseUntil,
        message.runId,
        message.tenantId,
        message.claimedAt,
        leaseStartedAt,
      ).run();
  }
  if (Number(started.meta.changes || 0) !== 1) {
    return { outcome: "stale", runId: message.runId };
  }

  const startedAt = Date.now();
  const heartbeat = (stage: string) => renewResearchLease(message, leaseToken, stage);
  const plan = run.research_plan || {};
  const category = String(
    plan.category_scope || categoryLabel(run.input_mode, run.input_payload),
  ).trim().slice(0, 160);
  const boundedDeliveryAttempt = Math.max(1, Math.min(100, Math.trunc(deliveryAttempt) || 1));

  let creditCharge: ResearchCreditCharge | null = null;
  try {
    creditCharge = await chargeResearchRun(run, message.claimedAt);
  } catch (error) {
    if (!(error instanceof CreditDomainError)) {
      const releasedForRetry = await expireResearchLeaseForRetry(message, leaseToken);
      if (!releasedForRetry) return { outcome: "stale", runId: message.runId };
      throw error;
    }
    const failedAt = Date.now() / 1_000;
    const failed = await database()
      .prepare(`UPDATE runs SET status = 'failed', error_message = ?, failed_at = ?,
        execution_token = NULL, execution_lease_until = NULL, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = 'executing'
          AND updated_at = ? AND execution_token = ? AND deleted_at IS NULL`)
      .bind(
        failureMessage(error),
        failedAt,
        failedAt,
        message.runId,
        message.tenantId,
        message.claimedAt,
        leaseToken,
      )
      .run();
    return {
      outcome: Number(failed.meta.changes || 0) === 1 ? "failed" : "stale",
      runId: message.runId,
    };
  }

  let report: ReturnType<typeof buildReport>;
  try {
    // A prior delivery may have persisted its terminal failure but crashed
    // before compensation. Resume settlement without paying the provider again.
    if (run.failed_at && run.error_message) throw new Error(run.error_message);
    report = keepaMoreRequested(plan)
      ? await buildKeepaMoreReport(
          message.tenantId,
          category,
          run.marketplace || "US",
          plan,
          heartbeat,
        )
      : buildReport(category, run.marketplace || "US", plan.research_brief || {});
    if (await tenantCanUsePaidProviders(message.tenantId)) {
      await heartbeat("model_enrichment_start");
      report = await enrichReportWithModels(report);
      await heartbeat("model_enrichment_complete");
    } else {
      report.ai_runtime = {
        status: "blocked",
        reason: "工作区计划或全局安全开关未授权付费模型调用。",
        generated_at: new Date().toISOString(),
      };
    }
    report = finalizeReportForPersistence(report);
    await heartbeat("report_persistence");
  } catch (error) {
    if (error instanceof ResearchLeaseLostError) {
      console.warn(JSON.stringify({
        event: "research_job",
        outcome: "stale",
        run_id: message.runId,
        tenant_id: message.tenantId,
        duration_ms: Date.now() - startedAt,
        stage: error.stage,
      }));
      return { outcome: "stale", runId: message.runId };
    }
    if (
      error instanceof KeepaMoreApiError && error.retryable &&
      boundedDeliveryAttempt < MAX_RESEARCH_DELIVERY_ATTEMPTS
    ) {
      const releasedForRetry = await expireResearchLeaseForRetry(message, leaseToken);
      if (!releasedForRetry) return { outcome: "stale", runId: message.runId };
      console.warn(JSON.stringify({
        event: "research_job",
        outcome: "retry",
        run_id: message.runId,
        tenant_id: message.tenantId,
        duration_ms: Date.now() - startedAt,
        provider: "keepamore",
        code: error.code,
        status: error.status,
        retry_after_ms: error.retryAfterMs,
      }));
      throw error;
    }
    // Record the decision under the execution fence before refunding. A stale
    // worker must not refund a newer worker's successful execution, and a crash
    // during compensation must not turn a terminal failure back into paid work.
    const failureRecorded = await database()
      .prepare(`UPDATE runs SET error_message = ?, failed_at = ?, execution_lease_until = ?
        WHERE id = ? AND tenant_id = ? AND status = 'executing'
          AND updated_at = ? AND execution_token = ? AND deleted_at IS NULL`)
      .bind(
        failureMessage(error),
        Date.now() / 1_000,
        Date.now() / 1_000 + RESEARCH_EXECUTION_LEASE_SECONDS,
        message.runId,
        message.tenantId,
        message.claimedAt,
        leaseToken,
      )
      .run();
    if (Number(failureRecorded.meta.changes || 0) !== 1) {
      return { outcome: "stale", runId: message.runId };
    }
    try {
      await refundResearchRun(
        run,
        creditCharge,
        boundedDeliveryAttempt >= MAX_RESEARCH_DELIVERY_ATTEMPTS
          ? "研究任务重试耗尽自动退回"
          : "研究任务执行失败自动退回",
      );
    } catch (refundError) {
      const releasedForRetry = await expireResearchLeaseForRetry(message, leaseToken);
      if (!releasedForRetry) return { outcome: "stale", runId: message.runId };
      console.error(JSON.stringify({
        event: "research_credit_compensation",
        outcome: "retry",
        run_id: message.runId,
        tenant_id: message.tenantId,
        error: failureMessage(refundError),
      }));
      throw refundError;
    }
    const failedAt = Date.now() / 1000;
    const failed = await database()
      .prepare(`UPDATE runs SET status = 'failed', error_message = ?, failed_at = ?,
        execution_token = NULL, execution_lease_until = NULL, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = 'executing'
          AND updated_at = ? AND execution_token = ? AND deleted_at IS NULL`)
      .bind(
        failureMessage(error),
        failedAt,
        failedAt,
        message.runId,
        message.tenantId,
        message.claimedAt,
        leaseToken,
      )
      .run();
    const outcome = Number(failed.meta.changes || 0) === 1 ? "failed" : "stale";
    console.error(JSON.stringify({
      event: "research_job",
      outcome,
      run_id: message.runId,
      tenant_id: message.tenantId,
      duration_ms: Date.now() - startedAt,
      error: failureMessage(error),
    }));
    return { outcome, runId: message.runId };
  }

  let completedChanges: number;
  try {
    completedChanges = await persistResearchCompletion(message, leaseToken, report);
  } catch (error) {
    console.error(JSON.stringify({
      event: "research_job",
      outcome: "retry",
      run_id: message.runId,
      tenant_id: message.tenantId,
      duration_ms: Date.now() - startedAt,
      error: failureMessage(error),
    }));
    throw error;
  }
  if (completedChanges !== 1) {
    return { outcome: "stale", runId: message.runId };
  }
  console.log(JSON.stringify({
    event: "research_job",
    outcome: "completed",
    run_id: message.runId,
    tenant_id: message.tenantId,
    duration_ms: Date.now() - startedAt,
    ai_status: report.ai_runtime?.status || "unknown",
  }));
  return { outcome: "completed", runId: message.runId };
}

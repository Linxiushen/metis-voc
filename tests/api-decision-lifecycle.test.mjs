import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const ADMIN_TOKEN = "A".repeat(32);
const MEMBER_TOKEN = "M".repeat(32);
const SECOND_ADMIN_TOKEN = "B".repeat(32);
const TEST_ENV_KEY = "__METIS_API_CONTRACT_TEST_ENV__";
const SCENE_DESIGN_DNA_ID = "metis-dna-nightstands-board-selected-v1";
const SCENE_SUITE_SLOTS = [
  ["scene-01-hero-master", "hero_master", "主视觉｜工作室 3/4 Master"],
  ["scene-02-primary-lifestyle", "primary_lifestyle", "主场景｜核心空间应用"],
  ["scene-03-secondary-lifestyle", "secondary_lifestyle", "副场景｜扩展空间应用"],
  ["scene-04-functional-open-state", "functional_open_state", "功能场景｜开合与收纳"],
  ["scene-05-detail-cmf", "detail_cmf", "细节特写｜材质与工艺"],
  ["scene-06-packaging-logistics", "packaging_logistics", "履约视图｜包装与交付"],
];
const REPORT_INTEGRITY_CONTRACT = "metis.report-integrity.v1";

const verifiedReport = {
  category: "Nightstands",
  marketplace: "Amazon US",
  verdict: "有条件进入",
  evidence_mode: "verified_research",
  decision_readiness: "ready_for_review",
  report_version: "test-report-v1",
  title: "Nightstands 选品决策报告",
  order: ["exec_summary_decision_scorecard"],
  modules: {
    exec_summary_decision_scorecard: {
      decision: {
        verdict: "conditional_go",
        confidence: "Medium",
        one_liner: "测试报告具备最小可审阅结构。",
      },
    },
  },
  ext_meta: {},
  report_integrity: {
    contract_version: REPORT_INTEGRITY_CONTRACT,
    status: "complete",
    structural_status: "complete",
    evidence_status: "verified",
    required_module_count: 1,
    populated_module_count: 1,
    page_contract: {
      validation_scope: "backend_source_path_resolution",
      render_status: "not_evaluated",
      expected_pages: 0,
      actual_pages: 0,
      required_blocks: 0,
      source_resolved_required_blocks: 0,
    },
    errors: [],
    repairs: [],
    evidence_register: [],
    missing_required_blocks: [],
  },
  data_availability: {
    contract_version: REPORT_INTEGRITY_CONTRACT,
    status: "verified",
    declared_gaps: [],
    hypotheses: [],
    missing_required_data: [],
  },
};

function rawRun(overrides = {}) {
  const report = overrides.report || verifiedReport;
  return {
    id: 101,
    tenant_id: 42,
    user_id: 7,
    title: "Nightstands 选品决策报告",
    input_mode: "board_research_2026",
    input_payload: JSON.stringify({ slug: "nightstands", version: "test-report-v1" }),
    marketplace: "US",
    view_profile: "P1",
    data_scope: "public_ok",
    status: "done",
    verdict: "有条件进入",
    research_plan: "{}",
    report: JSON.stringify(report),
    decision_outcome: null,
    outcome_note: null,
    reviewed: 0,
    reviewer_id: null,
    reviewer_name: null,
    reviewed_at: null,
    review_checks: null,
    review_report_hash: null,
    error_message: null,
    failed_at: null,
    deleted_at: null,
    mutation_token: null,
    request_key: null,
    execution_token: null,
    execution_lease_until: null,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    ...overrides,
    report: JSON.stringify(report),
  };
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function parseReport(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

class MemoryStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = normalizeSql(sql);
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    const sql = this.sql.toLowerCase();
    if (sql.includes("from sessions s join users u")) {
      const token = this.args[0];
      if (token === createHash("sha256").update(ADMIN_TOKEN).digest("hex")) {
        return { id: 7, tenant_id: 42, email: "admin@example.com", name: "审核管理员", role: "admin", plan: "pro" };
      }
      if (token === createHash("sha256").update(MEMBER_TOKEN).digest("hex")) {
        return { id: 8, tenant_id: 42, email: "member@example.com", name: "普通成员", role: "member", plan: "pro" };
      }
      if (token === createHash("sha256").update(SECOND_ADMIN_TOKEN).digest("hex")) {
        return { id: 9, tenant_id: 43, email: "admin-2@example.com", name: "第二租户管理员", role: "admin", plan: "pro" };
      }
      return null;
    }
    if (sql.startsWith("select * from runs where id = ?")) {
      const [id, tenantId] = this.args;
      const row = this.db.state.runs.find((item) =>
        item.id === id && item.tenant_id === tenantId && item.deleted_at == null
      );
      return row ? structuredClone(row) : null;
    }
    if (sql.startsWith("select * from runs where tenant_id = ? and request_key = ?")) {
      const [tenantId, requestKey] = this.args;
      const row = this.db.state.runs.find((item) =>
        item.tenant_id === tenantId && item.request_key === requestKey && item.deleted_at == null
      );
      return row ? structuredClone(row) : null;
    }
    if (sql.includes("case when report is null then 0 else 1 end as has_report")) {
      const [id, tenantId] = this.args;
      const row = this.db.state.runs.find((item) =>
        item.id === id && item.tenant_id === tenantId && item.deleted_at == null
      );
      return row ? {
        id: row.id,
        status: row.status,
        verdict: row.verdict,
        error_message: row.error_message,
        failed_at: row.failed_at,
        updated_at: row.updated_at,
        has_report: row.report == null ? 0 : 1,
      } : null;
    }
    if (sql.includes("as tenant_active") && sql.includes("as global_active")) {
      const [tenantId] = this.args;
      const active = this.db.state.runs.filter((item) =>
        ["queued", "executing"].includes(item.status) && item.deleted_at == null
      );
      return {
        tenant_active: active.filter((item) => item.tenant_id === tenantId).length,
        global_active: active.length,
      };
    }
    if (sql.includes("from concept_images") && sql.includes("order by id desc limit 1")) {
      const [runId, tenantId] = this.args.map(Number);
      const row = this.db.state.concepts
        .filter((item) => item.run_id === runId && item.tenant_id === tenantId)
        .sort((left, right) => right.id - left.id)[0];
      return row ? structuredClone(row) : null;
    }
    if (sql.startsWith("select id, tenant_id from users where email")) {
      return null;
    }
    if (sql.startsWith("select id from users where email")) {
      return { id: 7 };
    }
    if (sql.startsWith("select plan from tenants where id = ?")) {
      return { plan: "pro" };
    }
    if (sql.includes("from credit_rules") && sql.includes("rule_key = ?")) {
      const ruleKey = String(this.args[1] || "");
      const labels = {
        research_generation: "生成研究报告",
        scene_suite_generation: "生成专业场景套图",
      };
      return labels[ruleKey] ? {
        rule_key: ruleKey,
        label: labels[ruleKey],
        cost: 0,
        enabled: 0,
        updated_by: null,
        updated_at: 1_700_000_000,
      } : null;
    }
    if (sql.startsWith("select applied_at from system_migrations where key")) {
      const appliedAt = this.db.state.migrations.get(this.args[0]);
      return appliedAt == null ? null : { applied_at: appliedAt };
    }
    return null;
  }

  async all() {
    const sql = this.sql.toLowerCase();
    if (sql === "pragma table_info(users)") {
      return { results: [{ name: "id" }, { name: "role" }] };
    }
    if (sql === "pragma table_info(runs)") {
      return {
        results: [
          "id",
          "reviewer_id",
          "reviewer_name",
          "reviewed_at",
          "review_checks",
          "review_report_hash",
          "error_message",
          "failed_at",
          "deleted_at",
          "mutation_token",
          "request_key",
          "execution_token",
          "execution_lease_until",
        ].map((name) => ({ name })),
      };
    }
    if (sql === "pragma table_info(concept_images)") {
      return {
        results: ["id", "sync_lease_token", "sync_lease_until", "next_poll_at"].map((name) => ({ name })),
      };
    }
    if (sql.includes("as report_metadata")) {
      const tenantId = this.args[0];
      const archivedOnly = sql.includes("deleted_at is not null");
      const hasCursor = archivedOnly
        ? sql.includes("deleted_at < ?")
        : sql.includes("and id < ?");
      const limit = Number(this.args.at(-1));
      const beforeId = hasCursor
        ? Number(archivedOnly ? this.args.at(-2) : this.args.at(-2))
        : 0;
      const beforeDeletedAt = archivedOnly && hasCursor ? Number(this.args[1]) : 0;
      const results = this.db.state.runs
        .filter((row) =>
          row.tenant_id === tenantId &&
          (archivedOnly ? row.deleted_at != null : row.deleted_at == null) &&
          (!hasCursor || (archivedOnly
            ? row.deleted_at < beforeDeletedAt ||
              (row.deleted_at === beforeDeletedAt && row.id < beforeId)
            : row.id < beforeId))
        )
        .sort((left, right) => archivedOnly
          ? (right.deleted_at - left.deleted_at) || (right.id - left.id)
          : right.id - left.id
        )
        .map((row) => {
          const { report, ...brief } = structuredClone(row);
          delete brief.research_plan;
          const parsed = parseReport(report);
          return {
            ...brief,
            report_metadata: JSON.stringify([
              parsed?.evidence_mode ?? null,
              parsed?.decision_readiness ?? null,
            ]),
          };
        })
        .slice(0, limit);
      return { results };
    }
    if (sql.startsWith("select id, tenant_id, updated_at from runs") &&
      sql.includes("status = 'queued'") && sql.includes("status = 'executing'")) {
      const [queuedBefore, leaseBefore, missingLeaseBefore, limit] = this.args.map(Number);
      const results = this.db.state.runs
        .filter((row) => row.deleted_at == null && (
          (row.status === "queued" && row.updated_at <= queuedBefore) ||
          (row.status === "executing" && (
            (row.execution_lease_until != null && row.execution_lease_until <= leaseBefore) ||
            (row.execution_lease_until == null && row.updated_at <= missingLeaseBefore)
          ))
        ))
        .sort((left, right) => left.updated_at - right.updated_at || left.id - right.id)
        .slice(0, limit)
        .map((row) => ({ id: row.id, tenant_id: row.tenant_id, updated_at: row.updated_at }));
      return { results };
    }
    if (sql.includes("from runs") && sql.includes("input_mode = 'board_research_2026'")) {
      return { results: [] };
    }
    if (sql.includes("select artifacts from concept_images")) {
      return { results: [] };
    }
    return { results: [] };
  }

  async run() {
    const sql = this.sql.toLowerCase();
    if (
      sql.startsWith("update runs set status = 'failed'") &&
      sql.includes("where status = 'queued' and updated_at <= ?")
    ) {
      const [failedAt, updatedAt, queuedCutoff] = this.args;
      let changes = 0;
      for (const row of this.db.state.runs) {
        if (row.status !== "queued" || row.deleted_at != null || row.updated_at > queuedCutoff) continue;
        row.status = "failed";
        row.error_message = "研究排队超过 1 小时且未被处理，已由系统收口为失败。";
        row.failed_at = failedAt;
        row.execution_token = null;
        row.execution_lease_until = null;
        row.updated_at = updatedAt;
        changes += 1;
      }
      return { meta: { changes } };
    }
    if (
      sql.startsWith("update runs set status = 'failed'") &&
      sql.includes("where status = 'executing'") &&
      sql.includes("execution_lease_until <= ?")
    ) {
      const [failedAt, updatedAt, expiredLeaseCutoff, missingLeaseCutoff] = this.args;
      let changes = 0;
      for (const row of this.db.state.runs) {
        const leaseExpiredBeyondGrace = row.execution_lease_until != null &&
          row.execution_lease_until <= expiredLeaseCutoff;
        const missingLeaseIsStale = row.execution_lease_until == null &&
          row.updated_at <= missingLeaseCutoff;
        if (
          row.status !== "executing" || row.deleted_at != null ||
          (!leaseExpiredBeyondGrace && !missingLeaseIsStale)
        ) continue;
        row.status = "failed";
        row.error_message = "研究执行租约过期且未恢复，已由系统收口为失败。";
        row.failed_at = failedAt;
        row.execution_token = null;
        row.execution_lease_until = null;
        row.updated_at = updatedAt;
        changes += 1;
      }
      return { meta: { changes } };
    }
    const update = this.sql.match(/^UPDATE runs SET (.+?) WHERE (.+)$/i);
    if (update) {
      const assignments = update[1].split(",").map((value) => value.trim());
      const assignmentArgCount = assignments.filter((assignment) => /= \?$/i.test(assignment)).length;
      const guardArgs = this.args.slice(assignmentArgCount);
      const guardColumns = Array.from(update[2].matchAll(/\b(\w+) = \?/gi), (match) => match[1]);
      const hasActiveRunLimit = update[2].toLowerCase().includes("from runs as active_run");
      const hasGlobalActiveRunLimit = update[2].toLowerCase().includes("from runs as global_active_run");
      const activeLimitCount = Number(hasActiveRunLimit) + Number(hasGlobalActiveRunLimit);
      const hasExpiredLeaseGuard = /\(execution_lease_until IS NULL OR execution_lease_until <= \?\)/i.test(update[2]);
      assert.equal(
        guardArgs.length,
        guardColumns.length + activeLimitCount + Number(hasExpiredLeaseGuard),
        `unsupported UPDATE guards in test D1: ${update[2]}`,
      );
      const guards = Object.fromEntries(guardColumns.map((column, index) =>
        [column.toLowerCase(), guardArgs[index]]
      ));
      const runId = guards.id;
      const tenantId = guards.tenant_id;
      const row = this.db.state.runs.find((item) => item.id === runId && item.tenant_id === tenantId);
      if (!row) return { meta: { changes: 0 } };
      if (this.db.state.beforeRunUpdate) {
        const hook = this.db.state.beforeRunUpdate;
        if (hook(row, this.sql) !== false) this.db.state.beforeRunUpdate = null;
      }
      if (/\bdeleted_at is null\b/i.test(this.sql) && row.deleted_at != null) {
        return { meta: { changes: 0 } };
      }
      if (/\bdeleted_at is not null\b/i.test(this.sql) && row.deleted_at == null) {
        return { meta: { changes: 0 } };
      }
      const nullGuardColumns = Array.from(
        update[2].replace(/\(execution_lease_until IS NULL OR execution_lease_until <= \?\)/i, "").matchAll(/\b(\w+) IS NULL\b/gi),
        (match) => match[1].toLowerCase(),
      );
      if (nullGuardColumns.some((column) => row[column] != null)) {
        return { meta: { changes: 0 } };
      }
      if (hasExpiredLeaseGuard && row.execution_lease_until != null &&
        row.execution_lease_until > Number(guardArgs.at(-1))) {
        return { meta: { changes: 0 } };
      }
      if (
        /\bstatus in \('await_clarify', 'failed'\)/i.test(this.sql) &&
        !["await_clarify", "failed"].includes(row.status)
      ) {
        return { meta: { changes: 0 } };
      }
      for (const status of ["queued", "executing"]) {
        if (new RegExp(`\\bstatus = '${status}'`, "i").test(update[2]) && row.status !== status) {
          return { meta: { changes: 0 } };
        }
      }
      if (hasActiveRunLimit) {
        const maxActive = Number(guardArgs.at(-activeLimitCount));
        const activeRuns = this.db.state.runs.filter((item) =>
          item.tenant_id === tenantId && ["queued", "executing"].includes(item.status) &&
            item.deleted_at == null
        ).length;
        if (activeRuns >= maxActive) return { meta: { changes: 0 } };
      }
      if (hasGlobalActiveRunLimit) {
        const maxActive = Number(guardArgs.at(-1));
        const activeRuns = this.db.state.runs.filter((item) =>
          ["queued", "executing"].includes(item.status) && item.deleted_at == null
        ).length;
        if (activeRuns >= maxActive) return { meta: { changes: 0 } };
      }
      for (const [column, expected] of Object.entries(guards)) {
        if (row[column] !== expected) return { meta: { changes: 0 } };
      }
      let valueIndex = 0;
      for (const assignment of assignments) {
        const match = assignment.match(/^(\w+) = (\?|NULL|\d+|'(?:[^']|'')*')$/i);
        assert.ok(match, `unsupported UPDATE assignment in test D1: ${assignment}`);
        const [, column, expression] = match;
        if (expression === "?") row[column] = this.args[valueIndex++];
        else if (expression.toUpperCase() === "NULL") row[column] = null;
        else if (expression.startsWith("'")) row[column] = expression.slice(1, -1).replaceAll("''", "'");
        else row[column] = Number(expression);
      }
      if (row.status === "queued" && assignments.some((assignment) => /^status\s*=/i.test(assignment))) {
        this.db.state.executionClaims += 1;
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("insert into review_events")) {
      if (sql.includes("select id, tenant_id, 0, '系统迁移'")) {
        return { meta: { changes: 0 } };
      }
      const [
        runId,
        tenantId,
        reviewerId,
        reviewerName,
        action,
        decisionOutcome,
        outcomeNote,
        reviewChecks,
        reportHash,
        reportVersion,
        createdAt,
      ] = this.args;
      if (sql.includes("where exists")) {
        const conditionRunId = this.args[11];
        const conditionTenantId = this.args[12];
        const expectedUpdatedAt = this.args[13];
        const expectedReviewed = this.args[14];
        const expectedMutationToken = this.args[15];
        const matchesPostReviewState = this.db.state.runs.some((row) =>
          row.id === conditionRunId &&
          row.tenant_id === conditionTenantId &&
          row.deleted_at == null &&
          row.updated_at === expectedUpdatedAt &&
          Number(row.reviewed || 0) === Number(expectedReviewed) &&
          row.mutation_token === expectedMutationToken
        );
        if (!matchesPostReviewState) return { meta: { changes: 0 } };
      }
      this.db.state.reviewEvents.push({
        run_id: runId,
        tenant_id: tenantId,
        reviewer_id: reviewerId,
        reviewer_name: reviewerName,
        action,
        decision_outcome: decisionOutcome,
        outcome_note: outcomeNote,
        review_checks: reviewChecks,
        report_hash: reportHash,
        report_version: reportVersion,
        created_at: createdAt,
      });
      return { meta: { changes: 1, last_row_id: this.db.state.reviewEvents.length } };
    }
    if (sql.startsWith("insert or ignore into runs(")) {
      const [
        tenantId,
        userId,
        title,
        inputMode,
        inputPayload,
        marketplace,
        viewProfile,
        dataScope,
        researchPlan,
        requestKey,
        createdAt,
        updatedAt,
      ] = this.args;
      const duplicate = requestKey && this.db.state.runs.some((row) =>
        row.tenant_id === tenantId && row.request_key === requestKey
      );
      if (duplicate) return { meta: { changes: 0 } };
      const id = Math.max(0, ...this.db.state.runs.map((row) => row.id)) + 1;
      this.db.state.runs.push({
        id,
        tenant_id: tenantId,
        user_id: userId,
        title,
        input_mode: inputMode,
        input_payload: inputPayload,
        marketplace,
        view_profile: viewProfile,
        data_scope: dataScope,
        status: "await_clarify",
        verdict: null,
        research_plan: researchPlan,
        report: null,
        decision_outcome: null,
        outcome_note: null,
        reviewed: 0,
        reviewer_id: null,
        reviewer_name: null,
        reviewed_at: null,
        review_checks: null,
        review_report_hash: null,
        error_message: null,
        failed_at: null,
        deleted_at: null,
        mutation_token: null,
        request_key: requestKey,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { meta: { changes: 1, last_row_id: id } };
    }
    if (sql.startsWith("with requested(bucket, cutoff, max_count) as")) {
      const ruleCount = (this.args.length - 1) / 3;
      const now = this.args.at(-1);
      const rules = Array.from({ length: ruleCount }, (_, index) => ({
        bucket: this.args[index * 3],
        cutoff: this.args[index * 3 + 1],
        limit: Number(this.args[index * 3 + 2]),
      }));
      const blocked = rules.some((rule) =>
        this.db.state.rateEvents.filter((event) =>
          event.bucket === rule.bucket && event.event_at > rule.cutoff
        ).length >= rule.limit
      );
      if (blocked) return { meta: { changes: 0 } };
      this.db.state.rateEvents.push(...rules.map((rule) => ({
        bucket: rule.bucket,
        event_at: now,
      })));
      return { meta: { changes: ruleCount } };
    }
    if (sql.startsWith("delete from runs where id = ?")) {
      const [runId, tenantId] = this.args;
      const before = this.db.state.runs.length;
      this.db.state.runs = this.db.state.runs.filter((row) =>
        row.id !== runId || row.tenant_id !== tenantId
      );
      return { meta: { changes: before - this.db.state.runs.length } };
    }
    if (sql.startsWith("insert into system_migrations") && sql.includes("on conflict")) {
      const [key, appliedAt, staleBefore] = this.args;
      const existing = this.db.state.migrations.get(key);
      if (existing != null && existing >= staleBefore) return { meta: { changes: 0 } };
      this.db.state.migrations.set(key, appliedAt);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("insert or replace into system_migrations")) {
      const [key, appliedAt] = this.args;
      this.db.state.migrations.set(key, appliedAt);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("delete from system_migrations")) {
      const [key, appliedAt] = this.args;
      if (this.db.state.migrations.get(key) !== appliedAt) return { meta: { changes: 0 } };
      this.db.state.migrations.delete(key);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("insert or ignore into system_migrations")) {
      return { meta: { changes: 0 } };
    }
    return { meta: { changes: 0, last_row_id: 0 } };
  }
}

class MemoryD1 {
  constructor(state) {
    this.state = state;
  }

  prepare(sql) {
    if (/\bcredit_(?:accounts|ledger|rules)\b/i.test(sql)) {
      this.state.creditQueries.push(normalizeSql(sql));
    }
    return new MemoryStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

let route;
let queueModule;
let databaseModule;
let server;
let state;

before(async () => {
  state = {
    runs: [],
    reviewEvents: [],
    concepts: [],
    r2Keys: new Set(),
    migrations: new Map(),
    rateEvents: [],
    queuedJobs: [],
    decisionLeases: new Map(),
    r2Metadata: new Map(),
    creditQueries: [],
  };
  globalThis[TEST_ENV_KEY] = {
    DB: new MemoryD1(state),
    SETTINGS_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    PAID_PROVIDER_CALLS_ENABLED: "true",
    RESEARCH_QUEUE: {
      send: async (message) => {
        if (state.queueSendFailure) throw state.queueSendFailure;
        state.queuedJobs.push(structuredClone(message));
      },
    },
    PRODUCT_IMAGES: {
      head: async (key) => state.r2Keys.has(key) ? {
        size: state.r2Metadata.get(key)?.size || 1_024,
        customMetadata: {
          sha256: state.r2Metadata.get(key)?.sha256 || state.r2Sha256,
          byte_size: String(state.r2Metadata.get(key)?.size || 1_024),
        },
        httpMetadata: { contentType: "image/png" },
      } : null,
    },
    DECISION_COORDINATOR: {
      idFromName: (name) => String(name),
      get: (id) => ({
        fetch: async (request) => {
          const path = new URL(request.url).pathname;
          const token = request.headers.get("x-decision-token") || "";
          const active = state.decisionLeases.get(id);
          if (path === "/acquire") {
            if (active && active !== token) {
              return new Response(null, { status: 429, headers: { "retry-after": "1" } });
            }
            state.decisionLeases.set(id, token);
            return new Response(null, { status: 204 });
          }
          if (path === "/release") {
            if (active === token) state.decisionLeases.delete(id);
            return new Response(null, { status: 204 });
          }
          return new Response(null, { status: 404 });
        },
      }),
    },
  };
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
    plugins: [{
      name: "metis-test-cloudflare-env",
      enforce: "pre",
      resolveId(id) {
        return id === "cloudflare:workers" ? "\0metis-test-cloudflare-workers" : null;
      },
      load(id) {
        if (id !== "\0metis-test-cloudflare-workers") return null;
        return `export const env = globalThis[${JSON.stringify(TEST_ENV_KEY)}];`;
      },
    }],
  });
  route = await server.ssrLoadModule("/app/api/[[...path]]/route.ts");
  queueModule = await server.ssrLoadModule("/lib/research-queue.ts");
  databaseModule = await server.ssrLoadModule("/lib/database.ts");
});

beforeEach(() => {
  state.creditQueries = [];
  state.runs = [
    rawRun(),
    rawRun({
      id: 102,
      title: "模板演示",
      input_mode: "category_keyword",
      input_payload: JSON.stringify("Sideboard"),
      report: {
        ...verifiedReport,
        category: "Sideboard",
        evidence_mode: "template_demo",
        decision_readiness: "insufficient_evidence",
      },
    }),
  ];
  state.reviewEvents = [];
  state.concepts = [{
    id: 501,
    run_id: 101,
    tenant_id: 42,
    user_id: 7,
    status: "done",
    prompt: "industrial design",
    design_brief: JSON.stringify({ category: "Nightstands" }),
    model: "lovart-test-model",
    lovart_project_id: "project-1",
    lovart_thread_id: "thread-1",
    pending_confirmation: null,
    artifacts: JSON.stringify([{
      type: "image",
      source_url: "https://lovart.test/result.png",
      r2_key: "concepts/42/101/501/0.png",
      content_type: "image/png",
      byte_size: 1_024,
      sha256: "b".repeat(64),
    }]),
    public_token: "c".repeat(32),
    error: null,
    created_at: 1_700_000_001,
    updated_at: 1_700_000_002,
  }];
  state.r2Keys = new Set(["concepts/42/101/501/0.png"]);
  state.r2Sha256 = "b".repeat(64);
  state.r2Metadata = new Map();
  state.beforeRunUpdate = null;
  state.executionClaims = 0;
  state.rateEvents = [];
  state.queuedJobs = [];
  state.queueSendFailure = null;
  state.decisionLeases.clear();
});

after(async () => {
  await server?.close();
  delete globalThis[TEST_ENV_KEY];
});

function request(method, path, { token = ADMIN_TOKEN, body, query, headers: headerValues } = {}) {
  const headers = new Headers(headerValues);
  headers.set("authorization", `Bearer ${token}`);
  if (!headers.has("content-type") && (body !== undefined || ["POST", "PUT", "PATCH"].includes(method))) {
    headers.set("content-type", "application/json");
  }
  const url = new URL(`http://metis.test/api/${path.join("/")}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  return route[method](
    new Request(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ path }) },
  );
}

function hashReport(report = verifiedReport) {
  return createHash("sha256").update(JSON.stringify(report)).digest("hex");
}

function completeReview(overrides = {}) {
  return {
    decision_outcome: "有条件",
    outcome_note: "先完成包装跌落测试，再进入首单。",
    review_checks: { evidence: true, economics: true, risk: true },
    reviewed: true,
    expected_report_hash: hashReport(),
    expected_report_version: "test-report-v1",
    ...overrides,
  };
}

function adoptionBody(run = state.runs[0], overrides = {}) {
  const report = parseReport(run.report);
  return {
    confirm_adoption: true,
    concept_id: 501,
    artifact_index: 0,
    expected_report_hash: hashReport(report),
    expected_report_version: report.report_version,
    expected_run_updated_at: run.updated_at,
    expected_concept_updated_at: 1_700_000_002,
    ...overrides,
  };
}

function configureSceneSuiteConcept() {
  const artifacts = SCENE_SUITE_SLOTS.map(([assetId, role, title], index) => {
    const sha256 = String(index + 1).repeat(64);
    const r2Key = `concepts/42/101/501/${index}.png`;
    state.r2Keys.add(r2Key);
    state.r2Metadata.set(r2Key, { sha256, size: 1_024 });
    return {
      type: "image",
      source_url: `https://lovart.test/scene-${index + 1}.png`,
      r2_key: r2Key,
      content_type: "image/png",
      byte_size: 1_024,
      sha256,
      asset_id: assetId,
      role,
      title,
      sequence: index + 1,
      required: true,
      role_assignment: "positional_unverified",
    };
  });
  state.concepts[0].artifacts = JSON.stringify(artifacts);
  state.concepts[0].design_brief = JSON.stringify({
    category: "Nightstands",
    design_dna: { id: SCENE_DESIGN_DNA_ID },
    scene_suite: {
      design_dna_id: SCENE_DESIGN_DNA_ID,
      slots: SCENE_SUITE_SLOTS.map(([asset_id, role, title], index) => ({
        asset_id,
        role,
        title,
        sequence: index + 1,
        required: true,
      })),
    },
  });

  const report = parseReport(state.runs[0].report);
  report.modules = {
    ...report.modules,
    board_concept: { title: "Nightstands Arc-Rhythm" },
    pd_concept_matrix: {
      aigc_design_review_pack: {
        scene_suite_contract: { nested_marker: "preserve-pd-contract" },
      },
    },
    problem_solver_concept: {},
    aigc_design_review_pack: {
      scene_suite_contract: {
        suite_version: "metis-scene-suite-v1",
        evidence_boundary: "preserve-top-level-contract",
      },
    },
  };
  state.runs[0].report = JSON.stringify(report);
}

function suiteAdoptionBody(run = state.runs[0], overrides = {}) {
  return adoptionBody(run, {
    adopt_suite: true,
    hero_artifact_index: 0,
    artifact_indices: [0, 1, 2, 3, 4, 5],
    ...overrides,
  });
}

async function withFixedNow(value, callback) {
  const originalNow = Date.now;
  Date.now = () => value;
  try {
    return await callback();
  } finally {
    Date.now = originalNow;
  }
}

test("a permanently stored Lovart asset becomes the report source of truth exactly once", async () => {
  state.runs[0].decision_outcome = "观望";
  state.runs[0].outcome_note = "旧报告上的决策草案";
  const originalHash = hashReport(parseReport(state.runs[0].report));

  const response = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: adoptionBody(),
  });
  assert.equal(response.status, 200);
  const adoptedRun = await response.json();
  const report = adoptedRun.report;
  const expectedUrl = `http://metis.test/api/concept-assets/${"c".repeat(32)}/0`;

  assert.equal(report.base_report_version, "test-report-v1");
  assert.equal(report.report_revision, 1);
  assert.equal(report.report_version, "test-report-v1+concept-r1");
  assert.equal(report.modules.board_concept.image_url, expectedUrl);
  assert.equal(report.modules.pd_concept_matrix.product_concept.image_url, expectedUrl);
  assert.equal(report.modules.problem_solver_concept.product_concept.image_url, expectedUrl);
  assert.equal(report.modules.aigc_design_review_pack.master_asset.image, expectedUrl);
  assert.equal(report.modules.board_concept.asset_provenance.asset_sha256, "b".repeat(64));
  assert.notEqual(hashReport(report), originalHash);
  assert.equal(adoptedRun.decision_outcome, null);
  assert.equal(adoptedRun.outcome_note, null);
  assert.equal(state.reviewEvents.length, 1);
  assert.equal(state.reviewEvents[0].action, "concept_adopted");

  const repeated = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: adoptionBody(state.runs[0]),
  });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).report.report_revision, 1);
  assert.equal(state.reviewEvents.length, 1);
});

test("a complete Lovart scene suite is adopted atomically with one report revision", async () => {
  configureSceneSuiteConcept();

  const response = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: suiteAdoptionBody(),
  });
  assert.equal(response.status, 200);
  const adoptedRun = await response.json();
  const report = adoptedRun.report;
  const suite = report.modules.board_concept.scene_suite;
  const expectedRoles = SCENE_SUITE_SLOTS.map(([, role]) => role);

  assert.equal(report.base_report_version, "test-report-v1");
  assert.equal(report.report_revision, 1);
  assert.equal(report.report_version, "test-report-v1+concept-r1");
  assert.equal(suite.length, 6);
  assert.deepEqual(suite.map((asset) => asset.role), expectedRoles);
  for (const [index, asset] of suite.entries()) {
    assert.equal(asset.concept_id, 501);
    assert.equal(asset.artifact_index, index);
    assert.equal(asset.design_dna_id, SCENE_DESIGN_DNA_ID);
    assert.equal(asset.asset_sha256, String(index + 1).repeat(64));
    assert.equal(asset.image_url, `http://metis.test/api/concept-assets/${"c".repeat(32)}/${index}`);
    assert.equal(asset.url, asset.image_url);
    assert.ok(asset.title);
  }
  assert.equal(report.modules.board_concept.image_url, suite[0].image_url);
  assert.deepEqual(report.modules.pd_concept_matrix.product_concept.scene_suite, suite);
  assert.deepEqual(report.modules.problem_solver_concept.product_concept.scene_suite, suite);
  assert.deepEqual(report.modules.aigc_design_review_pack.scene_suite, suite);
  assert.deepEqual(report.modules.pd_concept_matrix.aigc_design_review_pack.scene_suite, suite);
  assert.deepEqual(report.modules.problem_solver_concept.aigc_design_review_pack.scene_suite, suite);
  assert.equal(
    report.modules.aigc_design_review_pack.scene_suite_contract.evidence_boundary,
    "preserve-top-level-contract",
  );
  assert.equal(
    report.modules.pd_concept_matrix.aigc_design_review_pack.scene_suite_contract.nested_marker,
    "preserve-pd-contract",
  );
  assert.equal(adoptedRun.decision_outcome, null);
  assert.equal(adoptedRun.outcome_note, null);
  assert.equal(state.reviewEvents.length, 1);
  assert.equal(state.reviewEvents[0].action, "concept_adopted");
  assert.match(state.reviewEvents[0].outcome_note, /场景套图 6 张/);

  const repeated = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: suiteAdoptionBody(state.runs[0], { artifact_indices: [5, 4, 3, 2, 1, 0] }),
  });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).report.report_revision, 1);
  assert.equal(state.reviewEvents.length, 1);
});

test("scene-suite adoption fails closed for missing or duplicate required slots", async () => {
  configureSceneSuiteConcept();

  const missing = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: suiteAdoptionBody(state.runs[0], { artifact_indices: [0, 1, 2, 3, 4] }),
  });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).detail, /必须包含 6 个/);

  const duplicateIndex = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: suiteAdoptionBody(state.runs[0], { artifact_indices: [0, 1, 2, 3, 4, 4] }),
  });
  assert.equal(duplicateIndex.status, 400);
  assert.match((await duplicateIndex.json()).detail, /重复采用/);

  const artifacts = JSON.parse(state.concepts[0].artifacts);
  artifacts[1].role = "hero_master";
  state.concepts[0].artifacts = JSON.stringify(artifacts);
  const duplicateRole = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: suiteAdoptionBody(),
  });
  assert.equal(duplicateRole.status, 409);
  assert.match((await duplicateRole.json()).detail, /重复角色/);
  assert.equal(state.reviewEvents.length, 0);
  assert.equal(parseReport(state.runs[0].report).report_revision, undefined);
});

test("scene-suite adoption rejects a bad digest or duplicate archived image", async () => {
  configureSceneSuiteConcept();
  const secondKey = "concepts/42/101/501/1.png";
  state.r2Metadata.set(secondKey, { sha256: "f".repeat(64), size: 1_024 });

  const badDigest = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: suiteAdoptionBody(),
  });
  assert.equal(badDigest.status, 409);
  assert.match((await badDigest.json()).detail, /完整性校验失败/);

  const artifacts = JSON.parse(state.concepts[0].artifacts);
  artifacts[1].sha256 = artifacts[0].sha256;
  state.concepts[0].artifacts = JSON.stringify(artifacts);
  state.r2Metadata.set(secondKey, { sha256: artifacts[0].sha256, size: 1_024 });
  const duplicateImage = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: suiteAdoptionBody(),
  });
  assert.equal(duplicateImage.status, 409);
  assert.match((await duplicateImage.json()).detail, /内容重复/);
  assert.equal(state.reviewEvents.length, 0);
});

test("concept adoption fails closed for signed, stale, or temporary-only assets", async () => {
  const stale = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: adoptionBody(state.runs[0], { expected_report_hash: "d".repeat(64) }),
  });
  assert.equal(stale.status, 409);
  assert.equal(state.reviewEvents.length, 0);

  const artifacts = JSON.parse(state.concepts[0].artifacts);
  delete artifacts[0].r2_key;
  state.concepts[0].artifacts = JSON.stringify(artifacts);
  const temporary = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: adoptionBody(),
  });
  assert.equal(temporary.status, 409);
  assert.match((await temporary.json()).detail, /永久存档/);

  state.concepts[0].artifacts = JSON.stringify([{ ...artifacts[0], r2_key: "concepts/42/101/501/0.png" }]);
  const signed = await request("PATCH", ["runs", "101"], { body: completeReview() });
  assert.equal(signed.status, 200);
  const blocked = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: adoptionBody(state.runs[0]),
  });
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).detail, /先撤销签核/);
});

test("concept adoption rejects an R2 object whose stored digest does not match the report artifact", async () => {
  state.r2Sha256 = "a".repeat(64);
  const response = await request("POST", ["runs", "101", "concept", "adopt"], {
    body: adoptionBody(),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).detail, /完整性校验失败/);
  assert.equal(state.reviewEvents.length, 0);
});

test("review signing rejects every incomplete review-check combination without mutating the run", async () => {
  const invalidChecks = [
    undefined,
    { evidence: true, economics: true },
    { evidence: true, economics: true, risk: false },
  ];

  for (const reviewChecks of invalidChecks) {
    const body = {
      decision_outcome: "有条件",
      outcome_note: "先完成包装跌落测试，再进入首单。",
      reviewed: true,
      expected_report_hash: hashReport(),
      ...(reviewChecks === undefined ? {} : { review_checks: reviewChecks }),
    };
    const response = await request("PATCH", ["runs", "101"], { body });
    assert.equal(response.status, 400);
    assert.equal(state.runs[0].reviewed, 0);
    assert.equal(state.runs[0].decision_outcome, null);
    assert.equal(state.reviewEvents.length, 0);
  }
});

test("review signing requires the report hash seen by the reviewer", async () => {
  const response = await request("PATCH", ["runs", "101"], {
    body: {
      decision_outcome: "有条件",
      outcome_note: "先完成包装跌落测试，再进入首单。",
      review_checks: { evidence: true, economics: true, risk: true },
      reviewed: true,
    },
  });

  assert.equal(response.status, 400);
  assert.equal(state.runs[0].reviewed, 0);
  assert.equal(state.runs[0].decision_outcome, null);
  assert.equal(state.reviewEvents.length, 0);
});

test("review signing rejects a stale report hash without writing a decision or audit event", async () => {
  const staleHash = hashReport();
  const refreshedReport = {
    ...verifiedReport,
    verdict: "刷新后的研究建议",
    report_version: "test-report-v2",
  };
  state.runs[0].report = JSON.stringify(refreshedReport);
  state.runs[0].updated_at += 1;

  const response = await request("PATCH", ["runs", "101"], {
    body: completeReview({ expected_report_hash: staleHash }),
  });

  assert.equal(response.status, 409);
  assert.equal(state.runs[0].reviewed, 0);
  assert.equal(state.runs[0].decision_outcome, null);
  assert.equal(state.runs[0].review_report_hash, null);
  assert.equal(state.reviewEvents.length, 0);
});

test("review signing uses updated_at CAS after validating the report hash", async () => {
  const originalUpdatedAt = state.runs[0].updated_at;
  state.beforeRunUpdate = (row) => {
    row.updated_at = originalUpdatedAt + 1;
  };

  const response = await request("PATCH", ["runs", "101"], {
    body: completeReview(),
  });

  assert.equal(response.status, 409);
  assert.equal(state.runs[0].reviewed, 0);
  assert.equal(state.runs[0].decision_outcome, null);
  assert.equal(state.runs[0].review_report_hash, null);
  assert.equal(state.reviewEvents.length, 0);
});

test("a complete review is signed, append-only audited, and exported with its decision record and hash", async () => {
  const checks = { evidence: true, economics: true, risk: true };
  const expectedHash = createHash("sha256")
    .update(JSON.stringify(verifiedReport))
    .digest("hex");

  const signResponse = await request("PATCH", ["runs", "101"], {
    body: {
      decision_outcome: "有条件",
      outcome_note: "先完成包装跌落测试，再进入首单。",
      review_checks: checks,
      reviewed: true,
      expected_report_hash: expectedHash,
      expected_report_version: "test-report-v1",
    },
  });
  assert.equal(signResponse.status, 200);
  const signedRun = await signResponse.json();
  assert.equal(signedRun.reviewed, 1);
  assert.equal(signedRun.reviewer_name, "审核管理员");
  assert.deepEqual(signedRun.review_checks, checks);
  assert.equal(signedRun.review_report_hash, expectedHash);
  assert.deepEqual(
    state.reviewEvents.map((event) => ({
      action: event.action,
      reviewer_name: event.reviewer_name,
      checks: JSON.parse(event.review_checks),
      report_hash: event.report_hash,
      report_version: event.report_version,
    })),
    [{
      action: "signed",
      reviewer_name: "审核管理员",
      checks,
      report_hash: expectedHash,
      report_version: "test-report-v1",
    }],
  );

  const exportResponse = await request("GET", ["runs", "101", "export.json"]);
  assert.equal(exportResponse.status, 200);
  assert.equal(Number(exportResponse.headers.get("content-length")) > 0, true);
  const exported = await exportResponse.json();
  assert.deepEqual(exported.decision_record, {
    status: "signed",
    outcome: "有条件",
    note: "先完成包装跌落测试，再进入首单。",
    checks,
    reviewer_id: 7,
    reviewer_name: "审核管理员",
    reviewed_at: signedRun.reviewed_at,
    export_edition: "signed",
    report_version: "test-report-v1",
    report_sha256: expectedHash,
    hash_scope: "report_without_decision_record",
    hash_canonicalization: "utf8-json-stringify-v1",
  });
  assert.equal(Object.hasOwn(verifiedReport, "decision_record"), false);
});

test("export check and formal exports reject report tampering after review", async () => {
  const expectedHash = createHash("sha256")
    .update(JSON.stringify(verifiedReport))
    .digest("hex");
  const signResponse = await request("PATCH", ["runs", "101"], {
    body: completeReview(),
  });
  assert.equal(signResponse.status, 200);

  const checkResponse = await request("GET", ["runs", "101", "export-check"]);
  assert.equal(checkResponse.status, 200);
  assert.deepEqual(await checkResponse.json(), {
    ok: true,
    edition: "signed",
    decision_status: "signed",
    report_sha256: expectedHash,
    report_version: "test-report-v1",
  });

  const storedRun = state.runs.find((run) => run.id === 101);
  assert.equal(storedRun.review_report_hash, expectedHash);
  storedRun.report = JSON.stringify({
    ...verifiedReport,
    verdict: "签核后被直接篡改",
  });
  assert.equal(storedRun.review_report_hash, expectedHash);

  for (const endpoint of ["export-check", "export.json", "export.md"]) {
    const response = await request("GET", ["runs", "101", endpoint]);
    assert.equal(response.status, 409, endpoint);
  }
});

test("signed-edition export requests fail closed after another client revokes the sign-off", async (t) => {
  const expectedHash = hashReport();
  const signResponse = await request("PATCH", ["runs", "101"], {
    body: completeReview(),
  });
  assert.equal(signResponse.status, 200);

  const revokeResponse = await request("PATCH", ["runs", "101"], {
    body: { reviewed: false, review_reason: "签核条件发生变化，需要重新评审。" },
  });
  assert.equal(revokeResponse.status, 200);

  const query = { edition: "signed", expected_report_hash: expectedHash };
  for (const endpoint of ["export-check", "export.json", "export.md"]) {
    await t.test(endpoint, async () => {
      const response = await request("GET", ["runs", "101", endpoint], { query });
      assert.equal(response.status, 409, `${endpoint} must not silently downgrade a requested signed edition`);
    });
  }
});

test("review-edition exports remain explicitly pending after sign-off revocation", async () => {
  const expectedHash = hashReport();
  const signResponse = await request("PATCH", ["runs", "101"], {
    body: completeReview(),
  });
  assert.equal(signResponse.status, 200);
  const revokeResponse = await request("PATCH", ["runs", "101"], {
    body: { reviewed: false, review_reason: "改为审阅稿重新流转。" },
  });
  assert.equal(revokeResponse.status, 200);

  const query = { edition: "review", expected_report_hash: expectedHash };
  const checkResponse = await request("GET", ["runs", "101", "export-check"], { query });
  assert.equal(checkResponse.status, 200);
  assert.equal((await checkResponse.json()).decision_status, "pending_review");

  const jsonResponse = await request("GET", ["runs", "101", "export.json"], { query });
  assert.equal(jsonResponse.status, 200);
  assert.equal((await jsonResponse.json()).decision_record.status, "pending_review");

  const markdownResponse = await request("GET", ["runs", "101", "export.md"], { query });
  assert.equal(markdownResponse.status, 200);
  assert.match(await markdownResponse.text(), /人工决策：待人工终审/);
});

test("template reports fail closed for both review signing and official exports", async () => {
  const reviewResponse = await request("PATCH", ["runs", "102"], {
    body: completeReview(),
  });
  assert.equal(reviewResponse.status, 409);
  assert.equal(state.runs.find((run) => run.id === 102)?.reviewed, 0);

  for (const format of ["export.json", "export.md"]) {
    const exportResponse = await request("GET", ["runs", "102", format]);
    assert.equal(exportResponse.status, 409);
  }
});

test("signed decision fields stay immutable until an audited admin revocation", async () => {
  const signResponse = await request("PATCH", ["runs", "101"], {
    body: completeReview(),
  });
  assert.equal(signResponse.status, 200);

  const overwriteResponse = await request("PATCH", ["runs", "101"], {
    body: {
      decision_outcome: "放弃",
      outcome_note: "尝试覆盖已签核结论",
    },
  });
  assert.equal(overwriteResponse.status, 409);
  assert.equal(state.runs[0].decision_outcome, "有条件");
  assert.equal(state.runs[0].outcome_note, "先完成包装跌落测试，再进入首单。");
  assert.deepEqual(state.reviewEvents.map((event) => event.action), ["signed"]);

  const revokeResponse = await request("PATCH", ["runs", "101"], {
    body: { reviewed: false, review_reason: "供应链条件发生变化，需要重新评审。" },
  });
  assert.equal(revokeResponse.status, 200);
  const revoked = await revokeResponse.json();
  assert.equal(revoked.reviewed, 0);
  assert.equal(revoked.reviewer_id, null);
  assert.equal(revoked.review_report_hash, null);
  assert.deepEqual(state.reviewEvents.map((event) => event.action), ["signed", "revoked"]);
});

test("run listings expose evidence state without embedding the full report", async () => {
  const response = await request("GET", ["runs"]);
  assert.equal(response.status, 200);
  const runs = await response.json();
  assert.deepEqual(
    runs.map(({ id, evidence_mode, decision_readiness }) => ({
      id,
      evidence_mode,
      decision_readiness,
    })),
    [
      { id: 102, evidence_mode: "template_demo", decision_readiness: "insufficient_evidence" },
      { id: 101, evidence_mode: "verified_research", decision_readiness: "ready_for_review" },
    ],
  );
  assert.ok(runs.every((run) => !("report" in run) && !("research_plan" in run)));
});

test("run listings use bounded cursor pages without changing the array response contract", async () => {
  state.runs.push(
    rawRun({ id: 103, title: "第三条研究", updated_at: 1_700_000_003 }),
    rawRun({ id: 104, title: "第四条研究", updated_at: 1_700_000_004 }),
  );

  const first = await request("GET", ["runs"], { query: { limit: 2 } });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-page-limit"), "2");
  assert.equal(first.headers.get("x-has-more"), "1");
  assert.equal(first.headers.get("x-next-cursor"), "103");
  assert.deepEqual((await first.json()).map((run) => run.id), [104, 103]);

  const second = await request("GET", ["runs"], {
    query: { limit: 2, cursor: first.headers.get("x-next-cursor") },
  });
  assert.equal(second.headers.get("x-has-more"), "0");
  assert.equal(second.headers.get("x-next-cursor"), null);
  assert.deepEqual((await second.json()).map((run) => run.id), [102, 101]);

  const invalid = await request("GET", ["runs"], { query: { limit: 101 } });
  assert.equal(invalid.status, 400);
});

test("archived run pagination remains stable when archive timestamps are equal", async () => {
  state.runs.forEach((run, index) => {
    run.deleted_at = index === 0 ? 1_700_000_010 : 1_700_000_020;
  });
  state.runs.push(rawRun({
    id: 103,
    title: "同一时点归档",
    deleted_at: 1_700_000_020,
  }));

  const first = await request("GET", ["runs", "archived"], { query: { limit: 1 } });
  assert.deepEqual((await first.json()).map((run) => run.id), [103]);
  assert.equal(first.headers.get("x-next-cursor"), "1700000020:103");

  const second = await request("GET", ["runs", "archived"], {
    query: { limit: 2, cursor: first.headers.get("x-next-cursor") },
  });
  assert.deepEqual((await second.json()).map((run) => run.id), [102, 101]);
  assert.equal(second.headers.get("x-has-more"), "0");
});

test("run status polling returns a tenant-private 304 for an unchanged ETag", async () => {
  const first = await request("GET", ["runs", "101", "status"]);
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.match(etag, /^W\/"run-101-/);

  const unchanged = await request("GET", ["runs", "101", "status"], {
    headers: { "if-none-match": etag },
  });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  assert.equal(unchanged.headers.get("cache-control"), "private, no-cache, max-age=0");
  assert.equal(unchanged.headers.get("vary"), "Authorization");

  state.runs[0].updated_at += 1;
  const changed = await request("GET", ["runs", "101", "status"], {
    headers: { "if-none-match": etag },
  });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), etag);
});

test("ordinary report view diagnoses corrupt stored JSON while official export fails closed", async () => {
  state.runs[0].report = "{not-valid-json";

  const viewResponse = await request("GET", ["runs", "101"]);
  assert.equal(viewResponse.status, 200);
  const viewed = await viewResponse.json();
  assert.equal(viewed.report.report_unavailable, true);
  assert.equal(viewed.report.report_integrity.status, "incomplete");
  assert.equal(viewed.report.report_integrity.errors[0].code, "REPORT_NOT_OBJECT");

  const exportResponse = await request("GET", ["runs", "101", "export.json"]);
  assert.equal(exportResponse.status, 409);
  assert.match(await exportResponse.text(), /完整性校验失败/);
});

test("the unused run SSE interface is removed instead of holding worker connections", async () => {
  const response = await request("GET", ["runs", "101", "stream"]);
  assert.equal(response.status, 404);
});

test("only admins can archive and restore a run without losing its report or review data", async () => {
  const memberArchivedResponse = await request("GET", ["runs", "archived"], {
    token: MEMBER_TOKEN,
  });
  assert.equal(memberArchivedResponse.status, 403);

  const signResponse = await request("PATCH", ["runs", "101"], {
    body: completeReview(),
  });
  assert.equal(signResponse.status, 200);
  const signed = await signResponse.json();
  const preservedReview = {
    decision_outcome: signed.decision_outcome,
    outcome_note: signed.outcome_note,
    reviewed: signed.reviewed,
    reviewer_id: signed.reviewer_id,
    reviewer_name: signed.reviewer_name,
    reviewed_at: signed.reviewed_at,
    review_checks: signed.review_checks,
    review_report_hash: signed.review_report_hash,
  };

  const memberResponse = await request("DELETE", ["runs", "101"], { token: MEMBER_TOKEN });
  assert.equal(memberResponse.status, 403);
  assert.equal(state.runs.find((run) => run.id === 101)?.deleted_at, null);

  const adminResponse = await request("DELETE", ["runs", "101"]);
  assert.equal(adminResponse.status, 200);
  assert.deepEqual(await adminResponse.json(), { ok: true, archived: true });
  const archived = state.runs.find((run) => run.id === 101);
  assert.ok(archived, "soft delete must preserve the run record");
  assert.ok(Number.isFinite(archived.deleted_at));

  const memberRestoreResponse = await request("POST", ["runs", "101", "restore"], {
    token: MEMBER_TOKEN,
  });
  assert.equal(memberRestoreResponse.status, 403);
  assert.ok(Number.isFinite(archived.deleted_at));

  const archivedListResponse = await request("GET", ["runs", "archived"]);
  assert.equal(archivedListResponse.status, 200);
  const archivedRuns = await archivedListResponse.json();
  assert.equal(archivedRuns.length, 1);
  assert.equal(archivedRuns[0].id, 101);
  assert.deepEqual(
    Object.fromEntries(Object.keys(preservedReview).map((key) => [key, archivedRuns[0][key]])),
    preservedReview,
  );
  assert.ok(!("report" in archivedRuns[0]) && !("research_plan" in archivedRuns[0]));

  const getResponse = await request("GET", ["runs", "101"]);
  assert.equal(getResponse.status, 404);
  const listResponse = await request("GET", ["runs"]);
  const visibleIds = (await listResponse.json()).map((run) => run.id);
  assert.deepEqual(visibleIds, [102]);

  const restoreResponse = await request("POST", ["runs", "101", "restore"]);
  assert.equal(restoreResponse.status, 200);
  const restored = await restoreResponse.json();
  assert.deepEqual(restored.report, signed.report);
  assert.deepEqual(
    Object.fromEntries(Object.keys(preservedReview).map((key) => [key, restored[key]])),
    preservedReview,
  );

  const restoredGetResponse = await request("GET", ["runs", "101"]);
  assert.equal(restoredGetResponse.status, 200);
  const restoredGet = await restoredGetResponse.json();
  assert.deepEqual(restoredGet.report, signed.report);
  assert.equal(restoredGet.review_report_hash, signed.review_report_hash);

  const restoredListResponse = await request("GET", ["runs"]);
  assert.deepEqual((await restoredListResponse.json()).map((run) => run.id), [102, 101]);
  const emptyArchivedResponse = await request("GET", ["runs", "archived"]);
  assert.deepEqual(await emptyArchivedResponse.json(), []);
});

test("queued research cannot be edited or archived while its Agent message is pending", async () => {
  const run = state.runs[0];
  run.status = "queued";
  run.report = null;
  run.verdict = null;
  const originalTitle = run.title;
  const originalUpdatedAt = run.updated_at;

  const patchResponse = await request("PATCH", ["runs", "101"], {
    body: { title: "不应生效的标题" },
  });
  assert.equal(patchResponse.status, 409);
  assert.match(await patchResponse.text(), /完成后才能编辑/);

  const archiveResponse = await request("DELETE", ["runs", "101"]);
  assert.equal(archiveResponse.status, 409);
  assert.match(await archiveResponse.text(), /暂不能归档/);
  assert.equal(run.title, originalTitle);
  assert.equal(run.updated_at, originalUpdatedAt);
  assert.equal(run.deleted_at, null);
});

test("executing research cannot be edited or archived while its lease is active", async () => {
  const run = state.runs[0];
  run.status = "executing";
  run.report = null;
  run.verdict = null;
  run.execution_token = "active-agent-owner";
  run.execution_lease_until = Date.now() / 1_000 + 600;

  const patchResponse = await request("PATCH", ["runs", "101"], {
    body: { title: "不应生效的标题" },
  });
  assert.equal(patchResponse.status, 409);

  const archiveResponse = await request("DELETE", ["runs", "101"]);
  assert.equal(archiveResponse.status, 409);
  assert.equal(run.deleted_at, null);
  assert.equal(run.execution_token, "active-agent-owner");
});

test("workspace members and admins can view another creator's run but cannot confirm or spend for it", async (t) => {
  const scenarios = [
    { name: "member cannot confirm admin's draft", creatorId: 7, token: MEMBER_TOKEN, dataScope: "public_ok" },
    { name: "admin cannot confirm member's draft", creatorId: 8, token: ADMIN_TOKEN, dataScope: "public_ok" },
    { name: "admin cannot mutate member's private draft through confirm", creatorId: 8, token: ADMIN_TOKEN, dataScope: "private_only" },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const run = state.runs[0];
      Object.assign(run, {
        user_id: scenario.creatorId, status: "await_clarify", report: null, verdict: null,
        data_scope: scenario.dataScope,
      });
      const view = await request("GET", ["runs", "101"], { token: scenario.token });
      assert.equal(view.status, 200);
      assert.equal((await view.json()).user_id, scenario.creatorId);
      const before = structuredClone(run);
      state.creditQueries = [];
      state.queuedJobs = [];

      const response = await request("POST", ["runs", "101", "confirm"], {
        token: scenario.token,
        body: { research_plan: { category_scope: "Unauthorized paid execution" } },
      });

      assert.equal(response.status, 403);
      assert.match(await response.text(), /仅研究创建者本人/);
      assert.deepEqual(run, before);
      assert.deepEqual(state.queuedJobs, []);
      assert.deepEqual(state.creditQueries, []);
    });
  }
});

test("a member can confirm their own run and enter the normal credit and Queue path", async () => {
  const run = state.runs[0];
  Object.assign(run, {
    user_id: 8, status: "await_clarify", report: null, verdict: null,
    input_mode: "category_keyword", input_payload: JSON.stringify("Creator fixture"),
  });
  const response = await request("POST", ["runs", "101", "confirm"], {
    token: MEMBER_TOKEN,
    body: { research_plan: { category_scope: "Creator fixture", research_brief: {} } },
  });
  assert.equal(response.status, 202);
  assert.equal(run.status, "queued");
  assert.equal(run.user_id, 8);
  assert.equal(state.queuedJobs.length, 1);
  assert.equal(state.queuedJobs[0].runId, 101);
  assert.ok(state.creditQueries.some((sql) => sql.includes("FROM credit_rules")));
});

test("concurrent execution requests claim one run exactly once", async () => {
  state.runs[0].status = "await_clarify";
  state.runs[0].report = null;
  state.runs[0].verdict = null;
  state.runs[0].input_mode = "category_keyword";
  state.runs[0].input_payload = JSON.stringify("Concurrency fixture");
  state.runs[0].research_plan = JSON.stringify({
    category_scope: "Concurrency fixture",
    research_brief: {},
  });

  const responses = await Promise.all(Array.from({ length: 12 }, () =>
    request("POST", ["runs", "101", "confirm"], {
      body: {
        research_plan: {
          category_scope: "Concurrency fixture",
          research_brief: {},
        },
      },
    })
  ));
  const statuses = responses.map((response) => response.status);
  for (const response of responses.filter((response) => response.status === 202)) {
    assert.equal(response.headers.get("retry-after"), "2");
  }
  const acceptedPayloads = await Promise.all(
    responses
      .filter((response) => response.status === 202)
      .map(async (response) => {
        const text = await response.text();
        assert.ok(Buffer.byteLength(text) < 2_048);
        return JSON.parse(text);
      }),
  );

  assert.equal(state.executionClaims, 1);
  assert.equal(state.queuedJobs.length, 1);
  assert.equal(state.queuedJobs[0].runId, 101);
  assert.equal(state.runs[0].status, "queued");
  assert.equal(statuses.filter((status) => status >= 500).length, 0);
  assert.ok(statuses.every((status) => [202, 429].includes(status)));
  assert.ok(acceptedPayloads.length >= 1);
  assert.ok(acceptedPayloads.every((payload) =>
    payload.id === 101 && payload.status === "queued" && payload.has_report === 0 &&
    typeof payload.updated_at === "number" && !("report" in payload)
  ));
});

test("a transient Queue send failure stays accepted and the cron reconciler redelivers it", async () => {
  const nowSeconds = 1_700_000_500;
  state.runs[0].status = "await_clarify";
  state.runs[0].report = null;
  state.runs[0].verdict = null;
  state.runs[0].input_mode = "category_keyword";
  state.runs[0].input_payload = JSON.stringify("Queue recovery fixture");
  state.runs[0].research_plan = JSON.stringify({
    category_scope: "Queue recovery fixture",
    research_brief: {},
  });
  state.queueSendFailure = new Error("temporary Queue control-plane outage");

  const response = await withFixedNow(nowSeconds * 1_000, () =>
    request("POST", ["runs", "101", "confirm"], {
      body: { research_plan: { category_scope: "Queue recovery fixture", research_brief: {} } },
    })
  );

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.equal((await response.json()).status, "queued");
  assert.equal(state.runs[0].status, "queued");
  assert.equal(state.runs[0].updated_at, nowSeconds);
  assert.equal(state.queuedJobs.length, 0);

  state.queueSendFailure = null;
  const reconciliation = await queueModule.reconcileResearchQueue(nowSeconds + 31);
  assert.deepEqual(reconciliation, { scanned: 1, enqueued: 1, failed: 0 });
  assert.deepEqual(state.queuedJobs, [{ runId: 101, tenantId: 42, claimedAt: nowSeconds }]);
});

test("a multi-tenant burst atomically stops at the global active-research ceiling", async () => {
  const makePending = (id, tenantId, userId, title) => {
    const run = rawRun({ id, tenant_id: tenantId, user_id: userId, title });
    run.status = "await_clarify";
    run.report = null;
    run.verdict = null;
    run.input_mode = "category_keyword";
    run.input_payload = JSON.stringify(title);
    run.research_plan = JSON.stringify({ category_scope: title, research_brief: {} });
    return run;
  };
  state.runs = [
    makePending(101, 42, 7, "Tenant A burst"),
    makePending(201, 43, 9, "Tenant B burst"),
    ...Array.from({ length: 31 }, (_, index) => rawRun({
      id: 1_000 + index,
      tenant_id: 100 + index,
      status: index % 2 ? "queued" : "executing",
      report: null,
      deleted_at: null,
    })),
  ];
  for (const run of state.runs.slice(2)) run.report = null;

  const responses = await Promise.all([
    request("POST", ["runs", "101", "confirm"], {
      body: { research_plan: { category_scope: "Tenant A burst", research_brief: {} } },
    }),
    request("POST", ["runs", "201", "confirm"], {
      token: SECOND_ADMIN_TOKEN,
      body: { research_plan: { category_scope: "Tenant B burst", research_brief: {} } },
    }),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [202, 429]);
  assert.equal(state.queuedJobs.length, 1);
  assert.equal(state.runs.filter((run) => ["queued", "executing"].includes(run.status)).length, 32);
  const denied = responses.find((response) => response.status === 429);
  assert.equal(denied.headers.get("retry-after"), "45");
  assert.match((await denied.json()).detail, /系统研究队列.*32/);
  const waiting = state.runs.filter((run) => [101, 201].includes(run.id) && run.status === "await_clarify");
  assert.equal(waiting.length, 1, "the rejected tenant run must remain retryable");
});

test("confirm responses stay compact when a report exists or execution is already queued", async () => {
  state.runs[0].report = JSON.stringify({ ...verifiedReport, filler: "x".repeat(600_000) });
  const completedResponse = await request("POST", ["runs", "101", "confirm"]);
  assert.equal(completedResponse.status, 200);
  const completedText = await completedResponse.text();
  assert.ok(Buffer.byteLength(completedText) < 2_048);
  const completed = JSON.parse(completedText);
  assert.deepEqual(Object.keys(completed).sort(), ["has_report", "id", "status", "updated_at"]);
  assert.equal(completed.status, "done");
  assert.equal(completed.has_report, 1);
  assert.equal("report" in completed, false);

  state.runs[0].status = "queued";
  state.runs[0].updated_at = Date.now() / 1_000;
  const queuedResponse = await request("POST", ["runs", "101", "confirm"]);
  assert.equal(queuedResponse.status, 202);
  assert.equal(queuedResponse.headers.get("retry-after"), "2");
  const queuedText = await queuedResponse.text();
  assert.ok(Buffer.byteLength(queuedText) < 2_048);
  const queued = JSON.parse(queuedText);
  assert.deepEqual(Object.keys(queued).sort(), ["has_report", "id", "status", "updated_at"]);
  assert.equal(queued.status, "queued");
  assert.equal(queued.has_report, 1);
  assert.equal("report" in queued, false);
});

test("concurrent create-run retries with one idempotency key create one run", async () => {
  const body = {
    mode: "category_keyword",
    payload: "Idempotent create fixture",
    marketplace: "US",
    view_profile: "P1",
    data_scope: "public_ok",
  };
  const headers = { "idempotency-key": "create-concurrency-001" };
  const responses = await Promise.all(Array.from({ length: 20 }, () =>
    request("POST", ["runs"], { body, headers })
  ));
  const payloads = await Promise.all(responses.map((response) => response.json()));
  const ids = new Set(payloads.map((payload) => payload.id));

  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  assert.equal(responses.filter((response) => response.status === 200).length, 19);
  assert.equal(ids.size, 1);
  const [createdId] = ids;
  assert.equal(state.runs.filter((run) => run.request_key === "create-run:create-concurrency-001").length, 1);

  const replay = await request("POST", ["runs"], { body, headers });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).id, createdId);

  const distinctResponses = await Promise.all([
    request("POST", ["runs"], {
      body,
      headers: { "idempotency-key": "create-concurrency-002" },
    }),
    request("POST", ["runs"], {
      body,
      headers: { "idempotency-key": "create-concurrency-003" },
    }),
  ]);
  assert.deepEqual(distinctResponses.map((response) => response.status), [201, 201]);
  const distinctIds = await Promise.all(distinctResponses.map(async (response) => (await response.json()).id));
  assert.equal(new Set(distinctIds).size, 2);
  assert.ok(distinctIds.every((id) => id !== createdId));
});

test("the queue consumer owns queued-to-done and ignores a stale redelivery", async () => {
  const claimedAt = 1_700_000_020;
  state.runs[0].status = "queued";
  state.runs[0].report = null;
  state.runs[0].verdict = null;
  state.runs[0].updated_at = claimedAt;
  state.runs[0].input_mode = "category_keyword";
  state.runs[0].input_payload = JSON.stringify("Queue owner fixture");
  state.runs[0].research_plan = JSON.stringify({
    category_scope: "Queue owner fixture",
    research_brief: {},
  });
  const message = { runId: 101, tenantId: 42, claimedAt };

  const completed = await queueModule.executeResearchJob(message);
  assert.deepEqual(completed, { outcome: "completed", runId: 101 });
  assert.equal(state.runs[0].status, "done");
  assert.ok(parseReport(state.runs[0].report));
  const completedReport = state.runs[0].report;

  const redelivery = await queueModule.executeResearchJob(message);
  assert.deepEqual(redelivery, { outcome: "stale", runId: 101 });
  assert.equal(state.runs[0].report, completedReport);
});

test("an active research execution lease delays redelivery without another model run", async () => {
  const claimedAt = 1_700_000_020;
  state.runs[0].status = "executing";
  state.runs[0].report = null;
  state.runs[0].updated_at = claimedAt;
  state.runs[0].execution_token = "active-owner";
  state.runs[0].execution_lease_until = Date.now() / 1_000 + 60;

  const result = await queueModule.executeResearchJob({ runId: 101, tenantId: 42, claimedAt });

  assert.equal(result.outcome, "busy");
  assert.equal(result.runId, 101);
  assert.equal(result.retryAfterSeconds >= 59, true);
  assert.equal(state.runs[0].status, "executing");
  assert.equal(state.runs[0].execution_token, "active-owner");
  assert.equal(state.runs[0].report, null);
});

test("confirm preserves a newly-started active lease after a long queued wait", async () => {
  const nowSeconds = 1_700_001_000;
  const claimedAt = nowSeconds - 10 * 60;
  state.runs[0].status = "executing";
  state.runs[0].report = null;
  state.runs[0].verdict = null;
  state.runs[0].updated_at = claimedAt;
  state.runs[0].execution_token = "newly-started-owner";
  state.runs[0].execution_lease_until = nowSeconds + 60;

  const response = await withFixedNow(nowSeconds * 1_000, () =>
    request("POST", ["runs", "101", "confirm"])
  );

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("retry-after"), "2");
  const receipt = await response.json();
  assert.equal(receipt.status, "executing");
  assert.equal(state.runs[0].status, "executing");
  assert.equal(state.runs[0].execution_token, "newly-started-owner");
  assert.equal(state.runs[0].execution_lease_until, nowSeconds + 60);
  assert.equal(state.runs[0].error_message, null);
  assert.equal(state.runs[0].failed_at, null);
});

test("confirm preserves an expired execution lease while it is inside the reaper grace window", async () => {
  const nowSeconds = 1_700_001_000;
  state.runs[0].status = "executing";
  state.runs[0].report = null;
  state.runs[0].verdict = null;
  state.runs[0].updated_at = nowSeconds - 60 * 60;
  state.runs[0].execution_token = "grace-owner";
  state.runs[0].execution_lease_until = nowSeconds - 299;

  const response = await withFixedNow(nowSeconds * 1_000, () =>
    request("POST", ["runs", "101", "confirm"])
  );

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("retry-after"), "2");
  assert.equal((await response.json()).status, "executing");
  assert.equal(state.runs[0].status, "executing");
  assert.equal(state.runs[0].execution_token, "grace-owner");
  assert.equal(state.runs[0].execution_lease_until, nowSeconds - 299);
  assert.equal(state.runs[0].error_message, null);
  assert.equal(state.runs[0].failed_at, null);
});

test("transient D1 failures while storing done are retried without writing business failure", async () => {
  const claimedAt = 1_700_000_020;
  state.runs[0].status = "queued";
  state.runs[0].report = null;
  state.runs[0].verdict = null;
  state.runs[0].updated_at = claimedAt;
  state.runs[0].input_mode = "category_keyword";
  state.runs[0].input_payload = JSON.stringify("Completion retry fixture");
  state.runs[0].research_plan = JSON.stringify({ category_scope: "Completion retry fixture" });
  let doneWriteAttempts = 0;
  let failedWriteAttempts = 0;
  state.beforeRunUpdate = (_row, sql) => {
    const normalized = normalizeSql(sql);
    if (/set status = 'done'/i.test(normalized)) {
      doneWriteAttempts += 1;
      if (doneWriteAttempts <= 2) throw new Error("D1_ERROR: transient completion write");
      return true;
    }
    if (/set status = 'failed'/i.test(normalized)) failedWriteAttempts += 1;
    return false;
  };

  const result = await queueModule.executeResearchJob({ runId: 101, tenantId: 42, claimedAt });

  assert.deepEqual(result, { outcome: "completed", runId: 101 });
  assert.equal(doneWriteAttempts, 3);
  assert.equal(failedWriteAttempts, 0);
  assert.equal(state.runs[0].status, "done");
  assert.equal(state.runs[0].error_message, null);
  assert.equal(state.runs[0].failed_at, null);
  assert.ok(parseReport(state.runs[0].report));
});

test("exhausted D1 completion writes escape to Queue retry and preserve the execution lease", async () => {
  const claimedAt = 1_700_000_020;
  state.runs[0].status = "queued";
  state.runs[0].report = null;
  state.runs[0].verdict = null;
  state.runs[0].updated_at = claimedAt;
  state.runs[0].input_mode = "category_keyword";
  state.runs[0].input_payload = JSON.stringify("Completion outage fixture");
  state.runs[0].research_plan = JSON.stringify({ category_scope: "Completion outage fixture" });
  let doneWriteAttempts = 0;
  let failedWriteAttempts = 0;
  state.beforeRunUpdate = (_row, sql) => {
    const normalized = normalizeSql(sql);
    if (/set status = 'done'/i.test(normalized)) {
      doneWriteAttempts += 1;
      throw new Error("D1_ERROR: completion store unavailable");
    }
    if (/set status = 'failed'/i.test(normalized)) failedWriteAttempts += 1;
    return false;
  };

  await assert.rejects(
    queueModule.executeResearchJob({ runId: 101, tenantId: 42, claimedAt }),
    /completion store unavailable/,
  );

  assert.equal(doneWriteAttempts, 3);
  assert.equal(failedWriteAttempts, 0);
  assert.equal(state.runs[0].status, "executing");
  assert.match(state.runs[0].execution_token, /^[0-9a-f-]{36}$/i);
  assert.equal(state.runs[0].execution_lease_until > Date.now() / 1_000, true);
  assert.equal(state.runs[0].report, null);
  assert.equal(state.runs[0].error_message, null);
  assert.equal(state.runs[0].failed_at, null);
});

test("cron reconciliation redelivers stranded jobs without destroying durable queue state", async () => {
  const nowSeconds = 1_700_010_000;
  const researchRun = (overrides) => {
    const run = rawRun(overrides);
    run.report = null;
    run.verdict = null;
    return run;
  };
  state.runs = [
    researchRun({
      id: 201,
      status: "queued",
      updated_at: nowSeconds - 3_601,
    }),
    researchRun({
      id: 202,
      status: "executing",
      updated_at: nowSeconds - 7_200,
      execution_token: "expired-owner",
      execution_lease_until: nowSeconds - 301,
    }),
    researchRun({
      id: 203,
      status: "executing",
      updated_at: nowSeconds - 3_601,
      execution_token: "missing-lease-owner",
      execution_lease_until: null,
    }),
    researchRun({
      id: 204,
      status: "executing",
      updated_at: nowSeconds - 7_200,
      execution_token: "active-owner",
      execution_lease_until: nowSeconds + 60,
    }),
    researchRun({
      id: 205,
      status: "executing",
      updated_at: nowSeconds - 7_200,
      execution_token: "grace-owner",
      execution_lease_until: nowSeconds + 60,
    }),
    researchRun({
      id: 206,
      title: "Reaper slot fixture",
      status: "await_clarify",
      updated_at: nowSeconds - 10,
      research_plan: JSON.stringify({ category_scope: "Reaper slot fixture" }),
    }),
  ];

  const reconciliation = await queueModule.reconcileResearchQueue(nowSeconds);
  await databaseModule.cleanupOperationalData(nowSeconds);

  assert.deepEqual(reconciliation, { scanned: 3, enqueued: 3, failed: 0 });
  assert.deepEqual(state.queuedJobs, [
    { runId: 202, tenantId: 42, claimedAt: nowSeconds - 7_200 },
    { runId: 201, tenantId: 42, claimedAt: nowSeconds - 3_601 },
    { runId: 203, tenantId: 42, claimedAt: nowSeconds - 3_601 },
  ]);
  for (const id of [201, 202, 203]) {
    const preserved = state.runs.find((run) => run.id === id);
    assert.ok(["queued", "executing"].includes(preserved.status));
    assert.equal(preserved.failed_at, null);
    assert.equal(preserved.error_message, null);
  }
  const active = state.runs.find((run) => run.id === 204);
  assert.equal(active.status, "executing");
  assert.equal(active.execution_token, "active-owner");
  assert.equal(active.execution_lease_until, nowSeconds + 60);
  const withinGrace = state.runs.find((run) => run.id === 205);
  assert.equal(withinGrace.status, "executing");
  assert.equal(withinGrace.execution_token, "grace-owner");
  assert.equal(withinGrace.execution_lease_until, nowSeconds + 60);

  state.queuedJobs = [];
  const response = await withFixedNow(nowSeconds * 1_000, () =>
    request("POST", ["runs", "206", "confirm"], {
      body: { research_plan: { category_scope: "Reaper slot fixture" } },
    })
  );

  assert.equal(response.status, 429);
  assert.equal(state.runs.find((run) => run.id === 206).status, "await_clarify");
  assert.deepEqual(state.queuedJobs, []);
});

test("an expired research lease is recoverable and its former worker is fenced", async () => {
  const claimedAt = 1_700_000_020;
  state.runs[0].status = "executing";
  state.runs[0].report = null;
  state.runs[0].verdict = null;
  state.runs[0].updated_at = claimedAt;
  state.runs[0].input_mode = "category_keyword";
  state.runs[0].input_payload = JSON.stringify("Lease recovery fixture");
  state.runs[0].research_plan = JSON.stringify({ category_scope: "Lease recovery fixture" });
  state.runs[0].execution_token = "expired-owner";
  state.runs[0].execution_lease_until = Date.now() / 1_000 - 1;
  state.beforeRunUpdate = (row, sql) => {
    if (!/set status = 'done'/i.test(normalizeSql(sql))) return false;
    row.execution_token = "newer-owner";
    row.execution_lease_until = Date.now() / 1_000 + 180;
    return true;
  };

  const fenced = await queueModule.executeResearchJob({ runId: 101, tenantId: 42, claimedAt });
  assert.deepEqual(fenced, { outcome: "stale", runId: 101 });
  assert.equal(state.runs[0].status, "executing");
  assert.equal(state.runs[0].execution_token, "newer-owner");
  assert.equal(state.runs[0].report, null);

  state.runs[0].execution_lease_until = Date.now() / 1_000 - 1;
  const recovered = await queueModule.executeResearchJob({ runId: 101, tenantId: 42, claimedAt });
  assert.deepEqual(recovered, { outcome: "completed", runId: 101 });
  assert.equal(state.runs[0].status, "done");
  assert.equal(state.runs[0].execution_token, null);
  assert.equal(state.runs[0].execution_lease_until, null);
  assert.ok(parseReport(state.runs[0].report));
});

test("JSON mutations reject simple text/plain requests before changing state", async () => {
  const response = await request("PATCH", ["runs", "101"], {
    body: completeReview(),
    headers: { "content-type": "text/plain" },
  });

  assert.equal(response.status, 415);
  assert.equal(state.runs[0].reviewed, 0);
  assert.equal(state.reviewEvents.length, 0);
});

test("concurrent review signing has one writer and one audit event even in the same millisecond", async () => {
  const responses = await withFixedNow(1_700_000_010_000, () =>
    Promise.all(Array.from({ length: 12 }, () =>
      request("PATCH", ["runs", "101"], { body: completeReview() })
    ))
  );
  const statuses = responses.map((response) => response.status);

  assert.equal(statuses.filter((status) => status === 200).length, 1);
  assert.equal(statuses.filter((status) => status === 409 || status === 429).length, 11);
  assert.equal(statuses.every((status) => [200, 409, 429].includes(status)), true);
  assert.equal(state.runs[0].reviewed, 1);
  assert.deepEqual(state.reviewEvents.map((event) => event.action), ["signed"]);
});

test("concurrent concept adoption has one writer and one audit event even in the same millisecond", async () => {
  const body = adoptionBody();
  const responses = await withFixedNow(1_700_000_010_000, () =>
    Promise.all(Array.from({ length: 12 }, () =>
      request("POST", ["runs", "101", "concept", "adopt"], { body })
    ))
  );
  const statuses = responses.map((response) => response.status);

  assert.equal(statuses.filter((status) => status === 200).length, 1);
  assert.equal(statuses.filter((status) => status === 409 || status === 429).length, 11);
  assert.equal(statuses.every((status) => [200, 409, 429].includes(status)), true);
  assert.equal(parseReport(state.runs[0].report).report_revision, 1);
  assert.deepEqual(state.reviewEvents.map((event) => event.action), ["concept_adopted"]);
});

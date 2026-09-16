import { env } from "cloudflare:workers";
import { boardReportSeeds } from "./board-reports";
import {
  inspectReportIntegrity,
  REPORT_INTEGRITY_CONTRACT_VERSION,
} from "./report-integrity";

export type AppUser = {
  id: number;
  tenant_id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  plan: string;
};

export type RunRecord = Record<string, unknown> & {
  id: number;
  tenant_id: number;
  user_id: number;
  title: string;
  input_mode: string;
  input_payload: unknown;
  marketplace: string;
  view_profile: string;
  data_scope: string;
  status: string;
  verdict?: string | null;
  research_plan?: Record<string, unknown> | null;
  report?: Record<string, unknown> | null;
  decision_outcome?: string | null;
  outcome_note?: string | null;
  reviewed?: number;
  reviewer_id?: number | null;
  reviewer_name?: string | null;
  reviewed_at?: number | null;
  review_checks?: Record<string, boolean> | null;
  review_report_hash?: string | null;
  evidence_mode?: string | null;
  decision_readiness?: string | null;
  error_message?: string | null;
  failed_at?: number | null;
  deleted_at?: number | null;
  mutation_token?: string | null;
  request_key?: string | null;
  execution_token?: string | null;
  execution_lease_until?: number | null;
  created_at: number;
  updated_at: number;
};

const runtimeEnv = env as unknown as Record<string, unknown>;

export type ConceptImageRecord = Record<string, unknown> & {
  id: number;
  run_id: number;
  tenant_id: number;
  user_id: number;
  status: string;
  prompt: string;
  design_brief: Record<string, unknown>;
  model?: string | null;
  lovart_project_id?: string | null;
  lovart_thread_id?: string | null;
  pending_confirmation?: Record<string, unknown> | null;
  artifacts?: Array<Record<string, unknown>> | null;
  public_token: string;
  error?: string | null;
  sync_lease_token?: string | null;
  sync_lease_until?: number | null;
  next_poll_at?: number | null;
  created_at: number;
  updated_at: number;
};

let schemaReady: Promise<void> | null = null;
const SCHEMA_REVISION = "metis-schema-2026-08-06.10-credit-management";
const SCHEMA_LOCK_KEY = `${SCHEMA_REVISION}:lock`;
const SCHEMA_LOCK_SECONDS = 120;
const BOARD_REPORT_REFRESH_MAX_ATTEMPTS = 3;
export const RESEARCH_QUEUED_TIMEOUT_SECONDS = 60 * 60;
export const RESEARCH_EXECUTION_REAPER_GRACE_SECONDS = 5 * 60;

export class SchemaInitializationInProgressError extends Error {
  readonly retryAfterSeconds = 2;

  constructor() {
    super("Database schema initialization is in progress");
  }
}

export class BoardReportSeedRefreshError extends Error {
  readonly code = "BOARD_REPORT_SEED_REFRESH_FAILED";

  constructor(
    readonly slug: string,
    readonly runId: number,
    readonly attempts: number,
    readonly reason: "conflict_exhausted" | "row_missing" | "partial_batch",
  ) {
    super(
      `[BOARD_REPORT_SEED_REFRESH_FAILED] slug=${slug} run_id=${runId} ` +
      `attempts=${attempts} reason=${reason}`,
    );
    this.name = "BoardReportSeedRefreshError";
  }
}

export function database(): D1Database {
  if (!env.DB) throw new Error("数据库暂不可用");
  return env.DB;
}

export async function ensureAdminAccount(): Promise<void> {
  const adminEmail = String(runtimeEnv.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const adminHash = String(runtimeEnv.BOOTSTRAP_ADMIN_PASSWORD_HASH || "").trim();
  const adminName = String(runtimeEnv.BOOTSTRAP_ADMIN_NAME || "管理员").trim().slice(0, 80) || "管理员";
  if (!adminEmail && !adminHash) return;
  const hashParts = /^pbkdf2\$(\d+)\$[a-f0-9]{32}\$[a-f0-9]{64}$/i.exec(adminHash);
  const iterations = Number(hashParts?.[1]);
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminEmail.length > 254 ||
    !hashParts || !Number.isInteger(iterations) || iterations < 50_000 || iterations > 100_000
  ) {
    throw new Error("Bootstrap admin configuration is invalid");
  }
  const now = Date.now() / 1000;
  const db = database();
  // D1 batches commit atomically. The empty-user guard applies inside the
  // transaction so concurrent cold starts cannot create orphan workspaces or
  // bootstrap a new administrator into an already initialized installation.
  await db.batch([
    db.prepare(`INSERT INTO tenants(name, plan, created_at)
      SELECT ?, 'pro', ? WHERE NOT EXISTS (SELECT 1 FROM users)`)
      .bind("Metis 管理员", now),
    db
      .prepare(`INSERT INTO users(
        tenant_id, email, pw_hash, name, role, created_at
      ) SELECT id, ?, ?, ?, 'admin', ? FROM tenants
        WHERE id = last_insert_rowid() AND NOT EXISTS (SELECT 1 FROM users)`)
      .bind(adminEmail, adminHash.toLowerCase(), adminName, now),
  ]);
}

async function ensureBoardReports(): Promise<void> {
  if (String(runtimeEnv.ENABLE_EXAMPLE_REPORTS || "").toLowerCase() !== "true") return;
  const db = database();
  const admin = await db
    .prepare(`SELECT id, tenant_id FROM users
      WHERE role = 'admin' AND COALESCE(status, 'active') = 'active'
      ORDER BY id ASC LIMIT 1`)
    .first<{ id: number; tenant_id: number }>();
  if (!admin) return;

  type BoardRunCandidate = {
    id: number;
    title: string;
    input_payload: string | null;
    report: string | null;
    status: string;
    decision_outcome: string | null;
    outcome_note: string | null;
    reviewed: number;
    reviewer_id: number | null;
    reviewer_name: string | null;
    review_checks: string | null;
    review_report_hash: string | null;
    mutation_token: string | null;
    deleted_at: number | null;
    updated_at: number;
  };
  const parseObject = (value: string | null): Record<string, unknown> => {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  };
  const existingBoardRuns = await db
    .prepare(`SELECT id, title, input_payload, report, status, decision_outcome,
        outcome_note, reviewed, reviewer_id, reviewer_name, review_checks,
        review_report_hash, mutation_token, deleted_at, updated_at
      FROM runs
      WHERE tenant_id = ? AND input_mode = 'board_research_2026'
      ORDER BY id DESC`)
    .bind(admin.tenant_id)
    .all<BoardRunCandidate>();
  const candidates = existingBoardRuns.results || [];
  const readCandidate = (runId: number) => db
    .prepare(`SELECT id, title, input_payload, report, status, decision_outcome,
        outcome_note, reviewed, reviewer_id, reviewer_name, review_checks,
        review_report_hash, mutation_token, deleted_at, updated_at
      FROM runs
      WHERE id = ? AND tenant_id = ? AND input_mode = 'board_research_2026'
      LIMIT 1`)
    .bind(runId, admin.tenant_id)
    .first<BoardRunCandidate>();

  const baseTime = Date.now() / 1000;
  for (let index = boardReportSeeds.length - 1; index >= 0; index -= 1) {
    const seed = boardReportSeeds[index];
    const activeCandidates = candidates.filter((candidate) => candidate.deleted_at == null);
    const slugMatches = activeCandidates.filter((candidate) =>
      String(parseObject(candidate.input_payload).slug || "") === seed.slug
    );
    const existing = slugMatches[0] || activeCandidates.find((candidate) => candidate.title === seed.title);
    const wasArchived = candidates.some((candidate) =>
      Boolean(candidate.deleted_at) && (
        String(parseObject(candidate.input_payload).slug || "") === seed.slug ||
        candidate.title === seed.title
      )
    );
    const payload = JSON.stringify({ slug: seed.slug, version: seed.version });
    const researchPlan = JSON.stringify(seed.research_plan);
    const report = JSON.stringify(seed.report);
    const timestamp = baseTime - (boardReportSeeds.length - 1 - index);
    if (existing) {
      const isCurrentBoardReport = (candidate: BoardRunCandidate): boolean => {
        const currentPayload = parseObject(candidate.input_payload);
        const currentReport = parseObject(candidate.report);
        const referenceLayout = currentReport.reference_layout && typeof currentReport.reference_layout === "object"
          ? currentReport.reference_layout as Record<string, unknown>
          : {};
        const referencePagePlan = Array.isArray(currentReport.reference_page_plan)
          ? currentReport.reference_page_plan
          : [];
        const hasCurrentPageContract = referencePagePlan.length === 332 && referencePagePlan.every((entry, pageIndex) => {
          if (!entry || typeof entry !== "object") return false;
          const page = entry as Record<string, unknown>;
          return page.page === pageIndex + 1 &&
            typeof page.role === "string" &&
            typeof page.layout === "string" &&
            Array.isArray(page.reference_blocks) && page.reference_blocks.length > 0 &&
            Array.isArray(page.augmentation_blocks);
        });
        const currentBaseVersion = String(
          currentReport.base_report_version || currentReport.report_version || "",
        );
        const currentIntegrity = inspectReportIntegrity(currentReport);
        const embeddedIntegrity = currentReport.report_integrity &&
            typeof currentReport.report_integrity === "object" &&
            !Array.isArray(currentReport.report_integrity)
          ? currentReport.report_integrity as Record<string, unknown>
          : {};
        return candidate.deleted_at == null &&
          String(currentPayload.version || "") === seed.version &&
          candidate.status === "done" &&
          currentReport.board_report === true &&
          currentReport.evidence_mode === seed.report.evidence_mode &&
          currentReport.decision_readiness === seed.report.decision_readiness &&
          currentReport.schema_version === "metis.report.v4" &&
          currentReport.presentation_version === "reference-a4-v2" &&
          currentBaseVersion === seed.version &&
          currentReport.reference_framework_modules === 62 &&
          referenceLayout.contract_version === "metis.reference-report.a4-landscape.332.v4" &&
          referenceLayout.total_pages === 332 &&
          referenceLayout.module_count === 62 &&
          hasCurrentPageContract &&
          currentReport.aigc_modules === 7 &&
          embeddedIntegrity.contract_version === REPORT_INTEGRITY_CONTRACT_VERSION &&
          currentIntegrity.structural_status === "complete" &&
          currentIntegrity.page_contract.required_blocks > 0 &&
          currentIntegrity.page_contract.source_resolved_required_blocks ===
            currentIntegrity.page_contract.required_blocks;
      };

      let candidate = existing;
      for (let attempt = 1; attempt <= BOARD_REPORT_REFRESH_MAX_ATTEMPTS; attempt += 1) {
        if (isCurrentBoardReport(candidate)) break;
        const mutationToken = crypto.randomUUID();
        const updateStatement = db
          .prepare(`UPDATE runs SET input_payload = ?, marketplace = 'US',
            view_profile = 'P1', data_scope = 'public_ok', status = 'done',
            verdict = ?, research_plan = ?, report = ?, reviewed = 0,
            decision_outcome = NULL, outcome_note = NULL,
            reviewer_id = NULL, reviewer_name = NULL, reviewed_at = NULL,
            review_checks = NULL, review_report_hash = NULL, error_message = NULL,
            failed_at = NULL, updated_at = ?, mutation_token = ?
            WHERE id = ? AND tenant_id = ? AND mutation_token IS ?
              AND reviewed = ? AND deleted_at IS NULL`)
          .bind(
            payload,
            seed.verdict,
            researchPlan,
            report,
            timestamp,
            mutationToken,
            candidate.id,
            admin.tenant_id,
            candidate.mutation_token,
            candidate.reviewed,
          );
        let updated = 0;
        if (candidate.reviewed) {
          const currentReport = parseObject(candidate.report);
          const priorVersion = String(currentReport.report_version || currentReport.schema_version || "unknown");
          const supersededNote = [
            `报告框架升级至 ${seed.version}，原签核自动失效。`,
            candidate.reviewer_name ? `原签核人：${candidate.reviewer_name}。` : "",
            candidate.outcome_note || "",
          ].filter(Boolean).join(" ");
          const eventStatement = db
            .prepare(`INSERT INTO review_events(
              run_id, tenant_id, reviewer_id, reviewer_name, action,
              decision_outcome, outcome_note, review_checks, report_hash,
              report_version, created_at
              ) SELECT ?, ?, ?, ?, 'superseded', ?, ?, ?, ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM runs WHERE id = ? AND tenant_id = ?
                  AND reviewed = 0 AND mutation_token = ?
                  AND deleted_at IS NULL
              )`)
            .bind(
              candidate.id,
              admin.tenant_id,
              0,
              "系统迁移",
              candidate.decision_outcome,
              supersededNote,
              candidate.review_checks,
              candidate.review_report_hash,
              priorVersion,
              timestamp,
              candidate.id,
              admin.tenant_id,
              mutationToken,
            );
          const results = await db.batch([updateStatement, eventStatement]);
          updated = Number(results[0]?.meta.changes || 0);
          const historyWritten = Number(results[1]?.meta.changes || 0);
          if ((updated === 1) !== (historyWritten === 1)) {
            throw new BoardReportSeedRefreshError(seed.slug, candidate.id, attempt, "partial_batch");
          }
        } else {
          const result = await updateStatement.run();
          updated = Number(result.meta.changes || 0);
        }
        if (updated === 1) break;

        const reread = await readCandidate(candidate.id);
        if (reread && isCurrentBoardReport(reread)) break;
        if (!reread || reread.deleted_at != null) {
          throw new BoardReportSeedRefreshError(seed.slug, candidate.id, attempt, "row_missing");
        }
        if (attempt === BOARD_REPORT_REFRESH_MAX_ATTEMPTS) {
          throw new BoardReportSeedRefreshError(seed.slug, candidate.id, attempt, "conflict_exhausted");
        }
        candidate = reread;
      }
      continue;
    }
    if (wasArchived) continue;
    await db
      .prepare(`INSERT INTO runs(
        tenant_id, user_id, title, input_mode, input_payload, marketplace,
        view_profile, data_scope, status, verdict, research_plan, report,
        reviewed, created_at, updated_at
      ) VALUES(?, ?, ?, 'board_research_2026', ?, 'US', 'P1', 'public_ok',
        'done', ?, ?, ?, 0, ?, ?)`)
      .bind(
        admin.tenant_id,
        admin.id,
        seed.title,
        payload,
        seed.verdict,
        researchPlan,
        report,
        timestamp,
        timestamp,
      )
      .run();
  }
}

export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = database();
      await db
        .prepare(`CREATE TABLE IF NOT EXISTS system_migrations (
          key TEXT PRIMARY KEY,
          applied_at REAL NOT NULL
        )`)
        .run();
      const completed = await db
        .prepare("SELECT applied_at FROM system_migrations WHERE key = ?")
        .bind(SCHEMA_REVISION)
        .first<{ applied_at: number }>();
      if (completed) {
        // A health check may initialize the schema before secrets are configured.
        // Bootstrap remains restricted to installations with no users.
        await ensureAdminAccount();
        return;
      }

      const claimedAt = Date.now() / 1000;
      const claim = await db
        .prepare(`INSERT INTO system_migrations(key, applied_at) VALUES(?, ?)
          ON CONFLICT(key) DO UPDATE SET applied_at = excluded.applied_at
          WHERE system_migrations.applied_at < ?`)
        .bind(SCHEMA_LOCK_KEY, claimedAt, claimedAt - SCHEMA_LOCK_SECONDS)
        .run();
      if (Number(claim.meta.changes || 0) !== 1) {
        throw new SchemaInitializationInProgressError();
      }

      try {
        await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS tenants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          plan TEXT NOT NULL DEFAULT 'trial',
          settings TEXT,
          settings_version INTEGER NOT NULL DEFAULT 0,
          created_at REAL NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          email TEXT NOT NULL UNIQUE,
          pw_hash TEXT NOT NULL,
          name TEXT,
          role TEXT NOT NULL DEFAULT 'member',
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
          created_at REAL NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS credit_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0 AND balance <= 9000000000000),
          version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
          last_mutation_token TEXT,
          created_at REAL NOT NULL,
          updated_at REAL NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS credit_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          actor_user_id INTEGER NOT NULL,
          amount INTEGER NOT NULL CHECK(amount <> 0 AND amount BETWEEN -1000000000 AND 1000000000),
          balance_before INTEGER NOT NULL CHECK(balance_before >= 0),
          balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
          reason TEXT NOT NULL,
          note TEXT,
          source_type TEXT NOT NULL,
          source_id TEXT,
          idempotency_key TEXT NOT NULL,
          mutation_token TEXT NOT NULL,
          created_at REAL NOT NULL,
          CHECK(balance_after = balance_before + amount)
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS credit_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          rule_key TEXT NOT NULL,
          label TEXT NOT NULL,
          cost INTEGER NOT NULL DEFAULT 0 CHECK(cost >= 0 AND cost <= 1000000000),
          enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
          updated_by INTEGER,
          created_at REAL NOT NULL,
          updated_at REAL NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          tenant_id INTEGER NOT NULL,
          expires_at REAL NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          title TEXT,
          input_mode TEXT,
          input_payload TEXT,
          marketplace TEXT,
          view_profile TEXT DEFAULT 'P1',
          data_scope TEXT DEFAULT 'public_ok',
          status TEXT DEFAULT 'await_clarify',
          verdict TEXT,
          research_plan TEXT,
          report TEXT,
          evidence_mode TEXT,
          decision_readiness TEXT,
          decision_outcome TEXT,
          outcome_note TEXT,
          reviewed INTEGER DEFAULT 0,
          reviewer_id INTEGER,
          reviewer_name TEXT,
          reviewed_at REAL,
          review_checks TEXT,
          review_report_hash TEXT,
          error_message TEXT,
          failed_at REAL,
          deleted_at REAL,
          mutation_token TEXT,
          request_key TEXT,
          execution_token TEXT,
          execution_lease_until REAL,
          created_at REAL NOT NULL,
          updated_at REAL NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS review_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL,
          tenant_id INTEGER NOT NULL,
          reviewer_id INTEGER NOT NULL,
          reviewer_name TEXT NOT NULL,
          action TEXT NOT NULL,
          decision_outcome TEXT,
          outcome_note TEXT,
          review_checks TEXT,
          report_hash TEXT,
          report_version TEXT,
          created_at REAL NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS concept_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL,
          tenant_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          prompt TEXT NOT NULL,
          design_brief TEXT NOT NULL,
          model TEXT,
          lovart_project_id TEXT,
          lovart_thread_id TEXT,
          pending_confirmation TEXT,
          artifacts TEXT,
          public_token TEXT NOT NULL UNIQUE,
          error TEXT,
          sync_lease_token TEXT,
          sync_lease_until REAL,
          next_poll_at REAL,
          created_at REAL NOT NULL,
          updated_at REAL NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS auth_attempts (
          attempt_key TEXT PRIMARY KEY,
          failures INTEGER NOT NULL DEFAULT 0,
          first_failed_at REAL NOT NULL,
          blocked_until REAL NOT NULL DEFAULT 0
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS rate_limit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bucket TEXT NOT NULL,
          event_at REAL NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS system_migrations (
          key TEXT PRIMARY KEY,
          applied_at REAL NOT NULL
        )`),
      ]);
      await db.batch([
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email)"),
        db.prepare("CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id)"),
        db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS credit_accounts_tenant_user_unique
          ON credit_accounts(tenant_id, user_id)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS credit_accounts_tenant_balance_idx
          ON credit_accounts(tenant_id, balance)`),
        db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_tenant_idempotency_unique
          ON credit_ledger(tenant_id, idempotency_key)`),
        db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_mutation_token_unique
          ON credit_ledger(mutation_token)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS credit_ledger_tenant_user_id_idx
          ON credit_ledger(tenant_id, user_id, id)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS credit_ledger_tenant_id_idx
          ON credit_ledger(tenant_id, id)`),
        db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS credit_rules_tenant_key_unique
          ON credit_rules(tenant_id, rule_key)`),
        db.prepare("CREATE INDEX IF NOT EXISTS credit_rules_tenant_idx ON credit_rules(tenant_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS runs_tenant_id_idx ON runs(tenant_id, id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS concept_images_run_idx ON concept_images(run_id, id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS concept_images_tenant_idx ON concept_images(tenant_id, id)"),
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS concept_images_public_token_unique ON concept_images(public_token)"),
        db.prepare("CREATE INDEX IF NOT EXISTS review_events_run_idx ON review_events(run_id, id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS review_events_tenant_idx ON review_events(tenant_id, id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS auth_attempts_blocked_idx ON auth_attempts(blocked_until)"),
        db.prepare(`CREATE INDEX IF NOT EXISTS rate_limit_events_bucket_time_idx
          ON rate_limit_events(bucket, event_at)`),
      ]);
      const userColumns = await db
        .prepare("PRAGMA table_info(users)")
        .all<{ name: string }>();
      if (!userColumns.results.some((column) => column.name === "role")) {
        await db
          .prepare("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'")
          .run();
      }
      if (!userColumns.results.some((column) => column.name === "status")) {
        await db
          .prepare("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
          .run();
      }
      await db.batch([
        db.prepare(`CREATE TRIGGER IF NOT EXISTS credit_ledger_reject_update
          BEFORE UPDATE ON credit_ledger
          BEGIN
            SELECT RAISE(ABORT, 'credit ledger is append-only');
          END`),
        db.prepare(`CREATE TRIGGER IF NOT EXISTS credit_ledger_reject_delete
          BEFORE DELETE ON credit_ledger
          BEGIN
            SELECT RAISE(ABORT, 'credit ledger is append-only');
          END`),
      ]);
      const tenantColumns = await db
        .prepare("PRAGMA table_info(tenants)")
        .all<{ name: string }>();
      if (!tenantColumns.results.some((column) => column.name === "settings_version")) {
        await db
          .prepare("ALTER TABLE tenants ADD COLUMN settings_version INTEGER NOT NULL DEFAULT 0")
          .run();
      }
      const runColumns = await db
        .prepare("PRAGMA table_info(runs)")
        .all<{ name: string }>();
      const existingRunColumns = new Set(runColumns.results.map((column) => column.name));
      const missingRunColumns = [
        ["reviewer_id", "INTEGER"],
        ["reviewer_name", "TEXT"],
        ["reviewed_at", "REAL"],
        ["review_checks", "TEXT"],
        ["review_report_hash", "TEXT"],
        ["error_message", "TEXT"],
        ["failed_at", "REAL"],
        ["deleted_at", "REAL"],
        ["mutation_token", "TEXT"],
        ["request_key", "TEXT"],
        ["execution_token", "TEXT"],
        ["execution_lease_until", "REAL"],
        ["evidence_mode", "TEXT"],
        ["decision_readiness", "TEXT"],
      ] as const;
      for (const [column, type] of missingRunColumns) {
        if (!existingRunColumns.has(column)) {
          await db.prepare(`ALTER TABLE runs ADD COLUMN ${column} ${type}`).run();
        }
      }
      // Report writers also run in Queue consumers. Database triggers keep the
      // lightweight list/gate columns in the same transaction as every report write.
      await db.batch([
        db.prepare(`CREATE TRIGGER IF NOT EXISTS runs_report_metadata_after_insert
          AFTER INSERT ON runs
          WHEN NEW.report IS NOT NULL OR NEW.evidence_mode IS NOT NULL OR NEW.decision_readiness IS NOT NULL
          BEGIN
            UPDATE runs SET
              evidence_mode = CASE WHEN NEW.report IS NOT NULL AND json_valid(NEW.report)
                THEN json_extract(NEW.report, '$.evidence_mode') ELSE NULL END,
              decision_readiness = CASE WHEN NEW.report IS NOT NULL AND json_valid(NEW.report)
                THEN json_extract(NEW.report, '$.decision_readiness') ELSE NULL END
              WHERE id = NEW.id;
          END`),
        db.prepare(`CREATE TRIGGER IF NOT EXISTS runs_report_metadata_after_update
          AFTER UPDATE OF report ON runs
          BEGIN
            UPDATE runs SET
              evidence_mode = CASE WHEN NEW.report IS NOT NULL AND json_valid(NEW.report)
                THEN json_extract(NEW.report, '$.evidence_mode') ELSE NULL END,
              decision_readiness = CASE WHEN NEW.report IS NOT NULL AND json_valid(NEW.report)
                THEN json_extract(NEW.report, '$.decision_readiness') ELSE NULL END
              WHERE id = NEW.id;
          END`),
        db.prepare(`UPDATE runs SET
          evidence_mode = CASE WHEN report IS NOT NULL AND json_valid(report)
            THEN json_extract(report, '$.evidence_mode') ELSE NULL END,
          decision_readiness = CASE WHEN report IS NOT NULL AND json_valid(report)
            THEN json_extract(report, '$.decision_readiness') ELSE NULL END`),
      ]);
      await db.batch([
        db.prepare(`CREATE INDEX IF NOT EXISTS runs_tenant_deleted_id_idx
          ON runs(tenant_id, deleted_at, id)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS runs_tenant_status_deleted_idx
          ON runs(tenant_id, status, deleted_at)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS runs_status_deleted_updated_idx
          ON runs(status, deleted_at, updated_at)`),
        db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS runs_tenant_request_key_unique
          ON runs(tenant_id, request_key)`),
      ]);
      const conceptColumns = await db
        .prepare("PRAGMA table_info(concept_images)")
        .all<{ name: string }>();
      const existingConceptColumns = new Set(conceptColumns.results.map((column) => column.name));
      const missingConceptColumns = [
        ["sync_lease_token", "TEXT"],
        ["sync_lease_until", "REAL"],
        ["next_poll_at", "REAL"],
      ] as const;
      for (const [column, type] of missingConceptColumns) {
        if (!existingConceptColumns.has(column)) {
          await db.prepare(`ALTER TABLE concept_images ADD COLUMN ${column} ${type}`).run();
        }
      }
      const invalidLegacyReviewWhere = `reviewed = 1 AND (
        decision_outcome IS NULL OR TRIM(decision_outcome) = '' OR
        outcome_note IS NULL OR TRIM(outcome_note) = '' OR
        COALESCE(reviewer_id, 0) <= 0 OR
        reviewer_name IS NULL OR TRIM(reviewer_name) = '' OR
        COALESCE(reviewed_at, 0) <= 0 OR
        review_checks IS NULL OR json_valid(review_checks) = 0 OR
        json_extract(review_checks, '$.evidence') IS NOT 1 OR
        json_extract(review_checks, '$.economics') IS NOT 1 OR
        json_extract(review_checks, '$.risk') IS NOT 1 OR
        review_report_hash IS NULL OR LENGTH(review_report_hash) != 64 OR
        review_report_hash GLOB '*[^0-9a-fA-F]*'
      )`;
      const migrationTime = Date.now() / 1000;
      await db.batch([
        db.prepare(`INSERT INTO review_events(
          run_id, tenant_id, reviewer_id, reviewer_name, action,
          decision_outcome, outcome_note, review_checks, report_hash,
          report_version, created_at
        ) SELECT id, tenant_id, 0, '系统迁移', 'legacy_invalidated',
          decision_outcome,
          '历史签核缺少新版三项检查、审核人、时间或内容哈希，已降级为待重新终审。 ' ||
            COALESCE(outcome_note, ''),
          review_checks, review_report_hash,
          CASE WHEN json_valid(report) THEN COALESCE(
            json_extract(report, '$.report_version'),
            json_extract(report, '$.schema_version'),
            'unknown'
          ) ELSE 'unknown' END,
          ?
          FROM runs AS legacy_run
          WHERE ${invalidLegacyReviewWhere}
            AND NOT EXISTS (
              SELECT 1 FROM review_events AS prior_event
              WHERE prior_event.run_id = legacy_run.id
                AND prior_event.action = 'legacy_invalidated'
                AND COALESCE(prior_event.report_hash, '') =
                  COALESCE(legacy_run.review_report_hash, '')
            )`)
          .bind(migrationTime),
        db.prepare(`UPDATE runs SET reviewed = 0, reviewer_id = NULL,
          reviewer_name = NULL, reviewed_at = NULL, review_checks = NULL,
          review_report_hash = NULL, updated_at = ?
          WHERE ${invalidLegacyReviewWhere}`)
          .bind(migrationTime),
      ]);
      await db
        .prepare("DELETE FROM auth_attempts WHERE blocked_until < ? AND first_failed_at < ?")
        .bind(Date.now() / 1000 - 86_400, Date.now() / 1000 - 86_400)
        .run();
      await db
        .prepare("DELETE FROM rate_limit_events WHERE event_at < ?")
        .bind(Date.now() / 1000 - 172_800)
        .run();
        await ensureAdminAccount();
        await ensureBoardReports();
        await db.batch([
          db.prepare("INSERT OR REPLACE INTO system_migrations(key, applied_at) VALUES(?, ?)")
            .bind(SCHEMA_REVISION, Date.now() / 1000),
          db.prepare("DELETE FROM system_migrations WHERE key = ? AND applied_at = ?")
            .bind(SCHEMA_LOCK_KEY, claimedAt),
        ]);
      } catch (error) {
        await db
          .prepare("DELETE FROM system_migrations WHERE key = ? AND applied_at = ?")
          .bind(SCHEMA_LOCK_KEY, claimedAt)
          .run()
          .catch(() => undefined);
        throw error;
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function hydrateRun(row: Record<string, unknown> | null, brief = false): RunRecord | null {
  if (!row) return null;
  const hydrated = { ...row } as RunRecord;
  hydrated.input_payload = parseJson(row.input_payload);
  hydrated.review_checks = parseJson(row.review_checks) as Record<string, boolean> | null;
  if (!brief) {
    hydrated.research_plan = parseJson(row.research_plan) as Record<string, unknown> | null;
    hydrated.report = parseJson(row.report) as Record<string, unknown> | null;
  } else {
    delete hydrated.research_plan;
    delete hydrated.report;
  }
  return hydrated;
}

export function hydrateConcept(
  row: Record<string, unknown> | null,
): ConceptImageRecord | null {
  if (!row) return null;
  const hydrated = { ...row } as ConceptImageRecord;
  hydrated.design_brief = parseJson(row.design_brief) as Record<string, unknown>;
  hydrated.pending_confirmation = parseJson(row.pending_confirmation) as Record<string, unknown> | null;
  hydrated.artifacts = parseJson(row.artifacts) as Array<Record<string, unknown>> | null;
  return hydrated;
}

export async function getLatestConcept(
  runId: number,
  tenantId: number,
): Promise<ConceptImageRecord | null> {
  const row = await database()
    .prepare(`SELECT * FROM concept_images
      WHERE run_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(runId, tenantId)
    .first<Record<string, unknown>>();
  return hydrateConcept(row);
}

export async function getRun(runId: number, tenantId: number): Promise<RunRecord | null> {
  const row = await database()
    .prepare("SELECT * FROM runs WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL")
    .bind(runId, tenantId)
    .first<Record<string, unknown>>();
  return hydrateRun(row);
}

export type RunConceptGateRecord = {
  id: number;
  data_scope: string;
  evidence_mode: string | null;
  decision_readiness: string | null;
  has_report: number;
};

export async function getRunConceptGate(
  runId: number,
  tenantId: number,
): Promise<RunConceptGateRecord | null> {
  return database()
    .prepare(`SELECT id, data_scope, evidence_mode, decision_readiness,
      CASE WHEN evidence_mode IS NULL AND decision_readiness IS NULL THEN 0 ELSE 1 END AS has_report
      FROM runs WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`)
    .bind(runId, tenantId)
    .first<RunConceptGateRecord>();
}

export async function getRunByRequestKey(
  tenantId: number,
  requestKey: string,
): Promise<RunRecord | null> {
  const row = await database()
    .prepare(`SELECT * FROM runs
      WHERE tenant_id = ? AND request_key = ? AND deleted_at IS NULL LIMIT 1`)
    .bind(tenantId, requestKey)
    .first<Record<string, unknown>>();
  return hydrateRun(row);
}

export type RunStatusRecord = {
  id: number;
  status: string;
  verdict: string | null;
  error_message: string | null;
  failed_at: number | null;
  updated_at: number;
  has_report: number;
};

export async function getRunStatus(
  runId: number,
  tenantId: number,
): Promise<RunStatusRecord | null> {
  return database()
    .prepare(`SELECT id, status, verdict, error_message, failed_at, updated_at,
      CASE WHEN report IS NULL THEN 0 ELSE 1 END AS has_report
      FROM runs WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`)
    .bind(runId, tenantId)
    .first<RunStatusRecord>();
}

export type ActiveResearchCounts = {
  tenant_active: number;
  global_active: number;
};

export async function getActiveResearchCounts(tenantId: number): Promise<ActiveResearchCounts> {
  const counts = await database()
    .prepare(`SELECT
      COALESCE(SUM(CASE WHEN tenant_id = ? THEN 1 ELSE 0 END), 0) AS tenant_active,
      COUNT(*) AS global_active
      FROM runs
      WHERE status IN ('queued', 'executing') AND deleted_at IS NULL`)
    .bind(tenantId)
    .first<ActiveResearchCounts>();
  return {
    tenant_active: Number(counts?.tenant_active || 0),
    global_active: Number(counts?.global_active || 0),
  };
}

export async function cleanupOperationalData(nowSeconds = Date.now() / 1000): Promise<void> {
  const db = database();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(nowSeconds),
    db.prepare("DELETE FROM auth_attempts WHERE blocked_until < ? AND first_failed_at < ?")
      .bind(nowSeconds - 86_400, nowSeconds - 86_400),
    db.prepare("DELETE FROM rate_limit_events WHERE event_at < ?")
      .bind(nowSeconds - 172_800),
    db.prepare(`UPDATE concept_images SET sync_lease_token = NULL, sync_lease_until = NULL
      WHERE sync_lease_until IS NOT NULL AND sync_lease_until <= ?`)
      .bind(nowSeconds),
  ]);
}

export const RUN_LIST_DEFAULT_LIMIT = 50;
export const RUN_LIST_MAX_LIMIT = 100;

export type RunListOptions = {
  limit?: number;
  beforeId?: number;
  beforeDeletedAt?: number;
};

function hydrateRunSummary(row: Record<string, unknown>): RunRecord {
  const metadata = parseJson(row.report_metadata);
  const [evidenceMode, decisionReadiness] = Array.isArray(metadata) ? metadata : [null, null];
  const summary: Record<string, unknown> = {
    ...row,
    evidence_mode: evidenceMode ?? null,
    decision_readiness: decisionReadiness ?? null,
  };
  delete summary.report_metadata;
  return hydrateRun(summary, true) as RunRecord;
}

function runListLimit(value: number | undefined): number {
  if (!Number.isInteger(value)) return RUN_LIST_DEFAULT_LIMIT;
  return Math.min(RUN_LIST_MAX_LIMIT + 1, Math.max(1, Number(value)));
}

export async function listRuns(
  tenantId: number,
  options: RunListOptions = {},
): Promise<RunRecord[]> {
  const beforeId = Number(options.beforeId || 0);
  const cursorClause = beforeId > 0 ? " AND id < ?" : "";
  const bindings = beforeId > 0
    ? [tenantId, beforeId, runListLimit(options.limit)]
    : [tenantId, runListLimit(options.limit)];
  const result = await database()
    .prepare(`SELECT id, tenant_id, user_id, title, input_mode, input_payload,
      marketplace, view_profile, data_scope, status, verdict, decision_outcome,
      outcome_note, reviewed, reviewer_id, reviewer_name, reviewed_at,
      review_checks, review_report_hash, error_message, failed_at,
      deleted_at,
      json_array(evidence_mode, decision_readiness) AS report_metadata,
      created_at, updated_at
      FROM runs WHERE tenant_id = ? AND deleted_at IS NULL${cursorClause}
      ORDER BY id DESC LIMIT ?`)
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return result.results.map(hydrateRunSummary);
}

export async function listArchivedRuns(
  tenantId: number,
  options: RunListOptions = {},
): Promise<RunRecord[]> {
  const beforeId = Number(options.beforeId || 0);
  const beforeDeletedAt = Number(options.beforeDeletedAt || 0);
  const hasCursor = beforeId > 0 && beforeDeletedAt > 0;
  const cursorClause = hasCursor
    ? " AND (deleted_at < ? OR (deleted_at = ? AND id < ?))"
    : "";
  const bindings = hasCursor
    ? [tenantId, beforeDeletedAt, beforeDeletedAt, beforeId, runListLimit(options.limit)]
    : [tenantId, runListLimit(options.limit)];
  const result = await database()
    .prepare(`SELECT id, tenant_id, user_id, title, input_mode, input_payload,
      marketplace, view_profile, data_scope, status, verdict, decision_outcome,
      outcome_note, reviewed, reviewer_id, reviewer_name, reviewed_at,
      review_checks, review_report_hash, error_message, failed_at, deleted_at,
      json_array(evidence_mode, decision_readiness) AS report_metadata,
      created_at, updated_at
      FROM runs WHERE tenant_id = ? AND deleted_at IS NOT NULL${cursorClause}
      ORDER BY deleted_at DESC, id DESC LIMIT ?`)
    .bind(...bindings)
    .all<Record<string, unknown>>();
  return result.results.map(hydrateRunSummary);
}

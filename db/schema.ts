import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("trial"),
  settings: text("settings"),
  settingsVersion: integer("settings_version").notNull().default(0),
  createdAt: real("created_at").notNull(),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  email: text("email").notNull(),
  pwHash: text("pw_hash").notNull(),
  name: text("name"),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("active"),
  createdAt: real("created_at").notNull(),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  index("users_tenant_idx").on(table.tenantId),
]);

export const creditAccounts = sqliteTable("credit_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  userId: integer("user_id").notNull(),
  balance: integer("balance").notNull().default(0),
  version: integer("version").notNull().default(0),
  lastMutationToken: text("last_mutation_token"),
  createdAt: real("created_at").notNull(),
  updatedAt: real("updated_at").notNull(),
}, (table) => [
  uniqueIndex("credit_accounts_tenant_user_unique").on(table.tenantId, table.userId),
  index("credit_accounts_tenant_balance_idx").on(table.tenantId, table.balance),
]);

export const creditLedger = sqliteTable("credit_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  userId: integer("user_id").notNull(),
  actorUserId: integer("actor_user_id").notNull(),
  amount: integer("amount").notNull(),
  balanceBefore: integer("balance_before").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(),
  note: text("note"),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  mutationToken: text("mutation_token").notNull(),
  createdAt: real("created_at").notNull(),
}, (table) => [
  uniqueIndex("credit_ledger_tenant_idempotency_unique").on(table.tenantId, table.idempotencyKey),
  uniqueIndex("credit_ledger_mutation_token_unique").on(table.mutationToken),
  index("credit_ledger_tenant_user_id_idx").on(table.tenantId, table.userId, table.id),
  index("credit_ledger_tenant_id_idx").on(table.tenantId, table.id),
]);

export const creditRules = sqliteTable("credit_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  ruleKey: text("rule_key").notNull(),
  label: text("label").notNull(),
  cost: integer("cost").notNull().default(0),
  enabled: integer("enabled").notNull().default(0),
  updatedBy: integer("updated_by"),
  createdAt: real("created_at").notNull(),
  updatedAt: real("updated_at").notNull(),
}, (table) => [
  uniqueIndex("credit_rules_tenant_key_unique").on(table.tenantId, table.ruleKey),
  index("credit_rules_tenant_idx").on(table.tenantId),
]);

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  expiresAt: real("expires_at").notNull(),
}, (table) => [
  index("sessions_user_idx").on(table.userId),
  index("sessions_expires_idx").on(table.expiresAt),
]);

export const authAttempts = sqliteTable("auth_attempts", {
  attemptKey: text("attempt_key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  firstFailedAt: real("first_failed_at").notNull(),
  blockedUntil: real("blocked_until").notNull().default(0),
}, (table) => [
  index("auth_attempts_blocked_idx").on(table.blockedUntil),
]);

export const rateLimitEvents = sqliteTable("rate_limit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bucket: text("bucket").notNull(),
  eventAt: real("event_at").notNull(),
}, (table) => [
  index("rate_limit_events_bucket_time_idx").on(table.bucket, table.eventAt),
]);

export const systemMigrations = sqliteTable("system_migrations", {
  key: text("key").primaryKey(),
  appliedAt: real("applied_at").notNull(),
});

export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull(),
  userId: integer("user_id").notNull(),
  title: text("title"),
  inputMode: text("input_mode"),
  inputPayload: text("input_payload"),
  marketplace: text("marketplace"),
  viewProfile: text("view_profile").default("P1"),
  dataScope: text("data_scope").default("public_ok"),
  status: text("status").default("await_clarify"),
  verdict: text("verdict"),
  researchPlan: text("research_plan"),
  report: text("report"),
  evidenceMode: text("evidence_mode"),
  decisionReadiness: text("decision_readiness"),
  decisionOutcome: text("decision_outcome"),
  outcomeNote: text("outcome_note"),
  reviewed: integer("reviewed").default(0),
  reviewerId: integer("reviewer_id"),
  reviewerName: text("reviewer_name"),
  reviewedAt: real("reviewed_at"),
  reviewChecks: text("review_checks"),
  reviewReportHash: text("review_report_hash"),
  errorMessage: text("error_message"),
  failedAt: real("failed_at"),
  deletedAt: real("deleted_at"),
  mutationToken: text("mutation_token"),
  requestKey: text("request_key"),
  executionToken: text("execution_token"),
  executionLeaseUntil: real("execution_lease_until"),
  createdAt: real("created_at").notNull(),
  updatedAt: real("updated_at").notNull(),
}, (table) => [
  index("runs_tenant_id_idx").on(table.tenantId, table.id),
  index("runs_tenant_deleted_id_idx").on(table.tenantId, table.deletedAt, table.id),
  index("runs_tenant_status_deleted_idx").on(table.tenantId, table.status, table.deletedAt),
  index("runs_status_deleted_updated_idx").on(table.status, table.deletedAt, table.updatedAt),
  uniqueIndex("runs_tenant_request_key_unique").on(table.tenantId, table.requestKey),
]);

export const reviewEvents = sqliteTable("review_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  reviewerId: integer("reviewer_id").notNull(),
  reviewerName: text("reviewer_name").notNull(),
  action: text("action").notNull(),
  decisionOutcome: text("decision_outcome"),
  outcomeNote: text("outcome_note"),
  reviewChecks: text("review_checks"),
  reportHash: text("report_hash"),
  reportVersion: text("report_version"),
  createdAt: real("created_at").notNull(),
}, (table) => [
  index("review_events_run_idx").on(table.runId, table.id),
  index("review_events_tenant_idx").on(table.tenantId, table.id),
]);

export const conceptImages = sqliteTable("concept_images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull(),
  tenantId: integer("tenant_id").notNull(),
  userId: integer("user_id").notNull(),
  status: text("status").notNull().default("queued"),
  prompt: text("prompt").notNull(),
  designBrief: text("design_brief").notNull(),
  model: text("model"),
  lovartProjectId: text("lovart_project_id"),
  lovartThreadId: text("lovart_thread_id"),
  pendingConfirmation: text("pending_confirmation"),
  artifacts: text("artifacts"),
  publicToken: text("public_token").notNull(),
  error: text("error"),
  syncLeaseToken: text("sync_lease_token"),
  syncLeaseUntil: real("sync_lease_until"),
  nextPollAt: real("next_poll_at"),
  createdAt: real("created_at").notNull(),
  updatedAt: real("updated_at").notNull(),
}, (table) => [
  index("concept_images_run_idx").on(table.runId, table.id),
  index("concept_images_tenant_idx").on(table.tenantId, table.id),
  uniqueIndex("concept_images_public_token_unique").on(table.publicToken),
]);

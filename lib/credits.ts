import { database } from "./database";

export const MAX_CREDIT_BALANCE = 9_000_000_000_000;
export const MAX_CREDIT_ADJUSTMENT = 1_000_000_000;
export const CREDIT_LEDGER_DEFAULT_LIMIT = 20;
export const CREDIT_LEDGER_MAX_LIMIT = 100;
export const ADMIN_USER_DEFAULT_LIMIT = 20;
export const ADMIN_USER_MAX_LIMIT = 100;

export const DEFAULT_CREDIT_RULES = [
  { key: "research_generation", label: "生成研究报告" },
  { key: "scene_suite_generation", label: "生成专业场景套图" },
] as const;

export type CreditRuleKey = typeof DEFAULT_CREDIT_RULES[number]["key"];

export class CreditDomainError extends Error {
  constructor(
    readonly code: "user_not_found" | "insufficient_credits" | "idempotency_conflict" |
      "credit_conflict" | "rule_not_found" | "invalid_credit_operation" | "operation_refunded",
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type CreditTransaction = {
  id: number;
  tenant_id: number;
  user_id: number;
  actor_user_id: number;
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string;
  note: string | null;
  source_type: string;
  source_id: string | null;
  idempotency_key: string;
  created_at: number;
};

type CreditAccount = {
  balance: number;
  version: number;
  updated_at: number;
};

type ManagedUserRow = {
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  created_at: number;
  credit_balance: number;
  credit_version: number;
};

function safePositiveId(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CreditDomainError("invalid_credit_operation", `${field}无效`, 400);
  }
  return value;
}

function safeAmount(value: number, allowZero = false): number {
  if (!Number.isSafeInteger(value) || (!allowZero && value === 0) ||
    Math.abs(value) > MAX_CREDIT_ADJUSTMENT) {
    throw new CreditDomainError(
      "invalid_credit_operation",
      `积分数量必须是绝对值不超过 ${MAX_CREDIT_ADJUSTMENT} 的${allowZero ? "非负" : "非零"}整数`,
      400,
    );
  }
  if (allowZero && value < 0) {
    throw new CreditDomainError("invalid_credit_operation", "初始积分不能为负数", 400);
  }
  return value;
}

function bounded(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function validIdempotencyKey(value: string): string {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new CreditDomainError("invalid_credit_operation", "积分幂等键格式无效", 400);
  }
  return key;
}

function creditAccountStatement(
  tenantId: number,
  userId: number,
  now: number,
): D1PreparedStatement {
  return database()
    .prepare(`INSERT OR IGNORE INTO credit_accounts(
      tenant_id, user_id, balance, version, created_at, updated_at
    ) SELECT ?, id, 0, 0, ?, ? FROM users
      WHERE id = ? AND tenant_id = ?`)
    .bind(tenantId, now, now, userId, tenantId);
}

async function accountForUser(tenantId: number, userId: number): Promise<CreditAccount | null> {
  return database()
    .prepare(`SELECT balance, version, updated_at FROM credit_accounts
      WHERE tenant_id = ? AND user_id = ?`)
    .bind(tenantId, userId)
    .first<CreditAccount>();
}

export async function applyCreditAdjustment(input: {
  tenantId: number;
  userId: number;
  actorUserId: number;
  amount: number;
  reason: string;
  note?: string;
  sourceType: "manual_adjustment" | "rule_debit" | "initial_grant" | "refund";
  sourceId?: string;
  idempotencyKey: string;
}): Promise<{ balance: number; version: number; transaction: CreditTransaction; replayed: boolean }> {
  const tenantId = safePositiveId(input.tenantId, "工作区编号");
  const userId = safePositiveId(input.userId, "用户编号");
  const actorUserId = safePositiveId(input.actorUserId, "操作人编号");
  const amount = safeAmount(input.amount);
  const reason = bounded(input.reason, 160);
  const note = bounded(input.note, 1_000);
  const sourceId = bounded(input.sourceId, 160);
  const idempotencyKey = validIdempotencyKey(input.idempotencyKey);
  if (!reason) {
    throw new CreditDomainError("invalid_credit_operation", "积分变更原因不能为空", 400);
  }

  const db = database();
  const now = Date.now() / 1000;
  const mutationToken = crypto.randomUUID();
  const results = await db.batch([
    creditAccountStatement(tenantId, userId, now),
    db.prepare(`UPDATE credit_accounts
      SET balance = balance + ?, version = version + 1,
        last_mutation_token = ?, updated_at = ?
      WHERE tenant_id = ? AND user_id = ?
        AND balance + ? BETWEEN 0 AND ?
        AND EXISTS (
          SELECT 1 FROM users AS actor
          WHERE actor.id = ? AND actor.tenant_id = ?
            AND (? = 'refund' OR COALESCE(actor.status, 'active') = 'active')
        )
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger
          WHERE tenant_id = ? AND idempotency_key = ?
        )`)
      .bind(
        amount,
        mutationToken,
        now,
        tenantId,
        userId,
        amount,
        MAX_CREDIT_BALANCE,
        actorUserId,
        tenantId,
        input.sourceType,
        tenantId,
        idempotencyKey,
      ),
    db.prepare(`INSERT OR IGNORE INTO credit_ledger(
        tenant_id, user_id, actor_user_id, amount, balance_before,
        balance_after, reason, note, source_type, source_id,
        idempotency_key, mutation_token, created_at
      ) SELECT ?, ?, ?, ?, balance - ?, balance, ?, NULLIF(?, ''), ?,
          NULLIF(?, ''), ?, ?, ?
        FROM credit_accounts
        WHERE tenant_id = ? AND user_id = ? AND last_mutation_token = ?`)
      .bind(
        tenantId,
        userId,
        actorUserId,
        amount,
        amount,
        reason,
        note,
        input.sourceType,
        sourceId,
        idempotencyKey,
        mutationToken,
        now,
        tenantId,
        userId,
        mutationToken,
      ),
  ]);

  const transaction = await db
    .prepare(`SELECT id, tenant_id, user_id, actor_user_id, amount,
        balance_before, balance_after, reason, note, source_type, source_id,
        idempotency_key, created_at
      FROM credit_ledger WHERE tenant_id = ? AND idempotency_key = ?`)
    .bind(tenantId, idempotencyKey)
    .first<CreditTransaction>();

  if (transaction) {
    if (
      transaction.user_id !== userId || transaction.actor_user_id !== actorUserId ||
      transaction.amount !== amount || transaction.reason !== reason ||
      transaction.source_type !== input.sourceType ||
      String(transaction.source_id || "") !== sourceId
    ) {
      throw new CreditDomainError(
        "idempotency_conflict",
        "该幂等键已用于另一笔积分业务",
        409,
      );
    }
    const account = await accountForUser(tenantId, userId);
    if (!account) {
      throw new CreditDomainError("credit_conflict", "积分账户状态异常", 409);
    }
    const applied = Number(results[1]?.meta.changes || 0) === 1 &&
      Number(results[2]?.meta.changes || 0) === 1;
    return { ...account, transaction, replayed: !applied };
  }

  const user = await db
    .prepare("SELECT id FROM users WHERE id = ? AND tenant_id = ?")
    .bind(userId, tenantId)
    .first<{ id: number }>();
  if (!user) throw new CreditDomainError("user_not_found", "用户不存在", 404);
  const account = await accountForUser(tenantId, userId);
  if (amount < 0 && Number(account?.balance || 0) + amount < 0) {
    throw new CreditDomainError("insufficient_credits", "积分余额不足", 409);
  }
  throw new CreditDomainError("credit_conflict", "积分余额正在变更，请重试", 409);
}

export async function getMyCredits(tenantId: number, userId: number): Promise<{
  balance: number;
  summary: { credited: number; debited: number; transaction_count: number };
  recent_transactions: CreditTransaction[];
  rules: CreditRule[];
}> {
  safePositiveId(tenantId, "工作区编号");
  safePositiveId(userId, "用户编号");
  const db = database();
  const now = Date.now() / 1000;
  await creditAccountStatement(tenantId, userId, now).run();
  const [account, summary, ledger, rules] = await Promise.all([
    accountForUser(tenantId, userId),
    db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS credited,
        COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS debited,
        COUNT(*) AS transaction_count
      FROM credit_ledger WHERE tenant_id = ? AND user_id = ?`)
      .bind(tenantId, userId)
      .first<{ credited: number; debited: number; transaction_count: number }>(),
    db.prepare(`SELECT id, tenant_id, user_id, actor_user_id, amount,
        balance_before, balance_after, reason, note, source_type, source_id,
        idempotency_key, created_at
      FROM credit_ledger WHERE tenant_id = ? AND user_id = ?
      ORDER BY id DESC LIMIT 10`)
      .bind(tenantId, userId)
      .all<CreditTransaction>(),
    listCreditRules(tenantId),
  ]);
  return {
    balance: Number(account?.balance || 0),
    summary: {
      credited: Number(summary?.credited || 0),
      debited: Number(summary?.debited || 0),
      transaction_count: Number(summary?.transaction_count || 0),
    },
    recent_transactions: ledger.results || [],
    rules: rules.items,
  };
}

export async function listUserCreditLedger(input: {
  tenantId: number;
  userId: number;
  limit: number;
  beforeId?: number;
}): Promise<{
  user: { id: number; email: string; name: string; status: string };
  balance: number;
  items: CreditTransaction[];
  next_cursor: string | null;
}> {
  const db = database();
  const user = await db
    .prepare(`SELECT id, email, COALESCE(name, '') AS name,
        COALESCE(status, 'active') AS status
      FROM users WHERE id = ? AND tenant_id = ?`)
    .bind(input.userId, input.tenantId)
    .first<{ id: number; email: string; name: string; status: string }>();
  if (!user) throw new CreditDomainError("user_not_found", "用户不存在", 404);
  await creditAccountStatement(input.tenantId, input.userId, Date.now() / 1000).run();
  const account = await accountForUser(input.tenantId, input.userId);
  const cursorClause = input.beforeId ? " AND id < ?" : "";
  const statement = db.prepare(`SELECT id, tenant_id, user_id, actor_user_id, amount,
      balance_before, balance_after, reason, note, source_type, source_id,
      idempotency_key, created_at
    FROM credit_ledger WHERE tenant_id = ? AND user_id = ?${cursorClause}
    ORDER BY id DESC LIMIT ?`);
  const result = input.beforeId
    ? await statement.bind(input.tenantId, input.userId, input.beforeId, input.limit + 1).all<CreditTransaction>()
    : await statement.bind(input.tenantId, input.userId, input.limit + 1).all<CreditTransaction>();
  const rows = result.results || [];
  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  return {
    user,
    balance: Number(account?.balance || 0),
    items,
    next_cursor: hasMore && items.length ? String(items.at(-1)?.id) : null,
  };
}

function escapedLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function managedUser(row: ManagedUserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    credits: {
      balance: Number(row.credit_balance || 0),
      version: Number(row.credit_version || 0),
    },
  };
}

export async function listManagedUsers(input: {
  tenantId: number;
  query?: string;
  status?: "active" | "disabled";
  limit: number;
  beforeId?: number;
}) {
  const clauses = ["u.tenant_id = ?"];
  const bindings: unknown[] = [input.tenantId];
  if (input.query) {
    clauses.push("(u.email LIKE ? ESCAPE '\\' OR COALESCE(u.name, '') LIKE ? ESCAPE '\\')");
    const pattern = escapedLike(input.query);
    bindings.push(pattern, pattern);
  }
  if (input.status) {
    clauses.push("COALESCE(u.status, 'active') = ?");
    bindings.push(input.status);
  }
  if (input.beforeId) {
    clauses.push("u.id < ?");
    bindings.push(input.beforeId);
  }
  bindings.push(input.limit + 1);
  const db = database();
  const [rows, summary] = await Promise.all([
    db.prepare(`SELECT u.id, u.email, COALESCE(u.name, '') AS name,
        COALESCE(u.role, 'member') AS role, COALESCE(u.status, 'active') AS status,
        u.created_at, COALESCE(a.balance, 0) AS credit_balance,
        COALESCE(a.version, 0) AS credit_version
      FROM users u LEFT JOIN credit_accounts a
        ON a.tenant_id = u.tenant_id AND a.user_id = u.id
      WHERE ${clauses.join(" AND ")}
      ORDER BY u.id DESC LIMIT ?`)
      .bind(...bindings)
      .all<ManagedUserRow>(),
    db.prepare(`SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN COALESCE(u.status, 'active') = 'active' THEN 1 ELSE 0 END), 0) AS active,
        COALESCE(SUM(CASE WHEN u.status = 'disabled' THEN 1 ELSE 0 END), 0) AS disabled,
        COALESCE(SUM(a.balance), 0) AS total_credits
      FROM users u LEFT JOIN credit_accounts a
        ON a.tenant_id = u.tenant_id AND a.user_id = u.id
      WHERE u.tenant_id = ?`)
      .bind(input.tenantId)
      .first<{ total: number; active: number; disabled: number; total_credits: number }>(),
  ]);
  const values = rows.results || [];
  const hasMore = values.length > input.limit;
  const selected = hasMore ? values.slice(0, input.limit) : values;
  return {
    items: selected.map(managedUser),
    summary: {
      total: Number(summary?.total || 0),
      active: Number(summary?.active || 0),
      disabled: Number(summary?.disabled || 0),
      total_credits: Number(summary?.total_credits || 0),
    },
    next_cursor: hasMore && selected.length ? String(selected.at(-1)?.id) : null,
  };
}

export async function getManagedUser(tenantId: number, userId: number) {
  const row = await database()
    .prepare(`SELECT u.id, u.email, COALESCE(u.name, '') AS name,
        COALESCE(u.role, 'member') AS role, COALESCE(u.status, 'active') AS status,
        u.created_at, COALESCE(a.balance, 0) AS credit_balance,
        COALESCE(a.version, 0) AS credit_version
      FROM users u LEFT JOIN credit_accounts a
        ON a.tenant_id = u.tenant_id AND a.user_id = u.id
      WHERE u.id = ? AND u.tenant_id = ?`)
    .bind(userId, tenantId)
    .first<ManagedUserRow>();
  return row ? managedUser(row) : null;
}

export async function createManagedUser(input: {
  tenantId: number;
  email: string;
  passwordHash: string;
  name: string;
  actorUserId: number;
  initialCredits: number;
}) {
  const initialCredits = safeAmount(input.initialCredits, true);
  const db = database();
  const now = Date.now() / 1000;
  const mutationToken = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO users(
      tenant_id, email, pw_hash, name, role, status, created_at
    ) VALUES(?, ?, ?, ?, 'member', 'active', ?)`)
      .bind(input.tenantId, input.email, input.passwordHash, input.name, now),
    db.prepare(`INSERT INTO credit_accounts(
        tenant_id, user_id, balance, version, created_at, updated_at
      ) SELECT ?, id, 0, 0, ?, ? FROM users
        WHERE tenant_id = ? AND email = ?`)
      .bind(input.tenantId, now, now, input.tenantId, input.email),
  ];
  if (initialCredits > 0) {
    const emailDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(input.email.toLowerCase()),
    );
    const emailFingerprint = Array.from(new Uint8Array(emailDigest), (byte) =>
      byte.toString(16).padStart(2, "0")).join("");
    const initialKey = validIdempotencyKey(`initial:${input.tenantId}:${emailFingerprint}`);
    statements.push(
      db.prepare(`UPDATE credit_accounts SET balance = ?, version = 1,
          last_mutation_token = ?, updated_at = ?
        WHERE tenant_id = ? AND user_id = (
          SELECT id FROM users WHERE tenant_id = ? AND email = ?
        ) AND balance = 0 AND version = 0`)
        .bind(initialCredits, mutationToken, now, input.tenantId, input.tenantId, input.email),
      db.prepare(`INSERT INTO credit_ledger(
          tenant_id, user_id, actor_user_id, amount, balance_before,
          balance_after, reason, source_type, source_id, idempotency_key,
          mutation_token, created_at
        ) SELECT a.tenant_id, a.user_id, ?, ?, 0, a.balance,
            '新用户初始积分', 'initial_grant', ?, ?, ?, ?
          FROM credit_accounts a
          WHERE a.tenant_id = ? AND a.last_mutation_token = ?
            AND a.user_id = (SELECT id FROM users WHERE tenant_id = ? AND email = ?)`)
        .bind(
          input.actorUserId,
          initialCredits,
          input.email,
          initialKey,
          mutationToken,
          now,
          input.tenantId,
          mutationToken,
          input.tenantId,
          input.email,
        ),
    );
  }
  await db.batch(statements);
  const user = await db
    .prepare("SELECT id FROM users WHERE tenant_id = ? AND email = ?")
    .bind(input.tenantId, input.email)
    .first<{ id: number }>();
  if (!user) throw new CreditDomainError("credit_conflict", "用户创建失败", 409);
  return getManagedUser(input.tenantId, user.id);
}

export async function setManagedUserStatus(input: {
  tenantId: number;
  userId: number;
  actorUserId: number;
  status: "active" | "disabled";
}) {
  if (input.userId === input.actorUserId && input.status === "disabled") {
    throw new CreditDomainError("invalid_credit_operation", "不能停用当前登录账号", 400);
  }
  const db = database();
  const statements = [
    db.prepare(`UPDATE users SET status = ?
      WHERE id = ? AND tenant_id = ?
        AND (? = 'active' OR role <> 'admin' OR EXISTS (
          SELECT 1 FROM users AS other
          WHERE other.tenant_id = ? AND other.id <> ? AND other.role = 'admin'
            AND COALESCE(other.status, 'active') = 'active'
        ))`)
      .bind(input.status, input.userId, input.tenantId, input.status,
        input.tenantId, input.userId),
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND tenant_id = ?
      AND ? = 'disabled' AND EXISTS (
        SELECT 1 FROM users WHERE id = ? AND tenant_id = ? AND status = 'disabled'
      )`)
      .bind(input.userId, input.tenantId, input.status, input.userId, input.tenantId),
  ];
  const results = await db.batch(statements);
  if (Number(results[0]?.meta.changes || 0) !== 1) {
    const user = await getManagedUser(input.tenantId, input.userId);
    if (!user) throw new CreditDomainError("user_not_found", "用户不存在", 404);
    if (user.role === "admin" && input.status === "disabled") {
      throw new CreditDomainError("invalid_credit_operation", "工作区必须保留至少一个启用的管理员", 409);
    }
    throw new CreditDomainError("credit_conflict", "用户状态正在变更，请重试", 409);
  }
  return getManagedUser(input.tenantId, input.userId);
}

async function ensureDefaultCreditRules(tenantId: number): Promise<void> {
  const now = Date.now() / 1000;
  await database().batch(DEFAULT_CREDIT_RULES.map((rule) => database()
    .prepare(`INSERT OR IGNORE INTO credit_rules(
      tenant_id, rule_key, label, cost, enabled, created_at, updated_at
    ) VALUES(?, ?, ?, 0, 0, ?, ?)`)
    .bind(tenantId, rule.key, rule.label, now, now)));
}

export type CreditRule = {
  key: CreditRuleKey;
  label: string;
  cost: number;
  enabled: boolean;
  updated_by: number | null;
  updated_at: number;
};

function creditRule(row: {
  rule_key: CreditRuleKey;
  label: string;
  cost: number;
  enabled: number;
  updated_by: number | null;
  updated_at: number;
}): CreditRule {
  return {
    key: row.rule_key,
    label: row.label,
    cost: Number(row.cost),
    enabled: row.enabled === 1,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

export async function listCreditRules(tenantId: number): Promise<{ items: CreditRule[] }> {
  await ensureDefaultCreditRules(tenantId);
  const rows = await database()
    .prepare(`SELECT rule_key, label, cost, enabled, updated_by, updated_at
      FROM credit_rules WHERE tenant_id = ? ORDER BY id ASC`)
    .bind(tenantId)
    .all<Parameters<typeof creditRule>[0]>();
  return { items: (rows.results || []).map(creditRule) };
}

export async function updateCreditRule(input: {
  tenantId: number;
  actorUserId: number;
  ruleKey: string;
  cost?: number;
  enabled?: boolean;
}): Promise<CreditRule> {
  if (!DEFAULT_CREDIT_RULES.some((rule) => rule.key === input.ruleKey)) {
    throw new CreditDomainError("rule_not_found", "积分规则不存在", 404);
  }
  if (input.cost !== undefined && (!Number.isSafeInteger(input.cost) || input.cost < 0 ||
    input.cost > MAX_CREDIT_ADJUSTMENT)) {
    throw new CreditDomainError("invalid_credit_operation", "规则积分必须是有效的非负整数", 400);
  }
  if (input.cost === undefined && input.enabled === undefined) {
    throw new CreditDomainError("invalid_credit_operation", "至少提交一个规则变更字段", 400);
  }
  await ensureDefaultCreditRules(input.tenantId);
  const now = Date.now() / 1000;
  await database()
    .prepare(`UPDATE credit_rules SET cost = COALESCE(?, cost),
        enabled = COALESCE(?, enabled), updated_by = ?, updated_at = ?
      WHERE tenant_id = ? AND rule_key = ?`)
    .bind(
      input.cost ?? null,
      input.enabled === undefined ? null : input.enabled ? 1 : 0,
      input.actorUserId,
      now,
      input.tenantId,
      input.ruleKey,
    )
    .run();
  return quoteCreditRule(input.tenantId, input.ruleKey);
}

export async function quoteCreditRule(tenantId: number, ruleKey: string): Promise<CreditRule> {
  await ensureDefaultCreditRules(tenantId);
  const row = await database()
    .prepare(`SELECT rule_key, label, cost, enabled, updated_by, updated_at
      FROM credit_rules WHERE tenant_id = ? AND rule_key = ?`)
    .bind(tenantId, ruleKey)
    .first<Parameters<typeof creditRule>[0]>();
  if (!row) throw new CreditDomainError("rule_not_found", "积分规则不存在", 404);
  return creditRule(row);
}

export async function debitCreditsForRule(input: {
  tenantId: number;
  userId: number;
  actorUserId?: number;
  ruleKey: CreditRuleKey;
  businessId: string;
}): Promise<{
  charged: boolean;
  rule: CreditRule;
  balance: number;
  transaction: CreditTransaction | null;
  replayed: boolean;
}> {
  const businessId = validIdempotencyKey(input.businessId);
  const idempotencyKey = validIdempotencyKey(`rule:${input.ruleKey}:${businessId}`);
  const rule = await quoteCreditRule(input.tenantId, input.ruleKey);
  const replayDebit = async () => {
    const transaction = await creditTransactionByKey(input.tenantId, idempotencyKey);
    if (!transaction) return null;
    if (transaction.user_id !== input.userId ||
      transaction.actor_user_id !== (input.actorUserId || input.userId) ||
      transaction.source_type !== "rule_debit" || transaction.source_id !== businessId ||
      transaction.amount >= 0) {
      throw new CreditDomainError("idempotency_conflict", "该幂等键已用于另一笔积分业务", 409);
    }
    if (await creditTransactionByKey(input.tenantId, `refund:${transaction.id}`)) {
      throw new CreditDomainError("operation_refunded", "该业务已退回积分，请重新发起任务", 409);
    }
    const account = await accountForUser(input.tenantId, input.userId);
    if (!account) throw new CreditDomainError("credit_conflict", "积分账户状态异常", 409);
    return {
      charged: true,
      rule: { ...rule, label: transaction.reason, cost: -transaction.amount, enabled: true },
      balance: account.balance,
      transaction,
      replayed: true,
    };
  };
  // A retry settles the original business operation even if its pricing rule
  // was changed or disabled after the first delivery.
  const replayed = await replayDebit();
  if (replayed) return replayed;
  if (!rule.enabled || rule.cost === 0) {
    const current = await getMyCredits(input.tenantId, input.userId);
    return { charged: false, rule, balance: current.balance, transaction: null, replayed: false };
  }
  try {
    const result = await applyCreditAdjustment({
      tenantId: input.tenantId,
      userId: input.userId,
      actorUserId: input.actorUserId || input.userId,
      amount: -rule.cost,
      reason: rule.label,
      sourceType: "rule_debit",
      sourceId: businessId,
      idempotencyKey,
    });
    return { charged: true, rule, ...result };
  } catch (error) {
    if (error instanceof CreditDomainError && error.code === "idempotency_conflict") {
      const concurrentReplay = await replayDebit();
      if (concurrentReplay) return concurrentReplay;
    }
    throw error;
  }
}

async function creditTransactionByKey(tenantId: number, idempotencyKey: string): Promise<CreditTransaction | null> {
  return database()
    .prepare(`SELECT id, tenant_id, user_id, actor_user_id, amount,
        balance_before, balance_after, reason, note, source_type, source_id,
        idempotency_key, created_at
      FROM credit_ledger WHERE tenant_id = ? AND idempotency_key = ?`)
    .bind(tenantId, idempotencyKey)
    .first<CreditTransaction>();
}

export async function refundCreditTransaction(input: {
  tenantId: number;
  actorUserId: number;
  transaction: CreditTransaction;
  reason: string;
}): Promise<{ balance: number; version: number; transaction: CreditTransaction; replayed: boolean }> {
  if (input.transaction.tenant_id !== input.tenantId || input.transaction.amount >= 0) {
    throw new CreditDomainError("invalid_credit_operation", "仅可补偿本工作区的积分扣减流水", 400);
  }
  const original = await creditTransactionByKey(input.tenantId, input.transaction.idempotency_key);
  if (!original || original.id !== input.transaction.id || original.amount !== input.transaction.amount ||
    original.user_id !== input.transaction.user_id || original.amount >= 0) {
    throw new CreditDomainError("invalid_credit_operation", "积分扣减流水不存在或不匹配", 400);
  }
  const idempotencyKey = `refund:${original.id}`;
  const replayRefund = async () => {
    const transaction = await creditTransactionByKey(input.tenantId, idempotencyKey);
    if (!transaction) return null;
    if (transaction.user_id !== original.user_id || transaction.amount !== -original.amount ||
      transaction.source_type !== "refund" || transaction.source_id !== String(original.id)) {
      throw new CreditDomainError("idempotency_conflict", "补偿流水与原扣减不匹配", 409);
    }
    const account = await accountForUser(input.tenantId, original.user_id);
    if (!account) throw new CreditDomainError("credit_conflict", "积分账户状态异常", 409);
    return { ...account, transaction, replayed: true };
  };
  const replayed = await replayRefund();
  if (replayed) return replayed;
  try {
    return await applyCreditAdjustment({
      tenantId: input.tenantId,
      userId: original.user_id,
      actorUserId: input.actorUserId,
      amount: -original.amount,
      reason: input.reason,
      sourceType: "refund",
      sourceId: String(original.id),
      idempotencyKey,
    });
  } catch (error) {
    if (error instanceof CreditDomainError && error.code === "idempotency_conflict") {
      const concurrentReplay = await replayRefund();
      if (concurrentReplay) return concurrentReplay;
    }
    throw error;
  }
}

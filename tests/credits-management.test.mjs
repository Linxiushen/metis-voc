import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const TEST_ENV_KEY = "__METIS_CREDIT_TEST_ENV__";
let server;
let credits;
let sqlite;

class SQLiteD1Statement {
  constructor(owner, sql) {
    this.owner = owner;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async run() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }

  async first() {
    return this.owner.sqlite.prepare(this.sql).get(...this.args) || null;
  }

  async all() {
    return { results: this.owner.sqlite.prepare(this.sql).all(...this.args) };
  }
}

class SQLiteD1 {
  constructor(database) {
    this.sqlite = database;
    this.tail = Promise.resolve();
  }

  prepare(sql) {
    return new SQLiteD1Statement(this, sql);
  }

  batch(statements) {
    const operation = async () => {
      this.sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        this.sqlite.exec("ROLLBACK");
        throw error;
      }
    };
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      email TEXT NOT NULL UNIQUE,
      pw_hash TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      created_at REAL NOT NULL
    );
    CREATE TABLE credit_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0 AND balance <= 9000000000000),
      version INTEGER NOT NULL DEFAULT 0,
      last_mutation_token TEXT,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL,
      UNIQUE(tenant_id, user_id)
    );
    CREATE TABLE credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      actor_user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL CHECK(amount <> 0),
      balance_before INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      note TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT,
      idempotency_key TEXT NOT NULL,
      mutation_token TEXT NOT NULL UNIQUE,
      created_at REAL NOT NULL,
      CHECK(balance_after = balance_before + amount),
      UNIQUE(tenant_id, idempotency_key)
    );
    CREATE TABLE credit_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      rule_key TEXT NOT NULL,
      label TEXT NOT NULL,
      cost INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL,
      UNIQUE(tenant_id, rule_key)
    );
    CREATE TRIGGER credit_ledger_reject_update BEFORE UPDATE ON credit_ledger
      BEGIN SELECT RAISE(ABORT, 'credit ledger is append-only'); END;
    CREATE TRIGGER credit_ledger_reject_delete BEFORE DELETE ON credit_ledger
      BEGIN SELECT RAISE(ABORT, 'credit ledger is append-only'); END;
    INSERT INTO users(id, tenant_id, email, pw_hash, name, role, status, created_at)
      VALUES
        (1, 42, 'admin@example.com', 'hash', 'Admin', 'admin', 'active', 1),
        (2, 42, 'member@example.com', 'hash', 'Member', 'member', 'active', 1),
        (3, 43, 'other@example.com', 'hash', 'Other', 'member', 'active', 1);
  `);
  return database;
}

before(async () => {
  globalThis[TEST_ENV_KEY] = {};
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
    plugins: [{
      name: "metis-credit-test-cloudflare-env",
      enforce: "pre",
      resolveId(id) {
        return id === "cloudflare:workers" ? "\0metis-credit-test-cloudflare-workers" : null;
      },
      load(id) {
        if (id !== "\0metis-credit-test-cloudflare-workers") return null;
        return `export const env = globalThis[${JSON.stringify(TEST_ENV_KEY)}];`;
      },
    }],
  });
  credits = await server.ssrLoadModule("/lib/credits.ts");
});

beforeEach(() => {
  sqlite?.close();
  sqlite = createDatabase();
  globalThis[TEST_ENV_KEY].DB = new SQLiteD1(sqlite);
});

after(async () => {
  sqlite?.close();
  await server?.close();
  delete globalThis[TEST_ENV_KEY];
});

test("credit rules default to disabled zero-cost and can be configured per tenant", async () => {
  const defaults = await credits.listCreditRules(42);
  assert.deepEqual(defaults.items.map(({ key, cost, enabled }) => ({ key, cost, enabled })), [
    { key: "research_generation", cost: 0, enabled: false },
    { key: "scene_suite_generation", cost: 0, enabled: false },
  ]);

  const updated = await credits.updateCreditRule({
    tenantId: 42,
    actorUserId: 1,
    ruleKey: "research_generation",
    cost: 3,
    enabled: true,
  });
  assert.equal(updated.cost, 3);
  assert.equal(updated.enabled, true);
  assert.equal((await credits.quoteCreditRule(43, "research_generation")).enabled, false);
});

test("managed-user creation accepts email addresses and creates the initial credit account atomically", async () => {
  const zeroCreditUser = await credits.createManagedUser({
    tenantId: 42,
    email: "member@example.test",
    passwordHash: "hash",
    name: "ct03",
    actorUserId: 1,
    initialCredits: 0,
  });
  assert.equal(zeroCreditUser.email, "member@example.test");
  assert.equal(zeroCreditUser.credits.balance, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger").get().count, 0);

  const creditedUser = await credits.createManagedUser({
    tenantId: 42,
    email: "buyer@example.test",
    passwordHash: "hash",
    name: "Buyer",
    actorUserId: 1,
    initialCredits: 5,
  });
  assert.equal(creditedUser.credits.balance, 5);
  const transaction = sqlite.prepare(
    "SELECT idempotency_key FROM credit_ledger WHERE user_id = ?",
  ).get(creditedUser.id);
  assert.match(transaction.idempotency_key, /^initial:42:[a-f0-9]{64}$/);
});

test("adjustments are atomic, idempotent and reject an idempotency-key payload change", async () => {
  const input = {
    tenantId: 42,
    userId: 2,
    actorUserId: 1,
    amount: 10,
    reason: "测试充值",
    sourceType: "manual_adjustment",
    sourceId: "member-2",
    idempotencyKey: "manual:test-grant-001",
  };
  const granted = await credits.applyCreditAdjustment(input);
  const replayed = await credits.applyCreditAdjustment(input);
  assert.equal(granted.balance, 10);
  assert.equal(granted.replayed, false);
  assert.equal(replayed.balance, 10);
  assert.equal(replayed.replayed, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger").get().count, 1);

  await assert.rejects(
    credits.applyCreditAdjustment({ ...input, amount: 9 }),
    (error) => error.code === "idempotency_conflict" && error.status === 409,
  );
});

test("concurrent debits cannot create a negative balance and tenant boundaries fail closed", async () => {
  await credits.applyCreditAdjustment({
    tenantId: 42,
    userId: 2,
    actorUserId: 1,
    amount: 3,
    reason: "测试充值",
    sourceType: "manual_adjustment",
    sourceId: "member-2",
    idempotencyKey: "manual:concurrency-grant",
  });
  const debits = await Promise.allSettled([1, 2].map((sequence) =>
    credits.applyCreditAdjustment({
      tenantId: 42,
      userId: 2,
      actorUserId: 1,
      amount: -2,
      reason: "并发扣减",
      sourceType: "manual_adjustment",
      sourceId: `debit-${sequence}`,
      idempotencyKey: `manual:concurrent-debit-${sequence}`,
    })
  ));
  assert.equal(debits.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(debits.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await credits.getMyCredits(42, 2)).balance, 1);
  assert.equal(sqlite.prepare("SELECT MIN(balance_after) AS minimum FROM credit_ledger").get().minimum, 1);

  await assert.rejects(
    credits.applyCreditAdjustment({
      tenantId: 42,
      userId: 3,
      actorUserId: 1,
      amount: 1,
      reason: "越租户调账",
      sourceType: "manual_adjustment",
      sourceId: "other",
      idempotencyKey: "manual:cross-tenant",
    }),
    (error) => error.code === "user_not_found" && error.status === 404,
  );
});

test("rule debit is idempotent and the ledger rejects updates and deletes", async () => {
  await credits.applyCreditAdjustment({
    tenantId: 42,
    userId: 2,
    actorUserId: 1,
    amount: 5,
    reason: "测试充值",
    sourceType: "manual_adjustment",
    sourceId: "member-2",
    idempotencyKey: "manual:rule-grant-001",
  });
  await credits.updateCreditRule({
    tenantId: 42,
    actorUserId: 1,
    ruleKey: "scene_suite_generation",
    cost: 2,
    enabled: true,
  });
  const [first, replay] = await Promise.all([1, 2].map(() => credits.debitCreditsForRule({
    tenantId: 42,
    userId: 2,
    ruleKey: "scene_suite_generation",
    businessId: "scene-start:101",
  })));
  assert.equal(first.balance, 3);
  assert.equal(replay.balance, 3);
  assert.equal([first, replay].filter((result) => result.replayed).length, 1);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM credit_ledger WHERE source_type = 'rule_debit'",
  ).get().count, 1);
  sqlite.exec("UPDATE users SET status = 'disabled' WHERE id = 1");
  const refunded = await credits.refundCreditTransaction({
    tenantId: 42,
    actorUserId: 1,
    transaction: first.transaction,
    reason: "受理失败补偿",
  });
  assert.equal(refunded.balance, 5, "停用发生在扣费后也不能阻断自动补偿");
  assert.throws(() => sqlite.exec("UPDATE credit_ledger SET reason = 'tampered' WHERE id = 1"));
  assert.throws(() => sqlite.exec("DELETE FROM credit_ledger WHERE id = 1"));
});

test("admin user, password, credits and rule routes enforce the tenant-scoped contract", async () => {
  const [routeSource, authSource, databaseSource] = await Promise.all([
    readFile(new URL("../app/api/[[...path]]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
  ]);
  for (const contract of [
    /path\[0\] === "credits" && path\[1\] === "me"/,
    /path\[0\] === "admin" && path\[1\] === "users"/,
    /path\[3\] === "password"[\s\S]{0,120}method === "PUT"/,
    /path\[3\] === "credits"[\s\S]{0,120}method === "POST"/,
    /path\[3\] === "credit-ledger"[\s\S]{0,120}method === "GET"/,
    /path\[1\] === "credit-rules"[\s\S]{0,180}method === "PATCH"/,
  ]) assert.match(routeSource, contract);
  assert.match(routeSource, /UPDATE users SET pw_hash = \?[\s\S]+id = \? AND tenant_id = \? AND role = 'member'/);
  assert.match(routeSource, /DELETE FROM sessions WHERE user_id = \? AND tenant_id = \?/);
  assert.match(routeSource, /businessId: `scene-start:\$\{runId\}`/);
  assert.match(routeSource, /businessId: `scene-regen:\$\{runId\}:\$\{current\?\.id \|\| 0\}`/);
  assert.match(authSource, /COALESCE\(u\.status, 'active'\) = 'active'/);
  assert.match(databaseSource, /metis-schema-2026-08-06\.10-credit-management/);
  assert.match(databaseSource, /credit_ledger_reject_update/);
  assert.match(databaseSource, /credit_ledger_reject_delete/);
});

async function paidResearch() {
  await credits.applyCreditAdjustment({
    tenantId: 42, userId: 2, actorUserId: 1, amount: 20,
    reason: "Test funding", sourceType: "manual_adjustment", idempotencyKey: "manual:retry-funding",
  });
  await credits.updateCreditRule({
    tenantId: 42, actorUserId: 1, ruleKey: "research_generation", cost: 3, enabled: true,
  });
  const input = { tenantId: 42, userId: 2, ruleKey: "research_generation", businessId: "research:51:1800000000000" };
  return { input, charge: await credits.debitCreditsForRule(input) };
}

test("a charged research retry preserves its original price after rule changes or disablement", async () => {
  const { input } = await paidResearch();
  await credits.updateCreditRule({ tenantId: 42, actorUserId: 1, ruleKey: "research_generation", cost: 9, enabled: true });
  const repriced = await credits.debitCreditsForRule(input);
  assert.equal(repriced.balance, 17);
  assert.equal(repriced.rule.cost, 3);
  assert.equal(repriced.replayed, true);
  await credits.updateCreditRule({ tenantId: 42, actorUserId: 1, ruleKey: "research_generation", cost: 0, enabled: false });
  const disabled = await credits.debitCreditsForRule(input);
  assert.equal(disabled.charged, true, "an existing debit must still be available for failure compensation");
  assert.equal(disabled.transaction.amount, -3);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger WHERE source_type = 'rule_debit'").get().count, 1);
});

test("a refunded task cannot replay its old debit and finish without paying", async () => {
  const { input, charge } = await paidResearch();
  await credits.refundCreditTransaction({ tenantId: 42, actorUserId: 2, transaction: charge.transaction, reason: "Task failed" });
  await assert.rejects(credits.debitCreditsForRule(input), (error) => error.code === "operation_refunded");
  assert.equal((await credits.getMyCredits(42, 2)).balance, 20);
});

test("refund retries tolerate a changed reason or operator and add exactly one compensation", async () => {
  const { charge } = await paidResearch();
  const results = await Promise.all([
    credits.refundCreditTransaction({ tenantId: 42, actorUserId: 2, transaction: charge.transaction, reason: "Initial failure" }),
    credits.refundCreditTransaction({ tenantId: 42, actorUserId: 1, transaction: charge.transaction, reason: "Retry exhausted" }),
  ]);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.equal((await credits.getMyCredits(42, 2)).balance, 20);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger WHERE source_type = 'refund'").get().count, 1);
});

test("refunds require the actual stored debit, not a fabricated caller amount", async () => {
  const { charge } = await paidResearch();
  await assert.rejects(credits.refundCreditTransaction({
    tenantId: 42, actorUserId: 1, transaction: { ...charge.transaction, amount: -10 }, reason: "Invalid refund",
  }), (error) => error.code === "invalid_credit_operation");
  assert.equal((await credits.getMyCredits(42, 2)).balance, 17);
});

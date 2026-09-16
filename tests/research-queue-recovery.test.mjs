import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { SQLiteD1 } from "./helpers/sqlite-d1.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const environment = "__METIS_QUEUE_RECOVERY_TEST_ENV__";
const message = { runId: 51, tenantId: 7, claimedAt: 1_800_000_000 };
let server;
let db;
let queue;
let credits;
let revision = 0;
const normalized = (sql) => sql.replace(/\s+/g, " ").trim();

before(async () => {
  globalThis[environment] = { PAID_PROVIDER_CALLS_ENABLED: "false" };
  server = await createServer({
    root, configFile: false, appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
    plugins: [{
      name: "queue-recovery-env",
      resolveId: (id) => id === "cloudflare:workers" ? "\0queue-recovery-env" : null,
      load: (id) => id === "\0queue-recovery-env"
        ? `export const env = globalThis[${JSON.stringify(environment)}];` : null,
    }],
  });
  queue = await server.ssrLoadModule("/lib/research-queue.ts");
  credits = await server.ssrLoadModule("/lib/credits.ts");
});

beforeEach(async () => {
  db?.close();
  db = new SQLiteD1();
  globalThis[environment].DB = db;
  const database = await server.ssrLoadModule(`/lib/database.ts?queue-recovery=${++revision}`);
  await database.ensureSchema();
  db.sqlite.exec(`
    INSERT INTO tenants(id, name, plan, created_at) VALUES(7, 'Test tenant', 'trial', 1);
    INSERT INTO users(id, tenant_id, email, pw_hash, role, created_at)
      VALUES(11, 7, 'user@example.test', 'test-only', 'admin', 1);
    INSERT INTO runs(id, tenant_id, user_id, title, status, input_mode, input_payload,
      marketplace, research_plan, created_at, updated_at)
      VALUES(51, 7, 11, 'Recovery test', 'queued', 'category_keyword', 'desk lamp', 'US',
        '{"category_scope":"desk lamp"}', 1800000000, 1800000000);
  `);
  await credits.applyCreditAdjustment({
    tenantId: 7, userId: 11, actorUserId: 11, amount: 20,
    reason: "Test funding", sourceType: "manual_adjustment", idempotencyKey: "manual:recovery-funding",
  });
  await credits.updateCreditRule({ tenantId: 7, actorUserId: 11, ruleKey: "research_generation", cost: 3, enabled: true });
});

after(async () => {
  db?.close();
  await server?.close();
  delete globalThis[environment];
});

function row() { return db.sqlite.prepare("SELECT * FROM runs WHERE id = 51").get(); }
function balance() { return db.sqlite.prepare("SELECT balance FROM credit_accounts WHERE user_id = 11").get().balance; }
function failProvider() {
  db.sqlite.prepare("UPDATE runs SET research_plan = ? WHERE id = 51")
    .run(JSON.stringify({ category_scope: "desk lamp", research_brief: { sources: { keepamore: true } } }));
}

test("a completed job redelivery does not rerun or charge twice", async () => {
  assert.equal((await queue.executeResearchJob(message)).outcome, "completed");
  assert.equal((await queue.executeResearchJob(message)).outcome, "stale");
  assert.equal(balance(), 17);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger WHERE source_type = 'rule_debit'").get().count, 1);
});

test("a lease renewed after the initial read cannot be stolen by a recovery worker", async () => {
  db.sqlite.prepare("UPDATE runs SET status = 'executing', execution_token = 'original-owner', execution_lease_until = ? WHERE id = 51")
    .run(Date.now() / 1000 - 1);
  db.beforeStatement = (sql) => {
    if (!/UPDATE runs SET execution_token = \?/i.test(normalized(sql))) return;
    db.beforeStatement = null;
    db.sqlite.prepare("UPDATE runs SET execution_lease_until = ? WHERE id = 51").run(Date.now() / 1000 + 600);
  };
  assert.equal((await queue.executeResearchJob(message)).outcome, "stale");
  assert.equal(row().execution_token, "original-owner");
  assert.equal(balance(), 20);
});

test("a failed compensation resumes settlement without reexecuting provider work", async () => {
  failProvider();
  db.beforeStatement = (sql, args) => {
    if (!/INSERT OR IGNORE INTO credit_ledger/i.test(sql) || !args.includes("refund")) return;
    db.beforeStatement = null;
    throw new Error("injected refund write outage");
  };
  await assert.rejects(queue.executeResearchJob(message), /injected refund write outage/);
  assert.equal(row().status, "executing");
  assert.ok(row().failed_at > 0);
  assert.equal(balance(), 17);
  // If the second delivery ran the normal report path it would now succeed.
  db.sqlite.exec("UPDATE runs SET research_plan = '{}' WHERE id = 51");
  assert.equal((await queue.executeResearchJob(message, 2)).outcome, "failed");
  assert.equal(row().report, null);
  assert.equal(balance(), 20);
});

test("a crash after refund cannot turn the retried task into a free successful run", async () => {
  failProvider();
  db.beforeStatement = (sql) => {
    if (!/UPDATE runs SET status = 'failed'/i.test(normalized(sql))) return;
    db.beforeStatement = null;
    throw new Error("injected terminal status outage");
  };
  await assert.rejects(queue.executeResearchJob(message), /injected terminal status outage/);
  assert.equal(balance(), 20);
  db.sqlite.exec("UPDATE runs SET execution_lease_until = 1, research_plan = '{}' WHERE id = 51");
  assert.equal((await queue.executeResearchJob(message, 2)).outcome, "failed");
  assert.equal(row().report, null);
  assert.equal(balance(), 20);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger WHERE source_type = 'refund'").get().count, 1);
});

test("an old worker that loses its fence cannot refund the active execution", async () => {
  failProvider();
  db.beforeStatement = (sql) => {
    if (!/UPDATE runs SET error_message = \?, failed_at = \?, execution_lease_until = \?/i.test(normalized(sql))) return;
    db.beforeStatement = null;
    db.sqlite.exec("UPDATE runs SET execution_token = 'new-owner' WHERE id = 51");
  };
  assert.equal((await queue.executeResearchJob(message)).outcome, "stale");
  assert.equal(row().execution_token, "new-owner");
  assert.equal(row().failed_at, null);
  assert.equal(balance(), 17);
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { SQLiteD1 } from "./helpers/sqlite-d1.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const environment = "__METIS_BOOTSTRAP_TEST_ENV__";
const validHash = `pbkdf2$100000$${"a".repeat(32)}$${"b".repeat(64)}`;
let server;
let db;
let databaseModule;
let revision = 0;

async function reload() {
  databaseModule = await server.ssrLoadModule(`/lib/database.ts?bootstrap=${++revision}`);
}

before(async () => {
  globalThis[environment] = {};
  server = await createServer({
    root, configFile: false, appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
    plugins: [{
      name: "bootstrap-test-env",
      resolveId: (id) => id === "cloudflare:workers" ? "\0bootstrap-env" : null,
      load: (id) => id === "\0bootstrap-env"
        ? `export const env = globalThis[${JSON.stringify(environment)}];` : null,
    }],
  });
});

beforeEach(async () => {
  db?.close();
  db = new SQLiteD1();
  for (const key of Object.keys(globalThis[environment])) delete globalThis[environment][key];
  globalThis[environment].DB = db;
  await reload();
});

after(async () => {
  db?.close();
  await server?.close();
  delete globalThis[environment];
});

function bootstrapConfig(hash = validHash) {
  Object.assign(globalThis[environment], {
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.test",
    BOOTSTRAP_ADMIN_PASSWORD_HASH: hash,
  });
}

test("an empty database initializes without users, historical reports or default credentials", async () => {
  await databaseModule.ensureSchema();
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM runs").get().count, 0);
  for (const table of ["credit_accounts", "credit_ledger", "credit_rules", "rate_limit_events"]) {
    assert.ok(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  }
  bootstrapConfig();
  await reload();
  await databaseModule.ensureSchema();
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM runs").get().count, 0);
});

test("concurrent bootstrap is atomic, idempotent and never reassigns existing accounts", async () => {
  await databaseModule.ensureSchema();
  bootstrapConfig();
  await Promise.all(Array.from({ length: 8 }, () => databaseModule.ensureAdminAccount()));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tenants").get().count, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
  db.sqlite.exec("UPDATE users SET role = 'member', pw_hash = 'user-managed-hash'");
  globalThis[environment].BOOTSTRAP_ADMIN_EMAIL = "new-admin@example.test";
  await databaseModule.ensureAdminAccount();
  const user = db.sqlite.prepare("SELECT role, pw_hash FROM users").get();
  assert.equal(user.role, "member");
  assert.equal(user.pw_hash, "user-managed-hash");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tenants").get().count, 1);
  await reload();
  db.sqlite.exec("DELETE FROM system_migrations");
  await databaseModule.ensureSchema();
  assert.equal(db.sqlite.prepare("SELECT role FROM users").get().role, "member", "migration must not promote old members");
});

test("a failed bootstrap user insert rolls back its new tenant and can be retried", async () => {
  await databaseModule.ensureSchema();
  bootstrapConfig();
  db.sqlite.exec("CREATE TRIGGER fail_bootstrap BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
  await assert.rejects(databaseModule.ensureAdminAccount(), /injected failure/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tenants").get().count, 0);
  db.sqlite.exec("DROP TRIGGER fail_bootstrap");
  await databaseModule.ensureAdminAccount();
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
});

test("bootstrap accepts only password hashes supported by login verification", async () => {
  await databaseModule.ensureSchema();
  const invalid = [
    validHash.replace("100000", "49999"),
    validHash.replace("100000", "100001"),
    validHash.replace("100000", "0"),
    validHash.replace("a".repeat(32), "a".repeat(34)),
    validHash.slice(0, -1),
  ];
  for (const hash of invalid) {
    bootstrapConfig(hash);
    await assert.rejects(databaseModule.ensureAdminAccount(), /configuration is invalid/);
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM tenants").get().count, 0);
  bootstrapConfig(validHash.replace("100000", "50000"));
  await databaseModule.ensureAdminAccount();
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
});

test("committed Drizzle migrations are credential-free and upgrade through runtime initialization", async () => {
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) db.sqlite.exec(await readFile(new URL(name, directory), "utf8"));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  await databaseModule.ensureSchema();
  const runColumns = db.sqlite.prepare("PRAGMA table_info(runs)").all().map((row) => row.name);
  for (const name of ["execution_token", "execution_lease_until", "evidence_mode", "decision_readiness"]) {
    assert.ok(runColumns.includes(name), name);
  }
  bootstrapConfig();
  await databaseModule.ensureAdminAccount();
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 1);
});

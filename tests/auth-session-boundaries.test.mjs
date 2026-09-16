import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const DB_KEY = "__metisAuthBoundaryDatabase";
let server;
let sqlite;
let auth;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: [{
      name: "auth-boundary-database",
      enforce: "pre",
      resolveId(id, importer) {
        if (id === "./database" && importer?.replaceAll("\\", "/").endsWith("/lib/auth.ts")) {
          return "\0auth-boundary-database";
        }
        return null;
      },
      load(id) {
        if (id === "\0auth-boundary-database") {
          return `export const database = () => globalThis[${JSON.stringify(DB_KEY)}];`;
        }
        return null;
      },
    }],
  });
  auth = await server.ssrLoadModule("/lib/auth.ts");
});

beforeEach(() => {
  sqlite?.close();
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE tenants (id INTEGER PRIMARY KEY, plan TEXT);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, tenant_id INTEGER, email TEXT, name TEXT, role TEXT, status TEXT
    );
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER, tenant_id INTEGER, expires_at REAL);
    INSERT INTO tenants VALUES (1, 'pro'), (2, 'trial');
    INSERT INTO users VALUES (10, 1, 'admin@example.test', 'Admin', 'admin', 'active');
  `);
  globalThis[DB_KEY] = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async run() { return sqlite.prepare(sql).run(...args); },
      };
    },
  };
});

after(async () => {
  await server?.close();
  sqlite?.close();
  delete globalThis[DB_KEY];
});

test("a persisted session digest cannot be replayed as a bearer credential", async () => {
  const token = await auth.createSession(10, 1);
  const stored = sqlite.prepare("SELECT token FROM sessions").get().token;
  assert.equal(stored, createHash("sha256").update(token).digest("hex"));
  assert.notEqual(stored, token);
  assert.equal((await auth.userFromToken(token)).id, 10);
  assert.equal(await auth.currentUser(new Request("https://app.example.test/api/me", {
    headers: { authorization: `Bearer ${stored}` },
  })), null);
});

test("an old session cannot follow its user into a different tenant", async () => {
  const token = await auth.createSession(10, 1);
  sqlite.prepare("UPDATE users SET tenant_id = 2 WHERE id = 10").run();
  assert.equal(await auth.userFromToken(token), null);
});

test("expired sessions and disabled accounts cannot authenticate", async () => {
  const token = await auth.createSession(10, 1);
  sqlite.prepare("UPDATE users SET status = 'disabled' WHERE id = 10").run();
  assert.equal(await auth.userFromToken(token), null);
  sqlite.prepare("UPDATE users SET status = 'active' WHERE id = 10").run();
  sqlite.prepare("UPDATE sessions SET expires_at = 1").run();
  assert.equal(await auth.userFromToken(token), null);
});

test("logout uses the original bearer only, never a supplied database digest", async () => {
  const token = await auth.createSession(10, 1);
  const stored = sqlite.prepare("SELECT token FROM sessions").get().token;
  const request = (value) => new Request("https://app.example.test/api/auth/logout", {
    method: "POST", headers: { authorization: `Bearer ${value}` },
  });
  await auth.revokeSession(request(stored));
  assert.equal((await auth.userFromToken(token)).id, 10);
  await auth.revokeSession(request(token));
  assert.equal(await auth.userFromToken(token), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setupLocal } from "../scripts/setup-local.mjs";
import { parseJsonConfig, validateDeploymentConfig } from "../scripts/check-deploy.mjs";
import { smokeConfiguration } from "../scripts/smoke-local.mjs";

async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), "metis-setup-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

function parseVars(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter((line) => line && !line.startsWith("#"))
    .map((line) => { const split = line.indexOf("="); return [line.slice(0, split), JSON.parse(line.slice(split + 1))]; }));
}

test("local setup generates login-compatible random credentials and preserves them on rerun", async (t) => {
  const root = await temporary(t);
  const first = await setupLocal(root);
  const envBefore = await readFile(first.envFile, "utf8");
  const credentialsBefore = await readFile(first.credentialsFile, "utf8");
  const vars = parseVars(envBefore);
  const credentials = JSON.parse(credentialsBefore);
  assert.equal(vars.PAID_PROVIDER_CALLS_ENABLED, "false");
  assert.equal(vars.ENABLE_EXAMPLE_REPORTS, "false");
  assert.equal(Buffer.from(vars.SETTINGS_ENCRYPTION_KEY, "base64url").length, 32);
  assert.ok(credentials.password.length >= 32);
  const [, iterations, salt, digest] = vars.BOOTSTRAP_ADMIN_PASSWORD_HASH.split("$");
  assert.equal(Number(iterations), 100000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(credentials.password), "PBKDF2", false, ["deriveBits"]);
  const verified = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(salt, "hex"), iterations: Number(iterations) }, key, 256);
  assert.equal(Buffer.from(verified).toString("hex"), digest, "must match the Worker's Web Crypto login derivation");
  const second = await setupLocal(root, "other@example.test");
  assert.equal(second.created, false);
  assert.equal(await readFile(first.envFile, "utf8"), envBefore);
  assert.equal(await readFile(first.credentialsFile, "utf8"), credentialsBefore);
  const otherRoot = await temporary(t);
  const other = await setupLocal(otherRoot);
  assert.notEqual(JSON.parse(await readFile(other.credentialsFile, "utf8")).password, credentials.password);
});

test("custom local configuration is never overwritten or assigned unrelated login credentials", async (t) => {
  const root = await temporary(t);
  await writeFile(join(root, ".dev.vars"), "CUSTOM_CONFIGURATION=preserve\n");
  const result = await setupLocal(root);
  assert.equal(result.created, false);
  assert.equal(result.credentialsFile, null);
  assert.equal(await readFile(result.envFile, "utf8"), "CUSTOM_CONFIGURATION=preserve\n");
});

test("orphaned credentials are preserved without silently rotating the encryption key", async (t) => {
  const root = await temporary(t);
  await mkdir(join(root, ".local"));
  const credentialsFile = join(root, ".local", "admin-credentials.json");
  await writeFile(credentialsFile, '{"existing":true}');
  await assert.rejects(setupLocal(root), /Restore the missing .dev.vars/);
  assert.equal(await readFile(credentialsFile, "utf8"), '{"existing":true}');
});

test("deployment checks reject placeholder D1 and inline secrets while parsing JSONC URLs intact", () => {
  const config = parseJsonConfig(`{
    // local development value
    "d1_databases": [{"binding":"DB", "database_id":"00000000-0000-0000-0000-000000000000"}],
    "queues": {"producers":[
      {"binding":"RESEARCH_QUEUE","queue":"research"},
      {"binding":"CONCEPT_ARCHIVE_QUEUE","queue":"archive"}
    ], "consumers":[{"queue":"research"},{"queue":"archive"}]},
    "vars":{"DEEPSEEK_BASE_URL":"https://api.example.test/", "ALLOWED_API_ORIGINS":"https://app.real.test"},
  }`);
  assert.equal(config.vars.DEEPSEEK_BASE_URL, "https://api.example.test/");
  assert.equal(validateDeploymentConfig(config).length, 1);
  config.d1_databases[0].database_id = "12345678-1234-4234-8234-123456789abc";
  assert.deepEqual(validateDeploymentConfig(config), []);
  config.vars.SETTINGS_ENCRYPTION_KEY = "fixture-inline-secret";
  const errors = validateDeploymentConfig(config);
  assert.match(errors.join("\n"), /wrangler secret put/);
  assert.doesNotMatch(errors.join("\n"), /fixture-inline-secret/);
  delete config.vars.SETTINGS_ENCRYPTION_KEY;
  config.vars.ALLOWED_API_ORIGINS = "https://*.example.test";
  assert.ok(validateDeploymentConfig(config).length > 0);
});

test("smoke config discards existing provider credentials, remote state and configured paid access", () => {
  const path = resolve("dist/worker/wrangler.json");
  const config = smokeConfiguration({
    main: "index.js", assets: { directory: "../client" }, compatibility_date: "2026-05-22",
    vars: { PAID_PROVIDER_CALLS_ENABLED: "true", DEEPSEEK_API_KEY: "existing-secret" },
    services: [{ binding: "REMOTE", service: "production" }],
    d1_databases: [{ binding: "DB", database_id: "production-id", remote: true }],
  }, path);
  assert.equal(config.vars.PAID_PROVIDER_CALLS_ENABLED, "false");
  assert.equal(config.vars.ENABLE_EXAMPLE_REPORTS, "false");
  assert.equal(config.vars.DEEPSEEK_API_KEY, "");
  assert.equal(config.vars.DEEPSEEK_BASE_URL, "http://127.0.0.1:1");
  assert.equal(config.services, undefined);
  assert.equal(config.d1_databases[0].remote, undefined);
  assert.doesNotMatch(JSON.stringify(config), /existing-secret|production-id/);
});

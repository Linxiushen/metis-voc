import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { loadWranglerOptions, prepareLoadIsolation, seedLoadReport } from "../scripts/load-baseline.mjs";

test("load startup isolates hostile project/build vars and inherited provider credentials", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "metis-load-baseline-isolation-"));
  try {
    const project = join(temporary, "project");
    const isolated = join(temporary, "runtime");
    const builtDirectory = join(project, "dist", "server");
    await mkdir(join(project, ".wrangler", "deploy"), { recursive: true });
    await mkdir(builtDirectory, { recursive: true });
    await mkdir(isolated);
    const sentinel = "fixture-inherited-secret-must-not-escape";
    const hostileVars = {
      DEEPSEEK_API_KEY: sentinel, QWEN_API_KEY: sentinel, KEEPAMORE_API_KEY: sentinel,
      LOVART_ACCESS_KEY: sentinel, LOVART_SECRET_KEY: sentinel, LOVART_PROXY_TOKEN: sentinel,
      PAID_PROVIDER_CALLS_ENABLED: "true", SETTINGS_ENCRYPTION_KEY: sentinel,
      LOVART_PROXY_URL: "https://old-deployment.example.test/relay", ALLOWED_API_ORIGINS: "https://old-deployment.example.test",
    };
    await writeFile(join(project, ".dev.vars"), Object.entries(hostileVars).map(([key, value]) => `${key}=${value}`).join("\n"));
    await writeFile(join(project, ".env"), `CLOUDFLARE_API_TOKEN=${sentinel}`);
    await writeFile(join(builtDirectory, "index.js"), "export default {};");
    await writeFile(join(builtDirectory, "wrangler.json"), JSON.stringify({
      main: "index.js", compatibility_date: "2026-05-22", compatibility_flags: ["nodejs_compat"],
      assets: { directory: "../client" }, vars: hostileVars,
      account_id: sentinel, services: [{ binding: "REMOTE", service: "production" }],
      d1_databases: [{ binding: "DB", remote: true, database_id: sentinel }],
    }));
    await writeFile(join(project, ".wrangler", "deploy", "config.json"), JSON.stringify({
      configPath: "../../dist/server/wrangler.json",
    }));
    const isolation = await prepareLoadIsolation(project, isolated);
    const config = JSON.parse(await readFile(isolation.configPath, "utf8"));
    const devVars = await readFile(join(isolated, ".dev.vars"), "utf8");
    assert.equal(config.vars.PAID_PROVIDER_CALLS_ENABLED, "false");
    assert.equal(config.vars.ENABLE_EXAMPLE_REPORTS, "false");
    assert.equal(config.account_id, undefined);
    assert.equal(config.services, undefined);
    assert.equal(config.d1_databases.some((database) => database.remote), false);
    assert.equal(JSON.stringify(config).includes(sentinel), false);
    assert.equal(JSON.stringify(config).includes("old-deployment"), false);
    assert.equal(devVars.includes(sentinel), false);
    assert.ok(devVars.includes(isolation.credentials.passwordHash));
    assert.notEqual(isolation.credentials.password, "1");
    for (const [key, value] of Object.entries(config.vars)) {
      if (key.endsWith("_BASE_URL")) assert.match(value, /^http:\/\/127\.0\.0\.1:1$/);
      if (/(?:API_KEY|ACCESS_KEY|SECRET_KEY|PROXY_TOKEN)$/.test(key)) assert.equal(value, "");
    }
    const inherited = {
      ...process.env, ...hostileVars, NODE_OPTIONS: "--require fixture-untrusted-preload",
      CLOUDFLARE_API_TOKEN: sentinel, CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
      HTTPS_PROXY: "http://proxy.example.test", WRANGLER_LOG_PATH: "fixture-external-log",
    };
    const launch = loadWranglerOptions("wrangler.js", 8787, join(isolated, "state"), join(isolated, "log"), isolation, inherited);
    assert.equal(launch.options.cwd, isolated);
    assert.equal(launch.args[launch.args.indexOf("--config") + 1], isolation.configPath);
    assert.ok(launch.args.includes("--local"));
    assert.equal(Object.values(launch.options.env).includes(sentinel), false);
    for (const key of [...Object.keys(hostileVars), "NODE_OPTIONS", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_INCLUDE_PROCESS_ENV", "HTTPS_PROXY"]) {
      assert.equal(launch.options.env[key], undefined);
    }
    const output = [];
    const child = spawn(process.execPath, ["--input-type=module", "-e", "console.log(JSON.stringify(Object.keys(process.env)))"], launch.options);
    child.stdout.on("data", (data) => output.push(data));
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", resolve);
    });
    assert.equal(exitCode, 0);
    const childKeys = JSON.parse(Buffer.concat(output).toString());
    assert.equal(childKeys.includes("CLOUDFLARE_API_TOKEN"), false);
    assert.equal(childKeys.includes("DEEPSEEK_API_KEY"), false);
    assert.equal(childKeys.includes("NODE_OPTIONS"), false);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("synthetic load fixtures are seeded only into disposable D1 for the generated account", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "metis-load-baseline-fixture-"));
  try {
    const persistence = join(temporary, "state");
    await mkdir(persistence);
    const filename = join(persistence, "fixture.sqlite");
    const db = new DatabaseSync(filename);
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, tenant_id INTEGER, email TEXT);
      INSERT INTO users VALUES (7, 42, 'load-admin@example.test');
      CREATE TABLE runs (
        id INTEGER PRIMARY KEY, tenant_id INTEGER, user_id INTEGER, title TEXT, input_mode TEXT,
        input_payload TEXT, marketplace TEXT, view_profile TEXT, data_scope TEXT, status TEXT,
        verdict TEXT, research_plan TEXT, report TEXT, evidence_mode TEXT, decision_readiness TEXT,
        created_at REAL, updated_at REAL
      );
    `);
    db.close();
    const id = await seedLoadReport(temporary, persistence, "load-admin@example.test");
    const stored = new DatabaseSync(filename, { readOnly: true });
    try {
      const row = stored.prepare("SELECT * FROM runs WHERE id = ?").get(id);
      assert.equal(row.tenant_id, 42);
      assert.equal(row.user_id, 7);
      const report = JSON.parse(row.report);
      assert.equal(report.synthetic, true);
      assert.match(report.fixture_notice, /not market evidence/);
      assert.ok(row.report.length > 700000);
    } finally { stored.close(); }
    await assert.rejects(seedLoadReport(temporary, tmpdir(), "load-admin@example.test"), /outside the isolated/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

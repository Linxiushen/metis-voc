import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalCredentials } from "./setup-local.mjs";
import { parseJsonConfig } from "./check-deploy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const host = "127.0.0.1";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function smokeConfiguration(built, builtPath) {
  return {
    name: "metis-local-smoke",
    compatibility_date: built.compatibility_date,
    compatibility_flags: built.compatibility_flags,
    main: resolve(dirname(builtPath), built.main),
    no_bundle: true,
    base_dir: resolve(dirname(builtPath), built.base_dir || dirname(built.main)),
    find_additional_modules: true,
    rules: built.rules || [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    assets: { directory: resolve(dirname(builtPath), built.assets.directory), binding: "ASSETS", not_found_handling: "none" },
    d1_databases: [{ binding: "DB", database_name: "metis-smoke-db", database_id: "00000000-0000-0000-0000-000000000001" }],
    queues: {
      producers: [
        { binding: "RESEARCH_QUEUE", queue: "metis-smoke-research" },
        { binding: "CONCEPT_ARCHIVE_QUEUE", queue: "metis-smoke-archive" },
      ],
      consumers: [
        { queue: "metis-smoke-research", max_batch_size: 1, max_batch_timeout: 1, max_retries: 1 },
        { queue: "metis-smoke-archive", max_batch_size: 1, max_batch_timeout: 1, max_retries: 1 },
      ],
    },
    durable_objects: { bindings: [{ name: "DECISION_COORDINATOR", class_name: "DecisionCoordinator" }] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["DecisionCoordinator"] }],
    ratelimits: built.ratelimits,
    vars: {
      PAID_PROVIDER_CALLS_ENABLED: "false", ENABLE_EXAMPLE_REPORTS: "false", ALLOWED_API_ORIGINS: "",
      DEEPSEEK_API_KEY: "", QWEN_API_KEY: "", KEEPAMORE_API_KEY: "",
      LOVART_ACCESS_KEY: "", LOVART_SECRET_KEY: "", LOVART_PROXY_TOKEN: "", LOVART_PROJECT_ID: "",
      DEEPSEEK_BASE_URL: "http://127.0.0.1:1", QWEN_BASE_URL: "http://127.0.0.1:1",
      KEEPAMORE_BASE_URL: "http://127.0.0.1:1", LOVART_BASE_URL: "http://127.0.0.1:1", LOVART_PROXY_URL: "",
    },
  };
}

async function availablePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, host, () => {
      const port = server.address().port;
      server.close((error) => error ? fail(error) : done(port));
    });
  });
}

async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise((done) => { killer.once("exit", done); killer.once("error", done); });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    for (let attempt = 0; attempt < 30 && child.exitCode === null; attempt += 1) await sleep(100);
    if (child.exitCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}

export async function runSmoke(directory = root) {
  const wrangler = join(directory, "node_modules", "wrangler", "bin", "wrangler.js");
  const redirectPath = join(directory, ".wrangler", "deploy", "config.json");
  if (!existsSync(wrangler)) throw new Error("Dependencies missing. Run pnpm install --frozen-lockfile first.");
  if (!existsSync(redirectPath)) throw new Error("Built Worker missing. Run pnpm build before pnpm test:smoke.");
  const redirect = JSON.parse(await readFile(redirectPath, "utf8"));
  if (!redirect.configPath) throw new Error("Build redirect has no configPath. Run pnpm build again.");
  const builtPath = resolve(dirname(redirectPath), redirect.configPath);
  const built = parseJsonConfig(await readFile(builtPath, "utf8"), builtPath);
  const config = smokeConfiguration(built, builtPath);
  if (!existsSync(config.main)) throw new Error("Built Worker entry missing. Run pnpm build again.");
  const temporary = await mkdtemp(join(tmpdir(), "metis-local-smoke-"));
  const credentials = createLocalCredentials("smoke-admin@example.test");
  const knownSecrets = [credentials.password, credentials.passwordHash, credentials.encryptionKey];
  const sanitized = (text) => knownSecrets.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), String(text));
  let child;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ||= (async () => {
    await stopChild(child);
    if (dirname(resolve(temporary)) !== resolve(tmpdir()) || !basename(temporary).startsWith("metis-local-smoke-")) {
      throw new Error("Refusing to clean an unexpected smoke-test directory.");
    }
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  })();
  const interrupted = () => { void cleanup().finally(() => process.exit(130)); };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  const output = [];
  const checks = [];
  try {
    const configPath = join(temporary, "wrangler.json");
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const secrets = {
      BOOTSTRAP_ADMIN_EMAIL: credentials.email, BOOTSTRAP_ADMIN_PASSWORD_HASH: credentials.passwordHash,
      BOOTSTRAP_ADMIN_NAME: "Smoke administrator", SETTINGS_ENCRYPTION_KEY: credentials.encryptionKey,
    };
    await writeFile(join(temporary, ".dev.vars"), Object.entries(secrets).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
    const port = await availablePort();
    const baseUrl = `http://${host}:${port}`;
    // An allowlist prevents inherited application/provider credentials from
    // reaching the emulated Worker. Its config and .dev.vars are temporary.
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      /^(?:PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|LANG)$/i.test(name)));
    Object.assign(environment, {
      CI: "true", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false",
      WRANGLER_LOG_PATH: join(temporary, "wrangler.log"), MINIFLARE_REGISTRY_PATH: join(temporary, "registry"),
    });
    child = spawn(process.execPath, [wrangler, "dev", "--config", configPath, "--local", "--ip", host,
      "--port", String(port), "--persist-to", join(temporary, "state"), "--log-level", "error",
      "--show-interactive-dev-session=false"], {
      cwd: temporary, env: environment, stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true, detached: process.platform !== "win32",
    });
    let processFailure;
    child.once("error", (error) => { processFailure = error.message; });
    child.once("exit", (code, signal) => { processFailure = `Wrangler exited (${code ?? signal}).`; });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
      output.push(sanitized(chunk.toString()));
      if (output.length > 50) output.shift();
    });
    let token = "";
    const request = async (path, { method = "GET", body, headers = {}, expected = [200] } = {}) => {
      if (!path.startsWith("/api/") && path !== "/") throw new Error("Smoke requests are restricted to local application paths.");
      const response = await fetch(new URL(path, baseUrl), {
        method, redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.ok(expected.includes(response.status), `${method} ${path}: HTTP ${response.status}, expected ${expected.join("/")}`);
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      return { response, json, text };
    };
    const deadline = Date.now() + 120000;
    let health;
    while (Date.now() < deadline) {
      if (processFailure) throw new Error(processFailure);
      try { health = await request("/api/health"); break; } catch { await sleep(300); }
    }
    if (!health) throw new Error("Local Worker did not become ready within 120 seconds.");
    assert.equal(health.json.dependencies.paid_provider_calls, "paused");
    assert.equal(health.json.dependencies.database, "ready");
    checks.push("fresh D1/bootstrap and health; paid providers paused");
    await request("/api/runs", { expected: [401] });
    const login = await request("/api/auth/login", { method: "POST", body: { email: credentials.email, password: credentials.password } });
    token = login.json.token;
    assert.ok(token);
    knownSecrets.push(token);
    assert.equal(login.json.user.role, "admin");
    await request("/api/me");
    assert.deepEqual((await request("/api/runs")).json, []);
    checks.push("random admin login and no automatic report seeding");
    const credits = await request("/api/credits/me");
    assert.equal(credits.json.balance, 0);
    const createOptions = { method: "POST", headers: { "idempotency-key": "smoke-create-run-001" },
      body: { mode: "category_keyword", payload: "desk lamp", marketplace: "US", data_scope: "public_ok" } };
    const created = await request("/api/runs", { ...createOptions, expected: [201] });
    const runId = created.json.id;
    assert.ok(Number.isSafeInteger(runId));
    assert.equal((await request("/api/runs", createOptions)).json.id, runId);
    checks.push("tenant credits and idempotent research creation");
    await request(`/api/runs/${runId}/confirm`, { method: "POST", body: {}, expected: [202] });
    const queueDeadline = Date.now() + 60000;
    let status;
    do {
      status = (await request(`/api/runs/${runId}/status`)).json.status;
      if (["done", "failed"].includes(status)) break;
      await sleep(300);
    } while (Date.now() < queueDeadline);
    assert.equal(status, "done", "local Queue must finish the offline template run");
    const report = await request(`/api/runs/${runId}`);
    assert.ok(report.json.report);
    assert.notEqual(report.json.report.evidence_mode, "verified_research");
    await request(`/api/runs/${runId}/export-check`, { expected: [409] });
    await request(`/api/runs/${runId}/export.json`, { expected: [409] });
    checks.push("real Queue execution and unverified-report export gates");
    await request("/api/auth/logout", { method: "POST", body: {} });
    await request("/api/me", { expected: [401] });
    checks.push("session revocation");
    console.log(JSON.stringify({ passed: true, checks, paid_provider_calls: false, isolated_temporary_d1: true }, null, 2));
    return { passed: true, checks };
  } catch (error) {
    throw new Error(`${sanitized(error.message)}\n${sanitized(output.join("").slice(-6000))}`);
  } finally {
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
    await cleanup();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSmoke().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

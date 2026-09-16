import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
let bodyModule;
let rateLimitModule;
let server;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
  });
  bodyModule = await server.ssrLoadModule("/lib/request-body.ts");
  rateLimitModule = await server.ssrLoadModule("/lib/rate-limit.ts");
});

after(async () => {
  await server?.close();
});

class MemoryRateLimitDatabase {
  constructor() {
    this.events = [];
  }

  prepare(sql) {
    assert.match(sql, /INSERT INTO rate_limit_events\(bucket, event_at\)/);
    const events = this.events;
    return {
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async run() {
        const now = this.args.at(-1);
        const ruleCount = (this.args.length - 1) / 3;
        assert.equal(Number.isInteger(ruleCount), true);
        const rules = Array.from({ length: ruleCount }, (_, index) => ({
          bucket: this.args[index * 3],
          cutoff: this.args[index * 3 + 1],
          limit: this.args[index * 3 + 2],
        }));
        const allowed = rules.every((rule) =>
          events.filter((event) =>
            event.bucket === rule.bucket && event.eventAt > rule.cutoff
          ).length < rule.limit
        );
        if (allowed) {
          events.push(...rules.map((rule) => ({ bucket: rule.bucket, eventAt: now })));
        }
        return { meta: { changes: allowed ? rules.length : 0 } };
      },
    };
  }

  count(bucket) {
    return this.events.filter((event) => event.bucket === bucket).length;
  }
}

test("sliding-window admission updates every bucket or none", async () => {
  const db = new MemoryRateLimitDatabase();
  const rulesFor = (ip) => [
    { bucket: `register:ip:${ip}`, limit: 2, windowSeconds: 60 },
    { bucket: "register:global", limit: 3, windowSeconds: 60 },
  ];

  assert.equal((await rateLimitModule.consumeSlidingWindow(db, rulesFor("a"), 100)).allowed, true);
  assert.equal((await rateLimitModule.consumeSlidingWindow(db, rulesFor("a"), 101)).allowed, true);
  assert.equal((await rateLimitModule.consumeSlidingWindow(db, rulesFor("a"), 102)).allowed, false);
  assert.equal(db.count("register:global"), 2, "a rejected local bucket must not consume global quota");

  assert.equal((await rateLimitModule.consumeSlidingWindow(db, rulesFor("b"), 102)).allowed, true);
  assert.equal((await rateLimitModule.consumeSlidingWindow(db, rulesFor("c"), 103)).allowed, false);
  assert.equal(db.count("register:ip:c"), 0, "a rejected global bucket must not consume local quota");
  assert.equal(db.count("register:global"), 3);
});

test("sliding-window events expire at the configured boundary", async () => {
  const db = new MemoryRateLimitDatabase();
  const rules = [{ bucket: "login:pair", limit: 1, windowSeconds: 60 }];

  assert.equal((await rateLimitModule.consumeSlidingWindow(db, rules, 100)).allowed, true);
  assert.equal((await rateLimitModule.consumeSlidingWindow(db, rules, 159)).allowed, false);
  assert.equal((await rateLimitModule.consumeSlidingWindow(db, rules, 160)).allowed, true);
});

test("bounded body reader cancels a chunked stream immediately after the byte cap", async () => {
  let cancelled = false;
  const chunks = [new TextEncoder().encode("123"), new TextEncoder().encode("456")];
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://example.test/api/auth/login", {
    method: "POST",
    body,
    duplex: "half",
  });

  await assert.rejects(
    bodyModule.readBoundedRequestText(request, 5),
    (error) => error instanceof bodyModule.RequestBodyTooLargeError,
  );
  assert.equal(cancelled, true);
});

test("bounded body reader returns an in-limit chunked body", async () => {
  const request = new Request("https://example.test/api/auth/login", {
    method: "POST",
    body: "{\"ok\":true}",
  });
  assert.equal(await bodyModule.readBoundedRequestText(request, 32), "{\"ok\":true}");
});

test("API wiring uses trusted Cloudflare IPs and the required public quotas", async () => {
  const [
    routeSource,
    schemaSource,
    databaseSource,
    wranglerSource,
    workerSource,
    providerAccessSource,
    researchQueueSource,
  ] = await Promise.all([
    readFile(new URL("../app/api/[[...path]]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/provider-access.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/research-queue.ts", import.meta.url), "utf8"),
  ]);
  const bodyJsonSource = routeSource.slice(
    routeSource.indexOf("async function bodyJson"),
    routeSource.indexOf("function boundedText"),
  );

  assert.match(routeSource, /headers\.get\("cf-connecting-ip"\)/);
  assert.doesNotMatch(routeSource, /x-forwarded-for/i);
  assert.match(bodyJsonSource, /readBoundedRequestText\(request, maxBytes\)/);
  assert.match(bodyJsonSource, /mediaType\s*!==\s*"application\/json"/);
  assert.doesNotMatch(bodyJsonSource, /request\.text\(\)/);
  assert.match(routeSource, /register:ip[\s\S]{0,180}limit:\s*5[\s\S]{0,80}60 \* 60/);
  assert.match(routeSource, /register:global[\s\S]{0,80}limit:\s*100[\s\S]{0,80}24 \* 60 \* 60/);
  assert.match(routeSource, /providers-test:user-minute[\s\S]+limit:\s*1, windowSeconds:\s*60/);
  assert.match(routeSource, /providers-test:user-day[\s\S]+limit:\s*10, windowSeconds:\s*24 \* 60 \* 60/);
  assert.match(routeSource, /providers-test:global-day[\s\S]{0,100}limit:\s*100/);
  assert.match(routeSource, /DECISION_RATE_LIMIT/);
  assert.match(routeSource, /activeDecisionMutations/);
  assert.match(routeSource, /decision:user/);
  assert.match(routeSource, /getRunStatus\(runId, user\.tenant_id\)/);
  assert.match(wranglerSource, /"name":\s*"DECISION_RATE_LIMIT"[\s\S]{0,120}"limit":\s*2[\s\S]{0,60}"period":\s*10/);
  assert.match(wranglerSource, /"name":\s*"DECISION_COORDINATOR"/);
  assert.match(wranglerSource, /"new_sqlite_classes":\s*\["DecisionCoordinator"\]/);
  assert.match(workerSource, /request\.headers\.has\("origin"\)[\s\S]{0,100}!allowedApiOrigin\(request, env\.ALLOWED_API_ORIGINS\)/);
  assert.match(workerSource, /response\s*=\s*new Response\("CORS origin denied",\s*\{ status: 403 \}\)/);
  assert.match(routeSource, /async function enforceLoginRequestLimit/);
  assert.match(routeSource, /async function enforceLoginFailureLimit/);
  assert.match(routeSource, /if \(!row \|\| !passwordValid\)[\s\S]{0,120}enforceLoginFailureLimit/);
  assert.match(routeSource, /function requirePaidProviderAccess/);
  assert.match(routeSource, /providers" && path\[1\] === "test"[\s\S]{0,180}requirePaidProviderAccess\(user\)/);
  assert.match(providerAccessSource, /PAID_PROVIDER_CALLS_ENABLED/);
  assert.match(providerAccessSource, /\["pro", "enterprise"\]/);
  assert.match(researchQueueSource, /tenantCanUsePaidProviders/);
  assert.match(wranglerSource, /"PAID_PROVIDER_CALLS_ENABLED":\s*"false"/);
  for (const scope of ["login:account", "login:ip", "login:account-ip"]) {
    assert.match(routeSource, new RegExp(scope.replace("-", "\\-")));
  }
  assert.match(schemaSource, /sqliteTable\("rate_limit_events"/);
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS rate_limit_events/);
  assert.match(databaseSource, /rate_limit_events_bucket_time_idx/);
});

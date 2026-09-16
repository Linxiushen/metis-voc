import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
let relay;
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
  relay = await server.ssrLoadModule("/lib/lovart-relay.ts");
});

after(async () => {
  await server?.close();
});

test("relay payload follows the Apps Script contract", () => {
  const payload = relay.buildLovartRelayPayload(
    "relay-secret",
    "GET",
    "/v1/openapi/chat/status",
    { thread_id: "thread-1" },
  );
  assert.deepEqual(payload, {
    token: "relay-secret",
    method: "GET",
    path: "/v1/openapi/chat/status",
    params: { thread_id: "thread-1" },
    body: null,
  });
});

test("relay payload forwards a stable idempotency key for POST requests", () => {
  const payload = relay.buildLovartRelayPayload(
    "relay-secret",
    "POST",
    "/v1/openapi/chat/confirm",
    undefined,
    { thread_id: "thread-1" },
    "metis-confirm-task-1",
  );
  assert.deepEqual(payload, {
    token: "relay-secret",
    method: "POST",
    path: "/v1/openapi/chat/confirm",
    params: {},
    body: { thread_id: "thread-1" },
    idempotency_key: "metis-confirm-task-1",
  });
});

test("relay envelope preserves upstream status and content type", () => {
  assert.deepEqual(
    relay.parseLovartRelayEnvelope({
      ok: false,
      status: 429,
      body: '{"message":"rate limited"}',
      contentType: "application/json",
    }),
    {
      status: 429,
      body: '{"message":"rate limited"}',
      contentType: "application/json",
    },
  );
});

test("relay envelope defaults a missing content type", () => {
  const parsed = relay.parseLovartRelayEnvelope({
    ok: true,
    status: 200,
    body: { code: 0, data: { status: "ready" } },
  });
  assert.equal(parsed.status, 200);
  assert.equal(parsed.body, '{"code":0,"data":{"status":"ready"}}');
  assert.equal(parsed.contentType, "application/json; charset=utf-8");
});

test("relay envelope rejects malformed statuses", () => {
  assert.throws(
    () => relay.parseLovartRelayEnvelope({ status: 0, body: "" }),
    /有效状态码/,
  );
});

test("relay envelope uses a null body for bodyless HTTP statuses", () => {
  for (const status of [204, 205, 304]) {
    const parsed = relay.parseLovartRelayEnvelope({ status, body: "" });
    assert.equal(parsed.body, null);
    assert.doesNotThrow(() => new Response(parsed.body, { status }));
  }
});

test("relay credentials are sufficient without direct Lovart keys", () => {
  assert.deepEqual(
    relay.lovartTransportReadiness({
      accessKey: "",
      secretKey: "",
      proxyUrl: "https://example.test/exec",
      proxyToken: "relay-secret",
    }),
    { configured: true, transport: "relay", error: "" },
  );
});

test("partial relay credentials do not silently fall back to direct mode", () => {
  assert.deepEqual(
    relay.lovartTransportReadiness({
      accessKey: "direct-access",
      secretKey: "direct-secret",
      proxyUrl: "https://example.test/exec",
      proxyToken: "",
    }),
    {
      configured: false,
      transport: "relay",
      error: "Lovart 中继配置不完整",
    },
  );
});

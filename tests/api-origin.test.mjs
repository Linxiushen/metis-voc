import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let allowedApiOrigin;
before(async () => {
  server = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, hmr: false, ws: false } });
  ({ allowedApiOrigin } = await server.ssrLoadModule("/lib/api-origin.ts"));
});
after(async () => server?.close());

const request = (origin, destination = "https://my-fork.example/api/auth/login") => new Request(destination, {
  headers: origin === undefined ? {} : { origin },
});

test("a fresh deployment accepts its own origin without hardcoded owner domains", () => {
  assert.equal(allowedApiOrigin(request("https://my-fork.example")), "https://my-fork.example");
  assert.equal(allowedApiOrigin(request("http://127.0.0.1:8787", "http://127.0.0.1:8787/api/me")), "http://127.0.0.1:8787");
});

test("cross-origin API calls require an exact configured HTTPS origin", () => {
  const configured = "https://client.example, https://second.example";
  assert.equal(allowedApiOrigin(request("https://client.example"), configured), "https://client.example");
  for (const value of ["null", "https://client.example.evil.test", "https://client.example/", "https://user@client.example", "http://localhost:3000", "http://client.example", "https://unrelated.pages.dev"]) {
    assert.equal(allowedApiOrigin(request(value), configured), "", value);
  }
  assert.equal(allowedApiOrigin(request(undefined)), "");
  assert.equal(allowedApiOrigin(request("https://client.example"), "https://client.example/path"), "");
});

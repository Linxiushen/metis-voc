import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const ENV_KEY = "__metisProviderCredentialBoundaryEnv";
let server;
let lovart;
let keepamore;

before(async () => {
  globalThis[ENV_KEY] = {
    LOVART_ACCESS_KEY: "fixture-access-key",
    LOVART_SECRET_KEY: "fixture-secret-key",
  };
  server = await createServer({
    root, configFile: false, appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
    plugins: [{
      name: "credential-boundary-env",
      enforce: "pre",
      resolveId(id) {
        return id === "cloudflare:workers" ? "\0credential-boundary-env" : null;
      },
      load(id) {
        return id === "\0credential-boundary-env"
          ? `export const env = globalThis[${JSON.stringify(ENV_KEY)}];`
          : null;
      },
    }],
  });
  lovart = await server.ssrLoadModule("/lib/lovart.ts");
  keepamore = await server.ssrLoadModule("/lib/keepamore.ts");
});

after(async () => {
  await server?.close();
  delete globalThis[ENV_KEY];
});

async function listen(handler) {
  const http = createHttpServer(handler);
  await new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${http.address().port}`,
    close: () => new Promise((resolve, reject) => {
      http.closeAllConnections();
      http.close((error) => error ? reject(error) : resolve());
    }),
  };
}

test("provider credentials are never sent to a redirect destination", async (t) => {
  for (const provider of ["KeepaMore", "Lovart"]) {
    await t.test(provider, async () => {
      let targetRequests = 0;
      let sourceRequests = 0;
      const target = await listen((_request, response) => {
        targetRequests += 1;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ code: "0000", data: { products: [] } }));
      });
      const source = await listen((request, response) => {
        sourceRequests += 1;
        const header = provider === "KeepaMore" ? "x-api-key" : "x-access-key";
        assert.ok(request.headers[header]);
        response.writeHead(307, { Location: `${target.url}/capture` });
        response.end();
      });
      try {
        if (provider === "KeepaMore") {
          const client = new keepamore.KeepaMoreClient({
            apiKey: "fixture-keepamore-key", baseUrl: source.url, maxRetries: 0,
          });
          await assert.rejects(client.searchCatBeds(), /network request failed/);
        } else {
          globalThis[ENV_KEY].LOVART_BASE_URL = source.url;
          const result = await lovart.testLovartProvider();
          assert.equal(result.ok, false);
          assert.match(result.detail, /网络请求失败/);
        }
        assert.equal(sourceRequests, 1);
        assert.equal(targetRequests, 0);
      } finally {
        await source.close();
        await target.close();
      }
    });
  }
});

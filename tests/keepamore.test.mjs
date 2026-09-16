import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const API_KEY = `km_${"a".repeat(32)}`;
let keepamore;
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
  keepamore = await server.ssrLoadModule("/lib/keepamore.ts");
});

after(async () => {
  await server?.close();
});

function envelope(data, metadata = {}) {
  return new Response(JSON.stringify({ code: "0000", msg: "ok", data, metadata }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function statsArray(entries = {}) {
  const result = Array(19).fill(-1);
  for (const [index, value] of Object.entries(entries)) result[Number(index)] = value;
  return result;
}

function extrema(priceType, keepaTime, value) {
  const result = Array(19).fill(null);
  result[priceType] = [keepaTime, value];
  return result;
}

function rawProduct(overrides = {}) {
  return {
    asin: "B012345678",
    domainId: 1,
    productType: 0,
    title: "Washable round cat bed",
    brand: "Example Pet",
    categories: [123, 456],
    categoryTree: [{ catId: 123, name: "Pet Supplies" }],
    images: [{ l: "example-image.jpg" }],
    trackingSince: 100,
    listedSince: 200,
    lastUpdate: 300,
    lastPriceChange: 301,
    lastRatingUpdate: 302,
    lastSoldUpdate: 303,
    monthlySold: 700,
    stats: {
      current: statsArray({ 1: 2999, 3: 4321, 11: 8, 16: 45, 17: 321 }),
      avg: statsArray({ 1: 2899 }),
      avg30: statsArray({ 1: 2799 }),
      avg90: statsArray({ 1: 2699 }),
      avg180: statsArray({ 1: 2599 }),
      minInInterval: extrema(1, 250, 2299),
      maxInInterval: extrema(1, 260, 3499),
      totalOfferCount: 8,
    },
    csv: [null, [250, 2299, 251, -1, 252, 2999]],
    fbaFees: { pickAndPackFee: 455 },
    referralFeePercentage: 15,
    ...overrides,
  };
}

test("product search uses backend X-API-Key and normalizes Keepa units", async () => {
  const calls = [];
  const client = new keepamore.KeepaMoreClient({
    apiKey: API_KEY,
    baseUrl: "https://keepamore.example/api/",
    now: () => 1_800_000_000_000,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return envelope(
        { products: [rawProduct()], count: 1 },
        {
          requestId: "request-1",
          unitsCharged: 5,
          quotaHint: {
            minute: { limit: 20, remaining: 15 },
            day: { limit: 1000, remaining: 995 },
          },
        },
      );
    },
  });

  const result = await client.searchCatBeds({ stats: 30, detailLevel: "summary" });

  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.pathname, "/api/keepa/productsearch");
  assert.equal(requestUrl.searchParams.get("term"), "cat bed");
  assert.equal(requestUrl.searchParams.get("domain"), "1");
  assert.equal(requestUrl.searchParams.get("stats"), "30");
  assert.equal(requestUrl.searchParams.has("key"), false);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers["X-API-Key"], API_KEY);

  const [product] = result.products;
  assert.equal(product.currentPrice.amount, 29.99);
  assert.equal(product.currentPrice.minorUnits, 2999);
  assert.equal(product.averagePrice30d.amount, 27.99);
  assert.equal(product.rating, 4.5);
  assert.equal(product.reviewCount, 321);
  assert.equal(product.salesRank, 4321);
  assert.equal(product.monthlySold, 700);
  assert.equal(product.searchPosition, 1);
  assert.equal(product.priceHistory[1].price, null);
  assert.equal(product.priceHistory[2].price.amount, 29.99);
  assert.equal(product.trackingSince, keepamore.keepaTimeToIso(100));
  assert.equal(product.intervalMinimumPrice.at, keepamore.keepaTimeToIso(250));
  assert.equal(product.imageUrls[0], "https://m.media-amazon.com/images/I/example-image.jpg");
  assert.equal(result.metadata.quota.minute.remaining, 15);
});

test("missing -1/-2 values stay null and Japanese prices are not divided by 100", async () => {
  assert.equal(keepamore.keepaPriceToMoney(-1, 1), null);
  assert.equal(keepamore.keepaPriceToMoney(-2, 1), null);
  assert.deepEqual(keepamore.keepaPriceToMoney(1980, 5), {
    amount: 1980,
    minorUnits: 1980,
    currency: "JPY",
    minorUnitScale: 1,
  });
  assert.equal(keepamore.keepaTimeToIso(-1), null);
  assert.equal(keepamore.keepaTimeToIso(0), null);

  const product = rawProduct({
    listedSince: 0,
    monthlySold: -1,
    stats: {
      current: statsArray({ 0: -2, 1: -1, 3: -2, 16: -1, 17: -2 }),
      avg30: statsArray({ 1: -1 }),
    },
  });
  const client = new keepamore.KeepaMoreClient({
    apiKey: API_KEY,
    maxRetries: 0,
    fetch: async () => envelope({ products: [product] }),
  });
  const result = await client.searchCatBeds();
  assert.equal(result.products[0].currentPrice, null);
  assert.equal(result.products[0].averagePrice30d, null);
  assert.equal(result.products[0].rating, null);
  assert.equal(result.products[0].reviewCount, null);
  assert.equal(result.products[0].salesRank, null);
  assert.equal(result.products[0].monthlySold, null);
  assert.equal(result.products[0].listedSince, null);
});

test("product enrichment defaults to POST, deduplicates input, and preserves partial errors", async () => {
  let captured;
  const client = new keepamore.KeepaMoreClient({
    apiKey: API_KEY,
    fetch: async (url, init) => {
      captured = { url, init };
      return envelope({
        country: "us",
        count: 1,
        products: [rawProduct()],
        errors: [{
          asin: "B087654321",
          code: "UPSTREAM_ITEM_ERROR",
          message: "upstream unavailable",
          errorId: "trace-partial-1",
        }],
      });
    },
  });

  const result = await client.getProducts({
    asins: ["b012345678", "B012345678", "B087654321"],
    stats: 90,
    history: false,
    rating: true,
    buybox: true,
    detailLevel: "summary",
  });

  assert.equal(captured.url, "https://mcp.keepamore.com/api/keepa/product");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["content-type"], "application/json");
  assert.equal(captured.init.headers["X-API-Key"], API_KEY);
  assert.deepEqual(JSON.parse(captured.init.body), {
    domain: 1,
    asins: ["B012345678", "B087654321"],
    detailLevel: "summary",
    stats: 90,
    history: false,
    rating: true,
    buybox: true,
  });
  assert.equal(result.products.length, 1);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.errors[0], {
    asin: "B087654321",
    code: "UPSTREAM_ITEM_ERROR",
    message: "upstream unavailable",
    errorId: "trace-partial-1",
  });
  assert.doesNotMatch(result.sourceRef, /km_/);
});

test("product enrichment also supports the official GET contract", async () => {
  let captured;
  const client = new keepamore.KeepaMoreClient({
    apiKey: API_KEY,
    fetch: async (url, init) => {
      captured = { url, init };
      return envelope({ products: [rawProduct()] });
    },
  });
  await client.getProducts({
    asins: ["B012345678"],
    stats: 30,
    days: 90,
    method: "GET",
  });
  const url = new URL(captured.url);
  assert.equal(captured.init.method, "GET");
  assert.equal(url.searchParams.get("asins"), "B012345678");
  assert.equal(url.searchParams.get("stats"), "30");
  assert.equal(url.searchParams.get("days"), "90");
});

test("429 minute quota retries after Retry-After without leaking the key", async () => {
  const delays = [];
  let attempts = 0;
  const client = new keepamore.KeepaMoreClient({
    apiKey: API_KEY,
    retryBaseMs: 10,
    sleep: async (delay) => delays.push(delay),
    fetch: async (url) => {
      attempts += 1;
      assert.doesNotMatch(url, /km_/);
      if (attempts === 1) {
        return new Response(JSON.stringify({
          code: "QUOTA_MINUTE",
          msg: "minute rate limit",
          data: null,
        }), { status: 429, headers: { "retry-after": "2" } });
      }
      return envelope({ asinList: ["B012345678"], count: 1 });
    },
  });

  const result = await client.searchCatBeds({ asinsOnly: true });
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [2000]);
  assert.deepEqual(result.asins, ["B012345678"]);
});

test("5xx responses use a finite exponential retry budget", async () => {
  const delays = [];
  let attempts = 0;
  const client = new keepamore.KeepaMoreClient({
    apiKey: API_KEY,
    maxRetries: 1,
    retryBaseMs: 25,
    sleep: async (delay) => delays.push(delay),
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({
          code: "EXECUTION_ERROR",
          msg: "temporary upstream failure",
          errorId: "trace-503",
        }), { status: 503 });
      }
      return envelope({ asinList: [], count: 0 });
    },
  });
  await client.searchCatBeds({ asinsOnly: true });
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [25]);
});

test("QUOTA_NO_SUBSCRIPTION is explicit and is never retried", async () => {
  let attempts = 0;
  const client = new keepamore.KeepaMoreClient({
    apiKey: API_KEY,
    maxRetries: 2,
    sleep: async () => assert.fail("permanent subscription errors must not sleep"),
    fetch: async () => {
      attempts += 1;
      return new Response(JSON.stringify({
        code: "QUOTA_NO_SUBSCRIPTION",
        msg: "no package",
        data: null,
        errorId: "quota-trace-1",
      }), { status: 429 });
    },
  });

  await assert.rejects(
    client.searchCatBeds(),
    (error) => {
      assert.equal(error instanceof keepamore.KeepaMoreApiError, true);
      assert.equal(error.code, "QUOTA_NO_SUBSCRIPTION");
      assert.equal(error.status, 429);
      assert.equal(error.retryable, false);
      assert.equal(error.errorId, "quota-trace-1");
      assert.match(error.message, /no active API subscription/);
      return true;
    },
  );
  assert.equal(attempts, 1);
});

test("upstream diagnostics cannot expose the configured API key", async (t) => {
  for (const scenario of ["http", "code", "network", "batch"]) {
    await t.test(scenario, async () => {
      const client = new keepamore.KeepaMoreClient({
        apiKey: API_KEY,
        maxRetries: 0,
        fetch: async () => {
          if (scenario === "network") throw new Error(`rejected key ${API_KEY}`);
          if (scenario === "batch") {
            return envelope({
              products: [], errors: [{
                asin: "B012345678", code: `invalid_${API_KEY}`,
                message: `rejected key ${API_KEY}`, errorId: `trace_${API_KEY}`,
              }],
            });
          }
          return new Response(JSON.stringify({
            code: scenario === "code" ? `QUOTA_${API_KEY}` : "AUTH_ERROR",
            msg: `rejected key ${API_KEY}`, errorId: `trace_${API_KEY}`,
          }), { status: scenario === "http" ? 401 : 200 });
        },
      });
      if (scenario === "batch") {
        const result = await client.getProducts({ domain: 1, asins: ["B012345678"] });
        assert.equal(result.errors.length, 1);
        assert.equal(JSON.stringify(result.errors).includes(API_KEY), false);
      } else {
        await assert.rejects(client.searchCatBeds(), (error) => {
          assert.equal(error instanceof keepamore.KeepaMoreApiError, true);
          assert.equal(`${error.message} ${error.code} ${error.errorId}`.includes(API_KEY), false);
          return true;
        });
      }
    });
  }
});

test("request timeout aborts the transport and reports a typed error", async () => {
  const client = new keepamore.KeepaMoreClient({
    apiKey: API_KEY,
    timeoutMs: 5,
    maxRetries: 0,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
        once: true,
      });
    }),
  });
  await assert.rejects(
    client.searchCatBeds(),
    (error) => {
      assert.equal(error.code, "REQUEST_TIMEOUT");
      assert.equal(error.status, 0);
      assert.equal(error.retryable, true);
      assert.match(error.message, /timed out/);
      return true;
    },
  );
});

test("request timeout also covers a stalled response body", async () => {
  const client = new keepamore.KeepaMoreClient({
    apiKey: API_KEY,
    timeoutMs: 5,
    maxRetries: 0,
    fetch: async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        init.signal.addEventListener("abort", () => {
          controller.error(new DOMException("aborted", "AbortError"));
        }, { once: true });
      },
    })),
  });
  await assert.rejects(
    client.searchCatBeds(),
    (error) => {
      assert.equal(error.code, "REQUEST_TIMEOUT");
      assert.match(error.message, /timed out/);
      return true;
    },
  );
});

test("cat bed workflow enriches search ASINs and emits an auditable partial batch", async () => {
  const requests = [];
  const client = new keepamore.KeepaMoreClient({
    apiKey: API_KEY,
    now: () => 1_800_000_000_000,
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (init.method === "GET") {
        return envelope({ asinList: ["B012345678", "B087654321"], count: 2 });
      }
      return envelope({
        products: [rawProduct()],
        errors: [{ asin: "B087654321", errorId: "partial-cat-bed-1" }],
      });
    },
  });

  const result = await client.researchCatBeds({ maxProducts: 2, statsDays: 90 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[1].init.method, "POST");
  assert.equal(new URL(requests[0].url).searchParams.get("term"), "cat bed");
  assert.equal(result.estimatedUnits, 7);
  assert.equal(result.enrichment.products[0].searchPosition, 1);

  const batch = result.observationBatch;
  assert.equal(batch.contract_version, "metis.research-data.v1");
  assert.equal(batch.adapter_id, "keepamore-amazon-market-adapter");
  assert.equal(batch.complete, false);
  assert.equal(batch.quality.rejected, 1);
  assert.equal(batch.quality.warnings.some((warning) => /partial-cat-bed-1/.test(warning)), true);
  assert.equal(batch.quality.warnings.some((warning) => /must not be represented as review VOC/.test(warning)), true);

  const currentPrice = batch.observations.find((item) => item.metric === "current_price");
  assert.equal(currentPrice.value, 29.99);
  assert.equal(currentPrice.unit, "USD");
  assert.equal(currentPrice.evidence_class, "observed_fact");
  assert.equal(currentPrice.subject_id, "B012345678");
  assert.doesNotMatch(currentPrice.source_ref, /km_/);

  const position = batch.observations.find((item) => item.metric === "search_result_position");
  assert.equal(position.value, 1);
  assert.match(position.source_ref, /productsearch/);
  assert.equal(position.dimensions.measurement_semantics, "organic_order_after_ad_removal");
});

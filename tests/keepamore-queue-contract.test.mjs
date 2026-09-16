import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const TEST_STATE_KEY = "__metisKeepaMoreQueueContractState";
const TEST_ENV_KEY = "__metisKeepaMoreQueueContractEnv";

let queueModule;
let server;
let state;

function rawProduct() {
  return {
    asin: "B0ABC12345",
    domainId: 1,
    currency: "USD",
    title: "Washable Round Cat Bed",
    brand: "Acme",
    imageUrls: ["https://images.example.test/cat-bed.jpg"],
    currentPrice: { amount: 29.99 },
    averagePrice30d: { amount: 31.25 },
    averagePrice90d: { amount: 32.5 },
    salesRank: 1250,
    salesRankDrops30d: 87,
    rating: 4.6,
    reviewCount: 1834,
    monthlySold: 1000,
    totalOfferCount: 4,
    buyBoxIsFba: true,
  };
}

function quotaMetadata() {
  return {
    quota: {
      day: { remaining: 992 },
      month: { remaining: null },
      minute: { remaining: 18 },
    },
  };
}

function createRun() {
  return {
    id: 51,
    tenant_id: 7,
    user_id: 11,
    status: "queued",
    updated_at: 1_800_000_000,
    execution_token: null,
    execution_lease_until: null,
    marketplace: "US",
    input_mode: "category_keyword",
    input_payload: "cat bed",
    research_plan: {
      category_scope: "cat bed",
      data_window_days: 90,
      research_brief: { sources: { keepamore: true } },
    },
  };
}

function normalizedSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function fakeDatabase() {
  return {
    prepare(sql) {
      const query = normalizedSql(sql);
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          if (query.startsWith("select settings from tenants")) {
            return { settings: state.tenantSettings };
          }
          if (query.startsWith("select plan from tenants")) return { plan: state.tenantPlan };
          throw new Error(`Unexpected queue contract first(): ${query}`);
        },
        async run() {
          if (query.includes("set status = 'executing'")) {
            state.run.status = "executing";
            state.run.execution_token = args[0];
            state.run.execution_lease_until = args[1];
            return { meta: { changes: 1 } };
          }
          if (query.includes("set execution_lease_until = ?")) {
            const [leaseUntil, runId, tenantId, claimedAt, leaseToken] = args;
            state.renewalCalls += 1;
            if (state.leaseRenewalFailsAt === state.renewalCalls) {
              return { meta: { changes: 0 } };
            }
            const matches = state.run.id === runId && state.run.tenant_id === tenantId &&
              state.run.status === "executing" && state.run.updated_at === claimedAt &&
              state.run.execution_token === leaseToken;
            if (matches) state.run.execution_lease_until = leaseUntil;
            return { meta: { changes: matches ? 1 : 0 } };
          }
          if (query.includes("set status = 'failed'")) {
            state.run.status = "failed";
            state.run.error_message = String(args[0]);
            return { meta: { changes: 1 } };
          }
          if (query.includes("set error_message = ?, failed_at = ?, execution_lease_until = ?")) {
            const [errorMessage, failedAt, leaseUntil, runId, tenantId, claimedAt, token] = args;
            const matches = state.run.id === runId && state.run.tenant_id === tenantId &&
              state.run.updated_at === claimedAt && state.run.execution_token === token &&
              state.run.status === "executing";
            if (matches) Object.assign(state.run, {
              error_message: errorMessage, failed_at: failedAt, execution_lease_until: leaseUntil,
            });
            return { meta: { changes: Number(matches) } };
          }
          if (query.includes("set status = 'done'")) {
            state.run.status = "done";
            state.persistedReport = JSON.parse(String(args[0]));
            state.run.verdict = String(args[1]);
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected queue contract run(): ${query}`);
        },
      };
    },
  };
}

function virtualModulePlugin() {
  const virtualModules = new Map([
    ["cloudflare:workers", "\0keepamore-queue-cloudflare"],
    ["./database", "\0keepamore-queue-database"],
    ["./llm", "\0keepamore-queue-llm"],
    ["./report", "\0keepamore-queue-report"],
    ["./keepamore", "\0keepamore-queue-client"],
    ["./settings", "\0keepamore-queue-settings"],
    ["./provider-access", "\0keepamore-queue-provider-access"],
    ["./credits", "\0keepamore-queue-credits"],
  ]);
  return {
    name: "keepamore-queue-contract-virtual-modules",
    enforce: "pre",
    resolveId(id, importer) {
      if (id === "cloudflare:workers") return virtualModules.get(id);
      if (!importer?.replaceAll("\\", "/").endsWith("/lib/research-queue.ts")) return null;
      return virtualModules.get(id) || null;
    },
    load(id) {
      if (id === "\0keepamore-queue-cloudflare") {
        return `export const env = globalThis[${JSON.stringify(TEST_ENV_KEY)}];`;
      }
      if (id === "\0keepamore-queue-database") {
        return `
          const currentState = () => globalThis[${JSON.stringify(TEST_STATE_KEY)}];
          export const database = () => currentState().database;
          export const ensureSchema = async () => {};
          export const getRun = async () => currentState().run;
        `;
      }
      if (id === "\0keepamore-queue-llm") {
        return `export const enrichReportWithModels = async (report) => report;`;
      }
      if (id === "\0keepamore-queue-report") {
        return `
          export const categoryLabel = () => "fallback category";
          export const buildReport = (...args) => {
            const state = globalThis[${JSON.stringify(TEST_STATE_KEY)}];
            state.templateBuildCalls.push(args);
            return { title: "TEMPLATE_SENTINEL", verdict: "template fallback" };
          };
        `;
      }
      if (id === "\0keepamore-queue-client") {
        return `
          export class KeepaMoreApiError extends Error {
            constructor({
              message, code, status = 429, errorId = null,
              retryable = false, retryAfterMs = null,
            }) {
              super(message);
              this.name = "KeepaMoreApiError";
              this.code = code;
              this.status = status;
              this.errorId = errorId;
              this.retryable = retryable;
              this.retryAfterMs = retryAfterMs;
            }
          }
          export function createKeepaMoreClient(options) {
            const state = globalThis[${JSON.stringify(TEST_STATE_KEY)}];
            state.clientOptions.push(options);
            return {
              async searchProducts(request) {
                state.searchCalls.push(request);
                if (state.providerFailure) throw new KeepaMoreApiError(state.providerFailure);
                const asins = Array.isArray(state.searchPages)
                  ? (state.searchPages[request.page] || [])
                  : state.searchAsins;
                return {
                  asins,
                  query: request.term,
                  page: request.page,
                  observedAt: "2026-08-20T08:00:00.000Z",
                  sourceRef: "https://mcp.keepamore.com/api/keepa/productsearch?domain=1&term=cat+bed&page=" + request.page,
                  errors: [],
                  warnings: [],
                };
              },
              async getProducts(request) {
                state.detailCalls.push(request);
                return {
                  products: request.asins.map((asin) => ({ ...state.product, asin })),
                  errors: [],
                  warnings: [],
                  observedAt: "2026-08-20T09:00:00.000Z",
                  sourceRef: "https://mcp.keepamore.com/api/keepa/product",
                  metadata: state.quotaMetadata,
                };
              },
            };
          }
        `;
      }
      if (id === "\0keepamore-queue-settings") {
        return `export const readSecretSettings = async () => ({
          keepamore_api_key: globalThis[${JSON.stringify(TEST_STATE_KEY)}].tenantApiKey,
        });`;
      }
      if (id === "\0keepamore-queue-provider-access") {
        return `
          export const paidProviderCallsEnabled = () => globalThis[${JSON.stringify(TEST_STATE_KEY)}].paidProvidersEnabled;
          export const tenantPlanAllowsPaidProviders = (plan) => ["pro", "enterprise"].includes(plan);
        `;
      }
      if (id === "\0keepamore-queue-credits") {
        return `
          export class CreditDomainError extends Error {}
          export const debitCreditsForRule = async (input) => {
            const state = globalThis[${JSON.stringify(TEST_STATE_KEY)}];
            state.creditDebits.push(input);
            return state.creditCharge;
          };
          export const refundCreditTransaction = async (input) => {
            const state = globalThis[${JSON.stringify(TEST_STATE_KEY)}];
            state.creditRefunds.push(input);
            return { replayed: false };
          };
        `;
      }
      return null;
    },
  };
}

before(async () => {
  globalThis[TEST_ENV_KEY] = {
    KEEPAMORE_API_KEY: "",
    KEEPAMORE_BASE_URL: "https://mcp.keepamore.com/api",
  };
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
    plugins: [virtualModulePlugin()],
  });
  queueModule = await server.ssrLoadModule("/lib/research-queue.ts");
});

beforeEach(() => {
  state = {
    run: createRun(),
    tenantSettings: null,
    tenantPlan: "pro",
    tenantApiKey: "",
    paidProvidersEnabled: true,
    product: rawProduct(),
    quotaMetadata: quotaMetadata(),
    searchAsins: ["B0ABC12345"],
    providerFailure: null,
    templateBuildCalls: [],
    clientOptions: [],
    searchCalls: [],
    detailCalls: [],
    renewalCalls: 0,
    leaseRenewalFailsAt: null,
    persistedReport: null,
    creditDebits: [],
    creditRefunds: [],
    creditCharge: {
      charged: false,
      transaction: null,
      replayed: false,
      balance: 0,
      rule: { key: "research_generation", cost: 0, enabled: false },
    },
  };
  state.database = fakeDatabase();
  globalThis[TEST_STATE_KEY] = state;
  globalThis[TEST_ENV_KEY].KEEPAMORE_API_KEY = "";
  globalThis[TEST_ENV_KEY].SETTINGS_ENCRYPTION_KEY = "";
});

after(async () => {
  await server?.close();
  delete globalThis[TEST_STATE_KEY];
  delete globalThis[TEST_ENV_KEY];
});

async function execute(deliveryAttempt = 1) {
  return queueModule.executeResearchJob({
    runId: state.run.id,
    tenantId: state.run.tenant_id,
    claimedAt: state.run.updated_at,
  }, deliveryAttempt);
}

test("selected KeepaMore source fails on a missing key without building a template", async () => {
  const result = await execute();

  assert.equal(result.outcome, "failed");
  assert.match(state.run.error_message, /KeepaMore API Key 未配置/);
  assert.equal(state.searchCalls.length, 0);
  assert.equal(state.templateBuildCalls.length, 0);
  assert.equal(state.persistedReport, null);
});

test("trial tenants cannot spend the deployment's shared KeepaMore key", async (t) => {
  for (const tenantSettings of [null, "{}"]) {
    await t.test(tenantSettings ? "settings exist without encryption key" : "no tenant settings", async () => {
      state.run = createRun();
      state.tenantPlan = "trial";
      state.tenantSettings = tenantSettings;
      globalThis[TEST_ENV_KEY].KEEPAMORE_API_KEY = "km_shared_contract_test";

      const result = await execute();

      assert.equal(result.outcome, "failed");
      assert.match(state.run.error_message, /无权使用平台共享的 KeepaMore API 额度/);
      assert.equal(state.clientOptions.length, 0);
      assert.equal(state.searchCalls.length, 0);
      assert.equal(state.templateBuildCalls.length, 0);
      assert.equal(state.persistedReport, null);
    });
  }
});

test("trial tenants can use their own KeepaMore subscription without consuming the shared key", async () => {
  state.tenantPlan = "trial";
  state.tenantSettings = "{}";
  state.tenantApiKey = "km_tenant_contract_test";
  globalThis[TEST_ENV_KEY].SETTINGS_ENCRYPTION_KEY = "fixture-encryption-key";
  globalThis[TEST_ENV_KEY].KEEPAMORE_API_KEY = "km_shared_contract_test";

  const result = await execute();

  assert.equal(result.outcome, "completed");
  assert.equal(state.clientOptions.length, 1);
  assert.equal(state.clientOptions[0].apiKey, state.tenantApiKey);
  assert.equal(state.searchCalls.length, 2);
});

test("the global provider switch also blocks tenant-owned KeepaMore keys", async () => {
  state.tenantSettings = "{}";
  state.tenantApiKey = "km_tenant_contract_test";
  state.paidProvidersEnabled = false;
  globalThis[TEST_ENV_KEY].SETTINGS_ENCRYPTION_KEY = "fixture-encryption-key";

  const result = await execute();

  assert.equal(result.outcome, "failed");
  assert.match(state.run.error_message, /全局安全开关当前关闭/);
  assert.equal(state.clientOptions.length, 0);
});

test("no-subscription and quota errors fail explicitly without silent fallback", async (t) => {
  const cases = [
    {
      name: "free membership has no API subscription",
      failure: { message: "no package", code: "QUOTA_NO_SUBSCRIPTION", errorId: "quota-free-1" },
      expected: /免费会员不支持 API（QUOTA_NO_SUBSCRIPTION）/,
    },
    {
      name: "paid quota is exhausted",
      failure: { message: "daily quota", code: "QUOTA_DAY", errorId: "quota-day-1" },
      expected: /额度或限流阻止了本次研究：QUOTA_DAY · errorId=quota-day-1/,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      state = {
        ...state,
        run: createRun(),
        providerFailure: scenario.failure,
        templateBuildCalls: [],
        clientOptions: [],
        searchCalls: [],
        detailCalls: [],
        persistedReport: null,
      };
      state.database = fakeDatabase();
      globalThis[TEST_STATE_KEY] = state;
      globalThis[TEST_ENV_KEY].KEEPAMORE_API_KEY = "km_contract_test";

      const result = await execute();

      assert.equal(result.outcome, "failed");
      assert.match(state.run.error_message, scenario.expected);
      assert.equal(state.templateBuildCalls.length, 0);
      assert.equal(state.persistedReport, null);
    });
  }
});

test("successful KeepaMore evidence is handed to the full reference-report builder", async () => {
  globalThis[TEST_ENV_KEY].KEEPAMORE_API_KEY = "km_contract_test";
  state.run.research_plan.data_window_days = 180;
  state.searchAsins = Array.from({ length: 100 }, (_, index) => `B0${String(index).padStart(8, "0")}`);

  const result = await execute();

  assert.equal(result.outcome, "completed");
  assert.equal(state.searchCalls.length, 1);
  assert.equal(state.detailCalls.length, 1);
  assert.equal(state.detailCalls[0].asins.length, 100);
  assert.equal(state.detailCalls[0].stats, 180);
  assert.equal(state.detailCalls[0].history, true);
  assert.equal(state.detailCalls[0].detailLevel, "full");
  assert.equal(state.detailCalls[0].rating, true);
  assert.equal(state.detailCalls[0].buybox, true);
  assert.equal(state.templateBuildCalls.length, 0);
  assert.equal(state.persistedReport.provider, "KeepaMore API");
  assert.equal(state.persistedReport.evidence_mode, "partial_verified_research");
  assert.equal(state.persistedReport.marketplace, "Amazon US");
  assert.equal(state.persistedReport.currency, "USD");
  assert.equal(state.persistedReport.presentation_version, "reference-a4-v2");
  assert.equal(state.persistedReport.order.length, 62);
  assert.equal(state.persistedReport.reference_page_plan.length, 332);
  assert.equal(state.creditDebits.length, 1);
  assert.equal(state.creditDebits[0].businessId, "research:51:1800000000000");
  assert.equal(state.persistedReport.modules.competitive_raw_data.rows[0][1], "Washable Round Cat Bed");
  assert.doesNotMatch(JSON.stringify(state.persistedReport), /TEMPLATE_SENTINEL/);
});

test("KeepaMore search paginates and deduplicates until the 100-product research cap", async () => {
  globalThis[TEST_ENV_KEY].KEEPAMORE_API_KEY = "km_contract_test";
  const asins = Array.from({ length: 100 }, (_, index) => `B0${String(index).padStart(8, "0")}`);
  state.searchPages = Array.from({ length: 5 }, (_, page) =>
    asins.slice(page * 20, page * 20 + 20)
  );

  const result = await execute();

  assert.equal(result.outcome, "completed");
  assert.deepEqual(state.searchCalls.map((call) => call.page), [0, 1, 2, 3, 4]);
  assert.equal(state.detailCalls.length, 1);
  assert.deepEqual(state.detailCalls[0].asins, asins);
  assert.equal(state.persistedReport.research_dataset.batch_count, 5);
  assert.equal(state.persistedReport.estimated_provider_units, 125);
  assert.equal(state.persistedReport.modules.competitive_raw_data.rows.length, 100);
  assert.equal(state.persistedReport.modules.competitive_raw_data.rows[0][14], "1:1");
  assert.equal(state.persistedReport.modules.competitive_raw_data.rows[20][14], "2:1");
  assert.equal(
    state.persistedReport.modules.trust_guardrails_methodology.multi_batch_contract.raw_observations,
    100,
  );
});

test("KeepaMore pagination stops when a page adds no new ASINs", async () => {
  globalThis[TEST_ENV_KEY].KEEPAMORE_API_KEY = "km_contract_test";
  const firstPage = Array.from({ length: 20 }, (_, index) =>
    `B0${String(index).padStart(8, "0")}`
  );
  state.searchPages = [firstPage, [...firstPage], ["B099999999"]];

  const result = await execute();

  assert.equal(result.outcome, "completed");
  assert.deepEqual(state.searchCalls.map((call) => call.page), [0, 1]);
  assert.deepEqual(state.detailCalls[0].asins, firstPage);
  assert.equal(state.persistedReport.research_dataset.batch_count, 2);
  assert.equal(state.persistedReport.estimated_provider_units, 30);
});

test("a lost execution lease fences the Agent before the next paid provider stage", async () => {
  globalThis[TEST_ENV_KEY].KEEPAMORE_API_KEY = "km_contract_test";
  state.leaseRenewalFailsAt = 1;

  const result = await execute();

  assert.deepEqual(result, { outcome: "stale", runId: state.run.id });
  assert.equal(state.renewalCalls, 1);
  assert.equal(state.searchCalls.length, 0);
  assert.equal(state.detailCalls.length, 0);
  assert.equal(state.persistedReport, null);
  assert.equal(state.run.status, "executing");
  assert.equal(state.run.error_message, undefined);
});

test("retryable KeepaMore outages preserve the run and release its lease for Queue retry", async () => {
  globalThis[TEST_ENV_KEY].KEEPAMORE_API_KEY = "km_contract_test";
  state.providerFailure = {
    message: "temporary upstream outage",
    code: "HTTP_ERROR",
    status: 503,
    retryable: true,
    retryAfterMs: 5_000,
  };

  await assert.rejects(execute(), /temporary upstream outage/);

  assert.equal(state.searchCalls.length, 1);
  assert.equal(state.detailCalls.length, 0);
  assert.equal(state.run.status, "executing");
  assert.equal(state.run.error_message, undefined);
  assert.equal(state.run.failed_at, undefined);
  assert.equal(state.run.execution_lease_until < Date.now() / 1_000, true);
  assert.equal(state.persistedReport, null);
});

test("the last provider delivery fails closed and refunds the idempotent research charge", async () => {
  globalThis[TEST_ENV_KEY].KEEPAMORE_API_KEY = "km_contract_test";
  state.providerFailure = {
    message: "temporary upstream outage",
    code: "HTTP_ERROR",
    status: 503,
    retryable: true,
    retryAfterMs: 5_000,
  };
  state.creditCharge = {
    charged: true,
    transaction: {
      id: 91,
      tenant_id: 7,
      user_id: 11,
      actor_user_id: 11,
      amount: -5,
    },
    replayed: true,
    balance: 95,
    rule: { key: "research_generation", cost: 5, enabled: true },
  };

  const result = await execute(4);

  assert.deepEqual(result, { outcome: "failed", runId: 51 });
  assert.equal(state.run.status, "failed");
  assert.match(state.run.error_message, /temporary upstream outage/);
  assert.equal(state.creditRefunds.length, 1);
  assert.equal(state.creditRefunds[0].transaction.id, 91);
});

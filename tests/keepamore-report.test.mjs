import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
let keepaMoreReport;
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
  keepaMoreReport = await server.ssrLoadModule("/lib/keepamore-report.ts");
});

after(async () => {
  await server?.close();
});

function dataset() {
  return {
    keyword: "cat bed",
    marketplace: "US",
    domain: 1,
    observed_at: "2026-08-20T09:00:00.000Z",
    estimated_units: 8,
    source_urls: [
      "https://mcp.keepamore.com/api/keepa/productsearch?domain=1&term=cat+bed",
      "https://mcp.keepamore.com/api/keepa/product",
    ],
    warnings: [],
    provider_errors: [],
    quota: { remaining: 992, refill_at: null },
    products: [
      {
        asin: "B0ABC12345",
        title: "Washable Round Cat Bed",
        brand: "Acme",
        image_url: "https://images.example.test/cat-bed.jpg",
        amazon_url: "https://www.amazon.com/dp/B0ABC12345",
        current_price_usd: 29.99,
        average_price_30d_usd: 31.25,
        average_price_90d_usd: 32.5,
        sales_rank: 1250,
        sales_rank_drops_30d: 87,
        rating: 4.6,
        review_count: 1834,
        monthly_sold: 1000,
        offer_count: 4,
        buy_box_is_fba: true,
      },
      {
        asin: "B0DEF67890",
        title: "Orthopedic Cave Cat Bed",
        brand: "Beta",
        image_url: null,
        amazon_url: "https://www.amazon.com/dp/B0DEF67890",
        current_price_usd: 45,
        average_price_30d_usd: null,
        average_price_90d_usd: null,
        sales_rank: 3900,
        sales_rank_drops_30d: 42,
        rating: 4.4,
        review_count: 529,
        monthly_sold: null,
        offer_count: null,
        buy_box_is_fba: null,
      },
    ],
  };
}

test("KeepaMore evidence produces a structurally complete partial report", () => {
  const report = keepaMoreReport.buildKeepaMorePartialReport(dataset(), {
    sources: { keepamore: true },
  });

  assert.equal(report.category, "cat bed");
  assert.equal(report.marketplace, "Amazon US");
  assert.equal(report.currency, "USD");
  assert.equal(report.evidence_mode, "partial_verified_research");
  assert.equal(report.decision_readiness, "insufficient_evidence");
  assert.equal(report.verdict, "部分实证完成，关键决策待补证");
  assert.equal(report.concept_generation.eligible, false);
  assert.equal(report.report_integrity.structural_status, "complete");
  assert.equal(report.report_integrity.evidence_status, "declared_limited");
  assert.equal(report.modules.competitive_raw_data.rows.length, 2);
  assert.deepEqual(
    report.modules.competitive_raw_data.columns.slice(3, 6),
    ["当前价（USD）", "30天均价（USD）", "90天均价（USD）"],
  );
  assert.match(JSON.stringify(report), /真实 KeepaMore API 商品证据/);
  assert.doesNotMatch(JSON.stringify(report), /折叠露营椅/);
});

test("KeepaMore report converts absence into PENDING and never zero-fills", () => {
  const report = keepaMoreReport.buildKeepaMorePartialReport(dataset());
  const secondProduct = report.modules.competitive_raw_data.rows[1];
  const gap = report.modules.evidence_gap_gate;

  assert.equal(secondProduct[4], "PENDING");
  assert.equal(secondProduct[9], 529);
  assert.equal(secondProduct[10], "PENDING");
  assert.equal(gap.status, "PENDING");
  assert.match(gap.reason, /不足以形成/);
});

test("free web export is labeled as an upload and never misreported as API usage", () => {
  const imported = dataset();
  imported.acquisition = "free_export";
  imported.source_file = "cat-bed-export.xlsx";
  imported.source_urls = ["upload://keepamore/abc123/cat-bed-export.xlsx"];
  imported.estimated_units = 0;
  const report = keepaMoreReport.buildKeepaMorePartialReport(imported);
  const serialized = JSON.stringify(report);

  assert.equal(report.provider, "KeepaMore 免费网页导出");
  assert.equal(report.provider_contract, "metis.keepamore-export.v1");
  assert.equal(report.estimated_provider_units, 0);
  assert.equal(report.modules.keepamore_methodology.request.acquisition, "free_web_export");
  assert.equal(report.modules.keepamore_methodology.request.source_file, "cat-bed-export.xlsx");
  assert.match(serialized, /真实 KeepaMore 免费网页导出 商品证据/);
  assert.doesNotMatch(serialized, /真实 KeepaMore API 商品证据/);
});

test("KeepaMore report rejects an empty or invalid ASIN result", () => {
  const empty = dataset();
  empty.products = [{ ...empty.products[0], asin: "INVALID" }];
  assert.throws(
    () => keepaMoreReport.buildKeepaMorePartialReport(empty),
    /没有返回可用的 Amazon 商品记录/,
  );
});

test("USD-named evidence is rejected for non-US or contradictory marketplaces", () => {
  const nonUs = dataset();
  nonUs.marketplace = "UK";
  nonUs.domain = 2;
  assert.throws(
    () => keepaMoreReport.buildKeepaMorePartialReport(nonUs),
    /仅支持 Amazon US.*domain=1.*currency=USD/,
  );

  const contradictory = dataset();
  contradictory.marketplace = "Amazon CA";
  assert.throws(
    () => keepaMoreReport.buildKeepaMorePartialReport(contradictory),
    /marketplace=Amazon CA, domain=1/,
  );
});

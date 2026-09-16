import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
let keepaMoreReport;
let schema;
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
  [keepaMoreReport, schema] = await Promise.all([
    server.ssrLoadModule("/lib/keepamore-report.ts"),
    server.ssrLoadModule("/lib/reference-report-schema.ts"),
  ]);
});

after(async () => {
  await server?.close();
});

function product(asin, overrides = {}) {
  return {
    asin,
    title: `Cat bed ${asin}`,
    brand: null,
    image_url: null,
    amazon_url: `https://www.amazon.com/dp/${asin}`,
    current_price_usd: null,
    average_price_30d_usd: null,
    average_price_90d_usd: null,
    sales_rank: null,
    sales_rank_drops_30d: null,
    rating: null,
    review_count: null,
    monthly_sold: null,
    offer_count: null,
    buy_box_is_fba: null,
    ...overrides,
  };
}

function batch(keyword, observedAt, products, source) {
  return {
    keyword,
    marketplace: "US",
    domain: 1,
    observed_at: observedAt,
    products,
    source_urls: [source],
    estimated_units: 0,
    warnings: [],
    provider_errors: [],
    acquisition: "free_export",
    source_file: `${keyword.replaceAll(" ", "-")}.xlsx`,
  };
}

function batches() {
  return [
    batch("cat bed", "2026-08-20T09:00:00.000Z", [
      product("B0CAT00001", {
        title: "Washable indoor cat bed",
        current_price_usd: 29.99,
        rating: 4.6,
        review_count: 1800,
        search_position: 1,
      }),
      product("B0CAT00002", {
        title: "Covered cat bed",
        current_price_usd: 39.99,
        search_position: 2,
      }),
    ], "upload://keepamore/batch-1"),
    batch("cat cave", "2026-08-21T09:00:00.000Z", [
      product("B0CAT00001", {
        title: "Washable indoor cat bed - full record",
        brand: "Example Brand",
        current_price_usd: 31.99,
        average_price_30d_usd: 30.5,
        average_price_90d_usd: 32,
        sales_rank: 1200,
        rating: 4.6,
        review_count: 1800,
        monthly_sold: 1000,
        search_position: 4,
      }),
      product("B0CAT00003", {
        title: "Structured cat cave",
        current_price_usd: 49.99,
        search_position: 5,
      }),
    ], "upload://keepamore/batch-2"),
  ];
}

test("multi-batch merge deduplicates ASINs and retains every search observation", () => {
  const merged = keepaMoreReport.mergeKeepaMoreResearchDatasets(batches());

  assert.equal(merged.products.length, 3);
  assert.deepEqual(merged.queries, ["cat bed", "cat cave"]);
  assert.equal(merged.batch_count, 2);
  assert.equal(merged.source_urls.length, 2);
  const repeated = merged.products.find((item) => item.asin === "B0CAT00001");
  assert.equal(repeated.brand, "Example Brand");
  assert.equal(repeated.average_price_90d_usd, 32);
  assert.equal(repeated.observations.length, 2);
  assert.deepEqual(repeated.observations.map((item) => item.query), ["cat bed", "cat cave"]);
  assert.deepEqual(repeated.observations.map((item) => item.search_position), [1, 4]);
});

test("KeepaMore multi-batch evidence fills the complete 62-module reference report", () => {
  const report = keepaMoreReport.buildKeepaMoreReferenceReport(batches(), {
    company: "brand owner with own logistics",
  });

  assert.equal(report.board_report, true);
  assert.equal(report.evidence_mode, "partial_verified_research");
  assert.equal(report.decision_readiness, "insufficient_evidence");
  assert.equal(report.reference_page_plan.length, 332);
  assert.deepEqual(report.order, schema.REFERENCE_REPORT_MODULE_ORDER);
  assert.equal(report.order.length, 62);
  assert.equal(report.report_integrity.structural_status, "complete");
  assert.equal(report.report_integrity.evidence_status, "declared_limited");
  assert.equal(report.report_integrity.page_contract.source_resolved_required_blocks, 359);
  report.order.forEach((moduleId) => assert.ok(report.modules[moduleId], moduleId));

  assert.equal(report.research_dataset.unique_asins, 3);
  assert.equal(report.research_dataset.batch_count, 2);
  assert.deepEqual(report.research_dataset.queries, ["cat bed", "cat cave"]);
  assert.equal(report.modules.competitive_raw_data.rows.length, 3);
  assert.ok(report.modules.MKT_STRUCT.keepamore_market_structure.brand_presence.rows.some(
    (row) => row[0] === "Example Brand" && row[1] === 1,
  ));
  assert.equal(report.modules.decision_funnel.final.score, null);
  assert.equal(report.modules.decision_funnel.evidence_state.status, "PENDING");
  assert.equal(report.modules.output_unit_economics_finance.evidence_state.status, "PENDING");
  assert.equal(report.modules.pd_concept_matrix.product_concept.status, "BLOCKED");
  assert.equal(report.concept_generation.eligible, false);
});

test("aggregate ratings never become fabricated VOC or a product decision", () => {
  const report = keepaMoreReport.buildKeepaMoreReferenceReport(batches());
  const serialized = JSON.stringify(report);

  assert.equal(report.modules.voc_evidence.evidence_log.rows.length, 0);
  assert.equal(report.modules.voc_evidence.aggregate_field_boundary.coded_review_text_count, 0);
  assert.equal(report.modules.MIND_DECODE.evidence_state.status, "PENDING");
  assert.match(serialized, /评分与评论数聚合字段不得/);
  assert.match(serialized, /INSUFFICIENT_EVIDENCE/);
  assert.doesNotMatch(serialized, /Arc-Rhythm Charge 24|静音真抽屉|LURÖY|排骨条滑落|B0DB142C6Y/);
});

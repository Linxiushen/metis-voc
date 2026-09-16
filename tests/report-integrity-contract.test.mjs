import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
let server;
let reports;
let integrity;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
  });
  reports = await server.ssrLoadModule("/lib/board-reports.ts");
  integrity = await server.ssrLoadModule("/lib/report-integrity.ts");
});

after(async () => {
  await server?.close();
});

test("all five canonical reports bind every required module and page block", () => {
  assert.equal(reports.boardReportSeeds.length, 5);
  for (const seed of reports.boardReportSeeds) {
    const audit = integrity.inspectReportIntegrity(seed.report);
    assert.equal(seed.version, "2026-08-06.2-report-integrity", seed.slug);
    assert.equal(audit.structural_status, "complete", seed.slug);
    assert.equal(audit.required_module_count, 62, seed.slug);
    assert.equal(audit.populated_module_count, 62, seed.slug);
    assert.deepEqual(
      audit.page_contract,
      {
        validation_scope: "backend_source_path_resolution",
        render_status: "not_evaluated",
        expected_pages: 332,
        actual_pages: 332,
        required_blocks: 359,
        source_resolved_required_blocks: 359,
      },
      seed.slug,
    );
    assert.equal(audit.errors.length, 0, seed.slug);
    assert.equal(seed.report.report_integrity.contract_version, integrity.REPORT_INTEGRITY_CONTRACT_VERSION);
  }
});

test("a missing canonical module is rejected before persistence", () => {
  const report = structuredClone(reports.boardReportSeeds[0].report);
  delete report.modules.MKT_STRUCT;
  assert.throws(
    () => integrity.finalizeReportForPersistence(report),
    (error) => {
      assert.equal(error.name, "ReportIntegrityError");
      assert.ok(error.integrity.errors.some((item) =>
        item.code === "MISSING_REQUIRED_MODULE_DATA" && item.path === "modules.MKT_STRUCT"
      ));
      return true;
    },
  );
});

test("an unresolvable required source path is rejected with its page and block id", () => {
  const report = structuredClone(reports.boardReportSeeds[0].report);
  const page = report.reference_page_plan.find((item) => item.page === 14);
  const block = page.reference_blocks.find((item) => item.required === true);
  block.source_paths = ["modules.OP_SCAN.nonexistent_payload"];
  assert.throws(
    () => integrity.finalizeReportForPersistence(report),
    (error) => {
      const missing = error.integrity.missing_required_blocks.find((item) => item.page === 14);
      assert.ok(missing);
      assert.equal(missing.block_id, block.id);
      assert.deepEqual(missing.tried_source_paths, ["modules.OP_SCAN.nonexistent_payload"]);
      return true;
    },
  );
});

test("corrupt JSON and old incomplete dynamic reports return diagnostics instead of throwing on ordinary view", () => {
  const corrupt = integrity.reportForDiagnosticDelivery("{not-json");
  assert.equal(corrupt.report_unavailable, true);
  assert.equal(corrupt.report_integrity.status, "incomplete");
  assert.equal(corrupt.report_integrity.errors[0].code, "REPORT_NOT_OBJECT");

  const legacy = integrity.reportForDiagnosticDelivery({
    category: "Legacy category",
    marketplace: "Amazon US",
    evidence_mode: "template_demo",
    decision_readiness: "insufficient_evidence",
    order: ["market"],
    modules: { market: {} },
  });
  assert.equal(legacy.report_integrity.status, "incomplete");
  assert.ok(legacy.report_integrity.errors.some((item) => item.code === "MISSING_REQUIRED_MODULE_DATA"));
});

test("missing real evidence is declared and never replaced with invented market values", () => {
  const report = {
    category: "Future category",
    marketplace: "Amazon US",
    evidence_mode: "verified_research",
    decision_readiness: "ready_for_review",
    order: ["market_size"],
    modules: {
      market_size: {
        status: "UNAVAILABLE",
        reason: "付费市场数据 API 尚未接入。",
        required_inputs: ["同口径销售额", "至少 24 个月连续时序"],
      },
    },
  };
  const finalized = integrity.finalizeReportForPersistence(report);
  assert.equal(finalized.report_integrity.status, "complete_with_declared_gaps");
  assert.equal(finalized.data_availability.declared_gaps.length, 1);
  assert.equal(finalized.data_availability.declared_gaps[0].state, "unavailable");
  assert.deepEqual(finalized.modules.market_size.required_inputs, ["同口径销售额", "至少 24 个月连续时序"]);
  for (const field of ["tam", "sales", "growth_rate", "market_share", "forecast"]) {
    assert.equal(Object.hasOwn(finalized.modules.market_size, field), false, field);
  }
});

test("directory and display metadata repairs are deterministic and contain no market facts", () => {
  const report = structuredClone(reports.boardReportSeeds[0].report);
  delete report.order;
  delete report.title;
  delete report.ext_meta.OP_SCAN;
  delete report.modules.market_signal;
  const finalized = integrity.finalizeReportForPersistence(report);
  assert.deepEqual(finalized.order, finalized.reference_layout.module_order);
  assert.match(finalized.title, /^董事会研究｜/);
  assert.equal(finalized.modules.market_signal, finalized.modules.OP_SCAN.market_signal);
  assert.ok(finalized.report_integrity.repairs.includes("order"));
  assert.ok(finalized.report_integrity.repairs.includes("title"));
  assert.ok(finalized.report_integrity.repairs.includes("ext_meta.OP_SCAN"));
  assert.ok(finalized.report_integrity.repairs.includes("modules.market_signal"));
});

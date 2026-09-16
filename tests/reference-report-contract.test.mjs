import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
let server;
let reports;
let schema;
let framework;
let pagePlan;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
  });
  [reports, schema, framework, pagePlan] = await Promise.all([
    server.ssrLoadModule("/lib/board-reports.ts"),
    server.ssrLoadModule("/lib/reference-report-schema.ts"),
    server.ssrLoadModule("/lib/board-framework-v2.ts"),
    server.ssrLoadModule("/lib/reference-page-plan.ts"),
  ]);
});

after(async () => {
  await server?.close();
});

test("canonical order matches the original 62-module report", () => {
  const expectedCore = [
    "exec_summary_decision_scorecard",
    "decision_funnel",
    "OP_SCAN",
    "MKT_STRUCT",
    "MIND_DECODE",
    "voc_evidence",
    "competitor_teardown",
    "CPT_VERIFY",
    "output_unit_economics_finance",
    "gtm_plan",
  ];
  assert.equal(schema.REFERENCE_REPORT_MODULE_ORDER.length, 62);
  assert.deepEqual(schema.REFERENCE_REPORT_MODULE_ORDER.slice(0, 10), expectedCore);
  assert.deepEqual(
    schema.REFERENCE_REPORT_MODULE_ORDER.slice(10, 60),
    framework.PDF_DEEP_MODULE_ORDER,
  );
  assert.deepEqual(schema.REFERENCE_REPORT_MODULE_ORDER.slice(60), [
    "risk_register_sensitivity_confidence",
    "trust_guardrails_methodology",
  ]);
});

test("reference page spans cover pages 7 through 332 without gaps", () => {
  const expectedStarts = [
    7, 11, 14, 18, 25, 31, 34, 38, 41, 47, 52, 67, 76, 82, 89, 97,
    104, 112, 119, 127, 134, 141, 149, 154, 161, 167, 174, 179, 186,
    194, 200, 206, 213, 219, 227, 234, 241, 248, 255, 260, 266, 272,
    277, 284, 291, 293, 296, 298, 301, 303, 304, 307, 309, 311, 313,
    315, 317, 318, 320, 322, 323, 327,
  ];
  const spans = schema.REFERENCE_REPORT_MODULE_PAGE_SPANS;
  assert.deepEqual(schema.REFERENCE_REPORT_MODULE_START_PAGES, expectedStarts);
  assert.equal(spans.length, 62);
  assert.equal(spans[0].start_page, 7);
  assert.equal(spans.at(-1).end_page, 332);
  spans.forEach((span, index) => {
    assert.equal(span.reference_number, index + 1);
    assert.equal(span.module_id, schema.REFERENCE_REPORT_MODULE_ORDER[index]);
    assert.equal(span.page_count, span.end_page - span.start_page + 1);
    if (index > 0) assert.equal(span.start_page, spans[index - 1].end_page + 1);
  });
  assert.equal(
    spans.reduce((total, span) => total + span.page_count, 0),
    326,
  );
  assert.equal(schema.REFERENCE_REPORT_LAYOUT.front_matter_pages + 326, 332);
});

test("all five reports implement the canonical order and retain grounded data", () => {
  assert.equal(reports.boardReportSeeds.length, 5);
  for (const seed of reports.boardReportSeeds) {
    const report = seed.report;
    assert.deepEqual(report.order, schema.REFERENCE_REPORT_MODULE_ORDER, seed.slug);
    assert.equal(report.schema_version, "metis.report.v4", seed.slug);
    assert.equal(report.presentation_version, "reference-a4-v2", seed.slug);
    assert.equal(report.reference_layout.contract_version, "metis.reference-report.a4-landscape.332.v4", seed.slug);
    assert.equal(report.reference_layout.total_pages, 332, seed.slug);
    assert.equal(report.reference_page_plan.length, 332, seed.slug);
    assert.deepEqual(report.reference_page_plan, pagePlan.REFERENCE_PAGE_PLAN, seed.slug);
    assert.equal(Object.keys(report.ext_meta).length, 62, seed.slug);
    for (const moduleId of report.order) {
      assert.ok(report.modules[moduleId], `${seed.slug}: missing ${moduleId}`);
    }
    assert.ok(report.modules.voc_evidence.evidence_log.rows.length > 0, seed.slug);
    assert.equal(
      report.modules.voc_evidence.evidence_log.rows.length,
      report.modules.voc_raw_data.evidence_log.rows.length,
      seed.slug,
    );
    assert.ok(!report.order.some((moduleId) => moduleId.startsWith("aigc_")), seed.slug);
    assert.ok(!report.order.includes("board_decision"), seed.slug);
    assert.ok(!report.order.includes("board_concept"), seed.slug);
  }
});

test("AIGC concept and design material is embedded in modules 25 and 49", () => {
  for (const seed of reports.boardReportSeeds) {
    const conceptMatrix = seed.report.modules.pd_concept_matrix;
    const problemSolver = seed.report.modules.problem_solver_concept;
    assert.equal(conceptMatrix.product_concept.image_url, seed.report.modules.board_concept.image_url);
    assert.ok(conceptMatrix.aigc_concept_portfolio);
    assert.ok(conceptMatrix.aigc_design_system);
    assert.ok(conceptMatrix.aigc_design_review_pack);
    assert.ok(conceptMatrix.aigc_quality_audit);
    assert.ok(problemSolver.aigc_grounded_synthesis);
    assert.ok(problemSolver.aigc_listing_blueprint);
    assert.ok(problemSolver.aigc_redteam_validation);
  }
});

test("the page plan gives every one of the 332 pages a non-empty topic", () => {
  const pages = pagePlan.REFERENCE_PAGE_PLAN;
  const body = pagePlan.REFERENCE_BODY_PAGE_PLAN;
  const validRoles = new Set([
    "cover", "contents", "analysis", "section_intro",
    "section_intro_callout", "shared_transition", "outgoing_teaser",
  ]);
  const validLayouts = new Set([
    "cover", "toc_list", "single_visual", "split_visual",
    "dashboard", "transition", "section_intro",
  ]);
  assert.equal(pages.length, 332);
  assert.equal(body.length, 326);
  pages.forEach((page, index) => {
    assert.equal(page.page, index + 1);
    assert.ok(page.title.trim(), `page ${page.page}: empty title`);
    assert.ok(page.topic.trim(), `page ${page.page}: empty topic`);
    assert.ok(page.research_question.trim(), `page ${page.page}: empty question`);
    assert.ok(validRoles.has(page.role), `page ${page.page}: invalid role ${page.role}`);
    assert.ok(validLayouts.has(page.layout), `page ${page.page}: invalid layout ${page.layout}`);
    assert.ok(page.reference_blocks.length > 0, `page ${page.page}: no required reference block`);
    page.reference_blocks.forEach((block) => {
      assert.ok(block.id.trim(), `page ${page.page}: reference block without id`);
      assert.ok(block.title.trim(), `page ${page.page}: reference block without title`);
      assert.ok(block.visual.trim(), `page ${page.page}: reference block without visual`);
      assert.ok(block.source_paths.length > 0, `page ${page.page}: reference block without source path`);
      assert.equal(block.required, true, `page ${page.page}: reference block not required`);
      assert.equal(block.origin, "reference", `page ${page.page}: invalid reference origin`);
    });
    page.augmentation_blocks.forEach((block) => {
      assert.ok(block.id.trim(), `page ${page.page}: augmentation block without id`);
      assert.ok(block.visual.trim(), `page ${page.page}: augmentation block without visual`);
      assert.ok(block.source_paths.length > 0, `page ${page.page}: augmentation block without source path`);
      assert.equal(block.required, false, `page ${page.page}: augmentation cannot be required`);
      assert.ok(["voc", "aigc", "strategy"].includes(block.origin), `page ${page.page}: invalid augmentation origin`);
    });
  });
  assert.equal(body[0].page, 7);
  assert.equal(body.at(-1).page, 332);
});

test("contents pages preserve the source PDF's exact module ranges", () => {
  assert.deepEqual(
    pagePlan.REFERENCE_PAGE_PLAN.slice(1, 6).map((page) => page.title),
    [
      "目录 1 / 5 · 模块 1–14",
      "目录 2 / 5 · 模块 15–30",
      "目录 3 / 5 · 模块 31–46",
      "目录 4 / 5 · 模块 47–61",
      "目录 5 / 5 · 模块 62",
    ],
  );
});

test("each module receives exactly its reference PDF page count", () => {
  for (const span of schema.REFERENCE_REPORT_MODULE_PAGE_SPANS) {
    const pages = pagePlan.REFERENCE_BODY_PAGE_PLAN.filter(
      (page) => page.module_id === span.module_id,
    );
    assert.equal(pages.length, span.page_count, span.module_id);
    assert.equal(pages[0].page, span.start_page, span.module_id);
    assert.equal(pages.at(-1).page, span.end_page, span.module_id);
    assert.equal(pagePlan.REFERENCE_MODULE_PAGE_TOPICS[span.module_id].length, span.page_count);
  }
});

test("shared transition pages preserve the original PDF module anchors without overlap", () => {
  const expectedPages = [11, 18, 34, 41, 47, 82, 154, 174, 186, 234, 277, 309, 322, 327];
  assert.deepEqual(
    schema.REFERENCE_REPORT_SHARED_TRANSITIONS.map((transition) => transition.page),
    expectedPages,
  );
  for (const transition of schema.REFERENCE_REPORT_SHARED_TRANSITIONS) {
    const page = pagePlan.REFERENCE_PAGE_PLAN_BY_NUMBER[transition.page];
    const toSpan = schema.REFERENCE_REPORT_MODULE_PAGE_SPANS_BY_ID[transition.to_module_id];
    const fromSpan = schema.REFERENCE_REPORT_MODULE_PAGE_SPANS_BY_ID[transition.from_module_id];
    assert.equal(page.transition, transition, `page ${transition.page}`);
    assert.equal(page.role, "shared_transition", `page ${transition.page}`);
    assert.equal(page.layout, "transition", `page ${transition.page}`);
    if (transition.page_owner === "to_module") {
      assert.equal(page.module_id, transition.to_module_id, `page ${transition.page}`);
      assert.equal(page.page_in_module, 1, `page ${transition.page}`);
      assert.equal(toSpan.start_page, transition.page, transition.to_module_id);
      assert.equal(fromSpan.end_page, transition.page - 1, transition.from_module_id);
    } else {
      assert.equal(page.module_id, transition.from_module_id, `page ${transition.page}`);
      assert.equal(page.page_in_module, fromSpan.page_count, `page ${transition.page}`);
      assert.equal(fromSpan.end_page, transition.page, transition.from_module_id);
      assert.equal(toSpan.start_page, transition.page + 1, transition.to_module_id);
    }
    assert.match(page.title, new RegExp(transition.carryover_title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(page.title, new RegExp(transition.module_anchor_title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("critical pages retain the source report's required visual blocks", () => {
  const expected = new Map([
    [7, [["decision_hero", "decision_hero"], ["executive_kpi_dashboard", "kpi_dashboard"]]],
    [11, [["assumptions_table", "data_table"], ["decision_funnel_anchor", "callout"]]],
    [18, [["opportunity_sensitivity", "scenario_table"], ["market_structure_anchor", "callout"]]],
    [31, [["voc_whitespace_ranking", "horizontal_bar"], ["voc_negative_aspect_ranking", "horizontal_bar"]]],
    [34, [["voc_weighted_rollup", "data_table"], ["competitor_teardown_anchor", "callout"]]],
    [41, [["candidate_sensitivity", "data_table"], ["candidate_release_decision", "verdict_callout"], ["finance_anchor", "callout"]]],
    [47, [["pricing_scenarios", "data_table"], ["gtm_anchor", "callout"]]],
    [52, [["seller_account_health", "kpi_cards"]]],
    [82, [["ip_risk_summary", "gauge_bar_kpis"], ["ppc_traffic_mix", "bar_dashboard"], ["ppc_anchor", "callout"]]],
    [154, [["moat_conclusion", "verdict_callout"], ["conjoint_anchor", "callout"], ["attribute_importance", "horizontal_bar"]]],
    [161, [["concept_score_matrix", "data_table"]]],
    [162, [["concept_score_heatmap", "heatmap"]]],
    [163, [["feature_benefit_evidence", "data_table"]]],
    [164, [["cost_differentiation_scatter", "regression_scatter"]]],
    [165, [["ip_design_around", "data_table"]]],
    [166, [["concept_feasibility_radar", "radar"], ["concept_freeze_decision", "verdict_callout"]]],
    [174, [["quality_close", "verdict_callout"], ["sensitivity_anchor", "callout"], ["sensitivity_kpis", "kpi_cards"]]],
    [186, [["monte_carlo_close", "verdict_callout"], ["unit_economics_anchor", "callout"], ["unit_economics_kpis", "kpi_cards"]]],
    [234, [["evidence_audit_close", "verdict_callout"], ["market_size_anchor", "callout"], ["tam_sam_som_table", "data_table"]]],
    [277, [["keyword_strategy_close", "verdict_callout"], ["ad_structure_anchor", "callout"], ["ad_budget_bars", "horizontal_bar"]]],
    [301, [["problem_solver_concept", "concept_comparison"]]],
    [302, [["concept_scorecard", "kpi_cards"], ["concept_upgrade_ranking", "horizontal_bar"]]],
    [309, [["strategy_close", "kpi_cards"], ["ev_anchor", "callout"], ["ev_decision_table", "data_table"]]],
    [327, [["critical_assumptions", "data_table"], ["trust_anchor", "callout"]]],
    [328, [["trust_guardrail_chain", "data_table"], ["trust_traceability", "donut"]]],
    [332, [["trust_methodology_grid", "method_cards"], ["trust_limitations", "warning_list"]]],
  ]);
  for (const [number, blocks] of expected) {
    const page = pagePlan.REFERENCE_PAGE_PLAN_BY_NUMBER[number];
    assert.deepEqual(
      page.reference_blocks.map((block) => [block.id.replace(`reference.p${number}.`, ""), block.visual]),
      blocks,
      `page ${number}`,
    );
  }
});

test("VOC, AIGC, and strategy additions remain optional and cannot replace reference blocks", () => {
  const referenceIds = new Set();
  const augmentationIds = new Set();
  for (const page of pagePlan.REFERENCE_PAGE_PLAN) {
    for (const block of page.reference_blocks) {
      assert.ok(!referenceIds.has(block.id), `duplicate reference id ${block.id}`);
      referenceIds.add(block.id);
    }
    for (const block of page.augmentation_blocks) {
      assert.ok(!augmentationIds.has(block.id), `duplicate augmentation id ${block.id}`);
      assert.ok(!referenceIds.has(block.id), `augmentation replaced ${block.id}`);
      augmentationIds.add(block.id);
    }
  }
  assert.deepEqual(
    pagePlan.REFERENCE_PAGE_PLAN_BY_NUMBER[31].augmentation_blocks.map((block) => block.origin),
    ["voc"],
  );
  for (const number of [162, 163, 164, 165, 166, 301, 302]) {
    assert.ok(
      pagePlan.REFERENCE_PAGE_PLAN_BY_NUMBER[number].augmentation_blocks.every((block) => block.origin === "aigc"),
      `page ${number}`,
    );
  }
  const strategyContracts = new Map([
    [10, ["strategy_action_register", "data_table", "modules.exec_summary_decision_scorecard.action_items"]],
    [25, ["strategy_jtbd", "data_table", "modules.MIND_DECODE.jtbd"]],
    [26, ["consumer_psychology_readiness", "heatmap", "modules.MIND_DECODE.consumer_psychology.psychology_evidence_readiness"]],
    [28, ["behavior_mechanism_flow", "sankey", "modules.MIND_DECODE.consumer_psychology.behavior_mechanism_flow"]],
    [29, ["customer_journey_flow", "sankey", "modules.MIND_DECODE.customer_journey.journey_flow"]],
    [51, ["strategy_action_register", "data_table", "modules.gtm_plan.action_items"]],
    [291, ["strategy_stp_overview", "insight_cards", "modules.market_map_segment_grade.stp"]],
    [292, ["strategy_stp_segmentation", "data_table", "modules.market_map_segment_grade.stp.segmentation"]],
    [293, ["strategy_stp_targeting_matrix", "data_table", "modules.market_map_segment_grade.stp.targeting.candidate_matrix"]],
    [294, ["strategy_stp_target_selection", "data_table", "modules.market_map_segment_grade.stp.targeting.selection"]],
    [295, ["strategy_stp_positioning", "insight_cards", "modules.market_map_segment_grade.stp.positioning"]],
    [318, ["strategy_bcg_matrix", "data_table", "modules.portfolio_correlation.bcg_matrix"]],
    [319, ["strategy_bcg_capital_actions", "kpi_cards", "modules.portfolio_correlation.bcg_matrix.portfolio_actions"]],
  ]);
  for (const [number, [suffix, visual, sourcePath]] of strategyContracts) {
    const page = pagePlan.REFERENCE_PAGE_PLAN_BY_NUMBER[number];
    const block = page.augmentation_blocks.find((item) => item.origin === "strategy");
    assert.ok(block, `page ${number}: missing strategy augmentation`);
    assert.equal(block.id, `augmentation.p${number}.${suffix}`, `page ${number}`);
    assert.equal(block.visual, visual, `page ${number}`);
    assert.equal(block.required, false, `page ${number}`);
    assert.equal(block.placement, "sidecar", `page ${number}`);
    assert.ok(block.source_paths.includes(sourcePath), `page ${number}: missing ${sourcePath}`);
    assert.ok(page.reference_blocks.every((item) => item.required && item.origin === "reference"), `page ${number}: reference contract replaced`);
  }
  for (const [number, sourcePath] of [
    [27, "modules.MIND_DECODE.consumer_psychology.value_risk_signal_map"],
    [30, "modules.MIND_DECODE.customer_journey.touchpoint_pain_heatmap"],
  ]) {
    const block = pagePlan.REFERENCE_PAGE_PLAN_BY_NUMBER[number].augmentation_blocks.find((item) => item.origin === "voc");
    assert.ok(block, `page ${number}: missing VOC augmentation`);
    assert.ok(block.source_paths.includes(sourcePath), `page ${number}: missing ${sourcePath}`);
    assert.equal(block.required, false, `page ${number}: VOC sidecar must remain optional`);
  }
});

test("required pages never use generic fallback copy", () => {
  const requiredText = pagePlan.REFERENCE_PAGE_PLAN
    .flatMap((page) => [page.title, page.topic, ...page.reference_blocks.map((block) => block.title)])
    .join("\n");
  assert.doesNotMatch(requiredText, /framework[- ]fallback|分析覆盖摘要|待补充页|通用分析页|generic fallback/i);
  assert.ok(pagePlan.REFERENCE_BODY_PAGE_PLAN.every((page) => page.topic_source !== "framework-fallback"));
});

test("page topics contain no legacy product, ASIN, or numeric claims", () => {
  const text = pagePlan.REFERENCE_BODY_PAGE_PLAN
    .flatMap((page) => [page.module_title, page.title, page.topic, page.research_question])
    .join("\n");
  assert.doesNotMatch(text, /\bB0[A-Z0-9]{5,}\b/i);
  assert.doesNotMatch(text, /美式压木纹床头柜|MDF\s*Nightstand|Nightstands?/i);
  assert.doesNotMatch(text, /折叠露营椅|Camping\s*Chair|加宽椅脚|加宽抽屉滑轨|单椅/i);
  assert.doesNotMatch(text, /\$(?:25|40|60|69\.99|79\.99|90|95|99\.99|109\.99|120|130|150|159\.9|180)/);
  assert.doesNotMatch(text, /\b(?:8842|9013|8771|2450|1380|2975(?:\.42)?)\b/);
});

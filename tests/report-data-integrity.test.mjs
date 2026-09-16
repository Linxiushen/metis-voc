import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const VERSION = "2026-08-06.2-report-integrity";
let server;
let reports;

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
});

after(async () => {
  await server?.close();
});

const seedFor = (slug) => {
  const seed = reports.boardReportSeeds.find((item) => item.slug === slug);
  assert.ok(seed, `missing report seed: ${slug}`);
  return seed;
};

const usd = (value) => {
  const parsed = Number(String(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0]);
  assert.ok(Number.isFinite(parsed), `invalid USD value: ${value}`);
  return parsed;
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  assert.ok(sorted.length > 0);
  const middle = Math.floor(sorted.length / 2);
  const result = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return Number(result.toFixed(2));
};

const rowByFirstCell = (table, label) => {
  const row = table.rows.find((item) => item[0] === label);
  assert.ok(row, `missing row: ${label}`);
  return row;
};

test("report version is fixed and runtime payload has no legacy category metadata", () => {
  assert.equal(reports.boardReportSeeds.length, 5);
  for (const seed of reports.boardReportSeeds) {
    assert.equal(seed.version, VERSION, seed.slug);
    assert.equal(seed.report.report_version, VERSION, seed.slug);
    assert.doesNotMatch(
      JSON.stringify(seed.report),
      /折叠露营椅|露营椅|单椅|加宽椅脚|\$25-40/,
      seed.slug,
    );
  }
});

test("all five reports carry one traceable JTBD, STP, BCG, and 90-day execution contract", () => {
  let sharedManagementMatrix;
  for (const seed of reports.boardReportSeeds) {
    const modules = seed.report.modules;
    const strategy = modules.strategy_frameworks;
    assert.equal(seed.report.strategy_framework_version, "2026-08-06.1-psychology-journey", seed.slug);
    assert.deepEqual(modules.MIND_DECODE.jtbd, strategy.jtbd, `${seed.slug}: JTBD source`);
    assert.deepEqual(modules.MKT_STRUCT.stp, strategy.stp, `${seed.slug}: STP source`);
    assert.deepEqual(modules.segment_grade_matrix.stp, strategy.stp, `${seed.slug}: STP segment view`);
    assert.deepEqual(modules.market_map_segment_grade.stp, strategy.stp, `${seed.slug}: STP map view`);
    assert.deepEqual(modules.gtm_plan.positioning, strategy.stp.positioning, `${seed.slug}: positioning source`);

    const jobs = strategy.jtbd.jobs;
    assert.ok(Array.isArray(jobs.rows) && jobs.rows.length >= 3, `${seed.slug}: JTBD rows`);
    const jobTypes = jobs.rows.map((row) => row[1]);
    assert.ok(jobTypes.includes("功能任务"), `${seed.slug}: functional job`);
    assert.ok(jobTypes.includes("情绪任务"), `${seed.slug}: emotional job`);
    assert.ok(jobTypes.includes("社交任务"), `${seed.slug}: social job`);
    assert.ok(jobs.rows.every((row) => row.slice(0, 8).every(Boolean)), `${seed.slug}: complete JTBD`);
    const jobContracts = strategy.jtbd.job_contracts;
    assert.equal(jobContracts.length, 3, `${seed.slug}: explicit JTBD contracts`);
    assert.ok(jobContracts.every((contract) => contract.evidence_strategy === "EXPLICIT_CATEGORY_JOB_CONTRACT"), `${seed.slug}: explicit evidence strategy`);
    assert.ok(jobContracts.every((contract) => contract.evidence_ids.length > 0 && contract.missing_evidence_ids.length === 0), `${seed.slug}: evidence ids resolve`);
    assert.equal(new Set(jobContracts.map((contract) => contract.protocol.method)).size, 3, `${seed.slug}: distinct protocols`);
    const functional = jobContracts.find((contract) => contract.job_type === "功能任务");
    const emotional = jobContracts.find((contract) => contract.job_type === "情绪任务");
    const social = jobContracts.find((contract) => contract.job_type === "社交任务");
    assert.match(functional.protocol.method, /实体|任务/, `${seed.slug}: functional protocol`);
    assert.match(emotional.protocol.method, /访谈|日记/, `${seed.slug}: emotional protocol`);
    assert.match(social.protocol.method, /盲测/, `${seed.slug}: social protocol`);
    assert.doesNotMatch(`${emotional.protocol.method} ${social.protocol.method}`, /循环|静载|跌落|承重|运输测试/, `${seed.slug}: no engineering proxy for emotional/social jobs`);
    for (const contract of jobContracts) {
      const row = jobs.rows.find((item) => item[1] === contract.job_type);
      assert.match(row[6], new RegExp(contract.id), `${seed.slug}: job evidence contract is explicit`);
      assert.ok(row[7].includes(contract.protocol.method), `${seed.slug}: job protocol is explicit`);
    }

    const segments = strategy.stp.segmentation.segments;
    assert.deepEqual(
      strategy.stp.segmentation.validity_gates.rows.map((row) => row[0]),
      ["可触达", "可区分", "可行动", "可测量", "足够大"],
      `${seed.slug}: STP validity gates follow the cited ADAMS criteria`,
    );
    assert.ok(segments.length >= 3, `${seed.slug}: segment count`);
    assert.equal(segments.filter((segment) => segment.status === "PRIMARY").length, 1, `${seed.slug}: primary target`);
    assert.equal(segments.filter((segment) => segment.status === "SECONDARY").length, 1, `${seed.slug}: secondary target`);
    assert.ok(segments.some((segment) => segment.status === "EXCLUDED"), `${seed.slug}: explicit exclusion`);
    assert.ok(new Set(segments.map((segment) => segment.id)).size === segments.length, `${seed.slug}: segment ids`);
    const stpEvidenceContracts = strategy.stp.segmentation.evidence_contracts;
    assert.equal(stpEvidenceContracts.length, segments.length, `${seed.slug}: one STP evidence contract per segment`);
    assert.deepEqual(
      new Set(stpEvidenceContracts.map((contract) => contract.segment_id)),
      new Set(segments.map((segment) => segment.id)),
      `${seed.slug}: STP evidence contract coverage`,
    );
    assert.equal(new Set(stpEvidenceContracts.map((contract) => contract.id)).size, segments.length, `${seed.slug}: unique STP contract ids`);
    assert.equal(new Set(stpEvidenceContracts.map((contract) => JSON.stringify(contract.evidence_ids))).size, segments.length, `${seed.slug}: independent STP evidence bindings`);
    assert.ok(stpEvidenceContracts.every((contract) => contract.evidence_ids.length > 0 && contract.missing_evidence_ids.length === 0), `${seed.slug}: STP evidence ids resolve`);
    for (const contract of stpEvidenceContracts) {
      const segmentRow = strategy.stp.segmentation.matrix.rows.find((row) => row[0] === contract.segment_id);
      const targetRow = strategy.stp.targeting.candidate_matrix.rows.find((row) => row[0] === contract.segment_id);
      assert.ok(segmentRow[8].includes(contract.id), `${seed.slug}: segment row binds its evidence contract`);
      assert.ok(targetRow[4].includes(contract.id), `${seed.slug}: target row binds its evidence contract`);
    }
    assert.ok(strategy.stp.positioning.positioning_statement.includes("面向"), `${seed.slug}: positioning statement`);
    assert.ok(strategy.stp.positioning.reasons_to_believe.length >= 3, `${seed.slug}: reasons to believe`);
    assert.equal(strategy.stp.targeting.hypothesis_label, "MANAGEMENT-HYPOTHESIS", `${seed.slug}: targeting hypothesis label`);
    assert.ok(strategy.stp.targeting.candidate_matrix.rows.every((row) => String(row[2]).startsWith("MANAGEMENT-HYPOTHESIS｜")), `${seed.slug}: attractiveness is a hypothesis`);
    assert.equal(strategy.stp.positioning.price_test_range_hypothesis.status, "MANAGEMENT-HYPOTHESIS", `${seed.slug}: price test hypothesis`);
    assert.match(strategy.stp.positioning.price_band, /^MANAGEMENT-HYPOTHESIS｜/, `${seed.slug}: compatibility price label`);

    const bcg = modules.portfolio_correlation.bcg_matrix;
    assert.deepEqual(bcg, strategy.bcg, `${seed.slug}: BCG source`);
    assert.equal(bcg.classic_input_gate.status, "PENDING", `${seed.slug}: classic BCG status`);
    assert.equal(bcg.classic_input_gate.market_growth_rate, null, `${seed.slug}: no invented growth`);
    assert.equal(bcg.classic_input_gate.relative_market_share, null, `${seed.slug}: no invented relative share`);
    assert.equal(bcg.classic_input_gate.quadrant, "PENDING", `${seed.slug}: no invented quadrant`);
    assert.equal(bcg.entries.length, 5, `${seed.slug}: five classic BCG category rows`);
    assert.deepEqual(bcg.classic_input_gate.category_rows, bcg.entries, `${seed.slug}: classic gate owns category rows`);
    assert.equal(bcg.entries.filter((entry) => entry.is_current_category).length, 1, `${seed.slug}: one current BCG category`);
    for (const entry of bcg.entries) {
      assert.equal(entry.status, "PENDING", `${seed.slug}: ${entry.category} classic status`);
      assert.equal(entry.market_growth_rate, null, `${seed.slug}: ${entry.category} growth pending`);
      assert.equal(entry.relative_market_share, null, `${seed.slug}: ${entry.category} share pending`);
      assert.equal(entry.quadrant, "PENDING", `${seed.slug}: ${entry.category} quadrant pending`);
      assert.equal(entry.capital_action, "PENDING", `${seed.slug}: ${entry.category} capital action pending`);
      assert.equal(entry.market_growth_formula, bcg.classic_input_gate.market_growth_formula, `${seed.slug}: ${entry.category} growth formula`);
      assert.equal(entry.relative_market_share_formula, bcg.classic_input_gate.relative_market_share_formula, `${seed.slug}: ${entry.category} share formula`);
    }
    assert.match(bcg.attractiveness_capability_matrix.note, /不是经典 BCG.*不得.*真实增长率.*相对市场份额/, `${seed.slug}: management matrix warning`);
    assert.doesNotMatch(JSON.stringify(bcg.attractiveness_capability_matrix), /代理|proxy/i, `${seed.slug}: management matrix is not named a BCG proxy`);
    assert.deepEqual(bcg.proxy_matrix, bcg.attractiveness_capability_matrix, `${seed.slug}: compatibility alias`);
    const managementMatrix = JSON.stringify(bcg.attractiveness_capability_matrix);
    if (sharedManagementMatrix === undefined) sharedManagementMatrix = managementMatrix;
    assert.equal(managementMatrix, sharedManagementMatrix, `${seed.slug}: shared management matrix`);

    const ansoff = strategy.complementary_frameworks.ansoff;
    assert.equal(ansoff.status, "PENDING", `${seed.slug}: Ansoff pending`);
    assert.equal(ansoff.route, null, `${seed.slug}: no invented Ansoff route`);
    assert.deepEqual(ansoff.required_inputs, ["current_portfolio_category", "country", "channel", "customer"], `${seed.slug}: Ansoff inputs`);

    const rice = strategy.complementary_frameworks.rice_input_gate;
    assert.equal(rice.effort_unit, "person-weeks", `${seed.slug}: RICE effort unit`);
    assert.equal(rice.capital_input.included_in_effort, false, `${seed.slug}: capital separate from effort`);
    const ice = strategy.complementary_frameworks.ice_input_gate;
    assert.equal(ice.methodology_source_id, "METHOD-ICE", `${seed.slug}: ICE source id`);
    assert.equal(ice.formula, "(Impact + Confidence + Ease) / 3", `${seed.slug}: ICE formula`);
    assert.deepEqual(ice.scale, { min: 0, max: 10, applies_to: ["Impact", "Confidence", "Ease"] }, `${seed.slug}: ICE scale`);
    assert.match(ice.ease_convention, /投入越小.*Ease 分越高/, `${seed.slug}: inverse effort convention`);

    const backlog = strategy.execution_backlog_90d.items;
    assert.equal(backlog.length, 4, `${seed.slug}: backlog size`);
    const taskIds = new Set(backlog.map((item) => item.id));
    assert.equal(taskIds.size, backlog.length, `${seed.slug}: task ids`);
    for (const [index, item] of backlog.entries()) {
      for (const field of ["priority", "time_window", "title", "category_action", "owner_role", "deliverable", "acceptance", "acceptance_contract", "stop_line", "status"]) {
        assert.ok(item[field], `${seed.slug}: task ${index + 1} ${field}`);
      }
      for (const field of ["metric", "threshold", "sample_window", "evidence", "approver", "source_contracts"]) {
        assert.ok(item.acceptance_contract[field], `${seed.slug}: task ${index + 1} acceptance ${field}`);
      }
      assert.match(item.acceptance, /指标：.+阈值：.+样本\/观察窗：.+证据：.+签核人：/, `${seed.slug}: task ${index + 1} complete acceptance`);
      for (const field of ["metric", "threshold", "sample_window", "evidence", "approver", "source_contracts"]) {
        assert.ok(item.acceptance.includes(item.acceptance_contract[field]), `${seed.slug}: task ${index + 1} acceptance mirrors ${field}`);
      }
      assert.match(item.stop_line, /若|未|失败|不足|低于|超过|突破/, `${seed.slug}: task ${index + 1} failure semantics`);
      assert.match(item.stop_line, /停止|冻结|退回|禁止/, `${seed.slug}: task ${index + 1} stop action`);
      assert.ok(!seed.report.modules.exec_summary_decision_scorecard.gates?.includes?.(item.stop_line), `${seed.slug}: raw positive gate is not a stop line`);
      assert.ok(item.dependency_ids.every((id) => taskIds.has(id)), `${seed.slug}: task dependency`);
      assert.equal(item.status, "PENDING", `${seed.slug}: task status`);
      assert.equal(item.prioritization.method, "HARD_GATE_DEPENDENCY", `${seed.slug}: serial prioritization`);
      assert.equal(item.prioritization.status, "ACTIVE", `${seed.slug}: dependency gate active`);
      assert.equal(item.prioritization.score, null, `${seed.slug}: no invented dependency score`);
      assert.equal(item.optional_experiment_scoring.method, "RICE", `${seed.slug}: optional RICE only`);
      assert.equal(item.optional_experiment_scoring.effort_person_weeks, null, `${seed.slug}: person-week effort field`);
      assert.equal(item.optional_experiment_scoring.capital_required_usd, null, `${seed.slug}: separate capital field`);
    }
    assert.ok(backlog.slice(0, 3).every((item) => item.gate_type === "HARD_GATE"), `${seed.slug}: first three stages are hard gates`);
    const pilot = backlog[3];
    assert.equal(pilot.gate_type, "PILOT_ALERT", `${seed.slug}: pilot is an alert gate`);
    assert.match(pilot.maturity_rule, /退货窗口.*7 天/, `${seed.slug}: maturity window`);
    assert.match(pilot.insufficient_evidence_rule, /INSUFFICIENT_EVIDENCE.*绝不能为 PASS/, `${seed.slug}: insufficient evidence rule`);
    assert.deepEqual(modules.exec_summary_decision_scorecard.action_items, backlog, `${seed.slug}: executive backlog`);
    assert.deepEqual(modules.gtm_plan.action_items, backlog, `${seed.slug}: GTM backlog`);
    assert.deepEqual(modules.gtm_plan.action_plan.items, backlog, `${seed.slug}: action plan backlog`);
    assert.deepEqual(strategy.decision_chain, [
      "VOC evidence",
      "JTBD",
      "消费者心理机制与证据门",
      "端到端消费旅程与触点摩擦",
      "STP",
      "产品规格 / AIGC 概念",
      "Unit Economics 硬门",
      "Ansoff 输入门",
      "经典 BCG 输入门",
      "独立吸引力-能力矩阵",
      "RICE / ICE 可选实验排序",
      "90 天依赖待办",
      "成熟订单复盘",
    ], `${seed.slug}: complete decision chain`);
  }
  const iceSource = reports.boardReportSeeds[0].report.modules.strategy_frameworks.methodology_sources
    .find((source) => source.id === "METHOD-ICE");
  assert.equal(iceSource.url, "https://itamargilad.com/ice-scores/");
});

test("all five reports expose evidence-gated consumer psychology, customer journey, scene-suite, and future data contracts", () => {
  const methodologyIds = new Set([
    "METHOD-COMB",
    "METHOD-FOGG",
    "METHOD-JOURNEY",
    "METHOD-JOURNEY-MAP",
  ]);
  for (const seed of reports.boardReportSeeds) {
    const modules = seed.report.modules;
    const strategy = modules.strategy_frameworks;
    const psychology = strategy.consumer_psychology;
    const journey = strategy.customer_journey;

    assert.deepEqual(modules.MIND_DECODE.consumer_psychology, psychology, `${seed.slug}: psychology source`);
    assert.deepEqual(modules.MIND_DECODE.customer_journey, journey, `${seed.slug}: journey source`);
    assert.deepEqual(modules.gtm_plan.customer_journey, journey, `${seed.slug}: GTM journey source`);
    assert.deepEqual(modules.pd_quality_return_pareto.post_purchase_journey, journey, `${seed.slug}: post-purchase journey source`);

    assert.equal(psychology.status, "EVIDENCE-GATED", `${seed.slug}: psychology gate`);
    assert.match(psychology.evidence_boundary, /不是.*发生率|不是.*因果/, `${seed.slug}: psychology boundary`);
    assert.equal(psychology.motivation_barrier_matrix.rows.length, 3, `${seed.slug}: psychology task layers`);
    assert.equal(psychology.psychology_evidence_readiness.kind, "chart", `${seed.slug}: psychology heatmap`);
    assert.equal(psychology.value_risk_signal_map.kind, "chart", `${seed.slug}: value-risk chart`);
    assert.ok(psychology.heuristic_watchlist.rows.every((row) => /HYPOTHESIS|INTERPRETATION/.test(row[4])), `${seed.slug}: heuristic state`);

    assert.equal(journey.status, "EVIDENCE-GATED", `${seed.slug}: journey gate`);
    assert.equal(journey.stage_contract.rows.length, 8, `${seed.slug}: end-to-end stages`);
    assert.equal(journey.journey_flow.value.nodes.length, 8, `${seed.slug}: journey flow nodes`);
    assert.equal(journey.journey_flow.value.links.length, 7, `${seed.slug}: journey flow links`);
    assert.equal(journey.touchpoint_pain_heatmap.value.matrix.length, 8, `${seed.slug}: journey heatmap rows`);
    assert.ok(
      journey.touchpoint_pain_heatmap.value.matrix.flat().reduce((sum, value) => sum + Number(value || 0), 0) > 0,
      `${seed.slug}: journey heatmap must retain normalized VOC observations`,
    );
    assert.ok(journey.stage_contract.rows.every((row) => /CODED-INTERPRETATION|PENDING/.test(row[8])), `${seed.slug}: journey evidence states`);
    assert.match(journey.evidence_boundary, /不显示.*转化|不显示.*流失/, `${seed.slug}: no invented journey conversion`);

    const registry = strategy.data_adapter_contract;
    assert.equal(registry.contract_version, "metis.research-data.v1", `${seed.slug}: adapter contract version`);
    assert.equal(registry.status, "INTERFACES_READY_ADAPTERS_PENDING", `${seed.slug}: adapters pending`);
    assert.equal(registry.adapters.length, 7, `${seed.slug}: adapter domains`);
    assert.ok(registry.adapters.every((adapter) => adapter.status === "interface_ready_adapter_pending"), `${seed.slug}: adapter implementation state`);
    assert.ok(registry.adapters.every((adapter) => adapter.validation_gate && adapter.required_dimensions.length), `${seed.slug}: adapter quality gates`);

    const suite = modules.pd_concept_matrix.aigc_design_review_pack.scene_suite_contract;
    assert.equal(suite.suite_version, "metis-scene-suite-v1", `${seed.slug}: suite contract`);
    assert.equal(suite.required_asset_count, 6, `${seed.slug}: six scene slots`);
    assert.equal(new Set(suite.slots.map((slot) => slot.role)).size, 6, `${seed.slug}: unique scene roles`);
    assert.equal(suite.consistency_status, "PENDING-HUMAN-REVIEW", `${seed.slug}: no false consistency claim`);

    const sources = strategy.methodology_sources.filter((source) => methodologyIds.has(source.id));
    assert.equal(sources.length, methodologyIds.size, `${seed.slug}: psychology and journey methodology sources`);
  }
});

test("listed competitive samples reproduce every displayed median and sample count", () => {
  const cases = {
    nightstands: {
      count: 7,
      median: 129.99,
      metric: "IKEA 列示样本中位价",
      kpi: "IKEA 列示中位价",
    },
    sideboard: {
      count: 8,
      median: 339,
      metric: "IKEA 列示样本中位价",
      kpi: "IKEA 列示中位价",
    },
    "drawer-cabinet": {
      count: 6,
      median: 117.49,
      metric: "IKEA 列示样本中位价",
      kpi: "IKEA 列示中位价",
    },
    "coffee-bar-counter": {
      count: 8,
      median: 125.99,
      metric: "混合零售商列示样本中位价",
    },
    "slatted-platform-bed": {
      count: 7,
      median: 279,
      metric: "IKEA Queen 列示床架中位价",
      kpi: "IKEA Queen 床架列示中位",
    },
  };

  for (const [slug, expected] of Object.entries(cases)) {
    const report = seedFor(slug).report;
    const rows = report.modules.MKT_STRUCT.competitive_sample_register.rows;
    const sample = slug === "coffee-bar-counter"
      ? rows
      : slug === "slatted-platform-bed"
        ? rows.filter((row) => row[0] === "IKEA" && !/排骨架/.test(String(row[1])))
        : rows.filter((row) => row[0] === "IKEA");
    assert.equal(sample.length, expected.count, slug);
    assert.equal(median(sample.map((row) => usd(row[2]))), expected.median, slug);

    const market = report.modules.OP_SCAN.market_signal.metrics;
    assert.equal(usd(rowByFirstCell(market, expected.metric)[1]), expected.median, `${slug}: market`);
    if (expected.kpi) {
      const kpi = report.modules.exec_summary_decision_scorecard.kpi_tiles
        .find((item) => item.label === expected.kpi);
      assert.ok(kpi, `${slug}: missing KPI ${expected.kpi}`);
      assert.equal(usd(kpi.value), expected.median, `${slug}: KPI`);
      assert.match(kpi.sub, new RegExp(`\\b${expected.count}\\b`), `${slug}: KPI sample count`);
    }
  }

  const nightstandRegister = seedFor("nightstands").report.modules
    .trust_guardrails_methodology.source_register;
  const rawNs = rowByFirstCell(nightstandRegister, "RAW-NS");
  assert.match(rawNs[4], /53 个.*公开目录入口/);
  assert.match(rawNs[4], /7 个 IKEA SKU/);
});

test("management scores retain their derivation and evidence confidence comes from the source register", () => {
  for (const seed of reports.boardReportSeeds) {
    const scorecard = seed.report.modules.exec_summary_decision_scorecard.scorecard;
    const confidence = scorecard.evidence_confidence;
    const register = seed.report.modules.trust_guardrails_methodology.source_register;
    const confidenceColumn = register.columns.indexOf("置信度");
    assert.notEqual(confidenceColumn, -1, seed.slug);

    const levels = ["High", "Medium", "Low"];
    const ratedRows = register.rows.filter((row) => levels.includes(row[confidenceColumn]));
    assert.equal(levels.reduce((sum, level) => sum + confidence[level], 0), 100, seed.slug);
    for (const level of levels) {
      const count = ratedRows.filter((row) => row[confidenceColumn] === level).length;
      const exactPercent = count * 100 / ratedRows.length;
      assert.equal(scorecard.evidence_confidence_counts[level], count, `${seed.slug}: ${level} count`);
      assert.ok(
        Math.abs(confidence[level] - exactPercent) <= 1,
        `${seed.slug}: ${level} ${confidence[level]} != ${exactPercent}`,
      );
    }
    assert.match(
      scorecard.evidence_confidence_basis,
      new RegExp(`按来源台账 ${register.rows.length} 条登记项计算；不是统计置信区间`),
      seed.slug,
    );

    const derivation = scorecard.score_derivation;
    const weighted = scorecard.dimensions.reduce((sum, item) => sum + item.weighted, 0);
    assert.equal(scorecard.dimensions.length, 5, seed.slug);
    assert.equal(scorecard.dimensions.reduce((sum, item) => sum + item.weight, 0), 1, seed.slug);
    assert.ok(scorecard.dimensions.every((item) => item.score_source === "management_assessment"), seed.slug);
    assert.ok(scorecard.dimensions.every((item) => item.signal.startsWith("管理层立项初评｜")), seed.slug);
    assert.equal(derivation.weighted_base_score, Number(weighted.toFixed(1)), seed.slug);
    assert.equal(derivation.management_total_score, scorecard.total_score, seed.slug);
    assert.equal(
      derivation.calibration_delta,
      Number((scorecard.total_score - derivation.weighted_base_score).toFixed(1)),
      seed.slug,
    );
    assert.match(scorecard.score_type, /管理层立项初评.*不是.*统计模型输出/, seed.slug);
    assert.match(derivation.hard_gate_rule, /硬闸门.*不得用总分覆盖/, seed.slug);
  }
});

test("open-source VOC fixtures cannot masquerade as real consumer evidence", () => {
  for (const seed of reports.boardReportSeeds) {
    const voc = seed.report.modules.voc_evidence;
    const { columns, rows } = voc.coverage_summary;
    const sourceIndex = columns.findIndex((value) => value === "样例来源");
    const ratingIndex = columns.findIndex((value) => value === "真实 Ratings 基数");
    const reviewIndex = columns.findIndex((value) => value === "真实 Reviews 基数");
    const codedIndex = columns.findIndex((value) => value === "合成观察");
    for (const index of [sourceIndex, ratingIndex, reviewIndex, codedIndex]) {
      assert.notEqual(index, -1, `${seed.slug}: missing explicit VOC column`);
    }
    assert.equal(rows[0][sourceIndex], voc.source_coverage.rows.length, seed.slug);
    assert.equal(rows[0][codedIndex], voc.evidence_log.rows.length, seed.slug);
    const definition = JSON.stringify(voc.sample_definition);
    assert.equal(voc.synthetic, true, seed.slug);
    assert.equal(voc.source_mode, "synthetic_fixture", seed.slug);
    assert.equal(voc.evidence_mode, "template_demo", seed.slug);
    assert.equal(voc.decision_readiness, "insufficient_evidence", seed.slug);
    assert.equal(rows[0][ratingIndex], 0, seed.slug);
    assert.equal(rows[0][reviewIndex], 0, seed.slug);
    assert.match(definition, /未采集真实评分/, seed.slug);
    assert.match(definition, /人工编写的测试记录/, seed.slug);
    assert.match(definition, /不能外推为市场发生率/, seed.slug);
    assert.match(voc.methodology_note, /SYNTHETIC.*不是消费者原话/, seed.slug);
    assert.match(voc.synthesis.join("\n"), /真实市场与消费者证据为 0/, seed.slug);
    assert.ok(voc.source_register.every((source) => source.synthetic === true && new URL(source.url).hostname === "example.com"), seed.slug);
  }
});

test("must-have definitions agree with the selected concept geometry", () => {
  const conceptFor = (slug) => {
    const modules = seedFor(slug).report.modules;
    return {
      must: modules.CPT_VERIFY.product_definition.must_have.join("；"),
      specs: JSON.stringify(modules.pd_concept_matrix.product_concept.specs),
    };
  };

  const nightstand = conceptFor("nightstands");
  assert.doesNotMatch(nightstand.must, /开放层板/);
  assert.match(nightstand.must, /双全宽真抽屉/);
  assert.match(nightstand.specs, /2 个全宽真抽屉/);

  const drawer = conceptFor("drawer-cabinet");
  assert.doesNotMatch(drawer.must, /隐藏脚轮/);
  assert.match(drawer.must, /低位黑色底座.*4 只可锁止脚轮/);
  assert.match(drawer.specs, /低位哑黑底座.*4 只可锁止万向脚轮/);

  const bed = conceptFor("slatted-platform-bed");
  assert.doesNotMatch(bed.must, /钢中心梁/);
  assert.match(bed.must, /LVL 中梁.*3 支腿/);
  assert.match(bed.specs, /LVL 中梁/);
  assert.match(bed.specs, /3 个可调支腿/);
});

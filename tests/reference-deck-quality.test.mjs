import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const deckPath = fileURLToPath(new URL("../public/reference-deck.js", import.meta.url));
const stylePath = fileURLToPath(new URL("../public/metis-gpt.css", import.meta.url));
let server;
let reports;
let schema;
let deck;
let deckSource;
let styleSource;

function loadDeckModule(source) {
  const executable = source
    .replace(/^import\s+.*;\s*$/gm, "")
    .replace(/\bexport\s+(?=(?:const|function)\b)/g, "") + `
globalThis.__deckTestExports = {
  compileReferencePages,
  inspectReferenceDeck,
  applyReviewSemantics,
  stepReferencePage,
  stepCuratedReferencePage,
  mobileChartTable,
  referenceArtifactSources,
  hasContinuousReferencePageSequence,
  REFERENCE_TOTAL_PAGES,
  REFERENCE_MODULE_STARTS,
  REFERENCE_PREFLIGHT_FILLER_SIGNATURES,
  artifactCanSatisfyVisual,
  tableDensity,
  resolveBlockSource,
  contractFallbackArtifact,
  sourceModuleId,
  blockSourceCandidates,
  structuredEvidenceArtifact,
  artifactVisualScore,
  semanticAffinity,
  artifactContentAffinity,
};`;
  const context = vm.createContext({
    console,
    h() {},
    htm() {},
    useEffect() {},
    useState(value) { return [value, () => {}]; },
  });
  vm.runInContext(executable, context, { filename: deckPath });
  return context.__deckTestExports;
}

before(async () => {
  const [source, styles] = await Promise.all([
    readFile(deckPath, "utf8"),
    readFile(stylePath, "utf8"),
  ]);
  deckSource = source;
  styleSource = styles;
  deck = loadDeckModule(source);
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
  });
  [reports, schema] = await Promise.all([
    server.ssrLoadModule("/lib/board-reports.ts"),
    server.ssrLoadModule("/lib/reference-report-schema.ts"),
  ]);
});

test("page 7 keeps the reference executive layout without an uncontracted concept image", () => {
  const start = deckSource.indexOf("function ExecutivePreview");
  const end = deckSource.indexOf("function ModuleBody", start);
  const source = deckSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /data-contract-id=\$\{decisionBlock\?\.id\}/);
  assert.match(source, /class="ref-kpis" data-contract-id=\$\{kpiBlock\?\.id\}/);
  assert.match(source, /decision\.kpis\.slice\(0, 6\)/);
  assert.doesNotMatch(source, /ref-exec-concept|concept\.image_url|board_concept/);
});

test("page 7 fills six KPI cards from traceable report evidence", () => {
  const start = deckSource.indexOf("function reportDecision");
  const end = deckSource.indexOf("function Cover", start);
  const source = deckSource.slice(start, end);
  assert.match(source, /来源台账/);
  assert.match(source, /VOC 编码观察/);
  assert.match(source, /if \(kpis\.length >= 6\) break/);
});

test("Gate-1 sign-off never implies independent functional approvals", () => {
  const pages = deck.compileReferencePages(reports.boardReportSeeds[0].report);
  const gateArtifact = pageAt(pages, 328, "review semantics").artifacts
    .find((artifact) => artifact.review_semantics === "gate1_summary");
  const domainArtifact = pageAt(pages, 330, "review semantics").artifacts
    .find((artifact) => artifact.review_semantics === "functional_domains");
  assert.ok(gateArtifact);
  assert.ok(domainArtifact);
  const originalGateArtifact = JSON.stringify(gateArtifact);
  const originalDomainArtifact = JSON.stringify(domainArtifact);

  const signedReview = {
    reviewed: true,
    reviewer: "Lin",
    reviewedAt: "2026-08-04 13:40:00",
  };
  const signedGate = deck.applyReviewSemantics(gateArtifact, signedReview);
  const signedGateStatus = signedGate.dimensions.find((item) => item[0] === "系统 Gate-1")?.[1];
  assert.match(signedGateStatus, /已签核/);
  assert.match(signedGateStatus, /签核人：Lin/);
  assert.match(signedGateStatus, /签核时间：2026-08-04 13:40:00/);

  const signedDomains = deck.applyReviewSemantics(domainArtifact, signedReview);
  assert.deepEqual(Array.from(signedDomains.rows, (row) => row[1]), Array(4).fill("未单独记录"));
  assert.match(signedDomains.note, /系统 Gate-1 已签核/);
  assert.match(signedDomains.note, /没有独立审批记录/);
  assert.doesNotMatch(JSON.stringify(signedDomains), /全部通过/);
  assert.equal(JSON.stringify(gateArtifact), originalGateArtifact, "Gate-1 source artifact must remain immutable");
  assert.equal(JSON.stringify(domainArtifact), originalDomainArtifact, "functional-domain source artifact must remain immutable");

  const draftGate = deck.applyReviewSemantics(gateArtifact, { reviewed: false });
  assert.equal(draftGate.dimensions.find((item) => item[0] === "系统 Gate-1")?.[1], "待人工终审");
  const draftDomains = deck.applyReviewSemantics(domainArtifact, { reviewed: false });
  assert.deepEqual(Array.from(draftDomains.rows, (row) => row[1]), Array(4).fill("未单独记录"));
  assert.match(draftDomains.note, /系统 Gate-1 待人工终审/);

  const moduleBodyStart = deckSource.indexOf("function ModuleBody");
  const moduleBodyEnd = deckSource.indexOf("function ModuleHeader", moduleBodyStart);
  assert.match(deckSource.slice(moduleBodyStart, moduleBodyEnd), /applyReviewSemantics\(artifact, review\)/);
});

test("strategy sidecars stay full-width on screen, preflight, and printed PDF", () => {
  const moduleBodyStart = deckSource.indexOf("function ModuleBody");
  const moduleBodyEnd = deckSource.indexOf("function ModuleHeader", moduleBodyStart);
  const moduleBody = deckSource.slice(moduleBodyStart, moduleBodyEnd);
  assert.match(moduleBody, /strategySidecar = artifacts\.find\(\(artifact\) => artifact\.contract_origin === "strategy" && artifact\.contract_placement === "sidecar"\)/);
  assert.match(moduleBody, /data-strategy-layout=\$\{strategySidecar \? "stacked" : undefined\}/);
  assert.match(moduleBody, /data-strategy-kind=\$\{strategySidecar\?\.kind\}/);
  assert.match(moduleBody, /data-contract-origin=\$\{artifact\.contract_origin \|\| "reference"\}/);

  assert.match(styleSource, /\.ref-artifacts\[data-strategy-layout="stacked"\]\{grid-template-columns:minmax\(0,1fr\);grid-template-rows:repeat\(2,minmax\(0,1fr\)\);gap:10px\}/);
  assert.match(styleSource, /\.ref-artifacts\[data-strategy-kind="table"\]\{grid-template-rows:minmax\(0,\.72fr\) minmax\(0,1\.28fr\)\}/);
  assert.match(styleSource, /\.ref-artifacts\[data-strategy-kind="table"\]>section\[data-contract-origin="strategy"\] \.ref-table td\{padding:4px 5px;line-height:1\.32\}/);
  assert.match(styleSource, /body\[data-print-preparing="true"\] \.ref-artifacts\[data-strategy-layout="stacked"\]\{\s*grid-template-columns:minmax\(0,1fr\)!important;grid-template-rows:repeat\(2,minmax\(0,1fr\)\)!important;gap:10px!important\s*\}/);
  assert.match(styleSource, /body\[data-print-preparing="true"\] \.ref-artifacts\[data-strategy-kind="table"\]\{\s*grid-template-rows:minmax\(0,\.72fr\) minmax\(0,1\.28fr\)!important\s*\}/);
  assert.match(styleSource, /body\[data-print-mode="reference"\] \.ref-artifacts\[data-strategy-layout="stacked"\]\{\s*grid-template-columns:minmax\(0,1fr\)!important;grid-template-rows:repeat\(2,minmax\(0,1fr\)\)!important;gap:10px!important\s*\}/);
  assert.match(styleSource, /body\[data-print-mode="reference"\] \.ref-artifacts\[data-strategy-kind="table"\]\{\s*grid-template-rows:minmax\(0,\.72fr\) minmax\(0,1\.28fr\)!important\s*\}/);
  assert.match(styleSource, /\.ref-artifacts\[data-strategy-layout="stacked"\] \.ref-radar svg,\s*\.ref-artifacts\[data-strategy-layout="stacked"\] \.ref-scatter-grid\{min-height:0\}/);
  assert.match(styleSource, /body\[data-print-mode="reference"\] \.ref-running-head\{height:6mm!important\}\s*body\[data-print-mode="reference"\] \.ref-running-foot\{height:5mm!important\}/);
});

test("curated reading path surfaces the selected strategy decision pages", () => {
  const readingPages = deckSource.match(/const BOARD_READING_PAGES = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || "";
  for (const page of [10, 25, 291, 294, 295, 318, 319]) {
    assert.match(readingPages, new RegExp(`\\b${page}\\b`), `board reading should include p${page}`);
  }
  assert.match(deckSource, /摘要与 \$\{BOARD_READING_PAGES\.length\} 个精选页/);
  assert.doesNotMatch(deckSource, /董事会速览|速览目录/);
});

test("report reader defaults to curated pages while full mode keeps physical pagination", () => {
  assert.equal(deck.stepReferencePage(1, -1), 1);
  assert.equal(deck.stepReferencePage(1, 1), 2);
  assert.equal(deck.stepReferencePage(11, 1), 12);
  assert.equal(deck.stepReferencePage(31, 1), 32);
  assert.equal(deck.stepReferencePage(33, 1), 34);
  assert.equal(deck.stepReferencePage(291, -1), 290);
  assert.equal(deck.stepReferencePage(332, 1), 332);
  assert.equal(deck.stepReferencePage(12.8, 0), 12);
  assert.equal(deck.stepCuratedReferencePage(1, -1), 1);
  assert.equal(deck.stepCuratedReferencePage(1, 1), 7);
  assert.equal(deck.stepCuratedReferencePage(11, 1), 25);
  assert.equal(deck.stepCuratedReferencePage(295, 1), 161, "curated order follows the selected reading path, not physical adjacency");
  assert.equal(deck.stepCuratedReferencePage(327, 1), 327);

  const start = deckSource.indexOf("export function ReferenceReportDeck");
  const source = deckSource.slice(start);
  assert.match(source, /useState\("curated"\)/);
  assert.match(source, /readingMode === "curated"[\s\S]*?stepCuratedReferencePage\(value, delta\)[\s\S]*?: stepReferencePage\(value, delta\)/);
  assert.match(source, /const curatedIndex = BOARD_READING_PAGES\.indexOf\(current\)/);
  assert.match(source, /const goPage = \(delta\) => \{[\s\S]*?setCurrent\(\(value\) => readingMode === "curated"/);
  assert.match(source, /disabled=\$\{readingMode === "curated" \? curatedIndex <= 0 : current <= 1\}/);
  assert.match(source, /disabled=\$\{readingMode === "curated" \? curatedIndex >= BOARD_READING_PAGES\.length - 1 : current >= REFERENCE_TOTAL_PAGES\}/);
  assert.match(source, /const switchMode = \(mode\) => \{[\s\S]*?setReadingMode\(mode\);[\s\S]*?mode === "curated"[\s\S]*?BOARD_READING_PAGES\.includes\(current\)/);
  assert.match(source, /const \[pageInput, setPageInput\] = useState\("1"\)/);
  assert.match(source, /const commitPageInput = \(candidate = pageInput\) =>/);
  assert.match(source, /aria-label="跳转到报告页码"/);
  assert.match(source, /<output class="ref-page-position"[\s\S]*?\$\{curatedIndex \+ 1\} \/ \$\{BOARD_READING_PAGES\.length\}[\s\S]*?原第 \$\{current\} \/ \$\{REFERENCE_TOTAL_PAGES\} 页/);
  assert.match(source, /aria-keyshortcuts="ArrowLeft"/);
  assert.match(source, /aria-keyshortcuts="ArrowRight"/);
  assert.match(source, /document\.querySelector\?\.\('\[aria-modal="true"\]'\)/);
  assert.match(source, /const handleReaderKeyDown = \(event\) => \{[\s\S]*?event\.preventDefault\(\);\s*goPage\(delta\)/);
  assert.match(source, /onKeyDown=\$\{handleReaderKeyDown\}/);
  assert.doesNotMatch(source, /window\.addEventListener\("keydown"/);
  assert.match(source, /viewport\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
  assert.match(source, /button\[aria-current="page"\]/);
  assert.doesNotMatch(source, /class="ref-print"/);
  assert.match(source, /window\.metisPrintReference = exportReference/);
});

test("mobile reading mode reflows chart data and preserves traceable sources", () => {
  const items = JSON.parse(JSON.stringify(deck.mobileChartTable({ value: { items: [
    { label: "需求", value: 72, unit: "分", note: "公开样本" },
    { label: "风险", value: "PENDING", status: "待补证" },
  ] } })));
  assert.deepEqual(items.columns, ["指标", "数值", "说明"]);
  assert.deepEqual(items.rows[0], ["需求", "72分", "公开样本"]);

  const matrix = JSON.parse(JSON.stringify(deck.mobileChartTable({ value: {
    xLabels: ["高", "低"],
    yLabels: ["需求", "竞争"],
    matrix: [[8, 2], [3, 7]],
  } })));
  assert.deepEqual(matrix.columns, ["维度", "高", "低"]);
  assert.deepEqual(matrix.rows[1], ["竞争", 3, 7]);

  const radar = JSON.parse(JSON.stringify(deck.mobileChartTable({ value: {
    axes: ["需求", "利润"],
    series: [{ name: "方案 A", scores: [80, 65] }],
  } })));
  assert.deepEqual(radar.rows[0], ["方案 A", 80, 65]);

  const flow = JSON.parse(JSON.stringify(deck.mobileChartTable({ value: {
    nodes: [{ label: "触发", detail: "发现需求" }, { label: "购买", status: "待验证" }],
  } })));
  assert.deepEqual(flow.rows[0], ["01", "触发", "发现需求"]);

  assert.deepEqual(Array.from(deck.referenceArtifactSources({
    source_path: "modules.voc_evidence.evidence_log",
    contract_source_path: "modules.voc_evidence.evidence_log",
    derived_source_paths: ["modules.MIND_DECODE"],
  })), ["modules.voc_evidence.evidence_log", "modules.MIND_DECODE"]);

  const start = deckSource.indexOf("function MobileReferencePage");
  const source = deckSource.slice(start, deckSource.indexOf("function reportEvidenceState", start));
  assert.match(source, /page\.kind === "cover"/);
  assert.match(source, /page\.kind === "toc"/);
  assert.match(source, /page\.number === 7/);
  assert.match(source, /applyReviewSemantics\(artifact, review\)/);
  assert.match(source, /<\$\{MobileReferenceSources\} artifact=\$\{displayArtifact\}/);
  assert.match(deckSource, /class="ref-mobile-page-reader" ref=\$\{mobileReaderRef\}/);
  assert.match(deckSource, /class="ref-mobile-page-nav"/);
  assert.match(deckSource, /matchMedia\?\.\("\(max-width: 1024px\)"\)/);
  assert.doesNotMatch(deckSource, /mobileZoom|fitMobile|--ref-mobile-zoom/);
});

test("structured reading tables preserve all rows and use authored scatter axis labels", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ label: `指标 ${index + 1}`, value: index }));
  const itemTable = JSON.parse(JSON.stringify(deck.mobileChartTable({ value: { items } })));
  assert.equal(itemTable.rows.length, 20);

  const points = Array.from({ length: 18 }, (_, index) => ({
    name: `产品 ${index + 1}`,
    growth: index + 1,
    share: 18 - index,
    evidence: `source-${index + 1}`,
  }));
  const scatter = JSON.parse(JSON.stringify(deck.mobileChartTable({ value: {
    points,
    xKey: "growth",
    yKey: "share",
    xLabel: "市场增长率",
    yLabel: "相对市场份额",
  } })));
  assert.equal(scatter.rows.length, 18);
  assert.deepEqual(scatter.columns, ["Name", "市场增长率", "相对市场份额", "Evidence"]);

  const start = deckSource.indexOf("function mobileReadableValue");
  const end = deckSource.indexOf("function reportEvidenceState", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(deckSource.slice(start, end), /\.slice\(0,/);
});

test("runtime page sequence guard rejects missing, duplicate, and reordered physical pages", () => {
  const continuous = Array.from({ length: 332 }, (_, index) => ({ number: index + 1 }));
  assert.equal(deck.hasContinuousReferencePageSequence(continuous), true);
  assert.equal(deck.hasContinuousReferencePageSequence(continuous.slice(0, -1)), false);
  assert.equal(deck.hasContinuousReferencePageSequence(continuous.map((page, index) => index === 50 ? { number: 50 } : page)), false);
  assert.equal(deck.hasContinuousReferencePageSequence([...continuous].reverse()), false);
  assert.match(deckSource, /if \(!hasContinuousReferencePageSequence\(pages\)\)/);
  assert.match(deckSource, /按 1–332 页唯一、连续编译/);
  assert.match(deckSource, /class="ref-research ref-page-empty" role="status"/);
});

after(async () => {
  await server?.close();
});

function assertNoIssues(issues, label) {
  const counts = new Map();
  for (const issue of issues) {
    const key = issue.split(":", 1)[0];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const summary = [...counts].map(([key, count]) => `${key}=${count}`).join(", ");
  assert.equal(
    issues.length,
    0,
    `${label}: ${issues.length} issue(s)${summary ? ` (${summary})` : ""}\n${issues.slice(0, 20).join("\n")}`,
  );
}

function visibleArtifacts(page) {
  return page.kind === "module" && page.number !== 7 ? (page.artifacts || []) : [];
}

function tableRowLimit(columnCount) {
  if (columnCount >= 8) return 4;
  if (columnCount >= 6) return 5;
  if (columnCount >= 4) return 6;
  return 8;
}

function pageAt(pages, number, label) {
  const page = pages[number - 1];
  assert.equal(page?.number, number, `${label}:p${number}`);
  return page;
}

test("all reports compile to the canonical 332-page sequence and module spans", () => {
  for (const seed of reports.boardReportSeeds) {
    const pages = deck.compileReferencePages(seed.report);
    assert.equal(pages.length, 332, seed.slug);
    assert.deepEqual([...new Set(pages.map((page) => page.number))], Array.from({ length: 332 }, (_, index) => index + 1), seed.slug);
    assert.deepEqual([...pages.slice(0, 6).map((page) => page.kind)], ["cover", "toc", "toc", "toc", "toc", "toc"], seed.slug);
    for (const span of schema.REFERENCE_REPORT_MODULE_PAGE_SPANS) {
      const modulePages = pages.filter((page) => page.number >= span.start_page && page.number <= span.end_page);
      assert.equal(modulePages.length, span.page_count, `${seed.slug}:${span.module_id}`);
      assert.ok(modulePages.every((page) => page.id === span.module_id), `${seed.slug}:${span.module_id}`);
      assert.deepEqual([...modulePages.map((page) => page.offset)], Array.from({ length: span.page_count }, (_, index) => index), `${seed.slug}:${span.module_id}`);
    }
  }
});

test("contents pages use the reference PDF's exact module grouping", () => {
  const expectedRanges = [[1, 14], [15, 30], [31, 46], [47, 61], [62, 62]];
  for (const seed of reports.boardReportSeeds) {
    const pages = deck.compileReferencePages(seed.report);
    pages.slice(1, 6).forEach((page, index) => {
      const [start, end] = expectedRanges[index];
      assert.deepEqual(page.ids, seed.report.order.slice(start - 1, end), `${seed.slug}:p${index + 2}`);
    });
  }
});

test("compiler rejects missing, extra, duplicate, unknown, and reordered module contracts", () => {
  const base = reports.boardReportSeeds[0].report;
  const canonical = [...schema.REFERENCE_REPORT_MODULE_ORDER];
  const duplicate = [...canonical];
  duplicate[20] = duplicate[19];
  const unknown = [...canonical];
  unknown[20] = "unknown_module";
  const reordered = [...canonical];
  [reordered[20], reordered[21]] = [reordered[21], reordered[20]];
  const cases = {
    missing: canonical.slice(0, -1),
    extra: [...canonical, canonical[0]],
    duplicate,
    unknown,
    reordered,
  };
  for (const [label, order] of Object.entries(cases)) {
    const pages = deck.compileReferencePages({ ...base, order });
    assert.equal(pages.length, 0, label);
  }
  assert.equal(deck.compileReferencePages({
    ...base,
    reference_layout: { ...base.reference_layout, contract_version: "metis.reference-report.a4-landscape.332.v2" },
  }).length, 0, "stale page contract");
  const stalePlan = base.reference_page_plan.map((entry, index) => index === 0
    ? { page: entry.page, title: entry.title, topic: entry.topic, kind: entry.kind, module_id: entry.module_id }
    : entry);
  assert.equal(deck.compileReferencePages({ ...base, reference_page_plan: stalePlan }).length, 0, "missing page block contract");
  const emptyModule = { ...base.modules, [canonical[20]]: {} };
  assert.equal(deck.compileReferencePages({ ...base, modules: emptyModule }).length, 0, "empty module");
});

test("compiled decks retain the reference report's visual and page-topic diversity", () => {
  for (const seed of reports.boardReportSeeds) {
    const pages = deck.compileReferencePages(seed.report);
    const body = pages.filter((page) => page.kind === "module");
    const artifacts = body.flatMap((page) => page.artifacts || []);
    assert.ok(artifacts.filter((artifact) => artifact.kind === "chart").length >= 15, seed.slug);
    assert.ok(artifacts.some((artifact) => artifact.kind === "image" || (artifact.kind === "concept-compare" && artifact.image)), seed.slug);
    assert.ok(artifacts.some((artifact) => artifact.kind === "comparison"), seed.slug);
    assert.ok(new Set(body.map((page) => page.topic)).size >= 320, seed.slug);
    body.forEach((page) => {
      for (const artifact of page.artifacts || []) {
        if (artifact.kind === "research") assert.equal(artifact.title, page.topic, `${seed.slug}:p${page.number}`);
      }
    });
  }
});

test("compiled pages bind every required reference block without generic research fallback", () => {
  for (const seed of reports.boardReportSeeds) {
    const pages = deck.compileReferencePages(seed.report);
    for (const page of pages.filter((item) => item.kind === "module")) {
      const expected = page.plan.reference_blocks;
      const required = page.artifacts.filter((artifact) => artifact.contract_required === true);
      assert.deepEqual(Array.from(required, (artifact) => artifact.contract_id), Array.from(expected, (block) => block.id), `${seed.slug}:p${page.number}:ids`);
      assert.deepEqual(Array.from(required, (artifact) => artifact.contract_visual), Array.from(expected, (block) => block.visual), `${seed.slug}:p${page.number}:visuals`);
      assert.ok(required.every((artifact) => artifact.kind !== "research"), `${seed.slug}:p${page.number}:generic research`);
    }
  }
});

test("resolver keeps grounded current-module allocations even when short titles have zero affinity", () => {
  const allocated = {
    kind: "table",
    title: "Q4",
    source_path: "modules.short_module.compact_grid",
    columns: ["维度", "值"],
    rows: [["A", "1"]],
  };
  const block = {
    id: "reference.p1.short_grid",
    title: "完全不同的长标题",
    visual: "data_table",
    source_paths: ["modules.short_module"],
  };
  const resolved = deck.resolveBlockSource(
    { modules: { short_module: { compact_grid: { columns: allocated.columns, rows: allocated.rows } } } },
    "short_module",
    block,
    allocated,
  );
  assert.equal(resolved?.artifact, allocated);
  assert.equal(resolved?.mode, "allocated");
  assert.equal(resolved?.path, "modules.short_module.compact_grid");
  assert.equal(resolved?.moduleId, "short_module");

  const explicit = deck.resolveBlockSource(
    { modules: { short_module: { nested: { payload: { columns: ["A", "B"], rows: [["x", "y"]] } } } } },
    "short_module",
    { ...block, source_paths: ["modules.short_module.nested.payload"] },
    null,
  );
  assert.equal(explicit?.mode, "source_path");
  assert.equal(explicit?.path, "modules.short_module.nested.payload");
  assert.equal(explicit?.moduleId, "short_module");
});

test("true source gaps compile to a complete, traceable evidence board", () => {
  const block = {
    id: "reference.p88.missing_grid",
    title: "缺口证据板",
    visual: "section_intro",
    source_paths: ["modules.short_module.missing_grid"],
  };
  const gap = deck.contractFallbackArtifact(
    { category: "测试品类", modules: { short_module: {}, exec_summary_decision_scorecard: {} } },
    "short_module",
    { page_in_module: 2, research_question: "缺口需要什么证据才能关闭？" },
    block,
  );
  assert.equal(gap.kind, "contract");
  assert.equal(gap.fallback_evidence_board, true);
  assert.equal(gap.source_path, "modules.short_module.missing_grid");
  assert.equal(gap.source_module, "short_module");
  assert.equal(gap.confidence, "PENDING");
  assert.equal(gap.cards.length, 3);
  assert.ok(gap.cards.every((card) => card.label && card.value && card.note));
  assert.match(JSON.stringify(gap), /modules\.short_module\.missing_grid/);
  assert.match(gap.finding, /不生成替代数值/);
});

test("canonical reports have no anonymous fallback blocks and preserve source provenance", () => {
  const fallbackBlocks = [];
  const gapPayloads = [];
  for (const seed of reports.boardReportSeeds) {
    let evidenceGapCount = 0;
    const contractPayloads = [];
    const provenanceMismatches = [];
    for (const page of deck.compileReferencePages(seed.report).filter((item) => item.kind === "module")) {
      for (const artifact of page.artifacts.filter((item) => item.contract_required === true)) {
        if (artifact.contract_source_mode === "fallback") fallbackBlocks.push(`${seed.slug}:p${page.number}:${artifact.contract_id}`);
        if (artifact.kind === "contract") {
          assert.ok([artifact.question, artifact.finding, artifact.gate].every((value) => String(value || "").trim()), `${seed.slug}:p${page.number}: contract narrative`);
          assert.equal(artifact.cards?.length, 3, `${seed.slug}:p${page.number}: contract cards`);
          assert.ok(artifact.cards.every((card) => card.label && card.value && card.note), `${seed.slug}:p${page.number}: contract completeness`);
          if (artifact.semantic_data_required) {
            assert.equal(artifact.tag, "DATA REQUIRED", `${seed.slug}:p${page.number}: semantic contract tag`);
            assert.notEqual(artifact.contract_source_mode, "evidence_gap", `${seed.slug}:p${page.number}: semantic contract provenance`);
            assert.match(artifact.finding, /不将.*重命名|不生成替代数值/, `${seed.slug}:p${page.number}: semantic boundary`);
          }
          contractPayloads.push(JSON.stringify({
            title: artifact.title,
            question: artifact.question,
            cards: artifact.cards,
            gate: artifact.gate,
            source: artifact.contract_source_path,
          }));
        }
        assert.match(artifact.contract_source_path, /^modules\.[^.]+(?:\.|$)/, `${seed.slug}:p${page.number}: source path`);
        assert.equal(
          artifact.contract_source_module,
          deck.sourceModuleId(artifact.contract_source_path, page.id),
          `${seed.slug}:p${page.number}: source module`,
        );
        if (artifact.contract_source_mismatch) provenanceMismatches.push(page.number);
        if (artifact.contract_visual_degraded) {
          assert.equal(deck.structuredEvidenceArtifact(artifact), true, `${seed.slug}:p${page.number}: degraded payload must remain structured`);
          assert.notEqual(artifact.contract_provenance, "gap", `${seed.slug}:p${page.number}: degraded visual cannot be a gap`);
        }
        if (artifact.contract_source_mode !== "evidence_gap") continue;
        evidenceGapCount += 1;
        assert.equal(artifact.kind, "contract", `${seed.slug}:p${page.number}: gap kind`);
        assert.equal(artifact.fallback_evidence_board, true, `${seed.slug}:p${page.number}: gap board`);
        assert.equal(artifact.cards?.length, 3, `${seed.slug}:p${page.number}: gap cards`);
        assert.ok(artifact.cards.every((card) => card.label && card.value && card.note), `${seed.slug}:p${page.number}: gap completeness`);
        const block = page.plan.reference_blocks.find((candidate) => candidate.id === artifact.contract_id);
        const groundedCandidates = deck.blockSourceCandidates(seed.report, block)
          .filter((candidate) => deck.structuredEvidenceArtifact(candidate.artifact));
        assert.equal(groundedCandidates.length, 0, `${seed.slug}:p${page.number}: structured source must not collapse to evidence gap`);
        gapPayloads.push(`${seed.slug}:${JSON.stringify({ finding: artifact.finding, cards: artifact.cards, gate: artifact.gate })}`);
      }
    }
    assert.ok(evidenceGapCount <= 12, `${seed.slug}: evidence_gap ${evidenceGapCount} > 12`);
    assert.equal(new Set(contractPayloads).size, contractPayloads.length, `${seed.slug}: contracts must remain page-specific`);
    assert.deepEqual(provenanceMismatches, [], `${seed.slug}: provenance mismatches`);
  }
  assert.deepEqual(fallbackBlocks, []);
  assert.equal(new Set(gapPayloads).size, gapPayloads.length, "evidence-gap boards must remain page-specific instead of repeating a generic payload");
});

test("low-fit proxy tables become traceable DATA REQUIRED contracts instead of fake rich visuals", () => {
  const proxyPath = /(?:^|[._])(?:experiment|strategy|structure|input_gate|risk_cert_compliance_matrix)(?:[._]|$)/i;
  let semanticContracts = 0;
  for (const seed of reports.boardReportSeeds) {
    const pages = deck.compileReferencePages(seed.report);
    for (const page of pages.filter((item) => item.kind === "module")) {
      for (const artifact of page.artifacts.filter((item) => item.contract_required === true)) {
        if (artifact.semantic_data_required) {
          semanticContracts += 1;
          assert.equal(artifact.kind, "contract", `${seed.slug}:p${page.number}: semantic pending kind`);
          assert.equal(artifact.confidence, "PENDING", `${seed.slug}:p${page.number}: semantic pending confidence`);
          assert.match(artifact.contract_source_path, /^modules\./, `${seed.slug}:p${page.number}: semantic pending source`);
          continue;
        }
        if (!["table", "list"].includes(artifact.kind) || deck.artifactVisualScore(artifact, artifact.contract_visual) >= 120) continue;
        if (proxyPath.test(artifact.contract_source_path)) {
          assert.equal(artifact.contract_canonical_source, true, `${seed.slug}:p${page.number}: low-fit proxy table`);
        }
      }
    }
    assert.equal(pageAt(pages, 34, seed.slug).artifacts[0].contract_canonical_source, true, `${seed.slug}:p34 canonical`);
    assert.equal(pageAt(pages, 78, seed.slug).artifacts[0].contract_canonical_source, true, `${seed.slug}:p78 canonical`);
  }
  assert.ok(semanticContracts > 0, "canonical reports should expose semantic DATA REQUIRED contracts");
});

test("rich visual contracts never bind narrative-only artifacts and OP_SCAN starts with structured evidence", () => {
  const narrativeOnlyVisuals = new Set(["callout", "verdict_callout", "section_intro", "section_intro_callout"]);
  for (const seed of reports.boardReportSeeds) {
    const pages = deck.compileReferencePages(seed.report);
    for (const page of pages.filter((item) => item.kind === "module")) {
      const required = page.artifacts.filter((artifact) => artifact.contract_required === true);
      for (const artifact of required) {
        if (narrativeOnlyVisuals.has(artifact.contract_visual)) continue;
        assert.ok(!["text", "callout"].includes(artifact.kind), `${seed.slug}:p${page.number}:${artifact.contract_visual} bound ${artifact.kind}`);
      }
    }

    const p14 = pageAt(pages, 14, seed.slug);
    const artifact = p14.artifacts.find((item) => item.contract_required === true);
    assert.ok(["table", "chart"].includes(artifact.kind), `${seed.slug}:p14 must render structured market evidence`);
    const structuredSize = artifact.kind === "table"
      ? artifact.rows?.length || 0
      : Object.values(artifact.value || {}).filter(Array.isArray).reduce((sum, values) => sum + values.length, 0);
    assert.ok(structuredSize > 0, `${seed.slug}:p14 structured artifact is empty`);
    const firstSignal = seed.report.modules.OP_SCAN.observed_market_signals.rows[0][0];
    assert.match(JSON.stringify(artifact), new RegExp(String(firstSignal).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${seed.slug}:p14 must retain observed market signals`);

    const p18 = pageAt(pages, 18, seed.slug);
    const opportunitySensitivity = p18.artifacts.find((item) => item.contract_id === "reference.p18.opportunity_sensitivity");
    const marketStructureAnchor = p18.artifacts.find((item) => item.contract_id === "reference.p18.market_structure_anchor");
    assert.equal(opportunitySensitivity.contract_source_path, "modules.OP_SCAN.opportunity_sensitivity", `${seed.slug}:p18 opportunity source`);
    assert.equal(marketStructureAnchor.contract_source_path, "modules.MKT_STRUCT.price_band_economics.market_structure_anchor", `${seed.slug}:p18 market-structure source`);
    assert.ok(opportunitySensitivity.rows?.length >= 3, `${seed.slug}:p18 opportunity sensitivity cannot collapse to a one-row tail chunk`);
    assert.equal(
      opportunitySensitivity.rows?.[0]?.[0],
      seed.report.modules.OP_SCAN.opportunity_sensitivity.rows[0][0],
      `${seed.slug}:p18 must start from the first source scenario`,
    );
    if (opportunitySensitivity.contract_source_mode === "fallback") {
      assert.equal(opportunitySensitivity.kind, "contract", `${seed.slug}:p18 opportunity fallback must remain a complete data contract`);
    }
    if (marketStructureAnchor.contract_source_mode === "fallback") {
      assert.equal(marketStructureAnchor.kind, "contract", `${seed.slug}:p18 market-structure fallback must remain a complete data contract`);
    }
    assert.doesNotMatch(JSON.stringify(opportunitySensitivity), /\bSTP\b/, `${seed.slug}:p18 OP_SCAN block leaked MKT_STRUCT metadata`);
  }
});

test("p11 binds the explicit key assumptions and narrative contracts reject data tables", () => {
  assert.equal(deck.artifactCanSatisfyVisual({ kind: "table" }, "callout"), false);
  assert.equal(deck.artifactCanSatisfyVisual({ kind: "chart" }, "section_intro_callout"), false);
  assert.equal(deck.artifactCanSatisfyVisual({ kind: "contract" }, "verdict_callout"), true);
  for (const seed of reports.boardReportSeeds) {
    const page = pageAt(deck.compileReferencePages(seed.report), 11, seed.slug);
    const assumptions = page.artifacts.find((artifact) => artifact.contract_id === "reference.p11.assumptions_table");
    const anchor = page.artifacts.find((artifact) => artifact.contract_id === "reference.p11.decision_funnel_anchor");
    assert.equal(assumptions?.kind, "table", `${seed.slug}:p11 assumptions kind`);
    assert.deepEqual(
      Array.from(assumptions?.columns || []),
      ["assumption", "basis", "sensitivity", "if_breaks"],
      `${seed.slug}:p11 assumptions columns`,
    );
    assert.equal(assumptions?.rows?.length, 3, `${seed.slug}:p11 assumptions rows`);
    assert.equal(assumptions?.rows?.[0]?.[0], seed.report.modules.exec_summary_decision_scorecard.key_assumptions[0].assumption, `${seed.slug}:p11 first assumption`);
    assert.ok(!["table", "chart", "kv", "list"].includes(anchor?.kind), `${seed.slug}:p11 narrative anchor bound ${anchor?.kind}`);
  }
});

test("dense table rendering clamps only the visual copy and preserves complete cell text", () => {
  assert.equal(deck.tableDensity({ columns: Array(8).fill("column"), rows: [Array(8).fill("short")] }), "high");
  assert.equal(deck.tableDensity({ columns: Array(4).fill("column"), rows: [["x".repeat(40), "", "", ""]] }), "medium");
  assert.equal(deck.tableDensity({ columns: ["a", "b", "c"], rows: [["one", "two", "three"]] }), "normal");
  const pages = deck.compileReferencePages(reports.boardReportSeeds[0].report);
  assert.equal(deck.tableDensity(pageAt(pages, 11, "density").artifacts[0]), "normal");
  for (const number of [25, 51]) {
    const tables = pageAt(pages, number, "density").artifacts.filter((artifact) => artifact.kind === "table");
    assert.ok(tables.length > 0 && tables.every((artifact) => deck.tableDensity(artifact) === "high"), `p${number}: high density`);
  }
  const p294 = pageAt(pages, 294, "density");
  const p294Strategy = p294.artifacts.find((artifact) => artifact.kind === "table" && artifact.contract_origin === "strategy");
  assert.equal(deck.tableDensity(p294Strategy), "medium");
  for (const number of [10, 294]) {
    const required = pageAt(pages, number, "numeric identifiers").artifacts.find((artifact) => artifact.contract_required === true);
    assert.notEqual(required?.kind, "chart", `p${number}: identifiers and time windows must not be treated as chart metrics`);
  }
  const start = deckSource.indexOf("function RefTable");
  const end = deckSource.indexOf("function RefBars", start);
  const source = deckSource.slice(start, end);
  assert.match(source, /data-table-density=\$\{density\}/);
  assert.match(source, /class="ref-cell-text" title=\$\{text\}>\$\{text\}/);
  assert.match(source, /class="ref-link ref-cell-text"[\s\S]*title=\$\{text\}/);
  assert.match(styleSource, /\.ref-table\[data-table-density="high"\] \.ref-cell-text\{-webkit-line-clamp:2;line-clamp:2\}/);
  assert.match(styleSource, /\.ref-table\[data-table-density="medium"\] \.ref-cell-text\{-webkit-line-clamp:3;line-clamp:3\}/);
  assert.doesNotMatch(styleSource, /\.ref-table\[data-table-density="normal"\][^{]*\{[^}]*line-clamp/);
});

test("strategy augmentations compile from explicit JTBD, STP, classic BCG, attractiveness-capability, and action contracts", () => {
  const expected = new Map([
    [10, ["augmentation.p10.strategy_action_register", "table"]],
    [25, ["augmentation.p25.strategy_jtbd", "table"]],
    [51, ["augmentation.p51.strategy_action_register", "table"]],
    [291, ["augmentation.p291.strategy_stp_overview", "kpi-cards"]],
    [292, ["augmentation.p292.strategy_stp_segmentation", "table"]],
    [293, ["augmentation.p293.strategy_stp_targeting_matrix", "table"]],
    [294, ["augmentation.p294.strategy_stp_target_selection", "table"]],
    [295, ["augmentation.p295.strategy_stp_positioning", "kpi-cards"]],
    [318, ["augmentation.p318.strategy_bcg_matrix", "table"]],
    [319, ["augmentation.p319.strategy_bcg_capital_actions", "table"]],
  ]);
  for (const seed of reports.boardReportSeeds) {
    const pages = deck.compileReferencePages(seed.report);
    for (const [number, [contractId, kind]] of expected) {
      const page = pageAt(pages, number, seed.slug);
      const artifact = page.artifacts.find((item) => item.contract_id === contractId);
      assert.ok(artifact, `${seed.slug}:p${number}: missing strategy artifact`);
      assert.equal(artifact.contract_required, false, `${seed.slug}:p${number}: strategy must remain optional`);
      assert.equal(artifact.contract_origin, "strategy", `${seed.slug}:p${number}: origin`);
      assert.equal(artifact.contract_placement, "sidecar", `${seed.slug}:p${number}: placement`);
      assert.equal(artifact.kind, kind, `${seed.slug}:p${number}: kind`);
      assert.ok(!["research", "contract"].includes(artifact.kind), `${seed.slug}:p${number}: generic fallback`);
      assert.doesNotMatch(JSON.stringify(artifact), /\bundefined\b|\bNaN\b|\[object Object\]/i, `${seed.slug}:p${number}`);
    }

    const p10Actions = pageAt(pages, 10, seed.slug).artifacts.find((item) => item.contract_origin === "strategy");
    const p51Actions = pageAt(pages, 51, seed.slug).artifacts.find((item) => item.contract_origin === "strategy");
    assert.deepEqual(Array.from(p10Actions.columns), ["ID / 优先级", "待办 / 交付物", "Owner", "时间", "状态", "依赖 / 证据", "验收 / 停止线"], `${seed.slug}: action columns`);
    assert.deepEqual(Array.from(p10Actions.rows, (row) => Array.from(row)), Array.from(p51Actions.rows, (row) => Array.from(row)), `${seed.slug}: p10/p51 action source`);
    const sourceAction = seed.report.modules.exec_summary_decision_scorecard.action_items[0];
    assert.match(p10Actions.rows[0][0], new RegExp(`${sourceAction.id}.*${sourceAction.priority}`), `${seed.slug}: action identity`);
    assert.match(p10Actions.rows[0][1], new RegExp(sourceAction.deliverable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 30)), `${seed.slug}: action deliverable`);
    assert.equal(p10Actions.rows[0][3], sourceAction.time_window, `${seed.slug}: action time window`);
    assert.equal(p10Actions.rows[0][4], sourceAction.status, `${seed.slug}: action status`);
    assert.match(p10Actions.rows[0][6], /停止：/, `${seed.slug}: action stop line`);
    for (const row of p10Actions.rows) {
      assert.match(row[6], /^指标：.+｜阈值：.+｜停止：/, `${seed.slug}: compact action acceptance`);
      assert.doesNotMatch(row[6], /证据：|签核人：|来源合同：/, `${seed.slug}: full acceptance stays in structured data`);
      assert.ok(row[6].length < 180, `${seed.slug}: board action summary stays page-safe`);
      assert.match(row[5], /证据锚点/, `${seed.slug}: evidence remains traceable without listing every id`);
    }

    const jtbd = pageAt(pages, 25, seed.slug).artifacts.find((item) => item.contract_origin === "strategy");
    assert.deepEqual(Array.from(jtbd.columns), ["JTBD 任务", "情境 / 触发", "期望进展", "当前障碍", "产品机会", "证据 ID", "验证门"], `${seed.slug}: JTBD columns`);
    const sourceJob = seed.report.modules.MIND_DECODE.jtbd.jobs.rows[0];
    assert.match(jtbd.rows[0][0], new RegExp(sourceJob[0]), `${seed.slug}: JTBD id`);
    assert.match(jtbd.rows[0][0], new RegExp(sourceJob[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 30)), `${seed.slug}: JTBD statement`);
    assert.equal(jtbd.rows[0][1], sourceJob[3], `${seed.slug}: JTBD situation`);
    assert.equal(jtbd.rows[0][2], sourceJob[4], `${seed.slug}: JTBD progress`);
    assert.equal(jtbd.rows[0][4], sourceJob[5], `${seed.slug}: JTBD product response`);
    assert.equal(jtbd.rows[0][5], sourceJob[6], `${seed.slug}: JTBD evidence`);
    assert.equal(jtbd.rows[0][6], sourceJob[7], `${seed.slug}: JTBD gate`);

    const stpOverview = pageAt(pages, 291, seed.slug).artifacts.find((item) => item.contract_origin === "strategy");
    assert.deepEqual(Array.from(stpOverview.items, (item) => item.label), ["S · Segmentation", "T · Targeting", "P · Positioning"], `${seed.slug}: STP overview`);
    assert.equal(stpOverview.items[1].value, seed.report.modules.market_map_segment_grade.stp.targeting.primary_target_id, `${seed.slug}: STP primary target`);
    const segmentation = pageAt(pages, 292, seed.slug).artifacts.find((item) => item.contract_origin === "strategy");
    const sourceSegment = seed.report.modules.market_map_segment_grade.stp.segmentation.matrix.rows[0];
    assert.deepEqual(Array.from(segmentation.columns), ["Segment ID", "细分", "操作性定义 / 核心任务", "需求 / 支付意愿", "公司匹配", "证据锚点", "目标状态 / 理由"], `${seed.slug}: segmentation columns`);
    assert.equal(segmentation.rows[0][0], sourceSegment[0], `${seed.slug}: segment id`);
    assert.equal(segmentation.rows[0][1], sourceSegment[1], `${seed.slug}: segment name`);
    assert.equal(segmentation.rows[0][4], sourceSegment[5], `${seed.slug}: segment fit`);
    assert.equal(segmentation.rows[0][5], sourceSegment[8], `${seed.slug}: segment evidence`);
    const targeting = pageAt(pages, 293, seed.slug).artifacts.find((item) => item.contract_origin === "strategy");
    assert.deepEqual(Array.from(targeting.columns), ["Segment ID", "细分", "吸引力", "公司胜算", "证据状态", "选择"], `${seed.slug}: targeting columns`);
    assert.deepEqual(Array.from(targeting.rows[0]), Array.from(seed.report.modules.market_map_segment_grade.stp.targeting.candidate_matrix.rows[0]), `${seed.slug}: targeting row`);
    const selection = pageAt(pages, 294, seed.slug).artifacts.find((item) => item.contract_origin === "strategy");
    assert.deepEqual(Array.from(selection.rows[0]).slice(0, 4), Array.from(seed.report.modules.market_map_segment_grade.stp.targeting.selection.rows[0]), `${seed.slug}: selection row`);

    const bcg = pageAt(pages, 318, seed.slug).artifacts.find((item) => item.contract_origin === "strategy");
    assert.deepEqual(Array.from(bcg.columns), ["品类", "观察窗口", "市场增速", "相对市场份额", "象限", "资本动作", "证据 / 置信"], `${seed.slug}: BCG columns`);
    assert.equal(bcg.rows.length, 5, `${seed.slug}: classic BCG must show five category rows`);
    assert.deepEqual(Array.from(bcg.rows, (row) => row[0]), Array.from(seed.report.modules.portfolio_correlation.bcg_matrix.entries.slice(0, 5), (entry) => entry.category), `${seed.slug}: BCG categories`);
    assert.equal(bcg.rows[0][0], seed.report.modules.portfolio_correlation.bcg_matrix.current_category, `${seed.slug}: BCG current category`);
    for (const row of bcg.rows) {
      assert.deepEqual(Array.from(row.slice(1, 6)), Array(5).fill("PENDING"), `${seed.slug}: BCG row must remain pending until both axes are evidenced`);
    }
    assert.match(bcg.note, /两项真实输入未齐备前.*不给出/, `${seed.slug}: classic BCG gate`);
    const attractivenessCapability = pageAt(pages, 319, seed.slug).artifacts.find((item) => item.contract_origin === "strategy");
    const sourceMatrix = seed.report.modules.portfolio_correlation.bcg_matrix.attractiveness_capability_matrix;
    assert.equal(attractivenessCapability.title, "市场吸引力 × 公司能力矩阵", `${seed.slug}: independent matrix title`);
    assert.deepEqual(Array.from(attractivenessCapability.columns), ["品类", "市场吸引力（管理判断）", "公司能力（管理判断）", "管理动作", "依据与下一步"], `${seed.slug}: independent matrix columns`);
    assert.deepEqual(Array.from(attractivenessCapability.rows, (row) => Array.from(row)), Array.from(sourceMatrix.rows.slice(0, 5), (row) => Array.from(row)), `${seed.slug}: independent matrix rows`);
    assert.doesNotMatch(`${attractivenessCapability.title} ${attractivenessCapability.note}`, /BCG|启发式代理/i, `${seed.slug}: independent matrix must not borrow BCG naming`);
    assert.match(attractivenessCapability.note, /独立的管理判断矩阵/, `${seed.slug}: independent matrix boundary`);
  }
});

test("consumer psychology and journey charts compile as grounded sidecars on pages 26 through 30", () => {
  const expected = new Map([
    [26, ["augmentation.p26.consumer_psychology_readiness", "strategy", "心理任务证据成熟度", "matrix"]],
    [27, ["augmentation.p27.value_risk_signal_map", "voc", "价值信号 × 风险信号", "points"]],
    [28, ["augmentation.p28.behavior_mechanism_flow", "strategy", "购买行为条件链", "nodes"]],
    [29, ["augmentation.p29.customer_journey_flow", "strategy", "端到端消费旅程", "nodes"]],
    [30, ["augmentation.p30.journey_touchpoint_pain_heatmap", "voc", "旅程阶段 × VOC 主题摩擦", "matrix"]],
  ]);
  for (const seed of reports.boardReportSeeds) {
    const pages = deck.compileReferencePages(seed.report);
    for (const [number, [contractId, origin, title, payloadKey]] of expected) {
      const artifact = pageAt(pages, number, seed.slug).artifacts.find((item) => item.contract_id === contractId);
      assert.ok(artifact, `${seed.slug}:p${number}: missing psychology/journey chart`);
      assert.equal(artifact.kind, "chart", `${seed.slug}:p${number}: chart kind`);
      assert.equal(artifact.contract_origin, origin, `${seed.slug}:p${number}: origin`);
      assert.equal(artifact.contract_required, false, `${seed.slug}:p${number}: optional sidecar`);
      assert.equal(artifact.contract_placement, "sidecar", `${seed.slug}:p${number}: sidecar placement`);
      assert.match(artifact.title, new RegExp(title), `${seed.slug}:p${number}: title`);
      assert.ok(Array.isArray(artifact.value[payloadKey]) && artifact.value[payloadKey].length, `${seed.slug}:p${number}: ${payloadKey}`);
      assert.match(artifact.note, /不是|不表示|不代表|不显示|属于/, `${seed.slug}:p${number}: evidence boundary`);
    }
  }
});

test("compiled pages contain at most three grounded artifacts and no generic filler", () => {
  const issues = [];
  const invalidText = /\bundefined\b|\bNaN\b|\[object Object\]/i;
  for (const seed of reports.boardReportSeeds) {
    const pages = deck.compileReferencePages(seed.report);
    for (const page of pages) {
      const artifacts = visibleArtifacts(page);
      if (artifacts.length > 3) issues.push(`ARTIFACT_LIMIT:${seed.slug}:p${page.number}:${artifacts.length}`);
      const serialized = JSON.stringify(artifacts);
      const filler = deck.REFERENCE_PREFLIGHT_FILLER_SIGNATURES.find((signature) => serialized.includes(signature));
      if (filler) issues.push(`GENERIC_FILLER:${seed.slug}:p${page.number}:${filler}`);
      const invalid = serialized.match(invalidText)?.[0];
      if (invalid) issues.push(`INVALID_TEXT:${seed.slug}:p${page.number}:${invalid}`);
    }
  }
  assertNoIssues(issues, "compiled artifact quality");
});

test("compiled tables and images stay within fixed-page rendering limits", () => {
  const issues = [];
  for (const seed of reports.boardReportSeeds) {
    for (const page of deck.compileReferencePages(seed.report)) {
      for (const artifact of visibleArtifacts(page)) {
        if (artifact.kind === "table") {
          const limit = Number(artifact.rowLimit) || tableRowLimit(artifact.columns?.length || 0);
          if (!Array.isArray(artifact.rows) || artifact.rows.length > limit) {
            issues.push(`TABLE_ROWS:${seed.slug}:p${page.number}:${artifact.rows?.length ?? "missing"}>${limit}`);
          }
          if (Array.from(artifact.columns || []).join("|") === "分析对象|本页摘要|审计入口" && artifact.rows.length > 4) {
            issues.push(`DIGEST_ROWS:${seed.slug}:p${page.number}:${artifact.rows.length}>4`);
          }
        }
        if (artifact.kind === "image" &&
          (typeof artifact.image !== "string" || !/\.(?:png|jpe?g|webp)(?:\?|$)/i.test(artifact.image))) {
          issues.push(`IMAGE_URL:${seed.slug}:p${page.number}:${String(artifact.image)}`);
        }
      }
    }
  }
  assertNoIssues(issues, "fixed-page artifact limits");
});

test("reports do not inherit legacy donor-product or another category's concept", () => {
  const issues = [];
  const legacyDonor = ["camping chair", "露营椅", "TerraGrip", "B0xxx", "椅脚下陷", "$37.90"];
  const concepts = reports.boardReportSeeds.map((seed) => ({
    slug: seed.slug,
    title: seed.report.modules.board_concept?.title || "",
    image: basename(seed.report.modules.board_concept?.image_url || ""),
  }));
  for (const seed of reports.boardReportSeeds) {
    const serialized = JSON.stringify(deck.compileReferencePages(seed.report));
    for (const token of legacyDonor) {
      if (serialized.toLocaleLowerCase().includes(token.toLocaleLowerCase())) {
        issues.push(`LEGACY_DONOR:${seed.slug}:${token}`);
      }
    }
    for (const concept of concepts) {
      if (concept.slug === seed.slug) continue;
      if (concept.title && serialized.includes(concept.title)) issues.push(`FOREIGN_CONCEPT:${seed.slug}:${concept.title}`);
      const sharedSchematic = seed.report.evidence_mode === "synthetic_fixture" &&
        concept.image === "furniture-concept.svg" &&
        seed.report.modules.board_concept?.image_provenance?.includes("软件演示示意图");
      if (concept.image && serialized.includes(concept.image) && !sharedSchematic) issues.push(`FOREIGN_IMAGE:${seed.slug}:${concept.image}`);
    }
  }
  assertNoIssues(issues, "cross-category isolation");
});

test("p234 and p309 preserve source architecture without donor market-size or EV numbers", () => {
  for (const seed of reports.boardReportSeeds) {
    const label = seed.slug;
    const pages = deck.compileReferencePages(seed.report);
    const p234 = pageAt(pages, 234, label);
    assert.deepEqual(Array.from(p234.artifacts, (artifact) => artifact.kind), ["callout", "callout", "table"], `${label}:p234 blocks`);
    const sizeTable = p234.artifacts[2];
    assert.deepEqual(
      Array.from(sizeTable.columns),
      ["层级", "口径定义", "年销量（件）", "均价（USD）", "市场规模（USD）", "占上层比"],
      `${label}:p234 six-column market-size architecture`,
    );
    assert.deepEqual(Array.from(sizeTable.rows, (row) => row[0]), ["TAM", "SAM", "SAM-核心带", "SOM", "SOM-Y1"], `${label}:p234 funnel rows`);
    sizeTable.rows.forEach((row, index) => {
      assert.equal(row[2], "PENDING", `${label}:p234 row${index + 1} annual units`);
      assert.equal(row[3], "待接入", `${label}:p234 row${index + 1} average price`);
      assert.match(row[4], /不可计算.*公式/, `${label}:p234 row${index + 1} market size`);
      if (index > 0) assert.match(row[5], /不可计算.*公式/, `${label}:p234 row${index + 1} parent share`);
    });
    assert.doesNotMatch(JSON.stringify(sizeTable), /4,820,000|204,850,000|1,969,800/, `${label}:p234 donor values`);

    const p309 = pageAt(pages, 309, label);
    assert.deepEqual(Array.from(p309.artifacts, (artifact) => artifact.kind), ["kpi-cards", "callout", "table"], `${label}:p309 blocks`);
    assert.equal(p309.artifacts[0].contract_visual, "kpi_cards", `${label}:p309 KPI visual contract`);
    assert.deepEqual(
      Array.from(p309.artifacts[0].items, (item) => item.label),
      ["AI 研究建议", "最优赛道", "概念总分", "放行条件"],
      `${label}:p309 four decision KPI cards`,
    );
    assert.equal(p309.artifacts[0].items[1].value, "PENDING", `${label}:p309 winning segment`);
    assert.equal(p309.artifacts[0].items[2].value, "PENDING", `${label}:p309 concept score`);
    assert.match(p309.artifacts[1].body, /EV 不可计算/, `${label}:p309 pending EV boundary`);
    const evTable = p309.artifacts[2];
    assert.deepEqual(
      Array.from(evTable.columns),
      ["候选赛道", "Beta（市场）", "Alpha（公司胜算）", "P（赢）", "赢时收益", "输时沉没", "EV", "裁决"],
      `${label}:p309 eight-column EV architecture`,
    );
    evTable.rows.forEach((row, index) => {
      assert.ok(row.slice(1, 6).every((cell) => cell === "PENDING"), `${label}:p309 row${index + 1} pending inputs`);
      assert.equal(row[6], "不可计算", `${label}:p309 row${index + 1} EV`);
      assert.equal(row[7], "待数据接入", `${label}:p309 row${index + 1} verdict`);
    });
    assert.match(evTable.note, /EV = .*PENDING 不等于 0/, `${label}:p309 formula boundary`);
    assert.doesNotMatch(JSON.stringify(p309.artifacts), /38%|0\.71|0\.37|-0\.65/, `${label}:p309 donor values`);
  }
});

test("reference-critical pages preserve the source PDF's evidence and decision architecture", () => {
  const conceptPageContracts = [
    [161, [["table", "候选概念矩阵与选型结论"]]],
    [162, [["chart", "概念 × 评估维度评分热力图"]]],
    [163, [["table", "特性-利益-证据（FBE）映射表"]]],
    [164, [["chart", "成本增量 × 差异度定位图"]]],
    [165, [["table", "专利 / IP 风险与规避设计表"]]],
    [166, [["chart", "入选概念可行性基准带雷达"], ["callout", "概念冻结决策"]]],
  ];
  const closingPageTitles = new Map([
    [323, ["风险登记册、最早信号与责任人"]],
    [324, ["风险等级、缓解动作与停止线"]],
    [325, ["概率边界与单位贡献敏感项"]],
    [326, ["关键假设、合规与残余风险", "经营结果区间与置信边界"]],
    [327, ["关键假设与董事会证据阈值", "TRUST 可信度与护栏"]],
    [328, ["护栏链 L0 → L5 执行结果", "引用可溯源与证据质量审计"]],
    [329, ["多模型 / 多层交叉验证与分歧处理"]],
    [330, ["轻人工终审记录"]],
    [331, ["数据来源清单"]],
    [332, ["方法论、观察窗口与计算规则", "方法局限、误差来源与缓解"]],
  ]);

  for (const seed of reports.boardReportSeeds) {
    const label = seed.slug;
    const pages = deck.compileReferencePages(seed.report);
    const voc = seed.report.modules.voc_evidence;
    const vocPages = [31, 32, 33].map((number) => pageAt(pages, number, label));
    const p31 = vocPages[0];
    const p32 = vocPages[1];
    const p33 = vocPages[2];

    assert.deepEqual(Array.from(p31.artifacts, (artifact) => artifact.kind), ["chart", "chart"], `${label}:p31`);
    assert.deepEqual(Array.from(p31.artifacts, (artifact) => artifact.title), ["VOC 机会白空间排序", "负向方面与改良切入点排序"], `${label}:p31`);
    assert.equal(
      p31.artifacts[0].value.items.reduce((sum, item) => sum + Number(item.value || 0), 0),
      voc.theme_distribution.rows.reduce((sum, row) => sum + Number(row[1] || 0), 0),
      `${label}:p31 total observations`,
    );
    assert.equal(
      p31.artifacts[1].value.items.reduce((sum, item) => sum + Number(item.value || 0), 0),
      voc.theme_distribution.rows.reduce((sum, row) => sum + Number(row[2] || 0), 0),
      `${label}:p31 negative observations`,
    );
    assert.equal(p32.artifacts[0].kind, "table", `${label}:p32 Kano must remain a table`);
    assert.ok(p32.artifacts[0].columns.includes("Kano 假设（非结论）"), `${label}:p32`);
    assert.equal(p33.artifacts[0].kind, "chart", `${label}:p33 cross table should render as a heatmap`);
    assert.equal(p33.artifacts[0].title, "使用场景与方面问题的交叉分布", `${label}:p33`);
    vocPages.flatMap((page) => page.artifacts).forEach((artifact) => {
      assert.match(artifact.note || "", /不外推为市场发生率/, `${label}:p${vocPages.find((page) => page.artifacts.includes(artifact))?.number}`);
    });
    assert.doesNotMatch(JSON.stringify(vocPages), /原始数据下载|DATA REQUIRED|evidence_downloads/i, `${label}:p31-33`);

    const sellerPages = Array.from({ length: 15 }, (_, index) => pageAt(pages, 52 + index, label));
    const p52 = pageAt(pages, 52, label);
    const p61 = pageAt(pages, 61, label);
    for (const page of sellerPages.filter((page) => ![52, 61].includes(page.number))) {
      assert.equal(page.artifacts.length, 1, `${label}:p${page.number}`);
      assert.equal(page.artifacts[0].kind, "contract", `${label}:p${page.number}`);
      assert.equal(page.artifacts[0].confidence, "PENDING", `${label}:p${page.number}`);
      assert.match(JSON.stringify(page.artifacts[0]), /尚未接入.*不输出模板数字/, `${label}:p${page.number}`);
    }
    assert.equal(p52.artifacts[0].kind, "seller-kpis", `${label}:p52 card renderer`);
    assert.equal(p52.artifacts[0].variant, "account-health", `${label}:p52 grid variant`);
    assert.deepEqual(
      Array.from(p52.artifacts[0].cards, (card) => card.label),
      ["账户健康评分 AHR", "订单缺陷率 ODR", "Late Shipment", "有效追踪率 VTR", "政策违规", "退货不满意率"],
      `${label}:p52 six account-health KPIs`,
    );
    assert.deepEqual(
      Array.from(p61.artifacts, (artifact) => artifact.title),
      ["卖家经营 KPI 总览"],
      `${label}:p61`,
    );
    assert.equal(p61.artifacts[0].kind, "seller-kpis", `${label}:p61 card renderer`);
    assert.equal(p61.artifacts[0].variant, "operating", `${label}:p61 grid variant`);
    assert.deepEqual(
      Array.from(p61.artifacts[0].cards, (card) => card.label),
      ["年度 GMV", "毛利率", "净利率", "投产比 ROI", "TACOS", "退货率", "库存周转", "复购率"],
      `${label}:p61 eight operating KPIs`,
    );
    for (const card of [...p52.artifacts[0].cards, ...p61.artifacts[0].cards]) {
      assert.equal(card.value, "PENDING", `${label}:${card.label}:value`);
      assert.equal(card.status, "待接入", `${label}:${card.label}:status`);
      assert.ok(card.threshold, `${label}:${card.label}:threshold`);
      assert.ok(card.requiredData, `${label}:${card.label}:required data`);
      assert.ok(card.action, `${label}:${card.label}:action`);
    }
    assert.match(sellerPages[0].artifacts[0].title, /账户健康看板/, `${label}:p52`);
    assert.match(sellerPages.at(-1).artifacts[0].title, /品牌资产建设/, `${label}:p66`);
    assert.doesNotMatch(JSON.stringify(sellerPages), /露营椅|AHR\s*236|0\.68%|\$61\.8万|24\.6%|13\.5%/i, `${label}:p52-66`);

    for (const [number, expectedArtifacts] of conceptPageContracts) {
      const page = pageAt(pages, number, label);
      assert.equal(page.artifacts.length, expectedArtifacts.length, `${label}:p${number}`);
      expectedArtifacts.forEach(([kind, title], index) => {
        assert.equal(page.artifacts[index].kind, kind, `${label}:p${number}:artifact${index + 1}`);
        if (title) assert.equal(page.artifacts[index].title, title, `${label}:p${number}:artifact${index + 1}`);
      });
    }
    const p161 = pageAt(pages, 161, label).artifacts[0];
    const p163 = pageAt(pages, 163, label).artifacts[0];
    const p164 = pageAt(pages, 164, label).artifacts[0];
    const p165 = pageAt(pages, 165, label).artifacts[0];
    const p166 = pageAt(pages, 166, label).artifacts[0];
    assert.equal(p161.rows.length, 6, `${label}:p161 six AIGC candidates`);
    assert.deepEqual(Array.from(p161.rows, (row) => String(row[0]).slice(0, 1)), ["A", "B", "C", "D", "E", "F"], `${label}:p161 candidate sequence`);
    assert.deepEqual(
      Array.from(p163.columns),
      ["特性（Feature）", "利益（Benefit）", "证据（Evidence）", "VOC 支持口径", "货架文案边界"],
      `${label}:p163 FBE architecture`,
    );
    assert.equal(p164.value.points.length, 6, `${label}:p164 six positioned concepts`);
    assert.deepEqual(
      Array.from(p165.columns),
      ["候选概念", "检索范围", "当前证据", "风险等级", "规避 / 设计绕行", "建议动作"],
      `${label}:p165 FTO design-around architecture`,
    );
    assert.equal(p165.rows.length, 6, `${label}:p165 six FTO rows`);
    assert.ok(p165.rows.every((row) => row[2].includes("PENDING") && row[3] === "PENDING"), `${label}:p165 no invented FTO result`);
    assert.equal(p166.value.series.length, 2, `${label}:p166 selected concept comparison`);
    assert.match(pageAt(pages, 162, label).artifacts[0].note, /不是消费者偏好.*Conjoint/, `${label}:p162 evidence boundary`);

    const p301 = pageAt(pages, 301, label);
    const p302 = pageAt(pages, 302, label);
    assert.equal(p301.artifacts[0].kind, "concept-compare", `${label}:p301`);
    assert.match(p301.artifacts[0].title, /产品概念.*竞品\/VOC 证据对标/, `${label}:p301`);
    assert.ok(p301.artifacts[0].image, `${label}:p301 AIGC concept image`);
    assert.match(p302.artifacts[0].title, /概念记分卡/, `${label}:p302 artifact 1`);
    assert.match(p302.artifacts[1].title, /核心升级点排序/, `${label}:p302 artifact 2`);

    for (const [number, expectedTitles] of closingPageTitles) {
      const page = pageAt(pages, number, label);
      assert.deepEqual(Array.from(page.artifacts, (artifact) => artifact.title), expectedTitles, `${label}:p${number}`);
      assert.ok(page.artifacts.every((artifact) => artifact.kind !== "research"), `${label}:p${number}`);
      assert.doesNotMatch(JSON.stringify(page.artifacts), /分析覆盖摘要/, `${label}:p${number}`);
    }
  }
});

test("an adopted scene suite stays a sidecar and preserves the 332-page concept contract", () => {
  const report = structuredClone(reports.boardReportSeeds[0].report);
  report.modules.board_concept.scene_suite = [
    ["hero_master", "主产品 3/4 Hero"],
    ["primary_lifestyle", "核心空间场景"],
    ["secondary_lifestyle", "第二使用情境"],
    ["functional_open_state", "功能 / 开合状态"],
    ["detail_cmf", "结构细节与 CMF"],
    ["packaging_logistics", "包装与物流视图"],
  ].map(([role, title], index) => ({
    role,
    title,
    sequence: index + 1,
    image_url: `/data/test-scene-${index + 1}.png`,
    design_dna_id: "TEST-DNA-R01",
  }));
  report.modules.board_concept.design_dna_id = "TEST-DNA-R01";
  const pages = deck.compileReferencePages(report);
  assert.equal(pages.length, 332);
  const p162 = pageAt(pages, 162, "scene-suite");
  const suite = p162.artifacts.find((artifact) => artifact.kind === "scene-suite");
  assert.ok(suite, "p162 scene suite sidecar");
  assert.equal(suite.contract_id, "augmentation.p162.aigc_concept_image");
  assert.equal(suite.contract_required, false);
  assert.equal(suite.contract_origin, "aigc");
  assert.equal(suite.total, 6);
  assert.equal(suite.items.length, 4, "PDF keeps four key images while web retains all six");
  assert.deepEqual(Array.from(suite.items, (item) => item.role), [
    "hero_master",
    "primary_lifestyle",
    "secondary_lifestyle",
    "functional_open_state",
  ]);
});

class FakeNode {
  constructor({
    page,
    requiredBlocks,
    contractId,
    text = "",
    rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
    clientWidth = rect.width,
    clientHeight = rect.height,
    scrollWidth = clientWidth,
    scrollHeight = clientHeight,
    naturalWidth,
    naturalHeight,
    src = "",
    parentElement = null,
  } = {}) {
    this.dataset = {
      ...(page == null ? {} : { page: String(page) }),
      ...(requiredBlocks == null ? {} : { requiredBlocks: String(requiredBlocks) }),
      ...(contractId == null ? {} : { contractId: String(contractId) }),
    };
    this.textContent = text;
    this.clientWidth = clientWidth;
    this.clientHeight = clientHeight;
    this.scrollWidth = scrollWidth;
    this.scrollHeight = scrollHeight;
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.src = src;
    this.currentSrc = src;
    this.parentElement = parentElement;
    this.rect = rect;
    this.matches = new Map();
  }

  getBoundingClientRect() {
    return this.rect;
  }

  querySelectorAll(selector) {
    return this.matches.get(selector) || [];
  }

  set(selector, nodes) {
    this.matches.set(selector, nodes);
    return this;
  }
}

function fakeDeck(count = 332) {
  const sheets = Array.from({ length: count }, (_, index) => new FakeNode({ page: index + 1 }));
  return {
    sheets,
    root: { querySelectorAll: (selector) => selector === ".ref-sheet" ? sheets : [] },
  };
}

test("DOM preflight accepts a clean 332-page deck", () => {
  const { root } = fakeDeck();
  const result = deck.inspectReferenceDeck(root);
  assert.equal(result.ok, true);
  assert.equal(result.sheetCount, 332);
  assert.equal(result.errors.length, 0);
});

test("DOM preflight rejects count, sequence, broken image, artifact, text, and filler defects", () => {
  const short = fakeDeck(331);
  assert.ok(short.root && deck.inspectReferenceDeck(short.root).errors.some((error) => error.code === "PAGE_COUNT"));

  const sequence = fakeDeck();
  sequence.sheets[10].dataset.page = "10";
  assert.ok(deck.inspectReferenceDeck(sequence.root).errors.some((error) => error.code === "PAGE_SEQUENCE"));

  const broken = fakeDeck();
  broken.sheets[0].set("img", [new FakeNode({ naturalWidth: 0, naturalHeight: 0, src: "/broken.png" })]);
  assert.ok(deck.inspectReferenceDeck(broken.root).errors.some((error) => error.code === "BROKEN_IMAGE"));

  const crowded = fakeDeck();
  crowded.sheets[0].set(".ref-artifacts > section", [new FakeNode(), new FakeNode(), new FakeNode(), new FakeNode()]);
  assert.ok(deck.inspectReferenceDeck(crowded.root).errors.some((error) => error.code === "ARTIFACT_LIMIT"));

  const missingContract = fakeDeck();
  missingContract.sheets[6].dataset.requiredBlocks = "1";
  assert.ok(deck.inspectReferenceDeck(missingContract.root).errors.some((error) => error.code === "CONTRACT_BLOCK_COUNT"));

  const invalid = fakeDeck();
  invalid.sheets[0].textContent = "销售额 NaN";
  assert.ok(deck.inspectReferenceDeck(invalid.root).errors.some((error) => error.code === "INVALID_TEXT"));

  const filler = fakeDeck();
  filler.sheets[0].textContent = `结论：${deck.REFERENCE_PREFLIGHT_FILLER_SIGNATURES[0]}`;
  assert.ok(deck.inspectReferenceDeck(filler.root).errors.some((error) => error.code === "GENERIC_FILLER"));

  const textOnlyDashboard = fakeDeck();
  const textArtifact = new FakeNode({ contractId: "reference.p14.OP_SCAN", text: "只有一句研究问题" });
  textArtifact.dataset.contractRequired = "true";
  textArtifact.dataset.contractVisual = "combo_dashboard";
  textArtifact.dataset.artifactKind = "text";
  textOnlyDashboard.sheets[13].dataset.requiredBlocks = "1";
  textOnlyDashboard.sheets[13].set('[data-contract-required="true"]', [textArtifact]);
  assert.ok(deck.inspectReferenceDeck(textOnlyDashboard.root).errors.some((error) => error.code === "DATA_VISUAL_WITH_TEXT_ONLY"));
});

test("DOM preflight catches nested rectangle and table-wrapper overflow", () => {
  const nested = fakeDeck();
  const sheet = nested.sheets[0];
  const child = new FakeNode({
    parentElement: sheet,
    rect: { left: 0, top: 0, right: 120, bottom: 40, width: 120, height: 40 },
    clientWidth: 120,
    clientHeight: 40,
    scrollWidth: 120,
    scrollHeight: 40,
  });
  sheet.set(".ref-artifacts > section", [child]);
  const nestedErrors = deck.inspectReferenceDeck(nested.root).errors;
  assert.ok(nestedErrors.some((error) => error.code === "OUTSIDE_SHEET" || error.code === "OUTSIDE_PARENT"));

  const tableDeck = fakeDeck();
  const wrapper = new FakeNode({
    parentElement: tableDeck.sheets[0],
    clientWidth: 60,
    clientHeight: 60,
    scrollWidth: 80,
    scrollHeight: 60,
    rect: { left: 10, top: 10, right: 70, bottom: 70, width: 60, height: 60 },
  });
  tableDeck.sheets[0].set(".ref-table-wrap", [wrapper]);
  const tableErrors = deck.inspectReferenceDeck(tableDeck.root).errors;
  assert.ok(tableErrors.some((error) => error.code === "CONTAINER_OVERFLOW" && error.selector === ".ref-table-wrap"));
});

test("DOM preflight applies the two-pixel tolerance and reports overflow dimensions exactly", () => {
  const tolerated = fakeDeck();
  tolerated.sheets[0].set(".ref-table-wrap", [new FakeNode({
    parentElement: tolerated.sheets[0],
    clientWidth: 100,
    clientHeight: 100,
    scrollWidth: 102,
    scrollHeight: 102,
  })]);
  assert.equal(
    deck.inspectReferenceDeck(tolerated.root).errors.filter((error) => error.code === "CONTAINER_OVERFLOW").length,
    0,
  );

  const rejected = fakeDeck();
  rejected.sheets[0].set(".ref-table-wrap", [new FakeNode({
    parentElement: rejected.sheets[0],
    clientWidth: 100,
    clientHeight: 100,
    scrollWidth: 103,
    scrollHeight: 103,
  })]);
  const overflow = deck.inspectReferenceDeck(rejected.root).errors.filter((error) => error.code === "CONTAINER_OVERFLOW");
  assert.equal(overflow.length, 2);
  assert.deepEqual(Array.from(overflow, (error) => error.axis).sort(), ["horizontal", "vertical"]);
  assert.ok(overflow.every((error) => error.overflow === 3 && error.scrollSize === 103 && error.clientSize === 100));
  assert.ok(overflow.every((error) => error.message.includes("3px")));
});

test("DOM preflight keeps the deepest violation per axis while retaining sibling roots", () => {
  const nested = fakeDeck();
  const sheet = nested.sheets[0];
  const parent = new FakeNode({
    parentElement: sheet,
    clientWidth: 100,
    clientHeight: 100,
    scrollWidth: 100,
    scrollHeight: 120,
  });
  const child = new FakeNode({
    parentElement: parent,
    clientWidth: 100,
    clientHeight: 60,
    scrollWidth: 100,
    scrollHeight: 80,
  });
  sheet.set(".ref-artifacts", [parent]);
  sheet.set(".ref-table-wrap", [child]);
  const nestedOverflow = deck.inspectReferenceDeck(nested.root).errors.filter((error) => error.code === "CONTAINER_OVERFLOW");
  assert.equal(nestedOverflow.length, 1);
  assert.equal(nestedOverflow[0].selector, ".ref-table-wrap");
  assert.equal(nestedOverflow[0].axis, "vertical");

  const siblings = fakeDeck();
  const siblingParent = new FakeNode({ parentElement: siblings.sheets[0] });
  const left = new FakeNode({ parentElement: siblingParent, clientHeight: 60, scrollHeight: 70 });
  const right = new FakeNode({ parentElement: siblingParent, clientHeight: 60, scrollHeight: 75 });
  siblings.sheets[0].set(".ref-artifacts", [siblingParent]);
  siblings.sheets[0].set(".ref-table-wrap", [left, right]);
  const siblingOverflow = deck.inspectReferenceDeck(siblings.root).errors.filter((error) => error.code === "CONTAINER_OVERFLOW");
  assert.equal(siblingOverflow.length, 2);
  assert.deepEqual(Array.from(siblingOverflow, (error) => error.overflow).sort((a, b) => a - b), [10, 15]);
});

test("DOM preflight deduplicates mixed axes independently and prefers OUTSIDE_PARENT", () => {
  const mixed = fakeDeck();
  const sheet = mixed.sheets[0];
  const parent = new FakeNode({
    parentElement: sheet,
    clientWidth: 100,
    clientHeight: 100,
    scrollWidth: 120,
    scrollHeight: 120,
  });
  const child = new FakeNode({
    parentElement: parent,
    clientWidth: 100,
    clientHeight: 60,
    scrollWidth: 100,
    scrollHeight: 80,
  });
  sheet.set(".ref-artifacts", [parent]);
  sheet.set(".ref-table-wrap", [child]);
  const mixedOverflow = deck.inspectReferenceDeck(mixed.root).errors.filter((error) => error.code === "CONTAINER_OVERFLOW");
  assert.equal(mixedOverflow.length, 2);
  assert.equal(mixedOverflow.find((error) => error.axis === "horizontal")?.selector, ".ref-artifacts");
  assert.equal(mixedOverflow.find((error) => error.axis === "vertical")?.selector, ".ref-table-wrap");

  const outside = fakeDeck();
  const outsideParent = new FakeNode({
    parentElement: outside.sheets[0],
    rect: { left: 0, top: 0, right: 90, bottom: 100, width: 90, height: 100 },
  });
  const outsideChild = new FakeNode({
    parentElement: outsideParent,
    rect: { left: 0, top: 0, right: 120, bottom: 100, width: 120, height: 100 },
  });
  outside.sheets[0].set(".ref-artifacts", [outsideParent]);
  outside.sheets[0].set(".ref-table-wrap", [outsideChild]);
  const outsideErrors = deck.inspectReferenceDeck(outside.root).errors.filter((error) => error.code.startsWith("OUTSIDE_"));
  assert.equal(outsideErrors.length, 1);
  assert.equal(outsideErrors[0].code, "OUTSIDE_PARENT");
  assert.equal(outsideErrors[0].axis, "horizontal");
  assert.equal(outsideErrors[0].overflow, 30);
});

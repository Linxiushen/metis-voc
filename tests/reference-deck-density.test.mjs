import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const deckPath = fileURLToPath(new URL("../public/reference-deck.js", import.meta.url));

const NARRATIVE_VISUALS = new Set([
  "callout",
  "verdict_callout",
  "section_intro",
  "section_intro_callout",
]);
const SECTION_INTRO_ROLES = new Set(["section_intro", "section_intro_callout"]);

let server;
let reports;
let deck;
let compiledDecks;

function loadDeckModule(source) {
  const executable = source
    .replace(/^import\s+.*;\s*$/gm, "")
    .replace(/\bexport\s+(?=(?:const|function)\b)/g, "") + `
globalThis.__deckDensityExports = { compileReferencePages };`;
  const context = vm.createContext({
    console,
    h() {},
    htm() {},
    useEffect() {},
    useState(value) { return [value, () => {}]; },
  });
  vm.runInContext(executable, context, { filename: deckPath });
  return context.__deckDensityExports;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasPopulatedRows(value, minimum = 1) {
  return Array.isArray(value) && value.length >= minimum && value.some((row) =>
    Array.isArray(row)
      ? row.some((cell) => text(String(cell ?? "")))
      : row && typeof row === "object"
        ? Object.values(row).some((cell) => text(String(cell ?? "")))
        : text(String(row ?? "")),
  );
}

function hasChartPayload(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value.items)) {
    return value.items.length >= 2 && value.items.every((item) =>
      item && typeof item === "object" && text(String(item.label ?? "")) && text(String(item.value ?? "")),
    );
  }
  if (Array.isArray(value.xLabels) && Array.isArray(value.matrix)) {
    return value.xLabels.length >= 2 && value.matrix.length >= 2 && value.matrix.some((row) => hasPopulatedRows([row], 1));
  }
  if (Array.isArray(value.axes) && Array.isArray(value.series)) {
    return value.axes.length >= 3 && value.series.some((series) =>
      Array.isArray(series?.scores || series?.data) && (series.scores || series.data).length >= 3,
    );
  }
  if (Array.isArray(value.labels)) {
    const series = Array.isArray(value.series) ? value.series : [
      ...(Array.isArray(value.bars) ? [{ data: value.bars }] : []),
      ...(Array.isArray(value.line) ? [{ data: value.line }] : []),
    ];
    return value.labels.length >= 2 && series.some((item) =>
      Array.isArray(item?.points || item?.data || item?.scores) && (item.points || item.data || item.scores).length >= 2,
    );
  }
  if (Array.isArray(value.points)) return value.points.length >= 2;
  return Array.isArray(value.nodes) && value.nodes.length >= 2 && Array.isArray(value.links) && value.links.length >= 1;
}

function completeResearchCard(artifact) {
  if (!artifact || !["research", "contract"].includes(artifact.kind)) return false;
  if (![artifact.question, artifact.finding, artifact.gate].every((value) => text(value))) return false;
  if (!Array.isArray(artifact.cards) || artifact.cards.length < 3) return false;
  return artifact.cards.slice(0, 3).every((card) =>
    card && text(card.label) && text(String(card.value ?? "")) && text(card.note),
  );
}

function structuredArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return false;
  switch (artifact.kind) {
    case "table":
      return Array.isArray(artifact.columns) && artifact.columns.length >= 2 && hasPopulatedRows(artifact.rows);
    case "chart":
      return hasChartPayload(artifact.value);
    case "image":
      return Boolean(text(artifact.image));
    case "list":
      return Array.isArray(artifact.items) && artifact.items.filter((item) => text(String(item ?? ""))).length >= 2;
    case "kv":
      return hasPopulatedRows(artifact.rows, 2);
    case "kpi-cards":
      return Array.isArray(artifact.items) && artifact.items.filter((item) => item && text(item.label) && text(String(item.value ?? ""))).length >= 2;
    case "seller-kpis":
      return Array.isArray(artifact.cards) && artifact.cards.filter((card) => card && text(card.label) && text(String(card.value ?? ""))).length >= 2;
    case "comparison":
      return hasPopulatedRows(artifact.left?.rows) && hasPopulatedRows(artifact.right?.rows);
    case "concept-compare":
      return Boolean(text(artifact.image)) && (hasPopulatedRows(artifact.benchmark?.rows) || hasPopulatedRows(artifact.translation?.rows));
    case "trust-quality":
      return hasPopulatedRows(artifact.dimensions, 2) || (Array.isArray(artifact.segments) && artifact.segments.length >= 2);
    case "methodology-grid":
      return Array.isArray(artifact.cards) && artifact.cards.filter((card) => card && text(card.title) && text(card.body)).length >= 2;
    case "warning-list":
      return Array.isArray(artifact.items) && artifact.items.filter((item) => item && text(item.title) && text(item.risk) && text(item.mitigation)).length >= 2;
    default:
      return false;
  }
}

function narrativeLength(artifact) {
  return [artifact?.title, artifact?.tag, artifact?.body]
    .map((value) => text(String(value ?? "")))
    .join("")
    .length;
}

function majorArtifactClass(artifact) {
  switch (artifact?.kind) {
    case "table":
    case "kv":
    case "comparison":
      return "tabular";
    case "chart":
      return "chart";
    case "image":
    case "concept-compare":
      return "media";
    case "kpi-cards":
    case "seller-kpis":
    case "trust-quality":
    case "methodology-grid":
    case "warning-list":
    case "list":
      return "cards";
    case "research":
    case "contract":
      return "research-contract";
    case "text":
    case "callout":
      return "narrative";
    default:
      return `unknown:${String(artifact?.kind)}`;
  }
}

function requiredArtifact(page, block) {
  return (page.artifacts || []).find((artifact) => artifact.contract_id === block.id && artifact.contract_required === true);
}

function assertNoIssues(issues, label) {
  assert.equal(
    issues.length,
    0,
    `${label}: ${issues.length} issue(s)\n${issues.slice(0, 30).join("\n")}`,
  );
}

before(async () => {
  deck = loadDeckModule(await readFile(deckPath, "utf8"));
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
  });
  reports = await server.ssrLoadModule("/lib/board-reports.ts");
  compiledDecks = reports.boardReportSeeds.map((seed) => ({
    slug: seed.slug,
    report: seed.report,
    pages: deck.compileReferencePages(seed.report),
  }));
});

after(async () => {
  await server?.close();
});

test("density gate audits all five canonical 332-page reports", () => {
  assert.equal(compiledDecks.length, 5, "the release gate must cover exactly five product reports");
  for (const item of compiledDecks) {
    assert.equal(item.pages.length, 332, item.slug);
    assert.deepEqual(
      Array.from(item.pages, (page) => page.number),
      Array.from({ length: 332 }, (_, index) => index + 1),
      item.slug,
    );
  }
});

test("rich visual contracts are never occupied only by text or a short callout", () => {
  const issues = [];
  for (const { slug, pages } of compiledDecks) {
    for (const page of pages.filter((candidate) => candidate.kind === "module")) {
      const richBlocks = (page.plan?.reference_blocks || []).filter((block) => !NARRATIVE_VISUALS.has(block.visual));
      if (!richBlocks.length) continue;
      const bound = richBlocks.map((block) => requiredArtifact(page, block)).filter(Boolean);
      if (bound.length !== richBlocks.length) {
        issues.push(`MISSING_RICH_BLOCK:${slug}:p${page.number}:${bound.length}/${richBlocks.length}`);
        continue;
      }
      const narrativeOnly = bound.every((artifact) =>
        artifact.kind === "text" || (artifact.kind === "callout" && narrativeLength(artifact) < 160),
      );
      if (narrativeOnly) {
        issues.push(`RICH_VISUAL_NARRATIVE_ONLY:${slug}:p${page.number}:${bound.map((artifact) => artifact.kind).join("+")}`);
      }
    }
  }
  assertNoIssues(issues, "rich visual density");
});

test("every non-intro report page has structured evidence or a complete research contract", () => {
  const issues = [];
  for (const { slug, pages } of compiledDecks) {
    for (const page of pages.filter((candidate) => candidate.kind === "module")) {
      if (SECTION_INTRO_ROLES.has(page.plan?.role)) continue;
      const artifacts = page.artifacts || [];
      if (!artifacts.some((artifact) => structuredArtifact(artifact) || completeResearchCard(artifact))) {
        issues.push(`LOW_INFORMATION_PAGE:${slug}:p${page.number}:${artifacts.map((artifact) => artifact.kind).join("+") || "empty"}`);
      }
    }
  }
  assertNoIssues(issues, "full-deck information density");
});

test("required artifact classes stay aligned across categories on every page", () => {
  const issues = [];
  const baseline = compiledDecks[0];
  for (let pageIndex = 6; pageIndex < 332; pageIndex += 1) {
    const baselinePage = baseline.pages[pageIndex];
    const blocks = baselinePage.plan?.reference_blocks || [];
    const baselineSignature = blocks.map((block) => {
      const artifact = requiredArtifact(baselinePage, block);
      return `${block.id}=${majorArtifactClass(artifact)}`;
    }).join("|");
    for (const candidate of compiledDecks.slice(1)) {
      const page = candidate.pages[pageIndex];
      const signature = blocks.map((block) => {
        const artifact = requiredArtifact(page, block);
        return `${block.id}=${majorArtifactClass(artifact)}`;
      }).join("|");
      if (signature !== baselineSignature) {
        issues.push(`CROSS_CATEGORY_DRIFT:p${baselinePage.number}:${baseline.slug}[${baselineSignature}]!=${candidate.slug}[${signature}]`);
      }
    }
  }
  assertNoIssues(issues, "cross-category artifact stability");
});

test("p14 contains structured OP_SCAN evidence or a complete contract card", () => {
  const issues = [];
  for (const { slug, pages } of compiledDecks) {
    const page = pages[13];
    const blocks = page?.plan?.reference_blocks || [];
    const required = blocks.map((block) => requiredArtifact(page, block)).filter(Boolean);
    if (page?.number !== 14 || page.id !== "OP_SCAN") {
      issues.push(`P14_IDENTITY:${slug}:${page?.number}:${page?.id}`);
      continue;
    }
    if (!blocks.some((block) => block.visual === "combo_dashboard")) {
      issues.push(`P14_CONTRACT:${slug}:${blocks.map((block) => block.visual).join("+")}`);
    }
    if (!required.some((artifact) => structuredArtifact(artifact) || completeResearchCard(artifact))) {
      issues.push(`P14_DENSITY:${slug}:${required.map((artifact) => artifact.kind).join("+") || "empty"}`);
    }
  }
  assertNoIssues(issues, "p14 OP_SCAN density");
});

test("forecast and GTM pages render visible evidence instead of empty chart shells", () => {
  const issues = [];
  for (const { slug, pages } of compiledDecks) {
    const p44 = pages[43]?.artifacts?.find((artifact) => artifact.contract_required === true);
    if (!completeResearchCard(p44) || p44.contract_source_path !== "modules.output_unit_economics_finance.demand_forecast_input_gate") {
      issues.push(`P44_FORECAST_CONTRACT:${slug}:${p44?.kind}:${p44?.contract_source_path}`);
    }
    const expected = new Map([
      [48, "modules.gtm_plan.positioning_advertising_input_gate"],
      [49, "modules.gtm_plan.channel_message"],
      [50, "modules.keyword_strategy_matrix.matrix"],
      [51, "modules.gtm_plan.launch_sequence"],
    ]);
    for (const [pageNumber, sourcePath] of expected) {
      const artifact = pages[pageNumber - 1]?.artifacts?.find((item) => item.contract_required === true);
      if (artifact?.contract_source_path !== sourcePath || (!structuredArtifact(artifact) && !completeResearchCard(artifact))) {
        issues.push(`GTM_VISIBLE_DENSITY:${slug}:p${pageNumber}:${artifact?.kind}:${artifact?.contract_source_path}`);
      }
      if (artifact?.kind === "chart" && !hasChartPayload(artifact.value)) {
        issues.push(`GTM_EMPTY_CHART:${slug}:p${pageNumber}`);
      }
    }
  }
  assertNoIssues(issues, "forecast and GTM visible density");
});

/** Regenerate fictional fixtures without copying third-party review text. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const provenance = {
  synthetic: true,
  source_mode: "synthetic_fixture",
  description: "人工编写的虚构软件测试样例；不含真实用户评价，不代表真实品牌、市场、公司或经营结果。",
  evidence_mode: "template_demo",
  decision_readiness: "insufficient_evidence",
};
const note = "SYNTHETIC｜虚构软件测试条目；没有真实来源、评论、评分或经营证据。";
const signalTemplates = [
  ["negative", "装配与说明", "【虚构样例】演示角色希望操作步骤标出部件方向。", "测试两版说明图的理解方式。"],
  ["positive", "尺寸与场景适配", "【虚构样例】演示角色认为尺寸示意方便规划空间。", "用纸板模型测试尺寸卡的表达。"],
  ["mixed", "包装与履约", "【虚构样例】演示角色希望配件收纳位置容易识别。", "设计配件分组标识并进行模拟开箱。"],
];
function source(slug, id, index) {
  return {
    id, channel: "Synthetic", product: `虚构 ${slug} 样例 ${index + 1}`,
    rating: "不适用（合成样例）", ratingCount: 0, reviewCount: 0, observed: "2000-01-01",
    url: `https://example.com/metis/synthetic/${slug}/${id}`,
    pageType: "synthetic_fixture", sampleCaveat: note, evidenceType: "synthetic_fixture",
    ...provenance,
    signals: signalTemplates.map(([polarity, theme, text, action], signalIndex) => ({
      polarity, theme, paraphrase: text, evidence: text, productAction: action,
      evidenceAnchor: `${id}-DEMO-${signalIndex + 1}`, basis: note, trace: note, synthetic: true,
    })),
  };
}
function sources(slug, prefix, count, start = 1) {
  return Array.from({ length: count }, (_, i) => source(slug, `${prefix}${String(i + start).padStart(2, "0")}`, i));
}
async function json(file, value) {
  await writeFile(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
const night = sources("nightstands", "VOC-NS-", 4, 8);
const side = sources("sideboard", "VOC-SB-", 4, 8);
const drawer = sources("drawer-cabinet", "VOC-DC-EXT-", 5);
const coffee = sources("coffee-bar-counter", "VOC-CB-EXT-", 6);
const bed = sources("slatted-platform-bed", "VOC-BED-X", 6);
const nightSide = {
  schemaVersion: "metis-synthetic-1", observed: "2000-01-01", scope: ["nightstands", "sideboard"], ...provenance,
  methodology: { rule: note, actionBasis: "仅测试软件", countCaveat: "真实评论数量为 0", syndicationCaveat: "不存在真实同步评论" },
  categories: Object.fromEntries([["nightstands", night], ["sideboard", side]].map(([slug, entries]) => [slug, {
    newSourceCount: entries.length, newSignalCount: entries.length * 3, publicReviewUniverse: 0, sources: entries,
  }])),
  verification: { existingUrlCheck: { file: "synthetic", result: "NOT_REAL_EVIDENCE" }, totals: { sourcePages: 8, signals: 24, publicReviewUniverse: 0 }, qualityChecks: [note] },
};
const drawerCoffee = {
  schemaVersion: "metis-synthetic-1", observed: "2000-01-01", scope: ["drawer-cabinet", "coffee-bar-counter"], ...provenance,
  method: { definition: note, guardrails: ["不能作为真实 VOC", "不能据此批准采购或上市"] },
  categories: { "drawer-cabinet": drawer, "coffee-bar-counter": coffee },
  counts: { "drawer-cabinet": { sources: 5, signals: 15, channels: 1 }, "coffee-bar-counter": { sources: 6, signals: 18, channels: 1 }, total: { sources: 11, signals: 33 } },
};
const bedData = {
  ...provenance,
  meta: { ...provenance, task: "合成数据契约测试", observed: "2000-01-01", market: "SYNTHETIC", methodology: note,
    newBedCoverage: { independentPages: 6, consumerSignals: 18, ratedReviewUniverse: 0, channels: ["Synthetic"], duplicateWithExistingLib: false }, urlAuditRule: "example.com 是占位域名，不发起真实来源校验" },
  newSlattedPlatformBedVoc: bed, marketRawUrlAudit: [], existingVocUrlExceptions: [], integrationRecommendations: [note],
};
for (const [local, publicPath, value] of [
  ["data/voc_night_sideboard_2026-08-01.json", "public/data/voc-2026/voc-nightstands-sideboard.json", nightSide],
  ["data/voc_drawer_coffee_2026-08-01.json", "public/data/voc-2026/voc-drawer-coffee.json", drawerCoffee],
  ["data/voc_bed_market_qa_2026-08-01.json", "public/data/voc-2026/voc-bed-market-qa.json", bedData],
]) { await json(local, value); await json(publicPath, value); }

// Retain the presentation schema, replacing record values with deterministic fixtures.
// A schema path, never the old numeric value, determines each replacement number.
function seedFor(fieldPath) {
  return [...fieldPath].reduce((sum, char) => (sum * 31 + char.codePointAt(0)) >>> 0, 7);
}
const stableTextFields = new Set(["id", "key", "code", "type", "unit", "currency", "dimension", "aspect", "polarity", "status", "color", "icon", "module_id", "subsection_id", "formula"]);
const explanatoryFields = /^(?:note|summary|evidence|confidence_note|confidenceSource|finding|source_record|coverage|positioning|verdict|verdict_text|insight|conclusion|reason|recommendation|acceptance|trigger|expected_gain|our_counter|weak_point|statement|quote|text|description|body|result|source|basis|signal|action|mitigation|limitation|method_note|decision)$/i;
function fixture(value, fieldPath = "", key = "") {
  if (Array.isArray(value)) return value.map((item, index) => fixture(item, `${fieldPath}[${index}]`, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([name]) => name !== "fixture_provenance").map(([name, item]) => [name, fixture(item, `${fieldPath}.${name}`, name)]));
  if (typeof value === "number") {
    if (/year|width|height|colspan|rowspan/.test(key)) return value;
    if (/percent|ratio|rate|share|weight|confidence|margin/.test(key) || (value > 0 && value < 1)) return Number(((seedFor(fieldPath) % 8 + 1) / 10).toFixed(2));
    return seedFor(fieldPath) % 9 + 1;
  }
  if (typeof value !== "string") return value;
  if (key === "createdBy" || /email/i.test(key) || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(value)) return "demo@example.com";
  if (/createdAt|observed|capturedAt|verifiedAt|updatedAt/i.test(key)) return "2000-01-01T00:00:00Z";
  if (/^https?:\/\//.test(value) || /url|href/i.test(key)) return `https://example.com/metis/synthetic/${seedFor(fieldPath)}`;
  if (/asin/i.test(key) || /^B0[A-Z0-9]{8}$/.test(value)) return `B0DEMO${String(seedFor(fieldPath) % 10000).padStart(4, "0")}`;
  if (/brand|seller|author|reviewer|owner|person|operator/i.test(key) || /excludeBrands/.test(fieldPath) || key === "name") return "虚构样例角色";
  if (/value_display|formatted_value|display_value/.test(key)) return "合成示例值";
  if (key === "quote") return "【原创虚构样例】演示角色希望使用说明清楚标出部件方向；这不是消费者评价。";
  if (key === "title" && /competitor|product|listing/.test(fieldPath)) return `虚构样例商品 ${seedFor(fieldPath) % 9 + 1}`;
  if (explanatoryFields.test(key)) return note;
  if (stableTextFields.has(key)) return value;
  if (/B0[A-Z0-9]{8}|https?:\/\/|[A-Za-z]:[\\/]|亿元|销售额|自有物流|真实采集|实测|Amazon.*review/i.test(value) || value.length > 70) return note;
  return value;
}
const chair = fixture(JSON.parse(await readFile(path.join(root, "data/chair_report.json"), "utf8")));
for (const section of Object.values(chair)) if (section && typeof section === "object") section.fixture_provenance = provenance;
const brief = chair["input-research-brief-wizard"];
brief.briefId = "BRF-SYNTHETIC-DEMO";
brief.createdBy = "demo@example.com";
brief.createdAt = "2000-01-01T00:00:00Z";
brief.caseName = "合成报告样例｜不代表真实市场";
await json("data/chair_report.json", chair);
await json("public/data/chair_report.json", chair);
for (const [moduleId, value] of Object.entries(chair)) await json(`public/data/mod/${moduleId}.json`, value);
for (const file of ["ext_report.json", "voc_gold.json"]) {
  const value = fixture(JSON.parse(await readFile(path.join(root, "data", file), "utf8")));
  if (file === "ext_report.json") {
    value.compdeep_strategic_groups_listing.sg_scatter_map.points.forEach((item, index) => { item.label = `虚构方案 ${index + 1}`; });
    for (const table of [value.compdeep_strategic_groups_listing.sg_listing_score, value.compdeep_moat_priceband_war.mb_moat_dissect]) {
      table.columns = table.columns.map((item, index) => index ? `虚构方案 ${index}` : item);
      table.rows = table.rows.map((row, rowIndex) => Object.fromEntries(Object.values(row).map((cell, columnIndex) => [
        table.columns[columnIndex],
        columnIndex === 0 ? cell : typeof cell === "number" ? (rowIndex + columnIndex) % 9 + 1 : "合成演示值",
      ])));
    }
    value.compdeep_moat_priceband_war.mb_review_wall.forEach((item, index) => { item.metric = `合成观察 ${index + 1}`; });
    value.keyword_strategy_matrix.kw_matrix_table.rows.forEach((item, index) => { item["代表词"] = `synthetic product feature ${index + 1}`; });
    value.keyword_strategy_matrix.kw_opportunity_scatter.points.forEach((item, index) => { item.label = `虚构词组 ${index + 1}`; });
    for (const section of Object.values(value)) if (section && typeof section === "object") section.fixture_provenance = provenance;
  } else {
    value.fixture_provenance = provenance;
  }
  await json(`data/${file}`, value);
  await json(`public/data/${file}`, value);
}
console.log(JSON.stringify({ generated: "synthetic fixtures", rawReviewsIncluded: 0, thirdPartyImagesIncluded: 0 }));

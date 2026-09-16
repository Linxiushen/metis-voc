import chairDataRaw from "@/data/chair_report.json";
import extDataRaw from "@/data/ext_report.json";
import extMetaRaw from "@/data/ext_meta.json";
import vocDataRaw from "@/data/voc_gold.json";
import vocMetaRaw from "@/data/voc_gold_meta.json";
import { finalizeReportForPersistence } from "./report-integrity";

// Report modules intentionally accept heterogeneous extension schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonObject = Record<string, any>;

const chairData = chairDataRaw as JsonObject;
const extData = extDataRaw as JsonObject;
const extMeta = extMetaRaw as JsonObject;
const vocData = vocDataRaw as JsonObject;
const vocMeta = vocMetaRaw as JsonObject;

const nodes = [
  ["OP_SCAN", "品类机会扫描"],
  ["MKT_STRUCT", "市场结构解剖"],
  ["MIND_DECODE", "消费者心智 / VOC 解码"],
  ["CPT_VERIFY", "选品清单验证"],
  ["GTM_PLAN", "上市打法"],
] as const;

const outputOrder = [
  "exec_summary_decision_scorecard",
  "OP_SCAN",
  "MKT_STRUCT",
  "MIND_DECODE",
  "competitor_teardown",
  "CPT_VERIFY",
  "output_unit_economics_finance",
  "gtm_plan",
  "risk_register_sensitivity_confidence",
  "trust_guardrails_methodology",
];

const TEMPLATE_DEMO_NOTE =
  "重要：本报告仅为模板演示，正文市场、VOC、竞品与财务数字来自静态折叠露营椅样例，并非当前品类的实时调查结果。证据不足，禁止据此作出立项、采购、定价或上市决策。";

export const pipelineNodes = nodes;

export function categoryLabel(mode: string, payload: unknown): string {
  if (mode === "category_keyword") {
    return Array.isArray(payload) ? payload.join(" ") : String(payload || "未命名品类");
  }
  if (Array.isArray(payload) && payload.length) return `选品分析（${payload.length} 个 ASIN）`;
  return String(payload || "未命名品类");
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

export function generateResearchPlan(
  mode: string,
  payload: unknown,
  marketplace: string,
  researchBrief: JsonObject = {},
): JsonObject {
  const category = categoryLabel(mode, payload);
  const briefCompetitors = Array.isArray(researchBrief.competitors)
    ? researchBrief.competitors
      .map((item: JsonObject) => String(item?.asin || "").trim().toUpperCase())
      .filter((asin: string) => /^[A-Z0-9]{10}$/.test(asin))
    : [];
  const seedValues = Array.isArray(payload) && payload.length
    ? payload.slice(0, 8).map(String)
    : briefCompetitors.slice(0, 8);
  const windowDays = clampNumber(researchBrief.dataWindow, 90, 30, 365);
  const goals = Array.isArray(researchBrief.goals) ? researchBrief.goals.slice(0, 8) : [];
  const marketplaces = Array.isArray(researchBrief.marketplaces)
    ? researchBrief.marketplaces.slice(0, 10)
    : [marketplace];
  const openQuestions = [
    !researchBrief.priceRange ? "目标价格带与最低可接受净利率是多少？" : "",
    !briefCompetitors.length && mode !== "asin_list" ? "是否有必须纳入的种子竞品 ASIN？" : "",
    marketplaces.length > 1 ? `多站点是否采用统一产品定义（${marketplaces.join(" / ")}）？` : "",
    researchBrief.strictness === "strict" ? "严格终审下，哪些证据缺口会直接触发 no-go？" : "",
  ].filter(Boolean);
  return {
    category_scope: category,
    marketplace,
    seed_competitors: seedValues.map((asin: string) => ({
      asin,
      reason: "用户提供的种子竞品",
    })),
    dimensions: nodes.map(([id]) => id),
    data_window_days: windowDays,
    est_duration_min: goals.includes("teardown") ? 48 : 35,
    est_token: goals.length > 3 ? 1_800_000 : 1_200_000,
    open_questions: openQuestions,
    research_brief: researchBrief,
  };
}

function decisionFunnel(modules: JsonObject, decisionReady = true): JsonObject {
  const cells = Array.isArray(modules.OP_SCAN?.niche_matrix?.cells)
    ? modules.OP_SCAN.niche_matrix.cells
    : [];
  const universe = cells.length;
  const opportunityPass = cells.filter((cell: JsonObject) => Number(cell.opp_score) >= 65).length;
  const competitionPass = cells.filter(
    (cell: JsonObject) =>
      Number(cell.opp_score) >= 65 && !["高", "极高"].includes(String(cell.competition || "")),
  ).length;
  const unmetNeeds = Array.isArray(modules.MIND_DECODE?.unmet_matrix)
    ? modules.MIND_DECODE.unmet_matrix
    : [];
  const validatedNeeds = unmetNeeds.filter((need: JsonObject) =>
    Number(need.frequency) > 0 && Number(need.severity) > 0 && Number(need.solvability) > 0
  ).length;
  const demandPass = Math.min(competitionPass, validatedNeeds);
  const scenarios = Array.isArray(modules.output_unit_economics_finance?.pricing_scenarios)
    ? modules.output_unit_economics_finance.pricing_scenarios
    : [];
  const economicsPass = scenarios.some((scenario: JsonObject) => Number(scenario.net_margin_pct) >= 8)
    ? Math.min(demandPass, 1)
    : 0;
  const feasibilityPresent = Boolean(modules.CPT_VERIFY?.feasibility);
  const riskEvidence = modules.risk_register_sensitivity_confidence?.risk_register;
  const riskEvidencePresent = Array.isArray(riskEvidence) && riskEvidence.length > 0;
  const decision = modules.exec_summary_decision_scorecard?.decision || {};
  const finalVerdict = modules.CPT_VERIFY?.finalVerdict || {};
  const computedStages = [
    {
      id: "universe",
      label: "品类宇宙",
      in: universe,
      out: universe,
      criteria: "从品类词展开的全部候选利基（价格带 × 子品类）",
    },
    {
      id: "opp",
      label: "机会分门槛",
      in: universe,
      out: opportunityPass,
      threshold: "机会分 ≥ 65",
      criteria: "需求×增速×竞争×变现×季节 加权",
      actual: cells.length ? `${opportunityPass} 个候选达标` : "PENDING",
      evidence_present: cells.length > 0,
    },
    {
      id: "compete",
      label: "竞争可切入",
      in: opportunityPass,
      out: competitionPass,
      threshold: "非红海 / 有差异化空间",
      criteria: "评论墙可绕过 + 集中度可承受",
      actual: cells.length ? `${competitionPass} 个候选达标` : "PENDING",
      evidence_present: cells.length > 0,
    },
    {
      id: "demand",
      label: "需求 / VOC 验证",
      in: competitionPass,
      out: demandPass,
      threshold: "存在未满足需求（白空间 ⭐）",
      criteria: "差评白空间 + 需求量达标",
      actual: unmetNeeds.length ? `${validatedNeeds} 个需求具有完整量化字段` : "PENDING",
      evidence_present: unmetNeeds.length > 0,
    },
    {
      id: "econ",
      label: "单位经济达标",
      in: demandPass,
      out: economicsPass,
      threshold: "净利率 ≥ 8% @ 甜蜜区",
      criteria: "售价 × 成本 × ACOS 单位经济",
      actual: scenarios.length
        ? economicsPass > 0 ? "存在净利率达标情景" : "无净利率达标情景"
        : "PENDING",
      evidence_present: scenarios.length > 0,
    },
    {
      id: "feasible",
      label: "供应链 / 合规可行",
      in: economicsPass,
      out: feasibilityPresent ? economicsPass : 0,
      threshold: "MOQ / 交期 / 认证可满足",
      criteria: "工厂型自控供应链 + CPC 认证",
      actual: feasibilityPresent ? "已有可行性材料，仍需人工验真" : "PENDING",
      evidence_present: feasibilityPresent,
    },
    {
      id: "risk",
      label: "风险可接受",
      in: feasibilityPresent ? economicsPass : 0,
      out: riskEvidencePresent && feasibilityPresent ? economicsPass : 0,
      threshold: "无 Critical 未缓解风险",
      criteria: "DURABILITY 风险有缓解方案",
      actual: riskEvidencePresent ? "已有风险材料，仍需人工验真" : "PENDING",
      evidence_present: riskEvidencePresent,
    },
  ];
  const stages = decisionReady
    ? computedStages
    : computedStages.map((stage) => ({
        ...stage,
        in: 0,
        out: 0,
        actual: "PENDING",
        evidence_present: false,
      }));
  const finalCount = Number(stages.at(-1)?.out || 0);
  return {
    stages,
    gates: stages.slice(1).map((stage) => ({
      gate: stage.label,
      threshold: stage.threshold || "",
      actual: stage.actual || "",
      pass: stage.evidence_present ? stage.out > 0 : false,
      status: stage.evidence_present ? (stage.out > 0 ? "PASS" : "FAIL") : "PENDING",
    })),
    final: {
      decision: decisionReady ? finalVerdict.decision || decision.verdict || "PENDING" : "PENDING",
      plan: decisionReady ? finalVerdict.chosenPlan || "PENDING" : "PENDING",
      score: decisionReady ? Number(finalVerdict.score || 0) : 0,
      one_liner: decisionReady
        ? finalVerdict.oneLiner || decision.one_liner || ""
        : "证据不足：所有决策门均待真实数据验证。",
    },
    conversion_pct: universe > 0 && decisionReady
      ? Number(((finalCount / universe) * 100).toFixed(1))
      : 0,
    raw: {
      cells: (decisionReady ? cells : []).map((cell: JsonObject) => ({
        band: cell.band,
        sub: cell.sub,
        opp_score: cell.opp_score,
        sales_mid: cell.sales_mid,
        competition: cell.competition,
      })),
      scenarios: (decisionReady ? scenarios : []).map((scenario: JsonObject) => ({
        price: scenario.price,
        net_margin_pct: scenario.net_margin_pct,
        unit_net: scenario.unit_net,
      })),
      whitespace_bands: [],
      defaults: { opp: 65, margin: 8, allow_high_comp: false },
      chosen_plan: decisionReady ? finalVerdict.chosenPlan || "PENDING" : "PENDING",
    },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function neutralizeTemplateDecision(modules: JsonObject): void {
  const executive = modules.exec_summary_decision_scorecard || {};
  executive.decision = {
    ...(executive.decision || {}),
    verdict: "insufficient_evidence",
    confidence: "Low",
    one_liner: "证据不足：当前仅加载静态模板样例，尚未形成当前品类的进入、观望或放弃结论。",
    gating_conditions: [
      "接入并核验当前品类的真实市场、VOC、竞品与成本数据",
      "完成数据来源、采集时间、样本量与置信度审计",
      "全部硬门槛通过后再提交人工终审",
    ],
  };
  if (executive.scorecard && typeof executive.scorecard === "object") {
    executive.scorecard = {
      ...executive.scorecard,
      total_score: 0,
      grade: "PENDING / 证据不足",
    };
  }
  modules.exec_summary_decision_scorecard = executive;

  if (modules.CPT_VERIFY && typeof modules.CPT_VERIFY === "object") {
    modules.CPT_VERIFY.finalVerdict = {
      ...(modules.CPT_VERIFY.finalVerdict || {}),
      decision: "PENDING",
      chosenPlan: "PENDING",
      score: 0,
      oneLiner: "证据不足：待真实数据与人工终审后形成决策。",
    };
  }
}

function researchBriefModule(brief: JsonObject): JsonObject {
  const cost = brief.cost || {};
  const profile = brief.profile || {};
  return {
    input_scope: {
      columns: ["输入项", "用户设定"],
      rows: [
        ["卖家类型", brief.sellerType || "未填写"],
        ["研究目标", Array.isArray(brief.goals) ? brief.goals.join(" / ") : "未填写"],
        ["价格范围", Array.isArray(brief.priceRange) ? `$${brief.priceRange[0]}–$${brief.priceRange[1]}` : "未填写"],
        ["目标站点", Array.isArray(brief.marketplaces) ? brief.marketplaces.join(" / ") : "未填写"],
        ["数据窗口", brief.dataWindow ? `${brief.dataWindow} 天` : "90 天"],
        ["证据门槛", brief.confidenceGate || "未填写"],
        ["终审严格度", brief.strictness || "未填写"],
      ],
    },
    seller_constraints: {
      target_margin: profile.targetMargin ?? "未填写",
      annual_revenue: profile.annualRevenue ?? "未填写",
      logistics_capability: profile.logistics ?? profile.ownLogistics ?? "未填写",
      product_capability: profile.productCapability ?? "未填写",
    },
    unit_economics_input: {
      columns: ["成本输入", "用户设定"],
      rows: [
        ["拟定售价", cost.price ?? "未填写"],
        ["FOB", cost.fob ?? "未填写"],
        ["头程/件", cost.freight ?? "未填写"],
        ["FBA/履约费", cost.fba ?? "未填写"],
        ["目标 ACOS", cost.acos ?? "未填写"],
        ["关税 MFN / 301 / 232", [cost.dutyBase ?? cost.duty, cost.duty301, cost.duty232].filter((v) => v != null).join(" / ") || "未填写"],
      ],
    },
    constraints: {
      hazards: brief.haz || {},
      certifications: brief.certs || [],
      excluded_brands: brief.exclude || [],
      custom_costs: brief.customCosts || [],
      voc_focus: brief.vocAspects || [],
    },
    note: "本模块完整保留立项简报输入，供模型复核、报告解释与后续重跑使用；未填写项不会被系统擅自补造。",
  };
}

export function buildReport(category: string, marketplace: string, researchBrief: JsonObject = {}): JsonObject {
  const modules: JsonObject = {};
  for (const key of outputOrder) {
    if (chairData[key]) modules[key] = cloneJson(chairData[key]);
  }
  neutralizeTemplateDecision(modules);
  modules.decision_funnel = decisionFunnel(modules, false);
  let order = [
    "exec_summary_decision_scorecard",
    "decision_funnel",
    ...outputOrder.filter((key) => key !== "exec_summary_decision_scorecard"),
  ];

  const availableExtensionKeys = Object.keys(extData).filter((key) => {
    const value = extData[key];
    return value && typeof value === "object" && Object.keys(value).length > 0 && !("noop" in value);
  });
  for (const key of availableExtensionKeys) modules[key] = cloneJson(extData[key]);
  if (availableExtensionKeys.length) {
    const riskIndex = order.indexOf("risk_register_sensitivity_confidence");
    order = [...order.slice(0, riskIndex), ...availableExtensionKeys, ...order.slice(riskIndex)];
  }

  const mergedMeta: JsonObject = {};
  for (const key of availableExtensionKeys) mergedMeta[key] = extMeta[key] || {};
  if (vocData && Object.keys(vocData).length) {
    modules.voc_evidence = cloneJson(vocData);
    mergedMeta.voc_evidence = vocMeta;
    const mindIndex = order.indexOf("MIND_DECODE");
    order.splice(mindIndex >= 0 ? mindIndex + 1 : order.length, 0, "voc_evidence");
  }
  if (researchBrief && Object.keys(researchBrief).length) {
    modules.research_brief = researchBriefModule(researchBrief);
    mergedMeta.research_brief = {
      title: "研究输入基线｜卖家能力、成本与约束",
      nav_short: "研究输入基线",
      icon: "i",
      subsections: [
        { id: "input_scope", title: "研究范围" },
        { id: "seller_constraints", title: "卖家能力与约束" },
        { id: "unit_economics_input", title: "单位经济输入" },
        { id: "constraints", title: "合规与产品边界" },
      ],
    };
    order.splice(1, 0, "research_brief");
  }

  const chair = /chair|露营椅|折叠椅|camping/i.test(category);
  const report: JsonObject = {
    category: chair ? "折叠露营椅（Folding Camping Chair）" : category,
    marketplace: `Amazon ${marketplace}`,
    verdict: "证据不足",
    evidence_mode: "template_demo",
    decision_readiness: "insufficient_evidence",
    demo_note: TEMPLATE_DEMO_NOTE,
    concept_generation: {
      eligible: false,
      reason: "模板演示没有当前品类的可验证证据，禁止生成产品概念图。",
    },
    order,
    modules,
    ext_meta: mergedMeta,
    research_input_applied: Boolean(researchBrief && Object.keys(researchBrief).length),
  };
  return finalizeReportForPersistence(report);
}

export function conceptGenerationBlockReason(report: unknown): string {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return "研究报告尚未生成";
  }
  const value = report as JsonObject;
  if (["template_demo", "synthetic_fixture"].includes(value.evidence_mode)) {
    return "当前报告为框架演示，不含可验证的真实市场证据，禁止启动 Lovart 概念图。";
  }
  if (value.decision_readiness === "insufficient_evidence") {
    return "当前报告包含部分实证，但关键 VOC、需求、单位经济或工程证据尚未齐备，暂不启动 Lovart 概念图。";
  }
  return "";
}

function markdownCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  return /^https?:\/\//i.test(text) ? `[打开来源](${text})` : text;
}

function markdownTable(table: JsonObject): string[] {
  const columns = (Array.isArray(table?.columns) ? table.columns : []) as unknown[];
  const rows = (Array.isArray(table?.rows) ? table.rows : []) as unknown[][];
  if (!columns.length) return [];
  return [
    `| ${columns.map(markdownCell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${columns.map((_, index) => markdownCell(row?.[index])).join(" | ")} |`),
    "",
  ];
}

function markdownBlock(value: unknown, level = 3): string[] {
  if (value == null) return [];
  if (typeof value !== "object") return [String(value), ""];
  if (Array.isArray(value)) {
    if (!value.length) return [];
    if (value.every((item) => !Array.isArray(item) && (typeof item !== "object" || item == null))) {
      return [...value.map((item) => `- ${markdownCell(item)}`), ""];
    }
    if (value.every((item) => Array.isArray(item) && item.length === 2)) {
      return markdownTable({ columns: ["项目", "内容"], rows: value });
    }
    return [...value.map((item) => `- ${markdownCell(item)}`), ""];
  }
  const objectValue = value as JsonObject;
  if (Array.isArray(objectValue.columns) && Array.isArray(objectValue.rows)) return markdownTable(objectValue);

  const lines: string[] = [];
  for (const [key, child] of Object.entries(objectValue)) {
    if (child == null || (Array.isArray(child) && child.length === 0)) continue;
    const label = String(key).replace(/_/g, " ");
    if (typeof child !== "object") {
      lines.push(`- **${label}**：${markdownCell(child)}`);
      continue;
    }
    lines.push("", `${"#".repeat(Math.min(6, level))} ${label}`, "");
    lines.push(...markdownBlock(child, level + 1));
  }
  lines.push("");
  return lines;
}

export function reportToMarkdown(report: JsonObject): string {
  const decisionRecord = report.decision_record && typeof report.decision_record === "object"
    ? report.decision_record as JsonObject
    : null;
  const decisionStatus = decisionRecord?.status === "signed"
    ? `已签核 · ${decisionRecord.outcome || "未填写"}`
    : "待人工终审";
  const lines = [
    `# ${report.category || "Metis 选品决策报告"}`,
    "",
    report.demo_note ? `> **重要提示：** ${report.demo_note}` : "",
    "",
    `- 市场：${report.marketplace || ""}`,
    decisionRecord ? `- 人工决策：${decisionStatus}` : "",
    decisionRecord?.reviewer_name ? `- 审核人：${decisionRecord.reviewer_name}` : "",
    decisionRecord?.reviewed_at ? `- 签核时间：${new Date(Number(decisionRecord.reviewed_at) * 1000).toISOString()}` : "",
    decisionRecord?.note ? `- 终审备注：${markdownCell(decisionRecord.note)}` : "",
    `- AI 研究建议：${report.verdict || ""}`,
    decisionRecord?.report_sha256 ? `- 报告哈希：SHA-256 ${decisionRecord.report_sha256}` : "",
    report.data_cutoff ? `- 数据截止：${report.data_cutoff}` : "",
    report.report_version ? `- 报告版本：${report.report_version}` : "",
    "",
  ];
  const boardConcept = report.modules?.board_concept;
  if (boardConcept && typeof boardConcept === "object") {
    const suite = Array.isArray(boardConcept.scene_suite) ? boardConcept.scene_suite : [];
    const sceneAssets = suite
      .map((asset: JsonObject) => ({
        title: String(asset?.title || asset?.role || "产品场景图"),
        url: String(asset?.image_url || asset?.url || ""),
      }))
      .filter((asset: { title: string; url: string }) => /^(?:https?:\/\/|\/)/.test(asset.url));
    const heroUrl = String(boardConcept.image_url || "");
    if (sceneAssets.length || heroUrl) {
      lines.push("## 产品概念场景套图", "");
      for (const asset of (sceneAssets.length ? sceneAssets : [{ title: String(boardConcept.title || "产品概念图"), url: heroUrl }])) {
        lines.push(`![${markdownCell(asset.title)}](${asset.url})`, "");
      }
      lines.push("> AIGC 场景图用于设计方向评审，不替代 CAD、实拍、测试报告或量产签样。", "");
    }
  }
  for (const moduleId of report.order || []) {
    const moduleData = report.modules?.[moduleId];
    if (!moduleData) continue;
    const title = report.ext_meta?.[moduleId]?.title || moduleId.replace(/_/g, " ");
    lines.push(`## ${title}`, "");
    if (moduleId === "board_concept" && moduleData.image_url) {
      lines.push(`![${markdownCell(moduleData.title || "产品概念图")}](${moduleData.image_url})`, "");
    }
    lines.push(...markdownBlock(moduleData, 3));
  }
  return lines.filter((line, index) => !(line === "" && lines[index - 1] === "")).join("\n").trim() + "\n";
}

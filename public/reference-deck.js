import htm, { h, useCallback, useEffect, useMemo, useRef, useState } from "./vendor/metis-vendor.js";
import { createExportProof, verifyExportCheck } from "./integrity.js";

const html = htm.bind(h);

export const REFERENCE_TOTAL_PAGES = 332;

export function stepReferencePage(current, delta) {
  const page = Number.isFinite(Number(current)) ? Math.trunc(Number(current)) : 1;
  const offset = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 0;
  return Math.max(1, Math.min(REFERENCE_TOTAL_PAGES, page + offset));
}

export function hasContinuousReferencePageSequence(pages) {
  return Array.isArray(pages) && pages.length === REFERENCE_TOTAL_PAGES &&
    pages.every((page, index) => Number(page?.number) === index + 1);
}

const BOARD_READING_PAGES = Object.freeze([
  1, 7, 8, 9, 10, 11,
  25,
  31, 32, 33,
  291, 294, 295,
  161, 162, 163, 164, 165, 166,
  301, 302,
  41,
  318, 319,
  323, 327,
]);

export function stepCuratedReferencePage(current, delta) {
  const page = stepReferencePage(current, 0);
  const offset = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 0;
  const exactIndex = BOARD_READING_PAGES.indexOf(page);
  if (exactIndex >= 0) {
    const nextIndex = Math.max(0, Math.min(BOARD_READING_PAGES.length - 1, exactIndex + offset));
    return BOARD_READING_PAGES[nextIndex];
  }
  if (offset < 0) return [...BOARD_READING_PAGES].reverse().find((candidate) => candidate < page) || BOARD_READING_PAGES[0];
  if (offset > 0) return BOARD_READING_PAGES.find((candidate) => candidate > page) || BOARD_READING_PAGES.at(-1);
  return BOARD_READING_PAGES.reduce((nearest, candidate) =>
    Math.abs(candidate - page) < Math.abs(nearest - page) ? candidate : nearest
  , BOARD_READING_PAGES[0]);
}

export const REFERENCE_MODULE_STARTS = [
  7, 11, 14, 18, 25, 31, 34, 38, 41, 47, 52, 67, 76, 82, 89, 97,
  104, 112, 119, 127, 134, 141, 149, 154, 161, 167, 174, 179, 186,
  194, 200, 206, 213, 219, 227, 234, 241, 248, 255, 260, 266, 272,
  277, 284, 291, 293, 296, 298, 301, 303, 304, 307, 309, 311, 313,
  315, 317, 318, 320, 322, 323, 327,
];

export const REFERENCE_MODULE_ORDER = [
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
  "crossborder_seller_cockpit",
  "supply_chain_sourcing",
  "ip_compliance",
  "ppc_traffic_deep_dive",
  "ab_listing_simulator",
  "pricing_science",
  "trend_forecast",
  "omnichannel_strategy",
  "scenario_valuation",
  "competitive_dynamics",
  "compdeep_five_forces_quant",
  "compdeep_strategic_groups_listing",
  "compdeep_moat_priceband_war",
  "pd_attr_conjoint",
  "pd_concept_matrix",
  "pd_quality_return_pareto",
  "fin_sensitivity_tornado",
  "fin_montecarlo_dist",
  "fin_ue_decomp_tree",
  "risk_patent_ip_defense",
  "risk_cert_compliance_matrix",
  "risk_hijack_platform_defense",
  "meta_decision_robustness",
  "meta_assumption_registry",
  "meta_evidence_audit",
  "market_size_decomposition",
  "price_elasticity",
  "longtail_niche",
  "supply_chain_risk_topology",
  "multi_supplier_strategy",
  "certification_and_first_leg",
  "keyword_strategy_matrix",
  "ad_structure_bidding",
  "offsite_influencer_social",
  "segment_grade_matrix",
  "market_map_segment_grade",
  "voc_absa_walls",
  "mind_whitespace_needs",
  "problem_solver_concept",
  "grade_map",
  "social_demand_triggers",
  "strategy_map",
  "ev_decision",
  "beta_alpha_quadrant",
  "capital_allocation_ruin",
  "pre_mortem_redteam",
  "edge_calibration",
  "portfolio_correlation",
  "personal_entry_window",
  "incumbent_retaliation_game",
  "risk_register_sensitivity_confidence",
  "trust_guardrails_methodology",
];

const CORE_TITLES = {
  exec_summary_decision_scorecard: "执行摘要 · 决策记分卡",
  decision_funnel: "选品决策漏斗",
  OP_SCAN: "OP_SCAN · 品类机会扫描",
  MKT_STRUCT: "MKT_STRUCT · 市场结构解剖",
  MIND_DECODE: "MIND_DECODE · 消费者 VOC 洞察",
  voc_evidence: "VOC 证据引擎",
  competitor_teardown: "竞品深度拆解",
  CPT_VERIFY: "CPT_VERIFY · 选品验证",
  output_unit_economics_finance: "单位经济与财务",
  gtm_plan: "GTM · 上市打法",
  risk_register_sensitivity_confidence: "风险登记、敏感性与置信度",
  trust_guardrails_methodology: "可信护栏、审计与方法论",
};

const SELLER_COCKPIT_TOPICS = [
  "账户健康看板（Account Health Rating 与核心违规指标）",
  "账号风险登记（KYC、关联、跟卖、侵权与类目准入）",
  "跟卖与劫持监控（Buy Box 占有率与跟卖者数）",
  "侵权与合规红线热力（目标市场）",
  "税务合规成本与履约结构",
  "库存绩效、仓储费用与头程运输",
  "现金流与资金占用（CCC 现金周期）",
  "汇率风险对毛利的影响",
  "库存周转与补货点区间",
  "卖家经营 KPI 总览",
  "流量与销量引擎",
  "评论与 Rating 资产",
  "多站点扩张机会",
  "全球化路线图",
  "品牌资产建设",
];

const MODULE_TOPICS = {
  exec_summary_decision_scorecard: ["董事会裁决", "核心逻辑", "决策记分卡", "90 天行动与关键假设"],
  decision_funnel: ["候选机会如何逐门收敛", "硬门槛与淘汰原因", "最终方案与否证条件"],
  OP_SCAN: ["机会分与市场吸引力", "需求规模口径", "生命周期与趋势", "进入壁垒", "细分机会矩阵", "竞争象限", "五维机会画像"],
  MKT_STRUCT: ["价格带结构", "集中度与品牌梯队", "Buy Box 与变体策略", "价格敏感边界", "卖家与需求结构", "新进入者生存条件", "结构性结论"],
  MIND_DECODE: ["VOC 覆盖与方面情感", "正负向驱动", "未满足需求与 JTBD"],
  voc_evidence: ["VOC 机会白空间", "方面重要度与竞争缺口", "证据口径与可追溯性"],
  competitor_teardown: ["竞品样本与置信边界", "核心竞品卡片", "竞品维度矩阵", "攻击面与反制"],
  CPT_VERIFY: ["候选方案面板", "置信门与定量边界", "方案记分卡", "可行性与敏感性", "最终放行结论"],
  output_unit_economics_finance: ["单位经济瀑布", "盈亏平衡", "12 个月财务情景", "现金流与资金占用", "价格情景", "敏感性与证据锚点"],
  gtm_plan: ["价格与定位", "Listing 信息架构", "关键词与广告结构", "上市节奏与评价增长", "库存与放量纪律"],
  crossborder_seller_cockpit: SELLER_COCKPIT_TOPICS,
  pd_concept_matrix: ["概念组合与选择标准", "A1 · 主效果图", "A2 · 正侧背视图计划", "A3 · 尺寸与结构约束", "A4 · CMF 与材料工艺", "A5 · BOM、包装与 QC 门禁"],
  problem_solver_concept: ["A6 · VOC 到功能证据映射", "A7 · 概念评审与人工签核"],
  risk_register_sensitivity_confidence: ["风险登记与最早信号", "确定性敏感性", "停止线与责任人", "置信度边界", "残余风险结论"],
  trust_guardrails_methodology: ["输入、事实与计算护栏", "推断与 AIGC 边界", "证据阈值", "来源与模型溯源", "人工签核", "方法局限与审计结论"],
};

const VALIDATION_TOPICS = [
  "关键结论与决策影响",
  "证据底稿与口径边界",
  "市场/场景拆解",
  "验证矩阵与否证条件",
  "执行门槛与责任人",
  "风险、敏感项与停止线",
  "来源、置信度与待补证项",
];

function stripNumber(value) {
  return String(value || "").replace(/^\s*\d{1,2}\s*[·.、-]\s*/, "").trim();
}

function humanize(value) {
  const labels = {
    evidence_state: "本模块结论",
    decision_model: "决策模型",
    traceable_evidence: "可追溯证据",
    validation_and_kill_criteria: "验证与停止线",
    conclusion_card: "结论",
    conclusion: "阶段结论",
    note: "口径说明",
    assumptions: "关键假设",
  };
  const key = String(value || "").split(".").pop();
  if (labels[key]) return labels[key];
  return key.replace(/^[a-z]+_/, "").replace(/_/g, " ").replace(/\b\w/g, (s) => s.toUpperCase());
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTable(value) {
  return isObject(value) && Array.isArray(value.columns) && Array.isArray(value.rows);
}

function isCallout(value) {
  return isObject(value) && ("body" in value) && ("title" in value || "tag" in value);
}

function isChart(value) {
  if (!isObject(value)) return false;
  return (Array.isArray(value.labels) && (Array.isArray(value.series) || Array.isArray(value.bars) || Array.isArray(value.line))) ||
    (Array.isArray(value.axes) && Array.isArray(value.series)) ||
    (Array.isArray(value.xLabels) && Array.isArray(value.matrix)) ||
    (Array.isArray(value.items) && value.items.length > 0 && value.items.every((item) =>
      isObject(item) && safeText(item.label).trim() && safeText(item.value).trim()
    ) && value.items.some((item) => numeric(item.value) != null)) ||
    (Array.isArray(value.points) && value.points.length > 0) ||
    (Array.isArray(value.nodes) && Array.isArray(value.links));
}

function imageUrl(value) {
  if (!isObject(value)) return "";
  for (const key of ["image", "image_url", "url"]) {
    const candidate = value[key];
    if (typeof candidate !== "string" || !/^(?:https?:\/\/|\/)/i.test(candidate)) continue;
    if (key !== "url" || /\.(png|jpe?g|webp)(?:\?|$)/i.test(candidate) || /\/concept-assets\//i.test(candidate)) return candidate;
  }
  return "";
}

function normalizeRow(row, columns) {
  if (Array.isArray(row)) return columns.map((_, index) => row[index] ?? "");
  if (isObject(row)) return columns.map((column) => row[column] ?? "");
  return [row, ...columns.slice(1).map(() => "")];
}

function tableArtifacts(value, path) {
  const columns = value.columns.map(String);
  const rows = value.rows.map((row) => normalizeRow(row, columns));
  const perPage = columns.length >= 8 ? 4 : columns.length >= 6 ? 5 : columns.length >= 4 ? 6 : 8;
  if (!rows.length) return [{ kind: "table", title: humanize(path), source_path: path, columns, rows: [], note: value.note }];
  const chunks = [];
  for (let i = 0; i < rows.length; i += perPage) {
    chunks.push({
      kind: "table",
      title: humanize(path) + (rows.length > perPage ? ` · ${Math.floor(i / perPage) + 1}` : ""),
      source_path: path,
      columns,
      rows: rows.slice(i, i + perPage),
      note: value.note,
    });
  }
  return chunks;
}

function arrayArtifact(value, path) {
  if (!value.length) return [];
  if (value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
    return [{ kind: "list", title: humanize(path), source_path: path, items: value.map(String) }];
  }
  if (value.every(isObject)) {
    const columns = [];
    value.forEach((row) => Object.keys(row).forEach((key) => { if (!columns.includes(key)) columns.push(key); }));
    return tableArtifacts({ columns, rows: value }, path);
  }
  return [{ kind: "list", title: humanize(path), source_path: path, items: value.map((item) => String(item)) }];
}

function flattenArtifacts(value, path = "", depth = 0) {
  if (value == null || value === "" || depth > 4) return [];
  if (isTable(value)) return tableArtifacts(value, path);
  if (isCallout(value)) return [{ kind: "callout", title: value.title || humanize(path), source_path: path, tag: value.tag, body: value.body }];
  const image = imageUrl(value);
  if (image) {
    const detail = Object.fromEntries(Object.entries(value).filter(([key]) => !["image", "image_url", "url"].includes(key)));
    return [{ kind: "image", title: value.title || humanize(path), source_path: path, image, detail }];
  }
  if (isChart(value)) return [{ kind: "chart", title: humanize(path), source_path: path, value }];
  if (Array.isArray(value)) return arrayArtifact(value, path);
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, item]) => item != null && item !== "");
    if (!entries.some(([, item]) => isObject(item) || Array.isArray(item))) {
      return [{ kind: "kv", title: humanize(path), source_path: path, rows: entries.map(([key, item]) => [humanize(key), item]) }];
    }
    return entries.flatMap(([key, item]) => flattenArtifacts(item, path ? `${path}.${key}` : key, depth + 1));
  }
  return [{ kind: "text", title: humanize(path), source_path: path, body: String(value) }];
}

function moduleTitle(report, id, index) {
  const meta = report.ext_meta?.[id] || {};
  return stripNumber(meta.title || CORE_TITLES[id] || meta.nav_short || id.replace(/_/g, " ")) || `模块 ${index + 1}`;
}

function pageTopic(id, offset, artifact) {
  if (artifact?.title && !/^本模块结论$/i.test(artifact.title)) return stripNumber(artifact.title);
  const topics = MODULE_TOPICS[id] || VALIDATION_TOPICS;
  return topics[offset] || VALIDATION_TOPICS[offset % VALIDATION_TOPICS.length];
}

function findRows(report, candidates) {
  for (const [moduleId, key] of candidates) {
    const moduleData = report.modules?.[moduleId];
    if (key === "rows" && isTable(moduleData) && moduleData.rows.length) return moduleData.rows;
    const value = moduleData?.[key];
    if (isTable(value) && value.rows.length) return value.rows;
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function tableRowLimit(columnCount) {
  if (columnCount >= 8) return 4;
  if (columnCount >= 6) return 5;
  if (columnCount >= 4) return 6;
  return 8;
}

function ownerForModule(id) {
  if (/risk|compliance|patent|trust|ip_/i.test(id)) return "法务 / 质量";
  if (/fin|pricing|valuation|capital|econom/i.test(id)) return "财务 / 数据";
  if (/supply|seller|inventory|logistic|certification/i.test(id)) return "供应链 / 物流";
  if (/voc|mind|concept|quality|return/i.test(id)) return "研究 / 产品";
  if (/ppc|traffic|listing|keyword|social|gtm/i.test(id)) return "运营 / 增长";
  return "业务 / 数据";
}

function methodForTopic(topic) {
  if (/VOC|评论|情感|心智|需求|Kano|场景|复购/i.test(topic)) {
    return "评论去重与来源分层后做方面级编码，保留正负向、场景、产品动作和逐条来源；公开观察不外推发生率。";
  }
  if (/价格|利润|成本|财务|现金|回本|弹性|估值|敏感|Monte|概率/i.test(topic)) {
    return "统一售价、平台费、广告、履约、到岸成本与退货口径；用真实报价和订单分布替换管理层假设后再运行敏感性或概率模型。";
  }
  if (/供应|采购|MOQ|库存|补货|物流|包装|履约|头程|产能/i.test(topic)) {
    return "以拆项 RFQ、双供对比、EVT/DVT/PVT、包装线路试验和订单级履约实账形成闭环，不能只比较 FOB。";
  }
  if (/专利|商标|合规|认证|法规|侵权|账号/i.test(topic)) {
    return "官方法规与数据库初筛、最终结构和文案冻结后 FTO/认证复核，并由法务、法规和测试机构签核。";
  }
  if (/广告|流量|关键词|Listing|转化|社媒|渠道|Buy Box/i.test(topic)) {
    return "接入 ABA/SQP、广告搜索词、页面实验和订单贡献；按单变量、最小样本和预设停表规则验证增量。";
  }
  if (/概念|设计|属性|CMF|BOM|结构|工程|质量|退货/i.test(topic)) {
    return "把 VOC 映射到特性-利益-证据和 CTQ，经过概念盲测、DFM、样机测试、包装验证与人工签样后冻结。";
  }
  if (/市场|规模|趋势|季节|竞争|品牌|份额|细分|机会/i.test(topic)) {
    return "按统一变体、价格、时间窗和市场范围交叉公开零售样本、趋势与付费数据；销量、份额和增长只在多源收敛后量化。";
  }
  return "先定义研究问题和统一口径，再以独立来源交叉、反证条件、责任人和时间窗完成可审计验证。";
}

function decisionUseForTopic(topic) {
  if (/价格|利润|成本|财务|现金|回本|弹性|敏感/i.test(topic)) return "决定目标价格、首批投入与利润硬门；压力情景不通过则不放量。";
  if (/VOC|评论|需求|情感|场景|质量|退货/i.test(topic)) return "决定 Must-have、CTQ、页面证据和质量优先级；核心问题无法闭环则退回方案。";
  if (/供应|采购|库存|物流|包装|产能/i.test(topic)) return "决定供应商、包装线路、备货与补件方案；工程或履约红线失败即冻结首单。";
  if (/专利|合规|认证|法规|侵权|账号/i.test(topic)) return "决定能否进入目标站点及可用声明；法律或准入阻断未关闭前不得上市。";
  if (/广告|流量|关键词|Listing|转化|社媒|渠道/i.test(topic)) return "决定流量结构、内容优先级和获客上限；增量无法覆盖贡献利润则停止扩量。";
  if (/概念|设计|属性|CMF|BOM|结构|工程/i.test(topic)) return "决定概念冻结、工程投入和量产签样；AIGC 图像只作为方向，不替代工程证据。";
  return "决定该模块继续、补证、降级或停止，并把结论写回董事会闸门。";
}

function researchArtifact(report, id, topic, plan = {}) {
  const gates = report.modules?.exec_summary_decision_scorecard?.decision?.gating_conditions ||
    report.modules?.exec_summary_decision_scorecard?.gating_conditions || [];
  const sources = findRows(report, [["source_register", "rows"], ["voc_raw_data", "source_coverage"]]);
  const moduleData = report.modules?.[id] || {};
  const evidenceState = moduleData.evidence_state || {};
  const moduleFields = Object.keys(moduleData).filter((key) => !["evidence_state", "note", "limitations"].includes(key));
  const vocRows = findRows(report, [["voc_evidence", "evidence_log"], ["voc_raw_data", "evidence_log"]]);
  const owner = ownerForModule(id);
  const offset = Number(plan.page_in_module || 1) - 1;
  const gate = gates[offset % Math.max(1, gates.length)] || "关键证据与业务红线通过后才进入下一阶段";
  const sourceIds = sources.slice(offset % Math.max(1, sources.length), (offset % Math.max(1, sources.length)) + 3)
    .map((row) => Array.isArray(row) ? row[0] : "")
    .filter(Boolean)
    .join(" / ");
  return {
    kind: "research",
    title: topic,
    tag: evidenceState.tag || "RESEARCH GATE",
    question: plan.research_question || `${topic}需要哪些证据才能进入决策？`,
    finding: safeText(evidenceState.body || `${report.category} 已建立“${topic}”的研究口径；现有证据只支持当前报告标注的置信等级，未观测指标不生成虚假数值。`),
    cards: [
      {
        label: "当前证据",
        value: sources.length ? `${sources.length} 个来源登记；${vocRows.length} 条 VOC 编码观察` : "本模块证据仍需接入",
        note: sourceIds ? `本页锚点：${sourceIds}` : `可用字段：${moduleFields.slice(0, 4).map(humanize).join(" / ") || "待采集"}`,
      },
      { label: "验证方法", value: methodForTopic(topic), note: "方法、样本与时间窗必须随结果一并保留。" },
      { label: "决策用途", value: decisionUseForTopic(topic), note: `Owner：${owner}` },
    ],
    gate,
    confidence: evidenceState.tag || (sources.length >= 8 ? "MEDIUM" : "LIMITED"),
  };
}

function tablePage(value, title) {
  if (!isTable(value)) {
    return {
      kind: "research",
      title,
      tag: "DATA REQUIRED",
      question: `${title}需要哪些输入和验证才能形成结论？`,
      finding: "本页所需结构化输入尚未形成可审计数据，不输出虚假数值。",
      cards: [
        { label: "所需输入", value: "来源、样本、时间窗、单位与口径", note: "所有字段需能回到原始证据。" },
        { label: "验证方法", value: methodForTopic(title), note: "按预设样本与停表规则执行。" },
        { label: "决策用途", value: decisionUseForTopic(title), note: "未通过前保持阶段性结论。" },
      ],
      gate: "结构化输入与人工签核齐备后放行",
      confidence: "PENDING",
    };
  }
  const columns = value.columns.map(String);
  return {
    kind: "table",
    title,
    columns,
    rows: value.rows.slice(0, tableRowLimit(columns.length)).map((row) => normalizeRow(row, columns)),
    note: value.note,
  };
}

function tableColumnIndex(value, pattern, fallback = -1) {
  if (!isTable(value)) return fallback;
  const index = value.columns.findIndex((column) => pattern.test(String(column)));
  return index >= 0 ? index : fallback;
}

function vocEvidencePages(moduleData) {
  const distribution = moduleData.theme_distribution;
  const evidence = moduleData.evidence_log;
  const note = "观察数只代表本次可追溯编码记录，不外推为市场发生率、销量占比或全量评论分布。";
  const themeIndex = tableColumnIndex(distribution, /主题|方面/, 0);
  const observationIndex = tableColumnIndex(distribution, /观察数|记录数/, 1);
  const negativeIndex = tableColumnIndex(distribution, /负向/, 2);
  const positiveIndex = tableColumnIndex(distribution, /正向/, 3);
  const themes = isTable(distribution)
    ? distribution.rows.map((row) => normalizeRow(row, distribution.columns)).map((row) => ({
      theme: safeText(row[themeIndex]),
      observations: numeric(row[observationIndex]) || 0,
      negative: numeric(row[negativeIndex]) || 0,
      positive: numeric(row[positiveIndex]) || 0,
    })).filter((row) => row.theme)
      .sort((a, b) => b.observations - a.observations || b.negative - a.negative || a.theme.localeCompare(b.theme, "zh-CN"))
    : [];
  const channelIndex = tableColumnIndex(evidence, /渠道|平台/, 1);
  const productIndex = tableColumnIndex(evidence, /产品|来源/, 2);
  const evidenceThemeIndex = tableColumnIndex(evidence, /主题|方面/, 5);
  const evidenceRows = isTable(evidence)
    ? evidence.rows.map((row) => normalizeRow(row, evidence.columns))
    : [];
  const topProductByTheme = new Map();
  themes.forEach((item) => {
    const counts = new Map();
    evidenceRows.filter((row) => safeText(row[evidenceThemeIndex]) === item.theme).forEach((row) => {
      const product = safeText(row[productIndex]) || "公开来源样本";
      counts.set(product, (counts.get(product) || 0) + 1);
    });
    const topProduct = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))[0]?.[0];
    if (topProduct) topProductByTheme.set(item.theme, topProduct);
  });
  const rankedLabel = (theme) => {
    const product = safeText(topProductByTheme.get(theme));
    const shortProduct = product.length > 20 ? `${product.slice(0, 19)}…` : product;
    return shortProduct ? `${shortProduct} · ${theme}` : theme;
  };
  const ranking = {
    kind: "chart",
    title: "VOC 主题观察排序",
    source_path: "modules.voc_evidence.theme_distribution",
    value: { items: themes.map((row) => ({ label: rankedLabel(row.theme), value: row.observations, unit: " 条" })) },
    note: `${note} 标签显示该主题记录数最多的来源产品，便于回查，不代表该产品或 ASIN 的市场发生率。`,
  };
  const negativeRanking = {
    kind: "chart",
    title: "负向主题观察排序",
    source_path: "modules.voc_evidence.theme_distribution",
    value: {
      items: themes.filter((row) => row.negative > 0)
        .sort((a, b) => b.negative - a.negative || b.observations - a.observations)
        .map((row) => ({ label: row.theme, value: row.negative, unit: " 条" })),
    },
    note,
  };
  const kanoRows = themes.map((row) => {
    const hypothesis = row.negative >= Math.max(2, row.positive * 1.5)
      ? "Must-be 假设"
      : row.positive >= Math.max(2, row.negative * 1.5) && row.negative === 0
        ? "Attractive 假设"
        : row.positive > row.negative
          ? "Performance 假设"
          : "待定假设";
    return [
      row.theme,
      row.observations,
      row.negative,
      row.positive,
      hypothesis,
      "用目标用户概念测试与真实订单 VOC 复核",
    ];
  });
  const kano = {
    kind: "table",
    title: "方面重要度线索与 Kano 假设",
    source_path: "modules.voc_evidence.theme_distribution",
    columns: ["主题", "观察数", "负向", "正向", "Kano 假设（非结论）", "验证要求"],
    rows: kanoRows,
    note,
    preserveTable: true,
  };

  const channelCounts = new Map();
  const evidenceThemeCounts = new Map();
  evidenceRows.forEach((row) => {
    const channel = safeText(row[channelIndex]) || "未标注渠道";
    const theme = safeText(row[evidenceThemeIndex]) || "未标注主题";
    channelCounts.set(channel, (channelCounts.get(channel) || 0) + 1);
    evidenceThemeCounts.set(theme, (evidenceThemeCounts.get(theme) || 0) + 1);
  });
  const channels = [...channelCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).slice(0, 5).map(([label]) => label);
  const evidenceThemes = [...evidenceThemeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).slice(0, 7).map(([label]) => label);
  const crossRows = evidenceThemes.map((theme) => [
    theme,
    ...channels.map((channel) => evidenceRows.filter((row) => safeText(row[channelIndex]) === channel && safeText(row[evidenceThemeIndex]) === theme).length),
  ]);
  const cross = {
    kind: "table",
    title: "渠道 × VOC 主题交叉观察",
    source_path: "modules.voc_evidence.evidence_log",
    columns: ["主题", ...channels],
    rows: crossRows,
    note,
  };
  return [[ranking, negativeRanking], [kano], [cross]];
}

function sellerCockpitContract(topic) {
  if (/账号|KYC|关联|违规|Gating/i.test(topic)) {
    return ["Seller Central 账号健康、违规/申诉、KYC 与类目准入事件明细", "所有红项关闭且责任人与复核日期齐备"];
  }
  if (/BuyBox|跟卖|劫持/i.test(topic)) {
    return ["ASIN-week Buy Box 占有率、跟卖者数、Test Buy 与投诉处置记录", "品牌保护动作和周度异常阈值可复核"];
  }
  if (/侵权|合规|专利|商标|EPR|加州/i.test(topic)) {
    return ["目标站点法规、FTO/商标检索、材料/标签证书与投诉记录", "法务和法规责任人完成最终签核"];
  }
  if (/税务|关税|平台费|毛利/i.test(topic)) {
    return ["订单结算、平台费、税费、HTS/关税与到岸成本实账", "统一单位经济口径后贡献率通过硬门"];
  }
  if (/履约|FBA|FBM|海外仓/i.test(topic)) {
    return ["订单级履约方式、妥投、破损、补件、逆向物流与线路成本", "自有物流优势被真实订单 KPI 证明"];
  }
  if (/库存|IPI|仓储|补货|周转|缺货/i.test(topic)) {
    return ["SKU-week 库存、IPI、仓储费、在途、交期、缺货与补货参数", "补货点和安全库存可由真实分布复算"];
  }
  if (/头程|现金|CCC|资金/i.test(topic)) {
    return ["采购付款、生产/订舱/到仓时点、运价、账期与平台回款流水", "现金转换周期与首批资金上限完成财务复核"];
  }
  if (/汇率|USD|CNY/i.test(topic)) {
    return ["采购币种、付款日汇率、结算币种与价格/成本敏感参数", "汇率压力情景下仍满足贡献利润停止线"];
  }
  if (/流量|销量|广告|引擎/i.test(topic)) {
    return ["SP-API、广告搜索词、曝光/点击/订单、花费与自然销量周序列", "增量贡献覆盖获客成本且口径可追溯"];
  }
  if (/评论|Rating|评价|服务|品牌资产/i.test(topic)) {
    return ["ASIN-week 评分/评论增量、客服、退货、补件与品牌内容资产记录", "评价改善可回到产品或服务动作"];
  }
  if (/站点|全球化|路线图/i.test(topic)) {
    return ["各站点需求、合规、单位经济、库存线路与组织准备度", "扩站不稀释主站贡献和供应链服务水平"];
  }
  return ["公司经营、渠道、广告、订单、库存、履约与售后统一数据集", "指标定义、责任人、时间窗和停止线全部签核"];
}

function sellerCockpitResearch(moduleData, topic) {
  const fit = moduleData.seller_fit_scorecard;
  const cockpit = moduleData.weekly_cockpit;
  const fitRows = isTable(fit) ? fit.rows.map((row) => normalizeRow(row, fit.columns)) : [];
  const cockpitRows = isTable(cockpit) ? cockpit.rows.map((row) => normalizeRow(row, cockpit.columns)) : [];
  const [requiredInput, gate] = sellerCockpitContract(topic);
  const availableLabels = [...fitRows.map((row) => safeText(row[0])), ...cockpitRows.map((row) => safeText(row[0]))].filter(Boolean);
  return {
    kind: "research",
    title: topic,
    source_path: "modules.crossborder_seller_cockpit",
    tag: "OPERATING DATA CONTRACT",
    question: `${topic}需要接入哪些可审计公司实账？`,
    finding: `当前模块只有 ${fitRows.length} 项公司能力映射和 ${cockpitRows.length} 项运营 KPI 定义；该主题所需账号或经营时序尚未接入，因此不输出模板数字。`,
    cards: [
      { label: "当前可验证", value: availableLabels.slice(0, 4).join(" / ") || "公司能力输入待登记", note: "只复用本报告中的 seller_fit_scorecard 与 weekly_cockpit。" },
      { label: "待接入数据合同", value: requiredInput, note: "必须保留来源、时间窗、单位、责任人与原始明细。" },
      { label: "放行标准", value: gate, note: "未接入前保持 PENDING，不用旧品类或示例账号数据补位。" },
    ],
    gate,
    confidence: "PENDING",
  };
}

const SELLER_ACCOUNT_HEALTH_KPIS = Object.freeze([
  {
    label: "账户健康评分 AHR",
    threshold: "警戒 < 200；红线 <= 100（以站点政策为准）",
    requiredData: "Seller Central AHR 日快照、违规事件与申诉状态",
    action: "低于警戒线即冻结放量，逐项关闭高影响违规。",
  },
  {
    label: "订单缺陷率 ODR",
    threshold: "目标 < 1%（滚动 60 天）",
    requiredData: "订单缺陷、A-to-z、负面反馈与信用卡拒付明细",
    action: "按 ASIN 与原因归因，48 小时内关闭责任动作。",
  },
  {
    label: "Late Shipment",
    threshold: "目标 < 4%（自配送订单）",
    requiredData: "订单承诺发货日、实际确认发货日与承运线路",
    action: "触线即收紧承诺时效并复盘仓配异常。",
  },
  {
    label: "有效追踪率 VTR",
    threshold: "目标 > 95%（适用货件）",
    requiredData: "追踪号、承运商扫描、妥投与豁免订单明细",
    action: "优先修复无首扫、错承运商和无效追踪号。",
  },
  {
    label: "政策违规",
    threshold: "高危未关闭事件 = 0",
    requiredData: "政策合规通知、影响等级、申诉与关闭日期",
    action: "高危事件一票否决；责任人和复核日期必须齐备。",
  },
  {
    label: "退货不满意率",
    threshold: "目标 < 10%（以站点当前口径为准）",
    requiredData: "退货负评、响应时效、拒绝与逆向处理明细",
    action: "拆分产品、物流和服务原因，周度关闭 Top 问题。",
  },
]);

const SELLER_OPERATING_KPIS = Object.freeze([
  {
    label: "年度 GMV",
    threshold: "达到董事会年度预算及渠道拆解目标",
    requiredData: "订单、退款、取消、站点、币种与财务确认收入",
    action: "按站点 / ASIN / 周拆解目标差距与增量来源。",
  },
  {
    label: "毛利率",
    threshold: "达到财务签核的品类毛利红线",
    requiredData: "净销售额、采购、头程、关税、平台费与仓配成本",
    action: "低于红线时联动价格、BOM 与物流方案。",
  },
  {
    label: "净利率",
    threshold: "达到董事会签核的净利停止线",
    requiredData: "全口径 P&L、广告、退货、售后及分摊费用",
    action: "按贡献桥识别亏损 ASIN，触线即停止扩量。",
  },
  {
    label: "投产比 ROI",
    threshold: "达到公司投放回收门槛与观察窗要求",
    requiredData: "广告花费、归因销售、增量毛利与归因窗口",
    action: "仅按增量贡献判定，关停持续低效投放。",
  },
  {
    label: "TACOS",
    threshold: "不高于品类阶段目标且自然单占比改善",
    requiredData: "广告花费、总销售额、广告销售额与自然订单",
    action: "按搜索词和 ASIN 周度调预算，防止广告依赖。",
  },
  {
    label: "退货率",
    threshold: "不高于可比品类基线与公司质量红线",
    requiredData: "订单级退货、原因码、责任归因与退款损失",
    action: "Top 原因回写 CTQ、包装、说明书和质检计划。",
  },
  {
    label: "库存周转",
    threshold: "达到财务签核的周转天数与缺货双门槛",
    requiredData: "SKU-week 库存、在途、销量、交期与缺货天数",
    action: "重算补货点与安全库存，清理超龄库存。",
  },
  {
    label: "复购率",
    threshold: "达到品牌年度目标及可比品类基线",
    requiredData: "匿名客户 cohort、复购窗口、站点与产品族订单",
    action: "区分同品复购和跨品类复购，反推产品组合。",
  },
]);

function pendingSellerKpis(title, cards, note, variant) {
  return {
    kind: "seller-kpis",
    title,
    source_path: "modules.crossborder_seller_cockpit",
    variant,
    confidence: "PENDING",
    status: "待接入",
    cards: cards.map((card) => ({
      ...card,
      value: "PENDING",
      unit: "",
      status: "待接入",
    })),
    note,
  };
}

function curatedSellerCockpitPages(moduleData, pagePlans) {
  const note = `${safeText(moduleData.evidence_state?.body)} 当前未接入 Seller Central 与公司订单实账，账号健康及运营结果不得用模板数字代替。`;
  const pages = [];
  for (let offset = 0; offset < pagePlans.length; offset += 1) {
    const topic = SELLER_COCKPIT_TOPICS[offset] || pagePlans[offset]?.topic || `卖家驾驶舱数据合同 ${offset + 1}`;
    if (offset === 0) {
      pages.push([pendingSellerKpis(
        "跨境卖家账户健康看板",
        SELLER_ACCOUNT_HEALTH_KPIS,
        `${note} 指标阈值用于定义监控与停止线，最终以目标站点当期政策口径复核。`,
        "account-health",
      )]);
      continue;
    }
    if (offset === 9) {
      pages.push([pendingSellerKpis(
        "卖家经营 KPI 总览",
        SELLER_OPERATING_KPIS,
        `${note} 本页只定义董事会经营驾驶舱的数据合同、门槛与动作，不将能力说明或示例值冒充经营结果。`,
        "operating",
      )]);
      continue;
    }
    pages.push([sellerCockpitResearch(moduleData, topic)]);
  }
  return pages;
}

function compactComparisonSide(value, title, indexes, rowCount = 4) {
  if (!isTable(value)) return { title, columns: ["状态"], rows: [["待接入"]] };
  const selected = indexes.filter((index) => index < value.columns.length);
  return {
    title,
    columns: selected.map((index) => String(value.columns[index])),
    rows: value.rows.slice(0, rowCount).map((row) => {
      const normalized = normalizeRow(row, value.columns);
      return selected.map((index) => normalized[index]);
    }),
  };
}

function methodologyGridArtifact(report, moduleData) {
  const methodology = moduleData.methodology || {};
  const scorecard = report.modules?.exec_summary_decision_scorecard?.scorecard || {};
  const finance = report.modules?.output_unit_economics_finance || report.modules?.financial_model || {};
  const costRows = isTable(finance.cost_waterfall)
    ? finance.cost_waterfall.rows.map((row) => normalizeRow(row, finance.cost_waterfall.columns))
    : [];
  const contribution = costRows.find((row) => /贡献利润/.test(safeText(row[0])));
  const scoreRule = safeText(scorecard.score_derivation?.method)
    || "机会判断由需求、品牌、履约、竞争与合规五维管理层初评构成；任一硬闸门失败时不得用总分覆盖。";
  const sourceRule = Array.isArray(methodology.source_hierarchy)
    ? methodology.source_hierarchy.map(safeText).join("；")
    : "来源按官方/零售商、可交叉验证第三方与未验证估算分级。";
  const contributionSummary = contribution
    ? `当前立项假设：${safeText(contribution[1])} USD / ${safeText(contribution[2])}；必须用工厂报价、渠道费率和真实履约账单复算。`
    : "PENDING：尚无可复算贡献利润；接入售价、成本、渠道费、广告、履约与退货实账后计算。";
  return {
    kind: "methodology-grid",
    title: "方法论、观察窗口与计算规则",
    cards: [
      {
        code: "01",
        title: "销量与置信分级",
        body: sourceRule,
        footer: `观察窗口截至 ${methodology.data_cutoff || "待登记"}；第三方销量不视为 Amazon 官方结算数据。`,
      },
      {
        code: "02",
        title: "机会分与硬闸门",
        body: scoreRule,
        footer: scorecard.management_total_score == null
          ? "当前状态：PENDING"
          : `当前 ${scorecard.management_total_score}/100；管理层立项初评，不是市场测量值。`,
      },
      {
        code: "03",
        title: "单位经济（立项闸门）",
        body: "贡献利润 = 售价 - 出厂 - 头程/关税/入仓 - 履约 - 渠道费 - 广告 - 退货准备 - 运营成本。",
        footer: contributionSummary,
      },
    ],
  };
}

function methodologyWarningArtifact(moduleData) {
  const methodology = moduleData.methodology || {};
  return {
    kind: "warning-list",
    title: "方法局限、误差来源与缓解",
    items: [
      {
        title: "第三方销量与搜索估算",
        risk: "非 Amazon 官方结算口径，可能受类目污染、变体合并和模型误差影响。",
        mitigation: "接入 SP-API / Keepa 付费历史 / 公司订单后交叉验证；未验证前只作方向信号。",
      },
      {
        title: "VOC 抽样与编码边界",
        risk: "公开来源页与编码观察不是随机全量评论，不能外推为市场发生率。",
        mitigation: "扩大去重评论与 ASIN 覆盖，保留转述、来源、时间窗和证据限制。",
      },
      {
        title: "AIGC 概念与结论边界",
        risk: "概念图和模型综合不构成工程、合规、销量或财务事实。",
        mitigation: "以 CAD、样机、测试、报价和产品/工程/法规/财务人工签核放行。",
      },
      {
        title: "观察窗口与时点偏差",
        risk: `价格、评分、评论与政策为截至 ${methodology.data_cutoff || "报告观察日"} 的快照，促销和规则会变化。`,
        mitigation: "董事会放行前刷新关键时序、关税/法规、报价与履约成本，并记录版本差异。",
      },
    ],
  };
}

function conceptReviewRows(moduleData) {
  const matrix = moduleData.concept_matrix || moduleData.aigc_concept_portfolio?.concept_options;
  if (!isTable(matrix)) return { columns: [], rows: [] };
  return {
    columns: matrix.columns.map(String),
    rows: matrix.rows.slice(0, 6).map((row) => normalizeRow(row, matrix.columns)),
  };
}

function conceptMatrixArtifact(moduleData) {
  const matrix = conceptReviewRows(moduleData);
  if (!matrix.columns.length) return tablePage(moduleData.concept_scorecard || moduleData.decision_model, "候选概念矩阵与选型结论");
  return {
    kind: "table",
    title: "候选概念矩阵与选型结论",
    source_path: "modules.pd_concept_matrix.concept_matrix",
    columns: matrix.columns,
    rows: matrix.rows,
    preserveTable: true,
    rowLimit: 6,
    note: "六个候选为 AIGC 辅助的内部设计假设；价格、工程复杂度与放行结论必须经 WTP、DFM、报价、FTO 和人工评审验证。",
  };
}

function conceptSceneSuiteArtifact(report) {
  const concept = report.modules?.board_concept || report.modules?.pd_concept_matrix?.product_concept || {};
  const reviewPack = report.modules?.pd_concept_matrix?.aigc_design_review_pack || {};
  const rawSuite = Array.isArray(concept.scene_suite)
    ? concept.scene_suite
    : Array.isArray(reviewPack.scene_suite)
      ? reviewPack.scene_suite
      : Array.isArray(reviewPack.scene_suite?.assets)
        ? reviewPack.scene_suite.assets
        : [];
  const items = rawSuite.map((asset, index) => ({
    role: safeText(asset?.role || `scene_${index + 1}`),
    title: safeText(asset?.title || asset?.label || `场景 ${index + 1}`),
    image: imageUrl(asset),
    sequence: numeric(asset?.sequence) ?? index + 1,
  })).filter((asset) => asset.image).sort((left, right) => left.sequence - right.sequence);
  if (items.length < 2) return null;
  return {
    kind: "scene-suite",
    title: "AIGC 专业场景套图 · 同一产品设计 DNA",
    items: items.slice(0, 4),
    total: items.length,
    designDnaId: safeText(concept.design_dna_id || reviewPack.scene_suite?.design_dna_id || reviewPack.scene_suite_contract?.design_dna_id),
    consistencyStatus: safeText(concept.scene_suite_consistency || reviewPack.scene_suite?.consistency_status || "PENDING-HUMAN-REVIEW"),
    note: "网页保留完整套图；本页展示最多 4 张关键视图。场景图用于设计评审，不替代 CAD、实拍、测试或量产签样。",
  };
}

function conceptHeatmap(moduleData) {
  const matrix = conceptReviewRows(moduleData);
  const complexityScore = (value) => /低(?![中高])/i.test(safeText(value)) ? 3 : /中高|高/i.test(safeText(value)) ? 1 : 2;
  const rows = matrix.rows.map((row) => {
    const tasks = safeText(row[1]).split(/[；;、]/).filter(Boolean).length;
    const price = numeric(row[4]);
    const conclusion = safeText(row[5]);
    return {
      label: safeText(row[0]) || "候选方案",
      price,
      scores: [
        Math.min(3, tasks),
        safeText(row[2]) ? 3 : 0,
        complexityScore(row[3]),
        price == null ? 0 : 3,
        /推荐|主推|首发/.test(conclusion) ? 3 : conclusion ? 2 : 0,
        0,
      ],
    };
  });
  return {
    kind: "chart",
    title: "概念 × 评估维度评分热力图",
    source_path: "modules.pd_concept_matrix.concept_matrix",
    value: {
      xLabels: ["VOC任务覆盖", "设计语言", "工程可控", "价格口径", "首发适配", "人工签核"],
      yLabels: rows.map((row) => row.label),
      matrix: rows.map((row) => row.scores),
    },
    note: "0–3 为当前结构化字段完整度与内部预评，只用于方案筛选；不是消费者偏好、市场概率或 Conjoint 结果。",
  };
}

function conceptPositioning(moduleData) {
  const matrix = conceptReviewRows(moduleData);
  const prices = matrix.rows.map((row) => numeric(row[4])).filter((value) => value != null);
  const basePrice = prices.length ? Math.min(...prices) : 0;
  const rows = matrix.rows.map((row) => {
    const price = numeric(row[4]);
    const taskCount = safeText(row[1]).split(/[；;、]/).filter(Boolean).length;
    const designSignal = /完整|升级/.test(safeText(row[2])) ? 2 : safeText(row[2]) ? 1 : 0;
    const selectionSignal = /推荐|主推|首发/.test(safeText(row[5])) ? 1 : 0;
    return {
      label: safeText(row[0]) || "候选方案",
      x: price == null ? null : Number((price - basePrice).toFixed(1)),
      y: taskCount + designSignal + selectionSignal,
    };
  }).filter((row) => row.x != null);
  return {
    kind: "chart",
    title: "成本增量 × 差异度定位图",
    source_path: "modules.pd_concept_matrix.concept_matrix",
    value: { points: rows, xKey: "x", yKey: "y", labelKey: "label", xLabel: "价格假设增量（相对最低方案 USD）", yLabel: "差异化字段信号" },
    note: "未取得 BOM 增量报价前，横轴只使用相对价格假设，纵轴由消费者任务数、设计语言和首发结论形成内部字段信号；不冒充成本事实或消费者效用。",
  };
}

function conceptFbeArtifact(report) {
  const translation = report.modules?.problem_solver_concept?.translation;
  if (!isTable(translation)) return tablePage(translation, "特性-利益-证据（FBE）映射表");
  return {
    kind: "table",
    title: "特性-利益-证据（FBE）映射表",
    source_path: "modules.pd_concept_matrix",
    derived_source_paths: ["modules.problem_solver_concept.translation"],
    columns: ["特性（Feature）", "利益（Benefit）", "证据（Evidence）", "VOC 支持口径", "货架文案边界"],
    rows: translation.rows.slice(0, 5).map((sourceRow) => {
      const row = normalizeRow(sourceRow, translation.columns);
      return [
        safeText(row[1]) || "设计响应待定义",
        safeText(row[0]) || "消费者利益待验证",
        safeText(row[2]) || "PENDING",
        "方向性编码观察；不外推比例",
        safeText(row[3]) || "仅表达已验证结构、尺寸与测试",
      ];
    }),
    preserveTable: true,
    note: "FBE 只把已登记 VOC 方向翻译为待验证产品命题；工程证据、消费者效用和货架声明必须分别签核。",
  };
}

function conceptIpDesignAround(moduleData, ipModule) {
  const matrix = conceptReviewRows(moduleData);
  if (!matrix.rows.length) return tablePage(ipModule?.search_protocol, "专利 / IP 风险与规避设计表");
  const designAround = [
    "纹样、连接件与尺寸比例保留替代路径",
    "冻结前完成权利要求要素表与外观相似比对",
    "材料和服务升级不与未核实专利方案绑定",
    "拆装接口与包装结构采用可替换设计",
    "CMF、纹样和渲染保留原创及授权记录",
    "模块接口与补件结构在检索后冻结",
  ];
  return {
    kind: "table",
    title: "专利 / IP 风险与规避设计表",
    source_path: "modules.pd_concept_matrix.concept_matrix",
    columns: ["候选概念", "检索范围", "当前证据", "风险等级", "规避 / 设计绕行", "建议动作"],
    rows: matrix.rows.slice(0, 6).map((row, index) => [
      safeText(row[0]) || `候选 ${index + 1}`,
      /材料|CMF/i.test(safeText(row[2])) ? "外观 / 材料声明" : /模块|拆装|替换/i.test(safeText(row[2])) ? "实用 / 连接结构" : "外观 + 实用筛查",
      "PENDING｜最终 CAD / claim set 未完成",
      "PENDING",
      designAround[index] || "保留可替换结构与外观路径",
      "专利律师检索 + 设计评审签核",
    ]),
    preserveTable: true,
    rowLimit: 6,
    note: "PENDING 不等于低风险或无风险。任何候选方案都必须以最终 CAD、目标市场专利族和专业 FTO 意见放行。",
  };
}

function conceptScorecard(report, moduleData) {
  const matrix = conceptReviewRows(moduleData);
  const recommended = matrix.rows.find((row) => /推荐|主推|首发/.test(safeText(row[5]))) || matrix.rows[0] || [];
  const concept = moduleData.product_concept || report.modules?.board_concept || {};
  const fto = report.modules?.risk_patent_ip_defense?.evidence_state;
  return {
    kind: "table",
    title: "概念记分卡",
    columns: ["评审项", "当前结论", "证据状态", "放行条件"],
    rows: [
      ["推荐方案", safeText(recommended[0]) || concept.title || "待评审", "内部概念矩阵", "产品、财务与工程共同签核"],
      ["消费者任务", safeText(recommended[1]) || "待补证", "VOC 方向性编码", "目标用户概念测试复核"],
      ["价格假设", safeText(recommended[4]) || "待报价", "管理层假设", "真实 WTP、报价与单位经济通过"],
      ["AIGC 主图", concept.image_url ? "已生成方向图" : "待生成", "非工程证据", "外观、结构和量产签样一致"],
      ["IP / 合规", safeText(fto?.tag || "FTO-PENDING"), "筛查阶段", "最终 CAD 与文案完成专业终审"],
    ],
    preserveTable: true,
    note: "概念记分卡只汇总当前证据状态，不把 AIGC 方向图或内部评分当作市场事实。",
  };
}

function upgradePriorityChart(report) {
  const distribution = report.modules?.voc_evidence?.theme_distribution;
  if (!isTable(distribution)) {
    return { kind: "callout", title: "核心升级点排序", tag: "VOC-PENDING", body: "缺少可追溯 VOC 主题分布，升级点保持待验证。" };
  }
  const rows = distribution.rows.map((row) => normalizeRow(row, distribution.columns));
  return {
    kind: "chart",
    title: "核心升级点排序（真实 VOC 编码观察）",
    value: {
      items: rows.map((row) => ({ label: safeText(row[0]), value: numeric(row[2]) ?? numeric(row[1]) ?? 0, unit: " 条" }))
        .sort((a, b) => b.value - a.value).slice(0, 8),
    },
    note: "优先级按本轮负向编码观察排序；观察数不外推为市场发生率，最终升级项须经概念测试和工程验证。",
  };
}

function curatedAigcPages(report, id) {
  const moduleData = report.modules?.[id] || {};
  const concept = moduleData.product_concept || report.modules?.board_concept || {};
  if (id === "pd_concept_matrix") {
    const ipModule = report.modules?.risk_patent_ip_defense || {};
    const heatmap = conceptHeatmap(moduleData);
    const conceptRows = conceptReviewRows(moduleData);
    const selectedIndexes = conceptRows.rows.map((row, index) => ({ index, conclusion: safeText(row[5]) }))
      .filter((item) => /推荐|概念测试/.test(item.conclusion))
      .map((item) => item.index)
      .slice(0, 2);
    const radarIndexes = selectedIndexes.length ? selectedIndexes : heatmap.value.yLabels.map((_, index) => index).slice(0, 2);
    const sceneSuite = conceptSceneSuiteArtifact(report);
    return [
      [conceptMatrixArtifact(moduleData)],
      [heatmap, ...(sceneSuite ? [sceneSuite] : [])],
      [conceptFbeArtifact(report)],
      [conceptPositioning(moduleData)],
      [conceptIpDesignAround(moduleData, ipModule)],
      [
        {
          kind: "chart",
          title: "入选概念可行性基准带雷达",
          source_path: "modules.pd_concept_matrix.concept_matrix",
          value: {
            axes: heatmap.value.xLabels,
            series: radarIndexes.map((index) => ({ name: heatmap.value.yLabels[index], scores: heatmap.value.matrix[index] })),
          },
          note: heatmap.note,
        },
        { kind: "callout", title: "概念冻结决策", source_path: "modules.pd_concept_matrix.evidence_state", tag: "HUMAN-GATE", body: `${safeText(moduleData.evidence_state?.body)} AIGC 方向图继续保留在执行摘要与产品概念页，但不替代本模块的六项原始评审。` },
      ],
    ];
  }
  if (id === "problem_solver_concept") {
    const synthesis = moduleData.aigc_grounded_synthesis?.synthesis_matrix;
    const translation = moduleData.translation;
    return [
      [{
        kind: "concept-compare",
        title: "产品概念 × 竞品/VOC 证据对标",
        source_path: "modules.problem_solver_concept.product_concept",
        image: concept.image_url,
        conceptTitle: concept.title || "推荐产品概念",
        thesis: concept.thesis || moduleData.evidence_state?.body,
        benchmark: compactComparisonSide(synthesis, "市场/竞品证据到概念", [0, 1, 2, 3], 3),
        translation: compactComparisonSide(translation, "VOC 到设计响应", [0, 1, 2], 4),
        note: "只使用本报告已有竞品/VOC 证据锚点；AIGC 综合不新增 observed fact。",
      }],
      [
        conceptScorecard(report, moduleData),
        upgradePriorityChart(report),
      ],
    ];
  }
  return null;
}

function selectTable(value, title, indexes, start = 0, count = 6, note = "") {
  if (!isTable(value)) return tablePage(value, title);
  const selected = indexes.filter((index) => index < value.columns.length);
  const rowCount = Math.min(count, tableRowLimit(selected.length));
  return {
    kind: "table",
    title,
    columns: selected.map((index) => String(value.columns[index])),
    rows: value.rows.slice(start, start + rowCount).map((row) => {
      const normalized = normalizeRow(row, value.columns);
      return selected.map((index) => normalized[index]);
    }),
    note: note || value.note,
  };
}

function marketSizeTransitionPage(report, moduleData) {
  const audit = report.modules?.meta_evidence_audit?.evidence_state || {};
  const sizeState = moduleData.evidence_state || {};
  const sourceModel = isTable(moduleData.model) ? moduleData.model : { columns: [], rows: [] };
  const definitions = new Map(sourceModel.rows.map((row) => {
    const normalized = normalizeRow(row, sourceModel.columns);
    return [safeText(normalized[0]), safeText(normalized[1])];
  }));
  const definition = (key, fallback) => definitions.get(key) || fallback;
  const formula = "不可计算｜公式：年销量 × 均价";
  const shareFormula = (parent) => `不可计算｜公式：本层规模 / ${parent}规模`;
  return [
    {
      kind: "callout",
      title: "证据是否支撑决策的审计结论",
      source_path: "modules.meta_evidence_audit.evidence_state",
      tag: audit.tag || "AUDIT-PENDING",
      body: `${safeText(audit.body || "证据审计尚未完成，当前结论保持待审。")}
市场规模缺少可审计类目销量与成交价，本页不复制参考报告数字。`,
    },
    {
      kind: "callout",
      title: "市场规模拆解章节锚点",
      source_path: "modules.market_size_decomposition.evidence_state",
      tag: sizeState.tag || "SIZE-PENDING",
      body: `${safeText(sizeState.body || "TAM、SAM、SOM 当前只保留计算结构。")}
${safeText(moduleData.release_rule || "上下两种口径交叉且来源可追溯后，才允许输出规模数字。")}`,
    },
    {
      kind: "table",
      title: "TAM、SAM、SOM 6 列漏斗拆解表",
      source_path: "modules.market_size_decomposition.model",
      columns: ["层级", "口径定义", "年销量（件）", "均价（USD）", "市场规模（USD）", "占上层比"],
      rows: [
        ["TAM", definition("TAM", `${report.category} 美国相关终端消费`), "PENDING", "待接入", formula, "基准层"],
        ["SAM", definition("SAM", "目标渠道、价格与规格可服务市场"), "PENDING", "待接入", formula, shareFormula("TAM")],
        ["SAM-核心带", "目标渠道 × 核心价格带 × 目标规格交集", "PENDING", "待接入", formula, shareFormula("SAM")],
        ["SOM", definition("SOM", "公司在既定时间窗内可获取市场"), "PENDING", "待接入", formula, shareFormula("SAM-核心带")],
        ["SOM-Y1", "首年冷启动、补货与阶段放量约束下的可获取市场", "PENDING", "待接入", formula, shareFormula("SOM")],
      ],
      preserveTable: true,
      note: "PENDING 不等于 0。需接入类目销量、真实成交价、渠道边界、产能、CVR、广告与库存数据后计算。",
    },
  ];
}

function evDecisionTransitionPage(report, moduleData) {
  const concept = report.modules?.board_concept || {};
  const decision = reportDecision(report);
  const quadrant = report.modules?.beta_alpha_quadrant?.quadrant;
  const candidateNames = [
    report.category,
    ...(isTable(quadrant) ? quadrant.rows.map((row) => safeText(normalizeRow(row, quadrant.columns)[0])) : []),
  ].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).slice(0, 4);
  const rows = (candidateNames.length ? candidateNames : [concept.title || "当前候选概念"]).map((candidate) => [
    candidate,
    "PENDING",
    "PENDING",
    "PENDING",
    "PENDING",
    "PENDING",
    "不可计算",
    "待数据接入",
  ]);
  return [
    {
      kind: "kpi-cards",
      title: "决策收口 · 4 项 KPI",
      source_path: "modules.strategy_map",
      items: [
        { label: "AI 研究建议", value: safeText(decision.verdict || "PENDING"), note: "研究建议受利润、质量与合规硬闸门约束，不替代人工终审。" },
        { label: "最优赛道", value: "PENDING", note: `当前评审候选：${safeText(report.category || concept.title || "待登记")}；缺少可比候选 EV。` },
        { label: "概念总分", value: "PENDING", note: "缺少统一候选基准与真实实验校准。" },
        { label: "放行条件", value: "EV 输入齐备", note: "P（赢）、赢时收益和输时沉没成本均须可审计。" },
      ],
      note: "四卡保留参考页决策架构；未验证的概率、收益与评分不补数。",
    },
    {
      kind: "callout",
      title: "EV 该不该由你做 · 期望价值章节锚点",
      source_path: "modules.ev_decision.evidence_state",
      tag: moduleData.evidence_state?.tag || "EV-PENDING",
      body: `${safeText(moduleData.evidence_state?.body || "成功概率尚未用真实基准率校准。")}
当前 EV 不可计算；应先通过 DFM、EVT、DVT 与小批量真实履约购买信息。`,
    },
    {
      kind: "table",
      title: "候选 EV 决策表（Beta × Alpha → 期望值）",
      source_path: "modules.ev_decision.ev_logic",
      columns: ["候选赛道", "Beta（市场）", "Alpha（公司胜算）", "P（赢）", "赢时收益", "输时沉没", "EV", "裁决"],
      rows,
      preserveTable: true,
      note: "EV = P（赢）× 赢时收益 − [1 − P（赢）] × 输时沉没。三项输入缺失时显示不可计算，PENDING 不等于 0。",
    },
  ];
}

const STRATEGY_PENDING = "PENDING";

function strategyText(value, fallback = STRATEGY_PENDING) {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value)) {
    const text = value.map((item) => strategyText(item, "")).filter(Boolean).join(" / ");
    return text || fallback;
  }
  if (isObject(value)) {
    const preferred = value.title || value.label || value.name || value.id || value.body || value.value;
    return preferred == null ? fallback : strategyText(preferred, fallback);
  }
  const text = safeText(value).trim();
  return text || fallback;
}

function strategyRecords(value, nestedKeys = []) {
  const toRecords = (candidate) => {
    if (isTable(candidate)) {
      return candidate.rows.map((row) => {
        const cells = normalizeRow(row, candidate.columns);
        return {
          ...Object.fromEntries(candidate.columns.map((column, index) => [String(column), cells[index]])),
          _cells: cells,
        };
      });
    }
    if (Array.isArray(candidate)) {
      return candidate.map((item) => isObject(item) ? item : { _cells: Array.isArray(item) ? item : [item] });
    }
    return [];
  };
  const direct = toRecords(value);
  if (direct.length) return direct;
  if (!isObject(value)) return [];
  for (const key of nestedKeys) {
    const records = toRecords(value[key]);
    if (records.length) return records;
  }
  return [];
}

function strategyField(record, aliases, fallbackIndex = -1, fallback = STRATEGY_PENDING) {
  if (!isObject(record)) return fallback;
  const normalize = (value) => String(value || "").toLocaleLowerCase().replace(/[\s_()（）·/\-]/g, "");
  const normalizedAliases = aliases.map(normalize);
  const entries = Object.entries(record).filter(([key]) => key !== "_cells");
  for (const [key, value] of entries) {
    if (normalizedAliases.includes(normalize(key)) && value != null && value !== "") return strategyText(value, fallback);
  }
  for (const [key, value] of entries) {
    const normalizedKey = normalize(key);
    if (normalizedAliases.some((alias) => alias.length >= 3 && normalizedKey.includes(alias)) && value != null && value !== "") {
      return strategyText(value, fallback);
    }
  }
  if (fallbackIndex >= 0 && Array.isArray(record._cells)) return strategyText(record._cells[fallbackIndex], fallback);
  return fallback;
}

function strategyExactField(record, aliases, fallbackIndex = -1, fallback = STRATEGY_PENDING) {
  if (!isObject(record)) return fallback;
  const normalize = (value) => String(value || "").toLocaleLowerCase().replace(/[\s_()（）·/\-]/g, "");
  const normalizedAliases = aliases.map(normalize);
  for (const [key, value] of Object.entries(record)) {
    if (key === "_cells" || !normalizedAliases.includes(normalize(key))) continue;
    return value == null || value === "" ? fallback : strategyText(value, fallback);
  }
  if (fallbackIndex >= 0 && Array.isArray(record._cells)) return strategyText(record._cells[fallbackIndex], fallback);
  return fallback;
}

function strategyValue(value, aliases, fallback = STRATEGY_PENDING) {
  if (!isObject(value)) return fallback;
  return strategyField(value, aliases, -1, fallback);
}

function actionStrategyArtifact(report) {
  const executive = report.modules?.exec_summary_decision_scorecard || {};
  const gtm = report.modules?.gtm_plan || {};
  const candidates = [
    gtm.action_items,
    gtm.action_plan?.items,
    executive.action_items,
    gtm.action_plan?.plan,
    gtm.launch_sequence,
  ];
  let records = [];
  for (const candidate of candidates) {
    records = strategyRecords(candidate, ["items", "plan", "rows"]);
    if (records.length) break;
  }
  if (!records.length) records = [{}];
  const rows = records.slice(0, 5).map((record, index) => {
    const id = strategyField(record, ["id", "action_id", "待办id", "编号"], -1, `A${String(index + 1).padStart(2, "0")}`);
    const priority = strategyField(record, ["priority", "优先级", "层级"], 0, index < 2 ? "P0" : "P1");
    const dependencies = strategyField(record, ["dependency_ids", "dependencies", "依赖", "前置"], -1);
    const evidence = strategyField(record, ["evidence_ids", "evidence", "证据id", "证据"], -1);
    const acceptance = strategyField(record, ["acceptance", "acceptance_criteria", "验收", "验收标准", "放行依据"], 4);
    const stopLine = strategyField(record, ["stop_line", "gate", "validation_gate", "闸门", "停止线"], -1, acceptance);
    const title = strategyField(record, ["title", "action", "task", "待办", "动作", "任务"], 1);
    const deliverable = strategyField(record, ["deliverable", "output", "交付物", "产出"]);
    const timeWindow = strategyField(record, ["time_window", "due_offset", "due", "deadline", "时间窗", "时间", "阶段"], 3);
    const contract = isObject(record.acceptance_contract) ? record.acceptance_contract : {};
    const metric = strategyValue(contract, ["metric", "指标"]);
    const threshold = strategyValue(contract, ["threshold", "阈值"]);
    const phaseThresholdSummary = {
      "D0–14": "≥2 家可比 RFQ；关键合规/税则闭合；未知项有 Owner",
      "D15–30": "主概念选择率 ≥70%；完成价格测试；Must 项 100% 受控",
      "D31–60": "Must 项 100% 通过；高风险 CAPA 100% 复验关闭",
      "D61–90": "50–100 单仅 PILOT_ALERT；≥100 个成熟订单后人工签核",
    }[timeWindow];
    const acceptanceSummary = metric !== STRATEGY_PENDING && threshold !== STRATEGY_PENDING
      ? `指标：${metric}｜阈值：${phaseThresholdSummary || threshold}`
      : acceptance;
    const evidenceCount = Array.isArray(record.evidence_ids)
      ? record.evidence_ids.filter(Boolean).length
      : 0;
    const dependencyEvidence = [
      dependencies,
      evidenceCount ? `${evidenceCount} 个证据锚点` : evidence,
    ].filter((value) => value !== STRATEGY_PENDING).join(" / ") || STRATEGY_PENDING;
    const phaseStopSummary = {
      "D0–14": "成本、合规或供应可行性任一未闭合则停止",
      "D15–30": "用户任务、价格或 DFM 任一未过门则停止",
      "D31–60": "质量/安全硬闸或 CAPA 未关闭则停止首批",
      "D61–90": "成熟订单财务/物流红线任一失败则冻结补货",
    }[timeWindow];
    return [
      `${id} · ${priority}`,
      deliverable === STRATEGY_PENDING ? title : `${title}｜交付：${deliverable}`,
      strategyField(record, ["owner_role", "owner", "责任人", "负责"], 2),
      timeWindow,
      strategyField(record, ["status", "状态"], -1, "not_started"),
      dependencyEvidence,
      `${acceptanceSummary}｜停止：${phaseStopSummary || stopLine}`,
    ];
  });
  return {
    kind: "table",
    title: "90 天待办 · 状态、依赖与验收门",
    columns: ["ID / 优先级", "待办 / 交付物", "Owner", "时间", "状态", "依赖 / 证据", "验收 / 停止线"],
    rows,
    preserveTable: true,
    note: "本页显示董事会摘要；完整样本、证据、签核人、来源合同与品类停止线保留在结构化报告数据包。p10 与 p51 读取同一待办合同。",
  };
}

function jtbdStrategyArtifact(report) {
  const mind = report.modules?.MIND_DECODE || {};
  const jtbd = mind.jtbd || mind.jtbd_framework || mind.jobs_to_be_done || {};
  let records = strategyRecords(jtbd, ["jobs", "items", "job_table", "matrix"]);
  const circumstances = strategyRecords(jtbd.circumstances);
  if (!records.length) records = [{}];
  return {
    kind: "table",
    title: "JTBD · 情境、进展、障碍与验证门",
    columns: ["JTBD 任务", "情境 / 触发", "期望进展", "当前障碍", "产品机会", "证据 ID", "验证门"],
    rows: records.slice(0, 5).map((record, index) => {
      const jobId = strategyField(record, ["job_id", "jobid", "编号"], 0, `JOB-${index + 1}`);
      const jobType = strategyField(record, ["job_type", "任务类型", "类型"], 1);
      const statement = strategyField(record, ["job_statement", "job_to_be_done", "任务陈述", "核心任务", "title"], 2);
      const circumstance = circumstances[index] || {};
      let barrier = strategyField(record, ["barrier", "pain", "obstacle", "阻碍", "障碍", "痛点"]);
      if (barrier === STRATEGY_PENDING) barrier = strategyField(circumstance, ["阻碍", "barrier", "obstacle"], 1);
      return [
        `${jobId} · ${jobType}｜${statement}`,
        strategyField(record, ["situation", "trigger", "context", "购买/使用情境", "情境", "触发"], 3),
        strategyField(record, ["desired_progress", "outcome", "progress", "期望进展", "结果"], 4),
        barrier,
        strategyField(record, ["product_response", "product_opportunity", "solution", "产品响应", "产品机会", "产品动作"], 5),
        strategyField(record, ["evidence_ids", "evidence", "证据锚点", "证据id", "证据"], 6),
        strategyField(record, ["validation_gate", "gate", "验证门", "验证门槛"], 7),
      ];
    }),
    preserveTable: true,
    note: "JTBD 是待验证的任务假设；每条任务必须保留证据 ID 和验证门，不能把 AIGC 归纳当成已发生事实。",
  };
}

function psychologyJourneyArtifact(report, page) {
  const mind = report.modules?.MIND_DECODE || {};
  const psychology = mind.consumer_psychology || {};
  const journey = mind.customer_journey || {};
  const byPage = {
    26: psychology.psychology_evidence_readiness,
    27: psychology.value_risk_signal_map,
    28: psychology.behavior_mechanism_flow,
    29: journey.journey_flow,
    30: journey.touchpoint_pain_heatmap,
  };
  const artifact = byPage[page];
  if (artifact?.kind === "chart") return artifact;
  return {
    kind: "callout",
    title: page >= 29 ? "消费旅程证据待补齐" : "消费者心理证据待补齐",
    tag: "DATA-PENDING",
    body: "结构化研究合同已保留；真实 VOC、行为、调查与订单适配器接入前不生成心理发生率、阶段转化率或因果提升。",
  };
}

function stpState(report) {
  const marketMap = report.modules?.market_map_segment_grade || {};
  const segmentGrade = report.modules?.segment_grade_matrix || {};
  return marketMap.stp || segmentGrade.stp || {
    segmentation: segmentGrade.segments,
    targeting: marketMap.targeting,
    positioning: marketMap.positioning || report.modules?.gtm_plan?.positioning,
  };
}

function stpOverviewArtifact(report) {
  const stp = stpState(report);
  const segments = strategyRecords(stp.segmentation, ["segments", "items", "matrix"]);
  const targeting = stp.targeting || {};
  const positioning = stp.positioning || {};
  const target = strategyValue(
    targeting,
    ["primary_target_id", "primary_segment", "target_segment", "selected_segment", "目标细分"],
    strategyValue(positioning, ["target", "target_segment_id", "目标用户", "目标细分"]),
  );
  const statement = strategyValue(positioning, ["positioning_statement", "statement", "定位声明", "body", "title"]);
  const positionFrame = strategyValue(
    positioning,
    ["frame_of_reference", "category_frame", "竞争框架", "参照品类"],
    statement,
  );
  return {
    kind: "kpi-cards",
    title: "STP · 细分、目标与定位总览",
    items: [
      { label: "S · Segmentation", value: segments.length ? `${segments.length} 个可审计细分` : STRATEGY_PENDING, note: "按任务、价格、场景与证据边界拆分。" },
      { label: "T · Targeting", value: target, note: "目标选择须同时满足市场吸引力、公司胜算和硬闸门。" },
      { label: "P · Positioning", value: positionFrame, note: "完整定位声明与理由相信见 p295。" },
    ],
    note: "S、T、P 由同一策略合同派生，避免市场结构、细分页和 GTM 出现不同定位口径。",
  };
}

function stpSegmentationArtifact(report) {
  const stp = stpState(report);
  let records = strategyRecords(stp.segmentation, ["matrix", "segments", "items"]);
  if (!records.length) records = strategyRecords(report.modules?.segment_grade_matrix?.segments);
  if (!records.length) records = [{}];
  return {
    kind: "table",
    title: "S · 细分定义、证据与排除边界",
    columns: ["Segment ID", "细分", "操作性定义 / 核心任务", "需求 / 支付意愿", "公司匹配", "证据锚点", "目标状态 / 理由"],
    rows: records.slice(0, 5).map((record, index) => {
      const definition = strategyField(record, ["definition", "操作性定义", "定义"], 2);
      const need = strategyField(record, ["need", "job", "task", "核心任务", "需求", "任务"], 3);
      const willingness = strategyField(record, ["willingness", "支付意愿"], 4);
      const status = strategyField(record, ["status", "target_status", "目标状态"], 6);
      const reason = strategyField(record, ["reason", "选择/排除理由", "选择理由", "排除理由"], 7);
      return [
        strategyField(record, ["segment_id", "id", "细分id", "编号"], 0, `SEG-${index + 1}`),
        strategyField(record, ["segment", "name", "细分", "title"], 1),
        [definition, need].filter((value) => value !== STRATEGY_PENDING).join(" / ") || STRATEGY_PENDING,
        willingness === STRATEGY_PENDING ? need : `${need} / ${willingness}`,
        strategyField(record, ["fit", "company_fit", "company_edge", "公司匹配", "公司胜算", "胜算"], 5),
        strategyField(record, ["evidence_ids", "evidence", "证据锚点", "证据id", "证据"], 8),
        [status, reason].filter((value) => value !== STRATEGY_PENDING).join(" / ") || STRATEGY_PENDING,
      ];
    }),
    preserveTable: true,
    note: "细分必须互相可区分，并保留证据、排除理由和进入验证门；评级不是平台销量榜。",
  };
}

function stpTargetingArtifact(report) {
  const targeting = stpState(report).targeting || {};
  let records = strategyRecords(targeting, ["candidate_matrix", "candidates", "segments", "matrix", "items"]);
  if (!records.length) records = strategyRecords(stpState(report).segmentation, ["segments", "items", "matrix"]);
  if (!records.length) records = [{}];
  return {
    kind: "table",
    title: "T · 候选细分吸引力与公司胜算",
    columns: ["Segment ID", "细分", "吸引力", "公司胜算", "证据状态", "选择"],
    rows: records.slice(0, 5).map((record, index) => [
      strategyField(record, ["segment_id", "id", "细分id"], 0, `SEG-${index + 1}`),
      strategyField(record, ["segment", "name", "细分", "title"], 1),
      strategyField(record, ["market_attractiveness", "attractiveness", "吸引力", "市场吸引力", "机会"], 2),
      strategyField(record, ["fit", "company_fit", "company_edge", "公司胜算", "胜算"], 3),
      strategyField(record, ["evidence_state", "证据状态", "evidence", "证据"], 4),
      strategyField(record, ["target_status", "selected", "选择", "目标状态", "评级"], 5),
    ]),
    preserveTable: true,
    note: "目标选择不得只看赛道分；公司胜算、证据质量与成本、质量、合规、履约硬闸门必须同时成立。",
  };
}

function stpSelectionArtifact(report) {
  const stp = stpState(report);
  const targeting = stp.targeting || {};
  const positioning = stp.positioning || {};
  let records = strategyRecords(targeting.selection, ["items", "targets", "rows"]);
  if (!records.length) records = [{}];
  return {
    kind: "table",
    title: "T · 目标细分取舍与验证门",
    columns: ["角色", "Segment ID", "细分", "决策理由", "验证门", "证据 ID"],
    rows: records.slice(0, 5).map((record) => [
      strategyField(record, ["role", "角色"], 0),
      strategyField(record, ["segment_id", "id", "细分id"], 1),
      strategyField(record, ["segment", "name", "细分"], 2),
      strategyField(record, ["selection_rationale", "reason", "决策理由", "选择理由", "理由"], 3),
      strategyValue(positioning, ["validation_gate", "gate", "验证门", "闸门"]),
      strategyValue(positioning, ["evidence_ids", "evidence", "证据id", "证据"]),
    ]),
    preserveTable: true,
    note: "目标细分必须同时写清进入理由、不选范围、验证门和责任人，避免把所有人都定义为目标用户。",
  };
}

function stpPositioningArtifact(report) {
  const positioning = stpState(report).positioning || report.modules?.gtm_plan?.positioning || {};
  return {
    kind: "kpi-cards",
    title: "P · 定位声明、理由相信与验证门",
    items: [
      { label: "目标用户", value: strategyValue(positioning, ["target", "target_segment_id", "target_user", "target_segment", "目标用户", "目标细分"]), note: "必须对应已选择的 segment_id。" },
      { label: "竞争框架", value: strategyValue(positioning, ["frame_of_reference", "category_frame", "竞争框架", "参照品类"]), note: "明确与谁比较，而不是只写风格词。" },
      { label: "定位声明", value: strategyValue(positioning, ["positioning_statement", "statement", "定位声明", "body", "title"]), note: "单一、可感知、可验证。" },
      { label: "理由相信 / 验证门", value: `${strategyValue(positioning, ["reasons_to_believe", "rtb", "理由相信"])}｜Gate：${strategyValue(positioning, ["validation_gate", "验证门"])}`, note: "工程、VOC、财务和履约证据缺一不可。" },
    ],
    note: "定位是待验证承诺；未通过概念测试、样机与真实订单验证前不得写成既成事实。",
  };
}

function bcgRows(report) {
  const portfolio = report.modules?.portfolio_correlation || {};
  const bcg = portfolio.bcg_matrix || {};
  let records = strategyRecords(bcg, ["entries", "categories", "portfolio", "items", "matrix"]);
  if (!records.length) records = [{
    category: bcg.current_category || report.category,
    observation_window: bcg.classic_input_gate?.observation_window,
    market_growth: bcg.classic_input_gate?.market_growth_rate,
    relative_market_share: bcg.classic_input_gate?.relative_market_share,
    quadrant: bcg.classic_input_gate?.quadrant,
    evidence_ids: bcg.methodology_source_id,
    confidence: bcg.classic_input_gate?.status,
  }];
  return records.slice(0, 5).map((record) => {
    const growth = strategyExactField(record, ["market_growth", "market_growth_rate", "growth", "市场增速", "增速"], 2);
    const relativeShare = strategyExactField(record, ["relative_market_share", "relative_share", "相对市场份额", "相对份额"], 3);
    const evidence = strategyField(record, ["evidence_ids", "evidence", "证据id", "证据"], 6);
    const inputsReady = growth !== STRATEGY_PENDING && relativeShare !== STRATEGY_PENDING && evidence !== STRATEGY_PENDING;
    return {
      category: strategyField(record, ["category", "品类", "name", "title"], 0),
      window: strategyField(record, ["window", "observation_window", "观察窗口", "时间窗"], 1),
      growth,
      relativeShare,
      quadrant: inputsReady ? strategyField(record, ["quadrant", "象限"], 4) : STRATEGY_PENDING,
      action: inputsReady ? strategyField(record, ["capital_action", "action", "资本动作", "动作"], 5) : STRATEGY_PENDING,
      evidence,
      confidence: strategyField(record, ["confidence", "置信度", "置信"], 7),
    };
  });
}

function bcgMatrixArtifact(report) {
  const bcg = report.modules?.portfolio_correlation?.bcg_matrix || {};
  return {
    kind: "table",
    title: "BCG · 品类组合矩阵与证据状态",
    columns: ["品类", "观察窗口", "市场增速", "相对市场份额", "象限", "资本动作", "证据 / 置信"],
    rows: bcgRows(report).map((row) => [
      row.category,
      row.window,
      row.growth,
      row.relativeShare,
      row.quadrant,
      row.action,
      [row.evidence, row.confidence].filter((value) => value !== STRATEGY_PENDING).join(" / ") || STRATEGY_PENDING,
    ]),
    preserveTable: true,
    note: `${strategyText(bcg.classic_input_gate?.decision_rule, "BCG 必须使用同一观察窗口的真实市场增速和相对最大竞品份额。")} PENDING 不等于 0；输入缺失时不得推断象限。`,
  };
}

function attractivenessCapabilityArtifact(report) {
  const bcg = report.modules?.portfolio_correlation?.bcg_matrix || {};
  const matrix = bcg.attractiveness_capability_matrix || bcg.proxy_matrix || {};
  const matrixRecords = strategyRecords(matrix, ["rows", "items", "matrix"]);
  const actionRecords = matrixRecords.length ? [] : strategyRecords(bcg.portfolio_actions);
  const rows = matrixRecords.length
    ? matrixRecords.slice(0, 5).map((record) => [
        strategyField(record, ["category", "品类"], 0),
        strategyField(record, ["market_attractiveness", "市场吸引力", "吸引力"], 1),
        strategyField(record, ["company_capability", "company_competitive_capability", "公司竞争能力", "公司能力", "竞争能力"], 2),
        strategyField(record, ["management_action", "管理动作", "动作"], 3),
        strategyField(record, ["basis_and_next_step", "依据与下一步", "依据", "下一步"], 4),
      ])
    : actionRecords.slice(0, 5).map((record) => [
        strategyField(record, ["适用品类", "category", "categories"], 1),
        STRATEGY_PENDING,
        STRATEGY_PENDING,
        strategyField(record, ["管理动作", "action"], 0),
        `${strategyField(record, ["资本纪律", "discipline"], 2)}｜证据门：${strategyField(record, ["放行证据", "gate", "evidence"], 3)}`,
      ]);
  return {
    kind: "table",
    title: "市场吸引力 × 公司能力矩阵",
    columns: ["品类", "市场吸引力（管理判断）", "公司能力（管理判断）", "管理动作", "依据与下一步"],
    rows: rows.length ? rows : [[report.category, STRATEGY_PENDING, STRATEGY_PENDING, STRATEGY_PENDING, "补齐管理判断依据与验证门"]],
    preserveTable: true,
    note: "本页是独立的管理判断矩阵；吸引力与能力均需证据门校验，不代表真实市场增长率、相对市场份额或增长-份额象限。",
  };
}

function strategyArtifactForPage(report, page) {
  switch (page) {
    case 10: return actionStrategyArtifact(report);
    case 25: return jtbdStrategyArtifact(report);
    case 26:
    case 27:
    case 28:
    case 29:
    case 30: return psychologyJourneyArtifact(report, page);
    case 291: return stpOverviewArtifact(report);
    case 292: return stpSegmentationArtifact(report);
    case 293: return stpTargetingArtifact(report);
    case 294: return stpSelectionArtifact(report);
    case 295: return stpPositioningArtifact(report);
    case 318: return bcgMatrixArtifact(report);
    case 319: return attractivenessCapabilityArtifact(report);
    case 51: return actionStrategyArtifact(report);
    default: return null;
  }
}

function curatedStrategyPages(report, id, pagePlans) {
  if (!pagePlans.some((plan) => strategyArtifactForPage(report, plan?.page))) return null;
  const moduleData = report.modules?.[id] || {};
  const topics = pagePlans.map((plan, offset) => plan?.topic || MODULE_TOPICS[id]?.[offset] || pageTopic(id, offset));
  const baseArtifacts = fitArtifactBudget(flattenArtifacts(moduleData, `modules.${id}`), pagePlans.length, topics, pagePlans);
  return pagePlans.map((plan, offset) => {
    const base = baseArtifacts[offset] || researchArtifact(report, id, topics[offset], plan);
    const strategy = strategyArtifactForPage(report, plan?.page);
    return strategy ? [base, strategy] : [base];
  });
}

function curatedEvidencePages(report, id, pagePlans = []) {
  const moduleData = report.modules?.[id] || {};
  if (id === "exec_summary_decision_scorecard") {
    const logicRows = (moduleData.core_logic || []).slice(0, 6).map((item) => [
      item.id,
      item.headline,
      item.detail,
      (item.evidence || []).join(" / "),
    ]);
    const scoreRows = (moduleData.scorecard?.dimensions || []).slice(0, 7).map((item) => [
      item.label,
      item.raw_score,
      item.weight,
      item.weighted,
      item.signal,
    ]);
    const actionRows = (moduleData.action_items || []).slice(0, 4).map((item) => [
      item.priority,
      item.title,
      item.owner_role,
      item.time_window || item.due_offset,
      item.acceptance,
    ]);
    const assumptionRows = (moduleData.key_assumptions || []).slice(0, 3).map((item) => [
      "假设",
      item.assumption,
      item.sensitivity,
      item.basis,
      item.if_breaks,
    ]);
    const actionArtifact = strategyArtifactForPage(report, 10);
    return [
      [],
      [{ kind: "table", title: "核心决策逻辑与证据锚点", columns: ["编号", "判断", "决策解释", "证据"], rows: logicRows }],
      [{ kind: "table", title: "综合记分卡与达标差距", columns: ["维度", "评分", "权重", "加权", "信号"], rows: scoreRows }],
      [{
        kind: "table",
        title: "90 天行动、关键假设与失效处理",
        columns: ["类型/优先级", "事项", "责任/敏感度", "时间/依据", "验收或失效处理"],
        rows: [...actionRows, ...assumptionRows].slice(0, 6),
      }, actionArtifact],
    ];
  }
  const strategyPages = curatedStrategyPages(report, id, pagePlans);
  if (strategyPages) return strategyPages;
  if (id === "voc_evidence") {
    return vocEvidencePages(moduleData);
  }
  if (id === "crossborder_seller_cockpit") {
    return curatedSellerCockpitPages(moduleData, pagePlans);
  }
  if (id === "market_size_decomposition") {
    return [marketSizeTransitionPage(report, moduleData)];
  }
  if (id === "ev_decision") {
    return [
      evDecisionTransitionPage(report, moduleData),
      [tablePage(moduleData.ev_logic, "EV 输入、分阶段选择权与停止路径")],
    ];
  }
  if (id === "voc_absa_walls") {
    const negative = isTable(moduleData.negative_wall) ? moduleData.negative_wall : { columns: [], rows: [] };
    const positive = isTable(moduleData.positive_wall) ? moduleData.positive_wall : { columns: [], rows: [] };
    const compactWall = (value) => {
      const indexes = [0, 3, 4, 5].filter((index) => index < value.columns.length);
      return {
        columns: indexes.map((index) => value.columns[index]),
        rows: value.rows.slice(0, 4).map((row) => {
          const normalized = normalizeRow(row, value.columns);
          return indexes.map((index) => normalized[index]);
        }),
      };
    };
    const negativeWall = compactWall(negative);
    const positiveWall = compactWall(positive);
    return [
      [{
        kind: "comparison",
        title: "消费者声音 · 负向问题与正向价值",
        source_path: "modules.voc_absa_walls",
        left: {
          title: "负向问题墙",
          columns: negativeWall.columns,
          rows: negativeWall.rows,
        },
        right: {
          title: "正向价值墙",
          columns: positiveWall.columns,
          rows: positiveWall.rows,
        },
        note: "这里只展示可读抽样；完整逐条观察、转述、产品动作和来源链接保留在原始 JSON 数据包。",
      }],
      [tablePage(moduleData.distribution, "VOC 方面分布与产品优先级")],
    ];
  }
  if (id === "risk_register_sensitivity_confidence") {
    return [
      [selectTable(moduleData.risk_register, "风险登记册、最早信号与责任人", [0, 1, 4], 0, 8)],
      [{ ...selectTable(moduleData.risk_register, "风险等级、缓解动作与停止线", [0, 2, 3, 4, 5], 0, 6), preserveTable: true }],
      [tablePage(moduleData.deterministic_sensitivity, "概率边界与单位贡献敏感项")],
      [
        tablePage(moduleData.compliance_watchlist, "关键假设、合规与残余风险"),
        {
          kind: "callout",
          title: "经营结果区间与置信边界",
          tag: moduleData.evidence_state?.tag || "HARD-GATE",
          body: `${safeText(moduleData.evidence_state?.body)} ${safeText(moduleData.confidence_boundary || "风险概率在真实订单分布接入前不做伪精确估计；按最早信号、责任人和硬停止线管理。")}`,
        },
      ],
    ];
  }
  if (id === "trust_guardrails_methodology") {
    const sourceRegister = moduleData.source_register;
    const sources = isTable(sourceRegister) ? sourceRegister : { columns: [], rows: [] };
    const confidenceIndex = sources.columns.findIndex((column) => /置信/.test(String(column)));
    const confidenceCounts = new Map();
    sources.rows.forEach((row) => {
      const normalized = normalizeRow(row, sources.columns);
      const confidence = safeText(normalized[confidenceIndex >= 0 ? confidenceIndex : 5]) || "未标注";
      confidenceCounts.set(confidence, (confidenceCounts.get(confidence) || 0) + 1);
    });
    const qualityAudit = {
      kind: "trust-quality",
      title: "引用可溯源与证据质量审计",
      source_path: "modules.trust_guardrails_methodology.source_register",
      review_semantics: "gate1_summary",
      segments: [...confidenceCounts.entries()].map(([label, value]) => ({ label, value })),
      dimensions: [
        ["引用可追溯", sources.rows.length ? `已登记 ${sources.rows.length} 个来源` : "PENDING"],
        ["事实 / AIGC 边界", "已分层；AIGC 不独立支持事实"],
        ["数值口径一致", "构建期跨模块校验"],
        ["系统 Gate-1", "待人工终审"],
        ["可复算性", "原始 JSON 与来源台账随附"],
      ],
      note: `本报告登记 ${sources.rows.length} 个来源；这里只统计来源台账的置信标签，不生成虚假的 LLM 评分或引用准确率。`,
    };
    const humanReview = {
      kind: "table",
      title: "轻人工终审记录",
      source_path: "modules.trust_guardrails_methodology",
      review_semantics: "functional_domains",
      columns: ["终审域", "当前状态", "必须核对", "放行责任"],
      rows: [
        ["研究与数据", "未单独记录", "来源、样本、口径与跨模块一致性", "研究负责人"],
        ["产品与工程", "未单独记录", "结构、尺寸、材料、CTQ 与样机", "产品 / 工程"],
        ["财务与供应链", "未单独记录", "报价、运价、税费、贡献利润与现金", "财务 / 供应链"],
        ["法规与知识产权", "未单独记录", "FTO、认证、标签、图片与声明", "法务 / 法规"],
      ],
      preserveTable: true,
      note: "系统 Gate-1 待人工终审；以下职能域没有独立审批记录。",
    };
    return [
      [
        tablePage(moduleData.evidence_thresholds, "关键假设与董事会证据阈值"),
        moduleData.evidence_state
          ? { kind: "callout", title: "TRUST 可信度与护栏", tag: moduleData.evidence_state.tag, body: moduleData.evidence_state.body }
          : researchArtifact(report, id, pagePlans[0]?.topic || "可信度与护栏"),
      ],
      [
        tablePage(moduleData.guardrail_chain, "护栏链 L0 → L5 执行结果"),
        qualityAudit,
      ],
      [tablePage(moduleData.model_provenance, "多模型 / 多层交叉验证与分歧处理")],
      [humanReview],
      [selectTable(sources, "数据来源清单", [0, 1, 2, 3, 5, 6], 0, 5, "完整来源、链接、观察日与证据限制保留在报告 JSON 与原始数据包。")],
      [methodologyGridArtifact(report, moduleData), methodologyWarningArtifact(moduleData)],
    ];
  }
  return null;
}

function chartFromTable(artifact, topic) {
  if (artifact.kind !== "table" || artifact.preserveTable || !artifact.rows?.length || artifact.columns?.length < 2) return artifact;
  const title = `${topic} ${artifact.title || ""}`;
  const matrixIntent = /矩阵|热力|地图|交叉|对比|相关|情景/i.test(title);
  if (matrixIntent && artifact.columns.length >= 3 && artifact.columns.length <= 7 && artifact.rows.length >= 2) {
    const xLabels = artifact.columns.slice(1, 7);
    const rows = artifact.rows.slice(0, 7);
    const matrix = rows.map((row) => row.slice(1, xLabels.length + 1));
    const numericCells = matrix.flat().filter((cell) => numeric(cell) != null).length;
    if (numericCells >= Math.max(4, Math.ceil(matrix.flat().length * 0.45))) {
      return {
        ...artifact,
        kind: "chart",
        title: artifact.title,
        value: { xLabels, yLabels: rows.map((row) => safeText(row[0])), matrix },
        note: artifact.note,
      };
    }
  }
  if (!/分布|排序|评分|结构|占比|优先|阶梯|趋势|风险|敏感|份额|驱动|重要度|成本/i.test(title)) return artifact;
  let bestIndex = -1;
  let bestCount = 0;
  artifact.columns.slice(1).forEach((_, index) => {
    const columnIndex = index + 1;
    const count = artifact.rows.filter((row) => numeric(row[columnIndex]) != null).length;
    if (count > bestCount) {
      bestIndex = columnIndex;
      bestCount = count;
    }
  });
  if (bestIndex < 0 || bestCount < 3) return artifact;
  return {
    ...artifact,
    kind: "chart",
    title: artifact.title,
    value: {
      items: artifact.rows.slice(0, 9).map((row) => ({
        label: safeText(row[0]),
        value: row[bestIndex],
      })),
    },
    note: artifact.note || `图示数值取自“${artifact.columns[bestIndex]}”列；完整字段保留在报告数据包。`,
  };
}

function normalizePageArtifact(artifact, topic) {
  if (!artifact || typeof artifact !== "object") return null;
  if (artifact.kind === "table") {
    const columns = (artifact.columns || []).map(String);
    const defaultLimit = tableRowLimit(columns.length);
    const requestedLimit = Number(artifact.rowLimit);
    const rowLimit = Number.isFinite(requestedLimit) && requestedLimit > defaultLimit
      ? Math.min(8, Math.floor(requestedLimit))
      : defaultLimit;
    const table = {
      ...artifact,
      columns,
      rows: (artifact.rows || []).slice(0, rowLimit).map((row) => normalizeRow(row, columns)),
    };
    return chartFromTable(table, topic);
  }
  if (artifact.kind === "list") return { ...artifact, items: (artifact.items || []).slice(0, 8) };
  if (artifact.kind === "kpi-cards") return { ...artifact, items: (artifact.items || []).slice(0, 4) };
  if (artifact.kind === "kv") return { ...artifact, rows: (artifact.rows || []).slice(0, 8) };
  return artifact;
}

const NARRATIVE_ONLY_VISUALS = new Set([
  "callout",
  "verdict_callout",
  "section_intro",
  "section_intro_callout",
]);

function visualAllowsNarrativeOnly(visual) {
  return NARRATIVE_ONLY_VISUALS.has(String(visual || ""));
}

function artifactCanSatisfyVisual(artifact, visual) {
  if (!artifact || typeof artifact !== "object") return false;
  if (visualAllowsNarrativeOnly(visual)) {
    return ["text", "callout", "research", "contract"].includes(String(artifact.kind || ""));
  }
  return !["text", "callout"].includes(artifact.kind);
}

const GENERIC_ARTIFACT_TITLES = new Set([
  "table", "tables", "item", "items", "plan", "plans", "data", "row", "rows",
  "表", "表格", "数据", "列表", "项目", "计划",
]);

const SEMANTIC_TERM_GROUPS = [
  ["market", "市场", "signal", "signals", "信号", "规模", "size", "trend", "趋势", "lifecycle", "生命周期"],
  ["opportunity", "机会"],
  ["sensitivity", "敏感", "scenario", "情景", "stress", "压力", "robust", "稳健"],
  ["price", "pricing", "价格", "定价", "售价", "priceband", "价格带"],
  ["segment", "segments", "segmentation", "细分", "人群", "targeting", "目标用户"],
  ["evidence", "证据", "source", "来源", "audit", "审计", "confidence", "置信"],
  ["risk", "风险", "compliance", "合规", "patent", "专利", "侵权"],
  ["trademark", "商标"],
  ["copyright", "版权", "图片授权", "文案"],
  ["cost", "成本", "margin", "利润", "contribution", "贡献", "economics", "经济", "waterfall", "瀑布"],
  ["cash", "现金", "npv", "净现值", "valuation", "估值"],
  ["voc", "review", "评论", "aspect", "方面", "sentiment", "情感", "need", "需求", "jtbd", "job"],
  ["competitor", "competition", "competitive", "竞品", "竞争", "brand", "品牌"],
  ["action", "plan", "gtm", "执行", "行动", "上市", "节奏"],
  ["quality", "return", "质量", "退货", "defect", "缺陷"],
  ["supply", "supplier", "供应", "采购", "sourcing", "寻源"],
  ["traffic", "ppc", "advertising", "广告", "流量", "keyword", "关键词"],
  ["portfolio", "组合", "correlation", "相关", "capital", "资本"],
  ["growth", "增长", "share", "份额"],
  ["gate", "gates", "闸门", "验证", "validation", "decision", "决策"],
  ["matrix", "矩阵", "map", "地图", "axes", "轴"],
  ["distribution", "分布", "rating", "评级", "score", "评分"],
  ["timeline", "时间线", "gantt", "排期", "window", "窗口"],
  ["assumption", "assumptions", "假设"],
];

function semanticAffinity(block, artifact) {
  const target = `${block?.id || ""} ${block?.title || ""}`.toLocaleLowerCase();
  const candidate = String(artifact?.title || "").toLocaleLowerCase();
  if (!target || !candidate) return 0;
  const compactTarget = target.replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
  const compactCandidate = candidate.replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
  let score = compactCandidate.length >= 4 && compactTarget.includes(compactCandidate) ? 8 : 0;
  SEMANTIC_TERM_GROUPS.forEach((terms) => {
    const targetHasTerm = terms.some((term) => target.includes(term));
    const candidateHasTerm = terms.some((term) => candidate.includes(term));
    if (targetHasTerm && candidateHasTerm) score += 3;
  });
  const genericTitle = compactCandidate.replace(/\d+$/, "");
  if (GENERIC_ARTIFACT_TITLES.has(genericTitle)) score -= 6;
  return Math.max(0, score);
}

function artifactVisualScore(artifact, visual) {
  if (!artifact) return -Infinity;
  const kind = String(artifact.kind || "");
  const target = String(visual || "").toLocaleLowerCase();
  const narrative = ["text", "callout"].includes(kind);
  if (visualAllowsNarrativeOnly(target)) {
    if (kind === "callout") return 120;
    if (kind === "text") return 110;
    if (["list", "kv", "table"].includes(kind)) return 70;
    return 50;
  }
  if (narrative) return -100;
  if (/concept|image/.test(target)) {
    if (["image", "concept-compare"].includes(kind)) return 130;
    if (["comparison", "table"].includes(kind)) return 70;
  }
  if (/method|warning/.test(target)) {
    if (["methodology-grid", "warning-list"].includes(kind)) return 125;
    if (["table", "list", "kv"].includes(kind)) return 85;
  }
  if (/kpi|dashboard|gauge/.test(target)) {
    if (["kpi-cards", "seller-kpis", "trust-quality"].includes(kind)) return 125;
    if (kind === "chart") return 110;
    if (["table", "kv", "comparison"].includes(kind)) return 95;
  }
  if (/table|matrix|grade/.test(target)) {
    if (["table", "kv", "comparison"].includes(kind)) return 120;
    if (kind === "chart") return 100;
  }
  if (/radar|bubble|scatter|heatmap|line|bar|waterfall|sankey|gantt|timeline|range|box|treemap|marimekko|donut|fan|funnel|slope|quadrant|network|tree|map|histogram|tornado|survival/.test(target)) {
    if (kind === "chart") return 125;
    if (["table", "kv", "comparison", "kpi-cards", "trust-quality"].includes(kind)) return 100;
  }
  if (["chart", "table", "kv", "kpi-cards", "seller-kpis", "comparison", "concept-compare", "trust-quality", "methodology-grid", "warning-list", "image", "list", "contract", "research"].includes(kind)) return 80;
  return 20;
}

function bestArtifactIndex(artifacts, visual) {
  let bestIndex = 0;
  let bestScore = -Infinity;
  artifacts.forEach((artifact, index) => {
    const score = artifactVisualScore(artifact, visual);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });
  return bestIndex;
}

function reportPathValue(report, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let value = report;
  for (const part of parts) {
    if (value == null || !(part in Object(value))) return undefined;
    value = value[part];
  }
  return value;
}

function sourceModuleId(path, fallback) {
  const match = String(path || "").match(/^modules\.([^.]+)/);
  return match?.[1] || fallback;
}

function sourcePathMatches(path, declaredPaths = []) {
  const ownPath = String(path || "").trim();
  if (!ownPath) return false;
  return declaredPaths.some((declared) => {
    const contractPath = String(declared || "").trim();
    return contractPath && (ownPath === contractPath || ownPath.startsWith(`${contractPath}.`) || contractPath.startsWith(`${ownPath}.`));
  });
}

function structuredEvidenceArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return false;
  switch (String(artifact.kind || "")) {
    case "table":
      return Array.isArray(artifact.columns) && artifact.columns.length >= 2 && Array.isArray(artifact.rows) && artifact.rows.some((row) =>
        Array.isArray(row) && row.some((cell) => safeText(cell).trim()),
      );
    case "chart":
      if (!isChart(artifact.value)) return false;
      if (Array.isArray(artifact.value?.items)) return artifact.value.items.length >= 2;
      if (Array.isArray(artifact.value?.points)) return artifact.value.points.length >= 2;
      if (Array.isArray(artifact.value?.nodes)) return artifact.value.nodes.length >= 2 && Array.isArray(artifact.value.links) && artifact.value.links.length >= 1;
      if (Array.isArray(artifact.value?.xLabels)) return artifact.value.xLabels.length >= 2 && Array.isArray(artifact.value.matrix) && artifact.value.matrix.length >= 2;
      if (Array.isArray(artifact.value?.axes)) return artifact.value.axes.length >= 3 && Array.isArray(artifact.value.series) && artifact.value.series.length >= 1;
      if (Array.isArray(artifact.value?.labels)) return artifact.value.labels.length >= 2;
      return false;
    case "image":
      return Boolean(imageUrl({ image: artifact.image }));
    case "list":
      return Array.isArray(artifact.items) && artifact.items.some((item) => safeText(item).trim());
    case "kv":
      return Array.isArray(artifact.rows) && artifact.rows.some((row) => Array.isArray(row) && row.some((cell) => safeText(cell).trim()));
    case "kpi-cards":
      return Array.isArray(artifact.items) && artifact.items.some((item) => safeText(item?.label).trim() && safeText(item?.value).trim());
    case "seller-kpis":
      return Array.isArray(artifact.cards) && artifact.cards.some((item) => safeText(item?.label).trim() && safeText(item?.value).trim());
    case "comparison":
      return Array.isArray(artifact.left?.rows) && artifact.left.rows.length > 0 && Array.isArray(artifact.right?.rows) && artifact.right.rows.length > 0;
    case "concept-compare":
      return Boolean(artifact.image) && (Array.isArray(artifact.benchmark?.rows) || Array.isArray(artifact.translation?.rows));
    case "trust-quality":
      return Array.isArray(artifact.dimensions) && artifact.dimensions.length > 0;
    case "methodology-grid":
      return Array.isArray(artifact.cards) && artifact.cards.length > 0;
    case "warning-list":
      return Array.isArray(artifact.items) && artifact.items.length > 0;
    default:
      return false;
  }
}

function narrativeEvidenceArtifact(artifact) {
  if (!artifact || !["text", "callout"].includes(String(artifact.kind || ""))) return false;
  return safeText(artifact.body).trim().length >= 24;
}

function blockSourceCandidates(report, block) {
  return (block?.source_paths || []).flatMap((path) => {
    const value = reportPathValue(report, path);
    if (value == null) return [];
    const explicitField = String(path).split(".").length > 2;
    return flattenArtifacts(value, path)
      .map((artifact) => normalizePageArtifact(
        artifact.kind === "table" && /table|matrix|grade/i.test(String(block?.visual || ""))
          ? { ...artifact, preserveTable: true }
          : artifact,
        block.title || "研究结果",
      ))
      .filter(Boolean)
      .map((artifact) => {
        const resolvedPath = String(artifact.source_path || path);
        return {
          artifact,
          path: resolvedPath,
          requestedPath: path,
          moduleId: sourceModuleId(resolvedPath, sourceModuleId(path)),
          explicitField,
        };
      });
  });
}

function artifactContentAffinity(block, artifact) {
  if (artifact?.kind === "table" || artifact?.kind === "kv") {
    return Math.max(0, ...(artifact.rows || []).map((row) => semanticAffinity(block, { title: (row || []).map(safeText).join(" ") })));
  }
  if (artifact?.kind === "list") {
    return Math.max(0, ...(artifact.items || []).map((item) => semanticAffinity(block, { title: safeText(item) })));
  }
  return 0;
}

function projectArtifactForBlock(artifact, block) {
  if (!artifact || !["table", "kv", "list"].includes(artifact.kind)) return artifact;
  const pageNumber = Number(String(block?.id || "").match(/\.p(\d+)\./)?.[1] || 1);
  if (artifact.kind === "list") {
    const items = artifact.items || [];
    if (items.length <= 4) return artifact;
    const ranked = items.map((item, index) => ({ item, index, score: semanticAffinity(block, { title: safeText(item) }) }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const selected = ranked[0]?.score > 0
      ? ranked.slice(0, 4).map((entry) => entry.item)
      : Array.from({ length: Math.min(4, items.length) }, (_, offset) => items[(pageNumber - 1 + offset) % items.length]);
    return { ...artifact, items: selected, source_projection: "page_specific_items", source_record_count: items.length };
  }
  const rows = artifact.rows || [];
  if (rows.length <= 4) return artifact;
  const ranked = rows.map((row, index) => ({ row, index, score: semanticAffinity(block, { title: row.map(safeText).join(" ") }) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = ranked[0]?.score > 0
    ? ranked.slice(0, Math.min(4, rows.length)).map((entry) => entry.row)
    : Array.from({ length: Math.min(4, rows.length) }, (_, offset) => rows[(pageNumber - 1 + offset) % rows.length]);
  return { ...artifact, rows: selected, source_projection: "page_specific_rows", source_record_count: rows.length };
}

function vocWeightedRollupArtifact(report) {
  const evidence = report.modules?.voc_evidence?.evidence_log;
  if (!isTable(evidence)) return null;
  const productIndex = tableColumnIndex(evidence, /产品|来源/, 2);
  const polarityIndex = tableColumnIndex(evidence, /极性|正负向/, 4);
  const themeIndex = tableColumnIndex(evidence, /主题|方面/, 5);
  const grouped = new Map();
  evidence.rows.map((row) => normalizeRow(row, evidence.columns)).forEach((row) => {
    const product = safeText(row[productIndex]) || "未标注来源";
    const theme = safeText(row[themeIndex]) || "未标注方面";
    const key = `${product}\u0000${theme}`;
    const current = grouped.get(key) || { product, theme, total: 0, negative: 0, positive: 0 };
    current.total += 1;
    if (/负向/.test(safeText(row[polarityIndex]))) current.negative += 1;
    if (/正向/.test(safeText(row[polarityIndex]))) current.positive += 1;
    grouped.set(key, current);
  });
  return {
    kind: "table",
    title: "VOC 按竞品与方面加权汇总",
    source_path: "modules.voc_evidence.evidence_log",
    columns: ["竞品 / 来源", "方面", "观察数", "负向", "正向", "证据边界"],
    rows: [...grouped.values()]
      .sort((left, right) => right.total - left.total || right.negative - left.negative || left.product.localeCompare(right.product, "zh-CN"))
      .slice(0, 6)
      .map((item) => [item.product, item.theme, item.total, item.negative, item.positive, "编码观察；不外推市场发生率"]),
    rowLimit: 6,
    preserveTable: true,
    note: "只聚合 evidence_log 中的可追溯编码观察；观察数不是独立消费者数，不外推为市场发生率。",
  };
}

function ipScreenArtifact(report, mode) {
  const matrix = report.modules?.ip_compliance?.compliance_matrix;
  if (!isTable(matrix)) return null;
  const rows = matrix.rows.map((row) => normalizeRow(row, matrix.columns));
  if (mode === "trademark") {
    const screened = rows.filter((row) => /商标|图片|文案|FTO|专利/i.test(safeText(row[0])));
    return {
      kind: "table",
      title: "商标近似冲突扫描",
      source_path: "modules.ip_compliance.compliance_matrix",
      columns: matrix.columns.map(String),
      rows: screened.length ? screened : rows.slice(-2),
      preserveTable: true,
      note: "本页是 FTO、商标、图片与文案证据状态筛查，不代表已完成商标近似检索或律师法律意见。",
    };
  }
  return {
    kind: "table",
    title: "侵权风险热力与严重度",
    source_path: "modules.ip_compliance.compliance_matrix",
    columns: ["风险维度", "当前状态", "门级", "上市前证据", "Owner"],
    rows: rows.slice(0, 6).map((row) => [row[0], row[1], /未完成|高|红/.test(safeText(row[1])) ? "红项｜未放行" : "待终审", row[2], row[3]]),
    preserveTable: true,
    note: "当前数据只支持风险矩阵。因缺少有效权利状态、相似度与律师分级，网页明确降级为表格，不伪造热力分数。",
  };
}

function canonicalBlockSource(report, block) {
  const blockId = String(block?.id || "");
  if (blockId === "reference.p34.voc_weighted_rollup") {
    const artifact = vocWeightedRollupArtifact(report);
    return artifact && { artifact, path: artifact.source_path, moduleId: "voc_evidence", mode: "source_path" };
  }
  if (/^reference\.p43\./.test(blockId)) {
    const path = "modules.output_unit_economics_finance.demand_forecast_input_gate";
    const artifact = flattenArtifacts(reportPathValue(report, path), path)[0];
    return artifact && { artifact, path, moduleId: "output_unit_economics_finance", mode: "source_path" };
  }
  if (blockId === "reference.p77.ip_compliance") {
    const artifact = ipScreenArtifact(report, "trademark");
    return artifact && { artifact, path: artifact.source_path, moduleId: "ip_compliance", mode: "source_path" };
  }
  if (blockId === "reference.p78.ip_compliance") {
    const artifact = ipScreenArtifact(report, "risk");
    return artifact && { artifact, path: artifact.source_path, moduleId: "ip_compliance", mode: "source_path" };
  }
  return null;
}

function resolveBlockSource(report, id, block, allocatedSource, allocationMode = "generated") {
  const canonical = canonicalBlockSource(report, block);
  if (canonical) return { ...canonical, canonical: true, artifact: normalizePageArtifact(canonical.artifact, block.title || "研究结果") };
  const sourcePaths = Array.isArray(block?.source_paths) ? block.source_paths : [];
  const currentModulePath = `modules.${id}`;
  const hasExplicitFieldSource = sourcePaths.some((path) => String(path).split(".").length > 2);
  const allocatedAffinity = semanticAffinity(block, allocatedSource);
  const sourceIncludesCurrentModule = sourcePaths.some((path) => path === currentModulePath || String(path).startsWith(`${currentModulePath}.`));
  const allocatedPath = String(allocatedSource?.source_path || "");
  const allocatedModuleId = sourceModuleId(allocatedPath, id);
  const allocatedPathDeclared = sourcePathMatches(allocatedPath, sourcePaths);
  const groundedCurrentModuleArtifact = sourceIncludesCurrentModule && allocatedModuleId === id && structuredEvidenceArtifact(allocatedSource);
  if (
    allocatedSource &&
    allocatedPath &&
    allocatedPathDeclared &&
    (allocationMode === "curated" || !hasExplicitFieldSource) &&
    (allocationMode === "curated" || !["research", "contract"].includes(allocatedSource.kind)) &&
    artifactCanSatisfyVisual(allocatedSource, block.visual) &&
    (allocationMode === "curated" || artifactVisualScore(allocatedSource, block.visual) >= 100) &&
    (allocationMode === "curated" || allocatedAffinity >= 8 || groundedCurrentModuleArtifact)
  ) {
    return { artifact: allocatedSource, path: allocatedPath, moduleId: allocatedModuleId, mode: "allocated" };
  }
  const compatibleCandidates = blockSourceCandidates(report, block)
    .filter(({ artifact }) =>
      (structuredEvidenceArtifact(artifact) || ["research", "contract"].includes(artifact.kind) ||
        (visualAllowsNarrativeOnly(block.visual) && narrativeEvidenceArtifact(artifact))),
    );
  const explicitCandidate = compatibleCandidates.find(({ explicitField }) => explicitField);
  if (explicitCandidate) {
    return { artifact: explicitCandidate.artifact, path: explicitCandidate.path, moduleId: explicitCandidate.moduleId, mode: "source_path" };
  }
  const candidates = compatibleCandidates
    .map((candidate) => ({
      ...candidate,
      score: artifactVisualScore(candidate.artifact, block.visual) * 3 + semanticAffinity(block, candidate.artifact) * 10 + artifactContentAffinity(block, candidate.artifact) * 12,
    }))
    .sort((left, right) => right.score - left.score);
  if (!candidates.length) return null;
  const bestScore = candidates[0].score;
  const tied = candidates.filter((candidate) => candidate.score === bestScore);
  const pageNumber = Number(String(block?.id || "").match(/\.p(\d+)\./)?.[1] || 1);
  const selected = tied[(pageNumber - 1) % tied.length];
  return { artifact: projectArtifactForBlock(selected.artifact, block), path: selected.path, moduleId: selected.moduleId, mode: "source_path" };
}

function contractFallbackArtifact(report, id, plan, block) {
  const sourcePaths = Array.isArray(block?.source_paths) && block.source_paths.length
    ? block.source_paths.map(String)
    : [`modules.${id}`];
  const fallbackPath = sourcePaths[0];
  const fallbackId = sourceModuleId(fallbackPath, id);
  const research = researchArtifact(report, fallbackId, block.title || plan?.topic || "研究证据", plan);
  return {
    kind: "contract",
    title: block.title,
    visual: block.visual,
    source_path: fallbackPath,
    source_module: fallbackId,
    fallback_evidence_board: true,
    tag: "EVIDENCE GAP",
    question: plan?.research_question || `${block.title}的数据合同尚未满足`,
    finding: `逐页合同要求“${block.visual}”，但 ${sourcePaths.join(" / ")} 尚未返回可兼容的结构化证据。系统保留缺口，不生成替代数值。`,
    cards: [
      {
        label: "来源合同",
        value: sourcePaths.join(" / "),
        note: `目标模块：${fallbackId}；逐页合同：${block.id}`,
      },
      {
        label: "补证方法",
        value: methodForTopic(block.title || plan?.topic || "研究证据"),
        note: `Owner：${ownerForModule(fallbackId)}；来源、样本、口径与时间窗必须同时入库。`,
      },
      {
        label: "决策约束",
        value: decisionUseForTopic(block.title || plan?.topic || "研究证据"),
        note: "证据未过门前保持 PENDING，不得用通用文字或推测值替代。",
      },
    ],
    gate: research.gate,
    confidence: "PENDING",
  };
}

function pendingGateContractArtifact(source, block) {
  if (source?.kind !== "table" || source.rows?.length !== 1) return null;
  const columns = (source.columns || []).map(String);
  const row = source.rows[0] || [];
  const statusIndex = columns.findIndex((column) => /状态|status/i.test(column));
  const inputIndex = columns.findIndex((column) => /待补输入|required input/i.test(column));
  const methodIndex = columns.findIndex((column) => /计算|验证方法|method/i.test(column));
  const stopIndex = columns.findIndex((column) => /停止规则|stop rule/i.test(column));
  if (inputIndex < 0 || methodIndex < 0 || stopIndex < 0 || !/PENDING|待补/i.test(String(row[statusIndex] || ""))) return null;
  const stopRule = safeText(row[stopIndex]);
  return {
    kind: "contract",
    title: block.title,
    visual: block.visual,
    tag: "DATA REQUIRED",
    question: `${block.title}：真实输入尚未达到绘图与定量门槛`,
    finding: source.note || "当前保持 PENDING；未观测数据不生成曲线、分布或市场数值。",
    cards: [
      { label: "待补输入", value: safeText(row[inputIndex]), note: "保留来源、口径、时间窗和原始序列。" },
      { label: "验证方法", value: safeText(row[methodIndex]), note: "按预注册口径执行，结果与方法一并入库。" },
      { label: "决策边界", value: stopRule, note: "未过门前不得量化放量或输出伪精确结论。" },
    ],
    gate: stopRule,
    confidence: "PENDING",
  };
}

function sourceArtifactSummary(source) {
  if (source?.kind === "table") return `${safeText(source.title || "来源表")} · ${source.rows?.length || 0} 行 × ${source.columns?.length || 0} 列`;
  if (source?.kind === "list") return `${safeText(source.title || "来源清单")} · ${source.items?.length || 0} 项`;
  return safeText(source?.title || source?.kind || "已登记输入");
}

function requiredEvidenceForVisual(visual, title) {
  const target = `${safeText(visual)} ${safeText(title)}`;
  if (/预测|趋势|季节|折线|line|fan|forecast|season/i.test(target)) {
    return "同口径连续时序、价格/促销/缺货异常标记、留出窗口回测误差与置信边界";
  }
  if (/ACOS|TACOS|广告|ROI|竞价/i.test(target)) {
    return "广告周序列、曝光/点击/订单/花费、归因口径、自然位与贡献利润";
  }
  if (/弹性|价格.*销量|elastic/i.test(target)) {
    return "受控价格实验、同口径需求量、流量质量与竞品/促销控制变量";
  }
  if (/热力|矩阵|heatmap|matrix/i.test(target)) {
    return "统一维度定义、可比对象、数值或有序等级、样本窗口与分级规则";
  }
  if (/散点|回归|气泡|scatter|regression|bubble/i.test(target)) {
    return "同一样本上的成对观测、单位和时间窗口、异常值规则与最小样本量";
  }
  return "与目标指标一致的可比观测、数值口径、时间窗口、来源台账与停表规则";
}

function semanticPendingContractArtifact(source, block, plan, resolved) {
  if (!source || resolved?.canonical || visualAllowsNarrativeOnly(block?.visual)) return null;
  if (!["table", "list"].includes(source.kind) || artifactVisualScore(source, block.visual) >= 120) return null;
  const affinity = semanticAffinity(block, source) + artifactContentAffinity(block, source);
  const sourcePath = safeText(resolved?.path || source.source_path);
  const proxySource = /(?:^|[._])(?:experiment|strategy|structure|input_gate|risk_cert_compliance_matrix)(?:[._]|$)/i.test(sourcePath);
  if (affinity >= 8 && !proxySource) return null;
  const missingEvidence = requiredEvidenceForVisual(block.visual, block.title);
  return {
    kind: "contract",
    title: block.title,
    source_path: sourcePath,
    semantic_data_required: true,
    source_artifact_kind: source.kind,
    source_affinity: affinity,
    visual: block.visual,
    tag: "DATA REQUIRED",
    question: `${block.title}：当前真实输入能否支撑 ${safeText(block.visual)}？`,
    finding: `${sourceArtifactSummary(source)} 已保留在 ${sourcePath}，但它与本页目标指标或视觉口径不匹配。系统不将该表重命名为量化图，也不生成替代数值。`,
    cards: [
      { label: "当前真实输入", value: sourceArtifactSummary(source), note: `来源路径：${sourcePath}；仅作输入台账，不冒充目标图。` },
      { label: "缺少的绘图证据", value: missingEvidence, note: `目标视觉：${safeText(block.visual)}；逐页合同：${safeText(block.id)}。` },
      { label: "验证与放行", value: methodForTopic(block.title || plan?.topic), note: decisionUseForTopic(block.title || plan?.topic) },
    ],
    gate: `补齐“${missingEvidence}”并完成口径复核后，才允许渲染 ${safeText(block.visual)}。`,
    confidence: "PENDING",
  };
}

function narrativePageSidecar(report, plan, requiredBlocks, pageArtifacts) {
  if (["section_intro", "section_intro_callout"].includes(String(plan?.role || ""))) return null;
  if (!pageArtifacts.length || !pageArtifacts.every((artifact) => ["text", "callout"].includes(artifact?.kind))) return null;
  const candidates = requiredBlocks.flatMap((block) => blockSourceCandidates(report, block).map((candidate) => ({ ...candidate, block })))
    .filter(({ artifact }) => structuredEvidenceArtifact(artifact))
    .map((candidate) => ({
      ...candidate,
      score: artifactVisualScore(candidate.artifact, "data_table") * 2
        + semanticAffinity({ title: plan?.topic || candidate.block?.title }, candidate.artifact) * 10
        + artifactContentAffinity({ title: plan?.topic || candidate.block?.title }, candidate.artifact) * 12,
    }))
    .sort((left, right) => right.score - left.score);
  if (!candidates.length) return null;
  const selected = candidates[0];
  const projected = projectArtifactForBlock(selected.artifact, selected.block);
  const pageNumber = Number(String(selected.block?.id || "").match(/\.p(\d+)\./)?.[1] || plan?.page || 0);
  const declaredPaths = Array.isArray(selected.block?.source_paths) ? selected.block.source_paths.map(String) : [];
  return {
    ...projected,
    source_path: selected.path,
    supporting_evidence: true,
    contract_id: `augmentation.p${pageNumber}.grounded_evidence_sidecar`,
    contract_visual: projected.kind === "chart" ? "grounded_chart" : "grounded_data_table",
    contract_required: false,
    contract_origin: "evidence",
    contract_placement: "after_reference",
    contract_source_path: selected.path,
    contract_source_module: selected.moduleId,
    contract_declared_source_paths: declaredPaths,
    contract_provenance: "derived",
    contract_source_mode: "source_path",
    contract_source_mismatch: !sourcePathMatches(selected.path, declaredPaths),
  };
}

function bindArtifactsToPageContract(report, id, plan, artifacts, allocationMode = "generated") {
  const requiredBlocks = Array.isArray(plan?.reference_blocks) ? plan.reference_blocks : [];
  if (!requiredBlocks.length) return artifacts.slice(0, 3);
  const requiredArtifacts = requiredBlocks.map((block, index) => {
    const resolved = resolveBlockSource(report, id, block, artifacts[index], allocationMode);
    const source = resolved?.artifact;
    const needsGroundedBar = block.visual === "horizontal_bar" && source?.kind === "table";
    const incompatibleNarrative = source && !artifactCanSatisfyVisual(source, block.visual);
    const pendingGate = pendingGateContractArtifact(source, block);
    const semanticPending = !pendingGate && semanticPendingContractArtifact(source, block, plan, resolved);
    const visualDegraded = Boolean(
      source &&
      !pendingGate &&
      !semanticPending &&
      !["research", "contract"].includes(source.kind) &&
      structuredEvidenceArtifact(source) &&
      (needsGroundedBar || incompatibleNarrative || artifactVisualScore(source, block.visual) < 120),
    );
    const usesEvidenceGap = !pendingGate && !semanticPending && !source;
    const artifact = pendingGate || semanticPending || (source
      ? source.kind === "research"
        ? { ...source, kind: "contract", visual: block.visual }
        : { ...source }
      : contractFallbackArtifact(report, id, plan, block));
    const sourcePath = resolved?.path || artifact.source_path || block.source_paths?.[0];
    const declaredSourcePaths = Array.isArray(block.source_paths) ? block.source_paths.map(String) : [];
    return {
      ...artifact,
      title: block.title,
      contract_id: block.id,
      contract_visual: block.visual,
      contract_required: true,
      contract_source_path: sourcePath,
      contract_source_module: resolved?.moduleId || sourceModuleId(sourcePath, id),
      contract_declared_source_paths: declaredSourcePaths,
      contract_provenance: usesEvidenceGap ? "gap" : resolved?.mode === "allocated" ? "direct" : "derived",
      contract_source_mismatch: !usesEvidenceGap && !sourcePathMatches(sourcePath, declaredSourcePaths),
      contract_source_mode: usesEvidenceGap ? "evidence_gap" : resolved?.mode || "evidence_gap",
      contract_canonical_source: resolved?.canonical || undefined,
      contract_visual_degraded: visualDegraded || undefined,
      contract_rendered_kind: visualDegraded ? artifact.kind : undefined,
    };
  });
  const augmentationBlocks = Array.isArray(plan?.augmentation_blocks) ? plan.augmentation_blocks : [];
  const optionalArtifacts = artifacts.slice(requiredBlocks.length)
    .slice(0, Math.max(0, 3 - requiredArtifacts.length))
    .map((artifact, index) => {
      const block = augmentationBlocks[index];
      return block ? {
        ...artifact,
        title: block.origin === "strategy" && artifact.title ? artifact.title : block.title || artifact.title,
        contract_id: block.id,
        contract_visual: block.visual,
        contract_required: false,
        contract_origin: block.origin,
        contract_placement: block.placement,
      } : artifact;
    });
  const pageArtifacts = [...requiredArtifacts, ...optionalArtifacts];
  const sidecar = narrativePageSidecar(report, plan, requiredBlocks, pageArtifacts);
  return [...pageArtifacts, ...(sidecar ? [sidecar] : [])].slice(0, 3);
}

function artifactDigest(artifacts, topic) {
  const rows = artifacts.slice(0, 4).map((artifact) => {
    const summary = artifact.kind === "table"
      ? `${artifact.rows?.length || 0} 条记录 · ${artifact.columns?.slice(0, 4).join(" / ") || "结构化数据"}`
      : artifact.kind === "callout"
        ? safeText(artifact.body).slice(0, 150)
        : artifact.kind === "text"
          ? safeText(artifact.body).slice(0, 150)
        : artifact.kind === "list"
          ? (artifact.items || []).slice(0, 3).join("；")
          : artifact.kind === "image"
            ? "概念资产及其审计元数据"
            : safeText(artifact.title || artifact.body || "分析结果").slice(0, 150);
    return [artifact.title || humanize(artifact.kind), summary, "完整字段见本报告原始 JSON"];
  });
  return {
    kind: "table",
    title: `${topic} · 分析覆盖摘要`,
    columns: ["分析对象", "本页摘要", "审计入口"],
    rows,
    note: "固定页幅只展示董事会可读摘要；未删改的结构化字段随报告 JSON 一并交付。",
  };
}

function fitArtifactBudget(artifacts, count, topics, pagePlans = []) {
  const normalized = artifacts
    .map((artifact, index) => normalizePageArtifact(artifact, topics[Math.min(index, topics.length - 1)] || "研究结果"))
    .filter(Boolean);
  if (!normalized.length) return [];
  if (!pagePlans.length) {
    if (normalized.length <= count) return normalized;
    if (count <= 1) return [artifactDigest(normalized, topics[0] || "研究结果")];
    return [
      ...normalized.slice(0, count - 1),
      artifactDigest(normalized.slice(count - 1), topics[count - 1] || "研究结果"),
    ];
  }
  if (count <= 1) return [artifactDigest(normalized, topics[0] || "研究结果")];
  const remaining = [...normalized];
  const allocated = [];
  const directCount = normalized.length > count ? count - 1 : Math.min(count, normalized.length);
  for (let offset = 0; offset < directCount; offset += 1) {
    const visual = pagePlans[offset]?.reference_blocks?.[0]?.visual;
    const index = bestArtifactIndex(remaining, visual);
    allocated.push(remaining.splice(index, 1)[0]);
  }
  if (normalized.length > count) {
    allocated.push(artifactDigest(remaining, topics[count - 1] || "研究结果"));
  }
  return allocated;
}

function distributeArtifacts(report, id, count, pagePlans) {
  const moduleData = report.modules?.[id] || {};
  const aigcPages = curatedAigcPages(report, id);
  const curatedPages = aigcPages || curatedEvidencePages(report, id, pagePlans);
  const trustedEvidenceIds = new Set([
    "exec_summary_decision_scorecard",
    "voc_evidence",
    "crossborder_seller_cockpit",
    "market_size_decomposition",
    "ev_decision",
    "voc_absa_walls",
    "risk_register_sensitivity_confidence",
    "trust_guardrails_methodology",
  ]);
  const allocationMode = aigcPages || trustedEvidenceIds.has(id) ? "curated" : "generated";
  if (curatedPages) {
    return Array.from({ length: count }, (_, offset) => {
      const topic = pagePlans[offset]?.topic || MODULE_TOPICS[id]?.[offset] || pageTopic(id, offset, curatedPages[offset]?.[0]);
      const artifacts = curatedPages[offset]?.length
        ? curatedPages[offset]
        : [researchArtifact(report, id, topic, pagePlans[offset])];
      const normalizedArtifacts = artifacts.map((artifact) => normalizePageArtifact(artifact, topic)).filter(Boolean).slice(0, 3);
      const contractedArtifacts = bindArtifactsToPageContract(report, id, pagePlans[offset], normalizedArtifacts, allocationMode);
      return {
        topic: contractedArtifacts.length === 1 && ["research", "contract"].includes(contractedArtifacts[0].kind)
          ? contractedArtifacts[0].title
          : topic,
        artifacts: contractedArtifacts,
      };
    });
  }
  let artifacts = flattenArtifacts(moduleData, `modules.${id}`);
  const concept = report.modules?.board_concept;
  if (["pd_concept_matrix", "problem_solver_concept"].includes(id) && concept?.image_url && !artifacts.some((item) => item.kind === "image")) {
    artifacts.splice(1, 0, { kind: "image", title: concept.title || "AIGC 产品概念", image: concept.image_url, detail: concept });
  }
  const topics = pagePlans.map((plan, offset) => plan?.topic || MODULE_TOPICS[id]?.[offset] || pageTopic(id, offset));
  artifacts = fitArtifactBudget(artifacts, count, topics, pagePlans);
  return Array.from({ length: count }, (_, offset) => {
    const topic = topics[offset];
    const artifact = artifacts[offset];
    const normalizedArtifacts = (artifact ? [artifact] : [researchArtifact(report, id, topic, pagePlans[offset])])
      .map((item) => normalizePageArtifact(item, topic))
      .filter(Boolean);
    return {
      topic,
      artifacts: bindArtifactsToPageContract(report, id, pagePlans[offset], normalizedArtifacts),
    };
  });
}

function validReferenceReport(report) {
  if (!report || report.presentation_version !== "reference-a4-v2") return false;
  if (report.reference_layout?.contract_version !== "metis.reference-report.a4-landscape.332.v4") return false;
  if (report.reference_layout?.total_pages !== REFERENCE_TOTAL_PAGES || report.reference_layout?.module_count !== REFERENCE_MODULE_ORDER.length) return false;
  const order = report.order;
  if (!Array.isArray(order) || order.length !== REFERENCE_MODULE_ORDER.length) return false;
  if (order.some((id, index) => id !== REFERENCE_MODULE_ORDER[index])) return false;
  if (!report.modules || REFERENCE_MODULE_ORDER.some((id) => !isObject(report.modules[id]) || !Object.keys(report.modules[id]).length)) return false;
  const plan = report.reference_page_plan;
  if (!Array.isArray(plan) || plan.length !== REFERENCE_TOTAL_PAGES) return false;
  for (let index = 0; index < plan.length; index += 1) {
    const entry = plan[index];
    if (!entry || entry.page !== index + 1 || !entry.topic || !entry.title) return false;
    if (!entry.role || !entry.layout || !Array.isArray(entry.reference_blocks) || !entry.reference_blocks.length || !Array.isArray(entry.augmentation_blocks)) return false;
    if (entry.reference_blocks.some((block) => !block?.id || !block?.visual || block.required !== true || block.origin !== "reference")) return false;
    if (entry.augmentation_blocks.some((block) => !block?.id || !block?.visual || block.required !== false || !["voc", "aigc", "strategy"].includes(block.origin))) return false;
    if (index < 6) {
      if (entry.module_id != null || !["cover", "contents"].includes(entry.kind)) return false;
      continue;
    }
    const moduleIndex = REFERENCE_MODULE_STARTS.findIndex((start, candidate) => {
      const end = REFERENCE_MODULE_STARTS[candidate + 1] || (REFERENCE_TOTAL_PAGES + 1);
      return entry.page >= start && entry.page < end;
    });
    if (moduleIndex < 0 || entry.module_id !== REFERENCE_MODULE_ORDER[moduleIndex]) return false;
    if (entry.module_number !== moduleIndex + 1) return false;
    const moduleStart = REFERENCE_MODULE_STARTS[moduleIndex];
    const moduleEnd = (REFERENCE_MODULE_STARTS[moduleIndex + 1] || (REFERENCE_TOTAL_PAGES + 1)) - 1;
    if (entry.page_in_module !== entry.page - moduleStart + 1 || entry.pages_in_module !== moduleEnd - moduleStart + 1) return false;
  }
  return true;
}

export function compileReferencePages(report) {
  if (!validReferenceReport(report)) return [];
  const order = report.order;
  const pagePlan = report.reference_page_plan;
  const pages = [{ number: 1, kind: "cover" }];
  const tocGroups = [order.slice(0, 14), order.slice(14, 30), order.slice(30, 46), order.slice(46, 61), order.slice(61, 62)];
  tocGroups.forEach((ids, index) => pages.push({ number: index + 2, kind: "toc", ids }));
  order.forEach((id, moduleIndex) => {
    const start = REFERENCE_MODULE_STARTS[moduleIndex];
    const end = REFERENCE_MODULE_STARTS[moduleIndex + 1] || (REFERENCE_TOTAL_PAGES + 1);
    const count = end - start;
    const pagePlans = pagePlan.slice(start - 1, end - 1);
    const content = distributeArtifacts(report, id, count, pagePlans);
    content.forEach((item, offset) => pages.push({
      number: start + offset,
      kind: "module",
      id,
      moduleIndex,
      moduleNumber: moduleIndex + 1,
      moduleTitle: pagePlans[offset]?.module_title || moduleTitle(report, id, moduleIndex),
      moduleStart: start,
      moduleEnd: end - 1,
      offset,
      topic: item.topic,
      artifacts: item.artifacts,
      plan: pagePlans[offset],
    }));
  });
  return pages.sort((a, b) => a.number - b.number);
}

function safeText(value) {
  if (value == null) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "待补证";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  const text = String(value);
  return /^(undefined|nan|\[object Object\])$/i.test(text.trim()) ? "待补证" : text;
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (/^(?:https?:|\/data\/)/i.test(text) || /^\d{4}-\d{2}(?:-\d{2})?$/.test(text)) return null;
  const compact = text.replace(/,/g, "");
  const match = compact.match(/-?\d+(?:\.\d+)?/);
  if (!match || compact.length > 48 || /[\n｜；;]/.test(compact) || Number(match.index) > 12) return null;
  const prefix = compact.slice(0, match.index).trim();
  if (/[a-z]$/i.test(prefix) && !/(?:US|USD|CNY|RMB)\s*\$?$/i.test(prefix)) return null;
  return match ? Number(match[0]) : null;
}

function tableDensity(artifact) {
  const columns = Array.isArray(artifact?.columns) ? artifact.columns : [];
  const rows = Array.isArray(artifact?.rows) ? artifact.rows : [];
  const cellLengths = rows.flatMap((row) => columns.map((_, index) => safeText(row?.[index]).length));
  const maxCellLength = Math.max(0, ...cellLengths);
  const totalCharacters = cellLengths.reduce((sum, length) => sum + length, 0);
  if (
    columns.length >= 8 ||
    maxCellLength >= 120 ||
    totalCharacters >= 900 ||
    (columns.length >= 7 && (maxCellLength >= 48 || totalCharacters >= 360))
  ) return "high";
  if (
    rows.length >= 7 ||
    columns.length >= 6 ||
    maxCellLength >= 64 ||
    totalCharacters >= 420 ||
    (columns.length >= 4 && maxCellLength >= 36)
  ) return "medium";
  return "normal";
}

function RefTable({ artifact }) {
  const density = tableDensity(artifact);
  return html`<div class="ref-table-wrap" data-table-density=${density}><table class="ref-table" data-table-density=${density}><thead><tr>
    ${artifact.columns.map((column) => html`<th><span class="ref-cell-text" title=${safeText(column)}>${stripNumber(column)}</span></th>`)}
  </tr></thead><tbody>${artifact.rows.map((row) => html`<tr>
    ${artifact.columns.map((_, index) => html`<td><${RefCell} value=${row[index]}/></td>`)}
  </tr>`)}</tbody></table>${artifact.note ? html`<p class="ref-note">${artifact.note}</p>` : ""}</div>`;
}

function RefCell({ value }) {
  const text = safeText(value);
  return /^https?:\/\//i.test(text) || /^\/data\//i.test(text)
    ? html`<a class="ref-link ref-cell-text" href=${text} target="_blank" rel="noreferrer" title=${text}>打开来源 ↗</a>`
    : html`<span class="ref-cell-text" title=${text}>${text}</span>`;
}

function RefBars({ items }) {
  const values = items.map((item) => numeric(item.value)).filter((value) => value != null);
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  return html`<div class="ref-bars">${items.slice(0, 9).map((item) => {
    const value = numeric(item.value);
    const width = value == null ? 0 : Math.max(2, Math.min(100, Math.abs(value) / max * 100));
    return html`<div class="ref-bar-row"><span>${safeText(item.label)}</span><i><b style=${`width:${width}%`}></b></i><strong>${safeText(item.value)}${item.unit || ""}</strong></div>`;
  })}</div>`;
}

function RefChart({ artifact }) {
  const value = artifact.value || {};
  if (Array.isArray(value.items)) return html`<${RefBars} items=${value.items}/>`;
  if (Array.isArray(value.xLabels) && Array.isArray(value.matrix)) {
    const flat = value.matrix.flat().map(numeric).filter((item) => item != null);
    const max = Math.max(1, ...flat.map((item) => Math.abs(item)));
    return html`<div class="ref-heatmap" style=${`grid-template-columns:110px repeat(${Math.max(1, value.xLabels.length)},minmax(48px,1fr))`}><div></div>${value.xLabels.map((label) => html`<b>${label}</b>`)}
      ${value.matrix.flatMap((row, rowIndex) => [
        html`<strong>${value.yLabels?.[rowIndex] || `R${rowIndex + 1}`}</strong>`,
        ...row.map((cell) => { const n = numeric(cell); const alpha = n == null ? .08 : .12 + Math.abs(n) / max * .72; return html`<span style=${`background:rgba(16,163,127,${alpha})`}>${safeText(cell)}</span>`; }),
      ])}</div>`;
  }
  if (Array.isArray(value.axes) && Array.isArray(value.series)) {
    const axes = value.axes.slice(0, 8);
    const series = value.series.slice(0, 4);
    const cx = 180;
    const cy = 135;
    const radius = 92;
    const angleAt = (index) => -Math.PI / 2 + index * Math.PI * 2 / Math.max(1, axes.length);
    const pointAt = (index, ratio) => [
      cx + Math.cos(angleAt(index)) * radius * ratio,
      cy + Math.sin(angleAt(index)) * radius * ratio,
    ];
    const polygon = (ratio) => axes.map((_, index) => pointAt(index, ratio).join(",")).join(" ");
    const colors = ["#0b765a", "#4b6680", "#9a6a43", "#6b5f76"];
    const maxScore = Math.max(1, ...series.flatMap((item) => (item.scores || item.data || []).map((score) => numeric(score) || 0)));
    return html`<div class="ref-radar"><svg viewBox="0 0 360 270" role="img" aria-label=${artifact.title || "雷达图"}>
      ${[.25, .5, .75, 1].map((ratio) => html`<polygon points=${polygon(ratio)} fill="none" stroke="#d8d8d3" strokeWidth="1"/>`)}
      ${axes.map((axis, index) => {
        const [x, y] = pointAt(index, 1);
        const [tx, ty] = pointAt(index, 1.18);
        return html`<g><line x1=${cx} y1=${cy} x2=${x} y2=${y} stroke="#d0d0cb" strokeWidth="1"/><text x=${tx} y=${ty} textAnchor="middle" dominantBaseline="middle">${safeText(axis)}</text></g>`;
      })}
      ${series.map((item, seriesIndex) => {
        const scores = item.scores || item.data || [];
        const points = axes.map((_, index) => pointAt(index, Math.max(0, (numeric(scores[index]) || 0) / maxScore)).join(",")).join(" ");
        const color = colors[seriesIndex % colors.length];
        return html`<polygon points=${points} fill=${color} fillOpacity=".10" stroke=${color} strokeWidth="2"/>`;
      })}
    </svg><div class="ref-radar-legend">${series.map((item, index) => html`<span><i style=${`background:${colors[index % colors.length]}`}></i>${item.name || `方案 ${index + 1}`}</span>`)}</div></div>`;
  }
  if (Array.isArray(value.labels)) {
    const series = Array.isArray(value.series) ? value.series : [
      ...(Array.isArray(value.bars) ? [{ name: value.barName || "柱", data: value.bars }] : []),
      ...(Array.isArray(value.line) ? [{ name: value.lineName || "线", data: value.line }] : []),
    ];
    return html`<${RefTable} artifact=${{ columns: ["系列", ...value.labels], rows: series.map((item) => [item.name || "系列", ...(item.points || item.data || item.scores || [])]) }}/>`;
  }
  if (Array.isArray(value.points)) {
    const xKey = value.xKey;
    const yKey = value.yKey;
    if (xKey && yKey) {
      const points = value.points.slice(0, 8).map((point) => ({
        ...point,
        x: numeric(point[xKey]),
        y: numeric(point[yKey]),
      })).filter((point) => point.x != null && point.y != null);
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const xMin = Math.min(...xs, 0);
      const xMax = Math.max(...xs, xMin + 1);
      const yMin = Math.min(...ys, 0);
      const yMax = Math.max(...ys, yMin + 1);
      return html`<div class="ref-scatter"><div class="ref-scatter-grid">
        ${points.map((point) => {
          const left = 6 + ((point.x - xMin) / Math.max(1, xMax - xMin)) * 88;
          const bottom = 8 + ((point.y - yMin) / Math.max(1, yMax - yMin)) * 82;
          return html`<span class="ref-scatter-point" style=${`left:${left}%;bottom:${bottom}%`} title=${`${point.x} / ${point.y}`}><i></i><b>${safeText(point[value.labelKey || "label"])}</b></span>`;
        })}
        <em class="ref-scatter-y">${value.yLabel || yKey}</em><em class="ref-scatter-x">${value.xLabel || xKey}</em>
      </div></div>`;
    }
    const keys = Object.keys(value.points[0] || {}).slice(0, 6);
    return html`<${RefTable} artifact=${{ columns: keys, rows: value.points.slice(0, 8).map((point) => keys.map((key) => point[key])) }}/>`;
  }
  if (Array.isArray(value.nodes) && Array.isArray(value.links)) {
    return html`<div class="ref-flow">${value.nodes.slice(0, 10).map((node, index) => html`<span>${safeText(node.label || node.name || node)}${index < value.nodes.length - 1 ? html`<i>→</i>` : ""}</span>`)}</div>`;
  }
  return html`<div class="ref-code">${safeText(value)}</div>`;
}

function RefImage({ artifact }) {
  const detailRows = Object.entries(artifact.detail || {})
    .filter(([key, value]) => !["title", "thesis", "image", "image_url", "url"].includes(key) && value != null)
    .slice(0, 5)
    .map(([key, value]) => [humanize(key), Array.isArray(value) ? value.map((item) => Array.isArray(item) ? item.join(": ") : safeText(item)).join("；") : safeText(value)]);
  return html`<div class="ref-image-layout"><div class="ref-image-frame"><img src=${artifact.image} alt=${artifact.title || "产品概念图"}/></div>
    <div class="ref-image-copy"><span>AIGC · CONCEPT DIRECTION</span><h3>${artifact.title}</h3>
      ${detailRows.length ? html`<${RefTable} artifact=${{ columns: ["设计项", "概念包络"], rows: detailRows }}/>` : html`<p>概念图用于设计方向评审，不替代 CAD、工程图、测试报告或量产签样。</p>`}
    </div></div>`;
}

function RefResearch({ artifact }) {
  return html`<div class="ref-research">
    <div class="ref-research-lead"><span>${artifact.tag || "RESEARCH GATE"}</span><h3>${artifact.question}</h3><p>${artifact.finding}</p></div>
    <div class="ref-research-grid">${(artifact.cards || []).slice(0, 3).map((card) => html`<article>
      <small>${card.label}</small><b>${card.value}</b>${card.note ? html`<p>${card.note}</p>` : ""}
    </article>`)}</div>
    <div class="ref-research-foot"><span>置信状态：${artifact.confidence || "PENDING"}</span><b>放行 / 停止线：${artifact.gate}</b></div>
  </div>`;
}

function RefContract({ artifact }) {
  const visual = artifact.contract_visual || artifact.visual || "data_table";
  const rows = (artifact.cards || []).slice(0, 3).map((card) => [card.label, card.value, card.note || "待真实输入与人工签核"]);
  if (artifact.fallback_evidence_board) {
    return html`<div class="ref-contract-visual ref-evidence-board" data-visual=${visual}>
      <div class="ref-contract-lead"><span>${artifact.tag || "EVIDENCE GAP"}</span><b>${artifact.question}</b><p>${artifact.finding}</p></div>
      <div class="ref-evidence-board-grid">${(artifact.cards || []).slice(0, 3).map((card, index) => html`<article>
        <small>${String(index + 1).padStart(2, "0")} · ${card.label}</small><b>${card.value}</b><p>${card.note}</p>
      </article>`)}</div>
      <footer><span>证据状态：${artifact.confidence || "PENDING"}</span><b>放行 / 停止线：${artifact.gate}</b></footer>
    </div>`;
  }
  if (/table|matrix/i.test(visual)) {
    return html`<div class="ref-contract-visual ref-contract-table"><div class="ref-contract-lead"><span>${artifact.tag || "DATA CONTRACT"}</span><p>${artifact.finding}</p></div>
      <${RefTable} artifact=${{ columns: ["合同项", "当前状态 / 所需输入", "审计要求"], rows, note: `目标视觉：${visual}；放行 / 停止线：${artifact.gate}` }}/></div>`;
  }
  if (/callout|section_intro/i.test(visual)) {
    return html`<div class="ref-callout ref-contract-callout"><span>${artifact.tag || "DATA CONTRACT"}</span><h3>${artifact.question}</h3><p>${artifact.finding}</p><small>放行 / 停止线：${artifact.gate}</small></div>`;
  }
  return html`<div class="ref-contract-visual" data-visual=${visual}>
    <div class="ref-contract-lead"><span>${artifact.tag || "DATA CONTRACT"}</span><b>${artifact.question}</b><p>${artifact.finding}</p></div>
    <div class="ref-contract-bars">${(artifact.cards || []).slice(0, 3).map((card, index) => html`<article><div><small>${card.label}</small><b>${card.value}</b></div><i><span style=${`width:${34 + index * 18}%`}></span></i><p>${card.note}</p></article>`)}</div>
    <footer><span>目标视觉：${visual}</span><b>放行 / 停止线：${artifact.gate}</b></footer>
  </div>`;
}

function RefSellerKpis({ artifact }) {
  const cards = Array.isArray(artifact.cards) ? artifact.cards : [];
  return html`<div class=${`ref-seller-kpis ref-seller-kpis-${artifact.variant || "default"}`}>
    <div class="ref-seller-kpi-lead">
      <span>SELLER OPERATING CONTROL</span>
      <b>数据状态：${artifact.status || "待接入"}</b>
      <p>${artifact.note}</p>
    </div>
    <div class="ref-seller-kpi-grid" data-kpi-count=${cards.length}>
      ${cards.map((card, index) => html`<article class="ref-seller-kpi-card">
        <header><span>${String(index + 1).padStart(2, "0")}</span><em>${card.status || "待接入"}</em></header>
        <small>${card.label}</small>
        <div class="ref-seller-kpi-value"><b>${card.value || "PENDING"}</b>${card.unit ? html`<i>${card.unit}</i>` : ""}</div>
        <dl>
          <div><dt>指标阈值</dt><dd>${card.threshold || "待业务签核"}</dd></div>
          <div><dt>所需数据</dt><dd>${card.requiredData || "公司实账待接入"}</dd></div>
        </dl>
        <footer><span>行动提示</span><p>${card.action || "接入数据后按责任人和时间窗执行。"}</p></footer>
      </article>`)}
    </div>
  </div>`;
}

function RefComparison({ artifact }) {
  return html`<div class="ref-comparison">
    ${[artifact.left, artifact.right].map((side) => html`<article><h4>${side.title}</h4><${RefTable} artifact=${side}/></article>`)}
    ${artifact.note ? html`<p>${artifact.note}</p>` : ""}
  </div>`;
}

function RefConceptCompare({ artifact }) {
  return html`<div class="ref-concept-compare">
    <article class="ref-concept-primary">
      <div class="ref-concept-visual">${artifact.image
        ? html`<img src=${artifact.image} alt=${artifact.conceptTitle || artifact.title}/>`
        : html`<span>概念图待生成</span>`}</div>
      <span>AIGC · RECOMMENDED CONCEPT</span><h4>${artifact.conceptTitle}</h4><p>${artifact.thesis}</p>
    </article>
    <article class="ref-concept-benchmark"><h4>${artifact.benchmark?.title || "竞品 / 市场对标"}</h4>
      <${RefTable} artifact=${artifact.benchmark}/>
      <h4>${artifact.translation?.title || "VOC 到设计响应"}</h4><${RefTable} artifact=${artifact.translation}/>
    </article>
    ${artifact.note ? html`<p class="ref-note">${artifact.note}</p>` : ""}
  </div>`;
}

function RefSceneSuite({ artifact }) {
  return html`<div class="ref-scene-suite">
    <div class="ref-scene-grid">${(artifact.items || []).slice(0, 4).map((item, index) => html`<figure>
      <img src=${item.image} alt=${item.title || `产品场景图 ${index + 1}`}/>
      <figcaption><b>${String(index + 1).padStart(2, "0")}</b><span>${item.title}</span><em>${humanize(item.role)}</em></figcaption>
    </figure>`)}</div>
    <div class="ref-scene-meta"><span>${artifact.total || artifact.items?.length || 0} ASSETS</span><b>${artifact.designDnaId || "DESIGN-DNA-PENDING"}</b><em>${artifact.consistencyStatus || "PENDING-HUMAN-REVIEW"}</em></div>
    ${artifact.note ? html`<p class="ref-note">${artifact.note}</p>` : ""}
  </div>`;
}

function RefTrustQuality({ artifact }) {
  const colors = ["#0b765a", "#4c83e8", "#d79a28", "#8a8a84"];
  const segments = (artifact.segments || []).filter((item) => Number(item.value) > 0);
  const total = segments.reduce((sum, item) => sum + Number(item.value), 0);
  let cursor = 0;
  const stops = segments.map((item, index) => {
    const start = cursor;
    cursor += total ? Number(item.value) / total * 100 : 0;
    return `${colors[index % colors.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  const gradient = stops.length ? `conic-gradient(${stops.join(",")})` : "conic-gradient(#deded9 0 100%)";
  return html`<div class="ref-trust-quality">
    <article class="ref-trust-donut"><div class="ref-donut-ring" style=${`background:${gradient}`}><b>${total}</b><span>来源</span></div>
      <div class="ref-donut-legend">${segments.map((item, index) => html`<p><i style=${`background:${colors[index % colors.length]}`}></i><span>${item.label}</span><b>${item.value}</b></p>`)}</div></article>
    <article class="ref-quality-dimensions"><div class="ref-quality-title"><b>LLM / AIGC 质量五维</b><span>不生成虚假评分</span></div>
      ${(artifact.dimensions || []).map((item, index) => html`<div><b>${String(index + 1).padStart(2, "0")}</b><span>${item[0]}</span><em>${item[1]}</em></div>`)}</article>
    <p class="ref-note">${artifact.note}</p>
  </div>`;
}

function RefMethodologyGrid({ artifact }) {
  return html`<div class="ref-method-grid">${(artifact.cards || []).slice(0, 3).map((card) => html`<article><span>${card.code}</span><h4>${card.title}</h4><p>${card.body}</p><footer>${card.footer}</footer></article>`)}</div>`;
}

function RefWarningList({ artifact }) {
  return html`<div class="ref-warning-list">${(artifact.items || []).slice(0, 4).map((item) => html`<article><span>!</span><div><h4>${item.title}</h4><p><b>误差来源：</b>${item.risk}</p><p><b>缓解：</b>${item.mitigation}</p></div></article>`)}</div>`;
}

function RefArtifact({ artifact }) {
  if (artifact.kind === "table") return html`<${RefTable} artifact=${artifact}/>`;
  if (artifact.kind === "chart") return html`<div class="ref-chart-wrap"><${RefChart} artifact=${artifact}/>${artifact.note ? html`<p class="ref-note">${artifact.note}</p>` : ""}</div>`;
  if (artifact.kind === "image") return html`<${RefImage} artifact=${artifact}/>`;
  if (artifact.kind === "research") return html`<${RefResearch} artifact=${artifact}/>`;
  if (artifact.kind === "contract") return html`<${RefContract} artifact=${artifact}/>`;
  if (artifact.kind === "seller-kpis") return html`<${RefSellerKpis} artifact=${artifact}/>`;
  if (artifact.kind === "comparison") return html`<${RefComparison} artifact=${artifact}/>`;
  if (artifact.kind === "concept-compare") return html`<${RefConceptCompare} artifact=${artifact}/>`;
  if (artifact.kind === "scene-suite") return html`<${RefSceneSuite} artifact=${artifact}/>`;
  if (artifact.kind === "trust-quality") return html`<${RefTrustQuality} artifact=${artifact}/>`;
  if (artifact.kind === "methodology-grid") return html`<${RefMethodologyGrid} artifact=${artifact}/>`;
  if (artifact.kind === "warning-list") return html`<${RefWarningList} artifact=${artifact}/>`;
  if (artifact.kind === "kpi-cards") return html`<div class="ref-decision-kpis">${artifact.items.map((item) => html`<article><small>${item.label}</small><b>${item.value}</b><p>${item.note || ""}</p></article>`)}${artifact.note ? html`<p class="ref-note">${artifact.note}</p>` : ""}</div>`;
  if (artifact.kind === "callout") return html`<div class="ref-callout"><span>${artifact.tag || "DECISION"}</span><h3>${artifact.title}</h3><p>${artifact.body}</p></div>`;
  if (artifact.kind === "list") return html`<div class="ref-list">${artifact.items.map((item, index) => html`<div><b>${String(index + 1).padStart(2, "0")}</b><p>${item}</p></div>`)}</div>`;
  if (artifact.kind === "kv") return html`<${RefTable} artifact=${{ columns: ["分析项", "当前结论"], rows: artifact.rows }}/>`;
  return html`<div class="ref-callout"><h3>${artifact.title}</h3><p>${artifact.body}</p></div>`;
}

function mobileReadableValue(value, depth = 0) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) {
    return value.map((item) => mobileReadableValue(item, depth + 1)).filter(Boolean).join("；") || "—";
  }
  if (typeof value === "object") {
    if (depth >= 2) return safeText(value);
    return Object.entries(value).map(([key, item]) => `${humanize(key)}：${mobileReadableValue(item, depth + 1)}`).join("；") || "—";
  }
  return safeText(value);
}

export function mobileChartTable(artifact) {
  const value = artifact?.value || {};
  if (Array.isArray(value.items)) {
    return {
      columns: ["指标", "数值", "说明"],
      rows: value.items.map((item, index) => [
        item?.label || item?.name || `指标 ${index + 1}`,
        `${mobileReadableValue(item?.value)}${item?.unit || ""}`,
        item?.note || item?.sub || item?.status || "—",
      ]),
    };
  }
  if (Array.isArray(value.xLabels) && Array.isArray(value.matrix)) {
    return {
      columns: [value.yLabel || "维度", ...value.xLabels],
      rows: value.matrix.map((row, index) => [value.yLabels?.[index] || `项目 ${index + 1}`, ...row]),
    };
  }
  if (Array.isArray(value.axes) && Array.isArray(value.series)) {
    return {
      columns: ["方案", ...value.axes],
      rows: value.series.map((series, index) => [
        series?.name || `方案 ${index + 1}`,
        ...(series?.scores || series?.data || series?.points || []),
      ]),
    };
  }
  if (Array.isArray(value.labels)) {
    const series = Array.isArray(value.series) ? value.series : [
      ...(Array.isArray(value.bars) ? [{ name: value.barName || "柱状系列", data: value.bars }] : []),
      ...(Array.isArray(value.line) ? [{ name: value.lineName || "折线系列", data: value.line }] : []),
    ];
    return {
      columns: ["系列", ...value.labels],
      rows: series.map((item, index) => [item?.name || `系列 ${index + 1}`, ...(item?.points || item?.data || item?.scores || [])]),
    };
  }
  if (Array.isArray(value.points)) {
    const keys = Object.keys(value.points[0] || {});
    return {
      columns: keys.map((key) => key === value.xKey
        ? (value.xLabel || humanize(key))
        : key === value.yKey
          ? (value.yLabel || humanize(key))
          : humanize(key)),
      rows: value.points.map((point) => keys.map((key) => point?.[key])),
    };
  }
  if (Array.isArray(value.nodes)) {
    return {
      columns: ["步骤", "内容", "说明"],
      rows: value.nodes.map((node, index) => [
        String(index + 1).padStart(2, "0"),
        typeof node === "object" ? node.label || node.name || node.title || `步骤 ${index + 1}` : node,
        typeof node === "object" ? node.note || node.detail || node.status || "—" : "—",
      ]),
    };
  }
  const entries = Object.entries(value).filter(([, item]) => item != null);
  return { columns: ["图表字段", "当前值"], rows: entries.map(([key, item]) => [humanize(key), mobileReadableValue(item)]) };
}

export function referenceArtifactSources(artifact) {
  const candidates = [
    artifact?.source_path,
    artifact?.contract_source_path,
    ...(Array.isArray(artifact?.derived_source_paths) ? artifact.derived_source_paths : []),
    ...(Array.isArray(artifact?.contract_declared_source_paths) ? artifact.contract_declared_source_paths : []),
  ];
  return [...new Set(candidates.map((item) => safeText(item).trim()).filter(Boolean))];
}

function MobileReferenceValue({ value }) {
  const text = mobileReadableValue(value);
  return /^(?:https?:\/\/|\/data\/)/i.test(text)
    ? html`<a href=${text} target="_blank" rel="noreferrer">打开来源 ↗</a>`
    : html`<span>${text}</span>`;
}

function MobileReferenceTable({ artifact }) {
  const columns = Array.isArray(artifact?.columns) ? artifact.columns : [];
  const rows = Array.isArray(artifact?.rows) ? artifact.rows : [];
  if (!rows.length) return html`<p class="ref-mobile-empty">暂无可展示的数据行；请查看本页说明与来源边界。</p>`;
  return html`<div class="ref-mobile-table" role="list" aria-label=${`${artifact?.title || "结构化数据"}，共 ${rows.length} 条，已全部显示`}>
    <p class="ref-mobile-data-count">共 ${rows.length} 条 · 已全部显示</p>
    ${rows.map((row, rowIndex) => html`<article role="listitem"><b class="ref-mobile-row-index">${String(rowIndex + 1).padStart(2, "0")}</b><dl>
      ${columns.map((column, columnIndex) => html`<div><dt>${stripNumber(column)}</dt><dd><${MobileReferenceValue} value=${row?.[columnIndex]}/></dd></div>`)}
    </dl></article>`)}
  </div>`;
}

function MobileReferenceSources({ artifact }) {
  const sources = referenceArtifactSources(artifact);
  if (!sources.length && !artifact?.contract_id) return "";
  return html`<footer class="ref-mobile-sources"><span>来源与证据</span>
    ${sources.map((source) => /^(?:https?:\/\/|\/data\/)/i.test(source)
      ? html`<a href=${source} target="_blank" rel="noreferrer">${source}</a>`
      : html`<code>${source}</code>`)}
    ${artifact?.contract_id ? html`<small>证据合同：${artifact.contract_id}</small>` : ""}
  </footer>`;
}

function MobileReferenceCards({ items = [] }) {
  return html`<div class="ref-mobile-cards">${items.map((item, index) => html`<article><small>${item?.label || item?.title || item?.code || `项目 ${index + 1}`}</small><b>${mobileReadableValue(item?.value ?? item?.status ?? item?.footer)}${item?.unit || ""}</b>${item?.note || item?.body || item?.detail || item?.sub ? html`<p>${item.note || item.body || item.detail || item.sub}</p>` : ""}</article>`)}</div>`;
}

function MobileReferenceArtifact({ artifact }) {
  if (artifact.kind === "table") return html`<${MobileReferenceTable} artifact=${artifact}/>${artifact.note ? html`<p class="ref-mobile-note-text">${artifact.note}</p>` : ""}`;
  if (artifact.kind === "kv") return html`<${MobileReferenceTable} artifact=${{ ...artifact, columns: ["分析项", "当前结论"] }}/>`;
  if (artifact.kind === "chart") {
    const table = mobileChartTable(artifact);
    return html`<div class="ref-mobile-chart-summary"><p>图表已转换为手机可读数据表；数值与原报告使用同一份结构化数据。</p><${MobileReferenceTable} artifact=${{ ...table, title: artifact.title }}/>${artifact.note ? html`<p class="ref-mobile-note-text">${artifact.note}</p>` : ""}</div>`;
  }
  if (artifact.kind === "image") {
    const detailRows = Object.entries(artifact.detail || {}).filter(([key, value]) => !["title", "image", "image_url", "url"].includes(key) && value != null);
    return html`<figure class="ref-mobile-image"><img src=${artifact.image} alt=${artifact.title || "产品概念图"}/><figcaption>概念图用于方向评审，不替代 CAD、测试报告或量产签样。</figcaption></figure>${detailRows.length ? html`<${MobileReferenceTable} artifact=${{ title: "设计说明", columns: ["设计项", "当前定义"], rows: detailRows.map(([key, value]) => [humanize(key), value]) }}/>` : ""}`;
  }
  if (["research", "contract"].includes(artifact.kind)) return html`<div class="ref-mobile-conclusion"><b>${artifact.question || artifact.title}</b><p>${artifact.finding || artifact.body || "当前结论待补充"}</p></div><${MobileReferenceCards} items=${artifact.cards || []}/><dl class="ref-mobile-gate"><div><dt>置信状态</dt><dd>${artifact.confidence || "PENDING"}</dd></div><div><dt>放行 / 停止线</dt><dd>${artifact.gate || "待真实输入与人工签核"}</dd></div></dl>`;
  if (artifact.kind === "seller-kpis") return html`<p class="ref-mobile-note-text">${artifact.note || `数据状态：${artifact.status || "待接入"}`}</p><${MobileReferenceCards} items=${(artifact.cards || []).map((card) => ({ ...card, note: [card.threshold, card.note].filter(Boolean).join("；") }))}/>`;
  if (artifact.kind === "comparison") return html`${[artifact.left, artifact.right].filter(Boolean).map((side) => html`<h4>${side.title}</h4><${MobileReferenceTable} artifact=${side}/>`)}${artifact.note ? html`<p class="ref-mobile-note-text">${artifact.note}</p>` : ""}`;
  if (artifact.kind === "concept-compare") return html`${artifact.image ? html`<figure class="ref-mobile-image"><img src=${artifact.image} alt=${artifact.conceptTitle || artifact.title}/></figure>` : ""}<div class="ref-mobile-conclusion"><b>${artifact.conceptTitle || "推荐产品概念"}</b><p>${artifact.thesis || "概念方向待验证"}</p></div>${artifact.benchmark ? html`<h4>${artifact.benchmark.title || "竞品对标"}</h4><${MobileReferenceTable} artifact=${artifact.benchmark}/>` : ""}${artifact.translation ? html`<h4>${artifact.translation.title || "VOC 到设计响应"}</h4><${MobileReferenceTable} artifact=${artifact.translation}/>` : ""}${artifact.note ? html`<p class="ref-mobile-note-text">${artifact.note}</p>` : ""}`;
  if (artifact.kind === "scene-suite") return html`<div class="ref-mobile-scene-suite">${(artifact.items || []).map((item) => html`<figure><img src=${item.image} alt=${item.title}/><figcaption><b>${item.title}</b><span>${humanize(item.role)}</span></figcaption></figure>`)}</div>${artifact.note ? html`<p class="ref-mobile-note-text">${artifact.note}</p>` : ""}`;
  if (artifact.kind === "trust-quality") return html`<${MobileReferenceCards} items=${artifact.segments || []}/><${MobileReferenceTable} artifact=${{ title: "质量维度", columns: ["维度", "状态"], rows: artifact.dimensions || [] }}/>${artifact.note ? html`<p class="ref-mobile-note-text">${artifact.note}</p>` : ""}`;
  if (artifact.kind === "methodology-grid") return html`<${MobileReferenceCards} items=${artifact.cards || []}/>`;
  if (artifact.kind === "warning-list") return html`<div class="ref-mobile-warning-list">${(artifact.items || []).map((item) => html`<article><b>${item.title}</b><p><strong>风险：</strong>${item.risk}</p><p><strong>缓解：</strong>${item.mitigation}</p></article>`)}</div>`;
  if (artifact.kind === "kpi-cards") return html`<${MobileReferenceCards} items=${artifact.items || []}/>${artifact.note ? html`<p class="ref-mobile-note-text">${artifact.note}</p>` : ""}`;
  if (artifact.kind === "list") return html`<ol class="ref-mobile-list">${(artifact.items || []).map((item) => html`<li>${mobileReadableValue(item)}</li>`)}</ol>`;
  return html`<div class="ref-mobile-conclusion"><b>${artifact.tag || "当前结论"}</b><p>${artifact.body || artifact.finding || mobileReadableValue(artifact)}</p></div>`;
}

function MobileReferencePage({ report, run, page }) {
  const decision = reportDecision(report, run);
  if (page.kind === "cover") return html`<article class="ref-mobile-page ref-mobile-cover"><span>选品决策报告 · 第 1 / ${REFERENCE_TOTAL_PAGES} 页</span><h2>${report.category}</h2><div class="ref-mobile-conclusion"><b>${decision.status}</b><p>${decision.verdict}</p></div><p>${report.marketplace || "美国市场"} · 数据截至 ${report.data_cutoff || "报告观察日"}</p></article>`;
  if (page.kind === "toc") return html`<article class="ref-mobile-page"><header class="ref-mobile-page-head"><span>目录 · 原第 ${page.number} 页</span><h2>报告模块</h2></header><div class="ref-mobile-toc">${page.ids.map((id) => { const index = report.order.indexOf(id); const start = REFERENCE_MODULE_STARTS[index]; const end = (REFERENCE_MODULE_STARTS[index + 1] || 333) - 1; return html`<div><b>${String(index + 1).padStart(2, "0")}</b><span>${moduleTitle(report, id, index)}</span><em>${start === end ? start : `${start}–${end}`}</em></div>`; })}</div></article>`;
  const review = runReviewDecision(run, report);
  const artifacts = Array.isArray(page.artifacts) ? page.artifacts.filter(Boolean) : [];
  if (page.number === 7) return html`<article class="ref-mobile-page"><header class="ref-mobile-page-head"><span>执行摘要 · 原第 7 页</span><h2>${report.category}</h2></header><div class="ref-mobile-conclusion"><b>${decision.status}</b><p>${decision.verdict}</p></div><${MobileReferenceCards} items=${decision.kpis}/>${decision.conditions.length ? html`<section class="ref-mobile-decision-gates"><h3>放行条件</h3><ol>${decision.conditions.map((item) => html`<li>${item}</li>`)}</ol></section>` : ""}<section class="ref-mobile-evidence-contracts" aria-label="执行摘要来源与证据合同"><h3>来源与证据合同</h3>${artifacts.map((artifact) => { const displayArtifact = applyReviewSemantics(artifact, review); return html`<section class="ref-mobile-artifact" data-mobile-artifact-kind=${displayArtifact.kind} data-contract-id=${displayArtifact.contract_id}><h4>${displayArtifact.title || page.topic}</h4><${MobileReferenceArtifact} artifact=${displayArtifact}/><${MobileReferenceSources} artifact=${displayArtifact}/></section>`; })}</section></article>`;
  return html`<article class="ref-mobile-page"><header class="ref-mobile-page-head"><span>${String(page.moduleNumber).padStart(2, "0")} · ${page.moduleTitle} · 原第 ${page.number} 页</span><h2>${page.topic}</h2><p>本模块 ${page.offset + 1} / ${page.moduleEnd - page.moduleStart + 1}</p></header>
    ${artifacts.length ? artifacts.map((artifact) => { const displayArtifact = applyReviewSemantics(artifact, review); return html`<section class="ref-mobile-artifact" data-mobile-artifact-kind=${displayArtifact.kind}><h3>${displayArtifact.title || page.topic}</h3><${MobileReferenceArtifact} artifact=${displayArtifact}/><${MobileReferenceSources} artifact=${displayArtifact}/></section>`; }) : html`<div class="ref-mobile-conclusion"><b>本页内容暂时无法显示</b><p>页码仍保持连续，请查看相邻页或返回研究档案重新生成报告。</p></div>`}
  </article>`;
}

function reportEvidenceState(report) {
  if (["template_demo", "synthetic_fixture"].includes(report?.evidence_mode)) return "template_demo";
  if (report?.evidence_mode === "verified_research" && report?.decision_readiness === "ready_for_review") return "review_ready";
  return "evidence_blocked";
}

function runReviewDecision(run, report) {
  const evidenceState = reportEvidenceState(report);
  const checks = run?.review_checks;
  const reviewed = evidenceState === "review_ready" && Boolean(
    run?.reviewed && run?.decision_outcome && run?.outcome_note &&
    run?.reviewer_id && run?.reviewer_name && run?.reviewed_at &&
    checks?.evidence === true && checks?.economics === true && checks?.risk === true &&
    /^[a-f0-9]{64}$/i.test(String(run?.review_report_hash || "")),
  );
  return {
    reviewed,
    evidenceState,
    outcome: reviewed
      ? run.decision_outcome
      : evidenceState === "template_demo"
        ? "框架演示"
        : evidenceState === "evidence_blocked"
          ? "证据待补齐"
          : "待人工终审",
    note: reviewed
      ? run.outcome_note || "已完成终审签核"
      : evidenceState === "template_demo"
        ? report?.demo_note || "仅用于验证研究框架，不可作为采购、备货或上市批准依据。"
        : evidenceState === "evidence_blocked"
          ? "关键证据门尚未通过，补齐来源、样本与时效验证后才能发起终审。"
          : "AI 研究建议不等于采购、备货或上市批准。",
    reviewer: reviewed ? run.reviewer_name || `Reviewer #${run.reviewer_id || "—"}` : "",
    reviewedAt: reviewed && run.reviewed_at ? new Date(run.reviewed_at * 1000).toLocaleString("zh-CN", { hour12: false }) : "",
    reportHash: reviewed ? String(run.review_report_hash || "") : "",
  };
}

function applyReviewSemantics(artifact, review) {
  if (!artifact || typeof artifact !== "object") return artifact;
  const gate1Status = review?.reviewed
    ? `已签核 · 签核人：${safeText(review.reviewer)} · 签核时间：${safeText(review.reviewedAt)}`
    : "待人工终审";

  if (artifact.review_semantics === "gate1_summary") {
    return {
      ...artifact,
      dimensions: (artifact.dimensions || []).map((item) => (
        Array.isArray(item) && item[0] === "系统 Gate-1"
          ? [item[0], gate1Status]
          : item
      )),
    };
  }

  if (artifact.review_semantics === "functional_domains") {
    const reviewNote = review?.reviewed
      ? `系统 Gate-1 ${gate1Status}；以下职能域没有独立审批记录，不能据此判断任何职能域的审批结论。`
      : "系统 Gate-1 待人工终审；以下职能域没有独立审批记录。";
    return {
      ...artifact,
      rows: (artifact.rows || []).map((row) => (
        Array.isArray(row) ? [row[0], "未单独记录", ...row.slice(2)] : row
      )),
      note: reviewNote,
    };
  }

  return artifact;
}

function reportDecision(report, run) {
  const decision = report.modules?.exec_summary_decision_scorecard?.decision || {};
  const evidenceRows = report.modules?.voc_evidence?.evidence_log?.rows || [];
  const sourceRows = report.modules?.trust_guardrails_methodology?.source_register?.rows
    || report.modules?.source_register?.rows
    || [];
  const kpis = [...(report.modules?.exec_summary_decision_scorecard?.kpi_tiles || [])];
  const evidenceKpis = [
    { label: "来源台账", value: String(sourceRows.length), unit: "项", sub: "可追溯来源登记" },
    { label: "VOC 编码观察", value: String(evidenceRows.length), unit: "条", sub: "合规转述 · 非全量评论" },
  ];
  for (const item of evidenceKpis) {
    if (kpis.length >= 6) break;
    if (!kpis.some((kpi) => kpi.label === item.label)) kpis.push(item);
  }
  const aiStatus = decision.verdict === "go"
    ? "建议进入"
    : decision.verdict === "no_go"
      ? "不建议进入"
      : "有条件进入";
  const aiVerdict = decision.one_liner || report.verdict || "待董事会评审";
  const review = runReviewDecision(run, report);
  const isTemplateDemo = review.evidenceState === "template_demo";
  const isEvidenceBlocked = review.evidenceState === "evidence_blocked";
  return {
    status: review.reviewed ? review.outcome : isTemplateDemo ? "框架演示" : isEvidenceBlocked ? "证据待补齐" : aiStatus,
    verdict: review.reviewed ? review.note : isTemplateDemo || isEvidenceBlocked ? review.note : aiVerdict,
    label: review.reviewed
      ? "HUMAN DECISION · 人工最终决策"
      : isTemplateDemo
        ? "FRAMEWORK DEMO · 不可签核"
        : isEvidenceBlocked
          ? "EVIDENCE HOLD · 暂不可签核"
          : "AI RECOMMENDATION · 待人工终审",
    aiStatus,
    aiVerdict,
    review,
    isTemplateDemo,
    isEvidenceBlocked,
    conditions: decision.gating_conditions || report.modules?.exec_summary_decision_scorecard?.gating_conditions || [],
    kpis,
  };
}

function Cover({ report, run }) {
  const decision = reportDecision(report, run);
  return html`<div class="ref-cover"><div class="ref-brand"><i>M</i><b>Metis</b></div>
    <div class="ref-cover-main"><span>选品决策报告 · DECISION REPORT</span><h1>${report.category}</h1>
      <div class=${"ref-cover-verdict " + (decision.review.reviewed ? "signed" : "pending")}><span>${decision.label}</span><b>${decision.status}</b><p>${decision.verdict}</p></div>
      ${decision.review.reviewed ? html`<div class="ref-cover-review-meta">${decision.review.reviewer} · ${decision.review.reviewedAt} · 报告哈希 ${decision.review.reportHash.slice(0, 12)}</div>` : html`<div class="ref-cover-review-meta pending">${decision.isTemplateDemo ? "框架演示 · 不可用于商业决策" : decision.isEvidenceBlocked ? "关键证据待补齐 · 暂不可发起终审" : "审阅稿 · 人工签核前不得作为最终批准依据"}</div>`}
      <p>${report.marketplace || "美国市场"} · 数据截至 ${report.data_cutoff || "报告观察日"}</p></div>
    <div class="ref-cover-foot">跨境电商选品决策研究 · 62 模块完整证据版</div></div>`;
}

function Toc({ report, page }) {
  return html`<div class="ref-toc"><div class="ref-page-title"><span>CONTENTS ${page.number - 1} / 5</span><h2>目录 · Contents</h2></div>
    <div class="ref-toc-list">${page.ids.map((id) => {
      const index = report.order.indexOf(id);
      const start = REFERENCE_MODULE_STARTS[index];
      const end = (REFERENCE_MODULE_STARTS[index + 1] || 333) - 1;
      return html`<div><b>${String(index + 1).padStart(2, "0")}</b><span>${moduleTitle(report, id, index)}</span><i></i><em>${start === end ? start : `${start}–${end}`}</em></div>`;
    })}</div></div>`;
}

function ExecutivePreview({ report, run, page }) {
  const decision = reportDecision(report, run);
  const [decisionBlock, kpiBlock] = page?.plan?.reference_blocks || [];
  return html`<div class="ref-exec-preview"><div class="ref-exec-copy" data-contract-id=${decisionBlock?.id} data-contract-visual=${decisionBlock?.visual} data-contract-required="true">
    <div class="ref-exec-product"><h3>${report.category}</h3><p>${report.marketplace || "美国市场"} · 数据截至 ${report.data_cutoff || "报告观察日"} · 62 模块完整证据版</p></div>
    <span>${decision.label}</span><h3><strong>${decision.status}</strong><i>${decision.verdict}</i></h3>
    ${decision.review.reviewed ? html`<small class="ref-ai-recommendation">原 AI 研究建议：${decision.aiStatus} · ${decision.aiVerdict}</small>` : ""}
    <div class="ref-exec-gates">${decision.conditions.slice(0, 3).map((item) => html`<p>${item}</p>`)}</div>
    <div class="ref-kpis" data-contract-id=${kpiBlock?.id} data-contract-visual=${kpiBlock?.visual} data-contract-required="true">${decision.kpis.slice(0, 6).map((item) => html`<div><small>${item.label}</small><b>${item.value}${item.unit || ""}</b><span>${item.sub || ""}</span></div>`)}</div></div></div>`;
}

function ModuleBody({ report, run, page }) {
  if (page.number === 7) return html`<${ExecutivePreview} report=${report} run=${run} page=${page}/>`;
  const review = runReviewDecision(run, report);
  const artifacts = Array.isArray(page.artifacts) ? page.artifacts.filter(Boolean) : [];
  if (!artifacts.length) {
    return html`<div class="ref-research ref-page-empty" role="status" aria-live="polite">
      <div class="ref-research-lead"><span>CONTENT CHECK</span><b>本页内容暂时无法显示</b><p>页码仍保持连续。请先查看相邻页；若刷新后仍为空，请返回研究档案重新生成报告。</p></div>
      <div class="ref-research-foot"><span>原报告第 ${page.number} 页</span><b>导出预检会阻止空白页进入正式 PDF</b></div>
    </div>`;
  }
  const strategySidecar = artifacts.find((artifact) => artifact.contract_origin === "strategy" && artifact.contract_placement === "sidecar");
  return html`<div class=${"ref-artifacts ref-artifacts-" + Math.min(3, artifacts.length)} data-strategy-layout=${strategySidecar ? "stacked" : undefined} data-strategy-kind=${strategySidecar?.kind}>
    ${artifacts.map((artifact) => {
      const displayArtifact = applyReviewSemantics(artifact, review);
      return html`<section data-contract-id=${artifact.contract_id} data-contract-visual=${artifact.contract_visual} data-contract-required=${artifact.contract_required === true ? "true" : undefined} data-contract-origin=${artifact.contract_origin || "reference"} data-artifact-kind=${artifact.kind}><h3>${displayArtifact.title || page.topic}</h3><${RefArtifact} artifact=${displayArtifact}/></section>`;
    })}
  </div>`;
}

function ModuleHeader({ page }) {
  if (page.offset === 0) {
    const transition = page.plan?.transition;
    return html`<div class="ref-module-head"><div><span>${String(page.moduleNumber).padStart(2, "0")} · MODULE</span><h2>${page.moduleTitle}</h2></div>
      <aside><b>${transition ? `${transition.carryover_title} → ${transition.module_anchor_title}` : page.topic}</b><small>本模块 ${page.offset + 1} / ${page.moduleEnd - page.moduleStart + 1}</small></aside></div>`;
  }
  return html`<div class="ref-topic-head"><div><span>${String(page.moduleNumber).padStart(2, "0")} · ${page.moduleTitle}</span><h2>${page.topic}</h2></div>
    <small>${page.offset + 1} / ${page.moduleEnd - page.moduleStart + 1}</small></div>`;
}

function Sheet({ report, run, page, active }) {
  const date = report.data_cutoff || new Date().toISOString().slice(0, 10);
  const decision = reportDecision(report, run);
  const review = decision.review;
  const requiredBlockCount = page.kind === "module" ? (page.plan?.reference_blocks?.length || 0) : 0;
  return html`<article class=${"ref-sheet" + (active ? " is-active" : "")} data-page=${page.number} data-required-blocks=${requiredBlockCount} aria-label=${`报告第 ${page.number} / ${REFERENCE_TOTAL_PAGES} 页`} aria-hidden=${!active}>
    <div class="ref-running-head"><b>Metis</b><span>选品决策报告</span><em>${report.category}</em></div>
    <div class=${"ref-sheet-main ref-kind-" + page.kind}>
      ${page.kind === "cover" ? html`<${Cover} report=${report} run=${run}/>` : page.kind === "toc" ? html`<${Toc} report=${report} page=${page}/>` : html`
        <${ModuleHeader} page=${page}/>
        <${ModuleBody} report=${report} run=${run} page=${page}/>`}
    </div>
    <footer class="ref-running-foot"><span>${date} · ${review.reviewed ? `人工签核：${review.outcome} · ${review.reviewer} · ${review.reviewedAt}` : decision.isTemplateDemo ? "框架演示 · 不可签核" : decision.isEvidenceBlocked ? "证据待补齐 · 暂不可签核" : "审阅稿 · 待人工终审"}</span><b>第 ${page.number} / ${REFERENCE_TOTAL_PAGES} 页</b></footer>
  </article>`;
}

function waitFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export const REFERENCE_PREFLIGHT_FILLER_SIGNATURES = [
  "来源抽样与证据边界",
  "本页结论：先验证，再放量",
  "待真实数据替换",
  "方向性结论",
  "不得将 AIGC 或单一公开样本写成市场事实",
];

const REFERENCE_PREFLIGHT_CONTAINERS = [
  ".ref-sheet-main",
  ".ref-artifacts",
  ".ref-artifacts > section",
  ".ref-research",
  ".ref-research-lead",
  ".ref-research-grid",
  ".ref-contract-visual",
  ".ref-contract-lead",
  ".ref-contract-bars",
  ".ref-seller-kpis",
  ".ref-seller-kpi-grid",
  ".ref-seller-kpi-card",
  ".ref-comparison",
  ".ref-decision-kpis",
  ".ref-concept-compare",
  ".ref-concept-primary",
  ".ref-concept-benchmark",
  ".ref-chart-wrap",
  ".ref-scatter",
  ".ref-scatter-grid",
  ".ref-radar",
  ".ref-table-wrap",
  ".ref-table",
  ".ref-cell-text",
  ".ref-image-frame",
  ".ref-image-copy",
];

function allMatches(root, selector) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  try {
    return [...root.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function measuredRect(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") return null;
  const rect = node.getBoundingClientRect();
  if (!rect) return null;
  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width ?? (Number(rect.right) - left));
  const height = Number(rect.height ?? (Number(rect.bottom) - top));
  const right = Number(rect.right ?? (left + width));
  const bottom = Number(rect.bottom ?? (top + height));
  if (![left, top, width, height, right, bottom].every(Number.isFinite)) return null;
  return { left, top, width, height, right, bottom };
}

function hasArea(node, rect) {
  return Number(node?.clientWidth || 0) > 0 || Number(node?.clientHeight || 0) > 0 ||
    Number(rect?.width || 0) > 0 || Number(rect?.height || 0) > 0;
}

function outsideAmounts(inner, outer) {
  if (!inner || !outer) return { horizontal: 0, vertical: 0 };
  return {
    horizontal: Math.max(0, outer.left - inner.left, inner.right - outer.right),
    vertical: Math.max(0, outer.top - inner.top, inner.bottom - outer.bottom),
  };
}

function isStrictAncestor(ancestor, node) {
  let current = node?.parentElement;
  const visited = new Set();
  while (current && !visited.has(current)) {
    if (current === ancestor) return true;
    visited.add(current);
    current = current.parentElement;
  }
  return false;
}

function rootLayoutViolations(violations) {
  const preferred = violations.filter((violation) => {
    if (violation.code !== "OUTSIDE_SHEET") return true;
    return !violations.some((candidate) =>
      candidate.code === "OUTSIDE_PARENT" &&
      candidate.node === violation.node &&
      candidate.axis === violation.axis
    );
  });
  return preferred.filter((violation) => !preferred.some((candidate) =>
    candidate !== violation &&
    candidate.axis === violation.axis &&
    isStrictAncestor(violation.node, candidate.node)
  ));
}

function roundedPixels(value) {
  return Number(Number(value || 0).toFixed(2));
}

/**
 * Runs the same fixed-page checks used immediately before PDF export.
 * The result is deliberately plain data so it can be logged and unit tested.
 */
export function inspectReferenceDeck(root = typeof document !== "undefined" ? document : null) {
  const errors = [];
  const tolerance = 2;
  const sheets = allMatches(root, ".ref-sheet");
  const addError = (code, page, selector, message, details = {}) => {
    errors.push({ code, page: page ?? null, selector, message, ...details });
  };

  if (sheets.length !== REFERENCE_TOTAL_PAGES) {
    addError(
      "PAGE_COUNT",
      null,
      ".ref-sheet",
      `应为 ${REFERENCE_TOTAL_PAGES} 页，实际 ${sheets.length} 页`,
    );
  }

  const pageNumbers = sheets.map((sheet, index) => {
    const page = Number(sheet?.dataset?.page);
    return Number.isInteger(page) ? page : index + 1;
  });
  const expectedPageNumbers = Array.from({ length: REFERENCE_TOTAL_PAGES }, (_, index) => index + 1);
  if (pageNumbers.length === REFERENCE_TOTAL_PAGES &&
    pageNumbers.some((page, index) => page !== expectedPageNumbers[index])) {
    addError(
      "PAGE_SEQUENCE",
      null,
      ".ref-sheet[data-page]",
      "页码必须从 1 到 332 唯一、连续且按顺序排列",
    );
  }

  sheets.forEach((sheet, sheetIndex) => {
    const page = pageNumbers[sheetIndex];
    const sections = allMatches(sheet, ".ref-artifacts > section");
    if (sections.length > 3) {
      addError(
        "ARTIFACT_LIMIT",
        page,
        ".ref-artifacts > section",
        `单页最多允许 3 个内容块，实际 ${sections.length} 个`,
      );
    }
    const expectedRequiredBlocks = Number(sheet?.dataset?.requiredBlocks || 0);
    if (expectedRequiredBlocks > 0) {
      const requiredNodes = allMatches(sheet, '[data-contract-required="true"]');
      const requiredIds = requiredNodes.map((node) => String(node?.dataset?.contractId || "")).filter(Boolean);
      if (requiredNodes.length !== expectedRequiredBlocks) {
        addError(
          "CONTRACT_BLOCK_COUNT",
          page,
          '[data-contract-required="true"]',
          `逐页合同要求 ${expectedRequiredBlocks} 个必备内容块，实际 ${requiredNodes.length} 个`,
        );
      }
      if (requiredIds.length !== requiredNodes.length || new Set(requiredIds).size !== requiredIds.length) {
        addError(
          "CONTRACT_BLOCK_ID",
          page,
          "[data-contract-id]",
          "必备内容块必须具有唯一的逐页合同 ID",
        );
      }
      requiredNodes.forEach((node) => {
        const visual = String(node?.dataset?.contractVisual || "");
        const artifactKind = String(node?.dataset?.artifactKind || "");
        if (visual && artifactKind && !visualAllowsNarrativeOnly(visual) && ["text", "callout"].includes(artifactKind)) {
          addError(
            "DATA_VISUAL_WITH_TEXT_ONLY",
            page,
            `[data-contract-id="${node?.dataset?.contractId || ""}"]`,
            `富视觉合同 ${visual} 不能只由 ${artifactKind} 文本占位`,
          );
        }
      });
    }

    const visibleText = String(sheet?.textContent || "");
    const invalidToken = visibleText.match(/\bundefined\b|\bNaN\b|\[object Object\]/i)?.[0];
    if (invalidToken) {
      addError(
        "INVALID_TEXT",
        page,
        ".ref-sheet",
        `出现非法可见文本：${invalidToken}`,
      );
    }
    const fillerSignature = REFERENCE_PREFLIGHT_FILLER_SIGNATURES.find((signature) => visibleText.includes(signature));
    if (fillerSignature) {
      addError(
        "GENERIC_FILLER",
        page,
        ".ref-sheet",
        `检测到通用占位内容：${fillerSignature}`,
      );
    }

    allMatches(sheet, "img").forEach((img) => {
      if (!Number(img?.naturalWidth) || !Number(img?.naturalHeight)) {
        addError(
          "BROKEN_IMAGE",
          page,
          "img",
          `图片未成功加载：${img?.currentSrc || img?.src || "空地址"}`,
        );
      }
    });

    const sheetRect = measuredRect(sheet);
    const candidates = [{ node: sheet, selector: ".ref-sheet" }];
    REFERENCE_PREFLIGHT_CONTAINERS.forEach((selector) => {
      allMatches(sheet, selector).forEach((node) => candidates.push({ node, selector }));
    });
    const visited = new Set();
    const layoutViolations = [];
    candidates.forEach(({ node, selector }) => {
      if (!node || visited.has(node)) return;
      visited.add(node);
      const rect = measuredRect(node);
      if (!hasArea(node, rect)) return;
      const clientHeight = Number(node.clientHeight || rect?.height || 0);
      const clientWidth = Number(node.clientWidth || rect?.width || 0);
      const scrollHeight = Number(node.scrollHeight || 0);
      const scrollWidth = Number(node.scrollWidth || 0);
      const verticalOverflow = clientHeight > 0 && scrollHeight > clientHeight + tolerance;
      const horizontalOverflow = clientWidth > 0 && scrollWidth > clientWidth + tolerance;
      if (verticalOverflow) layoutViolations.push({
        code: "CONTAINER_OVERFLOW",
        page,
        selector,
        node,
        axis: "vertical",
        overflow: scrollHeight - clientHeight,
        clientSize: clientHeight,
        scrollSize: scrollHeight,
      });
      if (horizontalOverflow) layoutViolations.push({
        code: "CONTAINER_OVERFLOW",
        page,
        selector,
        node,
        axis: "horizontal",
        overflow: scrollWidth - clientWidth,
        clientSize: clientWidth,
        scrollSize: scrollWidth,
      });
      const sheetOutside = node !== sheet && rect && sheetRect && hasArea(sheet, sheetRect)
        ? outsideAmounts(rect, sheetRect)
        : { horizontal: 0, vertical: 0 };
      const parentRect = node !== sheet ? measuredRect(node.parentElement) : null;
      const parentOutside = rect && parentRect && hasArea(node.parentElement, parentRect)
        ? outsideAmounts(rect, parentRect)
        : { horizontal: 0, vertical: 0 };
      for (const axis of ["vertical", "horizontal"]) {
        if (sheetOutside[axis] > tolerance) layoutViolations.push({
          code: "OUTSIDE_SHEET",
          page,
          selector,
          node,
          axis,
          overflow: sheetOutside[axis],
        });
        if (parentOutside[axis] > tolerance) layoutViolations.push({
          code: "OUTSIDE_PARENT",
          page,
          selector,
          node,
          axis,
          overflow: parentOutside[axis],
        });
      }
    });
    rootLayoutViolations(layoutViolations).forEach((violation) => {
      const axisLabel = violation.axis === "vertical" ? "纵向" : "横向";
      const overflow = roundedPixels(violation.overflow);
      if (violation.code === "CONTAINER_OVERFLOW") {
        const scrollLabel = violation.axis === "vertical" ? "scrollHeight/clientHeight" : "scrollWidth/clientWidth";
        addError(
          violation.code,
          page,
          violation.selector,
          `${axisLabel}内容溢出容器 ${overflow}px（${scrollLabel}: ${roundedPixels(violation.scrollSize)}/${roundedPixels(violation.clientSize)}）`,
          {
            axis: violation.axis,
            overflow,
            scrollSize: roundedPixels(violation.scrollSize),
            clientSize: roundedPixels(violation.clientSize),
          },
        );
        return;
      }
      addError(
        violation.code,
        page,
        violation.selector,
        `${axisLabel}内容边界超出${violation.code === "OUTSIDE_PARENT" ? "直接父容器" : "纸张范围"} ${overflow}px`,
        { axis: violation.axis, overflow },
      );
    });
  });

  return {
    ok: errors.length === 0,
    sheetCount: sheets.length,
    errors,
  };
}

async function prepareAndPrint(onComplete = () => {}) {
  document.body.dataset.printMode = "reference";
  document.body.dataset.printPreparing = "true";
  let cleanupTimer;
  let finished = false;
  const clear = () => {
    if (finished) return;
    finished = true;
    delete document.body.dataset.printMode;
    delete document.body.dataset.printPreparing;
    window.removeEventListener("afterprint", clear);
    if (cleanupTimer) clearTimeout(cleanupTimer);
    onComplete();
  };
  window.addEventListener("afterprint", clear);
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const images = [...document.querySelectorAll(".ref-sheet img")];
    await Promise.all(images.map((img) => {
      if (img.complete) return Promise.resolve();
      const load = typeof img.decode === "function"
        ? img.decode().catch(() => {})
        : new Promise((resolve) => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true }); });
      return Promise.race([load, new Promise((resolve) => setTimeout(resolve, 15000))]);
    }));
    await waitFrame();
    const diagnostics = inspectReferenceDeck(document);
    if (!diagnostics.ok) {
      console.error("[Metis] Reference report export preflight failed", JSON.stringify(diagnostics));
      const badPages = [...new Set(diagnostics.errors.map((error) => error.page).filter(Number.isFinite))];
      const pageSummary = badPages.length ? `（页码：${badPages.slice(0, 8).join("、")}${badPages.length > 8 ? "…" : ""}）` : "";
      throw new Error(`导出预检失败：发现 ${diagnostics.errors.length} 个问题${pageSummary}。${diagnostics.errors[0]?.message || "请检查报告页面"}`);
    }
    delete document.body.dataset.printPreparing;
    await waitFrame();
    window.print();
  } catch (error) {
    clear();
    alert(error.message || "打印预检失败");
    return false;
  }
  if (!finished) cleanupTimer = setTimeout(clear, 60000);
  return true;
}

export function ReferenceReportDeck({ report, run, api, canUseOfficialExports = false }) {
  const pages = useMemo(() => compileReferencePages(report), [report]);
  const decision = reportDecision(report, run);
  const [current, setCurrent] = useState(1);
  const [readingMode, setReadingMode] = useState("curated");
  const [viewMode, setViewMode] = useState("reader");
  const [renderAllPages, setRenderAllPages] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [pageInput, setPageInput] = useState("1");
  const viewportRef = useRef(null);
  const mobileReaderRef = useRef(null);
  const navRef = useRef(null);
  const focusReaderOnChangeRef = useRef(false);
  const selectPage = (page) => {
    focusReaderOnChangeRef.current = true;
    setCurrent(page);
  };
  const goPage = (delta) => {
    focusReaderOnChangeRef.current = true;
    setCurrent((value) => readingMode === "curated"
      ? stepCuratedReferencePage(value, delta)
      : stepReferencePage(value, delta));
  };
  const handleReaderKeyDown = (event) => {
    const target = event.target;
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (document.querySelector?.('[aria-modal="true"]')) return;
    if (target?.closest?.("input,textarea,select,button,a,[contenteditable='true']")) return;
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    goPage(delta);
  };
  const exportReference = useCallback(async (skipServerValidation = false) => {
    if (!canUseOfficialExports) {
      alert("正式导出已锁定：关键证据尚未通过验证或报告仍未达到可审阅状态。");
      return;
    }
    if (printing) return;
    if (!skipServerValidation) {
      try {
        if (typeof api !== "function") throw new Error("打印校验服务不可用");
        const proof = await createExportProof(decision.review.reviewed ? "signed" : "review", report);
        const check = await api(`/runs/${run.id}/export-check?${proof.query}`);
        verifyExportCheck(check, proof);
      } catch (error) {
        alert(error.message || "打印前完整性校验失败");
        return;
      }
    }
    setPrinting(true);
    setRenderAllPages(true);
    await waitFrame();
    await waitFrame();
    await prepareAndPrint(() => {
      setRenderAllPages(false);
      setPrinting(false);
    });
  }, [api, canUseOfficialExports, decision.review.reviewed, printing, report, run.id]);
  useEffect(() => {
    window.metisPrintReference = exportReference;
    return () => { delete window.metisPrintReference; };
  }, [exportReference]);
  useEffect(() => { setPageInput(String(current)); }, [current]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (typeof viewport.scrollTo === "function") viewport.scrollTo({ top: 0, left: 0, behavior: "auto" });
    else { viewport.scrollTop = 0; viewport.scrollLeft = 0; }
  }, [current]);
  useEffect(() => {
    const compact = window.matchMedia?.("(max-width: 760px)").matches;
    const reflowed = window.matchMedia?.("(max-width: 1024px)").matches || viewMode === "reader";
    if (!reflowed || (compact && !mobileDetailsOpen)) return;
    if (!focusReaderOnChangeRef.current && !document.activeElement?.closest?.(".reference-report-root")) return;
    focusReaderOnChangeRef.current = false;
    const frame = requestAnimationFrame(() => {
      mobileReaderRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      mobileReaderRef.current?.focus?.({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [current, mobileDetailsOpen, viewMode]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => navRef.current?.querySelector?.('button[aria-current="page"]')?.scrollIntoView?.({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [current, readingMode]);
  if (!hasContinuousReferencePageSequence(pages)) {
    return html`<div class="ref-contract-error" role="alert" aria-live="assertive"><b>报告页面合同未通过</b><p>需要 62 个原始模块，并按 1–332 页唯一、连续编译；当前生成 ${pages.length} 页。请重新加载，若仍失败请返回研究档案重新生成报告。</p><button class="btn ghost" onClick=${() => window.location.reload()}>重新加载报告</button></div>`;
  }
  const activePage = pages[current - 1];
  const activeModule = activePage?.moduleIndex ?? -1;
  const curatedIndex = BOARD_READING_PAGES.indexOf(current);
  const previousTarget = readingMode === "curated" ? stepCuratedReferencePage(current, -1) : stepReferencePage(current, -1);
  const nextTarget = readingMode === "curated" ? stepCuratedReferencePage(current, 1) : stepReferencePage(current, 1);
  const switchMode = (mode) => {
    focusReaderOnChangeRef.current = true;
    setReadingMode(mode);
    if (mode === "curated" && !BOARD_READING_PAGES.includes(current)) setCurrent(BOARD_READING_PAGES[0]);
  };
  const commitPageInput = (candidate = pageInput) => {
    const raw = String(candidate).trim();
    if (!/^\d+$/.test(raw)) { setPageInput(String(current)); return; }
    const next = stepReferencePage(Number(raw), 0);
    focusReaderOnChangeRef.current = true;
    setCurrent(next);
    setPageInput(String(next));
  };
  const executive = report.modules?.exec_summary_decision_scorecard || {};
  const kpis = executive.kpi_tiles || [];
  const concept = report.modules?.board_concept || report.modules?.pd_concept_matrix?.product_concept || {};
  return html`<div class="reference-report-root">
    <section class="ref-mobile-summary">
      <span class="ref-mobile-kicker">BOARD DECISION BRIEF</span>
      <h2>${report.category}</h2>
      <div class=${"ref-mobile-verdict " + (decision.review.reviewed ? "signed" : "pending")}><span>${decision.label}</span><b>${decision.status}</b><p>${decision.verdict}</p>${decision.review.reviewed ? html`<small>${decision.review.reviewer} · ${decision.review.reviewedAt}</small>` : ""}</div>
      <div class="ref-mobile-kpis">${kpis.map(item => html`<div><span>${item.label}</span><b>${item.value}${item.unit || ""}</b><small>${item.sub || ""}</small></div>`)}</div>
      ${decision.conditions.length ? html`<div class="ref-mobile-gates"><h3>放行条件</h3>${decision.conditions.map(item => html`<p>${item}</p>`)}</div>` : ""}
      ${concept.title || concept.image_url ? html`<div class="ref-mobile-concept">${concept.image_url ? html`<img src=${concept.image_url} alt=${concept.title || "推荐产品概念"}/>` : ""}<div><span>AIGC CONCEPT</span><h3>${concept.title || "推荐产品概念"}</h3><p>${concept.thesis || "概念图仅用于方向评审，最终以工程、成本、合规与人工签样为准。"}</p></div></div>` : ""}
      <div class="ref-mobile-note">窄屏建议先阅读摘要与 ${BOARD_READING_PAGES.length} 个精选页；需要逐页核查时，可切换到 332 页完整报告。</div>
      <button class="ref-mobile-open" aria-expanded=${mobileDetailsOpen} aria-controls="reference-page-reader" onClick=${() => { if (!mobileDetailsOpen) focusReaderOnChangeRef.current = true; setMobileDetailsOpen((value) => !value); }}>${mobileDetailsOpen ? "收起逐页报告" : "查看逐页报告"}</button>
    </section>
    <div id="reference-page-reader" class=${"ref-deck reading-" + readingMode + " view-" + viewMode + (mobileDetailsOpen ? " mobile-open" : "")}>
    <aside class="ref-deck-nav" ref=${navRef} aria-label=${readingMode === "curated" ? "精选页目录" : "完整研究报告目录"}><div class="ref-nav-title"><span>${readingMode === "curated" ? "精选页阅读" : "完整研究报告"}</span><b>${readingMode === "curated" ? `${BOARD_READING_PAGES.length} 个精选页 · 保留原页码` : "332 页 · A4 横向"}</b>
      <div class="ref-reading-mode"><button class=${readingMode === "curated" ? "on" : ""} aria-pressed=${readingMode === "curated"} onClick=${() => switchMode("curated")}>精选页</button><button class=${readingMode === "full" ? "on" : ""} aria-pressed=${readingMode === "full"} onClick=${() => switchMode("full")}>完整报告</button></div></div>
      ${readingMode === "curated" ? html`<div class="ref-nav-scroll ref-board-nav">${BOARD_READING_PAGES.map((pageNumber, index) => {
        const item = pages[pageNumber - 1];
        const label = item.topic || item.moduleTitle || report.category;
        return html`<button key=${pageNumber} class=${current === pageNumber ? "on" : ""} title=${label} aria-label=${`精选第 ${index + 1} / ${BOARD_READING_PAGES.length}，原报告第 ${pageNumber} 页：${label}`} aria-current=${current === pageNumber ? "page" : undefined} onClick=${() => selectPage(pageNumber)}><span>${String(index + 1).padStart(2, "0")}</span><b>${label}</b><em>原 ${pageNumber}</em></button>`;
      })}</div>` : html`<button class=${current <= 6 ? "on" : ""} aria-label="跳转至原报告第 1 页：封面与目录" aria-current=${current <= 6 ? "page" : undefined} onClick=${() => selectPage(1)}><span>00</span><b>封面与目录</b><em>1–6</em></button>
      <div class="ref-nav-scroll">${report.order.map((id, index) => {
        const start = REFERENCE_MODULE_STARTS[index];
        const end = (REFERENCE_MODULE_STARTS[index + 1] || 333) - 1;
        const label = moduleTitle(report, id, index);
        return html`<button key=${id} class=${activeModule === index ? "on" : ""} title=${label} aria-label=${`跳转至原报告第 ${start} 页：${label}`} aria-current=${activeModule === index ? "page" : undefined} onClick=${() => selectPage(start)}>
          <span>${String(index + 1).padStart(2, "0")}</span><b>${label}</b><em>${start === end ? start : `${start}–${end}`}</em></button>`;
      })}</div>`}</aside>
    <section class="ref-deck-stage"><p class="sr-only" role="status" aria-live="polite" aria-atomic="true">${readingMode === "curated" ? `已打开精选第 ${curatedIndex + 1} / ${BOARD_READING_PAGES.length}，原报告第 ${current} / ${REFERENCE_TOTAL_PAGES} 页` : `已打开完整报告第 ${current} / ${REFERENCE_TOTAL_PAGES} 页`}：${activePage.topic || report.category}</p><header class="ref-deck-toolbar"><div><span>${activePage.kind === "module" ? `${String(activePage.moduleNumber).padStart(2, "0")} · ${activePage.moduleTitle}` : activePage.kind === "toc" ? "目录" : "封面"}</span><b>${activePage.topic || report.category}</b></div>
      <nav aria-label="报告分页"><button title=${readingMode === "curated" ? `上一个精选页，原第 ${previousTarget} 页` : `上一页，第 ${previousTarget} 页`} aria-label=${readingMode === "curated" ? `上一个精选页：原报告第 ${previousTarget} 页` : `上一页：第 ${previousTarget} 页`} aria-keyshortcuts="ArrowLeft" disabled=${readingMode === "curated" ? curatedIndex <= 0 : current <= 1} onClick=${() => goPage(-1)}>‹</button>
        ${readingMode === "curated" ? html`<output class="ref-page-position" aria-label=${`精选第 ${curatedIndex + 1} / ${BOARD_READING_PAGES.length}；原报告第 ${current} / ${REFERENCE_TOTAL_PAGES} 页`}><b>精选 ${curatedIndex + 1} / ${BOARD_READING_PAGES.length}</b><span>原第 ${current} / ${REFERENCE_TOTAL_PAGES} 页</span></output>` : html`<label>第 <input type="number" inputMode="numeric" min="1" max=${REFERENCE_TOTAL_PAGES} value=${pageInput} aria-label="跳转到报告页码" onInput=${event=>setPageInput(event.currentTarget.value)} onBlur=${event=>commitPageInput(event.currentTarget.value)} onKeyDown=${event=>{if(event.key==="Enter"){event.preventDefault();commitPageInput(event.currentTarget.value);event.currentTarget.blur();}else if(event.key==="Escape"){event.preventDefault();setPageInput(String(current));}}}/> / ${REFERENCE_TOTAL_PAGES} 页</label>`}
        <button title=${readingMode === "curated" ? `下一个精选页，原第 ${nextTarget} 页` : `下一页，第 ${nextTarget} 页`} aria-label=${readingMode === "curated" ? `下一个精选页：原报告第 ${nextTarget} 页` : `下一页：第 ${nextTarget} 页`} aria-keyshortcuts="ArrowRight" disabled=${readingMode === "curated" ? curatedIndex >= BOARD_READING_PAGES.length - 1 : current >= REFERENCE_TOTAL_PAGES} onClick=${() => goPage(1)}>›</button>
        <button class="ref-mode-toggle" aria-pressed=${readingMode === "full"} onClick=${() => switchMode(readingMode === "curated" ? "full" : "curated")}>${readingMode === "curated" ? "查看完整报告" : "查看精选页"}</button><div class="ref-view-switch" role="group" aria-label="报告显示方式"><button class=${viewMode === "reader" ? "on" : ""} aria-pressed=${viewMode === "reader"} onClick=${() => { focusReaderOnChangeRef.current = true; setViewMode("reader"); }}>阅读</button><button class=${viewMode === "layout" ? "on" : ""} aria-pressed=${viewMode === "layout"} onClick=${() => setViewMode("layout")}>版式预览</button></div></nav></header>
      <div class="ref-mobile-reader-bar"><div class="ref-mobile-mode"><button class=${readingMode === "curated" ? "on" : ""} aria-pressed=${readingMode === "curated"} onClick=${() => switchMode("curated")}>精选阅读</button><button class=${readingMode === "full" ? "on" : ""} aria-pressed=${readingMode === "full"} onClick=${() => switchMode("full")}>完整报告</button></div><span>结构化阅读版 · 内容自动换行 · 数据完整展示</span></div>
      <div class="ref-mobile-page-reader" ref=${mobileReaderRef} role="region" tabindex="-1" aria-label=${`报告原第 ${current} 页结构化阅读版`} onKeyDown=${handleReaderKeyDown}><${MobileReferencePage} report=${report} run=${run} page=${activePage}/><nav class="ref-mobile-page-nav" aria-label="结构化阅读版分页"><button aria-label=${readingMode === "curated" ? `上一个精选页：原报告第 ${previousTarget} 页` : `上一页：第 ${previousTarget} 页`} disabled=${readingMode === "curated" ? curatedIndex <= 0 : current <= 1} onClick=${() => goPage(-1)}><span aria-hidden="true">‹</span><b>${readingMode === "curated" ? "上一个精选" : "上一页"}</b></button><output>${readingMode === "curated" ? `精选 ${curatedIndex + 1} / ${BOARD_READING_PAGES.length} · ` : ""}原第 ${current} / ${REFERENCE_TOTAL_PAGES} 页</output><button aria-label=${readingMode === "curated" ? `下一个精选页：原报告第 ${nextTarget} 页` : `下一页：第 ${nextTarget} 页`} disabled=${readingMode === "curated" ? curatedIndex >= BOARD_READING_PAGES.length - 1 : current >= REFERENCE_TOTAL_PAGES} onClick=${() => goPage(1)}><b>${readingMode === "curated" ? "下一个精选" : "下一页"}</b><span aria-hidden="true">›</span></button></nav></div>
      <div class="ref-page-viewport" ref=${viewportRef} role="region" tabindex="0" aria-label=${`报告第 ${current} 页版式预览区，聚焦后可用左右方向键翻页`} onKeyDown=${handleReaderKeyDown}><div class="ref-page-stack">${pages.filter((page) => renderAllPages || Math.abs(page.number - current) <= 1).map((page) => html`<${Sheet} key=${page.number} report=${report} run=${run} page=${page} active=${page.number === current}/>`)} </div></div>
    </section>
  </div></div>`;
}

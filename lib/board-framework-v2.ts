/* eslint-disable @typescript-eslint/no-explicit-any */
import extMetaRaw from "@/data/ext_meta.json";

type JsonObject = Record<string, any>;

export const PDF_DEEP_MODULE_ORDER = [
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
] as const;

const CATEGORY_PORTFOLIO = [
  ["Nightstands", 76, "B+", "中", "小件成套；充电与抽屉体验"],
  ["Sideboard", 83, "A-", "中高", "大件履约与补件优势最明显"],
  ["Drawer cabinet", 68, "B", "中", "导轨、内尺寸与锁轮需先验证"],
  ["Coffee bar counter", 79, "B+", "中高", "专用工作流可脱离普通柜同质化"],
  ["Slatted platform bed", 85, "A", "高", "长件物流、异响与部件级补发构成壁垒"],
];

const asRows = (value: unknown): any[][] => Array.isArray((value as JsonObject)?.rows)
  ? (value as JsonObject).rows
  : [];

const table = (columns: string[], rows: any[][], note?: string) => ({ columns, rows, ...(note ? { note } : {}) });

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function categoryName(config: JsonObject): string {
  return String(config.category || "").split("｜")[0] || String(config.slug || "目标品类");
}

function context(config: JsonObject, voc: JsonObject) {
  const costRows = asRows(config.finance?.cost_waterfall);
  const targetPrice = num(costRows.find((row) => String(row?.[0]).includes("目标零售价"))?.[1])
    || num(costRows[0]?.[1]);
  const contribution = num(costRows.find((row) => String(row?.[0]).includes("贡献利润"))?.[1])
    || num(costRows[costRows.length - 1]?.[1]);
  const margin = targetPrice > 0 ? Number((contribution / targetPrice * 100).toFixed(1)) : 0;
  const evidenceRows = asRows(voc.evidence_log);
  const sourceRows = asRows(voc.source_coverage);
  const themes = asRows(voc.theme_distribution);
  const negative = evidenceRows.filter((row) => row?.[4] === "负向");
  const positive = evidenceRows.filter((row) => row?.[4] === "正向");
  const product = config.product || {};
  const concept = config.concept || {};
  const topTheme = themes[0]?.[0] || "结构、装配与使用体验";
  const secondTheme = themes[1]?.[0] || "尺寸与场景适配";
  const kill = (config.gates || [])[0] || "任一硬闸门失败则停止放量";
  const priceBand = `$${Math.round(targetPrice * 0.9)}–$${Math.round(targetPrice * 1.1)}`;
  return {
    name: categoryName(config),
    slug: config.slug,
    score: num(config.score),
    grade: config.grade,
    verdict: config.verdict,
    oneLiner: config.one_liner,
    price: targetPrice,
    priceBand,
    contribution,
    margin,
    costRows,
    evidenceRows,
    sourceRows,
    themes,
    negative,
    positive,
    product,
    concept,
    topTheme,
    secondTheme,
    kill,
    sources: config.sources || [],
    gates: config.gates || [],
    actions: config.actions || [],
    decisions: config.decisions || [],
    finance: config.finance || {},
    raw: config.raw || {},
    logistics: config.logistics || {},
    compliance: config.compliance || {},
  };
}

function status(body: string, tag = "EVIDENCE-GATED") {
  return { title: "本模块结论", tag, body };
}

function evidenceSlice(c: ReturnType<typeof context>, offset = 0, count = 5) {
  const rows = c.evidenceRows.slice(offset, offset + count);
  return table(
    ["证据编号", "渠道", "样本", "极性", "主题", "消费者信号（转述）", "产品动作", "证据锚点/限制", "来源"],
    rows.map((row) => [row[0], row[1], row[2], row[4], row[5], row[6], row[7], row[8], row[9]]),
    "这些是可回溯的编码观察，不是评论发生率或市场份额。",
  );
}

function validationTable(c: ReturnType<typeof context>, focus: string) {
  const rows = asRows(c.product.validation).slice(0, 4);
  return table(
    ["验证对象", "放行线", "样本/方法", "与本模块关系"],
    rows.map((row) => [row[0], row[1], row[2], focus]),
    `硬停止线：${c.kill}`,
  );
}

function hypothesisModule(
  c: ReturnType<typeof context>,
  answer: string,
  decisionRows: any[][],
  focus: string,
  evidenceOffset = 0,
): JsonObject {
  return {
    evidence_state: status(answer),
    decision_model: table(["决策项", "当前判断", "证据状态", "下一步"], decisionRows),
    traceable_evidence: evidenceSlice(c, evidenceOffset),
    validation_and_kill_criteria: validationTable(c, focus),
  };
}

function specialModules(c: ReturnType<typeof context>, strategy: JsonObject = {}): JsonObject {
  const costScenario = (priceFactor: number, costFactor: number, label: string) => {
    const price = Number((c.price * priceFactor).toFixed(0));
    const cost = Number(((c.price - c.contribution) * costFactor).toFixed(1));
    const contribution = Number((price - cost).toFixed(1));
    return [label, `$${price}`, `$${cost}`, `$${contribution}`, `${price ? (contribution / price * 100).toFixed(1) : 0}%`, "管理层情景，不是预测"];
  };
  const must = c.product.must_have || [];
  const should = c.product.should_have || [];
  const mustNot = c.product.must_not || [];
  const conceptTitle = c.concept.title || `${c.name} 推荐概念`;
  const existingPortfolioMatch = CATEGORY_PORTFOLIO.some((row) =>
    String(row[0]).toLowerCase().replace(/\s/g, "-").includes(String(c.slug).replace(/s$/, ""))
  );
  const portfolioBaseRows = existingPortfolioMatch
    ? CATEGORY_PORTFOLIO
    : [[c.name, "PENDING", "PENDING", "PENDING", "当前只有本品类方向性证据；不复制其他品类评分"]];
  const portfolioRows = portfolioBaseRows.map((row) => [
    ...row,
    String(row[0]).toLowerCase().replace(/\s/g, "-").includes(String(c.slug).replace(/s$/, "")) ? "本报告" : "组合参照",
  ]);

  return {
    crossborder_seller_cockpit: {
      evidence_state: status(`演示能力假设：若使用者具备品牌经营与物流管理能力，可评估 ${c.name} 的包装、补件与交付机会。公司规模、实际能力和竞争优势均须由使用者提供证据。`, "ASSUMPTION"),
      seller_fit_scorecard: table(["能力", "本项目用途", "当前判断", "必须兑现的 KPI"], [
        ["品牌与内容", "建立系列化外观和溢价", "假设；待验证", "同系列识别度、页面证据一致"],
        ["物流管理能力", "妥投、破损闭环、部件补发", "假设；待验证", "破损/错箱/补件红线"],
        ["研发与供应链", "DFM、五金和包装联调", "待项目验证", "两家工厂报价 + EVT/DVT"],
        ["数据能力", "真实销量、广告、退货闭环", "尚未接入报告", "接入 SP-API/广告/售后实账"],
      ]),
      weekly_cockpit: table(["周度指标", "立项期", "试销期", "硬动作"], [
        ["证据覆盖", "来源可追溯率 100%", "新增 VOC 周更", "断链或口径变化即复核"],
        ["贡献利润", `${c.margin}%（立项假设）`, "用真实结算重算", "低于 12% 停止放量"],
        ["破损/补件", "包装测试通过", "按订单监控", "超红线立即 CAPA"],
        ["活动件投诉", "循环测试通过", "按主题编码", "连续两周上升即冻结补货"],
      ]),
    },
    supply_chain_sourcing: {
      evidence_state: status(`${c.name} 的寻源不应只比 FOB；应把门抽动作、结构公差、包装体积、补件粒度与出厂测试共同写进 RFQ。`),
      rfq_package: table(["RFQ 包", "供应商必须返回", "放行方式"], [
        ["结构/BOM", must.slice(0, 4).join("；"), "关键材料与五金不得模糊替代"],
        ["成本", `目标出厂成本见财务瀑布；目标售价 ${c.priceBand}`, "FOB、包装、模具、备件拆分报价"],
        ["质量", asRows(c.product.validation).map((r) => r[0]).join("；"), "EVT/DVT/PVT 分阶段签样"],
        ["交付", c.logistics.packaging_plan?.join("；") || "包装与补件方案", "整机、模块、易损件分别编码"],
      ]),
      supplier_scorecard: table(["维度", "权重", "一票否决"], [
        ["工程/公差能力", "25%", "不能提供量检具与关键尺寸控制计划"],
        ["质量体系", "25%", "不接受出货前活动件与包装抽检"],
        ["总到岸成本", "20%", "只报 FOB、不披露包装参数"],
        ["交期与备件", "15%", "无法承诺备件批次追溯"],
        ["合规文件", "15%", "板材/电气/结构文件不可追溯"],
      ]),
    },
    ip_compliance: {
      evidence_state: status("当前报告完成的是风险筛查，不是 FTO 法律意见。造型、结构、商标、图片和功能文案必须在最终 CAD/Listing 冻结后做美国专业检索。", "LEGAL-GATE"),
      compliance_matrix: table(["主题", "当前状态", "上市前证据", "Owner"], [
        ...(c.compliance.items || []).map((row: any[]) => [row[0], `风险 ${row[1]}`, row[2], "法规/质量"]),
        ["外观/结构专利 FTO", "未完成", "关键词 + CPC/Locarno + 竞品权利人检索，律师终审", "法务"],
        ["商标/图片/文案", "未完成", "品牌检索、图片授权、声明清单", "法务/内容"],
      ]),
      no_claim_zone: ["未经验证的承重、寿命或安全数字", "未经证据支持的市场第一/销量冠军", "把 AIGC 概念图当作实物图", "用竞品商标做显著对比引流"],
    },
    ppc_traffic_deep_dive: hypothesisModule(c,
      `广告模块先定义可验证的搜索意图与止损线；未接入 Amazon Brand Analytics、Search Query Performance 和广告实账，因此不伪造搜索量、CPC 或转化率。`,
      [
        ["核心品类词", c.name, "词义明确；量级待接入", "建立 exact 探索组"],
        ["问题词", `${c.topTheme} / ${c.secondTheme}`, "来自 VOC 编码", "转成卖点词与否定词"],
        ["竞品词", "只做合规的类目与属性承接", "待品牌/商标审核", "小预算验证"],
        ["止损", "贡献利润覆盖获客成本", `当前贡献利润 $${c.contribution}/件（假设）`, "以真实结算更新 break-even ACOS"],
      ], "广告实账与自然位联动"),
    ab_listing_simulator: {
      evidence_state: status("不在没有流量样本时输出虚假的转化提升。先把 VOC 问题转成可证伪的主图/标题假设，再用真实流量做顺序检验。", "EXPERIMENT"),
      experiment_backlog: table(["优先级", "变量", "A", "B", "主指标", "护栏"], [
        ["P0", "首屏价值主张", "品类通用", conceptTitle, "CTR / CVR", "退货理由不恶化"],
        ["P0", "结构证据", "外观图", `展示 ${must.slice(0, 2).join(" + ")}`, "CVR", "与量产签样一致"],
        ["P1", "尺寸表达", "参数表", "场景兼容 + 净尺寸", "尺寸型退货", "不夸大空间"],
        ["P1", "物流承诺", "不强调", "补件/包装验证", "客服咨询/差评", "只承诺可兑现 SLA"],
      ]),
      test_protocol: table(["规则", "要求"], [["单变量", "每轮只改一个主变量"], ["样本", "先设最小可检测效应和样本量"], ["停表", "不得因短期领先提前宣布胜出"], ["复验", "胜出版本在第二时段复验"]]),
    },
    synthetic_concept_test: {
      evidence_state: status("AIGC/合成受访者只用于发现问题和改写研究问卷，不能作为购买意愿证据。最终概念选择必须由真实目标用户与真实价格测试决定。", "SIMULATION-ONLY"),
      real_user_protocol: table(["环节", "样本", "任务", "输出"], [
        ["定性", "12–15 名目标用户", "对 3 个概念做任务访谈", "语言、疑虑、不可妥协项"],
        ["定量", "n≥150（按效应重算）", "随机曝光概念与价格", "偏好、购买意向、价格敏感"],
        ["实物", "8–12 户", "开箱、装配、连续使用", "行为问题与真实故障"],
        ["试销", "小批量", "真实页面与履约", "CVR、退货、客服主题"],
      ]),
      interview_prompts: [
        `看到 ${conceptTitle} 的第一反应是什么？`,
        `你会把它放在哪里、与什么一起使用？`,
        `哪些细节让你相信或不相信 $${c.price} 的价格？`,
        `如果只能保留三项功能，你会保留什么？`,
      ],
    },
    pricing_science: {
      evidence_state: status(`$${c.price} 是立项锚点，不是已验证的最优价格。公开样本证明价格带存在，但真实弹性需通过 Amazon 价格实验或分时试销估计。`),
      price_ladder: table(["角色", "价格", "产品边界", "验证问题"], [
        ["防守款", `$${Math.round(c.price * 0.85)}`, "不牺牲结构/合规；只删低使用率选配", "是否扩大流量却吞噬贡献利润"],
        ["主推款", `$${c.price}`, must.slice(0, 5).join("；"), "是否支撑品牌转化与 12%+ 贡献"],
        ["升级款", `$${Math.round(c.price * 1.18)}`, should.slice(0, 4).join("；"), "材料/服务溢价是否被感知"],
      ]),
      guardrail: `促销不得长期把主推款打到 $${Math.round(c.price * 0.82)} 以下；每次变价都同时看 CVR、贡献利润、退货与广告结构。`,
    },
    persona_journey: hypothesisModule(c,
      `${c.name} 的决策旅程由“场景是否放得下—外观是否匹配—装配/耐久是否可信—送达是否可控”串联，不能只用人口属性做人群。`,
      [
        ["空间效率型", "尺寸/兼容/收纳", "净尺寸与装载示例", "降低尺寸型退货"],
        ["质感升级型", "材质/比例/系列感", "触达面材料与细节特写", "支撑中高价"],
        ["低摩擦型", "装配/补件/履约", "步骤、时长、SLA", "降低购买风险"],
        ["功能任务型", c.topTheme, must.slice(0, 3).join("；"), "证明任务完成度"],
      ], "真实用户访谈与页面行为", 3),
    trend_forecast: {
      evidence_state: status("当前数据只支持方向性信号，不支持伪造 5 年 CAGR 或季节曲线。趋势模块把公开时间点、搜索数据接入需求和触发阈值写清楚。", "DATA-PENDING"),
      signal_board: table(["信号", "当前观察", "置信度", "补数"], [
        ["设计语言", "虚构设计练习使用自然木纹、纵向节奏与圆弧边界；并非市场趋势证据", "未验证假设", "按月跟踪获授权的新品与竞品资料"],
        ["功能需求", c.topTheme, "Medium", "滚动 VOC 编码"],
        ["价格/促销", c.priceBand, "Low–Medium", "Keepa/自有成交价"],
        ["季节性", "未接入", "Unknown", "Google Trends + 销售周数据"],
      ]),
      trigger_rules: table(["触发", "动作"], [["目标价格带连续 8 周降价", "重算利润与差异化"], ["同类新品集中复制核心功能", "加快系列化或延迟投入"], ["主题差评占比连续上升", "启动设计 CAPA"]]),
    },
    omnichannel_strategy: hypothesisModule(c,
      `Amazon 用于搜索转化，Walmart/Wayfair 用于扩宽场景与价格覆盖，自有站用于系列故事、备件与售后；三渠道必须共享同一产品事实源。`,
      [
        ["Amazon US", "主推款 + 明确差异", "搜索意图强", "先验证"],
        ["Walmart", "价格/套装差异", "价值导向", "避免同 SKU 价格冲突"],
        ["Wayfair", "系列化与场景内容", "家居浏览导向", "丰富尺寸/材质表达"],
        ["DTC", "配件、备件、延保与系列", "品牌资产", "作为服务闭环"],
      ], "渠道真实毛利与库存周转", 5),
    returns_quality: {
      evidence_state: status(`退货预防优先级来自 ${c.evidenceRows.length} 条可追溯 VOC 观察：先处理 ${c.topTheme}，再处理 ${c.secondTheme}，而不是平均分配质量预算。`),
      coded_pareto: table(["主题", "编码观察", "负向", "正向", "产品含义"], c.themes.slice(0, 8)),
      closed_loop: table(["阶段", "输入", "输出", "门"], [
        ["设计", "VOC/Pareto", "CTQ 与公差", "DFMEA"],
        ["试制", "样机故障", "设计修订", "EVT/DVT"],
        ["生产", "首件/过程/末检", "批次追溯", "PVT"],
        ["上市", "退货/客服/评价", "周度 CAPA", "冻结/恢复补货"],
      ]),
    },
    scenario_valuation: {
      evidence_state: status(`财务情景全部由报告内的管理层价格与成本假设推导；它们用于测试项目耐受度，不是销量预测或估值承诺。`, "ASSUMPTION-MODEL"),
      scenarios: table(["情景", "售价", "总变动成本", "贡献/件", "贡献率", "口径"], [
        costScenario(0.9, 1.08, "压力"),
        costScenario(1, 1, "基准"),
        costScenario(1.08, 0.97, "改善"),
      ]),
      approval: `只有在真实报价、关税、履约费、广告和退货准备金替换假设后，且基准贡献率 ≥12%、压力情景不出现不可承受亏损，才可放量。`,
    },
    competitive_dynamics: hypothesisModule(c,
      `竞争重点不是“有没有相似产品”，而是当 ${conceptTitle} 起量后，头部是否能在 8–12 周内复制外观、降价或占据广告位。`,
      [
        ["价格复制", "高", "结构/物流服务难被价格完全复制", "保留成本余量"],
        ["外观复制", "中高", "系列化比例与细节一致性", "多 SKU 节奏"],
        ["功能复制", "中", must.slice(0, 3).join("；"), "用测试与服务证据形成门槛"],
        ["评论墙", "中高", "新品无法短期复制", "早期真实体验与客服闭环"],
      ], "竞品周度价格、广告与上新监控", 2),
    compdeep_five_forces_quant: {
      evidence_state: status(`${c.name} 的最大压力来自同质产品与渠道可比价；公司的可控反制是结构可靠性、产品家族、包装/补件和真实履约。`),
      five_forces: table(["力量", "强度(1–5)", "依据", "对策"], [
        ["现有竞争", 4, "公开样本多、价格透明", "避开低价同质带"],
        ["新进入者", 4, "板式家具供应成熟", "把 CTQ/包装/服务做成系统"],
        ["供应商", 3, "板材与五金可替代，但质量波动", "双供 + 关键件封样"],
        ["买方", 4, "比较成本低、评价敏感", "用证据消除装配/质量焦虑"],
        ["替代品", 3, "可被相邻柜体/床架替代", "聚焦专用任务与场景"],
      ]),
    },
    compdeep_strategic_groups_listing: hypothesisModule(c,
      `战略群组应按“价格 × 家具完成度 × 专用任务”而非品牌名划分；主推款位于中高价、成品感强、任务明确的空位。`,
      [
        ["低价功能堆叠", "低", "参数多、材料/装配弱", "不跟随"],
        ["大众基础家具", "中", "稳定但差异弱", "作为体验基线"],
        ["品牌设计家具", "中高", "材料/比例强", "学习完成度"],
        ["目标群组", c.priceBand, `${conceptTitle} + 物流服务`, "首发验证"],
      ], "完整竞品 Listing 评分基准", 4),
    compdeep_moat_priceband_war: {
      evidence_state: status(`目标价带 ${c.priceBand} 的护城河必须由“看得见的设计 + 用得到的功能 + 收得到的服务”共同构成；单一竖纹或单一充电功能都容易被复制。`),
      moat_stack: table(["护城河层", "当前设计", "可复制性", "加固动作"], [
        ["视觉家族", "Arc-Rhythm：暖木、圆弧、纵向节奏", "中", "五品类统一比例与 CMF"],
        ["工程 CTQ", must.slice(0, 4).join("；"), "中低", "测试报告与过程能力"],
        ["交付", c.logistics.company_advantage, "低", "补件 SKU/SLA/包装数据库"],
        ["数据闭环", "VOC→CTQ→CAPA", "低", "周度真实售后回流"],
      ]),
    },
    pd_attr_conjoint: {
      evidence_state: status("当前属性权重来自 VOC 证据优先级，不冒充 Conjoint 结果。真实权重需在带价格的选择实验中估计。", "PRE-CONJOINT"),
      attribute_backlog: table(["属性", "VOC 依据", "水平 1", "水平 2", "水平 3", "是否进入实验"], [
        [c.topTheme, "最高频编码主题", "基础", "改良", "可证明升级", "是"],
        [c.secondTheme, "次高频编码主题", "紧凑", "标准", "大容量", "是"],
        ["CMF", "质感/价值信号", "浅橡木", "暖胡桃", "奶油白+木", "是"],
        ["价格", "立项锚点", `$${Math.round(c.price * 0.85)}`, `$${c.price}`, `$${Math.round(c.price * 1.18)}`, "是"],
      ]),
    },
    pd_concept_matrix: {
      evidence_state: status(`方案练习以 ${conceptTitle} 为讨论起点：保留 Must，审查 ${mustNot.slice(0, 3).join("、") || "低价值堆叠"}，再验证示例品牌语言、真实需求与制造结构；不代表首发批准。`),
      concept_matrix: table(["方案", "消费者任务", "设计语言", "工程复杂度", "价格", "结论"], [
        ["A 价格防守", must.slice(0, 2).join("；"), "简化 Arc-Rhythm", "低", `$${Math.round(c.price * 0.85)}`, "备选"],
        ["B 品牌主推", must.slice(0, 5).join("；"), "完整 Arc-Rhythm", "中", `$${c.price}`, "推荐"],
        ["C 体验升级", [...must, ...should].slice(0, 6).join("；"), "材料/服务升级", "中高", `$${Math.round(c.price * 1.18)}`, "概念测试"],
        ["D 物流优化", must.slice(0, 3).join("；"), "可拆装与包装效率优先", "中", `$${Math.round(c.price * 0.95)}`, "包装验证"],
        ["E 材料标志", [...must.slice(0, 3), ...should.slice(0, 2)].join("；"), "触点材质与品牌 CMF 强化", "中高", `$${Math.round(c.price * 1.1)}`, "盲测验证"],
        ["F 模块服务", [...must.slice(0, 4), ...should.slice(0, 1)].join("；"), "可替换部件与售后模块化", "中", `$${Math.round(c.price * 1.05)}`, "二期验证"],
      ]),
    },
    pd_quality_return_pareto: {
      evidence_state: status(`以 ${c.evidenceRows.length} 条编码观察建立设计期 Pareto；上市后必须用真实退货 reason code 替换观察数。`),
      pareto: table(["主题", "观察数", "负向", "正向", "说明"], c.themes.slice(0, 10)),
      top_ctq: table(["优先级", "失效模式", "设计控制", "验证"], c.negative.slice(0, 8).map((row, index) => [index + 1, row[5], row[7], asRows(c.product.validation)[index % Math.max(1, asRows(c.product.validation).length)]?.[0] || "样机任务测试"])),
    },
    fin_sensitivity_tornado: {
      evidence_state: status("敏感性不使用伪造概率：逐项冲击售价、获客、履约、到岸与退货准备金，观察贡献利润距离 12% 放行线的余量。", "DETERMINISTIC"),
      sensitivity: table(["变量冲击", "对贡献/件的方向", "优先级", "管理动作"], [
        ["售价 -10%", `约 -$${(c.price * 0.1).toFixed(1)}`, "P0", "价格实验/促销纪律"],
        ["总变动成本 +8%", `约 -$${((c.price - c.contribution) * 0.08).toFixed(1)}`, "P0", "RFQ 拆项与替代设计"],
        ["营销费 +5pct", `-$${(c.price * 0.05).toFixed(1)}`, "P0", "break-even ACOS"],
        ["退货准备金 +3pct", `-$${(c.price * 0.03).toFixed(1)}`, "P1", "包装/CTQ CAPA"],
      ]),
      conclusion: `基准贡献率 ${c.margin}%；如果离 12% 闸门不足 5 个百分点，不得用乐观销量覆盖利润风险。`,
    },
    fin_montecarlo_dist: {
      evidence_state: status("未运行伪概率蒙特卡洛：缺少公司实际的售价、广告、退货、运费与成本分布。模块先锁定输入字典和启用条件。", "NOT-RUN"),
      required_distributions: table(["输入", "所需数据", "最小窗口", "责任系统"], [
        ["成交价", "订单级实收与折扣", "≥12 周", "ERP/平台"],
        ["广告获客", "订单归因与自然单", "≥12 周", "Ads/SQP"],
        ["退货/破损", "reason code + 损失金额", "≥200 单", "售后/WMS"],
        ["物流成本", "订单级计费重/区带/附加费", "≥200 单", "TMS/WMS"],
        ["到岸成本", "批次 FOB/运费/税费", "≥3 批", "采购/财务"],
      ]),
      activation_rule: "只有分布来自真实样本且相关性被建模后，才输出 P10/P50/P90、亏损概率和回本概率。",
    },
    fin_ue_decomp_tree: {
      evidence_state: status(`当前目标售价 $${c.price}、贡献 $${c.contribution}/件、贡献率 ${c.margin}% 均为立项假设；成本穿透的目的，是找出哪一项必须由报价或账单替换。`),
      unit_economics: table(["项目", "金额 USD", "占售价"], c.costRows),
      data_ownership: table(["成本", "当前口径", "替换证据"], c.costRows.slice(1, -1).map((row) => [row[0], "立项假设", /出厂/.test(String(row[0])) ? "双工厂正式报价" : /海运|关税|入仓/.test(String(row[0])) ? "报关行 HTS + 货代报价" : /履约/.test(String(row[0])) ? "TMS/WMS 账单" : "渠道/财务实账"])),
    },
    risk_patent_ip_defense: {
      evidence_state: status("专利地图状态：待最终结构/CAD 后检索。任何“未发现”都不能写成“无侵权风险”；AIGC 外观也必须进入相同 FTO 流程。", "FTO-PENDING"),
      search_protocol: table(["检索层", "关键词/分类", "输出", "放行人"], [
        ["产品功能", `${c.name} + ${must.slice(0, 3).join(" / ")}`, "相关权利要求族", "专利律师"],
        ["外观", "USPTO Design + Locarno + 相似品牌", "高相似图谱", "法务/设计"],
        ["竞品", "品牌/卖家/权利人反查", "诉讼与授权风险", "法务"],
        ["内容资产", "图像、文案、图标、包装", "权属清单", "品牌法务"],
      ]),
    },
    risk_cert_compliance_matrix: {
      evidence_state: status("合规矩阵按最终用途、尺寸、材料、电气模块与营销文案动态判定；本报告不替代实验室、报关行和美国法规顾问。", "COMPLIANCE-GATE"),
      matrix: table(["事项", "当前判定", "证据包", "门"], [
        ...(c.compliance.items || []).map((row: any[]) => [row[0], row[1], row[2], "量产前"]),
        ["HTS/关税", "待最终 BOM 与用途归类", "报关行书面意见", "下 PO 前"],
        ["声明与标签", "待最终 Listing", "claim matrix + 法务签字", "上线前"],
      ]),
    },
    risk_hijack_platform_defense: hypothesisModule(c,
      "平台防御从产品身份、序列化证据、包装与授权链开始，而不是被跟卖后才投诉。",
      [
        ["产品身份", "型号/BOM/包装批次一致", "可控", "建立 golden sample"],
        ["品牌资产", "商标/Brand Registry/A+", "待核验", "上线前完成"],
        ["跟卖监控", "ASIN/价格/Buy Box 异常", "未接入", "建立告警"],
        ["证据包", "采购、检测、实拍、序列号", "需制度化", "月度演练"],
      ], "平台账号与知识产权证据链", 1),
    meta_decision_robustness: {
      evidence_state: status(`当前评分 ${c.score}/${c.grade} 的稳健性取决于三个待补证变量：真实销量、真实单位经济、真实退货/破损。任何一个逆转都应重新过会。`),
      decision_tree: table(["分支", "条件", "动作"], [
        ["证据增强", "真实销量与 VOC 支持；贡献≥12%；质量闸门通过", "Go：按阶段放量"],
        ["需求成立/利润不足", "真实需求有，但贡献<12%", "重新设计成本/定价；不放量"],
        ["利润成立/质量失败", "经济达标，但活动件/包装/合规失败", "No-go 直到 CAPA 关闭"],
        ["证据冲突", "付费数据与公开样本方向相反", "冻结结论，扩大样本"],
      ]),
      irreversible_rule: "模型总分不能覆盖任何硬闸门失败。",
    },
    meta_assumption_registry: {
      evidence_state: status("每个关键结论都拆成事实、推断与管理层假设；假设必须有 Owner、截止日和失败动作。", "ASSUMPTION-LEDGER"),
      registry: table(["ID", "假设", "敏感度", "验证", "失败动作"], [
        ["A-01", "公开零售/VOC 样本能代表方向性需求", "高", "付费销量 + 自有渠道交叉", "重算机会与价格带"],
        ["A-02", `目标售价 $${c.price} 可被产品证据支撑`, "高", "真实概念/价格测试", "改概念或改价格"],
        ["A-03", `贡献率可达到 ${c.margin}%`, "高", "正式报价与订单实账", "低于 12% 停止放量"],
        ["A-04", "自有物流可降低破损与补件摩擦", "高", "首批订单级 KPI", "减量并重做包装/SLA"],
        ["A-05", "Arc-Rhythm 家族语言与目标用户匹配", "中", "盲测三概念", "保留品牌 DNA，调整 CMF/比例"],
      ]),
    },
    meta_evidence_audit: {
      evidence_state: status(`VOC 覆盖 ${c.sourceRows.length} 个来源页、${c.evidenceRows.length} 条编码观察；报告同时保留政府/监管、零售样本与第三方估算的置信等级。`, "AUDITED"),
      coverage: table(["证据层", "当前覆盖", "可用于", "不可用于"], [
        ["政府/监管", `${c.sources.filter((s: JsonObject) => s.confidence === "High").length} 条高置信来源`, "规则与大盘背景", "类目销量/偏好"],
        ["零售商品页", `${asRows(c.raw).length || "公开样本"}`, "价格/尺寸/评价快照", "市场份额"],
        ["VOC 来源页", `${c.sourceRows.length} 页 / ${c.evidenceRows.length} 观察`, "问题与语言", "发生率"],
        ["第三方估算", "按来源台账", "方向与候选", "财务承诺"],
        ["公司实账", "未接入", "—", "当前不能用于验证"],
      ]),
      opportunity_cost: `如果不补齐真实销量、广告、退货与物流账单，最大的风险不是“少一张图”，而是用公开样本替代公司级投资证据。`,
    },
    market_size_decomposition: {
      evidence_state: status("不复制旧报告中的 TAM/SAM/SOM 示例值。当前只保留自上而下与自下而上的计算结构；缺少可审计类目销量时显示待补证。", "NO-FALSE-PRECISION"),
      model: table(["层级", "定义", "当前值", "所需输入"], [
        ["TAM", `美国 ${c.name} 相关终端消费`, "待补证", "政府/行业分类 + 类目边界"],
        ["SAM", `线上渠道 × 目标价格/规格`, "待补证", "Amazon/Walmart/Wayfair 销售或可信面板"],
        ["SOM", "公司 24 个月可获份额", "待补证", "产能、广告、CVR、库存与竞争反应"],
        ["Bottom-up", "目标 ASIN 数 × 稳态周销 × 成交价", "待接入", "SQP/ABA/Keepa/自有销售"],
      ]),
      release_rule: "只有上下两种口径在同一数量级且来源可回溯，才在董事会版显示市场规模数字。",
    },
    price_elasticity: {
      evidence_state: status("公开页面的不同产品价格与销量不可直接当作同一 SKU 的价格弹性。当前不输出伪弹性系数。", "EXPERIMENT-PENDING"),
      experiment: table(["阶段", "价格", "控制", "指标"], [
        ["基线", `$${c.price}`, "库存、页面、广告稳定", "CVR/贡献/退货"],
        ["下探", `$${Math.round(c.price * 0.92)}`, "固定时段或市场", "增量销量是否覆盖价差"],
        ["上探", `$${Math.round(c.price * 1.08)}`, "固定时段或市场", "溢价是否保持贡献"],
      ]),
      analysis_rule: "使用同一 SKU、控制促销与流量结构，报告置信区间而不是单点弹性。",
    },
    longtail_niche: hypothesisModule(c,
      `长尾不按关键词数量挑选，而按“明确任务 + 可验证痛点 + 公司 edge + 足够贡献”筛选。${c.topTheme} 与 ${c.secondTheme} 是首轮长尾语义。`,
      [
        ["任务长尾", `${c.name} for [具体场景]`, "VOC 场景", "页面/词包测试"],
        ["问题长尾", `${c.topTheme} / ${c.secondTheme}`, "VOC 主题", "卖点与否定词"],
        ["尺寸长尾", "净尺寸/兼容物", "尺寸信号", "真实装载验证"],
        ["服务长尾", "易装/补件/成套交付", "公司 edge", "履约承诺测试"],
      ], "Search Query Performance 与转化数据", 6),
    supply_chain_risk_topology: {
      evidence_state: status(`${c.name} 的风险不是线性清单：板材/五金公差会传导到装配、活动件、破损、退货、评分和广告效率。`),
      topology: table(["上游节点", "传导", "客户后果", "控制点"], [
        ["板材/含水率/平整度", "柜体不方正", "门抽卡滞/缝隙", "来料+治具+整机末检"],
        ["五金/孔位", "装配返工", "无法完成/结构松动", "配对供货+防错"],
        ["包装/长件", "边角/表面/软包损伤", "退货与大额逆向", "ISTA 思路+线路验证"],
        ["电气/附件", "不可用或证据缺失", "安全/下架风险", "认证件+批次追溯"],
      ]),
    },
    multi_supplier_strategy: {
      evidence_state: status("双供应商不是把同一图纸发给两家报价；必须统一 CTQ、golden sample、量检具、变更流程与备件兼容。"),
      strategy: table(["层", "主供", "备供", "切换条件"], [
        ["整机", "成熟工程/质量能力", "小批复制验证", "交付或质量红线"],
        ["关键五金", "封样型号", "同规格验证", "寿命/供应中断"],
        ["板材/饰面", "批次色差控制", "批准样板", "供货/合规异常"],
        ["包装", "主线路验证", "区域化方案", "破损路线差异"],
      ]),
      governance: "任何供应商变更不得只靠采购确认；必须经过工程、质量、合规和产品四方 ECN。",
    },
    certification_and_first_leg: {
      evidence_state: status("认证与头程在下 PO 前联审：结构/材料变化可能同时改变合规、包装尺寸、计费重、关税归类与破损风险。"),
      gate_plan: table(["里程碑", "合规", "物流", "输出"], [
        ["设计冻结", "适用法规清单", "包装假设/分箱", "风险清单"],
        ["DVT", "测试样/文件审核", "包装跌落/夹抱/振动思路", "整改关闭"],
        ["PVT", "量产批文件一致", "真实线路小批", "放行报告"],
        ["上市后", "证书/供应商变更监控", "破损/附加费/补件", "月度 CAPA"],
      ]),
    },
    keyword_strategy_matrix: {
      evidence_state: status("关键词矩阵以购买任务为中心；未接入 ABA/SQP 前不显示虚假搜索量。VOC 主题用于发现词，不等于词量。", "KEYWORD-DATA-PENDING"),
      matrix: table(["词层", "示例语义", "页面承接", "数据门"], [
        ["核心词", c.name, "标题/主图/类目", "ABA/SQP"],
        ["属性词", must.slice(0, 4).join(" / "), "五点/A+", "相关性+CVR"],
        ["问题词", `${c.topTheme} / ${c.secondTheme}`, "结构证据/FAQ", "搜索词+VOC"],
        ["场景词", "房间/任务/兼容", "场景图/尺寸图", "SQP/页面行为"],
        ["否定词", mustNot.slice(0, 4).join(" / "), "广告否定/内容澄清", "无效点击"],
      ]),
    },
    ad_structure_bidding: {
      evidence_state: status(`广告上限必须从单位经济倒推。当前 $${c.contribution}/件贡献是立项假设；在真实 CVR 与自然单占比接入前，只设置探索预算，不承诺 TACOS。`),
      structure: table(["层级", "目的", "预算规则", "迁移/止损"], [
        ["Auto/广泛", "发现词", "小预算", "有转化词迁 Exact；持续无效否定"],
        ["Exact 核心", "获取可控订单", "按贡献上限", "看边际贡献，不只看 ROAS"],
        ["属性/场景", "承接差异", "按主题分组", "CVR 与退货共同判断"],
        ["品牌防守", "保护品牌词", "低波动", "监控竞品侵入"],
      ]),
    },
    offsite_influencer_social: hypothesisModule(c,
      "站外内容应演示真实任务和开箱/装配/细节，而不是只拍氛围；所有创作者素材必须与量产规格一致并披露合作。",
      [
        ["问题解决", c.topTheme, "短视频前后对比", "收藏/站内搜索增量"],
        ["空间/尺寸", c.secondTheme, "真实房间与测量", "尺寸咨询/退货"],
        ["工程可信", must.slice(0, 3).join("；"), "结构/测试/装配", "CVR/评论主题"],
        ["系列化", "Arc-Rhythm 家族", "多品类空间组合", "品牌词与连带购买"],
      ], "归因链接、品牌词增量与内容复用", 8),
    segment_grade_matrix: {
      evidence_state: status("细分评级综合品类机会、公司 edge、工程难度和证据质量；不是平台销量榜。"),
      stp: strategy.stp,
      segments: table(["细分", "机会", "公司胜算", "证据", "评级", "动作"], [
        ["低价同质", "中", "低", "价格样本", "C", "不进入"],
        ["目标主推", "高", "中高", "零售+VOC+能力", c.grade, "按闸门进入"],
        ["材料升级", "中", "中", "偏好待证", "B", "概念测试"],
        ["功能堆叠", "中", "低", "复杂度高", "C", "删除低价值功能"],
      ]),
    },
    market_map_segment_grade: {
      evidence_state: status(`目标位置：${c.priceBand} × 中高完成度 × 明确专用任务；避免落入低价功能堆叠或高价但证据不足。`),
      stp: strategy.stp,
      map: table(["象限", "价格", "完成度", "典型风险", "策略"], [
        ["红海", "低", "低–中", "复制、广告、退货", "退出"],
        ["大众", "中", "中", "差异弱", "只作基准"],
        ["目标", "中高", "高", "需证据支撑溢价", conceptTitle],
        ["奢侈", "高", "高", "品牌势能不足", "暂不进入"],
      ]),
    },
    voc_absa_walls: {
      evidence_state: status(`VOC 墙来自 ${c.sourceRows.length} 个公开来源页和 ${c.evidenceRows.length} 条转述观察；保留链接与样本快照，不使用虚构原话。`, "TRACEABLE-VOC"),
      negative_wall: table(["编号", "渠道", "产品", "主题", "消费者信号（转述）", "产品动作", "证据锚点/限制", "来源"], c.negative.slice(0, 12).map((row) => [row[0], row[1], row[2], row[5], row[6], row[7], row[8], row[9]])),
      positive_wall: table(["编号", "渠道", "产品", "主题", "消费者信号（转述）", "保留/放大", "证据锚点/限制", "来源"], c.positive.slice(0, 10).map((row) => [row[0], row[1], row[2], row[5], row[6], row[7], row[8], row[9]])),
      distribution: table(["主题", "观察数", "负向", "正向", "口径"], c.themes),
    },
    mind_whitespace_needs: {
      evidence_state: status(`白空间不是“竞品没有某功能”，而是消费者任务反复失败且公司能以可盈利方式解决。当前优先是 ${c.topTheme} 与 ${c.secondTheme}。`),
      whitespace: table(["需求层", "证据", "产品机会", "反证"], [
        ["功能", c.topTheme, must.slice(0, 3).join("；"), "真实使用是否改善"],
        ["体验", c.secondTheme, must.slice(3, 6).join("；") || should.slice(0, 3).join("；"), "是否增加装配/成本"],
        ["信任", "材料、尺寸、测试与承诺", "透明规格 + 证据图", "是否与实物一致"],
        ["服务", "大件破损/缺件摩擦", c.logistics.company_advantage, "SLA 是否可兑现"],
      ]),
    },
    problem_solver_concept: {
      evidence_state: status(`${conceptTitle} 演示如何把 VOC 输入、示例设计规则、工程 CTQ 与待验证物流能力连接成产品命题；真实证据与工程验证须另行补齐。`),
      translation: table(["消费者问题", "设计响应", "工程证据", "页面表达"], c.negative.slice(0, 8).map((row, index) => [row[6], row[7], asRows(c.product.validation)[index % Math.max(1, asRows(c.product.validation).length)]?.[0] || "任务验证", "结构/尺寸/测试图，不使用虚构引语"])),
      concept_boundary: table(["Must", "Should", "Must not"], [[must.join("；"), should.join("；"), mustNot.join("；")]]),
    },
    grade_map: {
      evidence_state: status("评级图是项目优先级工具；A/B/C 代表在当前公司能力与证据下的吸引力，不代表产品质量认证。"),
      grade_grid: table(["价格带", "低完成度", "中完成度", "高完成度"], [
        [`<$${Math.round(c.price * 0.7)}`, "C / 价格战", "C / 毛利不足", "B- / 成本压力"],
        [c.priceBand, "C / 价值不符", "B / 可测试", `${c.grade} / 目标`],
        [`>$${Math.round(c.price * 1.2)}`, "C", "B-", "B / 需品牌与材料证据"],
      ]),
    },
    social_demand_triggers: hypothesisModule(c,
      `最适合社媒演示的不是参数列表，而是 ${c.topTheme} 失败前后、${c.secondTheme} 的真实适配，以及 Arc-Rhythm 系列化空间。`,
      [
        ["痛点触发", c.topTheme, "3 秒看到问题", "产品动作闭环"],
        ["空间触发", c.secondTheme, "测量/装载/兼容", "降低错购"],
        ["质感触发", "木纹、圆弧、纵向节奏", "近景材料/门缝/边界", "支撑溢价"],
        ["信任触发", "装配、测试、补件", "幕后证据", "降低风险"],
      ], "社媒互动到站内搜索与订单的增量", 7),
    strategy_map: {
      evidence_state: status(`${c.verdict}：在 ${c.priceBand} 推出 ${conceptTitle}，以 ${c.topTheme}、现代有机家族语言和自有物流闭环形成差异；所有投入受利润、质量、合规三类硬闸门约束。`),
      framework_version: strategy.framework_version,
      decision_chain: strategy.decision_chain,
      complementary_frameworks: strategy.complementary_frameworks,
      methodology_sources: strategy.methodology_sources,
      map: table(["节点", "关键结论", "输出"], [
        ["OP_SCAN", c.oneLiner, "进入方向"],
        ["MKT_STRUCT", `避开低价同质，锁定 ${c.priceBand}`, "价格/战略群组"],
        ["MIND_DECODE", `${c.topTheme} / ${c.secondTheme}`, "CTQ 与卖点"],
        ["CPT_VERIFY", conceptTitle, "样机/财务/合规门"],
        ["GTM_PLAN", "小批真实履约后放量", "90 天动作"],
        ["AIGC", "证据内综合、概念图、内容蓝图、红队", "不替代事实与签样"],
      ]),
    },
    ev_decision: {
      evidence_state: status("不输出伪造的成功概率。EV 决策先拆可控收益、最坏损失和分阶段选择权，再用小批量购买信息。", "REAL-OPTION"),
      ev_logic: table(["项", "当前处理"], [
        ["上行", `中高价 ${conceptTitle} + 系列化 + 自有物流壁垒`],
        ["下行", "模具/样机/库存/广告/逆向物流的可回收与不可回收成本"],
        ["概率", "未用真实基准率校准前不填数字"],
        ["选择权", "DFM→EVT→DVT→小批→放量，每阶段可停止"],
      ]),
      decision: `${c.verdict}，但每一阶段只投入足够获得下一轮信息的资金。`,
    },
    beta_alpha_quadrant: {
      evidence_state: status("市场机会（Beta）与公司胜算（Alpha）分开评分；好市场不等于适合本公司。"),
      quadrant: table(["品类", "机会 Beta", "公司 Alpha", "优先级", "原因"], portfolioRows),
      current: `${c.name} 当前评分 ${c.score}/${c.grade}；公司 Alpha 主要来自品牌、产品家族与自有物流，短板是未接入真实交易/广告/退货数据。`,
    },
    capital_allocation_ruin: {
      evidence_state: status("未有真实需求分布和项目损失分布前，不使用凯利公式生成精确下注比例。采用阶段上限和组合止损防止单品 all-in。", "CAPITAL-GUARDRAIL"),
      portfolio_actions: strategy.bcg?.portfolio_actions,
      stage_caps: table(["阶段", "允许投入", "信息增益", "停止线"], [
        ["研究/DFM", "可费用化的小额", "报价、FTO、结构可行", "关键合规/成本失败"],
        ["EVT/DVT", "样机与测试预算", "CTQ/包装/体验", "硬闸门失败"],
        ["首批", "不影响组合现金安全", "真实 CVR/退货/物流", "贡献<12%或质量超线"],
        ["放量", "按周转与补货证据增加", "可重复单元经济", "连续两周期恶化"],
      ]),
    },
    pre_mortem_redteam: {
      evidence_state: status(`假设 18 个月后 ${c.name} 项目失败：最可能不是单一“卖不动”，而是价值主张、活动件/结构、包装履约和利润同时小幅偏离后相互放大。`, "RED-TEAM"),
      failure_story: table(["失败路径", "最早信号", "预防", "止损"], [
        ["设计像竞品、无法支撑溢价", "CTR/CVR 低、价格敏感", "盲测 + 结构证据", "改概念而非先降价"],
        [c.topTheme, "客服/VOC 主题上升", "CTQ/循环/整机末检", "冻结补货 + CAPA"],
        ["大件破损/缺件", "线路/箱号异常", "包装验证 + 部件补发", "减量/切线路"],
        ["利润被广告/退货吃掉", "贡献低于 12%", "订单级利润看板", "停止放量"],
        ["合规/IP 事件", "文件缺口/投诉", "FTO + claim matrix", "下架/召回预案"],
      ]),
    },
    edge_calibration: {
      evidence_state: status("把‘我们有自有物流’拆成可证伪指标；只有真实订单证明妥投、破损、补件和成本优于基准，才算已证 edge。"),
      calibration: table(["声称 edge", "当前证据", "已证标准", "状态"], [
        ["品牌溢价", "现有品牌/产品输入", "盲测/成交价/复购", "待验证"],
        ["自有物流", "公司能力输入", "破损、妥投、补件、成本", "待订单验证"],
        ["产品研发", "概念与验证矩阵", "DVT/PVT 通过率", "待样机验证"],
        ["数据能力", "公开数据+VOC", "交易/广告/退货闭环", "缺口"],
      ]),
    },
    portfolio_correlation: {
      evidence_state: status(existingPortfolioMatch
        ? "五个品类共享板材、五金、美国需求、Amazon 流量与大件物流风险；看似多元，实际存在较强共因暴露。"
        : `${c.name} 尚未进入既有五品类组合评分；当前只登记潜在共因，资本相关性保持 PENDING。`),
      bcg_matrix: strategy.bcg,
      portfolio: table(["品类", "评分", "等级", "物流占用", "战略角色"], portfolioBaseRows),
      shared_risks: table(["共因", "受影响", "缓释"], [
        ["材料/饰面供应", existingPortfolioMatch ? "五品类" : c.name, "按最终材料建立双供/批次标准"],
        ["美国关税/产品政策", existingPortfolioMatch ? "五品类" : c.name, "按最终结构与用途复核 HTS / 适用要求"],
        ["大件线路", "Sideboard/coffee bar/bed", "错峰试销 + 路线容量"],
        ["同一设计语言疲劳", existingPortfolioMatch ? "五品类" : c.name, "统一 DNA、不同任务表达"],
      ]),
    },
    personal_entry_window: {
      evidence_state: status("入场窗口用可观察信号管理，不假装知道一个精确截止日期。目标是比竞品复制周期更快完成样机—试销—系列化。"),
      window_signals: table(["信号", "窗口打开", "窗口收窄", "动作"], [
        ["竞品复制", "相似功能少", "8–12 周密集上新", "加速/改差异"],
        ["价格", "目标带稳定", "持续降价", "重算利润"],
        ["VOC", "痛点持续且未解", "新头部已解决", "更新 CTQ"],
        ["公司准备", "样机/供应/物流门通过", "关键资源冲突", "调整首发顺序"],
      ]),
    },
    incumbent_retaliation_game: {
      evidence_state: status("按两期博弈设计：第一期验证差异而不是烧钱抢量；第二期预设头部降价、复制功能、加广告后的应对。"),
      game: table(["头部动作", "我们不做什么", "我们做什么", "退出条件"], [
        ["降价", "全面跟价", "守住贡献，强化证据/服务", "目标带结构性跌破"],
        ["复制外观", "继续只讲外观", "推出系列/工程/服务证据", "差异不可感知"],
        ["占广告位", "无限抬价", "长尾/内容/品牌词/自然转化", "获客超贡献"],
        ["投诉/IP", "无证据争辩", "预备 FTO、图片、采购与测试包", "法律建议下停销"],
      ]),
    },
  };
}

const BLUEPRINTS: Record<string, [string, any[][], string, number?]> = {
  // All 53 framework modules are explicitly overridden in specialModules. This
  // fallback keeps the framework resilient if a future PDF module is appended.
};

export function buildPdfFrameworkModules(config: JsonObject, voc: JsonObject, strategy: JsonObject = {}) {
  const c = context(config, voc);
  const special = specialModules(c, strategy);
  const modules: JsonObject = {};
  for (const id of PDF_DEEP_MODULE_ORDER) {
    if (special[id]) {
      modules[id] = special[id];
      continue;
    }
    const [answer, rows, focus, offset = 0] = BLUEPRINTS[id] || [
      `${categoryName(config)} 的该项分析已纳入证据门控；数据不足时不得输出伪精确结论。`,
      [["当前结论", "待补证", "报告来源台账", "完成验证后更新"]],
      "本模块验证",
      0,
    ];
    modules[id] = hypothesisModule(c, answer, rows, focus, offset);
  }
  return modules;
}

const LEGACY_META_REPLACEMENTS: Array<[string, string]> = [
  ["折叠露营椅", "目标品类"],
  ["露营椅", "目标品类"],
  ["单椅", "单件产品"],
  ["$25-40", "目标价格带"],
  ["加宽椅脚", "核心差异化结构"],
];

function sanitizeFrameworkMeta(value: any): any {
  if (typeof value === "string") {
    return LEGACY_META_REPLACEMENTS.reduce(
      (result, [legacy, replacement]) => result.replaceAll(legacy, replacement),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeFrameworkMeta(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeFrameworkMeta(item)]),
    );
  }
  return value;
}

export function pdfFrameworkMeta(): JsonObject {
  const raw = extMetaRaw as JsonObject;
  const meta: JsonObject = {};
  for (const [index, id] of PDF_DEEP_MODULE_ORDER.entries()) {
    const source = sanitizeFrameworkMeta(raw[id] || {});
    const referenceNumber = index + 11;
    meta[id] = {
      ...source,
      title: `${String(referenceNumber).padStart(2, "0")} · ${source.title || id.replace(/_/g, " ")}`,
      nav_short: source.nav_short || source.title || id.replace(/_/g, " "),
      icon: source.icon || "◆",
      reference_number: referenceNumber,
      framework_source: "美式压木纹床头柜-选品决策报告.pdf",
    };
  }
  return meta;
}

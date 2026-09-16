import extMetaRaw from "@/data/ext_meta.json";
import {
  REFERENCE_REPORT_FRONT_MATTER_PAGES,
  REFERENCE_REPORT_MODULE_PAGE_SPANS,
  REFERENCE_REPORT_SHARED_TRANSITIONS_BY_PAGE,
  REFERENCE_REPORT_TOTAL_PAGES,
  type ReferenceReportModuleId,
  type ReferenceReportSharedTransition,
} from "./reference-report-schema";

type ExtMeta = Record<string, {
  title?: string;
  nav_short?: string;
  subsections?: Array<{ id?: string; title?: string }>;
}>;

export type ReferencePageRole =
  | "cover"
  | "contents"
  | "analysis"
  | "section_intro"
  | "section_intro_callout"
  | "shared_transition"
  | "outgoing_teaser";

export type ReferencePageLayout =
  | "cover"
  | "toc_list"
  | "single_visual"
  | "split_visual"
  | "dashboard"
  | "transition"
  | "section_intro";

export type ReferencePageVisual =
  | "cover"
  | "toc_list"
  | "section_intro"
  | "section_intro_callout"
  | "decision_hero"
  | "kpi_dashboard"
  | "kpi_cards"
  | "kpi_cards_callout"
  | "kpi_cards_horizontal_bars"
  | "kpi_cards_table"
  | "insight_cards"
  | "narrative_cards"
  | "cards_radar_bar"
  | "bullet_chart"
  | "action_list"
  | "table"
  | "data_table"
  | "data_table_callout"
  | "table_callout"
  | "scenario_table"
  | "table_sparklines"
  | "range_controls"
  | "funnel_table"
  | "combo_dashboard"
  | "combo_chart"
  | "slopegraph"
  | "line_chart"
  | "multi_line"
  | "multi_line_callout"
  | "dual_line_callout"
  | "fan_chart"
  | "radar"
  | "radar_callout"
  | "radar_heatmap"
  | "radar_diverging_bar"
  | "radar_bar"
  | "horizontal_bar"
  | "horizontal_bars_line"
  | "horizontal_bars_heatmap"
  | "horizontal_bars_diverging_bars"
  | "horizontal_bars_pair"
  | "horizontal_bars_table"
  | "horizontal_bars_multi_line"
  | "diverging_bars"
  | "bar_dashboard"
  | "bar_table"
  | "bar_line_combo"
  | "pareto_chart"
  | "tornado_table"
  | "heatmap"
  | "heatmap_callout"
  | "heatmap_horizontal_bars"
  | "heatmap_kpis"
  | "heatmap_table"
  | "table_horizontal_bars"
  | "table_donut_bars"
  | "table_donut_horizontal_bars"
  | "bubble_scatter"
  | "regression_scatter"
  | "box_plot"
  | "marimekko"
  | "treemap"
  | "donut_pair"
  | "donut"
  | "donut_bar_quotes"
  | "kpi_donut_table"
  | "survival_combo"
  | "sankey"
  | "waterfall"
  | "waterfall_bar"
  | "gantt"
  | "timeline"
  | "range_bars"
  | "range_bars_callout"
  | "range_bars_horizontal_bars"
  | "range_table"
  | "histogram"
  | "quadrant"
  | "quadrant_bubble"
  | "network"
  | "node_link_map"
  | "tree"
  | "competitor_cards"
  | "attack_matrix"
  | "gauge_horizontal_bars"
  | "gauge_bar_kpis"
  | "concept_comparison"
  | "concept_image"
  | "wordcloud_horizontal_bars"
  | "grade_matrix"
  | "bubble_diverging_bars_horizontal_bars"
  | "method_cards"
  | "warning_list"
  | "verdict_kpi_cards"
  | "verdict_table"
  | "diverging_bars_callout"
  | "verdict_callout"
  | "verdict_horizontal_bars"
  | "gantt_callout"
  | "method_cards_warning_list"
  | "callout";

export type ReferencePageReferenceBlock = {
  id: string;
  title: string;
  visual: ReferencePageVisual;
  source_paths: readonly string[];
  required: true;
  origin: "reference";
};

export type ReferencePageAugmentationBlock = {
  id: string;
  title: string;
  visual: ReferencePageVisual;
  source_paths: readonly string[];
  required: false;
  origin: "voc" | "aigc" | "strategy";
  placement: "overlay" | "sidecar" | "appendix";
};

export type ReferencePagePlanEntry = {
  page: number;
  kind: "cover" | "contents" | "module";
  module_id: ReferenceReportModuleId | null;
  module_number: number | null;
  module_title: string;
  page_in_module: number | null;
  pages_in_module: number | null;
  title: string;
  topic: string;
  research_question: string;
  topic_source: "reference-page-contract" | "reference-heading-curated" | "ext-meta-subsection";
  transition: ReferenceReportSharedTransition | null;
  role: ReferencePageRole;
  layout: ReferencePageLayout;
  reference_blocks: readonly ReferencePageReferenceBlock[];
  augmentation_blocks: readonly ReferencePageAugmentationBlock[];
};

const extMeta = extMetaRaw as ExtMeta;

const CORE_MODULE_TITLES: Partial<Record<ReferenceReportModuleId, string>> = {
  exec_summary_decision_scorecard: "执行摘要 · 决策记分卡",
  decision_funnel: "选品决策漏斗",
  OP_SCAN: "OP_SCAN · 品类机会扫描",
  MKT_STRUCT: "MKT_STRUCT · 市场结构解剖",
  MIND_DECODE: "MIND_DECODE · 消费者 VOC 洞察",
  voc_evidence: "VOC 证据引擎 · 评论标注与方面级证据",
  competitor_teardown: "竞品深度拆解",
  CPT_VERIFY: "CPT_VERIFY · 选品验证",
  output_unit_economics_finance: "单位经济与财务",
  gtm_plan: "GTM · 上市打法",
  ev_decision: "市场机会、公司胜算与期望价值决策",
  beta_alpha_quadrant: "机会与胜算决策象限",
  capital_allocation_ruin: "资本损失风险与投入上限",
  pre_mortem_redteam: "Pre-mortem · 失败路径与止损预演",
  edge_calibration: "卖家能力证据校准",
  portfolio_correlation: "候选相关性与组合资源占用",
  personal_entry_window: "个性化入场窗口与拥挤速度",
  incumbent_retaliation_game: "头部反击与两期竞争博弈",
  risk_register_sensitivity_confidence: "风险登记、敏感性与置信度",
  trust_guardrails_methodology: "可信度、护栏与方法论",
};

const CURATED_MODULE_TOPICS: Partial<Record<ReferenceReportModuleId, readonly string[]>> = {
  exec_summary_decision_scorecard: [
    "决策结论、适用范围与硬性放行条件",
    "核心决策逻辑与可追溯证据链",
    "综合记分卡与各维度达标差距",
    "优先行动、责任人与验收条件",
  ],
  decision_funnel: [
    "关键假设、证据基础与失效影响",
    "决策门槛与参数调整规则",
    "多道门收敛、淘汰原因与最终方案",
  ],
  OP_SCAN: [
    "市场规模口径、生命周期与趋势证据",
    "需求季节性、峰谷幅度与备货窗口",
    "进入壁垒、机会维度与细分热力",
    "机会与竞争定位及优先利基",
  ],
  MKT_STRUCT: [
    "机会判断对权重变化的稳健性",
    "价格带容量、成本与利润结构",
    "各价格带需求分布与离散程度",
    "竞争集中度、Buy Box 与履约结构",
    "品牌梯队、卖家结构与长尾空间",
    "价格弹性假设与可验证甜蜜区",
    "新品存活、声量份额与进入难度",
  ],
  MIND_DECODE: [
    "方面级正负向情感与战略痛点",
    "未满足需求的严重度、频率与可解决性",
    "好评驱动、复购理由与情感变化",
    "竞品口碑差距与方面级攻击窗口",
    "消费者方面、情感与业务结果链路",
    "使用场景、退货风险与代表性证据",
  ],
  voc_evidence: [
    "VOC 机会白空间与负向主题排序",
    "方面重要度、评分影响与 Kano 分类",
    "使用场景与方面问题的交叉分布",
  ],
  competitor_teardown: [
    "竞品样本的方面级加权汇总",
    "核心竞品卡片、价格角色与证据置信",
    "竞品多维能力与我方目标差距",
    "竞品软肋、我方对策与验证要求",
  ],
  CPT_VERIFY: [
    "候选产品面板、数据边界与置信门",
    "多方案加权评分与排序依据",
    "需求与单位贡献共同决定的机会规模",
  ],
  output_unit_economics_finance: [
    "关键变量扰动与单位贡献敏感性",
    "交互单位经济、成本瀑布与保本门",
    "滚动销量与月度利润情景",
    "需求预测区间与不确定性边界",
    "现金流、备货投入与资金占用",
    "定价情景、贡献率与目标差距",
  ],
  gtm_plan: [
    "价格阶梯、首发定位与促销纪律",
    "差异化定位与广告阶段策略",
    "Listing 信息架构与证据表达",
    "关键词分层、意图承接与投放边界",
    "上市节奏、库存门与评价闭环",
  ],
  supply_chain_sourcing: [
    "寻源策略、到岸成本与供应链决策边界",
    "到岸成本分解与关键成本假设",
    "供应商能力画像与候选对比",
    "税则归类、关税与政策敞口",
    "MOQ、采购量与单价阶梯",
    "打样、验证到量产的阶段计划",
    "供应商质量、交付与集中度风险",
    "库存、现金占用与周转纪律",
    "补货点、安全库存与缺货响应",
  ],
  pd_concept_matrix: [
    "候选概念组合与多维选型标准",
    "AIGC 主概念图与品牌设计语言",
    "正侧背视图、尺寸包络与结构约束",
    "CMF、材料工艺与可制造性",
    "特性、利益、证据及成本与 IP 联动",
    "概念冻结、工程验证与人工签核",
  ],
  problem_solver_concept: [
    "VOC 白空间到痛点解决概念的映射",
    "概念记分、内容蓝图、红队验证与人工签核",
  ],
  ev_decision: [
    "市场机会、公司胜算与期望价值的分离评估",
    "上行收益、下行损失与最终投资裁决",
  ],
  beta_alpha_quadrant: [
    "市场吸引力与公司相对胜算的决策象限",
    "象限结论、进入优先级与回避边界",
  ],
  edge_calibration: [
    "声称能力、已证能力与最大自评偏差",
  ],
  risk_register_sensitivity_confidence: [
    "风险登记册、最早信号与责任人",
    "风险等级、缓解动作与停止线",
    "概率影响矩阵与单位贡献敏感项",
    "经营结果区间与下行情景边界",
    "关键假设、证据置信与残余风险",
  ],
  trust_guardrails_methodology: [
    "输入、事实、计算、推断与 AIGC 护栏链",
    "交叉验证、分歧处理与证据降级规则",
    "人工终审、签核职责与版本记录",
    "数据来源、观察窗口与可追溯台账",
    "方法论、局限、免责声明与审计结论",
  ],
};

const EXACT_MODULE_PAGE_TOPICS: Partial<Record<ReferenceReportModuleId, readonly string[]>> = {
  crossborder_seller_cockpit: [
    "账户健康看板与核心违规指标",
    "账号风险登记、触发信号与缓解动作",
    "跟卖与劫持监控",
    "侵权与多站点合规红线热力",
    "税务合规成本与履约结构",
    "库存绩效、仓储费用与头程运输",
    "现金周期与资金占用",
    "汇率波动对毛利的影响",
    "库存周转、补货点与安全库存",
    "卖家经营 KPI 总览",
    "流量与销量引擎",
    "评论与 Rating 资产",
    "多站点扩张机会",
    "全球化路线图",
    "品牌资产建设",
  ],
  ip_compliance: [
    "外观与实用专利检索命中清单",
    "商标近似冲突扫描",
    "侵权风险热力与严重度",
    "品类合规红线清单",
    "规避设计建议",
    "合规成本与认证费用瀑布",
  ],
  pricing_science: [
    "定价科学 · 章节引导",
    "价格弹性再拟合",
    "心理价位与锚点 · 促销弹性",
    "捆绑与多件装定价",
    "竞品价格带地图",
    "最优定价求解",
    "价格战风险与护栏",
  ],
  trend_forecast: [
    "微观趋势雷达与多平台信号强度",
    "搜索趋势历史与近期扇形预测",
    "早期信号时间线",
    "相关上升子品类与关键词",
    "生命周期定位与拐点预测",
    "季节性分解：趋势、季节与噪声",
    "趋势置信与结构性风险",
    "趋势判定、生命周期与最佳切入信号",
  ],
  compdeep_five_forces_quant: [
    "五力量化评分与类目基准",
    "供方议价力、集中度与切换成本",
    "买方议价力、比价透明度与退货权",
    "新进入者壁垒与资本门槛",
    "替代场景与替代强度热力",
    "现有竞争强度、集中度与价格战倾向",
    "新玩家入场速度、洗牌节奏与结构性结论",
  ],
  scenario_valuation: [
    "三情景三年损益表",
    "三年营收、净利与净利率演进",
    "累计现金流三情景",
    "首年 GMV 与净利分位区间",
    "关键假设敏感性",
    "盈亏平衡与回本",
    "简化估值与投资回报",
    "决策阈值：加码、观察与止损",
  ],
  compdeep_moat_priceband_war: [
    "头部护城河逐项解剖",
    "护城河深度评分与价格带空位热力",
    "各价格带销量与玩家结构",
    "评论墙壁垒时间成本",
    "头部与本品单位成本瀑布",
  ],
  pd_attr_conjoint: [
    "属性重要度排序与需求缺口章节锚点",
    "重要度与满意度缺口地图",
    "属性水平部分效用表",
    "各属性升级的支付意愿溢价",
    "属性满意度双向偏离基准",
    "三类买家画像的属性偏好雷达",
    "Kano 属性分类、投资优先级与组合结论",
  ],
  pd_concept_matrix: [
    "候选设计概念多维评分矩阵",
    "概念与评估维度评分热力图",
    "特性、利益与证据映射表",
    "成本增量与差异度定位图",
    "专利风险与规避设计表",
    "入选概念可行性雷达与概念冻结决策",
  ],
  pd_quality_return_pareto: [
    "质量与退货健康度 KPI",
    "退货根因帕累托",
    "缺陷频次、成本与设计责任",
    "退货流向与处置成本",
    "关键失效模式 DFMEA",
    "纠正预防措施改进甘特",
    "改进前后退货率与投资回报",
  ],
  fin_sensitivity_tornado: [
    "基准净利与波动敞口总览",
    "净利龙卷风与因子冲击排序",
    "因子弹性与售价成本交叉热力",
    "净利归零阈值与方差贡献",
    "风险对冲优先级矩阵",
  ],
  fin_montecarlo_dist: [
    "模拟结果总览",
    "多指标分位区间",
    "年净利分布与尾部",
    "回本周期概率分布",
    "ROI 与 IRR 分布",
    "下行情景概率表",
    "旺季、平季与淡季净利箱线",
  ],
  risk_patent_ip_defense: [
    "目标品类专利地图总览",
    "命中专利、风险与规避设计矩阵",
    "权利要求要素比对",
    "实用、外观与发明专利风险分层",
    "商标注册与品牌保护风险",
    "IP 布局成本与时间线甘特",
  ],
  risk_cert_compliance_matrix: [
    "认证与站点合规热力矩阵",
    "强制认证清单与法规溯源",
    "材料与化学合规",
    "标签、说明书与合规文件包",
    "认证成本与取证周期区间",
    "不合规敞口与下架成本",
  ],
  meta_decision_robustness: [
    "关键假设龙卷风",
    "假设临界点与安全边际",
    "两年期净现值分位区间",
    "市场反应情景决策树",
    "决策翻转热力与极端组合压力测试",
    "稳健性结论与熔断线",
  ],
  meta_assumption_registry: [
    "假设登记册与验证实验计划 · 章节引导",
    "核心假设登记册",
    "验证优先级：影响力与验证成本",
    "验证实验甘特",
    "验证前后置信度跃升",
    "验证投入与决策风险削减",
    "证伪即停与 Kill Criteria",
    "三关卡累计放行与否决额度",
  ],
  meta_evidence_audit: [
    "结论证据覆盖表",
    "证据来源结构",
    "决策域置信分布",
    "证据强度与决策门槛",
    "本品与备选品机会成本表",
    "候选品多维评分雷达",
    "原始声量到可引用证据的可溯源率瀑布",
  ],
  market_size_decomposition: [
    "TAM、SAM、SOM 漏斗拆解与章节锚点",
    "自下而上销量与客单价复核",
    "可获取份额瀑布",
    "价格带与子品类容量结构",
    "份额可达性六维雷达",
    "月度可获取 GMV 与渗透率",
    "规模敏感性区间与结论",
  ],
  price_elasticity: [
    "分价格带需求弹性系数",
    "价格与需求量弹性曲线",
    "价格、销量与营收双轴寻优",
    "各价位净利分位区间",
    "交叉弹性与替代影响",
    "弹性因子敏感性区间",
    "价格与促销力度热力及弹性结论",
  ],
  longtail_niche: [
    "长尾微利基机会挖掘 · 章节引导",
    "关键词聚类机会散点",
    "利基机会热力与优先级排序",
    "需求与供给缺口验证表",
    "微利基季节性",
    "进入优先级基准带雷达",
    "分批切入路线与长尾利基结论",
  ],
  supply_chain_risk_topology: [
    "风险概率与影响热力",
    "关键风险敞口分位区间",
    "单一供应商依赖及地缘、关税、物流、汇率风险",
    "风险缓解行动排期",
    "综合供应链韧性与风险拓扑结论",
  ],
  multi_supplier_strategy: [
    "候选供应商多维对比",
    "供应商能力雷达",
    "报价区间与采购份额分配",
    "供应商切换成本瀑布",
    "寻源与验厂排期",
    "多供应商策略结论",
  ],
  certification_and_first_leg: [
    "认证时间线排期",
    "认证成本构成瀑布",
    "头程模式成本与时效对比",
    "头程成本与占售价比趋势",
    "库存补货与安全库存区间",
    "断货成本曲线与认证头程结论",
  ],
  keyword_strategy_matrix: [
    "词根、意图、竞争、出价与阶段主矩阵",
    "关键词机会散点",
    "分阶段投放词量与核心词季节性",
    "竞价位置与 ACOS 区间",
    "词根投放漏斗",
  ],
  segment_grade_matrix: [
    "细分赛道评级矩阵 · 章节引导",
    "细分赛道与维度评级矩阵",
  ],
  mind_whitespace_needs: [
    "需求四层",
    "痛点词云与白空间机会排序",
    "机会原声三维打分",
  ],
  problem_solver_concept: [
    "产品概念与竞品证据对标",
    "概念记分卡与核心升级点排序",
  ],
  grade_map: [
    "赛道与价格带评级热力及地图要点",
  ],
  social_demand_triggers: [
    "触发点关注度与需求、文化、认知映射",
    "功能与场景契合度",
    "社媒机会卡",
  ],
  strategy_map: [
    "决策战略地图",
    "关键洞察卡",
  ],
  beta_alpha_quadrant: [
    "机会与胜算决策象限 · 章节引导",
    "市场吸引力与相对胜算四象限",
  ],
  capital_allocation_ruin: [
    "破产概率与下注激进度",
    "下注上限、集中度与风险闸",
  ],
  portfolio_correlation: [
    "候选相关矩阵与伪多元报警",
    "产能、现金占用与有效候选数",
  ],
  personal_entry_window: [
    "入场窗口净值与项目节奏",
    "拥挤饱和赛跑与时点裁决",
  ],
  risk_register_sensitivity_confidence: [
    "风险登记册、最早信号与责任人",
    "风险等级、缓解动作与停止线",
    "概率边界与单位贡献敏感项",
    "关键假设、合规与残余风险",
  ],
  trust_guardrails_methodology: [
    "关键假设与董事会证据阈值",
    "护栏链 L0 → L5 执行结果",
    "多模型 / 多层交叉验证与分歧处理",
    "轻人工终审记录",
    "数据来源清单",
    "方法论、观察窗口与计算规则",
  ],
};

const EXACT_MODULE_PAGE_VISUALS: Partial<Record<ReferenceReportModuleId, readonly ReferencePageVisual[]>> = {
  exec_summary_decision_scorecard: ["kpi_dashboard", "cards_radar_bar", "bullet_chart", "action_list"],
  decision_funnel: ["table_callout", "range_controls", "funnel_table"],
  OP_SCAN: ["combo_dashboard", "line_chart", "radar_heatmap", "bubble_scatter"],
  MKT_STRUCT: ["scenario_table", "marimekko", "box_plot", "kpi_donut_table", "donut_pair", "regression_scatter", "survival_combo"],
  MIND_DECODE: ["radar_diverging_bar", "bubble_scatter", "bar_line_combo", "heatmap", "sankey", "donut_bar_quotes"],
  voc_evidence: ["bar_dashboard", "bar_table", "heatmap_table"],
  competitor_teardown: ["data_table", "competitor_cards", "heatmap", "attack_matrix"],
  CPT_VERIFY: ["table_sparklines", "radar_bar", "bubble_scatter"],
  output_unit_economics_finance: ["table_callout", "combo_dashboard", "bar_line_combo", "fan_chart", "line_chart", "bullet_chart"],
  gtm_plan: ["table_callout", "radar", "data_table", "data_table", "combo_dashboard"],
  crossborder_seller_cockpit: [
    "kpi_cards", "data_table", "bar_line_combo", "heatmap", "waterfall_bar",
    "kpi_cards_table", "bar_line_combo", "range_bars", "range_bars", "kpi_cards",
    "bar_line_combo", "bar_line_combo", "radar", "gantt", "horizontal_bar",
  ],
  supply_chain_sourcing: [
    "waterfall", "kpi_cards_table", "radar", "table_callout", "line_chart",
    "gantt", "radar", "bar_line_combo", "range_bars",
  ],
  ip_compliance: ["data_table", "data_table", "heatmap", "data_table", "horizontal_bar", "waterfall"],
  ppc_traffic_deep_dive: ["combo_dashboard", "bar_line_combo", "data_table", "bubble_scatter", "heatmap_table", "sankey", "bar_line_combo"],
  ab_listing_simulator: [
    "kpi_cards_horizontal_bars", "slopegraph", "horizontal_bar", "funnel_table",
    "sankey", "multi_line", "radar", "slopegraph",
  ],
  pricing_science: ["section_intro", "regression_scatter", "horizontal_bars_line", "data_table", "treemap", "bar_line_combo", "scenario_table"],
  trend_forecast: ["radar", "fan_chart", "gantt", "horizontal_bar", "multi_line", "bar_line_combo", "range_table", "kpi_cards_callout"],
  omnichannel_strategy: ["radar", "bubble_scatter", "data_table", "slopegraph", "data_table", "gantt", "horizontal_bar"],
  scenario_valuation: ["data_table", "bar_line_combo", "multi_line", "range_bars", "scenario_table", "data_table", "kpi_cards", "data_table"],
  competitive_dynamics: ["gantt", "bubble_scatter", "multi_line", "radar", "data_table", "multi_line", "gauge_horizontal_bars"],
  compdeep_five_forces_quant: ["radar", "range_bars", "data_table", "waterfall", "heatmap", "multi_line", "gantt_callout"],
  compdeep_strategic_groups_listing: [
    "section_intro", "regression_scatter", "data_table", "data_table",
    "bar_line_combo", "multi_line", "horizontal_bars_diverging_bars", "verdict_callout",
  ],
  compdeep_moat_priceband_war: ["data_table", "horizontal_bars_heatmap", "marimekko", "range_bars", "waterfall"],
  pd_attr_conjoint: ["verdict_horizontal_bars", "regression_scatter", "data_table", "horizontal_bar", "diverging_bars", "radar", "table_callout"],
  pd_concept_matrix: ["data_table", "heatmap", "data_table", "regression_scatter", "data_table", "radar"],
  pd_quality_return_pareto: ["kpi_cards", "pareto_chart", "data_table", "sankey", "data_table", "gantt", "waterfall"],
  fin_sensitivity_tornado: ["verdict_kpi_cards", "tornado_table", "horizontal_bars_heatmap", "horizontal_bars_pair", "regression_scatter"],
  fin_montecarlo_dist: ["kpi_cards", "range_bars", "line_chart", "line_chart", "bar_line_combo", "data_table", "box_plot"],
  fin_ue_decomp_tree: ["verdict_kpi_cards", "waterfall", "marimekko", "sankey", "data_table", "multi_line", "waterfall", "radar"],
  risk_patent_ip_defense: ["kpi_cards", "data_table", "data_table", "radar", "table_callout", "gantt"],
  risk_cert_compliance_matrix: ["heatmap", "data_table", "table_horizontal_bars", "data_table", "data_table", "range_bars"],
  risk_hijack_platform_defense: ["data_table", "data_table", "horizontal_bar", "sankey", "gantt", "data_table", "multi_line"],
  meta_decision_robustness: ["tornado_table", "data_table", "range_bars", "tree", "heatmap_table", "verdict_callout"],
  meta_assumption_registry: ["section_intro", "data_table", "horizontal_bar", "gantt", "radar", "bar_line_combo", "data_table", "waterfall"],
  meta_evidence_audit: ["data_table", "diverging_bars", "box_plot", "radar", "data_table", "radar", "waterfall"],
  market_size_decomposition: ["verdict_table", "data_table", "waterfall", "marimekko", "radar", "bar_line_combo", "range_bars_callout"],
  price_elasticity: [
    "data_table", "multi_line", "bar_line_combo", "range_bars",
    "diverging_bars", "range_bars", "heatmap_callout",
  ],
  longtail_niche: [
    "section_intro", "regression_scatter", "heatmap_horizontal_bars",
    "data_table", "multi_line", "radar", "gantt_callout",
  ],
  supply_chain_risk_topology: [
    "heatmap", "range_bars", "horizontal_bars_table",
    "gantt", "radar_callout",
  ],
  multi_supplier_strategy: [
    "data_table", "radar", "range_bars_horizontal_bars",
    "waterfall", "gantt", "verdict_callout",
  ],
  certification_and_first_leg: [
    "gantt", "waterfall", "data_table", "bar_line_combo",
    "range_bars", "multi_line_callout",
  ],
  keyword_strategy_matrix: [
    "data_table", "regression_scatter", "horizontal_bars_multi_line",
    "range_bars", "sankey",
  ],
  ad_structure_bidding: [
    "verdict_horizontal_bars", "data_table", "heatmap",
    "bar_line_combo", "multi_line", "sankey", "verdict_callout",
  ],
  offsite_influencer_social: [
    "data_table", "bar_line_combo", "horizontal_bar", "marimekko",
    "multi_line", "gantt", "verdict_callout",
  ],
  segment_grade_matrix: ["section_intro", "grade_matrix"],
  market_map_segment_grade: ["heatmap", "marimekko", "insight_cards"],
  voc_absa_walls: ["data_table", "data_table"],
  mind_whitespace_needs: ["marimekko", "wordcloud_horizontal_bars", "data_table"],
  problem_solver_concept: ["concept_comparison", "kpi_cards_horizontal_bars"],
  grade_map: ["heatmap_kpis"],
  social_demand_triggers: ["horizontal_bars_table", "heatmap", "insight_cards"],
  strategy_map: ["node_link_map", "insight_cards"],
  ev_decision: ["kpi_cards_table", "diverging_bars_callout"],
  beta_alpha_quadrant: ["section_intro_callout", "quadrant_bubble"],
  capital_allocation_ruin: ["bar_line_combo", "kpi_cards_callout"],
  pre_mortem_redteam: ["narrative_cards", "data_table"],
  edge_calibration: ["table_callout"],
  portfolio_correlation: ["heatmap_callout", "kpi_cards"],
  personal_entry_window: ["fan_chart", "dual_line_callout"],
  incumbent_retaliation_game: ["table_callout"],
  risk_register_sensitivity_confidence: [
    "section_intro", "data_table", "bubble_diverging_bars_horizontal_bars", "range_bars",
  ],
  trust_guardrails_methodology: [
    "table_callout", "table_donut_horizontal_bars", "data_table",
    "data_table", "data_table", "method_cards_warning_list",
  ],
};

function visualForPage(moduleId: ReferenceReportModuleId, offset: number): ReferencePageVisual {
  const visuals = EXACT_MODULE_PAGE_VISUALS[moduleId];
  if (!visuals) throw new Error(`Reference page contract has no visuals for ${moduleId}`);
  const expected = REFERENCE_REPORT_MODULE_PAGE_SPANS.find((span) => span.module_id === moduleId)?.page_count;
  if (visuals.length !== expected) {
    throw new Error(`Reference page contract for ${moduleId} has ${visuals.length} visuals; expected ${expected}`);
  }
  const visual = visuals[offset];
  if (!visual) throw new Error(`Reference page contract has no visual for ${moduleId} offset ${offset}`);
  return visual;
}

function roleForPage(
  visual: ReferencePageVisual,
  transition: ReferenceReportSharedTransition | null,
): ReferencePageRole {
  if (transition) return "shared_transition";
  if (visual === "section_intro") return "section_intro";
  if (visual === "section_intro_callout") return "section_intro_callout";
  return "analysis";
}

function layoutForPage(
  visual: ReferencePageVisual,
  role: ReferencePageRole,
): ReferencePageLayout {
  if (role === "cover") return "cover";
  if (role === "contents") return "toc_list";
  if (role === "shared_transition") return "transition";
  if (role === "section_intro" || role === "section_intro_callout") return "section_intro";
  if (/dashboard|kpi_cards|kpi_donut|bar_dashboard/.test(visual)) return "dashboard";
  if (/callout|combo|pair|table$|comparison|cards/.test(visual)) return "split_visual";
  return "single_visual";
}

function referenceBlock(
  page: number,
  moduleId: string,
  id: string,
  title: string,
  visual: ReferencePageVisual,
  sourcePaths: readonly string[],
): ReferencePageReferenceBlock {
  return {
    id: `reference.p${page}.${id}`,
    title,
    visual,
    source_paths: sourcePaths,
    required: true,
    origin: "reference",
  };
}

const FIELD_LEVEL_REFERENCE_SOURCE_PATHS: Readonly<Partial<Record<number, readonly string[]>>> = {
  12: ["modules.decision_funnel.parameter_controls"],
  13: ["modules.decision_funnel.gate_funnel"],
  14: ["modules.OP_SCAN.market_overview"],
  15: ["modules.OP_SCAN.seasonality_input_gate"],
  16: ["modules.OP_SCAN.entry_barrier_matrix"],
  17: ["modules.OP_SCAN.niche_positioning"],
  19: ["modules.MKT_STRUCT.price_band_economics"],
  20: ["modules.MKT_STRUCT.price_distribution_input_gate"],
};

function defaultReferenceBlocks(
  page: number,
  moduleId: ReferenceReportModuleId,
  title: string,
  visual: ReferencePageVisual,
  transition: ReferenceReportSharedTransition | null,
): readonly ReferencePageReferenceBlock[] {
  const critical = criticalReferenceBlocks(page, moduleId);
  if (critical) return critical;
  const sourcePaths = FIELD_LEVEL_REFERENCE_SOURCE_PATHS[page] || (transition
    ? [`modules.${transition.from_module_id}`, `modules.${transition.to_module_id}`]
    : [`modules.${moduleId}`]);
  return [referenceBlock(page, moduleId, moduleId, title, visual, sourcePaths)];
}

function criticalReferenceBlocks(
  page: number,
  moduleId: ReferenceReportModuleId,
): readonly ReferencePageReferenceBlock[] | null {
  const rb = (
    id: string,
    title: string,
    visual: ReferencePageVisual,
    sourcePaths: readonly string[],
  ) => referenceBlock(page, moduleId, id, title, visual, sourcePaths);
  switch (page) {
    case 7:
      return [
        rb("decision_hero", "决策结论、适用范围与硬性放行条件", "decision_hero", ["modules.exec_summary_decision_scorecard"]),
        rb("executive_kpi_dashboard", "董事会核心 KPI 看板", "kpi_dashboard", ["modules.exec_summary_decision_scorecard"]),
      ];
    case 11:
      return [
        rb("assumptions_table", "关键假设、证据基础与失效影响", "data_table", ["modules.exec_summary_decision_scorecard"]),
        rb("decision_funnel_anchor", "FUNNEL 选品决策漏斗章节锚点", "callout", ["modules.decision_funnel"]),
      ];
    case 18:
      return [
        rb("opportunity_sensitivity", "机会分敏感性与稳健性情景表", "scenario_table", ["modules.OP_SCAN.opportunity_sensitivity"]),
        rb("market_structure_anchor", "MKT_STRUCT 市场结构章节锚点", "callout", ["modules.MKT_STRUCT.price_band_economics.market_structure_anchor"]),
      ];
    case 31:
      return [
        rb("voc_whitespace_ranking", "VOC 机会白空间排序", "horizontal_bar", ["modules.voc_evidence.theme_distribution"]),
        rb("voc_negative_aspect_ranking", "负向方面与改良切入点排序", "horizontal_bar", ["modules.voc_evidence.theme_distribution"]),
      ];
    case 34:
      return [
        rb("voc_weighted_rollup", "VOC 按竞品与方面加权汇总", "data_table", ["modules.voc_evidence"]),
        rb("competitor_teardown_anchor", "竞品深度拆解章节锚点", "callout", ["modules.competitor_teardown"]),
      ];
    case 41:
      return [
        rb("candidate_sensitivity", "候选方案价格、转化与成本敏感性", "data_table", ["modules.CPT_VERIFY"]),
        rb("candidate_release_decision", "候选方案放行结论", "verdict_callout", ["modules.CPT_VERIFY"]),
        rb("finance_anchor", "单位经济与财务模型章节锚点", "callout", ["modules.output_unit_economics_finance"]),
      ];
    case 44:
      return [rb("demand_forecast_input_gate", "需求预测区间与不确定性边界", "fan_chart", ["modules.output_unit_economics_finance.demand_forecast_input_gate"])];
    case 47:
      return [
        rb("pricing_scenarios", "三档定价情景对比", "data_table", ["modules.output_unit_economics_finance"]),
        rb("gtm_anchor", "GTM 上市打法章节锚点", "callout", ["modules.gtm_plan"]),
      ];
    case 48:
      return [rb("gtm_positioning_advertising_input_gate", "差异化定位与广告阶段策略", "radar", ["modules.gtm_plan.positioning_advertising_input_gate"])];
    case 49:
      return [rb("gtm_listing_architecture", "Listing 信息架构与证据表达", "data_table", ["modules.gtm_plan.channel_message"])];
    case 50:
      return [rb("gtm_keyword_intent", "关键词分层、意图承接与投放边界", "data_table", ["modules.keyword_strategy_matrix.matrix"])];
    case 51:
      return [rb("gtm_launch_sequence", "上市节奏、库存门与评价闭环", "combo_dashboard", ["modules.gtm_plan.launch_sequence"])];
    case 52:
      return [rb("seller_account_health", "跨境卖家账户健康看板", "kpi_cards", ["modules.crossborder_seller_cockpit"])];
    case 82:
      return [
        rb("ip_risk_summary", "IP 与合规风险总评", "gauge_bar_kpis", ["modules.ip_compliance"]),
        rb("ppc_traffic_mix", "自然、广告与站外流量结构", "bar_dashboard", ["modules.ppc_traffic_deep_dive"]),
        rb("ppc_anchor", "PPC 与流量深研章节锚点", "callout", ["modules.ppc_traffic_deep_dive"]),
      ];
    case 154:
      return [
        rb("moat_conclusion", "空位识别与占位打法结论", "verdict_callout", ["modules.compdeep_moat_priceband_war"]),
        rb("conjoint_anchor", "属性重要度与需求缺口章节锚点", "callout", ["modules.pd_attr_conjoint"]),
        rb("attribute_importance", "属性重要度排序", "horizontal_bar", ["modules.pd_attr_conjoint"]),
      ];
    case 161:
      return [rb("concept_score_matrix", "候选概念矩阵与选型结论", "data_table", ["modules.pd_concept_matrix.concept_matrix"])];
    case 162:
      return [rb("concept_score_heatmap", "概念 × 评估维度评分热力图", "heatmap", ["modules.pd_concept_matrix.concept_matrix"])];
    case 163:
      return [rb("feature_benefit_evidence", "特性-利益-证据（FBE）映射表", "data_table", ["modules.pd_concept_matrix"] )];
    case 164:
      return [rb("cost_differentiation_scatter", "成本增量 × 差异度定位图", "regression_scatter", ["modules.pd_concept_matrix"] )];
    case 165:
      return [rb("ip_design_around", "专利 / IP 风险与规避设计表", "data_table", ["modules.pd_concept_matrix"] )];
    case 166:
      return [
        rb("concept_feasibility_radar", "入选概念可行性基准带雷达", "radar", ["modules.pd_concept_matrix"]),
        rb("concept_freeze_decision", "概念冻结决策", "verdict_callout", ["modules.pd_concept_matrix"]),
      ];
    case 174:
      return [
        rb("quality_close", "质量闭环结论", "verdict_callout", ["modules.pd_quality_return_pareto"]),
        rb("sensitivity_anchor", "多变量敏感性与风险归因章节锚点", "callout", ["modules.fin_sensitivity_tornado"]),
        rb("sensitivity_kpis", "基准净利与波动敞口总览", "kpi_cards", ["modules.fin_sensitivity_tornado"]),
      ];
    case 186:
      return [
        rb("monte_carlo_close", "概率化投资结论", "verdict_callout", ["modules.fin_montecarlo_dist"]),
        rb("unit_economics_anchor", "单位经济分解章节锚点", "callout", ["modules.fin_ue_decomp_tree"]),
        rb("unit_economics_kpis", "单件经济核心指标", "kpi_cards", ["modules.fin_ue_decomp_tree"]),
      ];
    case 234:
      return [
        rb("evidence_audit_close", "证据是否支撑决策的审计结论", "verdict_callout", ["modules.meta_evidence_audit"]),
        rb("market_size_anchor", "市场规模拆解章节锚点", "callout", ["modules.market_size_decomposition"]),
        rb("tam_sam_som_table", "TAM、SAM、SOM 6 列漏斗拆解表", "data_table", ["modules.market_size_decomposition"]),
      ];
    case 277:
      return [
        rb("keyword_strategy_close", "关键词打法结论", "verdict_callout", ["modules.keyword_strategy_matrix"]),
        rb("ad_structure_anchor", "广告结构与竞价章节锚点", "callout", ["modules.ad_structure_bidding"]),
        rb("ad_budget_bars", "SP、SB 与 SD 预算分配", "horizontal_bar", ["modules.ad_structure_bidding"]),
      ];
    case 301:
      return [rb("problem_solver_concept", "产品概念 × 竞品/VOC 证据对标", "concept_comparison", ["modules.problem_solver_concept.translation", "modules.problem_solver_concept.product_concept"])];
    case 302:
      return [
        rb("concept_scorecard", "概念记分卡", "kpi_cards", ["modules.problem_solver_concept"]),
        rb("concept_upgrade_ranking", "核心升级点排序", "horizontal_bar", ["modules.problem_solver_concept.translation"]),
      ];
    case 309:
      return [
        rb("strategy_close", "决策收口 · 4 项 KPI", "kpi_cards", ["modules.strategy_map"]),
        rb("ev_anchor", "EV 该不该由你做 · 期望价值章节锚点", "callout", ["modules.ev_decision"]),
        rb("ev_decision_table", "候选 EV 决策表（Beta × Alpha → 期望值）", "data_table", ["modules.ev_decision"]),
      ];
    case 327:
      return [
        rb("critical_assumptions", "关键假设与董事会证据阈值", "data_table", ["modules.risk_register_sensitivity_confidence"]),
        rb("trust_anchor", "TRUST 可信度与护栏", "callout", ["modules.trust_guardrails_methodology"]),
      ];
    case 328:
      return [
        rb("trust_guardrail_chain", "护栏链 L0 → L5 执行结果", "data_table", ["modules.trust_guardrails_methodology.guardrail_chain"]),
        rb("trust_traceability", "引用可溯源与证据质量审计", "donut", ["modules.trust_guardrails_methodology"]),
      ];
    case 332:
      return [
        rb("trust_methodology_grid", "方法论、观察窗口与计算规则", "method_cards", ["modules.trust_guardrails_methodology.methodology"]),
        rb("trust_limitations", "方法局限、误差来源与缓解", "warning_list", ["modules.trust_guardrails_methodology.limitations"]),
      ];
    default:
      return null;
  }
}

function defaultAugmentationBlocks(page: number): readonly ReferencePageAugmentationBlock[] {
  const blocks: Partial<Record<number, readonly ReferencePageAugmentationBlock[]>> = {
    10: [{
      id: "augmentation.p10.strategy_action_register",
      title: "90 天待办 · 状态、依赖与验收门",
      visual: "data_table",
      source_paths: ["modules.exec_summary_decision_scorecard.action_items", "modules.gtm_plan.action_plan"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    25: [{
      id: "augmentation.p25.strategy_jtbd",
      title: "JTBD · 情境、进展、障碍与验证门",
      visual: "data_table",
      source_paths: ["modules.MIND_DECODE.jtbd", "modules.MIND_DECODE.jtbd_framework"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    26: [{
      id: "augmentation.p26.consumer_psychology_readiness",
      title: "消费者心理任务证据成熟度",
      visual: "heatmap",
      source_paths: ["modules.MIND_DECODE.consumer_psychology.psychology_evidence_readiness"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    27: [{
      id: "augmentation.p27.value_risk_signal_map",
      title: "感知价值信号 × 风险信号",
      visual: "quadrant",
      source_paths: ["modules.MIND_DECODE.consumer_psychology.value_risk_signal_map"],
      required: false,
      origin: "voc",
      placement: "sidecar",
    }],
    28: [{
      id: "augmentation.p28.behavior_mechanism_flow",
      title: "触发 → 动机 → 低摩擦 → 可信证据",
      visual: "sankey",
      source_paths: ["modules.MIND_DECODE.consumer_psychology.behavior_mechanism_flow"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    29: [{
      id: "augmentation.p29.customer_journey_flow",
      title: "端到端消费旅程",
      visual: "sankey",
      source_paths: ["modules.MIND_DECODE.customer_journey.journey_flow"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    30: [{
      id: "augmentation.p30.journey_touchpoint_pain_heatmap",
      title: "旅程阶段 × VOC 主题摩擦",
      visual: "heatmap",
      source_paths: ["modules.MIND_DECODE.customer_journey.touchpoint_pain_heatmap"],
      required: false,
      origin: "voc",
      placement: "sidecar",
    }],
    31: [{
      id: "augmentation.p31.current_real_voc_evidence",
      title: "当前真实 VOC 证据样本与可追溯记录",
      visual: "data_table",
      source_paths: ["modules.voc_evidence.evidence_log", "modules.voc_raw_data.evidence_log"],
      required: false,
      origin: "voc",
      placement: "sidecar",
    }],
    162: [{
      id: "augmentation.p162.aigc_concept_image",
      title: "AIGC 专业场景套图 · 同一产品设计 DNA",
      visual: "concept_image",
      source_paths: ["modules.board_concept.scene_suite", "modules.pd_concept_matrix.product_concept"],
      required: false,
      origin: "aigc",
      placement: "sidecar",
    }],
    163: [{
      id: "augmentation.p163.aigc_orthographic_plan",
      title: "AIGC 正侧顶视图与尺寸评审计划",
      visual: "data_table",
      source_paths: ["modules.pd_concept_matrix.aigc_design_review_pack.required_views"],
      required: false,
      origin: "aigc",
      placement: "sidecar",
    }],
    164: [{
      id: "augmentation.p164.aigc_cmf_system",
      title: "AIGC CMF 与品牌设计系统",
      visual: "data_table",
      source_paths: ["modules.pd_concept_matrix.aigc_design_system.brand_dna"],
      required: false,
      origin: "aigc",
      placement: "sidecar",
    }],
    165: [{
      id: "augmentation.p165.aigc_public_references",
      title: "公开产品设计参考与用途边界",
      visual: "data_table",
      source_paths: ["modules.pd_concept_matrix.aigc_design_system.public_references"],
      required: false,
      origin: "aigc",
      placement: "sidecar",
    }],
    166: [{
      id: "augmentation.p166.aigc_quality_audit",
      title: "AIGC 概念质量审计与工程签核边界",
      visual: "data_table",
      source_paths: ["modules.pd_concept_matrix.aigc_quality_audit.qa_checklist"],
      required: false,
      origin: "aigc",
      placement: "sidecar",
    }],
    291: [{
      id: "augmentation.p291.strategy_stp_overview",
      title: "STP · 细分、目标与定位总览",
      visual: "insight_cards",
      source_paths: ["modules.market_map_segment_grade.stp", "modules.segment_grade_matrix.stp"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    292: [{
      id: "augmentation.p292.strategy_stp_segmentation",
      title: "S · 细分定义、证据与排除边界",
      visual: "data_table",
      source_paths: ["modules.market_map_segment_grade.stp.segmentation", "modules.segment_grade_matrix.segments"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    293: [{
      id: "augmentation.p293.strategy_stp_targeting_matrix",
      title: "T · 候选细分吸引力与公司胜算",
      visual: "data_table",
      source_paths: ["modules.market_map_segment_grade.stp.targeting.candidate_matrix", "modules.market_map_segment_grade.stp.targeting"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    294: [{
      id: "augmentation.p294.strategy_stp_target_selection",
      title: "T · 目标细分取舍与验证门",
      visual: "data_table",
      source_paths: ["modules.market_map_segment_grade.stp.targeting.selection", "modules.market_map_segment_grade.stp.targeting"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    295: [{
      id: "augmentation.p295.strategy_stp_positioning",
      title: "P · 定位声明、理由相信与验证门",
      visual: "insight_cards",
      source_paths: ["modules.market_map_segment_grade.stp.positioning", "modules.gtm_plan.positioning"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    301: [{
      id: "augmentation.p301.aigc_concept_image",
      title: "AIGC 产品概念图",
      visual: "concept_image",
      source_paths: ["modules.problem_solver_concept.product_concept"],
      required: false,
      origin: "aigc",
      placement: "sidecar",
    }],
    302: [
      {
        id: "augmentation.p302.aigc_listing_blueprint",
        title: "AIGC Listing 信息架构",
        visual: "data_table",
        source_paths: ["modules.problem_solver_concept.aigc_listing_blueprint"],
        required: false,
        origin: "aigc",
        placement: "sidecar",
      },
      {
        id: "augmentation.p302.aigc_redteam_validation",
        title: "AIGC 红队验证与上市闸门",
        visual: "data_table",
        source_paths: ["modules.problem_solver_concept.aigc_redteam_validation"],
        required: false,
        origin: "aigc",
        placement: "sidecar",
      },
    ],
    318: [{
      id: "augmentation.p318.strategy_bcg_matrix",
      title: "BCG · 品类组合矩阵与证据状态",
      visual: "data_table",
      source_paths: ["modules.portfolio_correlation.bcg_matrix"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    319: [{
      id: "augmentation.p319.strategy_bcg_capital_actions",
      title: "BCG · 经典数据门与启发式代理动作",
      visual: "kpi_cards",
      source_paths: ["modules.portfolio_correlation.bcg_matrix.portfolio_actions", "modules.portfolio_correlation.bcg_matrix"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
    51: [{
      id: "augmentation.p51.strategy_action_register",
      title: "90 天待办 · 上市节奏、责任与验收",
      visual: "data_table",
      source_paths: ["modules.gtm_plan.action_items", "modules.gtm_plan.action_plan", "modules.exec_summary_decision_scorecard.action_items"],
      required: false,
      origin: "strategy",
      placement: "sidecar",
    }],
  };
  return blocks[page] || [];
}

function sanitizeTopic(value: string): string {
  return String(value || "")
    .replace(/\bB0[A-Z0-9]{5,}\b/gi, "竞品样本")
    .replace(/美式压木纹床头柜|MDF\s*Nightstand|Nightstands?/gi, "目标品类")
    .replace(/折叠露营椅|Camping\s*Chair/gi, "目标品类")
    .replace(/露营椅|单椅/g, "目标产品")
    .replace(/加宽(?:椅脚|抽屉滑轨)/g, "核心差异化属性")
    .replace(/\$\s*\d+(?:\.\d+)?(?:\s*[-–~]\s*\$?\s*\d+(?:\.\d+)?)?/g, "目标价格带")
    .replace(/\b(?:8842|9013|8771|2450|1380|2975(?:\.42)?)\b/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([，。；：、）])/g, "$1")
    .trim();
}

function moduleTitle(moduleId: ReferenceReportModuleId): string {
  return sanitizeTopic(
    CORE_MODULE_TITLES[moduleId] ||
    extMeta[moduleId]?.title ||
    moduleId.replace(/_/g, " "),
  );
}

function sourceTopics(moduleId: ReferenceReportModuleId): {
  topics: string[];
  source: ReferencePagePlanEntry["topic_source"];
} {
  const exact = EXACT_MODULE_PAGE_TOPICS[moduleId];
  if (exact?.length) {
    return { topics: exact.map(sanitizeTopic), source: "reference-page-contract" };
  }
  const curated = CURATED_MODULE_TOPICS[moduleId];
  if (curated?.length) {
    return { topics: curated.map(sanitizeTopic), source: "reference-heading-curated" };
  }
  const subsectionTopics = (extMeta[moduleId]?.subsections || [])
    .map((subsection) => sanitizeTopic(subsection.title || subsection.id || ""))
    .filter(Boolean);
  if (subsectionTopics.length) {
    return { topics: subsectionTopics, source: "ext-meta-subsection" };
  }
  throw new Error(`Reference page contract has no headings for ${moduleId}`);
}

function fitTopics(moduleId: ReferenceReportModuleId, pageCount: number): {
  topics: string[];
  source: ReferencePagePlanEntry["topic_source"];
} {
  const sourced = sourceTopics(moduleId);
  const topics = sourced.topics.filter(Boolean);
  if (topics.length !== pageCount) {
    throw new Error(
      `Reference page contract for ${moduleId} has ${topics.length} headings; expected ${pageCount}`,
    );
  }
  return { source: sourced.source, topics };
}

const frontMatterPages: ReferencePagePlanEntry[] = [
  {
    page: 1,
    kind: "cover",
    module_id: null,
    module_number: null,
    module_title: "选品决策报告",
    page_in_module: null,
    pages_in_module: null,
    title: "封面 · 决策对象与研究范围",
    topic: "品类、市场、数据截止、报告版本与当前决策状态",
    research_question: "本报告针对什么品类、市场和决策时点提供判断？",
    topic_source: "reference-page-contract",
    transition: null,
    role: "cover",
    layout: "cover",
    reference_blocks: [referenceBlock(
      1,
      "front_matter",
      "cover",
      "决策报告封面",
      "cover",
      ["report.title", "report.generated_at", "modules.board_decision"],
    )],
    augmentation_blocks: [],
  },
  ...[
    [1, 14],
    [15, 30],
    [31, 46],
    [47, 61],
    [62, 62],
  ].map(([start, end], index): ReferencePagePlanEntry => ({
    page: index + 2,
    kind: "contents",
    module_id: null,
    module_number: null,
    module_title: "目录 · Contents",
    page_in_module: null,
    pages_in_module: null,
    title: `目录 ${index + 1} / 5 · 模块 ${start === end ? start : `${start}–${end}`}`,
    topic: `模块 ${start === end ? start : `${start}–${end}`} 的章节顺序、起始页与决策链位置`,
    research_question: "读者如何沿着机会、市场、消费者、验证、执行与风险链路定位内容？",
    topic_source: "reference-page-contract",
    transition: null,
    role: "contents",
    layout: "toc_list",
    reference_blocks: [referenceBlock(
      index + 2,
      "front_matter",
      `contents_${index + 1}`,
      `目录模块 ${start === end ? start : `${start}–${end}`}`,
      "toc_list",
      ["report.order", "report.ext_meta", "report.reference_layout.module_page_spans"],
    )],
    augmentation_blocks: [],
  })),
];

export const REFERENCE_MODULE_PAGE_TOPICS = Object.fromEntries(
  REFERENCE_REPORT_MODULE_PAGE_SPANS.map((span) => [
    span.module_id,
    fitTopics(span.module_id, span.page_count).topics.map((topic, offset) => {
      const transition = REFERENCE_REPORT_SHARED_TRANSITIONS_BY_PAGE[span.start_page + offset];
      return transition
        ? `${transition.carryover_title} → ${transition.module_anchor_title}`
        : topic;
    }),
  ]),
) as Record<ReferenceReportModuleId, string[]>;

export const REFERENCE_BODY_PAGE_PLAN: readonly ReferencePagePlanEntry[] =
  REFERENCE_REPORT_MODULE_PAGE_SPANS.flatMap((span) => {
    const fitted = fitTopics(span.module_id, span.page_count);
    const title = moduleTitle(span.module_id);
    return fitted.topics.map((sourceTopic, offset): ReferencePagePlanEntry => {
      const page = span.start_page + offset;
      const transition = REFERENCE_REPORT_SHARED_TRANSITIONS_BY_PAGE[page] || null;
      const topic = REFERENCE_MODULE_PAGE_TOPICS[span.module_id][offset] || sourceTopic;
      const visual = visualForPage(span.module_id, offset);
      const role = roleForPage(visual, transition);
      return {
        page,
        kind: "module",
        module_id: span.module_id,
        module_number: span.reference_number,
        module_title: title,
        page_in_module: offset + 1,
        pages_in_module: span.page_count,
        title: topic,
        topic,
        research_question: transition
          ? `${transition.carryover_title}如何闭环，并为${transition.module_anchor_title}建立可追溯输入？`
          : `${topic}需要哪些可回溯证据、验证方法与停止线？`,
        topic_source: transition ? "reference-heading-curated" : fitted.source,
        transition,
        role,
        layout: layoutForPage(visual, role),
        reference_blocks: defaultReferenceBlocks(page, span.module_id, topic, visual, transition),
        augmentation_blocks: defaultAugmentationBlocks(page),
      };
    });
  });

export const REFERENCE_PAGE_PLAN: readonly ReferencePagePlanEntry[] = [
  ...frontMatterPages,
  ...REFERENCE_BODY_PAGE_PLAN,
];

export const REFERENCE_PAGE_PLAN_BY_NUMBER = Object.fromEntries(
  REFERENCE_PAGE_PLAN.map((page) => [page.page, page]),
) as Record<number, ReferencePagePlanEntry>;

if (
  frontMatterPages.length !== REFERENCE_REPORT_FRONT_MATTER_PAGES ||
  REFERENCE_PAGE_PLAN.length !== REFERENCE_REPORT_TOTAL_PAGES
) {
  throw new Error("Reference page plan does not satisfy the 332-page contract");
}

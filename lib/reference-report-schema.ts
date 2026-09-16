export const REFERENCE_REPORT_SOURCE = "美式压木纹床头柜-选品决策报告.pdf";

export const REFERENCE_REPORT_TOTAL_PAGES = 332;
export const REFERENCE_REPORT_FRONT_MATTER_PAGES = 6;
export const REFERENCE_REPORT_BODY_START_PAGE = 7;
export const REFERENCE_REPORT_FINAL_PAGE_EXCLUSIVE = 333;

export const REFERENCE_REPORT_MODULE_ORDER = [
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
] as const;

export const REFERENCE_REPORT_MODULE_START_PAGES = [
  7, 11, 14, 18, 25, 31, 34, 38, 41, 47, 52, 67, 76, 82, 89, 97,
  104, 112, 119, 127, 134, 141, 149, 154, 161, 167, 174, 179, 186,
  194, 200, 206, 213, 219, 227, 234, 241, 248, 255, 260, 266, 272,
  277, 284, 291, 293, 296, 298, 301, 303, 304, 307, 309, 311, 313,
  315, 317, 318, 320, 322, 323, 327,
] as const;

export type ReferenceReportModuleId = typeof REFERENCE_REPORT_MODULE_ORDER[number];

export type ReferenceReportSharedTransition = {
  page: number;
  from_module_id: ReferenceReportModuleId;
  to_module_id: ReferenceReportModuleId;
  page_owner: "from_module" | "to_module";
  carryover_title: string;
  module_anchor_title: string;
};

// These pages contain content from one module and the adjacent MODULE anchor on
// the same physical PDF page. page_owner preserves the original TOC ownership.
export const REFERENCE_REPORT_SHARED_TRANSITIONS: readonly ReferenceReportSharedTransition[] = [
  {
    page: 11,
    from_module_id: "exec_summary_decision_scorecard",
    to_module_id: "decision_funnel",
    page_owner: "to_module",
    carryover_title: "关键假设与前提",
    module_anchor_title: "选品决策漏斗 · 交互沙盘",
  },
  {
    page: 18,
    from_module_id: "OP_SCAN",
    to_module_id: "MKT_STRUCT",
    page_owner: "to_module",
    carryover_title: "机会分敏感性结论",
    module_anchor_title: "MKT_STRUCT · 市场结构解剖",
  },
  {
    page: 34,
    from_module_id: "voc_evidence",
    to_module_id: "competitor_teardown",
    page_owner: "to_module",
    carryover_title: "VOC 加权 rollup",
    module_anchor_title: "竞品深度拆解",
  },
  {
    page: 41,
    from_module_id: "CPT_VERIFY",
    to_module_id: "output_unit_economics_finance",
    page_owner: "to_module",
    carryover_title: "候选方案敏感性与放行结论",
    module_anchor_title: "单位经济与财务模型",
  },
  {
    page: 47,
    from_module_id: "output_unit_economics_finance",
    to_module_id: "gtm_plan",
    page_owner: "to_module",
    carryover_title: "三档定价情景对比",
    module_anchor_title: "GTM · 上市打法",
  },
  {
    page: 82,
    from_module_id: "ip_compliance",
    to_module_id: "ppc_traffic_deep_dive",
    page_owner: "to_module",
    carryover_title: "IP 合规风险总评",
    module_anchor_title: "广告与流量深研 · PPC & Traffic",
  },
  {
    page: 154,
    from_module_id: "compdeep_moat_priceband_war",
    to_module_id: "pd_attr_conjoint",
    page_owner: "to_module",
    carryover_title: "空位识别与占位打法结论",
    module_anchor_title: "属性重要度与需求缺口引擎（类 Conjoint）",
  },
  {
    page: 174,
    from_module_id: "pd_quality_return_pareto",
    to_module_id: "fin_sensitivity_tornado",
    page_owner: "to_module",
    carryover_title: "质量闭环结论",
    module_anchor_title: "多变量敏感性与风险归因引擎",
  },
  {
    page: 186,
    from_module_id: "fin_montecarlo_dist",
    to_module_id: "fin_ue_decomp_tree",
    page_owner: "to_module",
    carryover_title: "概率化投资结论卡",
    module_anchor_title: "UE 单位经济分解树与成本穿透显微镜",
  },
  {
    page: 234,
    from_module_id: "meta_evidence_audit",
    to_module_id: "market_size_decomposition",
    page_owner: "to_module",
    carryover_title: "审计结论卡：证据是否撑得起 Go",
    module_anchor_title: "市场规模拆解：TAM→SAM→SOM 与可获取份额建模",
  },
  {
    page: 277,
    from_module_id: "keyword_strategy_matrix",
    to_module_id: "ad_structure_bidding",
    page_owner: "to_module",
    carryover_title: "关键词打法结论卡",
    module_anchor_title: "广告结构与竞价",
  },
  {
    page: 309,
    from_module_id: "strategy_map",
    to_module_id: "ev_decision",
    page_owner: "to_module",
    carryover_title: "战略决策收口",
    module_anchor_title: "该不该由你做 · EV 决策收口",
  },
  {
    page: 322,
    from_module_id: "incumbent_retaliation_game",
    to_module_id: "risk_register_sensitivity_confidence",
    page_owner: "from_module",
    carryover_title: "头部反击博弈与两期剪枝",
    module_anchor_title: "风险登记册 + 敏感性 / 置信度",
  },
  {
    page: 327,
    from_module_id: "risk_register_sensitivity_confidence",
    to_module_id: "trust_guardrails_methodology",
    page_owner: "to_module",
    carryover_title: "关键假设登记（置信度 + 证据）",
    module_anchor_title: "TRUST 可信度与护栏 · 方法论与数据来源",
  },
];

export const REFERENCE_REPORT_SHARED_TRANSITIONS_BY_PAGE = Object.fromEntries(
  REFERENCE_REPORT_SHARED_TRANSITIONS.map((transition) => [transition.page, transition]),
) as Partial<Record<number, ReferenceReportSharedTransition>>;

export type ReferenceReportPageSpan = {
  reference_number: number;
  module_id: ReferenceReportModuleId;
  start_page: number;
  end_page: number;
  page_count: number;
};

export const REFERENCE_REPORT_MODULE_PAGE_SPANS: readonly ReferenceReportPageSpan[] =
  REFERENCE_REPORT_MODULE_ORDER.map((moduleId, index) => {
    const startPage = REFERENCE_REPORT_MODULE_START_PAGES[index];
    const endPage = (REFERENCE_REPORT_MODULE_START_PAGES[index + 1]
      ?? REFERENCE_REPORT_FINAL_PAGE_EXCLUSIVE) - 1;
    return {
      reference_number: index + 1,
      module_id: moduleId,
      start_page: startPage,
      end_page: endPage,
      page_count: endPage - startPage + 1,
    };
  });

export const REFERENCE_REPORT_MODULE_PAGE_SPANS_BY_ID = Object.fromEntries(
  REFERENCE_REPORT_MODULE_PAGE_SPANS.map((span) => [span.module_id, span]),
) as Record<ReferenceReportModuleId, ReferenceReportPageSpan>;

export const REFERENCE_REPORT_LAYOUT = {
  contract_version: "metis.reference-report.a4-landscape.332.v4",
  source: REFERENCE_REPORT_SOURCE,
  paper_size: "A4",
  orientation: "landscape",
  total_pages: REFERENCE_REPORT_TOTAL_PAGES,
  front_matter_pages: REFERENCE_REPORT_FRONT_MATTER_PAGES,
  body_pages: REFERENCE_REPORT_TOTAL_PAGES - REFERENCE_REPORT_FRONT_MATTER_PAGES,
  body_start_page: REFERENCE_REPORT_BODY_START_PAGE,
  module_count: REFERENCE_REPORT_MODULE_ORDER.length,
  module_order: REFERENCE_REPORT_MODULE_ORDER,
  module_page_spans: REFERENCE_REPORT_MODULE_PAGE_SPANS,
} as const;

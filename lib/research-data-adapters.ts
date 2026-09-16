export const RESEARCH_DATA_CONTRACT_VERSION = "metis.research-data.v1";

export type ResearchEvidenceClass =
  | "observed_fact"
  | "coded_interpretation"
  | "management_assumption"
  | "aigc_hypothesis"
  | "future_measurement";

export type ResearchDataDomain =
  | "search_demand"
  | "review_voc"
  | "behavioral_analytics"
  | "advertising"
  | "orders_returns"
  | "service_logistics"
  | "survey_concept_test";

export type ResearchObservation = {
  observation_id: string;
  adapter_id: string;
  domain: ResearchDataDomain;
  evidence_class: ResearchEvidenceClass;
  metric: string;
  value: string | number | boolean | null;
  unit: string | null;
  marketplace: string;
  channel: string;
  subject_type: string;
  subject_id: string;
  occurred_at: string | null;
  observed_at: string;
  source_ref: string;
  source_hash: string | null;
  dimensions: Record<string, string | number | boolean | null>;
};

export type ResearchObservationBatch = {
  contract_version: typeof RESEARCH_DATA_CONTRACT_VERSION;
  adapter_id: string;
  cursor: string | null;
  complete: boolean;
  observations: ResearchObservation[];
  quality: {
    received: number;
    accepted: number;
    rejected: number;
    duplicate_count: number;
    warnings: string[];
  };
};

export type ResearchAdapterRequest = {
  marketplace: string;
  category: string;
  subjects: string[];
  start_at: string;
  end_at: string;
  cursor?: string | null;
};

export interface ResearchDataAdapter {
  readonly id: string;
  readonly domain: ResearchDataDomain;
  fetch(request: ResearchAdapterRequest): Promise<ResearchObservationBatch>;
}

type AdapterRegistryEntry = {
  id: string;
  domain: ResearchDataDomain;
  status: "interface_ready_adapter_pending";
  intended_sources: string[];
  metrics: string[];
  required_dimensions: string[];
  freshness_sla: string;
  decision_uses: string[];
  validation_gate: string;
};

const ADAPTERS: AdapterRegistryEntry[] = [
  {
    id: "search-demand-adapter",
    domain: "search_demand",
    status: "interface_ready_adapter_pending",
    intended_sources: ["Amazon Brand Analytics / SQP", "Google Trends", "approved keyword provider"],
    metrics: ["query_volume", "query_growth", "query_share", "seasonality_index"],
    required_dimensions: ["query", "marketplace", "week", "device", "source"],
    freshness_sla: "weekly",
    decision_uses: ["需求趋势", "季节性", "关键词优先级"],
    validation_gate: "至少 24 个月连续同口径时序；缺货、促销与口径变化必须标注",
  },
  {
    id: "review-voc-adapter",
    domain: "review_voc",
    status: "interface_ready_adapter_pending",
    intended_sources: ["approved retailer review feed", "customer service transcripts", "survey verbatims"],
    metrics: ["review_event", "aspect_code", "sentiment", "verified_purchase", "rating"],
    required_dimensions: ["product_id", "variant_id", "locale", "event_time", "source", "dedupe_key"],
    freshness_sla: "daily",
    decision_uses: ["VOC 主题", "心理障碍", "旅程摩擦", "产品 CTQ"],
    validation_gate: "保留原文权限、转述、来源、时间和去重键；公开覆盖基数不得冒充逐条编码样本",
  },
  {
    id: "behavior-analytics-adapter",
    domain: "behavioral_analytics",
    status: "interface_ready_adapter_pending",
    intended_sources: ["approved first-party web analytics", "product detail interaction events"],
    metrics: ["view", "engaged_view", "comparison", "add_to_cart", "checkout", "purchase"],
    required_dimensions: ["anonymous_user_id", "session_id", "touchpoint", "experiment_id", "event_time"],
    freshness_sla: "hourly",
    decision_uses: ["消费旅程漏斗", "触点摩擦", "信息架构实验"],
    validation_gate: "事件字典、同意范围、机器人过滤、归因窗口和漏斗分母通过审计后才计算转化",
  },
  {
    id: "advertising-adapter",
    domain: "advertising",
    status: "interface_ready_adapter_pending",
    intended_sources: ["Amazon Ads", "approved retail media platform"],
    metrics: ["impressions", "clicks", "spend", "orders", "sales", "search_term"],
    required_dimensions: ["campaign_id", "ad_group_id", "target", "match_type", "placement", "day"],
    freshness_sla: "daily",
    decision_uses: ["触达成本", "搜索意图", "获客止损线"],
    validation_gate: "归因窗口、币种、税费、自然单与广告单口径固定；不得用平台归因销售替代财务结算",
  },
  {
    id: "orders-returns-adapter",
    domain: "orders_returns",
    status: "interface_ready_adapter_pending",
    intended_sources: ["ERP / OMS", "Amazon orders", "RMA system"],
    metrics: ["net_sales", "unit_contribution", "return", "refund", "return_reason"],
    required_dimensions: ["order_id", "line_id", "sku", "channel", "order_time", "maturity_state"],
    freshness_sla: "daily",
    decision_uses: ["单位经济", "成熟订单", "退货原因", "BCG 输入"],
    validation_gate: "订单完成适用退货窗并额外观察 7 天后才进入成熟订单分母；退款和费用必须可对账",
  },
  {
    id: "service-logistics-adapter",
    domain: "service_logistics",
    status: "interface_ready_adapter_pending",
    intended_sources: ["WMS / TMS", "carrier scans", "customer service / parts tickets"],
    metrics: ["on_time_delivery", "damage", "split_shipment", "missing_part", "resolution_time"],
    required_dimensions: ["order_id", "package_id", "route", "carrier", "event_time", "reason_code"],
    freshness_sla: "daily",
    decision_uses: ["交付旅程", "包装风险", "补件 SLA", "自有物流优势"],
    validation_gate: "包裹、订单、工单和补件必须可关联；关闭工单不等于消费者问题已解决",
  },
  {
    id: "survey-concept-test-adapter",
    domain: "survey_concept_test",
    status: "interface_ready_adapter_pending",
    intended_sources: ["approved survey panel", "concept test platform", "in-home usability study"],
    metrics: ["task_success", "choice", "willingness_to_pay", "perceived_value", "perceived_risk"],
    required_dimensions: ["respondent_id", "screening_cell", "stimulus_id", "randomization_cell", "response_time"],
    freshness_sla: "per study",
    decision_uses: ["消费者心理验证", "STP", "概念/价格测试", "使用旅程"],
    validation_gate: "样本筛选、随机化、刺激物版本、排除规则和预注册指标完整后才升级假设状态",
  },
];

export function buildResearchDataAdapterRegistry(category: string, marketplace = "Amazon US") {
  return {
    contract_version: RESEARCH_DATA_CONTRACT_VERSION,
    category,
    marketplace,
    status: "INTERFACES_READY_ADAPTERS_PENDING",
    evidence_classes: {
      observed_fact: "来自可审计原始记录，保留来源、观察时点与口径",
      coded_interpretation: "研究员或规则对观察事实的编码，不等于市场发生率",
      management_assumption: "管理层用于情景和闸门的显式输入",
      aigc_hypothesis: "仅用于概念发散或研究设计，不能替代消费者证据",
      future_measurement: "接口已定义但真实数据尚未接入，当前保持 PENDING",
    },
    adapters: ADAPTERS.map((adapter) => ({ ...adapter })),
    ingestion_rules: [
      "每条观测必须有稳定 observation_id、adapter_id、source_ref、observed_at 和证据类别",
      "原始事实不可被模型输出覆盖；派生指标必须保留公式、输入 ID、版本和责任人",
      "跨源合并前统一市场、渠道、SKU/变体、币种、时区和观察窗口",
      "缺失输入保持 PENDING；不得以 0、均值、模型补数或 AIGC 文本静默替代",
      "个人数据、评论原文和私域事件按同意范围、最小权限、保留期和删除请求治理",
    ],
  };
}

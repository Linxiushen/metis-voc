import { finalizeReportForPersistence } from "./report-integrity";
import type { KeepaMoreProduct } from "./keepamore";
import { buildReferenceBoardReport } from "./board-reports";
import { REFERENCE_REPORT_MODULE_ORDER } from "./reference-report-schema";
import { buildVocEvidence } from "./voc-evidence";

type JsonObject = Record<string, unknown>;

const AMAZON_US_DOMAIN = 1;
const AMAZON_US_MARKETPLACE = "Amazon US";
const AMAZON_US_CURRENCY = "USD";

export type KeepaMoreProductEvidence = {
  asin: string;
  title: string;
  brand: string | null;
  image_url: string | null;
  amazon_url: string;
  current_price_usd: number | null;
  average_price_30d_usd: number | null;
  average_price_90d_usd: number | null;
  sales_rank: number | null;
  sales_rank_drops_30d: number | null;
  rating: number | null;
  review_count: number | null;
  monthly_sold: number | null;
  offer_count: number | null;
  buy_box_is_fba: boolean | null;
  search_position?: number | null;
  source_queries?: string[];
  query_hit_count?: number | null;
  observations?: KeepaMoreSearchObservation[];
};

export type KeepaMoreSearchObservation = {
  query: string;
  batch: number | string;
  search_position: number | null;
  observed_at: string;
  source_url?: string | null;
};

export type KeepaMoreResearchDataset = {
  keyword: string;
  marketplace: string;
  domain: number;
  observed_at: string;
  products: KeepaMoreProductEvidence[];
  source_urls: string[];
  estimated_units: number;
  warnings: string[];
  provider_errors: string[];
  acquisition?: "api" | "free_export";
  source_file?: string | null;
  quota?: {
    remaining: number | null;
    refill_at: string | null;
  };
  queries?: string[];
  batch_count?: number;
};

export function keepaMoreProductToEvidence(
  product: KeepaMoreProduct,
): KeepaMoreProductEvidence {
  const sourceQueries = product.sourceQueries || [];
  const observations = (product.searchObservations || []).map((observation, index) => {
    const raw = observation as unknown as JsonObject;
    const query = String(observation.query || raw.query || "").trim();
    const sourceQueryIndex = sourceQueries.findIndex((item) =>
      item.localeCompare(query, undefined, { sensitivity: "base" }) === 0
    );
    return {
      query,
      batch: String(raw.batch || (sourceQueryIndex >= 0 ? sourceQueryIndex + 1 : index + 1)),
      search_position: finite(raw.search_position ?? observation.position),
      observed_at: String(raw.observed_at || observation.observedAt || product.lastUpdate || ""),
      source_url: present(raw.source_url) ? String(raw.source_url) : null,
    };
  }).filter((observation) => observation.query);
  return {
    asin: product.asin,
    title: product.title || product.asin,
    brand: product.brand,
    image_url: product.imageUrls[0] || null,
    amazon_url: `https://www.amazon.com/dp/${product.asin}`,
    current_price_usd: product.currentPrice?.amount ?? null,
    average_price_30d_usd: product.averagePrice30d?.amount ?? null,
    average_price_90d_usd: product.averagePrice90d?.amount ?? null,
    sales_rank: product.salesRank,
    sales_rank_drops_30d: product.salesRankDrops30d,
    rating: product.rating,
    review_count: product.reviewCount,
    monthly_sold: product.monthlySold,
    offer_count: product.totalOfferCount,
    buy_box_is_fba: product.buyBoxIsFba,
    search_position: product.searchPosition,
    source_queries: sourceQueries,
    query_hit_count: sourceQueries.length || observations.length || null,
    observations,
  };
}

const MERGEABLE_PRODUCT_FIELDS: readonly (keyof KeepaMoreProductEvidence)[] = [
  "title",
  "brand",
  "image_url",
  "amazon_url",
  "current_price_usd",
  "average_price_30d_usd",
  "average_price_90d_usd",
  "sales_rank",
  "sales_rank_drops_30d",
  "rating",
  "review_count",
  "monthly_sold",
  "offer_count",
  "buy_box_is_fba",
  "search_position",
  "query_hit_count",
];

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function productCompleteness(product: KeepaMoreProductEvidence): number {
  return MERGEABLE_PRODUCT_FIELDS.reduce(
    (count, field) => count + (present(product[field]) ? 1 : 0),
    0,
  );
}

function observationKey(observation: KeepaMoreSearchObservation): string {
  return [
    observation.query,
    observation.batch,
    observation.search_position ?? "PENDING",
    observation.observed_at,
  ].join("|");
}

export function mergeKeepaMoreResearchDatasets(
  input: KeepaMoreResearchDataset | readonly KeepaMoreResearchDataset[],
): KeepaMoreResearchDataset {
  const datasets = (Array.isArray(input) ? input : [input]) as readonly KeepaMoreResearchDataset[];
  if (!datasets.length) throw new Error("KeepaMore 多批次合并至少需要一个数据集");
  datasets.forEach(requireAmazonUsDataset);

  const productsByAsin = new Map<string, KeepaMoreProductEvidence>();
  const queries: string[] = [];
  datasets.forEach((dataset, datasetIndex) => {
    const query = String(dataset.keyword || "").trim();
    if (query && !queries.includes(query)) queries.push(query);
    for (const additional of dataset.queries || []) {
      const normalized = String(additional || "").trim();
      if (normalized && !queries.includes(normalized)) queries.push(normalized);
    }
    dataset.products.forEach((product, productIndex) => {
      const asin = String(product.asin || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) return;
      const productQueries = [...new Set((product.source_queries || []).map((item) => String(item || "").trim()).filter(Boolean))];
      for (const productQuery of productQueries) {
        if (!queries.includes(productQuery)) queries.push(productQuery);
      }
      const fallbackQueries = productQueries.length ? productQueries : [query];
      const fallbackObservations: KeepaMoreSearchObservation[] = fallbackQueries.map((productQuery, queryIndex) => ({
        query: productQuery,
        batch: productQueries.length ? queryIndex + 1 : datasetIndex + 1,
        search_position: finite(product.search_position) ?? productIndex + 1,
        observed_at: dataset.observed_at,
        source_url: dataset.source_urls[0] || null,
      }));
      const candidate: KeepaMoreProductEvidence = {
        ...product,
        asin,
        source_queries: productQueries,
        query_hit_count: product.query_hit_count ?? (productQueries.length || null),
        observations: product.observations?.length
          ? product.observations
          : fallbackObservations,
      };
      const current = productsByAsin.get(asin);
      if (!current) {
        productsByAsin.set(asin, candidate);
        return;
      }
      const primary = productCompleteness(candidate) > productCompleteness(current)
        ? candidate
        : current;
      const secondary = primary === candidate ? current : candidate;
      const merged = { ...primary } as KeepaMoreProductEvidence;
      const mutable = merged as unknown as JsonObject;
      for (const field of MERGEABLE_PRODUCT_FIELDS) {
        if (!present(merged[field]) && present(secondary[field])) mutable[field] = secondary[field];
      }
      merged.source_queries = [...new Set([
        ...(current.source_queries || []),
        ...(candidate.source_queries || []),
      ])];
      const observationMap = new Map<string, KeepaMoreSearchObservation>();
      for (const observation of [...(current.observations || []), ...(candidate.observations || [])]) {
        observationMap.set(observationKey(observation), observation);
      }
      merged.observations = [...observationMap.values()];
      productsByAsin.set(asin, merged);
    });
  });

  const latest = [...datasets].sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at)))[0];
  const acquisitions = new Set(datasets.map((dataset) => dataset.acquisition || "api"));
  const sourceFiles = [...new Set(datasets.map((dataset) => dataset.source_file).filter(Boolean))];
  return {
    keyword: queries.join(" + ") || String(latest.keyword || "").trim(),
    queries,
    batch_count: datasets.reduce((sum, dataset) => sum + Math.max(1, Number(dataset.batch_count || 1)), 0),
    marketplace: latest.marketplace,
    domain: AMAZON_US_DOMAIN,
    observed_at: latest.observed_at,
    products: [...productsByAsin.values()],
    source_urls: [...new Set(datasets.flatMap((dataset) => dataset.source_urls || []))],
    estimated_units: datasets.reduce((sum, dataset) => sum + Math.max(0, Number(dataset.estimated_units || 0)), 0),
    warnings: [...new Set(datasets.flatMap((dataset) => dataset.warnings || []))],
    provider_errors: [...new Set(datasets.flatMap((dataset) => dataset.provider_errors || []))],
    acquisition: acquisitions.size === 1 && acquisitions.has("free_export") ? "free_export" : "api",
    source_file: sourceFiles.length ? sourceFiles.join(" + ") : null,
    quota: latest.quota,
  };
}

function finite(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function rounded(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function percentile(values: number[], position: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, position));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return rounded(sorted[lower]);
  return rounded(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

function formatUsd(value: number | null): string {
  return value == null ? "PENDING" : `$${value.toFixed(2)}`;
}

function requireAmazonUsDataset(dataset: KeepaMoreResearchDataset): void {
  const marketplace = String(dataset.marketplace || "")
    .replace(/^Amazon\s+/i, "")
    .trim()
    .toUpperCase();
  if (dataset.domain !== AMAZON_US_DOMAIN || marketplace !== "US") {
    throw new Error(
      `KeepaMore 部分实证报告当前仅支持 Amazon US（domain=1, currency=USD）；收到 marketplace=${dataset.marketplace || "PENDING"}, domain=${dataset.domain}`,
    );
  }
}

function formatInteger(value: number | null): string | number {
  return value == null ? "PENDING" : Math.round(value);
}

function coverage(products: KeepaMoreProductEvidence[], field: keyof KeepaMoreProductEvidence): string {
  const observed = products.filter((product) => product[field] != null).length;
  return `${observed}/${products.length}`;
}

function brandRows(products: KeepaMoreProductEvidence[]): unknown[][] {
  const counts = new Map<string, number>();
  for (const product of products) {
    const brand = product.brand?.trim() || "未标注品牌";
    counts.set(brand, (counts.get(brand) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([brand, count]) => [brand, count, rounded((count / Math.max(1, products.length)) * 100, 1)]);
}

function priceBandRows(products: KeepaMoreProductEvidence[]): unknown[][] {
  const prices = products
    .map((product) => finite(product.current_price_usd))
    .filter((value): value is number => value != null && value > 0);
  if (!prices.length) return [];
  const q1 = percentile(prices, 0.25) as number;
  const median = percentile(prices, 0.5) as number;
  const q3 = percentile(prices, 0.75) as number;
  const bands = [
    { label: "入门段", min: -Infinity, max: q1 },
    { label: "主流低段", min: q1, max: median },
    { label: "主流高段", min: median, max: q3 },
    { label: "溢价段", min: q3, max: Infinity },
  ];
  return bands.map((band, index) => {
    const values = prices.filter((price) =>
      price >= band.min && (index === bands.length - 1 ? price <= band.max : price < band.max)
    );
    const range = index === 0
      ? `< ${formatUsd(q1)}`
      : index === bands.length - 1
        ? `>= ${formatUsd(q3)}`
        : `${formatUsd(band.min)} - ${formatUsd(band.max)}`;
    return [band.label, range, values.length, rounded((values.length / prices.length) * 100, 1)];
  });
}

function sourceRegister(dataset: KeepaMoreResearchDataset): JsonObject {
  const imported = dataset.acquisition === "free_export";
  const rows = dataset.source_urls.map((url, index) => [
    `KM-${String(index + 1).padStart(2, "0")}`,
    imported ? "KeepaMore 免费网页导出" : "KeepaMore HTTP API",
    imported
      ? `用户上传的商品聚合字段${dataset.source_file ? `（${dataset.source_file}）` : ""}`
      : index === 0 ? "Amazon 自然搜索结果与商品摘要" : "商品详情补充",
    dataset.observed_at,
    "Medium",
    url,
    "第三方 Keepa 代理；不含评论正文；商业展示与长期存储权需合同确认",
  ]);
  return {
    columns: ["来源 ID", "来源", "证据范围", "观察时间", "置信度", "链接", "限制"],
    rows,
  };
}

export function buildKeepaMorePartialReport(
  dataset: KeepaMoreResearchDataset,
  researchBrief: JsonObject = {},
): JsonObject {
  requireAmazonUsDataset(dataset);
  const products = dataset.products.filter((product) => /^[A-Z0-9]{10}$/.test(product.asin));
  if (!products.length) throw new Error("KeepaMore 没有返回可用的 Amazon 商品记录");

  const prices = products
    .map((product) => finite(product.current_price_usd))
    .filter((value): value is number => value != null && value > 0);
  const observedAt = dataset.observed_at || new Date().toISOString();
  const keyword = dataset.keyword.trim();
  const imported = dataset.acquisition === "free_export";
  const providerLabel = imported ? "KeepaMore 免费网页导出" : "KeepaMore API";
  const warnings = [
    ...dataset.warnings,
    ...dataset.provider_errors.map((error) => `部分商品补充失败：${error}`),
  ];
  const modules: JsonObject = {
    keepamore_live_summary: {
      evidence_state: {
        status: "PARTIAL_VERIFIED",
        body: `商品、价格、排名、评分与评论数为 ${providerLabel} 的可追溯观察；销量区间和排名跌次只能作为代理指标。`,
      },
      key_metrics: {
        columns: ["指标", "观察值", "口径"],
        rows: [
          ["检索关键词", keyword, "Amazon 自然搜索结果，广告位已由提供方剔除"],
          ["有效商品样本", products.length, "去除无效 ASIN 后的返回记录"],
          ["当前价格中位数（USD）", formatUsd(percentile(prices, 0.5)), `有价样本 ${prices.length}/${products.length}`],
          ["当前价格 P25-P75（USD）", `${formatUsd(percentile(prices, 0.25))} - ${formatUsd(percentile(prices, 0.75))}`, "仅当前快照，不代表成交价"],
          ["评分覆盖", coverage(products, "rating"), "评分为商品聚合值"],
          ["评论数覆盖", coverage(products, "review_count"), "评论正文未提供"],
          ["月售区间覆盖", coverage(products, "monthly_sold"), "Amazon 展示的粗粒度区间，不是精确销量"],
          ["BSR 覆盖", coverage(products, "sales_rank"), "类目排名口径可能因产品所属节点不同而不可直接横比"],
        ],
      },
      data_quality: {
        columns: ["检查项", "状态", "说明"],
        rows: [
          [imported ? "导出文件来源可追溯" : "API 来源可追溯", "PASS", `${dataset.source_urls.length} 个来源引用已登记`],
          ["VOC 评论正文", "PENDING", "KeepaMore 不返回评论正文，不能计算真实痛点频次或消费者心理"],
          ["精确销量", "PENDING", "monthlySold 为 Amazon 展示区间，BSR drops 仅是代理变量"],
          ["单位经济", "PENDING", "缺少 FOB、履约、广告、退货和税费的同口径真实输入"],
        ],
      },
      provider_warnings: warnings.length ? warnings : ["无提供方级警告"],
    },
    competitive_raw_data: {
      columns: [
        "ASIN", "商品", "品牌", "当前价（USD）", "30天均价（USD）", "90天均价（USD）", "BSR",
        "30天排名跌次", "评分", "评论数", "月售展示", "Offer", "Amazon",
      ],
      rows: products.map((product) => [
        product.asin,
        product.title,
        product.brand || "未标注",
        formatUsd(product.current_price_usd),
        formatUsd(product.average_price_30d_usd),
        formatUsd(product.average_price_90d_usd),
        formatInteger(product.sales_rank),
        formatInteger(product.sales_rank_drops_30d),
        product.rating ?? "PENDING",
        formatInteger(product.review_count),
        formatInteger(product.monthly_sold),
        formatInteger(product.offer_count),
        product.amazon_url,
      ]),
    },
    keepamore_market_structure: {
      price_bands: {
        columns: ["价格段", "当前价范围（USD）", "商品数", "样本占比 %"],
        rows: priceBandRows(products),
        note: "价格段按当前有价样本四分位切分，仅描述本次自然搜索返回样本。",
      },
      brand_presence: {
        columns: ["品牌", "商品数", "样本占比 %"],
        rows: brandRows(products),
        note: "这是搜索结果样本中的品牌出现率，不等于销售份额或市场份额。",
      },
    },
    keepamore_price_rank_monitor: {
      columns: ["ASIN", "当前价（USD）", "30天均价（USD）", "90天均价（USD）", "当前 BSR", "30天排名跌次", "FBA Buy Box"],
      rows: products.map((product) => [
        product.asin,
        formatUsd(product.current_price_usd),
        formatUsd(product.average_price_30d_usd),
        formatUsd(product.average_price_90d_usd),
        formatInteger(product.sales_rank),
        formatInteger(product.sales_rank_drops_30d),
        product.buy_box_is_fba == null ? "PENDING" : product.buy_box_is_fba ? "是" : "否",
      ]),
      note: "本模块仅支持 Amazon US；价格单位已从美分（cents）转为 USD；-1/-2 已转成 PENDING。排名越小越靠前，但不同类目节点不可直接比较。",
    },
    evidence_gap_gate: {
      status: "PENDING",
      reason: "当前只有竞争商品与价格/排名层证据，尚不足以形成猫窝产品的进入、定价、备货或概念冻结结论。",
      required_inputs: [
        "真实评论正文与去重后的 VOC 编码样本",
        "Amazon ABA/SQP 搜索需求与至少 52 周趋势",
        "自有品牌订单、广告、退货、客服与物流数据",
        "目标产品 FOB、包装、头程、履约与税费",
        "消费者概念测试、支付意愿与场景任务数据",
      ],
      gates: {
        columns: ["决策模块", "当前状态", "下一步数据"],
        rows: [
          ["市场竞争", "PARTIAL", "补齐类目节点、BSR 历史与更多搜索页"],
          ["VOC / 消费者心理", "PENDING", "接入评论正文与真实消费者研究"],
          ["单位经济", "PENDING", "接入真实成本与广告/退货率"],
          ["供应链与合规", "PENDING", "输入尺寸、材料、标签、测试与物流约束"],
          ["AIGC 场景套图", "BLOCKED", "产品定义通过人工 Gate 后再生成"],
        ],
      },
    },
    source_register: sourceRegister(dataset),
    keepamore_methodology: {
      request: {
        keyword,
        marketplace: AMAZON_US_MARKETPLACE,
        domain: dataset.domain,
        currency: AMAZON_US_CURRENCY,
        observed_at: observedAt,
        estimated_units: dataset.estimated_units,
        quota_remaining: dataset.quota?.remaining ?? "未返回",
        quota_refill_at: dataset.quota?.refill_at ?? "未返回",
        acquisition: imported ? "free_web_export" : "http_api",
        source_file: dataset.source_file || "未提供",
      },
      transformations: [
        "仅接收 Amazon US（domain=1）数据；所有价格由整数美分（cents）除以 100 转为 USD；-1/-2 视为缺失",
        "评分读取 csv[16] 或摘要等价字段；评论数读取 csv[17] 或摘要等价字段",
        "ASIN 去重后再进入报告；失败的批量商品保留提供方 errorId 或错误摘要",
        imported
          ? "上传文件仅在服务端解析；报告登记 SHA-256 来源引用，不保存浏览器侧凭据"
          : "请求地址登记时移除 X-API-Key，浏览器和报告不接触密钥",
      ],
      limitations: [
        "KeepaMore 是第三方 Keepa 代理服务，不是 Keepa GmbH 官方域名",
        "公开条款未明确多租户展示、长期落库或 AIGC 衍生使用权，生产采购前需书面确认",
        "本数据源不提供评论正文，因此不能单独完成 VOC、STP、消费者旅程或心理分析",
      ],
    },
    research_brief: {
      status: Object.keys(researchBrief).length ? "APPLIED" : "PENDING",
      input: Object.keys(researchBrief).length ? researchBrief : { note: "未提交公司能力、成本和产品约束" },
    },
  };

  const order = [
    "keepamore_live_summary",
    "competitive_raw_data",
    "keepamore_market_structure",
    "keepamore_price_rank_monitor",
    "evidence_gap_gate",
    "source_register",
    "keepamore_methodology",
    "research_brief",
  ];
  const report: JsonObject = {
    title: `${keyword}｜KeepaMore 部分实证研究`,
    category: keyword,
    marketplace: AMAZON_US_MARKETPLACE,
    currency: AMAZON_US_CURRENCY,
    verdict: "部分实证完成，关键决策待补证",
    evidence_mode: "partial_verified_research",
    decision_readiness: "insufficient_evidence",
    demo_note: `本报告已使用真实 ${providerLabel} 商品证据，不是模板数据；但尚无评论正文、精确销量、真实成本与消费者验证，因此不得作为立项、备货或上市批准。`,
    concept_generation: {
      eligible: false,
      reason: "当前仅完成商品与价格/排名层实证；VOC、成本、供应链和消费者验证未通过，不生成产品概念图。",
    },
    observed_at: observedAt,
    provider: imported ? providerLabel : "KeepaMore",
    provider_contract: imported ? "metis.keepamore-export.v1" : "metis.keepamore.v1",
    estimated_provider_units: dataset.estimated_units,
    order,
    modules,
    ext_meta: {
      keepamore_live_summary: { title: "猫窝市场快照｜真实商品证据与覆盖度", nav_short: "市场快照" },
      keepamore_market_structure: { title: "价格与品牌结构｜搜索样本分布", nav_short: "市场结构" },
      keepamore_price_rank_monitor: { title: "价格 / BSR 监测｜当前与历史窗口", nav_short: "价格排名" },
      evidence_gap_gate: { title: "决策闸门｜当前证据缺口与下一步", nav_short: "证据闸门" },
      keepamore_methodology: { title: "KeepaMore 方法与数据边界", nav_short: "方法" },
      research_brief: { title: "研究输入基线", nav_short: "研究输入" },
    },
  };
  return finalizeReportForPersistence(report);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function pendingEvidenceState(moduleId: string): JsonObject {
  return {
    title: "证据不足｜保留参考框架与补数合同",
    status: "PENDING",
    tag: "INSUFFICIENT_EVIDENCE",
    body: `模块 ${moduleId} 尚无可审计输入。当前只保留分析结构、方法、验证门和停止线；不得由模型补造市场数值、VOC、单位经济、消费者偏好或产品结论。`,
    required_inputs: [
      "与本模块口径一致的原始数据或实验记录",
      "来源、观察时间、市场、单位与去重规则",
      "责任人、验证阈值、失败动作与人工签核",
    ],
  };
}

function pendingTable(columns: string[], message: string): JsonObject {
  return {
    status: "PENDING",
    columns,
    rows: [["PENDING", message]],
    note: "缺失输入保持 PENDING；不得用其他品类数据、评分聚合值或模型生成值填空。",
  };
}

export function buildKeepaMoreReferenceReport(
  input: KeepaMoreResearchDataset | readonly KeepaMoreResearchDataset[],
  researchBrief: JsonObject = {},
): JsonObject {
  const dataset = mergeKeepaMoreResearchDatasets(input);
  const partial = buildKeepaMorePartialReport(dataset, researchBrief);
  const products = dataset.products.filter((product) => /^[A-Z0-9]{10}$/.test(product.asin));
  if (!products.length) throw new Error("KeepaMore 没有返回可用的 Amazon 商品记录");

  const prices = products
    .map((product) => finite(product.current_price_usd))
    .filter((value): value is number => value != null && value > 0);
  const priceP25 = percentile(prices, 0.25);
  const priceMedian = percentile(prices, 0.5);
  const priceP75 = percentile(prices, 0.75);
  const workingPriceAnchor = priceMedian || 0;
  const observedAt = dataset.observed_at || new Date().toISOString();
  const observedDate = observedAt.slice(0, 10);
  const queries = dataset.queries?.length
    ? dataset.queries
    : String(dataset.keyword || "").split(" + ").map((query) => query.trim()).filter(Boolean);
  const queryAsins = new Map<string, Set<string>>();
  for (const product of products) {
    const observations = product.observations?.length
      ? product.observations
      : [{
        query: queries[0] || dataset.keyword,
        batch: 1,
        search_position: product.search_position ?? null,
        observed_at: observedAt,
      }];
    for (const observation of observations) {
      const query = String(observation.query || "未登记关键词").trim();
      if (!queryAsins.has(query)) queryAsins.set(query, new Set());
      queryAsins.get(query)?.add(product.asin);
    }
  }
  const uniqueBrands = new Set(products.map((product) => product.brand?.trim()).filter(Boolean)).size;
  const imported = dataset.acquisition === "free_export";
  const providerLabel = imported ? "KeepaMore 免费网页导出" : "KeepaMore API";
  const providerContract = imported ? "metis.keepamore-export.v1" : "metis.keepamore.v1";
  const competitiveRaw = {
    columns: [
      "ASIN", "商品", "品牌", "当前价（USD）", "30天均价（USD）", "90天均价（USD）",
      "BSR", "30天排名跌次", "评分聚合", "评论数聚合", "月售展示", "Offer",
      "命中关键词", "查询命中数", "批次/搜索位置", "观察时间", "Amazon",
    ],
    rows: products.map((product) => [
      product.asin,
      product.title,
      product.brand || "未标注",
      formatUsd(product.current_price_usd),
      formatUsd(product.average_price_30d_usd),
      formatUsd(product.average_price_90d_usd),
      formatInteger(product.sales_rank),
      formatInteger(product.sales_rank_drops_30d),
      product.rating ?? "PENDING",
      formatInteger(product.review_count),
      formatInteger(product.monthly_sold),
      formatInteger(product.offer_count),
      [...new Set((product.observations || []).map((observation) => observation.query).filter(Boolean))].join(" / ") || dataset.keyword,
      product.query_hit_count ?? (
        new Set((product.observations || []).map((observation) => observation.query).filter(Boolean)).size || "PENDING"
      ),
      (product.observations || []).map((observation) => `${observation.batch}:${observation.search_position ?? "PENDING"}`).join(" / ") || "PENDING",
      [...new Set((product.observations || []).map((observation) => observation.observed_at).filter(Boolean))].join(" / ") || observedAt,
      product.amazon_url,
    ]),
    note: "按 ASIN 去重；同一商品保留全部 query / batch / search position / observed_at。评分与评论数是商品聚合字段，不是评论正文 VOC。",
  };
  const marketMetrics = {
    columns: ["指标", "观察值", "时间", "性质", "解读"],
    rows: [
      ["有效去重商品", products.length, observedAt, "KeepaMore 搜索商品证据", `覆盖 ${queries.length || 1} 个关键词、${dataset.batch_count || 1} 个批次`],
      ["当前有价样本", `${prices.length}/${products.length}`, observedAt, "当前价格快照", "缺失价格不补零"],
      ["当前价 P25 / P50 / P75", `${formatUsd(priceP25)} / ${formatUsd(priceMedian)} / ${formatUsd(priceP75)}`, observedAt, "样本四分位数", "只描述去重搜索样本，不代表成交价或全市场分布"],
      ["已标注品牌", uniqueBrands, observedAt, "搜索样本品牌字段", "品牌出现率不等于销售份额"],
      ["评分字段覆盖", coverage(products, "rating"), observedAt, "商品聚合字段", "不能推导满意度主题或消费者心理"],
      ["评论数字段覆盖", coverage(products, "review_count"), observedAt, "商品聚合字段", "没有评论正文，不能作为已编码 VOC 条数"],
      ["月售展示覆盖", coverage(products, "monthly_sold"), observedAt, "粗粒度展示/代理字段", "不是精确销量，不用于 TAM、份额或备货批准"],
    ],
  };
  const sources = dataset.source_urls.map((url, index) => ({
    id: index === 0 ? "KM-CAT-SEARCH" : `KM-CAT-${String(index + 1).padStart(2, "0")}`,
    source: providerLabel,
    type: imported ? "用户上传的免费网页导出" : "第三方商品聚合 API",
    observed: observedAt,
    finding: `${products.length} 个去重 Amazon US 商品；支持商品、价格、排名、评分数与评论数聚合字段，不含评论正文。`,
    confidence: "Medium",
    url,
  }));
  const keepaMethodology = {
    data_cutoff: observedDate,
    market: "Amazon US",
    channel_scope: `${providerLabel} 多关键词自然搜索商品聚合字段`,
    sample_definition: "按 ASIN 去重的多关键词、多批次判断样本；保留 query、batch、search position 与观察时间。不是全市场随机样本。",
    source_hierarchy: [
      "Medium：KeepaMore 第三方商品聚合字段，仅支持商品池、价格、品牌、排名与覆盖审计",
      "PENDING：评论正文、Amazon 官方搜索/交易数据、公司订单/广告/退货、供应链/合规/成本与真实用户研究",
    ],
    calculation_rules: [
      "相同 ASIN 只计一个商品，保留全部检索观察；不同批次指标不相加",
      "价格四分位只使用当前有价去重样本；缺失值不补零",
      "rating/review_count 只记录商品字段覆盖，不进入 VOC 编码",
      "monthly_sold 与 BSR 仅作代理观察，不用于 TAM、份额、预测或备货批准",
    ],
    limitations: [
      "KeepaMore 不是 Amazon 官方数据源，且本次免费导出不含评论正文",
      "搜索样本受关键词、时间、变体、类目节点与提供方排序影响，不能外推市场份额",
      "未接入需求时序、成交、广告、退货、成本、合规、供应链或家庭持续使用数据",
    ],
  };
  const evidenceDownloads = {
    dataset: {
      columns: ["数据包", "覆盖", "格式", "观察时间", "来源"],
      rows: [[
        "KeepaMore 猫窝多批次商品证据",
        `${products.length} 个去重 ASIN；${queries.length || 1} 个关键词；${dataset.batch_count || 1} 个批次`,
        imported ? "用户上传导出文件" : "API 聚合结果",
        observedAt,
        dataset.source_urls.join(" / ") || "PENDING｜来源引用未登记",
      ]],
    },
    reuse_rules: [
      "保留 ASIN、query、batch、search position、observed_at 与来源引用",
      "评分/评论数聚合字段不得转写为 VOC；月售展示不得当精确销量",
      "不同观察时间保持独立，不把横截面批次伪装成趋势",
    ],
  };
  const config: JsonObject = {
    slug: "cat-bed",
    category: "Cat beds｜猫窝（Amazon US）",
    marketplace: AMAZON_US_MARKETPLACE,
    verdict: "证据不足，暂不立项",
    one_liner: `已完成 ${products.length} 个去重商品的多关键词 KeepaMore 供给与价格基线；真实 VOC、需求时序、成本、合规和家庭持续使用未验证，当前不得冻结概念、备货或上市。`,
    score: 0,
    grade: "PENDING",
    kpis: [
      { label: "去重商品", value: String(products.length), unit: "ASIN", sub: `${queries.length || 1} 个关键词 / ${dataset.batch_count || 1} 个批次`, tone: "neutral" },
      { label: "当前价中位数", value: formatUsd(priceMedian), unit: "样本", sub: `${prices.length}/${products.length} 有价；非目标成交价`, tone: "neutral" },
      { label: "评分字段覆盖", value: coverage(products, "rating"), unit: "商品", sub: "聚合评分，不是 VOC", tone: "neutral" },
      { label: "VOC 正文", value: "0", unit: "条", sub: "KeepaMore 未提供；必须另行补采", tone: "warning" },
    ],
    gates: [
      "真实评论正文与去重 VOC 未达到预注册覆盖门前，不得形成消费者痛点频次结论",
      "需求时序、成交、广告与退货数据未接入前，不得输出 TAM、份额、销量预测或备货量",
      "真实 FOB、包装、头程、履约、税费、广告和退货成本未齐备前，不得输出单位经济结论",
      "家庭持续使用、清洁、尺寸、材料、质量与适用法规未验证前，不得冻结 AIGC 概念或量产规格",
    ],
    why: [
      ["商品供给已形成可审计基线", `${products.length} 个有效 ASIN 已按多关键词、多批次合并并保留检索来源。`, "KM-CAT-SEARCH"],
      ["价格结构只能作方向性描述", `当前有价样本 ${prices.length}/${products.length}；P25/P50/P75 来自本次去重搜索样本。`, "KM-CAT-SEARCH"],
      ["消费者结论仍被证据门阻断", "评分数、评论数和月售展示都不是评论正文；不能据此生成 VOC、心理、旅程或概念卖点。", "VOC-CAT-PENDING"],
    ],
    decisions: [
      ["当前决策", "INSUFFICIENT_EVIDENCE｜只批准补数，不批准产品立项或备货"],
      ["市场补数", "继续扩展多关键词/多批次，并接入可审计需求时序与成交数据"],
      ["VOC 补数", "获取合法授权的评论正文，按 ASIN/变体/语言去重后编码"],
      ["概念图", "BLOCKED｜真实任务、产品定义、成本与质量 Gate 通过后再生成场景套图"],
    ],
    concept: {
      status: "BLOCKED",
      image_url: null,
      title: "PENDING｜猫窝产品概念未冻结",
      thesis: "当前没有足够的真实 VOC、家庭使用、成本、材料、合规与工程证据；AIGC 只保留输入合同，不生成看似已定案的产品图。",
      specs: [
        ["产品形态", "PENDING｜开放、包裹、结构式方案待真实家庭测试"],
        ["尺寸与适配", "PENDING｜需猫体型、姿态与空间任务数据"],
        ["材料与清洁", "PENDING｜需材料、洗护、耐久与风险验证"],
        ["包装与履约", "PENDING｜需最终结构、箱规与真实线路测试"],
      ],
      manufacturability: ["PENDING｜产品定义与 DFM 尚未启动"],
    },
    market: {
      status: "PARTIAL_VERIFIED",
      metrics: marketMetrics,
      query_coverage: {
        columns: ["关键词", "去重命中 ASIN", "证据边界"],
        rows: [...queryAsins.entries()].map(([query, asins]) => [query, asins.size, "搜索样本命中，不是关键词销量或搜索量"]),
      },
      conclusion: "当前只确认 Amazon US 搜索商品池、价格字段、品牌字段与聚合表现字段的方向性结构；不支持需求规模、份额、消费者偏好或进入结论。",
    },
    raw: competitiveRaw,
    voc: {
      status: "PENDING",
      table: { columns: ["状态", "缺失证据", "禁止推断"], rows: [["PENDING", "评论正文与去重编码", "不得把评分数/评论数聚合当作消费者语言或主题频次"]] },
      synthesis: ["PENDING｜当前 0 条评论正文、0 条可追溯 VOC 编码观察；评分数和评论数仅用于覆盖审计。"],
    },
    product: {
      status: "PENDING",
      must_have: ["PENDING｜由真实家庭持续使用、尺寸与清洁任务定义", "PENDING｜最终材料与安全/质量要求待法规和工程确认"],
      should_have: ["PENDING｜从合法评论正文与概念测试形成候选"],
      must_not: ["不得把商品标题属性直接升级为消费者偏好", "不得在测试前宣称舒适、安全、耐久或健康效果"],
      validation: {
        columns: ["测试", "目标", "样本"],
        rows: [
          ["家庭持续使用", "PENDING｜阈值预注册后执行", "至少 12 个目标家庭"],
          ["尺寸与清洁任务", "PENDING｜按冻结方案定义", "覆盖不同体型与家庭场景"],
          ["材料/结构/耐久", "PENDING｜工程与法规共同签核", "最终产品形态冻结后确定"],
          ["包装与履约", "PENDING｜真实线路无安全/质量失效", "最终箱规冻结后确定"],
        ],
      },
    },
    finance: {
      status: "PENDING",
      target_price: workingPriceAnchor,
      price_anchor_status: priceMedian == null ? "PENDING" : "SEARCH_SAMPLE_MEDIAN_NOT_TARGET_PRICE",
      price_anchor_note: priceMedian == null
        ? "当前没有有效价格字段；不得补零或生成目标价。"
        : `${formatUsd(priceMedian)} 只是去重搜索样本当前价中位数，用于构建待验证价格实验范围，不是目标成交价。`,
      cost_waterfall: {
        columns: ["项目", "金额 USD", "状态"],
        rows: [
          ["KeepaMore 当前价样本中位数", priceMedian ?? "PENDING", "观察锚点｜非目标价"],
          ["FOB/材料/包装", "PENDING", "未接入"],
          ["头程/税费/履约/平台/广告/退货", "PENDING", "未接入"],
          ["贡献利润", "PENDING", "禁止计算"],
        ],
      },
      approval_gates: {
        columns: ["闸门", "放行线", "验证方式"],
        rows: [
          ["单位经济", "PENDING｜由财务预注册", "真实报价、渠道费率、履约、广告和退货实账"],
          ["需求", "PENDING｜由业务预注册", "需求时序、成交与受控价格测试"],
          ["库存", "PENDING｜不得从月售展示推导", "成熟订单、交期与库存情景"],
        ],
      },
      warning: "KeepaMore 当前价和月售展示不能替代公司单位经济、销量预测或库存批准。",
    },
    logistics: {
      status: "PENDING",
      company_advantage: "公司有自有物流能力，但猫窝项目的箱规、破损、清洁污染、压缩回弹与逆向成本尚未验证，不能直接视为已证竞争优势。",
      packaging_plan: ["PENDING｜最终产品形态冻结后定义包装", "PENDING｜按真实线路做跌落、挤压、潮湿与开箱验证"],
      operating_kpis: { columns: ["KPI", "红线"], rows: [["成熟订单履约/退货/补件", "PENDING｜试销前预注册"]] },
    },
    compliance: {
      items: [
        ["材料、标签与产品用途适用性", "PENDING", "最终材料、结构、宣称与销售州确定后由专业人员复核"],
        ["儿童/宠物接触、可拆小件与结构风险", "PENDING", "按最终方案建立风险分析和测试矩阵"],
        ["纺织/填充/化学与洗护声明", "PENDING", "核对材料、标签、供应商文件与目标市场要求"],
        ["图片、商标、专利与营销声明", "PENDING", "最终 CAD、图案、名称与 Listing 冻结后做 FTO/claim review"],
      ],
    },
    actions: [
      ["1", "完成多关键词/多批次 ASIN 合并与来源审计", "数据"],
      ["2", "接入评论正文并建立去重 VOC 编码", "研究/数据"],
      ["3", "运行家庭持续使用、清洁、尺寸与概念/价格测试", "用户研究/产品"],
      ["4", "补齐 RFQ、材料、合规、包装和真实履约数据", "采购/研发/法规/物流/财务"],
    ],
    sources,
  };

  const vocEvidence = buildVocEvidence("cat-bed") as JsonObject;
  vocEvidence.evidence_state = {
    title: "VOC 证据状态",
    status: "PENDING",
    tag: "NO_REVIEW_TEXT",
    body: "KeepaMore 未提供评论正文。当前 0 条可追溯 VOC 编码观察；评分与评论数聚合字段不得被转写、扩写或模拟成消费者语言。",
    required_inputs: ["合法获取的评论正文", "ASIN/变体/语言去重规则", "逐条证据锚点、观察时间与编码日志"],
  };
  vocEvidence.synthesis = ["PENDING｜0 条评论正文、0 条编码观察；消费者心理、旅程与痛点频次均不可用。"];
  vocEvidence.methodology_note = "KeepaMore 商品聚合字段只用于商品池、价格、品牌、排名和覆盖审计；rating/review_count 不是评论正文，不进入 VOC 编码。";
  vocEvidence.theme_distribution = {
    ...asObject(vocEvidence.theme_distribution),
    status: "PENDING",
    note: "0 条评论正文，因此不生成主题、白空间或负向方面排序；待接入合法评论正文后再编码。",
  };
  vocEvidence.evidence_log = {
    ...asObject(vocEvidence.evidence_log),
    status: "PENDING",
    note: "当前 0 条可追溯评论正文；空表表示证据缺口，不表示没有消费者问题。",
  };

  const report = buildReferenceBoardReport(config, {
    vocEvidence,
    evidenceMode: "partial_verified_research",
    decisionReadiness: "insufficient_evidence",
    title: "Cat beds｜KeepaMore 多批次选品决策报告",
    marketplace: AMAZON_US_MARKETPLACE,
    dataCutoff: observedDate,
    demoNote: `本报告使用真实 ${providerLabel} 商品聚合字段并恢复原 62 模块 / 332 页研究框架；只有市场与竞品字段部分实证，其余均受 PENDING 证据门约束。`,
    conceptGeneration: {
      eligible: false,
      status: "BLOCKED",
      reason: "真实 VOC、家庭持续使用、成本、材料、合规与工程 Gate 未通过，不生成或展示产品概念套图。",
    },
    provider: providerLabel,
    providerContract,
    deferIntegrityFinalization: true,
  }) as JsonObject;
  const modules = asObject(report.modules);

  const partiallySupported = new Set([
    "OP_SCAN",
    "MKT_STRUCT",
    "competitor_teardown",
    "pricing_science",
    "trend_forecast",
    "trust_guardrails_methodology",
  ]);
  for (const moduleId of REFERENCE_REPORT_MODULE_ORDER) {
    const moduleData = asObject(modules[moduleId]);
    const priorState = asObject(moduleData.evidence_state);
    moduleData.evidence_state = partiallySupported.has(moduleId)
      ? {
        ...priorState,
        title: "KeepaMore 部分实证｜范围受限",
        status: "PARTIAL_VERIFIED",
        tag: "PARTIAL_VERIFIED",
        body: "仅商品池、价格、品牌、排名、评分数与评论数聚合字段有可追溯观察；不支持市场份额、精确销量、评论主题、单位经济或消费者因果结论。",
      }
      : { ...priorState, ...pendingEvidenceState(moduleId) };
    modules[moduleId] = moduleData;
  }

  const executive = asObject(modules.exec_summary_decision_scorecard);
  executive.evidence_state = {
    title: "董事会结论",
    status: "PARTIAL_VERIFIED",
    tag: "INSUFFICIENT_EVIDENCE",
    body: `${products.length} 个去重商品只支持继续补数；当前不批准产品立项、概念冻结、备货或上市。`,
  };
  executive.decision = {
    verdict: "insufficient_evidence",
    one_liner: config.one_liner,
    gating_conditions: config.gates,
  };
  executive.kpi_tiles = config.kpis;
  executive.scorecard = {
    status: "PENDING",
    total_score: null,
    grade: "PENDING",
    reason: "市场规模、真实 VOC、单位经济、供应链、合规和家庭使用数据未齐备，不生成伪精确立项分。",
    required_inputs: config.gates,
  };
  executive.board_decision = {
    verdict: config.verdict,
    verdict_code: "insufficient_evidence",
    score: null,
    grade: "PENDING",
    one_liner: config.one_liner,
    core_logic: config.why,
    decision_table: { columns: ["董事会要决定什么", "建议"], rows: config.decisions },
    gating_conditions: config.gates,
  };
  executive.research_brief = {
    ...asObject(executive.research_brief),
    company_context: {
      columns: ["输入", "本次采用"],
      rows: [
        ["经营角色", "品牌方"],
        ["核心能力", "自有物流；是否形成猫窝品类优势仍待真实订单验证"],
        ["目标市场", "Amazon US"],
        ["当前数据", `${providerLabel}｜${products.length} 个去重 ASIN｜${queries.length || 1} 个关键词`],
        ["研究截止", observedAt],
      ],
    },
    user_input: Object.keys(researchBrief).length ? researchBrief : { status: "PENDING", note: "未提交额外公司/产品约束" },
    keepamore_scope: {
      status: "PARTIAL_VERIFIED",
      queries,
      batch_count: dataset.batch_count || 1,
      unique_asins: products.length,
      observed_at: observedAt,
    },
  };
  modules.exec_summary_decision_scorecard = executive;

  modules.decision_funnel = {
    evidence_state: pendingEvidenceState("decision_funnel"),
    final: { decision: "INSUFFICIENT_EVIDENCE", plan: "只批准补数", score: null, one_liner: config.one_liner },
    parameter_controls: pendingTable(["状态", "待补输入"], "需求、竞争、贡献、质量、合规和履约阈值需由责任人预注册"),
    gate_funnel: {
      status: "PENDING",
      columns: ["Gate", "决策问题", "当前状态", "失败动作"],
      rows: (config.gates as string[]).map((gate, index) => [`G${index}`, gate, "PENDING", "未通过则停止立项/冻结概念"]),
      note: "KeepaMore 商品样本不能使任何董事会 Gate 自动 PASS。",
    },
    raw: {
      status: "PENDING",
      cells: [],
      scenarios: [],
      defaults: {},
      note: "不生成机会分、竞争分、贡献率或价格弹性情景。",
    },
  };

  const opScan = asObject(modules.OP_SCAN);
  modules.OP_SCAN = {
    ...opScan,
    evidence_state: {
      title: "机会扫描范围",
      status: "PARTIAL_VERIFIED",
      tag: "SEARCH_SUPPLY_ONLY",
      body: "已验证多关键词搜索商品供给与字段覆盖；需求规模、趋势、份额、成交与进入机会仍为 PENDING。",
    },
    market_signal: config.market,
    keepamore_live_summary: asObject(asObject(partial.modules).keepamore_live_summary),
    rule: "只把 KeepaMore 商品聚合字段用于搜索商品池、价格、品牌、排名与覆盖审计；需求规模、成交、消费者与进入结论必须补充独立证据。",
  };
  const marketStructure = asObject(modules.MKT_STRUCT);
  modules.MKT_STRUCT = {
    ...marketStructure,
    evidence_state: {
      title: "市场结构范围",
      status: "PARTIAL_VERIFIED",
      tag: "SEARCH_SAMPLE_STRUCTURE",
      body: "价格四分位、品牌出现率与商品字段只描述去重搜索样本；不外推成交结构、集中度或市场份额。",
    },
    competitive_sample: competitiveRaw,
    competitive_sample_register: competitiveRaw,
    keepamore_market_structure: asObject(asObject(partial.modules).keepamore_market_structure),
    query_coverage: asObject(config.market).query_coverage,
  };
  const competitor = asObject(modules.competitor_teardown);
  modules.competitor_teardown = {
    ...competitor,
    evidence_state: {
      title: "竞品证据边界",
      status: "PARTIAL_VERIFIED",
      tag: "ASIN_DEDUPED",
      body: "竞品表按 ASIN 去重并保留全部检索观察；商品标题和聚合指标不得升级为消费者需求或产品优劣结论。",
    },
    competitive_sample: competitiveRaw,
    keepamore_price_rank_monitor: asObject(asObject(partial.modules).keepamore_price_rank_monitor),
  };
  const pricing = asObject(modules.pricing_science);
  modules.pricing_science = {
    ...pricing,
    evidence_state: {
      title: "价格证据范围",
      status: "PARTIAL_VERIFIED",
      tag: "OBSERVED_PRICE_NOT_WTP",
      body: "当前价与 30/90 天聚合均价可用于监测；不同商品横截面不能当作价格弹性、支付意愿或目标价。",
    },
    observed_price_monitor: asObject(asObject(partial.modules).keepamore_price_rank_monitor),
  };
  const trend = asObject(modules.trend_forecast);
  modules.trend_forecast = {
    ...trend,
    evidence_state: {
      title: "趋势证据范围",
      status: "PARTIAL_VERIFIED",
      tag: "POINT_IN_TIME_WITH_PRODUCT_WINDOWS",
      body: "部分商品含 30/90 天价格聚合字段，但没有同口径需求时序；季节性、增长率与销量趋势保持 PENDING。",
    },
    keepamore_price_windows: asObject(asObject(partial.modules).keepamore_price_rank_monitor),
  };

  const vocModule = asObject(modules.voc_evidence);
  modules.voc_evidence = {
    ...vocModule,
    evidence_state: vocEvidence.evidence_state,
    evidence_gap_gate: asObject(asObject(partial.modules).evidence_gap_gate),
    aggregate_field_boundary: {
      status: "PENDING",
      rating_coverage: coverage(products, "rating"),
      review_count_coverage: coverage(products, "review_count"),
      coded_review_text_count: 0,
      rule: "rating/review_count 只记录覆盖，不进入 VOC 主题、情绪、旅程或痛点频次。",
    },
    evidence_downloads: evidenceDownloads,
  };
  const mindDecode = asObject(modules.MIND_DECODE);
  modules.MIND_DECODE = {
    ...mindDecode,
    evidence_state: pendingEvidenceState("MIND_DECODE"),
    category_voc_synthesis: config.voc,
  };
  const financeModule = asObject(modules.output_unit_economics_finance);
  modules.output_unit_economics_finance = {
    ...financeModule,
    evidence_state: pendingEvidenceState("output_unit_economics_finance"),
    unit_economics_input_gate: pendingTable(["状态", "待补输入"], "FOB、材料、包装、头程、税费、履约、平台、广告、退货与售后成本"),
  };

  const aigcGate = {
    status: "BLOCKED",
    tag: "INSUFFICIENT_EVIDENCE",
    reason: "真实 VOC、家庭持续使用、产品定义、成本、材料、质量与合规 Gate 未通过。",
    required_inputs: ["经验证的 JTBD/VOC", "冻结的产品定义与 DFM", "单位经济与合规签核", "真实场景/尺寸/材料参考"],
  };
  const conceptMatrix = asObject(modules.pd_concept_matrix);
  const pendingConcept = { ...asObject(config.concept), ...aigcGate };
  modules.pd_concept_matrix = {
    ...conceptMatrix,
    evidence_state: pendingEvidenceState("pd_concept_matrix"),
    product_concept: pendingConcept,
    aigc_concept_portfolio: { ...aigcGate, module: "concept_portfolio" },
    aigc_design_system: { ...aigcGate, module: "design_system" },
    aigc_design_review_pack: { ...aigcGate, module: "design_review_pack" },
    aigc_quality_audit: { ...aigcGate, module: "quality_audit" },
  };
  const problemSolver = asObject(modules.problem_solver_concept);
  modules.problem_solver_concept = {
    ...problemSolver,
    evidence_state: pendingEvidenceState("problem_solver_concept"),
    product_concept: pendingConcept,
    translation: pendingTable(["状态", "待补输入"], "真实 VOC / JTBD 与经验证的产品响应；当前不生成概念升级点排序"),
    aigc_grounded_synthesis: { ...aigcGate, module: "grounded_synthesis" },
    aigc_listing_blueprint: { ...aigcGate, module: "listing_blueprint" },
    aigc_redteam_validation: { ...aigcGate, module: "redteam_validation" },
  };

  const trust = asObject(modules.trust_guardrails_methodology);
  modules.trust_guardrails_methodology = {
    ...trust,
    evidence_state: {
      title: "可信护栏",
      status: "PARTIAL_VERIFIED",
      tag: "TRACEABLE_WITH_DECLARED_GAPS",
      body: "KeepaMore 来源、批次、查询、ASIN 去重与字段边界已登记；所有未支持模块显式保持 PENDING。",
    },
    keepamore_methodology: asObject(asObject(partial.modules).keepamore_methodology),
    keepamore_source_register: asObject(asObject(partial.modules).source_register),
    methodology: keepaMethodology,
    evidence_downloads: evidenceDownloads,
    multi_batch_contract: {
      queries,
      batch_count: dataset.batch_count || 1,
      unique_asins: products.length,
      raw_observations: products.reduce((sum, product) => sum + Math.max(1, product.observations?.length || 0), 0),
      dedupe_key: "ASIN",
      retained_provenance: ["query", "batch", "search_position", "observed_at", "source_url"],
      rule: "相同 ASIN 不重复计入商品数；指标不跨批相加，保留最完整记录与全部观察来源。",
    },
  };

  modules.keepamore_live_summary = asObject(asObject(partial.modules).keepamore_live_summary);
  modules.keepamore_market_structure = asObject(asObject(partial.modules).keepamore_market_structure);
  modules.keepamore_price_rank_monitor = asObject(asObject(partial.modules).keepamore_price_rank_monitor);
  modules.evidence_gap_gate = asObject(asObject(partial.modules).evidence_gap_gate);
  modules.keepamore_methodology = asObject(asObject(partial.modules).keepamore_methodology);
  modules.competitive_raw_data = competitiveRaw;
  modules.voc_raw_data = modules.voc_evidence;
  modules.board_decision = executive.board_decision;
  modules.board_concept = pendingConcept;
  modules.evidence_downloads = evidenceDownloads;
  modules.methodology = keepaMethodology;
  report.modules = modules;
  report.currency = AMAZON_US_CURRENCY;
  report.observed_at = observedAt;
  report.estimated_provider_units = dataset.estimated_units;
  report.research_dataset = {
    contract: "metis.keepamore-multibatch.v1",
    queries,
    batch_count: dataset.batch_count || 1,
    unique_asins: products.length,
    source_urls: dataset.source_urls,
    observed_at: observedAt,
  };
  return finalizeReportForPersistence(report, { referencePagePlan: report.reference_page_plan as readonly unknown[] });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildVocEvidence } from "./voc-evidence";
import {
  buildPdfFrameworkModules,
  PDF_DEEP_MODULE_ORDER,
  pdfFrameworkMeta,
} from "./board-framework-v2";
import {
  REFERENCE_REPORT_LAYOUT,
  REFERENCE_REPORT_MODULE_ORDER,
  REFERENCE_REPORT_MODULE_PAGE_SPANS_BY_ID,
  REFERENCE_REPORT_SOURCE,
} from "./reference-report-schema";
import { REFERENCE_PAGE_PLAN } from "./reference-page-plan";
import { finalizeReportForPersistence } from "./report-integrity";
import {
  buildStrategyFrameworks,
  STRATEGY_FRAMEWORK_VERSION,
} from "./strategy-frameworks";
type JsonObject = Record<string, any>;

export type ReferenceBoardReportBuildOptions = {
  vocEvidence?: JsonObject;
  evidenceMode?: string;
  decisionReadiness?: string;
  title?: string;
  marketplace?: string;
  dataCutoff?: string;
  demoNote?: string;
  conceptGeneration?: JsonObject;
  provider?: string;
  providerContract?: string;
  deferIntegrityFinalization?: boolean;
};

const DATA_CUTOFF = "2026-08-01";
const VERSION = "2026-08-06.2-report-integrity";
export const VERIFIED_EVIDENCE_MODE = "verified_research";
export const REVIEWABLE_DECISION_READINESS = "ready_for_review";
const DEMO_NOTE = "开源框架演示：随附 VOC 是原创合成样例，真实评论数量为 0；示意图不是工程证据。保留的公开市场引用来自历史报告，本次未重新抓取核验。评分、成本与行动仅用于说明框架，禁止据此立项、采购或上市。";

const canonicalDeepOrder = REFERENCE_REPORT_MODULE_ORDER.slice(10, 60);
if (
  canonicalDeepOrder.length !== PDF_DEEP_MODULE_ORDER.length ||
  canonicalDeepOrder.some((moduleId, index) => moduleId !== PDF_DEEP_MODULE_ORDER[index])
) {
  throw new Error("Reference report order and PDF deep-module order have diverged");
}

const macroSource = {
  id: "MACRO-01",
  source: "U.S. Census Bureau / FRED",
  type: "官方宏观数据",
  observed: "2026-05",
  finding: "家具、家居用品、电子与家电零售商月度销售额为 19,508 百万美元（季调）。这是大盘背景，不等于本品类 TAM。",
  confidence: "High",
  url: "https://fred.stlouisfed.org/series/MRTSSM4423XUSS",
};

const tscaSource = {
  id: "REG-TSCA",
  source: "U.S. EPA",
  type: "官方法规指引",
  observed: DATA_CUTOFF,
  finding: "含硬木胶合板、MDF 或刨花板的成品需使用合规板材，并满足 TSCA Title VI 的标签与记录要求。",
  confidence: "High",
  url: "https://www.epa.gov/formaldehyde/formaldehyde-emission-standards-composite-wood-products",
};

const sturdySource = {
  id: "REG-STURDY",
  source: "U.S. CPSC",
  type: "官方法规指引",
  observed: DATA_CUTOFF,
  finding: "符合用途和尺寸/重量/封闭容积门槛的衣物收纳柜适用 16 CFR part 1261；制造商/进口商需出具合规证书。",
  confidence: "High",
  url: "https://www.cpsc.gov/Business--Manufacturing/Business-Education/Business-Guidance/Clothing-Storage-Units",
};

const tariffSource = {
  id: "REG-TARIFF",
  source: "The White House",
  type: "官方政策",
  observed: "2025-12-31",
  finding: "特定软体家具、厨柜及浴室柜现行 25% Section 232 关税继续有效，原计划的进一步上调延后一年；具体 SKU 必须由报关行按 HTS 复核。",
  confidence: "High",
  url: "https://www.whitehouse.gov/fact-sheets/2025/12/fact-sheet-president-donald-j-trump-adjusts-imports-of-timber-lumber-and-their-derivative-products-into-the-united-states/",
};

const commonMethodology = {
  data_cutoff: DATA_CUTOFF,
  market: "美国",
  channel_scope: "Amazon US 关键词信号 + IKEA / Wayfair / Walmart 可公开访问商品页",
  sample_definition: "判断样本，不是全市场随机抽样。价格、评分、评论数均为抓取时点快照，促销价会变化。",
  source_hierarchy: [
    "High：美国政府、监管机构、零售商一方商品页",
    "Medium：第三方 Amazon 关键词/销量估算；只用于方向判断",
    "Low：无法交叉验证的市场规模估算；本报告不把它作为董事会决策锚点",
  ],
  calculation_rules: [
    "零售样本中位价由本报告列出的有效价格样本直接计算",
    "Amazon 月销量与搜索量标注为第三方估算，不视为 Amazon 官方结算数据",
    "财务模型是立项闸门假设；需用工厂报价、实际税则、渠道费率和公司履约成本替换",
  ],
  limitations: [
    "未接入 Amazon SP-API、Keepa 付费历史、海关提单或公司真实退货/履约数据",
    "不同站点的评论口径和变体合并方式不同，不能直接当作市场份额",
    "概念图用于产品定义与评审，不是工程图；量产前仍需结构、安规、包装与运输测试",
  ],
};

const finance = (
  targetPrice: number,
  exFactory: number,
  freightDutyInbound: number,
  fulfillment: number,
  channelFee: number,
  marketing: number,
  returnsAllowance: number,
  other: number,
) => {
  const contribution = targetPrice - exFactory - freightDutyInbound - fulfillment -
    channelFee - marketing - returnsAllowance - other;
  return {
    model_type: "董事会立项假设（USD / 件或套）",
    scenario: "品牌直营 + 自有物流优势场景",
    target_price: targetPrice,
    cost_waterfall: {
      columns: ["项目", "金额 USD", "占售价"],
      rows: [
        ["目标零售价", targetPrice, "100.0%"],
        ["出厂价", -exFactory, `${(exFactory / targetPrice * 100).toFixed(1)}%`],
        ["海运/关税/入仓", -freightDutyInbound, `${(freightDutyInbound / targetPrice * 100).toFixed(1)}%`],
        ["自有履约/末端配送", -fulfillment, `${(fulfillment / targetPrice * 100).toFixed(1)}%`],
        ["平台/支付费用", -channelFee, `${(channelFee / targetPrice * 100).toFixed(1)}%`],
        ["营销费用", -marketing, `${(marketing / targetPrice * 100).toFixed(1)}%`],
        ["退货与破损准备", -returnsAllowance, `${(returnsAllowance / targetPrice * 100).toFixed(1)}%`],
        ["质保/运营等", -other, `${(other / targetPrice * 100).toFixed(1)}%`],
        ["贡献利润", contribution, `${(contribution / targetPrice * 100).toFixed(1)}%`],
      ],
    },
    approval_gates: {
      columns: ["闸门", "放行线", "验证方式"],
      rows: [
        ["贡献毛利率（营销后）", "≥ 12%", "用实际渠道费率和履约账单复算"],
        ["到岸成本", `≤ $${(exFactory + freightDutyInbound).toFixed(0)}`, "两家工厂报价 + 报关行 HTS 意见"],
        ["破损 + 退货率", "≤ 8%", "50–100 件小批量真实履约"],
        ["首批库存周转", "≤ 120 天", "按保守销量情景采购"],
      ],
    },
    warning: "不得把本模型视为财务预测；它是项目放行线。任何一项实际成本超线都要重新提交立项。",
  };
};

const rows = (values: any[][]) => ({
  columns: ["渠道/来源", "产品或指标", "价格", "评分", "评论/销量", "尺寸/关键特征", "抓取日", "来源"],
  rows: values,
});

const vocRows = (values: any[][], synthesis: string[]) => ({
  table: {
    columns: ["主题", "消费者信号（转述）", "产品含义", "来源"],
    rows: values,
  },
  synthesis,
});

const reports: JsonObject[] = [
  {
    slug: "nightstands",
    category: "Nightstands｜床头柜（美国市场）",
    verdict: "有条件进入",
    one_liner: "不打 $30–60 低价布抽屉红海；做 $169–199/对的静音真抽屉、胡桃木质感与隐蔽充电。",
    score: 76,
    grade: "B+",
    kpis: [
      { label: "Amazon 周搜索", value: "17,052", unit: "次", sub: "第三方估算｜2026-03-08 周", tone: "good" },
      { label: "IKEA 列示中位价", value: "$129.99", unit: "/件", sub: "7 个报告列示 IKEA SKU", tone: "neutral" },
      { label: "建议零售价", value: "$179", unit: "/对", sub: "中高端双只装", tone: "good" },
      { label: "立项评分", value: "76", unit: "/100", sub: "品牌与物流适配较高", tone: "good" },
    ],
    gates: ["双只装营销后贡献率 ≥12%", "充电模块采购 UL Listed 成品", "装配投诉率 <5%", "高度控制在 27 英寸以下"],
    why: [
      ["需求真实但低端拥挤", "Amazon 关键词有量，但头部多为 $30–60 的布抽屉/金属框；品牌方应跳出同质化价格战。", "MKT-NS-01"],
      ["可用设计而非灯效差异化", "IKEA 中高价样本显示消费者愿意为木质感、稳固、抽屉与线缆管理支付溢价。", "RAW-NS"],
      ["公司能力匹配", "双只装可提升客单；自有物流可控制成套到货、破损与补件体验。", "OPS-NS"],
    ],
    decisions: [
      ["产品定位", "23.6 英寸宽、24 英寸高、双真抽屉、Arc-Rhythm 自然橡木、双只装"],
      ["目标价", "$179；促销底线 $159，禁止常态化低于 $149"],
      ["首发 SKU", "烟熏胡桃木 1 色；充电版 1 SKU，非充电版后置"],
      ["试产", "100 套；先做跌落、抽屉循环、插拔与高温测试"],
    ],
    concept: {
      image_url: "/reports/examples/furniture-concept.svg",
      image_provenance: "原创软件演示示意图；不代表实物、专业设计成果或工程证据。",
      title: "Arc-Rhythm Charge 24｜双抽床头柜",
      thesis: "虚构设计练习：以暖橡木、圆弧端盖、浅竖纹与克制黑色细节建立示例品牌系列；后置电气仓仅为待验证设计假设。",
      specs: [
        ["建议尺寸", "W23.6 × D15.7 × H24 in（概念包络）"],
        ["材料", "18 mm TSCA Title VI 板材 + 同步橡木压纹膜；哑光 5–10 GU"],
        ["五金", "2 个全宽真抽屉；全拉出静音导轨；4 根 Ø22–25 mm 黑色钢腿"],
        ["电气", "后置可更换 UL Listed 独立电气盒；正面不可见"],
        ["包装", "双只分箱或双层保护；角部 EPE + 蜂窝纸"],
      ],
      manufacturability: ["R50 独立端盖，不做一体弯木壳", "浅压纹抽面，不做穿透格栅", "2 mm 统一缝隙", "4 腿全部落地", "后背可检修走线仓"],
    },
    market: {
      metrics: {
        columns: ["指标", "观察值", "时间", "性质", "解读"],
        rows: [
          ["美国相关零售大盘", "$19.508B/月", "2026-05", "官方宏观", "只作家居消费背景"],
          ["nightstands 周搜索量", "17,052", "2026-03-08~14", "第三方估算", "需求存在，非销量"],
          ["关键词头部估算", "2K–6K 件/月", "2026-03", "第三方估算", "低价功能款占优"],
          ["IKEA 公开目录入口", "53 个", "2026-07", "零售商类目页快照", "目录入口数不等于本报告逐项列示 SKU 数"],
          ["IKEA 列示样本中位价", "$129.99/件", DATA_CUTOFF, "7 个报告列示 IKEA SKU 计算", "双只装中高端应高于 $159"],
        ],
      },
      conclusion: "进入逻辑不是追随“充电 + LED + 布抽屉”，而是用真家具质感、静音和成套交付，把本报告 7 个 IKEA 列示样本的 $129.99/件中位参照转化为 $179/对的品牌产品。",
    },
    raw: rows([
      ["IKEA", "STORKLINTA 1 抽床头柜", "$59.99", "4.2", "159 reviews", "15.75×18.875×20.875 in", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/nightstands-20656/"],
      ["IKEA", "HEMNES 2 抽柜", "$149.99", "4.5", "1,442 reviews", "21.25 in 宽；双抽", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/nightstands-20656/"],
      ["IKEA", "TONSTAD 1 抽床头柜", "$149.99", "4.4", "219 reviews", "15.75×15.75×23.25 in；缓冲", DATA_CUTOFF, "https://www.ikea.com/us/en/p/tonstad-nightstand-off-white-80510007/"],
      ["IKEA", "SONGESAND 床头柜", "$69.99", "4.7", "415 reviews", "16.5×15.75 in", DATA_CUTOFF, "https://www.ikea.com/us/en/p/songesand-nightstand-brown-70367444/"],
      ["IKEA", "NORDKISA 竹床头柜", "$129.99", "4.6", "583 reviews", "15.75×15.75 in；竹材", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/nightstands-20656/"],
      ["IKEA", "VIKHAMMER 床头柜", "$99.99", "4.7", "202 reviews", "23.625×15.375 in", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/nightstands-20656/"],
      ["IKEA", "IDANÄS 床头柜", "$179.99", "4.7", "363 reviews", "18.5×15.75 in；后背穿线孔", DATA_CUTOFF, "https://www.ikea.com/us/en/p/idanaes-nightstand-white-90458810/"],
      ["Amazon/ASInsight", "nightstands 头部 ASIN B0DB142C6Y", "$39.99", "4.4", "估算 6K/月；1.6K reviews", "充电 + LED + 2 布抽屉", "2026-03", "https://www.asinsight.com/report/US/nightstands"],
      ["Amazon/ASInsight", "胡桃木竖纹充电双只装 B0FWC1FPGG", "$109.99", "4.2", "估算 1K/月；198 reviews", "USB-C；竖纹；实木脚", "2026-07", "https://www.asinsight.com/report/US/night-stand-set-2"],
    ]),
    voc: vocRows([
      ["装配/对孔", "差评集中在孔位、说明书和抽屉对齐；复杂度会直接转成退货。", "预装导轨 + 防错孔位 + 视频说明", "https://www.ikea.com/us/en/p/tonstad-nightstand-off-white-80510007/"],
      ["稳固与质感", "正向评论反复提到稳固、好装、实物比图片更好。", "允许为更厚侧板、背板与腿部连接加成本", "https://www.ikea.com/us/en/p/tonstad-nightstand-off-white-80510007/"],
      ["尺寸", "部分用户认为床头柜过窄；另一些用户明确需要小空间。", "以 22 in 宽做主款，避免 15 in 过窄", "https://www.ikea.com/us/en/p/idanaes-nightstand-white-90458810/"],
      ["线缆管理", "穿线孔和就近充电被视为高频便利点。", "电源模块后置、可更换，不暴露灯效", "https://www.ikea.com/us/en/p/idanaes-nightstand-white-90458810/"],
    ], ["核心未满足需求：稳固、静音、尺寸合适、线缆隐蔽", "应避免：布抽屉、炫彩灯带、不可更换廉价电源模块"]),
    product: {
      must_have: ["双只装一致性", "双全宽真抽屉", "全拉出静音抽屉", "后置走线", "圆角防磕", "可调平"],
      should_have: ["可更换充电模块", "抽屉毛毡垫", "备用五金包", "左右通用零件"],
      must_not: ["RGB/霓虹灯带", "布抽屉", "高度 ≥27 in", "裸露廉价插座", "仅靠背板抗侧向晃动"],
      validation: {
        columns: ["测试", "目标", "样本"],
        rows: [["抽屉循环", "20,000 次无失效", "3 台"], ["桌面静载", "100 lb / 24h", "3 台"], ["包装跌落", "ISTA 3A 思路；零结构破损", "5 箱"], ["电源温升/插拔", "按供应商 UL 条件验证", "5 套"]],
      },
    },
    finance: finance(179, 52, 20, 22, 27, 18, 9, 6),
    logistics: {
      company_advantage: "自有物流最有价值的不是单纯省运费，而是双只装的同步到货、破损责任闭环、补件速度和卧室上楼体验。",
      packaging_plan: ["优先比较一箱双只 vs 两箱一套", "角部用可回收蜂窝纸 + EPE 混合", "五金按步骤分袋", "箱外明显标注 1 OF 2 / 2 OF 2"],
      operating_kpis: { columns: ["KPI", "红线"], rows: [["一次妥投率", "≥97%"], ["运输破损率", "≤2.0%"], ["补件 48h 发出率", "≥95%"], ["套装缺箱率", "≤0.5%"]] },
    },
    compliance: {
      items: [
        ["TSCA Title VI", "高", "板材合规、成品/包装标签、供应链单据留存"],
        ["电源模块", "高", "仅采购适用于家具安装的 UL Listed 成品模块；留存型号和认证文件"],
        ["STURDY/16 CFR 1261", "中", "概念高度 24 in，主动保持低于 27 in；营销与实际规格变更须重新判断"],
        ["防倾倒", "中", "即使不在 CSU 范围，也提供可靠墙固件与清晰警示"],
      ],
    },
    actions: [["1", "两周内完成 2 家工厂 DFM/报价", "产品 + 采购"], ["2", "4 周完成 10 台 EVT 样", "研发"], ["3", "6 周完成包装/电气/抽屉循环", "质量"], ["4", "通过闸门后做 100 套美国小批量", "业务"]],
    sources: [
      macroSource,
      { id: "MKT-NS-01", source: "ASInsight", type: "第三方 Amazon 估算", observed: "2026-03", finding: "nightstands 周搜索量约 17,052；头部估算月销量 2K–6K。", confidence: "Medium", url: "https://www.asinsight.com/report/US/nightstands" },
      { id: "RAW-NS", source: "IKEA US", type: "零售商一方页面", observed: DATA_CUTOFF, finding: "类目页观察到 53 个夜柜/床头柜公开目录入口；本报告逐项列示其中 7 个 IKEA SKU，列示样本中位价为 $129.99/件。", confidence: "High", url: "https://www.ikea.com/us/en/cat/nightstands-20656/" },
      tscaSource, sturdySource,
    ],
  },
  {
    slug: "sideboard",
    category: "Sideboard｜餐边柜（美国市场）",
    verdict: "建议进入",
    one_liner: "五个品类中最适合品牌与自有物流能力；做 64 英寸四门两仓、$349–399 的两箱式静音餐边柜。",
    score: 83,
    grade: "A-",
    kpis: [
      { label: "Amazon 周搜索", value: "8,896", unit: "次", sub: "第三方估算｜2026-03-01 周", tone: "good" },
      { label: "IKEA 列示中位价", value: "$339", unit: "/件", sub: "8 个报告列示 IKEA SKU", tone: "good" },
      { label: "建议零售价", value: "$349", unit: "/件", sub: "64 in 中高端", tone: "good" },
      { label: "立项评分", value: "83", unit: "/100", sub: "物流壁垒最清晰", tone: "good" },
    ],
    gates: ["营销后贡献率 ≥12%", "运输破损 ≤3%", "两人装配 ≤90 分钟", "柜门段差 ≤1.5 mm"],
    why: [
      ["价格带已被验证", "本报告列示的 8 个 IKEA 样本从 $199 到 $599，中位价为 $339，与品牌型 $349–399 定位吻合。", "RAW-SB"],
      ["市场分散", "sideboard 关键词 Top 3 点击份额约 8.3%，第三方数据显示集中度不高。", "MKT-SB-01"],
      ["自有物流形成壁垒", "大体积、多箱、易磕角的品类最能放大自有仓配、补件和上门体验。", "OPS-SB"],
    ],
    decisions: [["产品定位", "64.4 in 宽、15.7 in 深、四门两仓、Arc-Rhythm 自然橡木"], ["目标价", "$349；升级 CMF/服务版本 $399"], ["包装", "两箱式，柜体/门板分区保护"], ["试产", "50 件；重点看柜门、角部、中央支撑和箱 1/2 同步率"]],
    concept: {
      image_url: "/reports/examples/furniture-concept.svg",
      image_provenance: "原创软件演示示意图；不代表实物、专业设计成果或工程证据。",
      title: "Arc-Rhythm Modular 64｜四门模块餐边柜",
      thesis: "以 31.5 英寸单元扩展为 64.4 英寸四门产品，真实框架式竖栅配深色透气背板，把系列识别、遥控/通风与两箱交付整合为一个可制造系统。",
      specs: [["建议尺寸", "W64.4 × D15.7 × H31.5 in（概念包络）"], ["材料", "18 mm TSCA Title VI 板材 + 自然橡木压纹膜"], ["五金", "四门、110°缓冲铰链、两块三档可调层板"], ["底座", "6 根哑黑钢腿（含中央支撑）+ 调平脚 + 防倾倒"], ["包装", "两箱式；门板/端盖独立面保护；部件级补发"]],
      manufacturability: ["31.5 in 模块复用", "R50 独立端盖", "框架式竖栅 + 深色背板", "6 腿全部落地", "门板可独立补发"],
    },
    market: {
      metrics: { columns: ["指标", "观察值", "时间", "性质", "解读"], rows: [
        ["美国相关零售大盘", "$19.508B/月", "2026-05", "官方宏观", "只作家居消费背景"],
        ["sideboard 周搜索量", "8,896", "2026-03-01~07", "第三方估算", "稳定的品类词需求"],
        ["Top 3 点击/转化份额", "8.3% / 2.3%", "2026-03", "第三方估算", "市场相对分散"],
        ["IKEA 公开样本范围", "$199–599", DATA_CUTOFF, "零售商页面", "中高价格带成立"],
        ["IKEA 列示样本中位价", "$339", DATA_CUTOFF, "8 个报告列示 IKEA SKU 计算", "$349 切入不激进"],
      ] },
      conclusion: "这是最值得优先立项的柜体品类。竞争不是“有没有竖纹”，而是能否把门缝、角部、装配、补件和多箱履约做成品牌体验。",
    },
    raw: rows([
      ["IKEA", "VIHALS Sideboard", "$199", "4.3", "365 reviews", "55.125×18.5×29.5 in", DATA_CUTOFF, "https://www.ikea.com/us/en/p/vihals-sideboard-white-90491720/"],
      ["IKEA", "FJÄLLBO Sideboard", "$299", "3.9", "207 reviews", "43.75×18.5×37.375 in", DATA_CUTOFF, "https://www.ikea.com/us/en/p/fjaellbo-sideboard-black-00502799/"],
      ["IKEA", "STOCKHOLM 2025", "$599", "4.4", "74 reviews", "63.25×16.5×32.75 in；橡木贴皮", DATA_CUTOFF, "https://www.ikea.com/us/en/p/stockholm-2025-sideboard-oak-veneer-10586604/"],
      ["IKEA", "HAUGA Sideboard", "$249", "5.0", "5 reviews", "55.125×17.875×33 in", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/sideboards-buffets-10412/"],
      ["IKEA", "BOASTAD Sideboard", "$549", "4.3", "83 reviews", "63.5×20.5×29.625 in；双折门", DATA_CUTOFF, "https://www.ikea.com/us/en/p/boastad-sideboard-black-oak-veneer-30507012/"],
      ["IKEA", "TONSTAD Sideboard", "$379", "4.4", "43 reviews", "47.5×18.625×35.375 in", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/sideboards-buffets-10412/"],
      ["IKEA", "HAVSTA Sideboard", "$400", "4.3", "60 reviews", "47.625×18.5×35 in", DATA_CUTOFF, "https://www.ikea.com/us/en/p/havsta-sideboard-black-90529233/"],
      ["IKEA", "SKRUVBY Sideboard", "$199", "4.8", "218 reviews", "47.25×14.75×35.375 in；槽纹门", DATA_CUTOFF, "https://www.ikea.com/us/en/p/skruvby-sideboard-white-60568725/"],
      ["Amazon/ASInsight", "sideboard 关键词头部 B0D7ZJBVSQ", "$122.96", "—", "估算 800/月", "第三方 Amazon 样本", "2026-03", "https://www.asinsight.com/report/US/sideboard"],
    ]),
    voc: vocRows([
      ["门板/五金", "评论反复出现孔位、螺纹、门板对齐和连接材料问题。", "门板预装铰链；关键螺母改金属嵌件", "https://www.ikea.com/us/en/p/stockholm-2025-sideboard-oak-veneer-10586604/"],
      ["外观溢价", "高分评论认可薄线条、橡木贴皮和隐藏储物带来的成品感。", "正面统一纹理；减少外露孔与贴纸", "https://www.ikea.com/us/en/p/boastad-sideboard-black-oak-veneer-30507012/"],
      ["材料预期", "部分用户认为纯人造板与价格不匹配。", "在可触摸面用真木贴皮/实木封边建立可信度", "https://www.ikea.com/us/en/p/vihals-sideboard-white-90491720/"],
      ["装配时长", "大柜体的部件数和对齐成本是差评来源。", "模块化柜体、预装导轨、按步骤分袋", "https://www.ikea.com/us/en/p/idanaes-sideboard-white-60509627/"],
    ], ["核心未满足需求：门缝一致、角部无损、装配可控、材料与售价匹配", "物流不是后台问题，而是此品类最重要的产品特征之一"]),
    product: {
      must_have: ["64 in 宽", "4 门 + 两独立储物仓", "可调层板", "缓冲五金", "背板抗剪", "墙固件"],
      should_have: ["可选石纹耐污台面", "电缆孔", "门板/五金补件二维码", "左右通用层板"],
      must_not: ["一箱超重方案", "脆弱悬空腿", "门板无独立面保护", "只靠偏心件承受侧向载荷"],
      validation: { columns: ["测试", "目标", "样本"], rows: [["柜门循环", "30,000 次", "3 台"], ["台面静载", "150 lb / 24h", "3 台"], ["双箱运输", "ISTA 3A 思路；破损 0", "8 套"], ["装配验证", "2 人 ≤90 分钟", "10 组"]] },
    },
    finance: finance(349, 96, 40, 46, 52, 35, 24, 9),
    logistics: {
      company_advantage: "餐边柜同时具备高体积、易磕角、多箱和高补件需求；自有物流能把行业痛点直接转化为服务承诺。",
      packaging_plan: ["两箱重量平衡在人工可搬运范围", "箱 1 柜体、箱 2 门板/台面/五金", "门板 5 面独立保护", "建立门板、铰链、脚架 48h 补件库存"],
      operating_kpis: { columns: ["KPI", "红线"], rows: [["运输破损率", "≤3.0%"], ["多箱同日妥投率", "≥95%"], ["柜门补件率", "≤2.0%"], ["上门装配返工率", "≤3.0%"]] },
    },
    compliance: { items: [["TSCA Title VI", "高", "板材、标签、采购单据"], ["Section 232/HTS", "高", "确认是否落入厨柜/相关税目；下单前取得书面归类"], ["防倾倒", "高", "标配墙固件并验证墙体场景"], ["结构/表面", "中", "静载、铰链寿命、耐污与边缘测试"]] },
    actions: [["1", "先立项：两家供应商报价 + HTS 预归类", "采购/关务"], ["2", "完成两箱包装 DOE", "包装工程"], ["3", "做 10 台柜门段差与装配试验", "质量"], ["4", "50 件真实履约试销", "业务/物流"]],
    sources: [macroSource, { id: "MKT-SB-01", source: "ASInsight", type: "第三方 Amazon 估算", observed: "2026-03", finding: "sideboard 周搜索约 8,896，Top 3 点击份额约 8.3%。", confidence: "Medium", url: "https://www.asinsight.com/report/US/sideboard" }, { id: "RAW-SB", source: "IKEA US", type: "零售商一方页面", observed: DATA_CUTOFF, finding: "类目页观察到 49 个 buffet/sideboard 公开目录入口；本报告逐项列示 8 个 IKEA SKU，列示样本中位价为 $339/件。", confidence: "High", url: "https://www.ikea.com/us/en/cat/sideboards-buffets-10412/" }, tscaSource, tariffSource],
  },
  {
    slug: "drawer-cabinet",
    category: "Drawer cabinet｜抽屉柜（美国市场）",
    verdict: "有条件进入",
    one_liner: "不要做泛化“卧室抽屉柜”；聚焦家办/手作场景的全拉出模块柜，并主动避开 STURDY 用途边界。",
    score: 68,
    grade: "B",
    kpis: [
      { label: "IKEA ALEX 主样本", value: "3,582", unit: "reviews", sub: "$95｜4.5 分", tone: "good" },
      { label: "IKEA 列示中位价", value: "$117.49", unit: "/件", sub: "6 个报告列示 IKEA SKU", tone: "neutral" },
      { label: "建议零售价", value: "$169", unit: "/件", sub: "全拉出 + 模块内衬", tone: "good" },
      { label: "立项评分", value: "68", unit: "/100", sub: "需严格控制用途与成本", tone: "neutral" },
    ],
    gates: ["营销明确 home office / craft", "一抽开启联锁通过", "全拉出承重 ≥25 lb", "贡献率 ≥12%"],
    why: [
      ["有经典需求锚点", "IKEA ALEX 5 抽柜有 3,500+ 公开评论，说明桌边/手作收纳不是短期风潮。", "RAW-DC"],
      ["差异化来自机械体验", "评论痛点集中在抽屉拉不全、轮子、文件宽度、材料与装配；不是缺更多抽屉。", "VOC-DC"],
      ["法规边界必须先设计", "若以卧室衣物收纳销售且满足尺寸/重量/容积门槛，可能进入 STURDY 强制范围。", "REG-STURDY"],
    ],
    decisions: [["产品定位", "18 in 宽、28 in 高，家办/手作五抽移动柜，不做卧室衣物柜"], ["目标价", "$169；含内衬与四只锁止脚轮"], ["核心差异", "4 浅 + 1 深、100% 全拉出、完整背板与真实净尺寸"], ["试产", "100 件，优先测导轨、脚轮、抽底与倾倒"]],
    concept: {
      image_url: "/reports/examples/furniture-concept.svg",
      image_provenance: "原创软件演示示意图；不代表实物、专业设计成果或工程证据。",
      title: "Arc-Rhythm Studio 5｜全拉出移动抽屉柜",
      thesis: "把 ALEX 类产品的开度、轮子、真实内尺寸和材料质感问题，转成一个紧凑的家办/手作工具；保留 Arc-Rhythm 圆弧、浅竖纹与黑色边拉手。",
      specs: [["建议尺寸", "W18 × D20.5 × H28 in（概念包络）"], ["用途", "Home office / craft / studio；非卧室衣物收纳"], ["抽屉", "4 浅 + 1 深；100% 全拉出；统一 2 mm 缝隙"], ["移动", "低位哑黑底座 + 4 只可锁止万向脚轮"], ["内装", "可拆分隔/标签槽；深抽按 Letter/A4/工具验证"]],
      manufacturability: ["18 mm 平板柜体", "R35 独立圆弧件", "浅压纹五抽面", "导轨定位治具", "四脚轮可单独补发"],
    },
    market: {
      metrics: { columns: ["指标", "观察值", "时间", "性质", "解读"], rows: [
        ["ALEX 5 抽柜", "$95 / 4.5 / 3,582 评论", DATA_CUTOFF, "零售商页面", "强需求锚点"],
        ["ALEX 带脚轮宽柜", "$219.99 / 4.6 / 1,072 评论", DATA_CUTOFF, "零售商页面", "高价仍有接受度"],
        ["Amazon 类目代理", "未获得有效样本", "2026-08-01 QA", "已排除", "原 5-drawer-file-cabinet 头部实际为桌面信件托盘，不参与评分"],
        ["IKEA 列示样本中位价", "$117.49", DATA_CUTOFF, "6 个报告列示 IKEA SKU 计算", "$169 需有可感知机械升级"],
      ] },
      conclusion: "品类可做，但必须从“多抽屉木盒子”升级为家办/手作工具。若不能做全拉出、联锁和内衬，就不应立项。",
    },
    raw: rows([
      ["IKEA", "ALEX 5 抽柜", "$95", "4.5", "3,582 reviews", "14.125×22.875×27.5 in", DATA_CUTOFF, "https://www.ikea.com/us/en/p/alex-drawer-unit-white-00473546/"],
      ["IKEA", "ALEX 柜 + 内衬", "$104.99", "4.5", "576 reviews", "14.125×22.875×27.5 in", DATA_CUTOFF, "https://www.ikea.com/us/en/p/alex-drawer-unit-with-insert-white-s79628017/"],
      ["IKEA", "ALEX 宽柜脚轮版", "$219.99", "4.6", "1,072 reviews", "26.375×18.875×26 in", DATA_CUTOFF, "https://www.ikea.com/us/en/p/alex-drawer-unit-on-casters-white-80485423/"],
      ["IKEA", "ALEX 文件抽屉版", "$129.99", "3.9", "350 reviews", "14.125×22.875×27.5 in", DATA_CUTOFF, "https://www.ikea.com/us/en/p/alex-drawer-unit-drop-file-storage-white-50508176/"],
      ["IKEA", "ALEX 窄脚轮 + 内衬", "$134.99", "4.5", "575 reviews", "14.125×29.875 in", DATA_CUTOFF, "https://www.ikea.com/us/en/p/alex-drawer-unit-on-casters-with-insert-dark-gray-black-s69628032/"],
      ["IKEA", "ALEX 新低柜", "$69.99", "1.3", "7 reviews", "14.125×17.75×19.625 in；需另购轮", DATA_CUTOFF, "https://www.ikea.com/us/en/p/alex-drawer-unit-white-60586908/"],
    ]),
    voc: vocRows([
      ["抽屉开度", "用户抱怨只能拉出约 60%–75%，后部物品不可见。", "必须 100% 全拉出", "https://www.ikea.com/us/en/p/alex-drawer-unit-on-casters-white-80485423/"],
      ["轮子/稳定", "另购轮子和不带刹车引发强烈差评。", "标配低位黑色底座与 4 只脚轮，至少两只可锁止；无需追加购买", "https://www.ikea.com/us/en/p/alex-drawer-unit-white-60586908/"],
      ["内部尺寸", "文件柜内部略窄或刮地毯导致使用失败。", "用真实载物验证净尺寸；标注内尺寸", "https://www.ikea.com/us/en/p/alex-drawer-unit-drop-file-storage-white-50508176/"],
      ["材料耐久", "部分评论认为板材易凹、搬家耐久性差。", "受力处加密度、边缘防撞、背板完成面", "https://www.ikea.com/us/en/p/alex-drawer-unit-on-casters-white-80485423/"],
    ], ["核心未满足需求：全拉出、轮子完整、内部净尺寸透明、搬运耐久", "产品必须用品类场景和机械体验建立溢价"]),
    product: {
      must_have: ["100% 全拉出", "单抽联锁", "低位黑色底座 + 4 只可锁止脚轮", "完成背板", "可拆内衬", "内部净尺寸标注"],
      should_have: ["锁具选配", "标签槽", "桌板连接件", "浅抽可换分隔"],
      must_not: ["卧室衣物场景主图", "另售必需轮子", "半拉出导轨", "只靠薄背板稳定"],
      validation: { columns: ["测试", "目标", "样本"], rows: [["导轨循环", "30,000 次", "3 台"], ["单抽联锁", "任意时刻仅 1 抽可开", "5 台"], ["倾倒测试", "按用途与法规预评估", "5 台"], ["脚轮越障", "门槛/地毯 500 次", "3 台"]] },
    },
    finance: finance(169, 50, 19, 20, 25, 17, 10, 5),
    logistics: { company_advantage: "体积不大但密度高，成本在重量、边角与导轨损坏。自有物流可通过直立搬运、补件导轨和到货检查降低退货。", packaging_plan: ["柜体 KD 或半组装对比测试", "导轨与抽屉面独立防刮", "五金托盘化", "外箱标注重心与直立方向"], operating_kpis: { columns: ["KPI", "红线"], rows: [["导轨到货损坏", "≤1.0%"], ["运输破损", "≤2.0%"], ["缺件投诉", "≤1.0%"], ["退货率", "≤8.0%"]] } },
    compliance: { items: [["STURDY/16 CFR 1261", "极高", "用途、尺寸、重量和封闭容积共同判断；营销不得误导为卧室衣物柜"], ["TSCA Title VI", "高", "板材/标签/单据"], ["防倾倒与联锁", "高", "即使不落入强制范围，也按高标准验证"], ["脚轮稳定", "中", "刹车/调平与单抽开启联合测试"]] },
    actions: [["1", "法规预评估：用途文案 + 结构尺寸", "法规"], ["2", "导轨/联锁样件评审", "研发"], ["3", "30 人桌边/手作场景测试", "用户研究"], ["4", "闸门通过后 100 件试销", "业务"]],
    sources: [macroSource, { id: "RAW-DC", source: "IKEA US", type: "零售商一方页面", observed: DATA_CUTOFF, finding: "本报告逐项列示 6 个 IKEA ALEX SKU 的价格、规格、评分和公开评论；列示样本中位价为 $117.49/件。", confidence: "High", url: "https://www.ikea.com/us/en/cat/alex-series-47147/" }, { id: "VOC-DC", source: "IKEA ALEX 用户评论", type: "零售商一方评论", observed: DATA_CUTOFF, finding: "抽屉开度、轮子、内部尺寸和材料耐久是主要痛点。", confidence: "Medium", url: "https://www.ikea.com/us/en/p/alex-drawer-unit-on-casters-white-80485423/" }, { id: "QA-DC-01", source: "Metis URL/品类 QA", type: "研究审计", observed: DATA_CUTOFF, finding: "原 ASInsight 5-drawer-file-cabinet 头部样本实际为桌面信件托盘，已从市场与销量证据中剔除。", confidence: "High", url: "https://www.asinsight.com/report/US/5-drawer-file-cabinet" }, tscaSource, sturdySource],
  },
  {
    slug: "coffee-bar-counter",
    category: "Coffee bar counter｜家庭咖啡吧台柜（美国市场）",
    verdict: "建议进入",
    one_liner: "做 47.2 英寸封闭双门咖啡工作站：全宽浅抽、台面设备散热/走线与选配电源，避开 $60 开放式烘焙架。",
    score: 79,
    grade: "B+",
    kpis: [
      { label: "Amazon 头部估算", value: "2K", unit: "件/月", sub: "coffee bar cabinet｜第三方", tone: "good" },
      { label: "Wayfair 强样本", value: "288", unit: "reviews", sub: "$344.99｜4.7 分｜观察日快照", tone: "good" },
      { label: "建议零售价", value: "$329", unit: "/件", sub: "47.2 in 双门工作站", tone: "good" },
      { label: "立项评分", value: "79", unit: "/100", sub: "跨场景增长机会", tone: "good" },
    ],
    gates: ["选配电源模块与布线合规", "台面设备摆位/散热通过", "耐水/咖啡渍通过", "营销后贡献率 ≥12%"],
    why: [
      ["需求从架子向家具升级", "Amazon 宽词头部被开放式 bakers rack 污染；Wayfair 的 $344.99 专用柜有 288 条评论与 4.7 分，只作为高功能家具段的零售样本。", "RAW-CB"],
      ["功能组合有明确价值", "设备摆位、走线、浅抽、杯具收纳和耐污台面是可验证的使用价值；冰箱位只作为相邻高功能样本，不进入当前封闭双门方案。", "VOC-CB"],
      ["自有物流适配", "两箱同步、重件入户、破损与安装问题都可通过自有履约改善。", "OPS-CB"],
    ],
    decisions: [["产品定位", "47.2 in 宽、35.4 in 高、17.7 in 有效工作深度的专用咖啡工作站"], ["目标价", "$329；基础款不含电器，电气模块独立选配"], ["核心差异", "耐水耐热台面 + 挡水沿 + 走线/散热 + 可调储物"], ["试产", "50 件，重点验证台面、液体、电气隔离与多箱"]],
    concept: {
      image_url: "/reports/examples/furniture-concept.svg",
      image_provenance: "原创软件演示示意图；不代表实物、专业设计成果或工程证据。",
      title: "Arc-Rhythm Brew 48｜家庭咖啡工作站",
      thesis: "不是把 sideboard 改名：用加深工作台、低挡水沿、咖啡设备净空、线缆孔与可调储物定义冲煮工作流，基础款不虚构内置水路或制冷。",
      specs: [["建议尺寸", "W47.2 × D17.7 × H35.4 in（概念包络）"], ["柜体", "1 个浅工具抽 + 2 扇下柜门；左侧可调层板、右侧高物区"], ["台面", "深暖灰/黑 HPL；耐水耐热；低挡水沿 + 后部线孔"], ["电气", "基础款不集成；选配可更换认证独立模块"], ["立面", "抽面浅压纹；门板真实竖栅 + 深色透气背板"]],
      manufacturability: ["15.7 in 标准柜体 + 17.7 in 工作台", "R50 独立端盖", "门/抽结构不混淆", "中央支撑腿", "台面独立面保护"],
    },
    market: {
      metrics: { columns: ["指标", "观察值", "时间", "性质", "解读"], rows: [
        ["coffee bar cabinet 宽词追踪", "136 个", "2026-07", "第三方估算", "含开放式 bakers rack；只作方向背景"],
        ["头部估算销量", "2K/月", "2026-07", "第三方估算", "开放式 $59.99 架子占头部，不代表目标柜体"],
        ["高功能样本", "$344.99 / 4.7 / 288 评论", DATA_CUTOFF, "Wayfair 页面", "专用储物 + 电源接受度的零售样本"],
        ["混合零售商列示样本中位价", "$125.99", DATA_CUTOFF, "8 个跨零售商/相邻类目列示样本计算", "样本混有低价小柜/架子，不能视作同质 SKU 价格带"],
        ["目标区间", "$299–349", "立项假设", "本报告建议", "必须用专用功能证明溢价"],
      ] },
      conclusion: "消费者不是缺一个柜子，而是缺一个解决设备、电源、散热、清洁和收纳的家庭饮品工作站。专用化越强，越能逃离低价 sideboard 同质化。",
    },
    raw: rows([
      ["Walmart", "KFFKFF 55.1 in 竖纹咖啡吧柜", "$100.99", "约 2.3", "4 reviews", "55.1×15.7×29.5 in；滑门", DATA_CUTOFF, "https://www.walmart.com/ip/19145222837"],
      ["Walmart", "Noelse 45 in 咖啡吧柜", "$109.99", "—", "20 reviews", "抽屉 + 门；另收 $29.99 运费", DATA_CUTOFF, "https://www.walmart.com/ip/19350767858"],
      ["Wayfair", "Winston Porter 冰箱位吧台柜", "$344.99", "4.7", "288 reviews", "53.2×20.9×38.6 in；电源/USB-C", DATA_CUTOFF, "https://www.wayfair.com/furniture/pdp/winston-porter-large-coffee-bar-cabinet-with-fridge-space-mini-fridge-cabinet-with-wine-storage-buffet-sideboard-table-for-home-fluted-modern-design532-l-w113774126.html"],
      ["Wayfair", "Gracie Oaks 高咖啡柜", "$249.99", "4.8", "55 reviews", "44×16.5×75 in；滑门", DATA_CUTOFF, "https://www.wayfair.com/furniture/pdp/gracie-oaks-coffee-bar-cabinet-tall-bar-cabinet-kitchen-buffet-sideboard-with-sliding-barn-door-and-blackboard-w112760623.html"],
      ["Wayfair", "Ebern Designs 小型吧柜", "$133.99", "3.7", "3 reviews", "29.92×14.96×31.5 in", DATA_CUTOFF, "https://www.wayfair.com/furniture/pdp/ebern-designs-coffee-bar-cabinet-sideboard-buffet-cabinet-with-storage-w113499607.html"],
      ["Wayfair", "17 Stories 70.1 in 双冰箱位吧柜", "$509.99", "4.6", "14 reviews", "70.1×20.9×39.5 in；内置电源", DATA_CUTOFF, "https://www.wayfair.com/furniture/pdp/17-stories-long-coffee-bar-cabinet-with-fridge-space-modern-wine-liquor-cabinet-with-storage-power-outlet-buffet-sideboard-with-fluted-doors-for-home-701-inch-black-w117689391.html"],
      ["Wayfair", "George Oliver 31.5 in 竖纹小柜", "$117.99", "4.3", "8 reviews", "31.5×14.7×31.2 in", DATA_CUTOFF, "https://www.wayfair.com/furniture/pdp/george-oliver-coffee-bar-cabinet-mid-century-fluted-coffee-bar-table-with-2-tier-storage-buffet-stand-cabinet-with-2-barn-door-sideboard-buffet-station-for-living-room-entryway-315-x-147-x-315-in-w116975889.html"],
      ["Amazon/ASInsight", "SUPERJARE 开放式咖啡架 B09PFY63JQ", "$59.99", "4.7", "估算 2K/月", "4 层 + 电源 + 挂钩", "2026-07", "https://www.asinsight.com/report/US/coffee-bar-cabinet"],
    ]),
    voc: vocRows([
      ["装配复杂", "低分样本出现耗时近一天、需自行打孔和多零件问题。", "模块化柜体；导轨/电源预装；两人装配 <90 分钟", "https://www.walmart.com/ip/19145222837"],
      ["材料/滑门", "滑门脆弱、螺钉抓不住板材、到货刮伤是强负面。", "关键连接用金属嵌件；门改缓冲铰链；独立面保护", "https://www.walmart.com/ip/19145222837"],
      ["功能认可", "相邻高功能样本的高分评论认可储物、电源和成品外观；其冰箱位只证明功能家具存在价格带。", "主图优先表达设备摆位、散热净空、浅抽收纳与可检修选配电源，不复制冰箱位", "https://www.wayfair.com/furniture/pdp/winston-porter-large-coffee-bar-cabinet-with-fridge-space-mini-fridge-cabinet-with-wine-storage-buffet-sideboard-table-for-home-fluted-modern-design532-l-w113774126.html"],
      ["尺寸准确", "用户会按缝隙精确测量，底座超出标称会造成无法安装。", "尺寸图必须含台面、底座、双门仓净空、设备后部散热和插头余量", "https://www.walmart.com/ip/19350767858"],
    ], ["核心未满足需求：装得上、散热够、尺寸准、耐液体、材料不崩", "最大机会不是咖啡风格，而是设备系统设计"]),
    product: {
      must_have: ["封闭双门储物", "全宽浅工具抽", "台面设备散热/走线净空", "独立可检修线槽", "耐污耐热台面", "可调层板 + 墙固件"],
      should_have: ["可拆滴水盘", "杯架/瓶架可拆", "滤纸/清洁工具分隔盒", "台面低背挡"],
      must_not: ["在封闭柜内运行发热或制冷家电", "裸露插排", "吸水贴纸台面", "复杂脆弱滑门"],
      validation: { columns: ["测试", "目标", "样本"], rows: [["设备摆位/散热", "3 组主流咖啡机 + 磨豆机；按设备厂商净空连续运行 2h，线缆无干涉且台面无异常温升", "3 组合"], ["台面耐液体", "咖啡/水/酒精 24h 无永久痕", "5 片"], ["选配电源/走线", "组件证书、应力消除与温升通过；基础款线孔可封闭", "5 台"], ["两箱运输", "零结构破损", "8 套"]] },
    },
    finance: finance(329, 90, 38, 44, 49, 33, 22, 8),
    logistics: { company_advantage: "这是大件、多箱、设备兼容和上门摆放并存的品类；自有物流可提供预约、入户、箱 1/2 同步与破损闭环。", packaging_plan: ["台面/柜体分箱", "选配电源模块独立包装且可更换", "门板与浅抽独立面保护", "设备摆位/走线尺寸卡和安装前检查表放箱顶"], operating_kpis: { columns: ["KPI", "红线"], rows: [["多箱同日率", "≥95%"], ["破损率", "≤3%"], ["装配工单率", "≤5%"], ["尺寸不符退货", "≤1%"]] } },
    compliance: { items: [["TSCA Title VI", "高", "柜体板材、标签、单据"], ["选配电源模块/布线", "极高", "UL Listed 家具安装模块；应力消除与可维修"], ["Section 232/HTS", "高", "是否被归类为厨房柜需书面确认"], ["设备散热/防倾倒", "高", "台面家电按其厂商净空；不得引导在封闭柜内运行发热或制冷家电；标配墙固件"], ["食品接触表达", "中", "台面仅作设备/杯具表面，文案避免不实食品级声明"]] },
    actions: [["1", "冻结 3 组主流咖啡机 + 磨豆机摆位、散热和线缆包络", "产品"], ["2", "选配电源模块证书与 HTS 预归类", "法规/关务"], ["3", "设备运行、液体与两箱包装测试", "质量"], ["4", "50 件美国真实履约", "业务/物流"]],
    sources: [macroSource, { id: "MKT-CB-01", source: "ASInsight", type: "第三方 Amazon 宽词估算", observed: "2026-07", finding: "coffee bar cabinet 追踪 136 个产品，头部估算约 2K/月；头部为开放式 bakers rack，不能代表目标柜体。", confidence: "Low", url: "https://www.asinsight.com/report/US/coffee-bar-cabinet" }, { id: "RAW-CB", source: "Wayfair / Walmart", type: "零售商一方页面", observed: DATA_CUTOFF, finding: "本报告列示 8 个跨零售商/相邻类目样本，价格中位数为 $125.99；该混合样本仅作价格参照，不代表同质 SKU 全市场价格带。", confidence: "High", url: "https://www.wayfair.com/furniture/pdp/winston-porter-large-coffee-bar-cabinet-with-fridge-space-mini-fridge-cabinet-with-wine-storage-buffet-sideboard-table-for-home-fluted-modern-design532-l-w113774126.html" }, { id: "VOC-CB", source: "Walmart / Wayfair 评论", type: "零售商一方评论", observed: DATA_CUTOFF, finding: "装配、材料、滑门、尺寸、冰箱位和电源体验。", confidence: "Medium", url: "https://www.walmart.com/ip/19145222837" }, tscaSource, tariffSource],
  },
  {
    slug: "slatted-platform-bed",
    category: "Slatted platform bed｜排骨架平台床（美国市场）",
    verdict: "建议进入",
    one_liner: "以“静音、排骨条不滑落、两箱好搬”为核心做 $399 Queen；不与 $54 金属架拼价格。",
    score: 85,
    grade: "A",
    kpis: [
      { label: "Amazon 宽词代理", value: "10K", unit: "件/月", sub: "低价金属床头部｜不代表目标木床", tone: "neutral" },
      { label: "Top 10 均价", value: "$95.79", unit: "", sub: "低价金属架主导", tone: "neutral" },
      { label: "IKEA Queen 床架列示中位", value: "$279", unit: "/床架", sub: "7 个列示 Queen 床架样本", tone: "good" },
      { label: "立项评分", value: "85", unit: "/100", sub: "品牌/物流适配最高", tone: "good" },
    ],
    gates: ["静态承重 ≥1,000 lb", "10,000 次动态无异响", "排骨条零滑落", "Queen 两箱单箱可搬"],
    why: [
      ["宽词有量但样本污染", "第三方 platform beds 宽词头部估算月销量达 10K，但前三均为低价金属床；本报告不把它外推为目标木质排骨架床需求。", "MKT-BED-01"],
      ["低价不等于无高端机会", "低价金属架占头部，但本报告列示的 7 个 IKEA Queen 床架价格覆盖 $149–549、中位价 $279；木质/软包有品牌空间。", "RAW-BED"],
      ["痛点可工程化", "排骨条滑落、断裂、异响、尺寸兼容和中心支撑都是结构问题，可通过设计验证解决。", "VOC-BED"],
    ],
    decisions: [["产品定位", "Queen 主推；自然橡木 Arc-Rhythm 拱形实木栅格床头"], ["目标价", "$399；无床垫、无需 box spring"], ["核心差异", "LVL 中梁 + 三支腿 + 12–14 根锁止排骨条 + 隔音垫"], ["试产", "50 张；先做动态、异响、床垫兼容和两箱长件运输"]],
    concept: {
      image_url: "/reports/examples/furniture-concept.svg",
      image_provenance: "原创软件演示示意图；不代表实物、专业设计成果或工程证据。",
      title: "Arc-Rhythm Slat Arch｜静音 Queen 平台床",
      thesis: "虚构设计练习：以浅拱外框和纵向栅格延伸示例品牌系列；承力侧梁、LVL 中梁、支腿、排骨条与隔音均须另行工程验证。",
      specs: [["尺寸", "约 W64.2 × L84.5 in；床头 H43–44 in；US Queen 60 × 80 in mattress"], ["承力", "橡胶木/实木立柱与侧梁；LVL 中梁；关键节点机械锁固"], ["中心支撑", "3 个可调支腿；概念目标静态承重 800 lb，需测试确认"], ["排骨条", "12–14 根胶合板/实木条；净间距 ≤2.8 in；正向锁止"], ["床头", "平板可装的浅拱框 + 纵向实木栅格；低脚板"]],
      manufacturability: ["两箱式 RTA 长件控制", "不让 MDF 承担动态主载荷", "床钩/横向螺母连接", "排骨条预定位", "接触面隔音垫"],
    },
    market: {
      metrics: { columns: ["指标", "观察值", "时间", "性质", "解读"], rows: [
        ["platform beds 宽词追踪", "146 个", "2026-06", "第三方估算", "前三为低价金属床；只作宽词背景"],
        ["头部估算销量", "10K/月", "2026-06", "第三方估算", "不代表目标木质排骨架床"],
        ["Top 10 均价/评分", "$95.79 / 4.5", "2026-06", "第三方估算", "低价段强势"],
        ["IKEA Queen 列示床架范围", "$149–549", DATA_CUTOFF, "7 个报告列示 Queen 床架", "已排除 2 个独立排骨架单品"],
        ["IKEA Queen 列示床架中位价", "$279", DATA_CUTOFF, "7 个报告列示 Queen 床架计算", "$399 必须兑现静音与质感"],
      ] },
      conclusion: "这是第二优先立项品类。品牌方不应复制 14 英寸黑色金属架，而应做高感知木质平台床，并用自有物流和工程测试解决大件退货根因。",
    },
    raw: rows([
      ["IKEA", "SLATTUM Queen 软包床架", "$149", "4.2", "515 reviews", "含排骨架与中梁；一箱", DATA_CUTOFF, "https://www.ikea.com/us/en/p/slattum-upholstered-bed-frame-vissle-dark-gray-70571256/"],
      ["IKEA", "TARVA Queen 松木床 + LURÖY", "$179", "4.0", "752 reviews", "实木低价平台床", DATA_CUTOFF, "https://www.ikea.com/us/en/p/tarva-bed-frame-white-stained-luroey-s59553956/"],
      ["IKEA", "MALM Queen 床架", "$249", "4.0", "1,434 reviews", "排骨架另选", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/beds-bm003/f/queen-beds-f-typed-reference-measurement--Queen_bed___20frames/"],
      ["IKEA", "RÅDMANSÖ Queen + LURÖY", "$279", "4.1", "34 reviews", "胡桃木效果", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/beds-bm003/f/queen-beds-f-typed-reference-measurement--Queen_bed___20frames/"],
      ["IKEA", "SONGESAND Queen + LURÖY", "$299", "4.0", "526 reviews", "木质外观", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/beds-bm003/f/queen-beds-f-typed-reference-measurement--Queen_bed___20frames/"],
      ["IKEA", "MALM Queen + 2 储物箱", "$399", "4.1", "965 reviews", "储物平台床", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/beds-bm003/f/queen-beds-f-typed-reference-measurement--Queen_bed___20frames/"],
      ["IKEA", "BRIMNES Queen + 床头储物", "$549", "4.2", "1,176 reviews", "储物/床头组合", DATA_CUTOFF, "https://www.ikea.com/us/en/cat/beds-bm003/f/queen-beds-f-typed-reference-measurement--Queen_bed___20frames/"],
      ["IKEA", "LURÖY Queen 排骨架", "$50", "3.7", "3,107 reviews", "59.875×79.5 in；24.75 lb", DATA_CUTOFF, "https://www.ikea.com/us/en/p/luroey-slatted-bed-base-00160215/"],
      ["IKEA", "LÖNSET Queen 排骨架", "$120", "4.1", "1,473 reviews", "5 舒适区；2 箱", DATA_CUTOFF, "https://www.ikea.com/us/en/p/loenset-slatted-bed-base-80278715/"],
      ["Amazon/ASInsight", "NEW JETO Queen 金属平台床 B0B8VQLN6Y", "$53.99", "4.6", "估算 10K/月", "14 in 高；钢排骨架", "2026-06", "https://www.asinsight.com/report/US/platform-beds"],
    ]),
    voc: vocRows([
      ["排骨条滑落", "负面评论提到排骨条频繁掉落，导致床垫下陷。", "必须正向卡扣/定位带，不能靠摩擦", "https://www.ikea.com/us/en/p/luroey-slatted-bed-base-00160215/"],
      ["异响", "部分用户报告每次翻身都会响；另一些正确安装用户认为无异响。", "接触面加隔音垫；说明书标明拱面方向与扭矩", "https://www.ikea.com/us/en/p/luroey-slatted-bed-base-00160215/"],
      ["承重/断裂", "有评论报告一年左右排骨条断裂。", "提高排骨条截面、材料分级和中心支撑", "https://www.ikea.com/us/en/p/luroey-slatted-bed-base-00160215/"],
      ["兼容/尺寸", "替换排骨架对非原配床框容易不合尺寸。", "只作为整床系统销售；明确 US Queen 内尺寸", "https://www.ikea.com/us/en/p/luroey-slatted-bed-base-00160215/"],
      ["稳定/易装", "高分评论认可稳定、安静和容易组装。", "把装配扭矩、捕获式五金和中梁调平做成体验", "https://www.ikea.com/us/en/p/vevelstad-bed-frame-white-50506436/"],
    ], ["核心未满足需求：零异响、零滑落、承重可信、尺寸明确", "这是可以用结构测试建立长期品牌资产的品类"]),
    product: {
      must_have: ["LVL 中梁 + 3 支腿", "排骨条正向锁止", "隔音垫", "捕获式五金", "两箱可搬", "无需 box spring"],
      should_have: ["可替换软包套", "床头高度两档", "床下扫地机净空", "安装扭矩提示"],
      must_not: ["仅靠魔术贴固定全部排骨条", "塑料脆性卡扣", "侧梁单点连接", "模糊承重宣传"],
      validation: { columns: ["测试", "目标", "样本"], rows: [["静载", "1,000 lb / 24h 无永久变形", "3 台"], ["动态耐久", "10,000 次循环无异响/松脱", "3 台"], ["边缘坐压", "300 lb 重复 5,000 次", "3 台"], ["两箱运输", "长件/床头零破损", "8 套"]] },
    },
    finance: finance(399, 110, 48, 52, 60, 40, 28, 10),
    logistics: { company_advantage: "床是自有物流最能建立口碑的品类：预约、楼层、两箱同步、长件保护和快速补件都直接决定退货。", packaging_plan: ["床头与长侧梁分箱优化", "单箱人工可搬；重心标识", "排骨条卷装并防潮", "中心梁/五金放在开箱第一层，减少误丢"], operating_kpis: { columns: ["KPI", "红线"], rows: [["两箱同日率", "≥97%"], ["长件破损", "≤2%"], ["异响相关退货", "≤1.5%"], ["缺件补发 48h", "≥95%"]] } },
    compliance: { items: [["TSCA Title VI", "高", "含复合木板的部件/包装标签/记录"], ["结构与承重声明", "极高", "所有承重宣传必须有测试报告支撑"], ["软包材料", "高", "评估适用的可燃性/化学标签要求"], ["包装与安装", "高", "中梁、调平脚、紧固扭矩必须在说明书中明确"], ["关税/HTS", "中", "按木床/软包床具体结构确认税则"]] },
    actions: [["1", "结构冻结：中心梁/锁止排骨条方案", "研发"], ["2", "两家工厂样件与疲劳测试", "采购/质量"], ["3", "两箱长件物流实测", "物流"], ["4", "50 张美国试销，跟踪异响/装配", "业务"]],
    sources: [macroSource, { id: "MKT-BED-01", source: "ASInsight", type: "第三方 Amazon 宽词估算", observed: "2026-06", finding: "platform beds 追踪 146 个产品；头部估算 10K/月，但前三均为低价金属床，不能代表目标木质排骨架床。", confidence: "Low", url: "https://www.asinsight.com/report/US/platform-beds" }, { id: "RAW-BED", source: "IKEA US", type: "零售商一方页面", observed: DATA_CUTOFF, finding: "本报告逐项列示 7 个 IKEA Queen 床架与 2 个独立排骨架单品；床架子集范围 $149–549、中位价 $279，排骨架不参与床架中位数。", confidence: "High", url: "https://www.ikea.com/us/en/cat/beds-bm003/f/queen-beds-f-typed-reference-measurement--Queen_bed___20frames/" }, { id: "VOC-BED", source: "IKEA LURÖY 评论", type: "零售商一方评论", observed: DATA_CUTOFF, finding: "滑落、断裂、异响、兼容与安装方向是高频信号。", confidence: "Medium", url: "https://www.ikea.com/us/en/p/luroey-slatted-bed-base-00160215/" }, tscaSource],
  },
];

function asRows(value: JsonObject | undefined): any[][] {
  return Array.isArray(value?.rows) ? value.rows : [];
}

function targetPrice(config: JsonObject): number {
  return Number(config.finance?.target_price || 0);
}

function contributionMargin(config: JsonObject): number {
  const price = targetPrice(config);
  const waterfall = asRows(config.finance?.cost_waterfall);
  const contribution = Number(waterfall[waterfall.length - 1]?.[1] || 0);
  return price > 0 && Number.isFinite(contribution)
    ? Number((contribution / price * 100).toFixed(1))
    : 0;
}

function pendingInputGate(
  requiredInputs: string[],
  method: string,
  stopRule: string,
): JsonObject {
  return {
    status: "PENDING",
    required_inputs: requiredInputs,
    method,
    stop_rule: stopRule,
    columns: ["状态", "待补输入", "计算 / 验证方法", "停止规则"],
    rows: [["PENDING", requiredInputs.join("；"), method, stopRule]],
    note: "缺失输入保持 PENDING；本合同不得由模型补造市场数值。",
  };
}

function gateDomain(gate: string): string {
  if (/贡献|毛利|利润|成本|价格/.test(gate)) return "单位经济";
  if (/UL|合规|法规|营销明确|声明/.test(gate)) return "合规与声明";
  if (/运输|破损|两箱|装配|补件/.test(gate)) return "履约与装配";
  return "产品与质量";
}

const CONFIDENCE_LEVELS = ["High", "Medium", "Low"] as const;

function evidenceConfidence(config: JsonObject, vocEvidence: JsonObject) {
  const entries = [...(config.sources || []), ...(vocEvidence.source_register || [])];
  const counts: Record<(typeof CONFIDENCE_LEVELS)[number], number> = { High: 0, Medium: 0, Low: 0 };
  let unscored = 0;

  for (const entry of entries) {
    const normalized = CONFIDENCE_LEVELS.find(
      (level) => level.toLowerCase() === String(entry?.confidence || "").trim().toLowerCase(),
    );
    if (normalized) counts[normalized] += 1;
    else unscored += 1;
  }

  const ratedTotal = CONFIDENCE_LEVELS.reduce((sum, level) => sum + counts[level], 0);
  const percentages: Record<(typeof CONFIDENCE_LEVELS)[number], number> = { High: 0, Medium: 0, Low: 0 };
  if (ratedTotal > 0) {
    const ranked = CONFIDENCE_LEVELS.map((level, order) => {
      const exact = counts[level] * 100 / ratedTotal;
      percentages[level] = Math.floor(exact);
      return { level, order, fraction: exact - Math.floor(exact) };
    }).sort((a, b) => b.fraction - a.fraction || a.order - b.order);
    let remainder = 100 - CONFIDENCE_LEVELS.reduce((sum, level) => sum + percentages[level], 0);
    for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
      percentages[ranked[index % ranked.length].level] += 1;
    }
  }

  return {
    percentages,
    counts,
    rated_total: ratedTotal,
    unscored_count: unscored,
    basis: `按来源台账 ${entries.length} 条登记项计算；不是统计置信区间。已评分 ${ratedTotal} 条、未评分 ${unscored} 条，百分比仅表示来源等级构成。`,
  };
}

function buildExecutiveSummary(config: JsonObject, vocEvidence: JsonObject, strategy: JsonObject): JsonObject {
  const sourceIds = (config.sources || []).map((source: JsonObject) => source.id).filter(Boolean);
  const judgementByCategory: Record<string, number[]> = {
    nightstands: [74, 78, 82, 67, 72],
    sideboard: [79, 84, 91, 75, 76],
    "drawer-cabinet": [66, 70, 76, 61, 67],
    "coffee-bar-counter": [77, 82, 88, 72, 74],
    "slatted-platform-bed": [82, 87, 94, 78, 80],
  };
  const judgement = judgementByCategory[config.slug] || [config.score, config.score, config.score, config.score, config.score];
  const scoreDimensions = [
    ["需求证据", judgement[0], "公开关键词/零售/VOC 的方向性证据"],
    ["品牌溢价", judgement[1], "产品定义与虚构示例品牌系列适配的演示判断"],
    ["物流适配", judgement[2], "自有仓配、补件与大件交付的内部初评"],
    ["竞争可切入", judgement[3], "避开低价同质化后的内部初评"],
    ["合规可控", judgement[4], "按最终结构、材料与用途复核"],
  ].map(([label, raw_score, signal], index) => ({
    label,
    raw_score,
    weight: 0.2,
    weighted: Number(raw_score) * 0.2,
    signal: `管理层立项初评｜${signal}`,
    score_source: "management_assessment",
    index,
  }));
  const weightedBaseScore = Number(
    scoreDimensions.reduce((sum, dimension) => sum + Number(dimension.weighted), 0).toFixed(1),
  );
  const calibrationDelta = Number((Number(config.score) - weightedBaseScore).toFixed(1));
  const confidence = evidenceConfidence(config, vocEvidence);
  return {
    decision: {
      verdict: config.verdict === "建议进入" ? "go" : config.verdict === "不建议进入" ? "no_go" : "conditional_go",
      one_liner: config.one_liner,
      gating_conditions: config.gates,
    },
    kpi_tiles: config.kpis,
    core_logic: (config.why || []).map((item: any[], index: number) => ({
      id: `D${index + 1}`,
      headline: item[0],
      detail: item[1],
      evidence: item[2] ? [item[2]] : sourceIds.slice(0, 1),
    })),
    scorecard: {
      total_score: config.score,
      grade: config.grade,
      dimensions: scoreDimensions,
      score_type: "管理层立项初评，不是平台测量值、消费者评分或统计模型输出",
      score_derivation: {
        method: "5 个维度由管理层按 0–100 初评，每项权重 20%；管理层总分保留项目校准，硬闸门优先于分数。",
        dimension_count: scoreDimensions.length,
        weight_each: 0.2,
        weighted_base_score: weightedBaseScore,
        management_total_score: Number(config.score),
        calibration_delta: calibrationDelta,
        hard_gate_rule: "任一成本、质量、合规或履约硬闸门失败时，必须否决或退回验证，不得用总分覆盖。",
      },
      evidence_confidence: confidence.percentages,
      evidence_confidence_counts: confidence.counts,
      evidence_confidence_basis: confidence.basis,
      evidence_unscored_count: confidence.unscored_count,
    },
    action_items: strategy.execution_backlog_90d.items,
    execution_backlog_90d: strategy.execution_backlog_90d,
    key_assumptions: [
      { assumption: "公开零售与第三方样本能代表方向性需求", basis: "来源台账与观察日快照", sensitivity: "high", if_breaks: "补采付费销量与渠道真实退货数据后重算" },
      { assumption: "目标产品可达到当前成本瀑布", basis: "董事会立项假设，尚非工厂正式报价", sensitivity: "high", if_breaks: "重新定价或终止立项" },
      { assumption: "自有物流能兑现报告中的破损与补件红线", basis: "公司能力输入", sensitivity: "medium", if_breaks: "降低首批规模并增加包装冗余" },
    ],
  };
}

function buildDecisionFunnel(config: JsonObject): JsonObject {
  const price = targetPrice(config);
  const margin = contributionMargin(config);
  const focusBand = `$${Math.round(price * 0.9)}–${Math.round(price * 1.1)}`;
  const defaults = { opp: 65, margin: 12, allow_high_comp: false };
  const cells = [
    { band: `<$${Math.round(price * 0.6)}`, sub: "低价同质款", opp_score: Math.max(35, config.score - 19), competition: "极高" },
    { band: `$${Math.round(price * 0.7)}–${Math.round(price * 0.9)}`, sub: "基础功能款", opp_score: Math.max(45, config.score - 10), competition: "高" },
    { band: focusBand, sub: "品牌主推款", opp_score: config.score, competition: "中" },
    { band: focusBand, sub: "物流优化款", opp_score: Math.min(95, config.score + 3), competition: "中" },
    { band: `>$${Math.round(price * 1.2)}`, sub: "材料升级款", opp_score: Math.max(50, config.score - 4), competition: "中" },
    { band: `>$${Math.round(price * 1.35)}`, sub: "功能堆叠款", opp_score: Math.max(45, config.score - 9), competition: "高" },
  ];
  const scenarios = [
    { price: Math.round(price * 0.9), net_margin_pct: Math.max(0, margin - 7), unit_net: 0 },
    { price, net_margin_pct: margin, unit_net: Number((price * margin / 100).toFixed(1)) },
    { price: Math.round(price * 1.1), net_margin_pct: margin + 5, unit_net: Number((price * 1.1 * (margin + 5) / 100).toFixed(1)) },
  ];
  const parameterControls = {
    status: "MANAGEMENT-HYPOTHESIS",
    columns: ["参数", "当前值", "性质", "调整规则", "审计依据"],
    rows: [
      ["机会分放行线", defaults.opp, "管理层立项阈值", "只用于候选筛选；不得解释为市场概率", "decision_funnel.raw.defaults.opp"],
      ["营销后贡献率放行线", `${defaults.margin}%`, "董事会硬闸门", "以真实报价、费率和履约账单复算", "financial_model.approval_gates"],
      ["是否允许高竞争方案", defaults.allow_high_comp ? "是" : "否", "管理层策略约束", "高/极高竞争方案默认淘汰，除非差异化证据单独签核", "decision_funnel.raw.defaults.allow_high_comp"],
      ["目标价格情景", scenarios.map((item) => `$${item.price}`).join(" / "), "管理层价格情景", "价格与毛利联动；不是需求弹性测量", "decision_funnel.raw.scenarios"],
    ],
    note: "参数均为内部立项控制值，不是市场事实；任何调整必须保留责任人、依据和版本。",
  };
  const marketSignalCount = asRows(config.market?.metrics).length;
  const sourceIds = (config.sources || []).map((source: JsonObject) => source.id).filter(Boolean);
  const gateFunnel = {
    status: "EVIDENCE-GATED",
    columns: ["Gate", "决策问题", "当前证据", "放行条件", "当前状态", "失败动作", "证据锚点"],
    rows: [
      [
        "G0｜方向性机会",
        "是否存在值得继续补证的需求与公司切口？",
        `${marketSignalCount} 项市场信号；管理层机会分 ${config.score}`,
        `管理层机会分 ≥ ${defaults.opp}，且结论只能标为方向性`,
        config.score >= defaults.opp ? "DIRECTIONAL-PASS" : "STOP",
        "未过线则停止后续工程投入；过线也不得替代真实市场数据",
        sourceIds.slice(0, 3).join(" / ") || "PENDING",
      ],
      ...(config.gates || []).map((gate: string, index: number) => [
        `G${index + 1}｜${gateDomain(gate)}`,
        gate,
        "当前为立项要求，尚待责任人提交验证记录",
        gate,
        "PENDING",
        "未通过则冻结方案、退回验证或停止立项",
        `GATE-${config.slug.toUpperCase()}-${index + 1}`,
      ]),
    ],
    note: "漏斗状态只反映证据门，不把管理层分数当作已验证事实；任一硬闸门可覆盖总分。",
  };
  return {
    final: { decision: config.verdict, plan: config.concept.title, score: config.score, one_liner: config.one_liner },
    parameter_controls: parameterControls,
    gate_funnel: gateFunnel,
    raw: {
      cells,
      whitespace_bands: [focusBand],
      scenarios,
      defaults,
      chosen_plan: config.concept.title,
      note: "机会分与价格情景是内部立项推演，不是平台销量测量；实际放行以付费市场数据、工厂报价、渠道费率和真实试销为准。",
    },
  };
}

function buildFrameworkModules(
  config: JsonObject,
  vocEvidence: JsonObject,
  strategy: JsonObject,
  decisionFunnel: JsonObject,
): JsonObject {
  const price = targetPrice(config);
  const evidenceRows = (config.why || []).map((item: any[], index: number) => [
    `F-${index + 1}`,
    item[0],
    item[1],
    item[2],
    index === 0 ? "进入判断" : "产品定义",
  ]);
  const mustHave = config.product?.must_have || [];
  const shouldHave = config.product?.should_have || [];
  const mustNot = config.product?.must_not || [];
  const syntheses = vocEvidence.synthesis || [];
  const marketSignals = config.market?.metrics || { columns: [], rows: [] };
  const marketSizeInputGate = pendingInputGate(
    ["同一品类与市场口径的可审计销售额或销量", "渠道覆盖与变体去重规则", "至少 24 个月连续观察窗"],
    "先固定品类、市场、渠道、变体和时间口径，再用公司实销或可靠面板复算规模与增长；公开大盘和关键词估算只作背景。",
    "输入未齐备前不得显示 TAM、市场增长率或生命周期阶段，也不得据此放量。",
  );
  const lifecycleInputGate = pendingInputGate(
    ["至少 24 个月同口径类目销量/销售额", "新品进入与退出记录", "价格及促销口径"],
    "按月计算增长、渗透、进入/退出与价格变化，并对促销和渠道变化做注释。",
    "连续时序不足或口径变化未校正时，生命周期保持 PENDING。",
  );
  const seasonalityInputGate = pendingInputGate(
    ["至少 24 个月周度或月度订单", "促销日历", "缺货记录", "履约产能与到仓周期"],
    "剔除缺货和促销异常后计算季节指数、峰谷比及备货提前期，并保留原始序列。",
    "没有连续时序时不得绘制季节曲线、峰谷幅度或给出备货月份。",
  );
  const marketOverview = {
    ...marketSignals,
    status: "DIRECTIONAL",
    market_size_input_gate: marketSizeInputGate,
    lifecycle_input_gate: lifecycleInputGate,
    note: "当前表只汇总可追溯公开信号；市场规模、增长和生命周期仍由嵌入的 PENDING 数据门约束。",
  };
  const entryBarrierMatrix = {
    status: "EVIDENCE-GATED",
    columns: ["验证对象", "壁垒域", "当前证据性质", "当前状态", "放行 / 停止原则", "审计锚点"],
    rows: (config.gates || []).map((gate: string, index: number) => [
      gate,
      gateDomain(gate),
      "管理层硬闸门；尚非实测结果",
      "PENDING",
      "通过首列所述验证对象才可放行；否则冻结或退回验证",
      `管理层硬闸门登记 ${String.fromCharCode(65 + index)}`,
    ]),
    note: "矩阵只列可审计壁垒与停止线，不用无来源分数伪装雷达精度。",
  };
  const nichePositioning = {
    status: "MANAGEMENT-HYPOTHESIS",
    columns: ["价格带", "利基角色", "机会分（管理初评）", "竞争强度（管理判断）", "门槛结果", "证据性质"],
    rows: (decisionFunnel.raw?.cells || []).map((cell: JsonObject) => [
      cell.band,
      cell.sub,
      cell.opp_score,
      cell.competition,
      Number(cell.opp_score) >= Number(decisionFunnel.raw?.defaults?.opp || 65) &&
        !["高", "极高"].includes(String(cell.competition || ""))
        ? "进入下一轮验证"
        : "淘汰 / 补证",
      "MANAGEMENT-HYPOTHESIS",
    ]),
    note: "机会分和竞争强度是内部立项比较，不是市场份额、需求概率或统计模型输出。",
  };
  const opportunitySensitivity = {
    status: "MANAGEMENT-HYPOTHESIS",
    columns: ["情景 / 利基", "价格带", "机会分", "机会分阈值", "竞争约束", "结果", "审计规则"],
    rows: (decisionFunnel.raw?.cells || []).map((cell: JsonObject) => {
      const opportunityPass = Number(cell.opp_score) >= Number(decisionFunnel.raw?.defaults?.opp || 65);
      const competitionPass = Boolean(decisionFunnel.raw?.defaults?.allow_high_comp) ||
        !["高", "极高"].includes(String(cell.competition || ""));
      return [
        cell.sub,
        cell.band,
        cell.opp_score,
        `≥ ${decisionFunnel.raw?.defaults?.opp || 65}`,
        `高竞争允许=${Boolean(decisionFunnel.raw?.defaults?.allow_high_comp) ? "是" : "否"}`,
        opportunityPass && competitionPass ? "PASS｜继续补证" : "STOP / REWORK",
        "管理层评分与阈值推演；真实市场输入接入后必须重算",
      ];
    }),
    note: "本表只复算已声明的管理层候选分、竞争判断和阈值，不生成新的市场事实。",
  };
  const priceBandEconomics = {
    status: "MANAGEMENT-HYPOTHESIS",
    columns: ["价格情景", "售价", "营销后贡献率", "单位贡献（派生）", "输入性质", "决策用途"],
    rows: (decisionFunnel.raw?.scenarios || []).map((scenario: JsonObject, index: number) => [
      ["防守价", "目标价", "升级价"][index] || `情景 ${index + 1}`,
      `$${scenario.price}`,
      `${scenario.net_margin_pct}%`,
      `$${Number((Number(scenario.price) * Number(scenario.net_margin_pct) / 100).toFixed(1))}`,
      "董事会立项假设；待真实报价与费率替换",
      Number(scenario.net_margin_pct) >= 12 ? "达到管理层贡献率门" : "低于贡献率门，禁止常态化投放",
    ]),
    market_structure_anchor: {
      title: "MKT_STRUCT｜市场结构解剖",
      tag: "EVIDENCE-GATED",
      body: "价格带、竞争结构、品牌梯队与弹性必须分开验证；公开判断样本不外推为全市场容量或真实份额。",
    },
    note: "单位贡献仅为售价 × 管理层贡献率的算术派生；不是财务预测。",
  };
  const priceDistributionInputGate = pendingInputGate(
    ["同口径有效 SKU/变体价格", "常规价与促销价标记", "渠道权重", "观察日与去重规则", "代表性样本说明"],
    "按渠道和变体去重后计算 P25/P50/P75、IQR 与异常值；公开列示样本单独展示，不外推总体分布。",
    "代表性、样本量或价格口径未通过审计前，不得绘制市场价格箱线图或宣称价格带容量。",
  );
  const competitionStructureInputGate = pendingInputGate(
    ["同口径品牌/SKU 销售", "Buy Box 卖家快照", "FBA/FBM/自有履约标记", "至少 12 个月份额序列"],
    "统一变体与渠道口径后计算品牌集中度、Buy Box 结构和履约占比，并保留逐期快照。",
    "真实销售或份额输入缺失时，不得输出集中度、市场份额或履约结构百分比。",
  );
  const brandLadder = {
    status: "MANAGEMENT-HYPOTHESIS",
    columns: ["梯队", "价格假设", "竞争判断", "本项目动作", "证据边界"],
    rows: [
      ["低价带", `< $${Math.round(price * 0.7)}`, "同质化与价格战强", "不进入", "管理判断；待真实销量结构验证"],
      ["目标带", `$${Math.round(price * 0.9)}–${Math.round(price * 1.1)}`, "以可感知产品差异竞争", config.concept.title, "管理假设；待价格/概念测试"],
      ["升级带", `> $${Math.round(price * 1.2)}`, "需要材料、服务或功能证据", "小样验证后决定", "管理假设；待支付意愿验证"],
    ],
    note: "梯队用于定义验证方向，不代表品牌份额或长尾容量。",
  };
  const priceElasticityInputGate = pendingInputGate(
    ["随机或准实验价格变动", "曝光与流量质量", "转化、销量和贡献利润", "促销/缺货/评价等混杂变量"],
    "按预注册价格单变量实验估计需求响应，并同时报告转化、销量和贡献利润置信区间。",
    "没有可识别的价格实验前，不得输出弹性系数、最优价或因果销量提升。",
  );
  return {
    framework_provenance: {
      source_framework: {
        columns: ["项目", "本次采用"],
        rows: [
          ["参考报告", "美式压木纹床头柜-选品决策报告.pdf"],
          ["参考规模", "A4 横版 332 页｜62 个研究模块"],
          ["继承内容", "五节点主链、62 模块 taxonomy、决策门、证据审计、风险与博弈方法"],
          ["不继承内容", "旧报告中的示例价格、TAM、季节性、销量、VOC 数量、ASIN 与任何相互冲突的模板数字"],
          ["新增内容", "VOC 证据接口、JTBD、消费者心理、端到端消费旅程、STP、BCG 数据门、90 天待办、数据 API 适配器合同、示例品牌 DNA 与 AIGC 增强模块；随附 VOC 为合成样例"],
        ],
      },
      integrity_rules: [
        "同一指标只允许一个事实源和一个统一口径；跨模块复用同一计算结果",
        "观察事实、派生计算、研究推断、管理层假设和 AIGC 输出分开标识",
        "缺少可审计数据的 TAM、弹性、Monte Carlo、销量或份额显示‘待补证’，模型不得补数",
        "AIGC 位于证据之后，只做综合、概念、内容草案和红队，不生成市场事实",
        "任何质量、利润、合规硬闸门失败，都可以覆盖总分与模型建议",
      ],
      deliverable_architecture: {
        columns: ["层", "用途", "内容"],
        rows: [
          ["董事会前置", "快速拍板", "结论、概念图、关键闸门、行动"],
          ["完整研究正文", "跨部门评审", "参考框架 62 项能力 + 7 个 AIGC 模块"],
          ["证据附件", "复核与重跑", "竞品快照、VOC 观察、来源台账、方法与限制"],
        ],
      },
    },
    research_brief: {
      company_context: {
        columns: ["输入", "本次采用"],
        rows: [
          ["公司规模", "待用户输入；开源样例不预设真实经营规模"],
          ["经营角色", "假设为品牌经营者；需按使用者情况确认"],
          ["核心能力", "演示假设：可管理物流、补件与破损闭环；实际能力须用业务记录验证"],
          ["目标市场", "美国；Amazon US + IKEA / Wayfair / Walmart 公共样本"],
          ["研究截止", DATA_CUTOFF],
        ],
      },
      original_framework: {
        columns: ["节点", "本报告回答的问题"],
        rows: [
          ["OP_SCAN", "值不值得做：需求、机会和证据强度"],
          ["MKT_STRUCT", "在哪个价格带、对谁竞争、靠什么切入"],
          ["MIND_DECODE", "消费者为什么买、为什么差评、哪些需求未满足"],
          ["CPT_VERIFY", "具体做哪个方案，财务、工程和合规是否过门"],
          ["GTM_PLAN", "如何上市、验证、履约和逐步放量"],
        ],
      },
      data_adapter_contract: strategy.data_adapter_contract,
      aigc_role: "AIGC 只增强证据归纳、概念发散、内容草案和红队预演；原始数据、来源台账、财务输入和最终放行权保持独立。",
    },
    framework_opportunity_scan: {
      market_overview: marketOverview,
      seasonality_input_gate: seasonalityInputGate,
      entry_barrier_matrix: entryBarrierMatrix,
      niche_positioning: nichePositioning,
      opportunity_sensitivity: opportunitySensitivity,
      research_question: `在美国市场，${config.category.split("｜")[0]} 是否存在适合品牌方与自有物流能力的可盈利切口？`,
      observed_market_signals: marketSignals,
      evidence_to_decision: {
        columns: ["编号", "信号", "证据解释", "锚点", "决策用途"],
        rows: evidenceRows,
      },
      conclusion: config.market?.conclusion,
      rule: "只把政府/监管和零售商一方页面作为高置信事实；第三方 Amazon 估算只用于方向判断。",
    },
    framework_market_structure: {
      // The first six renderable fields own p18–p23. STP remains present but
      // cannot displace the market-structure evidence contract on those pages.
      shared_opportunity_sensitivity: opportunitySensitivity,
      price_band_economics: priceBandEconomics,
      price_distribution_input_gate: priceDistributionInputGate,
      competition_structure_input_gate: competitionStructureInputGate,
      brand_ladder: brandLadder,
      price_elasticity_input_gate: priceElasticityInputGate,
      stp: strategy.stp,
      positioning_hypotheses: {
        columns: ["层级", "价格假设", "竞争判断", "策略"],
        rows: [
          ["低价带", `< $${Math.round(price * 0.7)}`, "同质化与价格战强", "不进入"],
          ["目标带", `$${Math.round(price * 0.9)}–${Math.round(price * 1.1)}`, "以可感知产品差异竞争", config.concept.title],
          ["升级带", `> $${Math.round(price * 1.2)}`, "需要材料、服务或功能证据", "小样验证后决定"],
        ],
      },
      competitive_sample: config.raw,
      interpretation: config.market?.conclusion,
      limitation: "样本是公开页面快照，不把样本 SKU 占比直接外推为市场份额。",
    },
    framework_voc_decode: {
      jtbd: strategy.jtbd,
      consumer_psychology: strategy.consumer_psychology,
      customer_journey: strategy.customer_journey,
      coverage: vocEvidence.coverage_summary,
      coded_theme_distribution: vocEvidence.theme_distribution,
      unmet_needs: {
        columns: ["优先级", "消费者问题/期待", "对应产品动作"],
        rows: syntheses.map((item: string, index: number) => [index + 1, item, mustHave[index] || shouldHave[index] || "进入样机验证"]),
      },
      product_translation: {
        columns: ["层级", "要求"],
        rows: [
          ...mustHave.map((item: string) => ["Must", item]),
          ...shouldHave.map((item: string) => ["Should", item]),
          ...mustNot.map((item: string) => ["Must not", item]),
        ],
      },
      boundary: vocEvidence.methodology_note,
    },
    framework_product_verify: {
      candidate_scorecard: {
        columns: ["方案", "角色", "价格假设", "综合分", "结论"],
        rows: [
          ["A｜低价跟随", "规模款", `$${Math.round(price * 0.68)}`, Math.max(40, config.score - 18), "否决：价格战/体验风险"],
          [`B｜${config.concept.title}`, "品牌主推", `$${price}`, config.score, config.verdict],
          ["C｜材料/服务升级", "高配验证", `$${Math.round(price * 1.2)}`, Math.max(55, config.score - 3), "小样测试"],
        ],
      },
      must_should_must_not: {
        columns: ["层级", "定义"],
        rows: [
          ["Must", mustHave.join("；")],
          ["Should", shouldHave.join("；")],
          ["Must not", mustNot.join("；")],
        ],
      },
      validation_matrix: config.product?.validation,
      approval_gates: config.finance?.approval_gates,
    },
    framework_gtm_plan: {
      positioning: strategy.stp.positioning,
      customer_journey: strategy.customer_journey,
      action_items: strategy.execution_backlog_90d.items,
      execution_backlog_90d: strategy.execution_backlog_90d,
      launch_sequence: {
        columns: ["时间窗", "任务", "Owner", "交付物", "验收线", "停止线", "状态"],
        rows: strategy.execution_backlog_90d.items.map((item: JsonObject) => [
          item.time_window,
          item.title,
          item.owner_role,
          item.deliverable,
          item.acceptance,
          item.stop_line,
          item.status,
        ]),
      },
      channel_message: {
        columns: ["信息层", "建议表达"],
        rows: [
          ["首屏承诺", config.one_liner],
          ["产品证据", mustHave.slice(0, 4).join("；")],
          ["风险消除", mustNot.slice(0, 3).join("；")],
          ["物流服务", config.logistics?.company_advantage],
        ],
      },
      first_batch_rule: "先完成结构、包装、合规和真实履约验证，再从小批量扩到正式备货。",
    },
  };
}

function buildAigcModules(config: JsonObject, vocEvidence: JsonObject): JsonObject {
  const price = targetPrice(config);
  const sourceIds = (config.sources || []).map((source: JsonObject) => source.id).filter(Boolean);
  const syntheses = vocEvidence.synthesis || [];
  const designDnaId = `DEMO-ARC-RHYTHM-${String(config.slug || "PRODUCT").toUpperCase()}-R01`;
  const sceneSuiteSlots = [
    { role: "hero_master", title: "主产品 3/4 Hero", purpose: "锁定同一 SKU 的轮廓、比例、门/抽/腿/拉手与木纹", aspect_ratio: "16:10", required: true, status: "SCHEMATIC-ONLY" },
    { role: "primary_lifestyle", title: "核心空间场景", purpose: "验证主目标用户的空间、尺度和首要任务", aspect_ratio: "16:10", required: true, status: "LOVART-PENDING" },
    { role: "secondary_lifestyle", title: "第二使用情境", purpose: "呈现相邻任务，但不改变产品几何与 CMF", aspect_ratio: "16:10", required: true, status: "LOVART-PENDING" },
    { role: "functional_open_state", title: "功能 / 开合状态", purpose: "展示真实门抽、内部组织、活动件与可达性", aspect_ratio: "16:10", required: true, status: "LOVART-PENDING" },
    { role: "detail_cmf", title: "结构细节与 CMF", purpose: "放大触点材质、木纹、缝隙、五金和关键连接", aspect_ratio: "16:10", required: true, status: "LOVART-PENDING" },
    { role: "packaging_logistics", title: "包装与物流视图", purpose: "表达分箱、易损面、长件、保护和补件粒度", aspect_ratio: "16:10", required: true, status: "LOVART-PENDING" },
  ];
  return {
    aigc_grounded_synthesis: {
      status: { title: "AIGC 证据内综合", tag: "GROUNDED", body: "仅在本报告公开样本、VOC 编码、公司能力和财务假设内做归纳；不补造销量、份额或消费者原话。" },
      synthesis_matrix: {
        columns: ["命题", "AIGC 综合", "证据锚点", "置信", "人工动作"],
        rows: (config.why || []).map((item: any[], index: number) => [
          item[0], item[1], item[2] || sourceIds[index] || "来源台账", index === 0 ? "Medium" : "Medium", config.decisions?.[index]?.[1] || "进入验证",
        ]),
      },
      disagreement_watchlist: {
        columns: ["可能分歧", "当前处理"],
        rows: [
          ["公开样本与付费平台销量可能不一致", "不做市场份额外推；补采后重算"],
          ["概念卖点与真实付费意愿可能不一致", "用概念测试、价格测试与小批量试销验证"],
          ["财务模型与工厂/物流实账可能不一致", "任何关键成本超线都重新过会"],
        ],
      },
    },
    aigc_concept_portfolio: {
      selected_direction: { title: config.concept.title, body: config.concept.thesis },
      concept_options: {
        columns: ["概念", "角色", "价格假设", "保留", "删除/升级", "下一步"],
        rows: [
          ["A｜品牌主推", "首发", `$${price}`, (config.product?.must_have || []).slice(0, 4).join("；"), (config.product?.must_not || []).slice(0, 2).join("；"), "进入 DFM 与样机"],
          ["B｜成本约束", "价格防守", `$${Math.round(price * 0.85)}`, (config.product?.must_have || []).slice(0, 3).join("；"), "移除低使用率选配，不牺牲结构/合规", "仅在主款成本不达标时验证"],
          ["C｜体验升级", "品牌高配", `$${Math.round(price * 1.18)}`, (config.product?.must_have || []).slice(0, 4).join("；"), (config.product?.should_have || []).slice(0, 3).join("；"), "10–20 人概念测试"],
        ],
      },
      image_note: "开源报告前部使用同一张原创软件示意图说明布局；它不验证任何方案、具体 SKU、材质、尺寸或制造能力。实际概念套图需另行生成与人工审查。",
    },
    aigc_design_system: {
      evidence_state: {
        title: "DEMO Arc-Rhythm 虚构设计练习",
        tag: "BRAND-DNA",
        body: "原创虚构品牌练习：演示暖木、纵向节奏、柔和边界与浅进深模块的设计规则；并非任何真实品牌的授权设计系统或市场验证结论。",
      },
      brand_dna: {
        columns: ["维度", "统一规则", "本品类应用"],
        rows: [
          ["CMF", "Natural Oak #B89466 / Warm Walnut #755039 / Cream #EEE8DC；哑黑 #292827", (config.concept?.specs || [])[1]?.[1] || "按品类选暖木主色"],
          ["轮廓", "R45–60 柔和端部、克制拱形、避免不可制造的一体弯木壳", config.concept?.title],
          ["立面", "浅压纹 flute 或真实框架式 slat；不得把承力板渲染成镂空装饰", (config.product?.must_have || []).slice(0, 3).join("；")],
          ["五金", "隐藏/黑色边拉手、缓冲活动件、腿数和支撑真实", (config.concept?.manufacturability || []).slice(0, 3).join("；")],
          ["摄影", "白/浅灰 3/4 master，暖日光场景；无 Logo、无文字、无霓虹", "同一 SKU 多视图必须保持门/抽/腿/拉手一致"],
        ],
      },
      public_references: {
        columns: ["参考", "用途", "来源"],
        rows: [
          ["虚构品牌说明", "演示品牌逻辑；占位链接非证据", "https://example.com/metis/synthetic/brand"],
          ["虚构系列说明", "演示系列规则；占位链接非证据", "https://example.com/metis/synthetic/series"],
          ["虚构床头柜练习", "演示圆弧与竖纹；占位链接非证据", "https://example.com/metis/synthetic/nightstand"],
          ["虚构餐边柜练习", "演示立面模块；占位链接非证据", "https://example.com/metis/synthetic/sideboard"],
        ],
      },
    },
    aigc_design_review_pack: {
      evidence_state: {
        title: "Concept Design Pack｜Revision 01",
        tag: "MANUFACTURABLE-DIRECTION",
        body: `${config.concept?.title} 当前使用软件布局示意图，尚未锁定外观、门抽数量、比例或工程尺寸；以下是后续真实概念任务应满足的交付合同。`,
      },
      master_asset: {
        title: config.concept?.title,
        image: config.concept?.image_url,
        asset_role: "原创软件布局示意图；不是 master SKU 或专业效果图",
        provenance: `Metis original schematic fixture｜${VERSION}｜not engineering evidence`,
      },
      scene_suite_contract: {
        suite_version: "metis-scene-suite-v1",
        design_dna_id: designDnaId,
        required_asset_count: sceneSuiteSlots.length,
        consistency_status: "PENDING-HUMAN-REVIEW",
        consistency_rule: "六张图必须来自同一任务、同一 design_dna_id；轮廓、门/抽/腿/拉手数量、木纹方向、比例与 CMF 不得漂移。",
        hero_compatibility_alias: config.concept?.image_url,
        slots: sceneSuiteSlots,
        evidence_boundary: "套图是工业设计与场景评审资产，不是 CAD、工程图、实拍、尺寸确认或量产签样。",
      },
      required_views: {
        columns: ["视图/资产", "固定项", "用途", "状态"],
        rows: sceneSuiteSlots.map((slot) => [slot.title, `${slot.role}｜同一 ${designDnaId}`, slot.purpose, slot.status]),
        note: "Lovart 在一个任务内先锁定 Hero，再生成五张派生图；像素级一致性仍需工业设计人工审查。",
      },
      concept_specification: {
        columns: ["规格项", "概念包络"],
        rows: config.concept?.specs || [],
      },
    },
    aigc_listing_blueprint: {
      message_architecture: {
        columns: ["页面位置", "内容草案", "证据/限制"],
        rows: [
          ["主图", `${config.concept.title}｜用一张图讲清尺寸、核心结构与使用场景`, "外观和尺寸必须与最终签样一致"],
          ["副图 1", (config.product?.must_have || []).slice(0, 3).join("；"), "用结构特写和测试结果证明"],
          ["副图 2", syntheses[0] || config.one_liner, "基于 VOC 转述，不使用虚构引语"],
          ["副图 3", config.logistics?.company_advantage, "只承诺可稳定兑现的妥投/补件服务"],
          ["A+ / PDP", (config.product?.should_have || []).slice(0, 4).join("；"), "选配与标准配置分开标注"],
        ],
      },
      prohibited_claims: ["未经测试的承重/寿命数字", "未经核验的销量冠军或市场第一", "无证书支持的安全/环保绝对化表达", "把 AIGC 概念图当作实物照片"],
      review_rule: "AIGC 文案必须经过产品、法规与渠道三方审核后才能上线。",
    },
    aigc_redteam_validation: {
      pre_mortem: {
        columns: ["失败路径", "最早信号", "阻断闸门", "责任人"],
        rows: [
          ...((config.gates || []).map((gate: string, index: number) => [
            `闸门 ${index + 1} 未达标`,
            gate,
            "停止放量，回到结构/成本/合规修正",
            config.actions?.[index]?.[2] || "项目负责人",
          ])),
          ...((config.compliance?.items || []).slice(0, 3).map((item: any[]) => [
            item[0], item[2], `风险级别：${item[1]}`, "法规/质量",
          ])),
        ],
      },
      validation_priority: config.product?.validation,
      guardrails: {
        columns: ["边界", "规则"],
        rows: [
          ["事实", "AIGC 不新增未经来源台账支持的外部事实"],
          ["推演", "价格、利润、概念偏好均标记为假设并进入验证"],
          ["合规", "认证、HTS、结构安全必须由专业机构/责任人终审"],
          ["上市", "任何一项硬闸门失败，不得用模型评分覆盖"],
        ],
      },
    },
    aigc_quality_audit: {
      evidence_state: {
        title: "AIGC 质量审计",
        tag: "HUMAN-IN-THE-LOOP",
        body: "视觉资产只通过概念方向审查，不通过工程签样。结构、尺寸、材料、承重、电气、合规、成本和包装必须分别由责任人签字。",
      },
      qa_checklist: {
        columns: ["检查", "本版状态", "放行标准", "责任人"],
        rows: [
          ["品牌 DNA", "通过方向审查", "至少 3 个 Arc-Rhythm 识别元素且不混用三套风格", "品牌/设计"],
          ["视觉一致性", "主视图通过", "门/抽/腿/拉手/木纹方向固定", "工业设计"],
          ["Must-have 可见性", "通过方向审查", "主图与 HTML 规格共同覆盖 ≥90%", "产品"],
          ["DFM", "待工程", "板件、连接、支撑、活动件可制造", "结构工程"],
          ["尺寸/承重", "待样机", "图纸、样机与测试一致", "工程/质量"],
          ["合规/IP", "待终审", "FTO、材料、电气、标签与 claim matrix 完整", "法务/法规"],
          ["包装/物流", "待 DVT", "分箱、跌落/夹抱/线路与部件补发通过", "包装/物流"],
        ],
      },
      automatic_rejects: ["额外或缺失的门、抽屉、腿、拉手", "悬浮/穿模/错误重力", "不可制造的一体弯曲壳", "乱码、Logo、虚构认证或尺寸", "道具遮挡关键结构", "同一 SKU 多视图几何不一致"],
    },
  };
}

function extMeta() {
  const meta: JsonObject = {
    board_decision: { title: "董事会结论｜投不投、投什么、卡什么闸门", nav_short: "董事会结论", icon: "◆" },
    board_concept: { title: "前置概念图｜可制造产品方向", nav_short: "产品概念图", icon: "◫" },
    exec_summary_decision_scorecard: { title: "01 · 执行摘要｜决策逻辑、记分卡与关键假设", nav_short: "执行摘要", icon: "◈", reference_number: 1 },
    decision_funnel: { title: "02 · 决策漏斗｜机会、竞争、VOC、经济与风险闸门", nav_short: "决策漏斗", icon: "▽", reference_number: 2 },
    framework_provenance: {
      title: "框架升级说明｜332 页 / 62 模块如何被继承与纠错", nav_short: "框架升级说明", icon: "i",
      subsections: [
        { id: "source_framework", title: "参考框架与继承边界" },
        { id: "integrity_rules", title: "数据与 AIGC 完整性规则" },
        { id: "deliverable_architecture", title: "三层交付结构" },
      ],
    },
    research_brief: {
      title: "研究输入基线｜公司能力、范围与原框架", nav_short: "研究输入基线", icon: "i",
      subsections: [
        { id: "company_context", title: "公司与研究范围" },
        { id: "original_framework", title: "原项目五节点研究框架" },
        { id: "aigc_role", title: "AIGC 职责边界" },
      ],
    },
    framework_opportunity_scan: {
      title: "03 · OP_SCAN｜品类机会扫描", nav_short: "机会扫描", icon: "◎", framework_stage: "OP_SCAN", reference_number: 3,
      subsections: [
        { id: "market_overview", title: "市场信号总览与规模 / 生命周期数据门" },
        { id: "seasonality_input_gate", title: "季节连续时序数据门" },
        { id: "entry_barrier_matrix", title: "进入壁垒证据矩阵" },
        { id: "niche_positioning", title: "利基定位管理假设" },
        { id: "opportunity_sensitivity", title: "机会分敏感性" },
        { id: "research_question", title: "研究问题" },
        { id: "observed_market_signals", title: "可核验市场信号" },
        { id: "evidence_to_decision", title: "证据到决策" },
        { id: "conclusion", title: "阶段结论" },
        { id: "rule", title: "证据规则" },
      ],
    },
    framework_market_structure: {
      title: "04 · MKT_STRUCT｜市场结构与价格带", nav_short: "市场结构", icon: "▥", framework_stage: "MKT_STRUCT", reference_number: 4,
      subsections: [
        { id: "price_band_economics", title: "价格带与单位经济管理情景" },
        { id: "price_distribution_input_gate", title: "真实价格分布数据门" },
        { id: "competition_structure_input_gate", title: "集中度、Buy Box 与履约结构数据门" },
        { id: "brand_ladder", title: "品牌梯队管理假设" },
        { id: "price_elasticity_input_gate", title: "价格弹性实验数据门" },
        { id: "stp", title: "STP 细分、目标与定位" },
        { id: "positioning_hypotheses", title: "价格带与定位假设" },
        { id: "competitive_sample", title: "竞品公开样本" },
        { id: "interpretation", title: "结构解读" },
        { id: "limitation", title: "外推边界" },
      ],
    },
    framework_voc_decode: {
      title: "05 · MIND_DECODE｜消费者心智与 VOC 解码", nav_short: "VOC 解码", icon: "◉", framework_stage: "MIND_DECODE", reference_number: 5,
      subsections: [
        { id: "jtbd", title: "JTBD 功能、情绪与社交任务" },
        { id: "coverage", title: "VOC 覆盖基数" },
        { id: "coded_theme_distribution", title: "编码主题分布" },
        { id: "unmet_needs", title: "未满足需求" },
        { id: "product_translation", title: "需求到产品动作" },
        { id: "boundary", title: "VOC 口径边界" },
      ],
    },
    framework_product_verify: {
      title: "08 · CPT_VERIFY｜产品方案与放行验证", nav_short: "产品验证", icon: "◇", framework_stage: "CPT_VERIFY", reference_number: 8,
      subsections: [
        { id: "candidate_scorecard", title: "候选方案记分卡" },
        { id: "must_should_must_not", title: "Must / Should / Must not" },
        { id: "validation_matrix", title: "验证矩阵" },
        { id: "approval_gates", title: "财务与运营放行线" },
      ],
    },
    framework_gtm_plan: {
      title: "10 · GTM_PLAN｜上市、渠道与首批节奏", nav_short: "上市打法", icon: "↗", framework_stage: "GTM_PLAN", reference_number: 10,
      subsections: [
        { id: "positioning", title: "定位主张" },
        { id: "execution_backlog_90d", title: "90 天证据门控待办" },
        { id: "launch_sequence", title: "上市节奏" },
        { id: "channel_message", title: "渠道信息架构" },
        { id: "first_batch_rule", title: "首批放量规则" },
      ],
    },
    aigc_grounded_synthesis: {
      title: "AIGC A1｜证据内综合与分歧清单", nav_short: "AI 综合", icon: "AI",
      subsections: [
        { id: "status", title: "生成状态与证据边界" },
        { id: "synthesis_matrix", title: "AIGC 证据综合矩阵" },
        { id: "disagreement_watchlist", title: "分歧与待补证清单" },
      ],
    },
    aigc_concept_portfolio: {
      title: "AIGC A2｜三档概念组合与产品路线", nav_short: "AI 概念组合", icon: "AI",
      subsections: [
        { id: "selected_direction", title: "推荐概念方向" },
        { id: "concept_options", title: "三档概念组合" },
        { id: "image_note", title: "概念图使用边界" },
      ],
    },
    aigc_design_system: {
      title: "AIGC A3｜DEMO Arc-Rhythm 设计练习", nav_short: "AI 品牌设计系统", icon: "AI",
      subsections: [
        { id: "evidence_state", title: "品牌设计结论" },
        { id: "brand_dna", title: "色彩、轮廓、立面、五金与摄影" },
        { id: "public_references", title: "虚构设计参考占位" },
      ],
    },
    aigc_design_review_pack: {
      title: "AIGC A4｜专业概念设计包与工程视图计划", nav_short: "AI 概念设计包", icon: "AI",
      subsections: [
        { id: "evidence_state", title: "概念包版本" },
        { id: "master_asset", title: "锁定 Master SKU" },
        { id: "required_views", title: "专业视图与用途" },
        { id: "concept_specification", title: "概念包络规格" },
      ],
    },
    aigc_listing_blueprint: {
      title: "AIGC A5｜Listing / A+ 信息架构", nav_short: "AI 内容蓝图", icon: "AI",
      subsections: [
        { id: "message_architecture", title: "Listing / A+ 内容草案" },
        { id: "prohibited_claims", title: "禁止自动生成的表达" },
        { id: "review_rule", title: "上线审核规则" },
      ],
    },
    aigc_redteam_validation: {
      title: "AIGC A6｜红队预演与验证护栏", nav_short: "AI 红队验证", icon: "AI",
      subsections: [
        { id: "pre_mortem", title: "失败预演" },
        { id: "validation_priority", title: "优先验证矩阵" },
        { id: "guardrails", title: "模型与上市护栏" },
      ],
    },
    aigc_quality_audit: {
      title: "AIGC A7｜概念质量审计与人工签核", nav_short: "AI 质量审计", icon: "AI",
      subsections: [
        { id: "evidence_state", title: "审计结论" },
        { id: "qa_checklist", title: "质量/工程/合规/物流签核" },
        { id: "automatic_rejects", title: "自动驳回项" },
      ],
    },
    market_signal: { title: "市场信号｜只保留可核验指标", nav_short: "市场信号", icon: "⌁" },
    competitive_raw_data: { title: "07 · 竞品拆解｜原始价格、评分、尺寸与链接", nav_short: "竞品拆解", icon: "▦", reference_number: 7 },
    voc_raw_data: { title: "06 · VOC 证据引擎｜公开评论信号与产品含义", nav_short: "VOC 证据", icon: "◌", reference_number: 6 },
    product_definition: { title: "产品定义｜Must / Should / Must not", nav_short: "产品定义", icon: "◇" },
    financial_model: { title: "09 · 单位经济｜成本瀑布与放行线", nav_short: "单位经济", icon: "$", reference_number: 9 },
    logistics_advantage: { title: "自有物流打法｜包装、妥投与补件", nav_short: "物流打法", icon: "⇢" },
    compliance_risk: { title: "合规与工程风险｜上市前清单", nav_short: "合规风险", icon: "△" },
    action_plan: { title: "90 天行动｜从样件到真实履约", nav_short: "行动计划", icon: "✓" },
    evidence_downloads: { title: "证据附件｜本轮 VOC 原始研究数据下载", nav_short: "原始数据下载", icon: "⇩" },
    source_register: { title: "来源台账｜证据等级、日期与链接", nav_short: "来源台账", icon: "↗" },
    methodology: { title: "证据附件｜研究口径与局限", nav_short: "口径与局限", icon: "i" },
    risk_register_sensitivity_confidence: { title: "61 · 风险登记、敏感性与置信度", nav_short: "风险登记", icon: "△", reference_number: 61, force_generic: true },
    trust_guardrails_methodology: { title: "62 · 可信护栏、审计与方法论", nav_short: "可信护栏", icon: "i", reference_number: 62, force_generic: true },
    ...pdfFrameworkMeta(),
  };

  const canonicalMeta: JsonObject = {
    ...meta,
    OP_SCAN: meta.framework_opportunity_scan,
    MKT_STRUCT: meta.framework_market_structure,
    MIND_DECODE: meta.framework_voc_decode,
    voc_evidence: {
      ...meta.voc_raw_data,
      title: "06 · VOC 证据引擎 · 评论标注与 ABSA 证据链",
      nav_short: "VOC 证据引擎",
    },
    competitor_teardown: {
      ...meta.competitive_raw_data,
      title: "07 · 竞品深度拆解",
      nav_short: "竞品拆解",
    },
    CPT_VERIFY: meta.framework_product_verify,
    output_unit_economics_finance: {
      ...meta.financial_model,
      title: "09 · 单位经济与财务",
      nav_short: "单位经济",
    },
    gtm_plan: meta.framework_gtm_plan,
  };

  return Object.fromEntries(REFERENCE_REPORT_MODULE_ORDER.map((moduleId) => {
    const span = REFERENCE_REPORT_MODULE_PAGE_SPANS_BY_ID[moduleId];
    return [moduleId, {
      ...(canonicalMeta[moduleId] || {}),
      reference_number: span.reference_number,
      reference_page_start: span.start_page,
      reference_page_end: span.end_page,
      reference_page_count: span.page_count,
      framework_source: REFERENCE_REPORT_SOURCE,
    }];
  }));
}

function buildReferenceRiskModules(config: JsonObject, vocEvidence: JsonObject): JsonObject {
  const price = targetPrice(config);
  const margin = contributionMargin(config);
  const evidenceRows = asRows(vocEvidence.evidence_log);
  const sourceRows = asRows(vocEvidence.source_coverage);
  return {
    risk_register_sensitivity_confidence: {
      evidence_state: {
        title: "风险结论",
        tag: "61 / REFERENCE",
        body: "风险模块不使用伪造概率或蒙特卡洛结果。当前先按可观察触发器、责任人和硬停止线管理；真实订单分布接入后再计算概率。",
      },
      risk_register: {
        columns: ["风险", "最早信号", "影响", "缓解", "Owner", "停止线"],
        rows: [
          ["需求/价格不成立", "真实 CVR、成交价或付费销量弱于公开样本", "库存与广告损失", "先做概念/价格测试和小批", "业务/数据", "连续两个验证周期低于门槛"],
          ["单位经济失真", "正式报价、履约或广告高于假设", "贡献利润跌破 12%", "订单级利润重算", "财务/供应链", "贡献率 <12%"],
          ["结构/活动件失效", "样机循环或首批 VOC 出现集中问题", "退货、差评、补件", "CTQ、DVT、过程能力与 CAPA", "工程/质量", config.gates?.[2] || "质量闸门失败"],
          ["包装/物流失效", "破损、错箱、缺件或长件附加费", "逆向成本与体验", "分箱验证、线路测试、部件级补发", "包装/物流", config.gates?.[1] || "破损超红线"],
          ["合规/IP", "文件缺口、投诉、下架预警", "下架/召回/诉讼", "FTO、测试、claim matrix", "法务/法规", "任何红项未关闭"],
          ["证据不足", "关键事实无来源或口径冲突", "错误投资决策", "冻结指标并补数", "研究负责人", "关键结论支持率 <100%"],
        ],
      },
      deterministic_sensitivity: {
        columns: ["冲击", "对贡献/件的近似影响", "动作"],
        rows: [
          ["售价 -10%", `-$${(price * 0.1).toFixed(1)}`, "守促销纪律，复核弹性"],
          ["总变动成本 +8%", `-$${((price * (1 - margin / 100)) * 0.08).toFixed(1)}`, "拆项 RFQ、替代设计"],
          ["广告 +5pct", `-$${(price * 0.05).toFixed(1)}`, "按 break-even ACOS 止损"],
          ["退货准备金 +3pct", `-$${(price * 0.03).toFixed(1)}`, "质量/包装 CAPA"],
        ],
      },
      confidence_boundary: `VOC 当前为 ${sourceRows.length} 个公开来源页、${evidenceRows.length} 条编码观察；足以形成方向性产品假设，不足以估计市场发生率。`,
    },
    trust_guardrails_methodology: {
      evidence_state: {
        title: "可信护栏结论",
        tag: "62 / REFERENCE",
        body: "框架、事实层、计算层、推断层、AIGC 层和人工签核分离。AIGC 共识不是独立证据，未签核项目明确显示待审。",
      },
      guardrail_chain: {
        columns: ["层", "检查", "本版状态", "失败处理"],
        rows: [
          ["L0 输入", "来源、日期、市场、单位、变体口径", "公开来源已登记；公司实账未接入", "缺项不进入事实层"],
          ["L1 事实", "观察值与来源一一对应", "竞品/VOC/法规可回溯", "断链或冲突降置信"],
          ["L2 计算", "统一价格/成本/公式", "单位经济来自单一成本瀑布", "跨模块不一致即构建失败"],
          ["L3 推断", "陈述限制与反证", "以 Medium/Low 标注", "不得写成官方市场事实"],
          ["L4 AIGC", "只在证据内综合；记录边界", "已启用 7 个增强模块", "不得新增 observed fact"],
          ["L5 人工", "产品/财务/法规/工程签核", "未完成", "报告保持‘概念提案/待放行’"],
        ],
      },
      evidence_thresholds: {
        columns: ["主题", "董事会级放行门", "本版状态"],
        rows: [
          ["市场/销量", "≥20 有效 ASIN + 90 天时序 + 关键量级交叉来源", "待补付费数据"],
          ["VOC", "目标 ≥1,000 去重评论且 ≥10 ASIN；关键痛点跨 ≥3 ASIN", `${sourceRows.length} 来源页 / ${evidenceRows.length} 编码观察；Limited`],
          ["价格弹性", "≥30 SKU-week 且存在真实价格变化", "待实验"],
          ["WTP/Conjoint", "美国目标用户 n≥200", "未运行，不显示数值"],
          ["供应链", "≥3 份有效报价 + 运价 + 税则", "待采购"],
          ["IP/合规", "官方数据库/法规 + 专业终审", "法规筛查已做；FTO/终审待完成"],
        ],
      },
      model_provenance: {
        columns: ["层", "用途", "能否支持事实"],
        rows: [
          ["公开数据/监管来源", "事实与规则", "可以，按置信度"],
          ["研究人员编码 VOC", "转述问题与产品含义", "可以支持方向，不支持发生率"],
          ["AIGC", "归纳、概念、内容草案、红队", "不可以独立支持事实"],
          ["人工终审", "最终放行", "当前尚未签核"],
        ],
      },
      limitations: commonMethodology.limitations,
    },
  };
}

function buildReport(
  config: JsonObject,
  options: ReferenceBoardReportBuildOptions = {},
) {
  const vocEvidence = options.vocEvidence || buildVocEvidence(config.slug);
  const evidenceMode = options.evidenceMode || "synthetic_fixture";
  const isDemo = evidenceMode === "synthetic_fixture" || evidenceMode === "template_demo";
  const demoNote = options.demoNote || (isDemo ? DEMO_NOTE : "");
  const strategy = buildStrategyFrameworks(config, vocEvidence);
  const decisionFunnel = buildDecisionFunnel(config);
  const verdictCode = config.verdict === "建议进入" ? "go" :
    config.verdict === "不建议进入" ? "no_go" : "conditional_go";
  const frameworkModules = buildFrameworkModules(config, vocEvidence, strategy, decisionFunnel);
  const aigcModules = buildAigcModules(config, vocEvidence);
  const deepModules = buildPdfFrameworkModules(config, vocEvidence, strategy);
  const riskModules = buildReferenceRiskModules(config, vocEvidence);
  const boardDecision = {
    verdict: isDemo ? "证据不足" : config.verdict,
    verdict_code: isDemo ? "insufficient_evidence" : verdictCode,
    score: config.score,
    grade: config.grade,
    one_liner: isDemo ? demoNote : config.one_liner,
    core_logic: config.why,
    decision_table: { columns: ["董事会要决定什么", "建议"], rows: config.decisions },
    gating_conditions: config.gates,
  };
  const evidenceDownloads = {
    dataset: {
      columns: ["数据包", "覆盖", "格式", "观察日", "下载"],
      rows: [[
        `${config.category.split("｜")[0]} VOC / URL QA`,
        `${asRows(vocEvidence.source_coverage).length} 个来源页；${asRows(vocEvidence.evidence_log).length} 条编码观察`,
        "JSON（含来源、评分/评论基数、转述、产品动作、证据限制）",
        DATA_CUTOFF,
        config.slug === "nightstands" || config.slug === "sideboard"
          ? "/data/voc-2026/voc-nightstands-sideboard.json"
          : config.slug === "slatted-platform-bed"
            ? "/data/voc-2026/voc-bed-market-qa.json"
            : "/data/voc-2026/voc-drawer-coffee.json",
      ]],
    },
    reuse_rules: isDemo ? [
      "随附 JSON 是原创虚构软件样例，真实评论和评分数量均为 0。",
      "signals 仅演示编码、图表与产品动作关联，不是任何真实消费者的意见。",
      "example.com 链接是占位符；禁止把占位链接计入真实证据。",
      "历史公开市场引用与合成 VOC 是不同数据层，前者本次未重新抓取核验。",
    ] : [
      "review/rating universe 是页面公开覆盖基数，不等于逐条抓取样本",
      "signals 是研究人员基于可见评论/零售商汇总的合规转述，不是消费者逐字原话",
      "平台 AI 摘要、激励评论、跨站同步与社区讨论已在数据中标记，不能外推为发生率",
      "productAction 是研究建议，不是来源页面的事实陈述",
    ],
  };
  const sourceRegister = {
    columns: ["编号", "来源", "类型", "观察时间", "关键发现", "置信度", "链接"],
    rows: [...config.sources, ...vocEvidence.source_register]
      .map((source: JsonObject) => [
        source.id,
        source.source,
        source.type,
        source.observed,
        source.finding,
        source.confidence,
        source.url,
      ]),
  };

  const canonicalModules: JsonObject = {
    exec_summary_decision_scorecard: {
      ...buildExecutiveSummary(config, vocEvidence, strategy),
      board_decision: boardDecision,
      framework_provenance: frameworkModules.framework_provenance,
      research_brief: frameworkModules.research_brief,
    },
    decision_funnel: decisionFunnel,
    OP_SCAN: {
      ...frameworkModules.framework_opportunity_scan,
      market_signal: config.market,
    },
    MKT_STRUCT: {
      ...frameworkModules.framework_market_structure,
      stp: strategy.stp,
      competitive_sample_register: config.raw,
    },
    MIND_DECODE: {
      ...frameworkModules.framework_voc_decode,
      jtbd: strategy.jtbd,
      consumer_psychology: strategy.consumer_psychology,
      customer_journey: strategy.customer_journey,
      category_voc_synthesis: config.voc,
    },
    voc_evidence: {
      ...vocEvidence,
      evidence_downloads: evidenceDownloads,
    },
    competitor_teardown: {
      evidence_state: {
        title: "竞品证据边界",
        tag: "TRACEABLE-SAMPLE",
        body: "竞品价格、评分、评论与尺寸均保留抓取日和公开链接；样本用于结构与切入判断，不外推为全市场份额。",
      },
      competitive_sample: config.raw,
      structure_interpretation: frameworkModules.framework_market_structure?.interpretation,
      attack_hypotheses: {
        columns: ["判断", "证据解释", "证据锚点"],
        rows: (config.why || []).map((item: any[]) => [item[0], item[1], item[2]]),
      },
    },
    CPT_VERIFY: {
      ...frameworkModules.framework_product_verify,
      product_definition: config.product,
      compliance_review: {
        items: {
          columns: ["事项", "风险级别", "上市前动作"],
          rows: config.compliance.items,
        },
        note: "合规结论需由美国法规顾问、测试机构和报关行基于最终结构、材料、用途文案与 HTS 归类确认。",
      },
    },
    output_unit_economics_finance: {
      ...config.finance,
      demand_forecast_input_gate: pendingInputGate(
        ["至少 24 个月同口径订单或销量序列", "价格、促销与缺货标记", "渠道流量和转化口径", "新品/断货/大促异常事件"],
        "按周或月清洗异常事件后建立基准、乐观与保守区间；用留出窗口回测，并同时报告误差、置信区间和失效条件。",
        "连续时序、异常标记或回测窗口未齐备时，不得绘制需求扇形图、给出销量预测区间或据此确定备货量。",
      ),
      logistics_assumptions: config.logistics,
    },
    gtm_plan: {
      ...frameworkModules.framework_gtm_plan,
      customer_journey: strategy.customer_journey,
      positioning_advertising_input_gate: pendingInputGate(
        ["目标细分与排除样本", "无品牌定位概念测试", "分阶段广告曝光、点击与转化", "价格和流量质量控制变量"],
        "先验证 STP 定位声明，再按冷启动、放量和守位阶段运行受控广告实验；仅用同口径样本计算定位差异、转化和贡献变化。",
        "没有合格目标样本、对照方案和同口径阶段数据时，不得生成定位雷达分数或宣称广告阶段策略已验证。",
      ),
      action_plan: {
        items: strategy.execution_backlog_90d.items,
        plan: strategy.execution_backlog_90d.table,
      },
      logistics_execution: config.logistics,
    },
    ...deepModules,
    risk_register_sensitivity_confidence: {
      ...riskModules.risk_register_sensitivity_confidence,
      compliance_watchlist: {
        columns: ["事项", "风险级别", "上市前动作"],
        rows: config.compliance.items,
      },
    },
    trust_guardrails_methodology: {
      ...riskModules.trust_guardrails_methodology,
      framework_provenance: frameworkModules.framework_provenance,
      source_register: sourceRegister,
      evidence_downloads: evidenceDownloads,
      methodology: commonMethodology,
      strategy_methodology: {
        framework_version: strategy.framework_version,
        sources: strategy.methodology_sources,
        data_adapter_contract: strategy.data_adapter_contract,
        boundaries: [
          "JTBD 是购买情境与期望进展假设，不是消费者逐字原话或需求发生率。",
          "消费者心理与旅程映射属于编码解释或管理假设；没有实验和行为事件时不输出心理发生率、转化率或因果提升。",
          "STP 细分规模与支付意愿未接入可审计面板或交易数据前保持待验证。",
          "经典 BCG 缺少真实增长率和相对市场份额时保持 PENDING；代理矩阵不得冒充经典象限。",
          "RICE 输入未齐备时不生成分数；待办优先级由硬闸门和依赖关系驱动。",
        ],
      },
    },
  };

  canonicalModules.pd_concept_matrix = {
    ...canonicalModules.pd_concept_matrix,
    product_concept: config.concept,
    aigc_concept_portfolio: aigcModules.aigc_concept_portfolio,
    aigc_design_system: aigcModules.aigc_design_system,
    aigc_design_review_pack: aigcModules.aigc_design_review_pack,
    aigc_quality_audit: aigcModules.aigc_quality_audit,
  };
  canonicalModules.pd_quality_return_pareto = {
    ...canonicalModules.pd_quality_return_pareto,
    post_purchase_journey: strategy.customer_journey,
  };
  canonicalModules.problem_solver_concept = {
    ...canonicalModules.problem_solver_concept,
    product_concept: config.concept,
    aigc_grounded_synthesis: aigcModules.aigc_grounded_synthesis,
    aigc_listing_blueprint: aigcModules.aigc_listing_blueprint,
    aigc_redteam_validation: aigcModules.aigc_redteam_validation,
  };
  if (isDemo) {
    canonicalModules.exec_summary_decision_scorecard.decision = {
      ...canonicalModules.exec_summary_decision_scorecard.decision,
      verdict: "insufficient_evidence",
      one_liner: demoNote,
    };
    decisionFunnel.final = { ...decisionFunnel.final, decision: "PENDING", score: 0, one_liner: demoNote };
    decisionFunnel.gate_funnel.status = "DEMO-NOT-EVALUATED";
    decisionFunnel.gate_funnel.rows = decisionFunnel.gate_funnel.rows.map((row: unknown[]) =>
      row.map((value, index) => index === 4 ? "PENDING" : value)
    );
  }

  const report: JsonObject = {
    board_report: true,
    evidence_mode: evidenceMode,
    decision_readiness: options.decisionReadiness || "insufficient_evidence",
    schema_version: "metis.report.v4",
    report_version: VERSION,
    strategy_framework_version: STRATEGY_FRAMEWORK_VERSION,
    presentation_version: "reference-a4-v2",
    reference_framework_modules: REFERENCE_REPORT_MODULE_ORDER.length,
    aigc_modules: 7,
    data_cutoff: options.dataCutoff || DATA_CUTOFF,
    ...(options.title ? { title: options.title } : isDemo ? { title: `框架演示｜${config.category.split("｜")[0]}` } : {}),
    category: config.category,
    marketplace: options.marketplace || "美国市场｜Amazon US + IKEA / Wayfair / Walmart 公共样本",
    verdict: isDemo ? "证据不足" : config.verdict,
    ...(demoNote ? { demo_note: demoNote } : {}),
    ...(options.conceptGeneration ? { concept_generation: options.conceptGeneration } : isDemo ? {
      concept_generation: { eligible: false, reason: DEMO_NOTE },
    } : {}),
    ...(isDemo ? { fixture_provenance: {
      voc: "synthetic_fixture",
      concept_image: "original_schematic_fixture",
      public_market_references: "historical_references_not_revalidated",
      real_review_count: 0,
    } } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.providerContract ? { provider_contract: options.providerContract } : {}),
    reference_layout: REFERENCE_REPORT_LAYOUT,
    reference_page_plan: REFERENCE_PAGE_PLAN,
    order: [...REFERENCE_REPORT_MODULE_ORDER],
    modules: {
      ...canonicalModules,
      // Compatibility aliases stay out of report.order; their content is also
      // folded into the canonical 62 modules above.
      board_decision: boardDecision,
      board_concept: config.concept,
      market_signal: config.market,
      competitive_raw_data: config.raw,
      voc_raw_data: vocEvidence,
      product_definition: config.product,
      financial_model: config.finance,
      logistics_advantage: config.logistics,
      compliance_risk: {
        items: { columns: ["事项", "风险级别", "上市前动作"], rows: config.compliance.items },
        note: "合规结论需由美国法规顾问、测试机构和报关行基于最终结构、材料、用途文案与 HTS 归类确认。",
      },
      action_plan: canonicalModules.gtm_plan.action_plan,
      strategy_frameworks: strategy,
      evidence_downloads: evidenceDownloads,
      source_register: sourceRegister,
      methodology: commonMethodology,
    },
    ext_meta: extMeta(),
  };
  return options.deferIntegrityFinalization
    ? report
    : finalizeReportForPersistence(report, { referencePagePlan: REFERENCE_PAGE_PLAN });
}

export const boardReportSeeds = reports.map((config) => ({
  slug: config.slug,
  version: VERSION,
  title: `框架演示｜${config.category.split("｜")[0]}`,
  verdict: "证据不足",
  research_plan: {
    category_scope: config.category,
    marketplace: "US",
    data_window: `合成 VOC 样例；历史公开引用日期 ${DATA_CUTOFF}，本次未重新核验`,
    purpose: "软件框架演示与测试；不能用于实际选品决策",
    company_context: "虚构品牌经营场景；实际销售规模、组织与履约能力由使用者填写和验证",
    evidence_mode: "synthetic_fixture",
    decision_readiness: "insufficient_evidence",
    completed: true,
  },
  report: buildReport(config),
}));

export function boardReportSeedForSlug(slug: unknown) {
  const normalizedSlug = String(slug || "").trim();
  return boardReportSeeds.find((seed) => seed.slug === normalizedSlug);
}

export function buildReferenceBoardReport(
  config: JsonObject,
  options: ReferenceBoardReportBuildOptions = {},
) {
  return buildReport(config, options);
}

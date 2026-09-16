/* eslint-disable @typescript-eslint/no-explicit-any */
import nightSideRaw from "@/data/voc_night_sideboard_2026-08-01.json";
import drawerCoffeeRaw from "@/data/voc_drawer_coffee_2026-08-01.json";
import bedRaw from "@/data/voc_bed_market_qa_2026-08-01.json";

type JsonObject = Record<string, any>;
type Signal = [polarity: "正向" | "负向" | "混合", theme: string, paraphrase: string, productAction: string, evidenceNote?: string];
type VocSource = {
  id: string; channel: string; product: string; rating: string; ratingCount: number;
  reviewCount: number; observed: string; url: string; evidenceNote: string; signals: Signal[];
};

// Original, fictional fixtures. Never interpret these as collected customer reviews.
const FIXTURE_NOTE = "SYNTHETIC｜人工编写的虚构样例，仅用于图表、分组与证据门禁测试；不是消费者原话、真实商品或市场统计。";
const CATEGORY_PREFIX: Record<string, string> = {
  nightstands: "NS", sideboard: "SB", "drawer-cabinet": "DC", "coffee-bar-counter": "CB", "slatted-platform-bed": "BED",
};
const SAMPLE_SIGNALS: Signal[] = [
  ["负向", "装配与说明", "【虚构样例】试用角色希望装配步骤附带方向标记。", "样机任务示例：比较两版说明书的理解时间。"],
  ["混合", "门抽与活动件", "【虚构样例】试用角色希望更容易识别活动部件的状态。", "样机任务示例：检查开合状态及夹手间隙。"],
  ["负向", "包装与履约", "【虚构样例】试用角色希望配件按使用顺序归类。", "样机任务示例：比较两种分箱与配件标识方案。"],
  ["正向", "电源与线缆", "【虚构样例】试用角色认为清晰的线缆位置有助于整理。", "样机任务示例：验证走线空间与维护方式。"],
  ["混合", "尺寸与场景适配", "【虚构样例】试用角色需要购买前理解实际使用尺寸。", "样机任务示例：制作尺寸卡并进行理解测试。"],
  ["正向", "外观、材料与价值", "【虚构样例】试用角色偏好视觉与触感一致的样板。", "样机任务示例：盲测不同表面样板。"],
  ["正向", "储物与使用体验", "【虚构样例】试用角色希望常用物品容易取放。", "样机任务示例：记录取放路径与任务完成情况。"],
  ["混合", "移动与稳定", "【虚构样例】试用角色希望移动与固定状态容易区分。", "样机任务示例：验证移动部件的状态提示。"],
  ["负向", "结构、承重与耐久", "【虚构样例】试用角色需要明确产品的使用边界。", "样机任务示例：编写待验证的耐久试验计划。"],
];

function fixtureSources(slug: string): VocSource[] {
  const prefix = CATEGORY_PREFIX[slug];
  if (!prefix) return [];
  return Array.from({ length: 7 }, (_, index) => ({
    id: `VOC-${prefix}-${String(index + 1).padStart(2, "0")}`,
    channel: "合成样例",
    product: `虚构 ${slug} 概念 ${index + 1}`,
    rating: "不适用（合成样例）", ratingCount: 0, reviewCount: 0, observed: "2000-01-01",
    url: `https://example.com/metis/synthetic/${slug}/${index + 1}`,
    evidenceNote: FIXTURE_NOTE,
    signals: Array.from({ length: 3 }, (_, offset): Signal => {
      const [polarity, theme, paraphrase, action] = SAMPLE_SIGNALS[(index * 3 + offset) % SAMPLE_SIGNALS.length];
      return [polarity, theme, paraphrase, action, FIXTURE_NOTE];
    }),
  }));
}

function normalizedPolarity(value: unknown): Signal[0] {
  const text = String(value || "").toLowerCase();
  if (text === "positive" || text === "正向") return "正向";
  if (text === "negative" || text === "负向") return "负向";
  return "混合";
}

function normalizeExternalSource(source: JsonObject): VocSource {
  return {
    id: String(source.id), channel: "合成样例", product: String(source.product),
    rating: "不适用（合成样例）", ratingCount: 0, reviewCount: 0, observed: "2000-01-01",
    url: String(source.url), evidenceNote: FIXTURE_NOTE,
    signals: (Array.isArray(source.signals) ? source.signals : []).map((item: JsonObject) => [
      normalizedPolarity(item.polarity), String(item.theme || "其他产品体验"),
      String(item.paraphrase || item.evidence || ""), String(item.productAction || "仅用于测试"), FIXTURE_NOTE,
    ]),
  };
}

function externalSources(slug: string): VocSource[] {
  if (slug === "nightstands" || slug === "sideboard") {
    return ((nightSideRaw as JsonObject).categories?.[slug]?.sources || []).map(normalizeExternalSource);
  }
  if (slug === "drawer-cabinet" || slug === "coffee-bar-counter") {
    return ((drawerCoffeeRaw as JsonObject).categories?.[slug] || []).map(normalizeExternalSource);
  }
  if (slug === "slatted-platform-bed") return ((bedRaw as JsonObject).newSlattedPlatformBedVoc || []).map(normalizeExternalSource);
  return [];
}

export function normalizeVocThemeBucket(theme: unknown) {
  const value = String(theme || "").toLowerCase();
  if (/装配|孔位|零件标识|说明|五金|assembl|instruction|part precision|pre-?drill|hardware/.test(value)) return "装配与说明";
  if (/门板|门缝|门抽|抽屉|导轨|滑门|开度|drawer|glide|rail|sliding action|lock mechanism/.test(value)) return "门抽与活动件";
  if (/运输|包装|外箱|arrival damage|arriving damaged|handling damage|missing feet|shipping|packag/.test(value)) return "包装与履约";
  if (/电源|充电|插座|走线|power|outlet|charging|cable|cord/.test(value)) return "电源与线缆";
  if (/尺寸|高度|宽度|兼容|空间|冰箱位|用途误导|文件|small-space|footprint|room fit|size|dimension|compatib|fridge/.test(value)) return "尺寸与场景适配";
  if (/外观|质感|价值|价格|材料宣称|appearance|finish|color|material|quality|value|upscale|price/.test(value)) return "外观、材料与价值";
  if (/容量|储物|工作流|多用途|多层|capacity|storage|versatility|coffee-station|coffee and beverage|function/.test(value)) return "储物与使用体验";
  if (/移动|脚轮|caster|wheel|mobility/.test(value)) return "移动与稳定";
  if (/异响|排骨|结构|稳固|承重|耐久|板材|晃动|sturd|substantial build|build quality|drawer bottom|fragile/.test(value)) return "结构、承重与耐久";
  return "其他产品体验";
}

export function buildVocEvidence(slug: string) {
  const sources = [...fixtureSources(slug), ...externalSources(slug)];
  const themeCounts = new Map<string, { total: number; negative: number; positive: number }>();
  for (const source of sources) for (const [polarity, theme] of source.signals) {
    const bucket = normalizeVocThemeBucket(theme);
    const current = themeCounts.get(bucket) || { total: 0, negative: 0, positive: 0 };
    current.total += 1;
    if (polarity === "负向") current.negative += 1;
    if (polarity === "正向") current.positive += 1;
    themeCounts.set(bucket, current);
  }
  const evidenceCount = sources.reduce((sum, source) => sum + source.signals.length, 0);
  return {
    synthetic: true, source_mode: "synthetic_fixture", evidence_mode: "template_demo", decision_readiness: "insufficient_evidence",
    methodology_note: FIXTURE_NOTE,
    sample_definition: {
      columns: ["计数口径", "定义", "本报告值", "不可解释为"],
      rows: [
        ["样例来源", "用于演示来源台账结构的虚构条目", sources.length, "真实公开来源页"],
        ["真实 Ratings 基数", "未采集真实评分", 0, "市场覆盖量"],
        ["真实 Reviews 基数", "未采集真实评论", 0, "消费者样本数量"],
        ["合成观察", "人工编写的测试记录", evidenceCount, "真实消费者意见或市场发生率"],
      ],
      note: "示例数只用于软件测试，不能外推为市场发生率。example.com 链接是保留域名占位，不是证据。",
    },
    coverage_summary: {
      columns: ["样例来源", "真实 Ratings 基数", "真实 Reviews 基数", "合成观察", "归并主题"],
      rows: [[sources.length, 0, 0, evidenceCount, themeCounts.size]],
    },
    source_coverage: {
      columns: ["编号", "渠道", "虚构产品", "评分", "真实 Ratings 基数", "真实 Reviews 基数", "占位日期", "样例说明", "占位链接"],
      rows: sources.map((source) => [source.id, source.channel, source.product, source.rating, 0, 0, source.observed, FIXTURE_NOTE, source.url]),
    },
    theme_distribution: {
      columns: ["主题", "合成观察数", "负向", "正向", "说明"],
      rows: [...themeCounts.entries()].sort((a, b) => b[1].total - a[1].total).map(([theme, counts]) => [theme, counts.total, counts.negative, counts.positive, "仅表示虚构测试记录的分组"]),
    },
    evidence_log: {
      columns: ["编号", "渠道", "虚构产品", "样例类型", "极性", "主题", "合成信号（非消费者原话）", "测试任务示例", "证据边界", "占位链接"],
      rows: sources.flatMap((source) => source.signals.map((signal, index) => [
        `${source.id}-${String(index + 1).padStart(2, "0")}`, source.channel, source.product, "SYNTHETIC / 无真实评论",
        signal[0], signal[1], signal[2], signal[3], FIXTURE_NOTE, source.url,
      ])),
    },
    synthesis: [`${sources.length} 个虚构来源、${evidenceCount} 条合成观察，仅验证渲染和聚合。`, "真实市场与消费者证据为 0；禁止据此作出选品、采购、定价或上市决策。"],
    source_register: sources.map((source) => ({
      id: source.id, source: `${source.channel}｜${source.product}`, type: "合成测试样例", observed: source.observed,
      finding: FIXTURE_NOTE, confidence: "Low", url: source.url, synthetic: true, source_mode: "synthetic_fixture",
    })),
  };
}

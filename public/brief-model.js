const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

const hasValue = (value) => value !== "" && value !== null && value !== undefined;
const numberOf = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const rounded = (value, digits = 2) => Number(value.toFixed(digits));

export function normalizeAsins(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean)));
}

export function calculateUnitEconomics(cost = {}) {
  const fob = numberOf(cost.fob);
  const freight = numberOf(cost.freight);
  const fba = numberOf(cost.fba);
  const price = numberOf(cost.price);
  const acos = numberOf(cost.acos);
  const splitDutyProvided = ["dutyBase", "duty301", "duty232"].some((key) => hasValue(cost[key]));
  const dutyRate = splitDutyProvided
    ? numberOf(cost.dutyBase) + numberOf(cost.duty301) + numberOf(cost.duty232)
    : numberOf(cost.duty);
  const dutyAmount = fob * dutyRate / 100;
  const landed = fob + freight + dutyAmount;
  const referral = price * 0.15;
  const advertising = price * acos / 100;
  const net = price - referral - fba - landed - advertising;
  const complete = ["fob", "freight", "fba", "acos", "price"].every((key) => hasValue(cost[key])) &&
    [fob, freight, fba, acos, price, dutyRate].every((value) => Number.isFinite(value) && value >= 0) &&
    price > 0;

  return {
    complete,
    dutyRate: rounded(dutyRate),
    dutyAmount: rounded(dutyAmount),
    landed: rounded(landed),
    referral: rounded(referral),
    advertising: rounded(advertising),
    net: rounded(net),
    netMargin: price > 0 ? rounded(net / price * 100, 1) : 0,
  };
}

function priceBandIssue(bands, priceMin, priceMax) {
  if (!Array.isArray(bands) || bands.length === 0) return "至少保留一个细分赛道";
  const normalized = [];
  for (const [index, band] of bands.entries()) {
    const name = String(band?.name || "").trim();
    const lo = Number(band?.lo);
    const hi = Number(band?.hi);
    if (!name) return `第 ${index + 1} 个细分赛道缺少名称`;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return `${name} 的价格范围无效`;
    if (hi <= lo) return `${name} 的上限必须大于下限`;
    if (lo < priceMin || hi > priceMax) return `${name} 超出总价格带`;
    normalized.push({ name, lo, hi });
  }
  normalized.sort((a, b) => a.lo - b.lo);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].lo < normalized[index - 1].hi) {
      return `${normalized[index - 1].name} 与 ${normalized[index].name} 的价格范围重叠`;
    }
  }
  return "";
}

export function evaluateBriefReadiness(input = {}) {
  const mode = input.mode === "asin_list" ? "asin_list" : "category_keyword";
  const asins = normalizeAsins(input.asins);
  const invalidAsins = asins.filter((asin) => !ASIN_PATTERN.test(asin));
  const keyword = String(input.keyword || "").trim();
  const priceMin = Number(input.priceMin);
  const priceMax = Number(input.priceMax);
  const priceReady = Number.isFinite(priceMin) && Number.isFinite(priceMax) && priceMin >= 0 && priceMax > priceMin;
  const bandIssue = priceReady ? priceBandIssue(input.bands, priceMin, priceMax) : "先修正总价格带";
  const weightSum = (Array.isArray(input.weights) ? input.weights : [])
    .reduce((sum, value) => sum + numberOf(value), 0);
  const checks = [
    {
      id: "subject",
      label: "研究对象",
      step: "3",
      ready: mode === "asin_list"
        ? asins.length >= 1 && asins.length <= 50 && invalidAsins.length === 0
        : keyword.length >= 2 && keyword.length <= 160,
      detail: mode === "asin_list"
        ? (invalidAsins.length ? `ASIN 格式无效：${invalidAsins[0]}` : `${asins.length} 个 ASIN`)
        : (keyword ? `${keyword.length} 个字符` : "未填写品类"),
    },
    {
      id: "market",
      label: "主分析站点",
      step: "3",
      ready: Array.isArray(input.markets) && input.markets.length > 0,
      detail: input.markets?.[0] || "未选择站点",
    },
    {
      id: "price",
      label: "总价格带",
      step: "3",
      ready: priceReady,
      detail: priceReady ? `$${priceMin}–$${priceMax}` : "上限必须大于下限",
    },
    {
      id: "segments",
      label: "细分赛道",
      step: "3",
      ready: priceReady && !bandIssue,
      detail: bandIssue || `${input.bands.length} 个赛道`,
    },
    {
      id: "goals",
      label: "研究目标",
      step: "2",
      ready: Array.isArray(input.goals) && input.goals.length > 0,
      detail: input.goals?.length ? `${input.goals.length} 个目标` : "至少选择一个目标",
    },
    {
      id: "weights",
      label: "机会分权重",
      step: "6",
      ready: Number.isFinite(weightSum) && weightSum > 0,
      detail: weightSum > 0 ? `原始和 ${Math.round(weightSum * 100)}%` : "权重不能全部为 0",
    },
    {
      id: "delivery",
      label: "交付视图",
      step: "7",
      ready: Array.isArray(input.views) && input.views.length > 0,
      detail: input.views?.length ? input.views.join(" / ") : "至少选择一个视图",
    },
  ];
  const blockers = checks.filter((item) => !item.ready);
  return {
    ready: blockers.length === 0,
    checks,
    blockers,
    completed: checks.length - blockers.length,
    total: checks.length,
    invalidAsins,
    normalizedAsins: asins,
    bandIssue,
  };
}

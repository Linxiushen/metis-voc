import type {
  ResearchObservation,
  ResearchObservationBatch,
} from "./research-data-adapters";

export const KEEPAMORE_DEFAULT_BASE_URL = "https://mcp.keepamore.com/api";
export const KEEPAMORE_ADAPTER_ID = "keepamore-amazon-market-adapter";

const KEEPA_EPOCH_OFFSET_MINUTES = 21_564_000;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const MAX_ASINS_PER_REQUEST = 100;

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;
type SleepLike = (delayMs: number) => Promise<void>;
type DetailLevel = "summary" | "lite" | "full";
type ProductRequestMethod = "GET" | "POST";

type DomainInfo = {
  country: string;
  marketplace: string;
  currency: string;
  minorUnitScale: number;
};

const DOMAIN_INFO: Record<number, DomainInfo> = {
  1: { country: "us", marketplace: "Amazon US", currency: "USD", minorUnitScale: 100 },
  2: { country: "uk", marketplace: "Amazon UK", currency: "GBP", minorUnitScale: 100 },
  3: { country: "de", marketplace: "Amazon DE", currency: "EUR", minorUnitScale: 100 },
  4: { country: "fr", marketplace: "Amazon FR", currency: "EUR", minorUnitScale: 100 },
  5: { country: "jp", marketplace: "Amazon JP", currency: "JPY", minorUnitScale: 1 },
  6: { country: "ca", marketplace: "Amazon CA", currency: "CAD", minorUnitScale: 100 },
  7: { country: "cn", marketplace: "Amazon CN", currency: "CNY", minorUnitScale: 100 },
  8: { country: "it", marketplace: "Amazon IT", currency: "EUR", minorUnitScale: 100 },
  9: { country: "es", marketplace: "Amazon ES", currency: "EUR", minorUnitScale: 100 },
  10: { country: "in", marketplace: "Amazon IN", currency: "INR", minorUnitScale: 100 },
  11: { country: "mx", marketplace: "Amazon MX", currency: "MXN", minorUnitScale: 100 },
  12: { country: "br", marketplace: "Amazon BR", currency: "BRL", minorUnitScale: 100 },
};

const NON_RETRYABLE_QUOTA_CODES = new Set([
  "QUOTA_DAY",
  "QUOTA_MONTH",
  "QUOTA_NO_SUBSCRIPTION",
  "QUOTA_OFF_PEAK_WINDOW",
  "QUOTA_EXCEEDED",
]);

export type KeepaMoreClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
  sleep?: SleepLike;
  now?: () => number;
};

export type KeepaMoreMoney = {
  amount: number;
  minorUnits: number;
  currency: string;
  minorUnitScale: number;
};

export type KeepaMorePricePoint = {
  keepaTime: number;
  at: string;
  price: KeepaMoreMoney | null;
};

export type KeepaMorePriceExtreme = {
  at: string | null;
  price: KeepaMoreMoney | null;
};

export type KeepaMoreBatchError = {
  asin: string | null;
  code: string | null;
  message: string | null;
  errorId: string | null;
};

export type KeepaMoreQuotaWindow = {
  limit: number | null;
  remaining: number | null;
};

export type KeepaMoreMetadata = {
  requestId: string | null;
  unitsCharged: number | null;
  cached: boolean | null;
  quota: {
    minute: KeepaMoreQuotaWindow;
    day: KeepaMoreQuotaWindow;
    month: KeepaMoreQuotaWindow;
  };
};

export type KeepaMoreProductSearchObservation = {
  query: string;
  position: number;
  observedAt: string;
};

export type KeepaMoreProduct = {
  asin: string;
  domainId: number;
  marketplace: string;
  currency: string;
  productType: number | null;
  title: string | null;
  brand: string | null;
  manufacturer: string | null;
  model: string | null;
  color: string | null;
  size: string | null;
  parentAsin: string | null;
  categoryIds: string[];
  categoryTree: Array<{ id: string; name: string }>;
  imageUrls: string[];
  currentPrice: KeepaMoreMoney | null;
  currentPriceSource: "buy_box" | "new" | "amazon" | null;
  intervalAveragePrice: KeepaMoreMoney | null;
  averagePrice30d: KeepaMoreMoney | null;
  averagePrice90d: KeepaMoreMoney | null;
  averagePrice180d: KeepaMoreMoney | null;
  intervalMinimumPrice: KeepaMorePriceExtreme;
  intervalMaximumPrice: KeepaMorePriceExtreme;
  priceHistory: KeepaMorePricePoint[];
  rating: number | null;
  reviewCount: number | null;
  salesRank: number | null;
  salesRankDrops30d: number | null;
  monthlySold: number | null;
  totalOfferCount: number | null;
  buyBoxIsFba: boolean | null;
  fbaPickAndPackFee: KeepaMoreMoney | null;
  referralFeePercentage: number | null;
  searchPosition: number | null;
  sourceQueries?: string[];
  searchObservations?: KeepaMoreProductSearchObservation[];
  trackingSince: string | null;
  listedSince: string | null;
  lastUpdate: string | null;
  lastPriceChange: string | null;
  lastRatingUpdate: string | null;
  lastSoldUpdate: string | null;
};

type KeepaMoreResultBase = {
  domainId: number;
  marketplace: string;
  currency: string;
  observedAt: string;
  sourceRef: string;
  searchSourceRef: string | null;
  products: KeepaMoreProduct[];
  errors: KeepaMoreBatchError[];
  duplicateCount: number;
  warnings: string[];
  metadata: KeepaMoreMetadata;
};

export type KeepaMoreSearchResult = KeepaMoreResultBase & {
  kind: "product_search";
  query: string;
  page: number;
  asins: string[];
  count: number;
  nextCursor: string | null;
};

export type KeepaMoreProductResult = KeepaMoreResultBase & {
  kind: "product";
  requestedAsins: string[];
  count: number;
};

export type KeepaMoreCatBedResearchResult = {
  query: "cat bed";
  estimatedUnits: number;
  search: KeepaMoreSearchResult;
  enrichment: KeepaMoreProductResult;
  observationBatch: ResearchObservationBatch;
};

export type KeepaMoreProductSearchOptions = {
  term: string;
  domain?: number;
  page?: number;
  asinsOnly?: boolean;
  stats?: number | string;
  history?: boolean;
  historyDays?: number;
  update?: number;
  rating?: boolean;
  detailLevel?: DetailLevel;
};

export type KeepaMoreProductOptions = {
  asins: string[];
  domain?: number;
  stats?: number;
  history?: boolean;
  update?: number;
  offers?: number;
  rating?: boolean;
  buybox?: boolean;
  stock?: boolean;
  days?: number;
  dateRange?: { start: number; end: number };
  detailLevel?: DetailLevel;
  method?: ProductRequestMethod;
};

export type KeepaMoreCatBedResearchOptions = {
  domain?: number;
  page?: number;
  maxProducts?: number;
  statsDays?: number;
  detailLevel?: DetailLevel;
};

export type KeepaMoreObservationBatchOptions = {
  category?: string;
  marketplace?: string;
};

type ApiEnvelope = {
  code: string;
  msg: string;
  data: unknown;
  metadata: KeepaMoreMetadata;
};

type NormalizedProducts = {
  products: KeepaMoreProduct[];
  errors: KeepaMoreBatchError[];
  duplicateCount: number;
  warnings: string[];
};

export class KeepaMoreApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly errorId: string | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(value: {
    message: string;
    code: string;
    status: number;
    errorId?: string | null;
    retryable?: boolean;
    retryAfterMs?: number | null;
  }) {
    super(value.message);
    this.name = "KeepaMoreApiError";
    this.code = value.code;
    this.status = value.status;
    this.errorId = value.errorId || null;
    this.retryable = value.retryable === true;
    this.retryAfterMs = value.retryAfterMs ?? null;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nonNegativeNumberOrNull(value: unknown): number | null {
  const parsed = finiteNumberOrNull(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function integerOrNull(value: unknown): number | null {
  const parsed = finiteNumberOrNull(value);
  return parsed != null && Number.isInteger(parsed) ? parsed : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function valueAt(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined;
}

function domainInfo(domainId: number): DomainInfo {
  return DOMAIN_INFO[domainId] || DOMAIN_INFO[1];
}

function requireDomain(value: number | undefined): number {
  const domainId = value ?? 1;
  if (!Number.isInteger(domainId) || domainId < 1 || domainId > 12) {
    throw new TypeError("KeepaMore domain must be an integer from 1 through 12");
  }
  return domainId;
}

function requireIntegerInRange(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return result;
}

function optionalNonNegativeInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function optionalPositiveInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function requireDetailLevel(value: DetailLevel | undefined): DetailLevel {
  const detailLevel = value || "summary";
  if (!["summary", "lite", "full"].includes(detailLevel)) {
    throw new TypeError("KeepaMore detailLevel must be summary, lite, or full");
  }
  return detailLevel;
}

function normalizeAsins(values: string[]): string[] {
  if (!Array.isArray(values)) throw new TypeError("KeepaMore asins must be an array");
  const unique = new Set<string>();
  for (const value of values) {
    const asin = String(value || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      throw new TypeError(`Invalid Amazon ASIN: ${asin || "(empty)"}`);
    }
    unique.add(asin);
  }
  const asins = [...unique];
  if (asins.length < 1 || asins.length > MAX_ASINS_PER_REQUEST) {
    throw new TypeError(`KeepaMore product requests require 1-${MAX_ASINS_PER_REQUEST} unique ASINs`);
  }
  return asins;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError("KeepaMore baseUrl must be an absolute HTTP(S) URL");
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.search || parsed.hash) {
    throw new TypeError("KeepaMore baseUrl must be an absolute HTTP(S) URL without query or hash");
  }
  return normalized;
}

function queryBoolean(value: boolean): string {
  return value ? "1" : "0";
}

function appendOptionalQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value === "boolean") {
    params.set(key, queryBoolean(value));
    return;
  }
  params.set(key, String(value));
}

function keepaCode(value: unknown): string {
  if (value === 0 || value === "0") return "0000";
  return String(value ?? "").trim();
}

function quotaWindow(value: unknown): KeepaMoreQuotaWindow {
  const record = isRecord(value) ? value : {};
  return {
    limit: nonNegativeNumberOrNull(record.limit),
    remaining: nonNegativeNumberOrNull(record.remaining),
  };
}

function normalizeMetadata(value: unknown): KeepaMoreMetadata {
  const metadata = isRecord(value) ? value : {};
  const quotaHint = isRecord(metadata.quotaHint) ? metadata.quotaHint : {};
  return {
    requestId: stringOrNull(metadata.requestId) || stringOrNull(metadata.request_id),
    unitsCharged:
      nonNegativeNumberOrNull(metadata.unitsCharged) ??
      nonNegativeNumberOrNull(metadata.units) ??
      nonNegativeNumberOrNull(metadata.cost),
    cached: booleanOrNull(metadata.cached),
    quota: {
      minute: quotaWindow(quotaHint.minute),
      day: quotaWindow(quotaHint.day),
      month: quotaWindow(quotaHint.month),
    },
  };
}

export function keepaTimeToIso(value: unknown): string | null {
  const keepaTime = integerOrNull(value);
  if (keepaTime == null || keepaTime <= 0) return null;
  const unixMilliseconds = (keepaTime + KEEPA_EPOCH_OFFSET_MINUTES) * 60_000;
  const date = new Date(unixMilliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function keepaPriceToMoney(value: unknown, domainId = 1): KeepaMoreMoney | null {
  const minorUnits = nonNegativeNumberOrNull(value);
  if (minorUnits == null) return null;
  const info = domainInfo(domainId);
  return {
    amount: minorUnits / info.minorUnitScale,
    minorUnits,
    currency: info.currency,
    minorUnitScale: info.minorUnitScale,
  };
}

function statsPrice(stats: JsonRecord, field: string, priceType: number, domainId: number): KeepaMoreMoney | null {
  return keepaPriceToMoney(valueAt(stats[field], priceType), domainId);
}

function preferredStatsPrice(
  stats: JsonRecord,
  field: string,
  priceTypes: number[],
  domainId: number,
): KeepaMoreMoney | null {
  for (const priceType of priceTypes) {
    const price = statsPrice(stats, field, priceType, domainId);
    if (price) return price;
  }
  return null;
}

function statsExtreme(
  stats: JsonRecord,
  field: string,
  priceType: number,
  domainId: number,
): KeepaMorePriceExtreme {
  const point = valueAt(stats[field], priceType);
  return {
    at: keepaTimeToIso(valueAt(point, 0)),
    price: keepaPriceToMoney(valueAt(point, 1), domainId),
  };
}

function preferredStatsExtreme(
  stats: JsonRecord,
  field: string,
  priceTypes: number[],
  domainId: number,
): KeepaMorePriceExtreme {
  for (const priceType of priceTypes) {
    const extreme = statsExtreme(stats, field, priceType, domainId);
    if (extreme.price) return extreme;
  }
  return { at: null, price: null };
}

function parsePriceHistory(csv: unknown, domainId: number): KeepaMorePricePoint[] {
  if (!Array.isArray(csv)) return [];
  const newPriceHistory = Array.isArray(csv[1]) ? csv[1] : Array.isArray(csv[0]) ? csv[0] : [];
  const firstIndex = Math.max(0, newPriceHistory.length - 10_000);
  const start = firstIndex % 2 === 0 ? firstIndex : firstIndex + 1;
  const points: KeepaMorePricePoint[] = [];
  for (let index = start; index + 1 < newPriceHistory.length; index += 2) {
    const keepaTime = integerOrNull(newPriceHistory[index]);
    const at = keepaTimeToIso(keepaTime);
    if (keepaTime == null || at == null) continue;
    points.push({
      keepaTime,
      at,
      price: keepaPriceToMoney(newPriceHistory[index + 1], domainId),
    });
  }
  return points;
}

function imageUrl(value: unknown): string | null {
  const image = stringOrNull(value);
  if (!image) return null;
  if (/^https?:\/\//i.test(image)) return image;
  return `https://m.media-amazon.com/images/I/${image.replace(/^\/+/, "")}`;
}

function normalizeProduct(
  value: unknown,
  context: { domainId: number; searchPosition?: number | null },
): KeepaMoreProduct | null {
  if (!isRecord(value)) return null;
  const asin = String(value.asin || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) return null;

  const rawDomainId = integerOrNull(value.domainId);
  const domainId = rawDomainId != null && rawDomainId >= 1 && rawDomainId <= 12
    ? rawDomainId
    : context.domainId;
  const info = domainInfo(domainId);
  const stats = isRecord(value.stats) ? value.stats : {};
  const current = Array.isArray(stats.current) ? stats.current : [];

  const buyBoxBase = keepaPriceToMoney(stats.buyBoxPrice, domainId);
  const buyBoxShipping = keepaPriceToMoney(stats.buyBoxShipping, domainId);
  const buyBoxCombined = keepaPriceToMoney(current[18], domainId);
  const newPrice = keepaPriceToMoney(current[1], domainId);
  const amazonPrice = keepaPriceToMoney(current[0], domainId);
  let currentPrice: KeepaMoreMoney | null = null;
  let currentPriceSource: KeepaMoreProduct["currentPriceSource"] = null;
  let summaryPriceType = 1;
  if (buyBoxBase && buyBoxShipping) {
    currentPrice = keepaPriceToMoney(
      buyBoxBase.minorUnits + buyBoxShipping.minorUnits,
      domainId,
    );
    currentPriceSource = "buy_box";
    summaryPriceType = 18;
  } else if (buyBoxCombined) {
    currentPrice = buyBoxCombined;
    currentPriceSource = "buy_box";
    summaryPriceType = 18;
  } else if (buyBoxBase) {
    currentPrice = buyBoxBase;
    currentPriceSource = "buy_box";
    summaryPriceType = 18;
  } else if (newPrice) {
    currentPrice = newPrice;
    currentPriceSource = "new";
    summaryPriceType = 1;
  } else if (amazonPrice) {
    currentPrice = amazonPrice;
    currentPriceSource = "amazon";
    summaryPriceType = 0;
  }

  const rawImages = Array.isArray(value.images) ? value.images : [];
  const imageUrls = rawImages
    .map((entry) => {
      if (typeof entry === "string") return imageUrl(entry);
      if (!isRecord(entry)) return null;
      return imageUrl(entry.l) || imageUrl(entry.m);
    })
    .filter((entry): entry is string => Boolean(entry));

  const rawCategoryTree = Array.isArray(value.categoryTree) ? value.categoryTree : [];
  const categoryTree = rawCategoryTree.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = entry.catId == null ? "" : String(entry.catId);
    const name = stringOrNull(entry.name);
    return id && name ? [{ id, name }] : [];
  });

  const ratingTenths = nonNegativeNumberOrNull(current[16]);
  const fbaFees = isRecord(value.fbaFees) ? value.fbaFees : {};
  const priceTypeOrder = [...new Set([summaryPriceType, 1, 0])];
  const minimum = preferredStatsExtreme(stats, "minInInterval", priceTypeOrder, domainId);
  const maximum = preferredStatsExtreme(stats, "maxInInterval", priceTypeOrder, domainId);
  const fallbackMinimum = minimum.price
    ? minimum
    : preferredStatsExtreme(stats, "min", priceTypeOrder, domainId);
  const fallbackMaximum = maximum.price
    ? maximum
    : preferredStatsExtreme(stats, "max", priceTypeOrder, domainId);

  return {
    asin,
    domainId,
    marketplace: info.marketplace,
    currency: info.currency,
    productType: nonNegativeNumberOrNull(value.productType),
    title: stringOrNull(value.title),
    brand: stringOrNull(value.brand),
    manufacturer: stringOrNull(value.manufacturer),
    model: stringOrNull(value.model),
    color: stringOrNull(value.color),
    size: stringOrNull(value.size),
    parentAsin: stringOrNull(value.parentAsin)?.toUpperCase() || null,
    categoryIds: Array.isArray(value.categories)
      ? value.categories.filter((entry) => entry != null).map(String)
      : [],
    categoryTree,
    imageUrls: [...new Set(imageUrls)],
    currentPrice,
    currentPriceSource,
    intervalAveragePrice: preferredStatsPrice(stats, "avg", priceTypeOrder, domainId),
    averagePrice30d: preferredStatsPrice(stats, "avg30", priceTypeOrder, domainId),
    averagePrice90d: preferredStatsPrice(stats, "avg90", priceTypeOrder, domainId),
    averagePrice180d: preferredStatsPrice(stats, "avg180", priceTypeOrder, domainId),
    intervalMinimumPrice: fallbackMinimum,
    intervalMaximumPrice: fallbackMaximum,
    priceHistory: parsePriceHistory(value.csv, domainId),
    rating: ratingTenths == null ? null : ratingTenths / 10,
    reviewCount: nonNegativeNumberOrNull(current[17]),
    salesRank: nonNegativeNumberOrNull(current[3]),
    salesRankDrops30d: nonNegativeNumberOrNull(stats.salesRankDrops30),
    monthlySold: nonNegativeNumberOrNull(value.monthlySold),
    totalOfferCount:
      nonNegativeNumberOrNull(stats.totalOfferCount) ?? nonNegativeNumberOrNull(current[11]),
    buyBoxIsFba: booleanOrNull(stats.buyBoxIsFBA),
    fbaPickAndPackFee: keepaPriceToMoney(fbaFees.pickAndPackFee, domainId),
    referralFeePercentage:
      nonNegativeNumberOrNull(value.referralFeePercentage) ??
      nonNegativeNumberOrNull(value.referralFeePercent),
    searchPosition: context.searchPosition ?? null,
    trackingSince: keepaTimeToIso(value.trackingSince),
    listedSince: keepaTimeToIso(value.listedSince),
    lastUpdate: keepaTimeToIso(value.lastUpdate),
    lastPriceChange: keepaTimeToIso(value.lastPriceChange),
    lastRatingUpdate: keepaTimeToIso(value.lastRatingUpdate),
    lastSoldUpdate: keepaTimeToIso(value.lastSoldUpdate),
  };
}

function normalizeBatchErrors(value: unknown): KeepaMoreBatchError[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const record = isRecord(entry) ? entry : {};
    return {
      asin: stringOrNull(record.asin)?.toUpperCase() || null,
      code: stringOrNull(record.code),
      message: stringOrNull(record.msg) || stringOrNull(record.message) || stringOrNull(record.error),
      errorId: stringOrNull(record.errorId) || stringOrNull(record.error_id),
    };
  });
}

function normalizeProducts(
  values: unknown,
  context: { domainId: number; page?: number },
): NormalizedProducts {
  if (!Array.isArray(values)) {
    return { products: [], errors: [], duplicateCount: 0, warnings: [] };
  }
  const products: KeepaMoreProduct[] = [];
  const errors: KeepaMoreBatchError[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  values.forEach((value, index) => {
    const searchPosition = context.page == null ? null : context.page * 100 + index + 1;
    const product = normalizeProduct(value, { domainId: context.domainId, searchPosition });
    if (!product) {
      errors.push({
        asin: isRecord(value) ? stringOrNull(value.asin)?.toUpperCase() || null : null,
        code: "INVALID_PRODUCT",
        message: `Product at index ${index} has no valid ASIN`,
        errorId: null,
      });
      return;
    }
    if (seen.has(product.asin)) {
      duplicateCount += 1;
      return;
    }
    seen.add(product.asin);
    products.push(product);
  });
  if (duplicateCount > 0) warnings.push(`${duplicateCount} duplicate product record(s) were removed`);
  return { products, errors, duplicateCount, warnings };
}

function retryAfterMilliseconds(value: string | null, nowMilliseconds: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - nowMilliseconds);
}

function retryableResponse(status: number, code: string): boolean {
  if (status === 429) return !NON_RETRYABLE_QUOTA_CODES.has(code);
  return status >= 500 && status <= 599;
}

function errorMessage(status: number, code: string): string {
  if (code === "QUOTA_NO_SUBSCRIPTION") {
    return "KeepaMore account has no active API subscription (QUOTA_NO_SUBSCRIPTION)";
  }
  return `KeepaMore ${code || "HTTP_ERROR"} (HTTP ${status}): Request failed`;
}

function emptyMetadata(): KeepaMoreMetadata {
  return normalizeMetadata(null);
}

function sleepWithTimer(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class KeepaMoreClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleepFn: SleepLike;
  private readonly now: () => number;

  constructor(options: KeepaMoreClientOptions) {
    const apiKey = String(options?.apiKey || "").trim();
    if (!apiKey) throw new TypeError("KeepaMore apiKey is required on the server");
    const fetchFn = options.fetch || globalThis.fetch;
    if (typeof fetchFn !== "function") throw new TypeError("A fetch implementation is required");

    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl || KEEPAMORE_DEFAULT_BASE_URL);
    this.fetchFn = fetchFn.bind(globalThis);
    this.timeoutMs = requireIntegerInRange(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      1,
      180_000,
      "KeepaMore timeoutMs",
    );
    this.maxRetries = requireIntegerInRange(
      options.maxRetries,
      DEFAULT_MAX_RETRIES,
      0,
      5,
      "KeepaMore maxRetries",
    );
    this.retryBaseMs = requireIntegerInRange(
      options.retryBaseMs,
      DEFAULT_RETRY_BASE_MS,
      0,
      60_000,
      "KeepaMore retryBaseMs",
    );
    this.maxRetryDelayMs = requireIntegerInRange(
      options.maxRetryDelayMs,
      DEFAULT_MAX_RETRY_DELAY_MS,
      0,
      300_000,
      "KeepaMore maxRetryDelayMs",
    );
    this.sleepFn = options.sleep || sleepWithTimer;
    this.now = options.now || Date.now;
  }

  private endpoint(path: string): URL {
    return new URL(`${this.baseUrl}/${path.replace(/^\/+/, "")}`);
  }

  private redactDiagnostic(value: string | null): string | null {
    return value?.split(this.apiKey).join("[REDACTED]").slice(0, 500) || null;
  }

  private retryDelay(attempt: number, retryAfterMs: number | null): number {
    const computed = retryAfterMs ?? this.retryBaseMs * 2 ** attempt;
    return Math.min(this.maxRetryDelayMs, Math.max(0, computed));
  }

  private async request(url: URL, init: RequestInit): Promise<ApiEnvelope> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.timeoutMs);

      let response: Response | null = null;
      let body = "";
      try {
        response = await this.fetchFn(url.toString(), {
          ...init,
          headers: {
            accept: "application/json",
            "X-API-Key": this.apiKey,
            ...(init.headers || {}),
          },
          // Fetch otherwise forwards this custom credential header on redirects.
          redirect: "error",
          signal: controller.signal,
        });
        body = await response.text();
      } catch {
        response = null;
      } finally {
        clearTimeout(timer);
      }

      if (!response) {
        const code = timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR";
        if (attempt >= this.maxRetries) {
          throw new KeepaMoreApiError({
            message: timedOut
              ? `KeepaMore request timed out after ${this.timeoutMs}ms`
              : "KeepaMore network request failed",
            code,
            status: 0,
            retryable: true,
          });
        }
        await this.sleepFn(this.retryDelay(attempt, null));
      } else {
        let parsed: unknown = null;
        if (body) {
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = null;
          }
        }
        const record = isRecord(parsed) ? parsed : {};
        const rawCode = keepaCode(record.code);
        const code = /^[A-Z0-9_]{1,64}$/.test(rawCode) && !rawCode.includes(this.apiKey)
          ? rawCode
          : rawCode ? "UPSTREAM_ERROR" : "";
        const message = stringOrNull(record.msg) || stringOrNull(record.message) || "";
        const retryAfterMs = retryAfterMilliseconds(response.headers.get("retry-after"), this.now());
        const success = response.ok && code === "0000";
        if (success) {
          return {
            code,
            msg: message,
            data: record.data,
            metadata: normalizeMetadata(record.metadata),
          };
        }

        if (response.ok && !code) {
          throw new KeepaMoreApiError({
            message: "KeepaMore returned a malformed success envelope",
            code: "INVALID_RESPONSE",
            status: response.status,
          });
        }

        const retryable = retryableResponse(response.status, code);
        if (retryable && attempt < this.maxRetries) {
          await this.sleepFn(this.retryDelay(attempt, retryAfterMs));
        } else {
          throw new KeepaMoreApiError({
            message: errorMessage(response.status, code),
            code: code || "HTTP_ERROR",
            status: response.status,
            errorId: this.redactDiagnostic(stringOrNull(record.errorId) || stringOrNull(record.error_id)),
            retryable,
            retryAfterMs,
          });
        }
      }
    }
    throw new KeepaMoreApiError({
      message: "KeepaMore retry budget was exhausted",
      code: "RETRY_EXHAUSTED",
      status: 0,
      retryable: true,
    });
  }

  async productSearch(options: KeepaMoreProductSearchOptions): Promise<KeepaMoreSearchResult> {
    const term = String(options?.term || "").trim();
    if (!term) throw new TypeError("KeepaMore product search term is required");
    const domainId = requireDomain(options.domain);
    const page = requireIntegerInRange(options.page, 0, 0, 9, "KeepaMore search page");
    const historyDays = optionalPositiveInteger(options.historyDays, "KeepaMore historyDays");
    const update = optionalNonNegativeInteger(options.update, "KeepaMore update");
    const detailLevel = requireDetailLevel(options.detailLevel);
    if (typeof options.stats === "number") {
      optionalPositiveInteger(options.stats, "KeepaMore stats");
    } else if (options.stats !== undefined && !String(options.stats).trim()) {
      throw new TypeError("KeepaMore stats cannot be empty");
    }

    const url = this.endpoint("keepa/productsearch");
    url.searchParams.set("domain", String(domainId));
    url.searchParams.set("term", term);
    url.searchParams.set("page", String(page));
    appendOptionalQuery(url.searchParams, "asinsOnly", options.asinsOnly);
    appendOptionalQuery(url.searchParams, "stats", options.stats);
    appendOptionalQuery(url.searchParams, "history", options.history);
    appendOptionalQuery(url.searchParams, "historyDays", historyDays);
    appendOptionalQuery(url.searchParams, "update", update);
    appendOptionalQuery(url.searchParams, "rating", options.rating);
    url.searchParams.set("detailLevel", detailLevel);

    const envelope = await this.request(url, { method: "GET" });
    const data = isRecord(envelope.data) ? envelope.data : {};
    const normalized = normalizeProducts(data.products, { domainId, page });
    const asinList = Array.isArray(data.asinList)
      ? data.asinList
        .map((entry) => String(entry || "").trim().toUpperCase())
        .filter((entry) => /^[A-Z0-9]{10}$/.test(entry))
      : normalized.products.map((product) => product.asin);
    const asins = [...new Set(asinList)];
    const rawCount = nonNegativeNumberOrNull(data.count);
    const count = rawCount ?? Math.max(asins.length, normalized.products.length);
    const hasNextPage = page < 9 && count >= 100;
    const info = domainInfo(domainId);
    return {
      kind: "product_search",
      query: term,
      page,
      domainId,
      marketplace: info.marketplace,
      currency: info.currency,
      observedAt: new Date(this.now()).toISOString(),
      sourceRef: url.toString(),
      searchSourceRef: url.toString(),
      products: normalized.products,
      asins,
      count,
      nextCursor: hasNextPage ? String(page + 1) : null,
      errors: normalized.errors,
      duplicateCount: normalized.duplicateCount,
      warnings: normalized.warnings,
      metadata: envelope.metadata,
    };
  }

  searchProducts(options: KeepaMoreProductSearchOptions): Promise<KeepaMoreSearchResult> {
    return this.productSearch(options);
  }

  searchCatBeds(
    options: Omit<KeepaMoreProductSearchOptions, "term"> = {},
  ): Promise<KeepaMoreSearchResult> {
    return this.productSearch({ ...options, term: "cat bed" });
  }

  async getProducts(options: KeepaMoreProductOptions): Promise<KeepaMoreProductResult> {
    const asins = normalizeAsins(options?.asins);
    const domainId = requireDomain(options.domain);
    const stats = optionalPositiveInteger(options.stats, "KeepaMore stats");
    const update = optionalNonNegativeInteger(options.update, "KeepaMore update");
    const offers = options.offers === undefined
      ? undefined
      : requireIntegerInRange(options.offers, 0, 0, 100, "KeepaMore offers");
    const days = optionalPositiveInteger(options.days, "KeepaMore days");
    const detailLevel = requireDetailLevel(options.detailLevel);
    const method = options.method || "POST";
    if (method !== "GET" && method !== "POST") {
      throw new TypeError("KeepaMore product method must be GET or POST");
    }
    if (days !== undefined && options.dateRange) {
      throw new TypeError("KeepaMore days and dateRange are mutually exclusive");
    }
    if (options.dateRange) {
      const { start, end } = options.dateRange;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
        throw new TypeError("KeepaMore dateRange requires Unix millisecond start < end");
      }
    }

    const requestUrl = this.endpoint("keepa/product");
    const provenanceUrl = this.endpoint("keepa/product");
    provenanceUrl.searchParams.set("domain", String(domainId));
    provenanceUrl.searchParams.set("asins", asins.join(","));
    appendOptionalQuery(provenanceUrl.searchParams, "stats", stats);
    appendOptionalQuery(provenanceUrl.searchParams, "history", options.history);
    appendOptionalQuery(provenanceUrl.searchParams, "update", update);
    appendOptionalQuery(provenanceUrl.searchParams, "offers", offers);
    appendOptionalQuery(provenanceUrl.searchParams, "rating", options.rating);
    appendOptionalQuery(provenanceUrl.searchParams, "buybox", options.buybox);
    appendOptionalQuery(provenanceUrl.searchParams, "stock", options.stock);
    appendOptionalQuery(provenanceUrl.searchParams, "days", days);
    if (options.dateRange) {
      provenanceUrl.searchParams.set("dateRangeStart", String(options.dateRange.start));
      provenanceUrl.searchParams.set("dateRangeEnd", String(options.dateRange.end));
    }
    provenanceUrl.searchParams.set("detailLevel", detailLevel);

    let init: RequestInit;
    if (method === "GET") {
      requestUrl.search = provenanceUrl.search;
      init = { method: "GET" };
    } else {
      const payload: JsonRecord = { domain: domainId, asins, detailLevel };
      if (stats !== undefined) payload.stats = stats;
      if (options.history !== undefined) payload.history = options.history;
      if (update !== undefined) payload.update = update;
      if (offers !== undefined) payload.offers = offers;
      if (options.rating !== undefined) payload.rating = options.rating;
      if (options.buybox !== undefined) payload.buybox = options.buybox;
      if (options.stock !== undefined) payload.stock = options.stock;
      if (days !== undefined) payload.days = days;
      if (options.dateRange) payload.dateRange = { ...options.dateRange };
      init = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      };
    }

    const envelope = await this.request(requestUrl, init);
    const data = isRecord(envelope.data) ? envelope.data : {};
    const normalized = normalizeProducts(data.products, { domainId });
    const providerErrors = normalizeBatchErrors(data.errors).map((error) => ({
      ...error,
      code: this.redactDiagnostic(error.code),
      message: this.redactDiagnostic(error.message),
      errorId: this.redactDiagnostic(error.errorId),
    }));
    const info = domainInfo(domainId);
    return {
      kind: "product",
      requestedAsins: asins,
      domainId,
      marketplace: info.marketplace,
      currency: info.currency,
      observedAt: new Date(this.now()).toISOString(),
      sourceRef: provenanceUrl.toString(),
      searchSourceRef: null,
      products: normalized.products,
      count: nonNegativeNumberOrNull(data.count) ?? normalized.products.length,
      errors: [...providerErrors, ...normalized.errors],
      duplicateCount: normalized.duplicateCount,
      warnings: normalized.warnings,
      metadata: envelope.metadata,
    };
  }

  product(options: KeepaMoreProductOptions): Promise<KeepaMoreProductResult> {
    return this.getProducts(options);
  }

  async researchCatBeds(
    options: KeepaMoreCatBedResearchOptions = {},
  ): Promise<KeepaMoreCatBedResearchResult> {
    const domainId = requireDomain(options.domain);
    const page = requireIntegerInRange(options.page, 0, 0, 9, "KeepaMore search page");
    const maxProducts = requireIntegerInRange(
      options.maxProducts,
      20,
      1,
      MAX_ASINS_PER_REQUEST,
      "KeepaMore maxProducts",
    );
    const statsDays = requireIntegerInRange(
      options.statsDays,
      90,
      1,
      3_650,
      "KeepaMore statsDays",
    );
    const detailLevel = requireDetailLevel(options.detailLevel);
    const search = await this.searchCatBeds({
      domain: domainId,
      page,
      asinsOnly: true,
      detailLevel: "summary",
    });
    const requestedAsins = search.asins.slice(0, maxProducts);
    if (requestedAsins.length === 0) {
      const info = domainInfo(domainId);
      const enrichment: KeepaMoreProductResult = {
        kind: "product",
        requestedAsins: [],
        domainId,
        marketplace: info.marketplace,
        currency: info.currency,
        observedAt: search.observedAt,
        sourceRef: search.sourceRef,
        searchSourceRef: search.sourceRef,
        products: [],
        count: 0,
        errors: search.errors,
        duplicateCount: search.duplicateCount,
        warnings: [...search.warnings, "The cat bed search returned no ASINs"],
        metadata: emptyMetadata(),
      };
      return {
        query: "cat bed",
        estimatedUnits: 5,
        search,
        enrichment,
        observationBatch: keepaMoreResultToObservationBatch(enrichment, { category: "cat bed" }),
      };
    }

    const detailResult = await this.getProducts({
      asins: requestedAsins,
      domain: domainId,
      stats: statsDays,
      history: false,
      rating: true,
      buybox: true,
      detailLevel,
      method: "POST",
    });
    const positions = new Map(requestedAsins.map((asin, index) => [asin, page * 100 + index + 1]));
    const enrichment: KeepaMoreProductResult = {
      ...detailResult,
      searchSourceRef: search.sourceRef,
      products: detailResult.products.map((product) => ({
        ...product,
        searchPosition: positions.get(product.asin) ?? null,
      })),
      warnings: [...search.warnings, ...detailResult.warnings],
      errors: [...search.errors, ...detailResult.errors],
      duplicateCount: search.duplicateCount + detailResult.duplicateCount,
    };
    return {
      query: "cat bed",
      estimatedUnits: 5 + requestedAsins.length,
      search,
      enrichment,
      observationBatch: keepaMoreResultToObservationBatch(enrichment, { category: "cat bed" }),
    };
  }
}

function observationId(asin: string, metric: string, occurredAt: string): string {
  return [KEEPAMORE_ADAPTER_ID, asin, metric, occurredAt]
    .join(":")
    .replace(/[^A-Za-z0-9:._-]+/g, "-");
}

function errorWarning(error: KeepaMoreBatchError): string {
  const subject = error.asin || "unknown ASIN";
  const code = error.code || "PARTIAL_ERROR";
  const trace = error.errorId ? `; errorId=${error.errorId}` : "";
  return `${subject}: ${code}${trace}`;
}

export function keepaMoreResultToObservationBatch(
  result: KeepaMoreSearchResult | KeepaMoreProductResult,
  options: KeepaMoreObservationBatchOptions = {},
): ResearchObservationBatch {
  const marketplace = options.marketplace || result.marketplace;
  const query = result.kind === "product_search" ? result.query : options.category || "";
  const observations: ResearchObservation[] = [];

  for (const product of result.products) {
    const commonDimensions: Record<string, string | number | boolean | null> = {
      provider: "KeepaMore",
      domain_id: product.domainId,
      currency: product.currency,
      query,
      category: options.category || query || null,
      search_position: product.searchPosition,
    };
    const add = (
      metric: string,
      value: string | number | boolean | null,
      unit: string | null,
      occurredAt: string | null,
      dimensions: Record<string, string | number | boolean | null> = {},
    ) => {
      if (value == null) return;
      const effectiveTime = occurredAt || result.observedAt;
      const sourceRef = metric === "search_result_position" && result.searchSourceRef
        ? result.searchSourceRef
        : result.sourceRef;
      observations.push({
        observation_id: observationId(product.asin, metric, effectiveTime),
        adapter_id: KEEPAMORE_ADAPTER_ID,
        domain: "search_demand",
        evidence_class: "observed_fact",
        metric,
        value,
        unit,
        marketplace,
        channel: "Amazon",
        subject_type: "amazon_asin",
        subject_id: product.asin,
        occurred_at: occurredAt,
        observed_at: result.observedAt,
        source_ref: `${sourceRef}#asin=${product.asin}`,
        source_hash: null,
        dimensions: { ...commonDimensions, ...dimensions },
      });
    };

    add("product_title", product.title, null, product.lastUpdate);
    add("brand", product.brand, null, product.lastUpdate);
    add(
      "current_price",
      product.currentPrice?.amount ?? null,
      product.currency,
      product.lastPriceChange,
      { price_source: product.currentPriceSource },
    );
    add("average_price_30d", product.averagePrice30d?.amount ?? null, product.currency, null);
    add("average_price_90d", product.averagePrice90d?.amount ?? null, product.currency, null);
    add(
      "interval_minimum_price",
      product.intervalMinimumPrice.price?.amount ?? null,
      product.currency,
      product.intervalMinimumPrice.at,
    );
    add(
      "interval_maximum_price",
      product.intervalMaximumPrice.price?.amount ?? null,
      product.currency,
      product.intervalMaximumPrice.at,
    );
    add("rating", product.rating, "stars", product.lastRatingUpdate);
    add("review_count", product.reviewCount, "reviews", product.lastRatingUpdate);
    add("sales_rank", product.salesRank, "rank", product.lastUpdate);
    add(
      "monthly_sold_lower_bound",
      product.monthlySold,
      "units_per_month",
      product.lastSoldUpdate,
      { measurement_semantics: "amazon_displayed_lower_bound" },
    );
    add("offer_count", product.totalOfferCount, "offers", product.lastUpdate);
    add(
      "search_result_position",
      product.searchPosition,
      "position",
      result.observedAt,
      { measurement_semantics: "organic_order_after_ad_removal" },
    );
  }

  const warnings = [
    ...result.warnings,
    ...result.errors.map(errorWarning),
    "KeepaMore listing aggregates do not contain review text and must not be represented as review VOC.",
  ];
  if (result.products.length === 0) warnings.push("No normalized KeepaMore products were available");

  return {
    contract_version: "metis.research-data.v1",
    adapter_id: KEEPAMORE_ADAPTER_ID,
    cursor: result.kind === "product_search" ? result.nextCursor : null,
    complete: result.errors.length === 0,
    observations,
    quality: {
      received: observations.length + result.errors.length,
      accepted: observations.length,
      rejected: result.errors.length,
      duplicate_count: result.duplicateCount,
      warnings: [...new Set(warnings)],
    },
  };
}

export function createKeepaMoreClient(options: KeepaMoreClientOptions): KeepaMoreClient {
  return new KeepaMoreClient(options);
}

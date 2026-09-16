import * as XLSX from "xlsx";

import {
  KEEPAMORE_ADAPTER_ID,
  keepaMoreResultToObservationBatch,
  type KeepaMoreBatchError,
  type KeepaMoreMoney,
  type KeepaMoreProduct,
  type KeepaMoreProductSearchObservation,
  type KeepaMoreProductResult,
} from "./keepamore";
import type { ResearchObservationBatch } from "./research-data-adapters";
import {
  validateXlsxArchive,
  XlsxArchiveValidationError,
} from "./xlsx-archive";

const AMAZON_US = "Amazon US";
const USD = "USD";
const CAT_BED = "cat bed";
const HEADER_SCAN_ROWS = 20;
const USD_MINOR_UNIT_SCALE = 100;

export const DEFAULT_KEEPAMORE_EXPORT_LIMITS = Object.freeze({
  maxFileBytes: 5_000_000,
  maxRows: 10_000,
  maxColumns: 100,
  maxSheets: 10,
  maxCellCharacters: 10_000,
  maxUrlCharacters: 2_048,
  maxQueryCharacters: 160,
  maxSourceQueries: 50,
  maxSearchObservations: 100,
  maxSearchPosition: 100_000,
});

export type KeepaMoreExportLimits = {
  maxFileBytes: number;
  maxRows: number;
  maxColumns: number;
  maxSheets: number;
  maxCellCharacters: number;
  maxUrlCharacters: number;
  maxQueryCharacters: number;
  maxSourceQueries: number;
  maxSearchObservations: number;
  maxSearchPosition: number;
};

export type KeepaMoreExportImportOptions = {
  filename: string;
  marketplace: string;
  currency: string;
  category: string;
  observedAt?: string;
  now?: () => Date;
  limits?: Partial<KeepaMoreExportLimits>;
};

export type KeepaMoreExportImportErrorCode =
  | "INVALID_METADATA"
  | "INVALID_FILENAME"
  | "UNSUPPORTED_FILE_TYPE"
  | "EMPTY_FILE"
  | "FILE_SIZE_LIMIT"
  | "INVALID_CSV_ENCODING"
  | "INVALID_CSV"
  | "INVALID_WORKBOOK"
  | "SHEET_LIMIT"
  | "ROW_LIMIT"
  | "COLUMN_LIMIT"
  | "NO_IMPORT_TABLE"
  | "AMBIGUOUS_COLUMNS"
  | "FORMULA_NOT_ALLOWED"
  | "CELL_SIZE_LIMIT";

export class KeepaMoreExportImportError extends Error {
  constructor(
    readonly code: KeepaMoreExportImportErrorCode,
    message: string,
    readonly row: number | null = null,
    readonly column: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "KeepaMoreExportImportError";
  }
}

export type KeepaMoreExportRowIssueCode =
  | "MISSING_ASIN"
  | "INVALID_ASIN"
  | "DUPLICATE_ASIN"
  | "INVALID_TEXT"
  | "INVALID_NUMBER"
  | "INVALID_URL"
  | "INVALID_PROVENANCE"
  | "METADATA_MISMATCH";

export type KeepaMoreExportRowIssue = {
  row: number;
  asin: string | null;
  field: string;
  code: KeepaMoreExportRowIssueCode;
  message: string;
};

export type KeepaMoreExportImportResult = {
  kind: "keepamore_export";
  adapterId: typeof KEEPAMORE_ADAPTER_ID;
  filename: string;
  sheetName: string;
  headerRow: number;
  marketplace: typeof AMAZON_US;
  currency: typeof USD;
  category: typeof CAT_BED;
  domainId: 1;
  observedAt: string;
  sourceRef: string;
  sourceHash: string;
  columnMap: Record<string, string>;
  products: KeepaMoreProduct[];
  rowIssues: KeepaMoreExportRowIssue[];
  duplicateCount: number;
  warnings: string[];
  rowQuality: {
    received: number;
    accepted: number;
    rejected: number;
    ignoredBlank: number;
  };
  observationBatch: ResearchObservationBatch;
};

type ImportField =
  | "asin"
  | "title"
  | "brand"
  | "manufacturer"
  | "model"
  | "color"
  | "size"
  | "parentAsin"
  | "currentPrice"
  | "averagePrice30d"
  | "averagePrice90d"
  | "salesRank"
  | "salesRankDrops30d"
  | "rating"
  | "reviewCount"
  | "monthlySold"
  | "totalOfferCount"
  | "buyBoxIsFba"
  | "searchPosition"
  | "sourceQueries"
  | "searchObservations"
  | "imageUrls"
  | "marketplace"
  | "currency"
  | "category";

type TableCandidate = {
  sheetName: string;
  sheet: XLSX.WorkSheet;
  range: XLSX.Range;
  headerIndex: number;
  headerMap: Map<ImportField, number>;
  originalHeaders: Map<ImportField, string>;
};

type ParsedRow = {
  product: KeepaMoreProduct;
  sourceRow: number;
};

const COLUMN_ALIASES: Record<ImportField, string[]> = {
  asin: ["asin", "amazon asin", "product asin", "item asin", "商品asin", "亚马逊asin", "商品编码"],
  title: ["title", "product title", "product name", "listing title", "商品标题", "商品名称", "标题", "产品标题", "产品名称"],
  brand: ["brand", "brand name", "品牌", "品牌名称"],
  manufacturer: ["manufacturer", "制造商", "生产商"],
  model: ["model", "model number", "型号", "款号"],
  color: ["color", "colour", "颜色"],
  size: ["size", "尺寸", "规格"],
  parentAsin: ["parent asin", "parentasin", "父asin", "父体asin"],
  currentPrice: [
    "current price", "current price usd", "price", "price usd", "buy box price",
    "buybox price", "new price", "当前价格", "现价", "售价", "价格", "购物车价格",
  ],
  averagePrice30d: ["average price 30d", "avg price 30d", "30 day average price", "30天均价", "近30天均价"],
  averagePrice90d: ["average price 90d", "avg price 90d", "90 day average price", "90天均价", "近90天均价"],
  salesRank: [
    "bsr", "current bsr", "sales rank", "salesrank", "best sellers rank", "best seller rank",
    "畅销排名", "销售排名", "当前bsr", "类目排名",
  ],
  salesRankDrops30d: ["sales rank drops 30d", "bsr drops 30d", "30 day bsr drops", "30天排名跌次", "30天bsr跌次"],
  rating: ["rating", "star rating", "review rating", "average rating", "评分", "星级", "平均评分"],
  reviewCount: [
    "review count", "reviews", "reviews count", "rating count", "ratings count",
    "评论数", "评论数量", "评价数", "评分数量", "review数量",
  ],
  monthlySold: [
    "monthly sold", "monthly sales", "month sold", "bought past month", "bought in past month",
    "月销量", "月售", "月销售量", "过去一个月购买量", "近30天销量",
  ],
  totalOfferCount: ["offer count", "offers", "total offer count", "卖家数", "报价数", "offer数量"],
  buyBoxIsFba: ["buy box is fba", "buybox is fba", "fba buy box", "购物车是否fba"],
  searchPosition: ["search position", "position", "organic position", "搜索位置", "自然排名", "搜索排名"],
  sourceQueries: [
    "source queries", "source query", "source keywords", "source search terms",
    "来源关键词", "来源搜索词", "检索来源词",
  ],
  searchObservations: [
    "search observations", "search observation", "query observations", "search provenance",
    "搜索观测", "搜索观察", "搜索来源记录",
  ],
  imageUrls: [
    "image url", "image urls", "image", "images", "main image", "main image url",
    "图片链接", "图片url", "主图", "主图链接", "主图url", "图片地址",
  ],
  marketplace: ["marketplace", "amazon marketplace", "site", "站点", "市场", "亚马逊站点"],
  currency: ["currency", "currency code", "币种", "货币", "货币代码"],
  category: ["category", "keyword", "search term", "query", "类目", "关键词", "搜索词"],
};

const FIELD_LABELS: Record<ImportField, string> = {
  asin: "ASIN",
  title: "title",
  brand: "brand",
  manufacturer: "manufacturer",
  model: "model",
  color: "color",
  size: "size",
  parentAsin: "parent ASIN",
  currentPrice: "current price",
  averagePrice30d: "30-day average price",
  averagePrice90d: "90-day average price",
  salesRank: "BSR",
  salesRankDrops30d: "30-day BSR drops",
  rating: "rating",
  reviewCount: "review count",
  monthlySold: "monthly sold",
  totalOfferCount: "offer count",
  buyBoxIsFba: "FBA Buy Box",
  searchPosition: "search position",
  sourceQueries: "source queries",
  searchObservations: "search observations",
  imageUrls: "image URL",
  marketplace: "marketplace",
  currency: "currency",
  category: "category",
};

const MISSING_MARKERS = new Set([
  "", "-", "--", "n/a", "na", "null", "none", "unknown", "#n/a", "暂无", "无", "未知",
]);

function reject(
  code: KeepaMoreExportImportErrorCode,
  message: string,
  row: number | null = null,
  column: number | null = null,
  options?: ErrorOptions,
): never {
  throw new KeepaMoreExportImportError(code, message, row, column, options);
}

function checkedLimits(overrides: Partial<KeepaMoreExportLimits> = {}): KeepaMoreExportLimits {
  const limits = { ...DEFAULT_KEEPAMORE_EXPORT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  return limits;
}

function bytesFrom(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("KeepaMore export input must be an ArrayBuffer or Uint8Array");
}

function safeFilename(value: string): { basename: string; extension: ".csv" | ".xlsx" } {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    reject("INVALID_FILENAME", "A non-empty filename is required");
  }
  const basename = value.trim().split(/[\\/]/).pop() || "";
  if (!basename || basename.length > 255) {
    reject("INVALID_FILENAME", "The export filename is invalid or too long");
  }
  const match = basename.toLowerCase().match(/(\.csv|\.xlsx)$/);
  if (!match) reject("UNSUPPORTED_FILE_TYPE", "Only .csv and .xlsx KeepaMore exports are supported");
  return { basename, extension: match[1] as ".csv" | ".xlsx" };
}

function canonicalMarketplace(value: unknown): typeof AMAZON_US | null {
  const normalized = String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  if (["amazon us", "amazon.com", "us", "usa", "美国站", "亚马逊美国站"].includes(normalized)) {
    return AMAZON_US;
  }
  return null;
}

function canonicalCurrency(value: unknown): typeof USD | null {
  const normalized = String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  if (["usd", "us$", "$", "us dollar", "us dollars", "美元"].includes(normalized)) return USD;
  return null;
}

function canonicalCategory(value: unknown): typeof CAT_BED | null {
  const normalized = String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (["cat bed", "cat beds", "猫窝", "猫床"].includes(normalized)) return CAT_BED;
  return null;
}

function normalizeObservedAt(value: string | undefined, now: () => Date): { observedAt: string; inferred: boolean } {
  if (value == null || !value.trim()) {
    const date = now();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new TypeError("now() must return a valid Date");
    }
    return { observedAt: date.toISOString(), inferred: true };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    reject("INVALID_METADATA", "observedAt must be an ISO 8601 timestamp with a timezone");
  }
  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) reject("INVALID_METADATA", "observedAt is not a valid timestamp");
  return { observedAt: date.toISOString(), inferred: false };
}

function validateMetadata(options: KeepaMoreExportImportOptions): {
  marketplace: typeof AMAZON_US;
  currency: typeof USD;
  category: typeof CAT_BED;
  observedAt: string;
  observedAtInferred: boolean;
} {
  const marketplace = canonicalMarketplace(options.marketplace);
  const currency = canonicalCurrency(options.currency);
  const category = canonicalCategory(options.category);
  if (!marketplace || !currency || !category) {
    reject(
      "INVALID_METADATA",
      "This importer only accepts explicit Amazon US / USD / cat bed metadata",
    );
  }
  const observed = normalizeObservedAt(options.observedAt, options.now || (() => new Date()));
  return {
    marketplace,
    currency,
    category,
    observedAt: observed.observedAt,
    observedAtInferred: observed.inferred,
  };
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\b(?:usd|us dollars?)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const ALIAS_TO_FIELD = (() => {
  const result = new Map<string, ImportField>();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as Array<[ImportField, string[]]>) {
    for (const alias of aliases) {
      const key = normalizeHeader(alias);
      const prior = result.get(key);
      if (prior && prior !== field) throw new Error(`Duplicate KeepaMore import alias: ${alias}`);
      result.set(key, field);
    }
  }
  return result;
})();

function headerMap(values: unknown[], rowNumber: number): {
  map: Map<ImportField, number>;
  originals: Map<ImportField, string>;
} {
  const map = new Map<ImportField, number>();
  const originals = new Map<ImportField, string>();
  for (let index = 0; index < values.length; index += 1) {
    const original = String(values[index] ?? "").trim();
    if (!original) continue;
    const field = ALIAS_TO_FIELD.get(normalizeHeader(original));
    if (!field) continue;
    if (map.has(field)) {
      reject(
        "AMBIGUOUS_COLUMNS",
        `Row ${rowNumber} contains multiple columns mapped to ${FIELD_LABELS[field]}`,
        rowNumber,
        index + 1,
      );
    }
    map.set(field, index);
    originals.set(field, original);
  }
  return { map, originals };
}

function sheetValue(sheet: XLSX.WorkSheet, row: number, column: number): unknown {
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
  return cell?.v ?? null;
}

function readRow(sheet: XLSX.WorkSheet, row: number, range: XLSX.Range): unknown[] {
  const values: unknown[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    values.push(sheetValue(sheet, row, column));
  }
  return values;
}

function formulaLike(value: string): boolean {
  const normalized = value.trimStart().replace(/^['\u2019]/, "");
  return /^[=+@]/.test(normalized) ||
    /^-\s*(?:[A-Za-z_"'@=(])/.test(normalized) ||
    /^-\d+(?:\.\d+)?\s*[+*/^-]/.test(normalized);
}

function unsafeControlCharacters(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function assertSafeTableCells(candidate: TableCandidate, limits: KeepaMoreExportLimits): void {
  const { sheet, range } = candidate;
  for (let row = candidate.headerIndex; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as
        (XLSX.CellObject & { F?: string }) | undefined;
      if (!cell) continue;
      if (typeof cell.f === "string" || typeof cell.F === "string") {
        reject(
          "FORMULA_NOT_ALLOWED",
          `Spreadsheet formulas are not accepted (row ${row + 1}, column ${column + 1})`,
          row + 1,
          column + 1,
        );
      }
      if (typeof cell.v !== "string") continue;
      if (cell.v.length > limits.maxCellCharacters) {
        reject(
          "CELL_SIZE_LIMIT",
          `Cell text exceeds ${limits.maxCellCharacters} characters`,
          row + 1,
          column + 1,
        );
      }
      if (formulaLike(cell.v)) {
        reject(
          "FORMULA_NOT_ALLOWED",
          `Formula-like text is not accepted (row ${row + 1}, column ${column + 1})`,
          row + 1,
          column + 1,
        );
      }
      if (unsafeControlCharacters(cell.v)) {
        reject(
          "CELL_SIZE_LIMIT",
          `Cell text contains unsupported control characters`,
          row + 1,
          column + 1,
        );
      }
    }
  }
}

function findImportTable(workbook: XLSX.WorkBook, limits: KeepaMoreExportLimits): TableCandidate {
  if (workbook.SheetNames.length < 1) reject("NO_IMPORT_TABLE", "The workbook contains no worksheets");
  if (workbook.SheetNames.length > limits.maxSheets) {
    reject("SHEET_LIMIT", `The workbook exceeds the ${limits.maxSheets}-sheet limit`);
  }

  let best: TableCandidate | null = null;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) continue;
    let range: XLSX.Range;
    try {
      range = XLSX.utils.decode_range(sheet["!ref"]);
    } catch (error) {
      reject("INVALID_WORKBOOK", `Worksheet ${sheetName} has an invalid range`, null, null, { cause: error });
    }
    const columnCount = range.e.c - range.s.c + 1;
    const rowCount = range.e.r - range.s.r + 1;
    if (columnCount > limits.maxColumns) {
      reject("COLUMN_LIMIT", `Worksheet ${sheetName} exceeds the ${limits.maxColumns}-column limit`);
    }
    if (rowCount > limits.maxRows + HEADER_SCAN_ROWS) {
      reject("ROW_LIMIT", `Worksheet ${sheetName} exceeds the ${limits.maxRows}-row import limit`);
    }

    const lastHeaderRow = Math.min(range.e.r, range.s.r + HEADER_SCAN_ROWS - 1);
    for (let row = range.s.r; row <= lastHeaderRow; row += 1) {
      const values = readRow(sheet, row, range);
      const mapped = headerMap(values, row + 1);
      if (!mapped.map.has("asin")) continue;
      const candidate: TableCandidate = {
        sheetName,
        sheet,
        range,
        headerIndex: row,
        headerMap: mapped.map,
        originalHeaders: mapped.originals,
      };
      if (!best || candidate.headerMap.size > best.headerMap.size) best = candidate;
    }
  }

  if (!best) reject("NO_IMPORT_TABLE", "No table with a recognized ASIN column was found");
  if (best.range.e.r - best.headerIndex > limits.maxRows) {
    reject("ROW_LIMIT", `The import table exceeds the ${limits.maxRows}-row limit`);
  }
  assertSafeTableCells(best, limits);
  return best;
}

function parseCsvRows(textValue: string, limits: KeepaMoreExportLimits): string[][] {
  const text = textValue.replace(/^\ufeff/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  const pushField = () => {
    if (field.length > limits.maxCellCharacters) {
      reject("CELL_SIZE_LIMIT", `CSV cell exceeds ${limits.maxCellCharacters} characters`, rows.length + 1, row.length + 1);
    }
    row.push(field);
    field = "";
    afterQuote = false;
    if (row.length > limits.maxColumns) {
      reject("COLUMN_LIMIT", `CSV exceeds the ${limits.maxColumns}-column limit`, rows.length + 1, row.length);
    }
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    if (rows.length > limits.maxRows + HEADER_SCAN_ROWS) {
      reject("ROW_LIMIT", `CSV exceeds the ${limits.maxRows}-row import limit`);
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") {
        pushField();
        continue;
      }
      if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        pushRow();
        continue;
      }
      reject(
        "INVALID_CSV",
        `Unexpected character after a quoted CSV field at row ${rows.length + 1}, column ${row.length + 1}`,
        rows.length + 1,
        row.length + 1,
      );
    }

    if (character === '"') {
      if (field.length !== 0) {
        reject(
          "INVALID_CSV",
          `Unescaped quote at row ${rows.length + 1}, column ${row.length + 1}`,
          rows.length + 1,
          row.length + 1,
        );
      }
      inQuotes = true;
    } else if (character === ",") {
      pushField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      field += character;
      if (field.length > limits.maxCellCharacters) {
        reject("CELL_SIZE_LIMIT", `CSV cell exceeds ${limits.maxCellCharacters} characters`, rows.length + 1, row.length + 1);
      }
    }
  }

  if (inQuotes) {
    reject("INVALID_CSV", `Unterminated quoted CSV field at row ${rows.length + 1}`, rows.length + 1, row.length + 1);
  }
  if (field || row.length || !rows.length) pushRow();
  while (rows.length && rows[rows.length - 1].every((value) => value === "")) rows.pop();
  if (!rows.length) reject("EMPTY_FILE", "The CSV export is empty");
  return rows;
}

function parseWorkbook(
  bytes: Uint8Array,
  extension: ".csv" | ".xlsx",
  limits: KeepaMoreExportLimits,
): XLSX.WorkBook {
  if (extension === ".xlsx") {
    try {
      validateXlsxArchive(bytes);
    } catch (error) {
      if (error instanceof XlsxArchiveValidationError) {
        reject("INVALID_WORKBOOK", `Unsafe or invalid XLSX archive: ${error.code}`, null, null, { cause: error });
      }
      throw error;
    }
    try {
      return XLSX.read(bytes, {
        type: "array",
        cellDates: false,
        cellFormula: true,
        cellHTML: false,
        cellText: false,
      });
    } catch (error) {
      reject("INVALID_WORKBOOK", "The XLSX workbook could not be parsed", null, null, { cause: error });
    }
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    reject("INVALID_CSV_ENCODING", "CSV exports must use valid UTF-8 encoding", null, null, { cause: error });
  }
  if (!text.trim()) reject("EMPTY_FILE", "The CSV export is empty");
  try {
    const sheet = XLSX.utils.aoa_to_sheet(parseCsvRows(text, limits));
    return { SheetNames: ["CSV"], Sheets: { CSV: sheet } };
  } catch (error) {
    if (error instanceof KeepaMoreExportImportError) throw error;
    reject("INVALID_WORKBOOK", "The CSV export could not be parsed", null, null, { cause: error });
  }
}

function isMissing(value: unknown): boolean {
  return value == null || (typeof value === "string" && MISSING_MARKERS.has(value.trim().toLowerCase()));
}

function cleanText(value: unknown): string | null {
  if (isMissing(value)) return null;
  if (!["string", "number", "boolean"].includes(typeof value)) return null;
  const text = String(value).normalize("NFKC").trim().replace(/\s+/g, " ");
  return text || null;
}

function issue(
  row: number,
  asin: string | null,
  field: ImportField,
  code: KeepaMoreExportRowIssueCode,
  message: string,
): KeepaMoreExportRowIssue {
  return { row, asin, field, code, message };
}

function decimalFrom(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  const match = normalized.match(/^(?:(?:US\$|USD|\$)\s*)?((?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?)(?:\s*(?:USD|US\$))?$/i);
  if (!match) return null;
  const numeric = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function moneyFrom(value: unknown): KeepaMoreMoney | null | undefined {
  if (isMissing(value)) return null;
  const amount = decimalFrom(value);
  const minorUnits = amount == null ? null : Math.round(amount * USD_MINOR_UNIT_SCALE);
  if (
    amount == null || minorUnits == null || amount <= 0 || amount > 10_000_000 ||
    Math.abs(minorUnits / USD_MINOR_UNIT_SCALE - amount) > 1e-9
  ) {
    return undefined;
  }
  return {
    amount,
    minorUnits,
    currency: USD,
    minorUnitScale: USD_MINOR_UNIT_SCALE,
  };
}

function countFrom(value: unknown, allowZero = true): number | null | undefined {
  if (isMissing(value)) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) return undefined;
    return value;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  const compact = normalized
    .replace(/^#\s*/, "")
    .replace(/(?:bought\s+in\s+past\s+month|bought\s+past\s+month|monthly\s+sold|过去一个月购买量|月售)$/i, "")
    .trim();
  const match = compact.match(/^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([kmb])?\s*\+?$/i);
  if (!match) return undefined;
  const scale = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : match[2] === "b" ? 1_000_000_000 : 1;
  const result = Number(match[1].replace(/,/g, "")) * scale;
  if (!Number.isSafeInteger(result) || result < (allowZero ? 0 : 1)) return undefined;
  return result;
}

function ratingFrom(value: unknown): number | null | undefined {
  if (isMissing(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  const match = normalized.match(/^(\d(?:\.\d{1,2})?)\s*(?:(?:out\s+of|\/)\s*5|stars?|星|分)?$/i);
  if (!match) return undefined;
  const result = Number(match[1]);
  return Number.isFinite(result) && result >= 0 && result <= 5 ? result : undefined;
}

function booleanFrom(value: unknown): boolean | null | undefined {
  if (isMissing(value)) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
  const normalized = String(value).normalize("NFKC").trim().toLowerCase();
  if (["true", "yes", "y", "1", "是"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "否"].includes(normalized)) return false;
  return undefined;
}

function imageUrlsFrom(value: unknown, limits: KeepaMoreExportLimits): string[] | null | undefined {
  if (isMissing(value)) return [];
  if (typeof value !== "string") return undefined;
  const candidates = value.split(/[\n;|]+/).map((item) => item.trim()).filter(Boolean);
  if (!candidates.length) return [];
  const unique = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.length > limits.maxUrlCharacters) return undefined;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return undefined;
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return undefined;
    unique.add(url.toString());
  }
  return [...unique];
}

type OptionalProvenanceResult<T> =
  | { ok: true; value: T | undefined }
  | { ok: false; message: string };

const CAT_QUERY_SIGNAL = /(?:\b(?:cat|cats|kitten|kittens|kitty|kitties|feline)\b|猫)/iu;
const BED_QUERY_SIGNAL = /(?:\b(?:bed|beds|cave|caves|couch|couches|sofa|sofas|mat|mats|pad|pads|basket|baskets|hammock|hammocks|perch|perches|house|houses|condo|condos|nest|nests|lounger|loungers)\b|窝|床|垫|篮|吊床|栖|屋)/iu;
const MIN_SEARCH_OBSERVED_AT = Date.UTC(2000, 0, 1);
const MAX_OBSERVED_AT_CLOCK_SKEW_MS = 5 * 60_000;

function queryIdentity(query: string): string {
  return query.toLocaleLowerCase("en-US");
}

function normalizeSourceQuery(
  value: unknown,
  limits: KeepaMoreExportLimits,
): OptionalProvenanceResult<string> {
  if (typeof value !== "string") return { ok: false, message: "Source query must be text" };
  const query = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!query) return { ok: false, message: "Source query must not be empty" };
  if (query.length > limits.maxQueryCharacters) {
    return { ok: false, message: `Source query exceeds ${limits.maxQueryCharacters} characters` };
  }
  if (
    unsafeControlCharacters(query) || formulaLike(query) ||
    /(?:https?:\/\/|www\.)/i.test(query) || /[<>{}\[\]\\`]/u.test(query) ||
    !/^[\p{L}\p{N}][\p{L}\p{N}\s&'’(),.+\/-]*$/u.test(query)
  ) {
    return { ok: false, message: "Source query contains unsafe or unsupported characters" };
  }
  if (query.split(/\s+/).length > 24) {
    return { ok: false, message: "Source query contains too many terms" };
  }
  if (!CAT_QUERY_SIGNAL.test(query) || !BED_QUERY_SIGNAL.test(query)) {
    return { ok: false, message: "Source query is outside the cat bed research scope" };
  }
  return { ok: true, value: query };
}

function sourceQueriesFrom(
  value: unknown,
  limits: KeepaMoreExportLimits,
): OptionalProvenanceResult<string[]> {
  if (isMissing(value)) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false, message: "Source Queries must be text" };
  const text = value.trim();
  let entries: unknown[];
  if (text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, message: "Source Queries JSON is invalid" };
    }
    if (!Array.isArray(parsed)) return { ok: false, message: "Source Queries JSON must be an array" };
    entries = parsed;
  } else {
    entries = text.split(/\s*\|\|\s*|[\r\n;]+/).filter((entry) => entry.trim());
  }
  if (!entries.length) return { ok: false, message: "Source Queries must contain at least one query" };
  if (entries.length > limits.maxSourceQueries) {
    return { ok: false, message: `Source Queries exceeds the ${limits.maxSourceQueries}-query limit` };
  }
  const queries: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeSourceQuery(entry, limits);
    if (!normalized.ok || !normalized.value) return normalized as OptionalProvenanceResult<string[]>;
    const key = queryIdentity(normalized.value);
    if (seen.has(key)) return { ok: false, message: `Source Queries contains duplicate query: ${normalized.value}` };
    seen.add(key);
    queries.push(normalized.value);
  }
  return { ok: true, value: queries };
}

function searchPositionFrom(value: unknown, maximum: number): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && /^[1-9]\d*$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric >= 1 && numeric <= maximum ? numeric : null;
}

function searchObservedAtFrom(value: unknown, maximumObservedAtMs: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    return null;
  }
  const milliseconds = Date.parse(text);
  if (
    !Number.isFinite(milliseconds) || milliseconds < MIN_SEARCH_OBSERVED_AT ||
    milliseconds > maximumObservedAtMs + MAX_OBSERVED_AT_CLOCK_SKEW_MS
  ) {
    return null;
  }
  return new Date(milliseconds).toISOString();
}

function observationRecordFrom(
  value: unknown,
  limits: KeepaMoreExportLimits,
  maximumObservedAtMs: number,
): OptionalProvenanceResult<KeepaMoreProductSearchObservation> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Each Search Observations entry must be an object" };
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["query", "position", "searchPosition", "search_position", "observedAt", "observed_at"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    return { ok: false, message: "Search Observations contains unsupported properties" };
  }
  const positionValues = [record.position, record.searchPosition, record.search_position]
    .filter((entry) => entry !== undefined);
  const observedAtValues = [record.observedAt, record.observed_at]
    .filter((entry) => entry !== undefined);
  if (positionValues.length !== 1 || observedAtValues.length !== 1) {
    return { ok: false, message: "Each Search Observations entry requires one position and one observedAt value" };
  }
  const query = normalizeSourceQuery(record.query, limits);
  if (!query.ok || !query.value) return query as OptionalProvenanceResult<KeepaMoreProductSearchObservation>;
  const position = searchPositionFrom(positionValues[0], limits.maxSearchPosition);
  if (position == null) {
    return { ok: false, message: `Search observation position must be an integer from 1 through ${limits.maxSearchPosition}` };
  }
  const observedAt = searchObservedAtFrom(observedAtValues[0], maximumObservedAtMs);
  if (!observedAt) {
    return { ok: false, message: "Search observation observedAt must be a valid, non-future ISO timestamp with a timezone" };
  }
  return { ok: true, value: { query: query.value, position, observedAt } };
}

function searchObservationsFrom(
  value: unknown,
  limits: KeepaMoreExportLimits,
  maximumObservedAtMs: number,
): OptionalProvenanceResult<KeepaMoreProductSearchObservation[]> {
  if (isMissing(value)) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false, message: "Search Observations must be text" };
  const text = value.trim();
  let entries: unknown[];
  if (text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, message: "Search Observations JSON is invalid" };
    }
    if (!Array.isArray(parsed)) return { ok: false, message: "Search Observations JSON must be an array" };
    entries = parsed;
  } else {
    entries = text.split(/\s*\|\|\s*|[\r\n]+/).filter((entry) => entry.trim()).map((entry) => {
      const parts = entry.split(/\s*::\s*/);
      return parts.length === 3
        ? { query: parts[0], position: parts[1], observedAt: parts[2] }
        : null;
    });
  }
  if (!entries.length) return { ok: false, message: "Search Observations must contain at least one observation" };
  if (entries.length > limits.maxSearchObservations) {
    return { ok: false, message: `Search Observations exceeds the ${limits.maxSearchObservations}-observation limit` };
  }
  const observations: KeepaMoreProductSearchObservation[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = observationRecordFrom(entry, limits, maximumObservedAtMs);
    if (!normalized.ok || !normalized.value) {
      return normalized as OptionalProvenanceResult<KeepaMoreProductSearchObservation[]>;
    }
    const key = `${queryIdentity(normalized.value.query)}|${normalized.value.position}|${normalized.value.observedAt}`;
    if (seen.has(key)) return { ok: false, message: "Search Observations contains a duplicate observation" };
    seen.add(key);
    observations.push(normalized.value);
  }
  return { ok: true, value: observations };
}

function rowIsBlank(values: unknown[]): boolean {
  return values.every((value) => isMissing(value));
}

function rowValue(values: unknown[], headerMap: Map<ImportField, number>, field: ImportField): unknown {
  const index = headerMap.get(field);
  return index == null ? null : values[index];
}

function parseProductRow(
  values: unknown[],
  sourceRow: number,
  headers: Map<ImportField, number>,
  limits: KeepaMoreExportLimits,
  importObservedAt: string,
): { parsed?: ParsedRow; issue?: KeepaMoreExportRowIssue } {
  const rawAsin = cleanText(rowValue(values, headers, "asin"));
  if (!rawAsin) return { issue: issue(sourceRow, null, "asin", "MISSING_ASIN", "ASIN is required") };
  const asin = rawAsin.toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    return { issue: issue(sourceRow, rawAsin, "asin", "INVALID_ASIN", "ASIN must contain exactly 10 letters or digits") };
  }

  const rowMarketplace = rowValue(values, headers, "marketplace");
  if (!isMissing(rowMarketplace) && canonicalMarketplace(rowMarketplace) !== AMAZON_US) {
    return { issue: issue(sourceRow, asin, "marketplace", "METADATA_MISMATCH", "Row marketplace is not Amazon US") };
  }
  const rowCurrency = rowValue(values, headers, "currency");
  if (!isMissing(rowCurrency) && canonicalCurrency(rowCurrency) !== USD) {
    return { issue: issue(sourceRow, asin, "currency", "METADATA_MISMATCH", "Row currency is not USD") };
  }
  const rowCategory = rowValue(values, headers, "category");
  if (!isMissing(rowCategory) && canonicalCategory(rowCategory) !== CAT_BED) {
    return { issue: issue(sourceRow, asin, "category", "METADATA_MISMATCH", "Row category is not cat bed") };
  }

  const parentAsinValue = cleanText(rowValue(values, headers, "parentAsin"));
  const parentAsin = parentAsinValue?.toUpperCase() || null;
  if (parentAsin && !/^[A-Z0-9]{10}$/.test(parentAsin)) {
    return { issue: issue(sourceRow, asin, "parentAsin", "INVALID_ASIN", "Parent ASIN must contain exactly 10 letters or digits") };
  }

  const currentPrice = moneyFrom(rowValue(values, headers, "currentPrice"));
  if (currentPrice === undefined) {
    return { issue: issue(sourceRow, asin, "currentPrice", "INVALID_NUMBER", "Current price must be a positive USD amount with at most two decimals") };
  }
  const averagePrice30d = moneyFrom(rowValue(values, headers, "averagePrice30d"));
  if (averagePrice30d === undefined) {
    return { issue: issue(sourceRow, asin, "averagePrice30d", "INVALID_NUMBER", "30-day average price is invalid") };
  }
  const averagePrice90d = moneyFrom(rowValue(values, headers, "averagePrice90d"));
  if (averagePrice90d === undefined) {
    return { issue: issue(sourceRow, asin, "averagePrice90d", "INVALID_NUMBER", "90-day average price is invalid") };
  }

  const countFields: Array<[ImportField, boolean]> = [
    ["salesRank", false],
    ["salesRankDrops30d", true],
    ["reviewCount", true],
    ["monthlySold", true],
    ["totalOfferCount", true],
    ["searchPosition", false],
  ];
  const counts = new Map<ImportField, number | null>();
  for (const [field, allowZero] of countFields) {
    const parsed = countFrom(rowValue(values, headers, field), allowZero);
    if (parsed === undefined) {
      return { issue: issue(sourceRow, asin, field, "INVALID_NUMBER", `${FIELD_LABELS[field]} must be a non-negative integer or a supported K/M abbreviation`) };
    }
    counts.set(field, parsed);
  }

  const rating = ratingFrom(rowValue(values, headers, "rating"));
  if (rating === undefined) {
    return { issue: issue(sourceRow, asin, "rating", "INVALID_NUMBER", "Rating must be between 0 and 5") };
  }
  const buyBoxIsFba = booleanFrom(rowValue(values, headers, "buyBoxIsFba"));
  if (buyBoxIsFba === undefined) {
    return { issue: issue(sourceRow, asin, "buyBoxIsFba", "INVALID_TEXT", "FBA Buy Box must be yes/no, true/false, or 1/0") };
  }
  const imageUrls = imageUrlsFrom(rowValue(values, headers, "imageUrls"), limits);
  if (imageUrls === undefined) {
    return { issue: issue(sourceRow, asin, "imageUrls", "INVALID_URL", "Image URLs must be absolute HTTPS URLs without credentials") };
  }

  const sourceQueriesResult = sourceQueriesFrom(rowValue(values, headers, "sourceQueries"), limits);
  if (!sourceQueriesResult.ok) {
    return { issue: issue(sourceRow, asin, "sourceQueries", "INVALID_PROVENANCE", sourceQueriesResult.message) };
  }
  const maximumObservedAtMs = Date.parse(importObservedAt);
  const searchObservationsResult = searchObservationsFrom(
    rowValue(values, headers, "searchObservations"),
    limits,
    maximumObservedAtMs,
  );
  if (!searchObservationsResult.ok) {
    return { issue: issue(sourceRow, asin, "searchObservations", "INVALID_PROVENANCE", searchObservationsResult.message) };
  }
  let sourceQueries = sourceQueriesResult.value;
  const searchObservations = searchObservationsResult.value;
  if (searchObservations?.length) {
    const observedQueries = [...new Map(
      searchObservations.map((observation) => [queryIdentity(observation.query), observation.query]),
    ).values()];
    if (!sourceQueries) {
      sourceQueries = observedQueries;
    } else {
      const declared = new Set(sourceQueries.map(queryIdentity));
      const observed = new Set(observedQueries.map(queryIdentity));
      if (
        declared.size !== observed.size ||
        [...declared].some((query) => !observed.has(query))
      ) {
        return {
          issue: issue(
            sourceRow,
            asin,
            "searchObservations",
            "INVALID_PROVENANCE",
            "Source Queries and Search Observations must describe the same query set",
          ),
        };
      }
    }
  }

  const product: KeepaMoreProduct = {
    asin,
    domainId: 1,
    marketplace: AMAZON_US,
    currency: USD,
    productType: null,
    title: cleanText(rowValue(values, headers, "title")),
    brand: cleanText(rowValue(values, headers, "brand")),
    manufacturer: cleanText(rowValue(values, headers, "manufacturer")),
    model: cleanText(rowValue(values, headers, "model")),
    color: cleanText(rowValue(values, headers, "color")),
    size: cleanText(rowValue(values, headers, "size")),
    parentAsin,
    categoryIds: [],
    categoryTree: [],
    imageUrls: imageUrls || [],
    currentPrice,
    currentPriceSource: null,
    intervalAveragePrice: null,
    averagePrice30d,
    averagePrice90d,
    averagePrice180d: null,
    intervalMinimumPrice: { at: null, price: null },
    intervalMaximumPrice: { at: null, price: null },
    priceHistory: [],
    rating,
    reviewCount: counts.get("reviewCount") ?? null,
    salesRank: counts.get("salesRank") ?? null,
    salesRankDrops30d: counts.get("salesRankDrops30d") ?? null,
    monthlySold: counts.get("monthlySold") ?? null,
    totalOfferCount: counts.get("totalOfferCount") ?? null,
    buyBoxIsFba,
    fbaPickAndPackFee: null,
    referralFeePercentage: null,
    searchPosition: counts.get("searchPosition") ?? null,
    trackingSince: null,
    listedSince: null,
    lastUpdate: null,
    lastPriceChange: null,
    lastRatingUpdate: null,
    lastSoldUpdate: null,
  };
  if (sourceQueries?.length) product.sourceQueries = sourceQueries;
  if (searchObservations?.length) product.searchObservations = searchObservations;
  return { parsed: { product, sourceRow } };
}

function emptyMetadata(): KeepaMoreProductResult["metadata"] {
  return {
    requestId: null,
    unitsCharged: 0,
    cached: null,
    quota: {
      minute: { limit: null, remaining: null },
      day: { limit: null, remaining: null },
      month: { limit: null, remaining: null },
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function batchError(rowIssue: KeepaMoreExportRowIssue): KeepaMoreBatchError {
  return {
    asin: rowIssue.asin && /^[A-Z0-9]{10}$/.test(rowIssue.asin) ? rowIssue.asin : null,
    code: `IMPORT_${rowIssue.code}`,
    message: `row ${rowIssue.row}: ${rowIssue.message}`,
    errorId: null,
  };
}

export async function parseKeepaMoreExport(
  input: ArrayBuffer | Uint8Array,
  options: KeepaMoreExportImportOptions,
): Promise<KeepaMoreExportImportResult> {
  const limits = checkedLimits(options.limits);
  const bytes = bytesFrom(input);
  const file = safeFilename(options.filename);
  const metadata = validateMetadata(options);
  if (bytes.byteLength === 0) reject("EMPTY_FILE", "The KeepaMore export is empty");
  if (bytes.byteLength > limits.maxFileBytes) {
    reject("FILE_SIZE_LIMIT", `The export exceeds the ${limits.maxFileBytes}-byte limit`);
  }

  const sourceHash = await sha256Hex(bytes);
  const workbook = parseWorkbook(bytes, file.extension, limits);
  const candidate = findImportTable(workbook, limits);
  const products: KeepaMoreProduct[] = [];
  const acceptedRows = new Map<string, number>();
  const rowIssues: KeepaMoreExportRowIssue[] = [];
  let received = 0;
  let ignoredBlank = 0;
  let duplicateCount = 0;

  for (let rowIndex = candidate.headerIndex + 1; rowIndex <= candidate.range.e.r; rowIndex += 1) {
    const values = readRow(candidate.sheet, rowIndex, candidate.range);
    if (rowIsBlank(values)) {
      ignoredBlank += 1;
      continue;
    }
    received += 1;
    const parsed = parseProductRow(
      values,
      rowIndex + 1,
      candidate.headerMap,
      limits,
      metadata.observedAt,
    );
    if (parsed.issue) {
      rowIssues.push(parsed.issue);
      continue;
    }
    const product = parsed.parsed!.product;
    if (acceptedRows.has(product.asin)) {
      duplicateCount += 1;
      rowIssues.push(issue(
        rowIndex + 1,
        product.asin,
        "asin",
        "DUPLICATE_ASIN",
        `Duplicate ASIN; first accepted on row ${acceptedRows.get(product.asin)}`,
      ));
      continue;
    }
    acceptedRows.set(product.asin, rowIndex + 1);
    products.push(product);
  }

  const warnings: string[] = [
    "KeepaMore export rows contain listing aggregates only; they are not review-text VOC.",
    "Missing export values remain null and are not imputed.",
  ];
  if (metadata.observedAtInferred) {
    warnings.push("No export timestamp was supplied; observedAt records the server import time.");
  }
  if (rowIssues.length) warnings.push(`${rowIssues.length} non-blank row(s) were rejected during strict validation.`);
  if (duplicateCount) warnings.push(`${duplicateCount} duplicate ASIN row(s) were rejected; first valid row wins.`);
  const optionalFields: ImportField[] = [
    "title", "brand", "currentPrice", "salesRank", "rating", "reviewCount", "monthlySold", "imageUrls",
  ];
  const missingColumns = optionalFields.filter((field) => !candidate.headerMap.has(field));
  if (missingColumns.length) {
    warnings.push(`Optional columns not present: ${missingColumns.map((field) => FIELD_LABELS[field]).join(", ")}.`);
  }
  if (!products.length) warnings.push("No product rows passed strict validation.");

  const sourceRef = `upload://keepamore/${sourceHash.slice(0, 16)}/${encodeURIComponent(file.basename)}`;
  const productResult: KeepaMoreProductResult = {
    kind: "product",
    requestedAsins: products.map((product) => product.asin),
    domainId: 1,
    marketplace: AMAZON_US,
    currency: USD,
    observedAt: metadata.observedAt,
    sourceRef,
    searchSourceRef: null,
    products,
    count: products.length,
    errors: rowIssues.map(batchError),
    duplicateCount,
    warnings,
    metadata: emptyMetadata(),
  };
  const observationBatch = keepaMoreResultToObservationBatch(productResult, {
    category: CAT_BED,
    marketplace: AMAZON_US,
  });
  if (!products.length) observationBatch.complete = false;
  for (const observation of observationBatch.observations) {
    observation.source_hash = sourceHash;
    observation.dimensions.import_filename = file.basename;
    observation.dimensions.import_row = acceptedRows.get(observation.subject_id) ?? null;
    observation.dimensions.import_format = file.extension.slice(1);
  }

  return {
    kind: "keepamore_export",
    adapterId: KEEPAMORE_ADAPTER_ID,
    filename: file.basename,
    sheetName: candidate.sheetName,
    headerRow: candidate.headerIndex + 1,
    marketplace: AMAZON_US,
    currency: USD,
    category: CAT_BED,
    domainId: 1,
    observedAt: metadata.observedAt,
    sourceRef,
    sourceHash,
    columnMap: Object.fromEntries(
      [...candidate.originalHeaders].map(([field, header]) => [field, header]),
    ),
    products,
    rowIssues,
    duplicateCount,
    warnings,
    rowQuality: {
      received,
      accepted: products.length,
      rejected: rowIssues.length,
      ignoredBlank,
    },
    observationBatch,
  };
}

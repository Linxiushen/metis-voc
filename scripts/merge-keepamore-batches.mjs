import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function usage() {
  throw new Error(
    "Usage: node scripts/merge-keepamore-batches.mjs <output.csv> <batch.json> [batch.json ...]",
  );
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function csvCell(value) {
  const string = value == null ? "" : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

function richer(current, incoming) {
  if (current == null || current === "") return incoming;
  return current;
}

const [, , outputArg, ...inputArgs] = process.argv;
if (!outputArg || !inputArgs.length) usage();

const batches = [];
for (const inputArg of inputArgs) {
  const parsed = JSON.parse(await readFile(resolve(inputArg), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${inputArg} must contain a JSON array`);
  batches.push(...parsed);
}

const productsByAsin = new Map();
let rawRows = 0;
for (const batch of batches) {
  const query = text(batch.query);
  const batchId = text(batch.batch);
  const observedAt = text(batch.observed_at);
  const sourceUrl = text(batch.url);
  if (!Array.isArray(batch.products)) continue;
  for (const product of batch.products) {
    rawRows += 1;
    const asin = text(product.asin).toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    const current = productsByAsin.get(asin) || {
      asin,
      title: "",
      brand: "",
      image_url: "",
      current_price_usd: null,
      rating: null,
      review_count: null,
      monthly_sold: null,
      offer_count: null,
      buy_box_is_fba: null,
      parent_asin: "",
      color: "",
      size: "",
      material: "",
      observations: [],
    };
    for (const field of [
      "title", "brand", "image_url", "parent_asin", "color", "size", "material",
    ]) {
      current[field] = richer(current[field], text(product[field]));
    }
    for (const field of [
      "current_price_usd", "rating", "review_count", "monthly_sold", "offer_count",
    ]) {
      const value = finite(product[field]);
      const valid = field === "current_price_usd"
        ? value != null && value > 0
        : field === "rating"
          ? value != null && value >= 0 && value <= 5
          : value != null && Number.isSafeInteger(value) && value >= 0;
      current[field] = richer(current[field], valid ? value : null);
    }
    current.buy_box_is_fba = richer(current.buy_box_is_fba, product.buy_box_is_fba);
    current.observations.push({
      query,
      batch: batchId,
      search_position: finite(product.search_position) > 0 ? finite(product.search_position) : null,
      observed_at: observedAt,
      source_url: sourceUrl,
    });
    productsByAsin.set(asin, current);
  }
}

const headers = [
  "ASIN",
  "Title",
  "Brand",
  "Current Price",
  "Rating",
  "Review Count",
  "Monthly Sold",
  "Offer Count",
  "Buy Box Is FBA",
  "Search Position",
  "Image URL",
  "Parent ASIN",
  "Color",
  "Size",
  "Material",
  "Source Queries",
  "Query Hit Count",
  "Search Observations",
  "Marketplace",
  "Currency",
  "Category",
];

const rows = [...productsByAsin.values()]
  .sort((left, right) => {
    const leftBest = Math.min(...left.observations.map((item) => item.search_position ?? Infinity));
    const rightBest = Math.min(...right.observations.map((item) => item.search_position ?? Infinity));
    return right.observations.length - left.observations.length || leftBest - rightBest ||
      left.asin.localeCompare(right.asin);
  })
  .map((product) => {
    const queries = [...new Set(product.observations.map((item) => item.query).filter(Boolean))];
    const positions = product.observations
      .map((item) => item.search_position)
      .filter((value) => value != null);
    return [
      product.asin,
      product.title,
      product.brand,
      product.current_price_usd,
      product.rating,
      product.review_count,
      product.monthly_sold,
      product.offer_count,
      product.buy_box_is_fba == null ? "" : product.buy_box_is_fba ? "yes" : "no",
      positions.length ? Math.min(...positions) : "",
      product.image_url,
      product.parent_asin,
      product.color,
      product.size,
      product.material,
      JSON.stringify(queries),
      queries.length,
      JSON.stringify(product.observations.map((item) => ({
        query: item.query,
        position: item.search_position,
        observedAt: item.observed_at,
      }))),
      "Amazon US",
      "USD",
      "cat bed",
    ];
  });

const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
await writeFile(resolve(outputArg), csv, "utf8");

console.log(JSON.stringify({
  batch_count: batches.length,
  nonempty_batch_count: batches.filter((batch) => Array.isArray(batch.products) && batch.products.length).length,
  raw_rows: rawRows,
  unique_asins: rows.length,
  duplicate_observations: rawRows - rows.length,
  output: resolve(outputArg),
}, null, 2));

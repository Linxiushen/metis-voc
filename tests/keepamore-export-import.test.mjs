import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import * as XLSX from "xlsx";

const root = fileURLToPath(new URL("..", import.meta.url));
const encoder = new TextEncoder();
let importer;
let server;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
  });
  importer = await server.ssrLoadModule("/lib/keepamore-export-import.ts");
});

after(async () => {
  await server?.close();
});

function options(overrides = {}) {
  return {
    filename: "cat-bed-export.csv",
    marketplace: "Amazon US",
    currency: "USD",
    category: "cat bed",
    observedAt: "2026-08-20T08:30:00+08:00",
    ...overrides,
  };
}

function csv(value) {
  return encoder.encode(value.replace(/^\n/, ""));
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function workbookBytes(rows, configure) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  configure?.(sheet);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "KeepaMore Export");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

async function expectImportError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof importer.KeepaMoreExportImportError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test("Chinese and English CSV columns normalize into products and auditable observations", async () => {
  const input = csv(`
ASIN,商品标题,品牌,Current Price (USD),BSR,评分,评论数量,月售,主图链接,站点,币种,关键词
B012345678,Washable round cat bed,Example Pet,$29.99,"#1,234",4.7 out of 5,1.2K,1K+ bought in past month,https://m.media-amazon.com/images/I/cat-bed.jpg,Amazon.com,USD,cat beds
`);
  const result = await importer.parseKeepaMoreExport(input, options());

  assert.equal(result.kind, "keepamore_export");
  assert.equal(result.marketplace, "Amazon US");
  assert.equal(result.currency, "USD");
  assert.equal(result.category, "cat bed");
  assert.equal(result.headerRow, 1);
  assert.equal(result.rowQuality.received, 1);
  assert.equal(result.rowQuality.accepted, 1);
  assert.equal(result.rowQuality.rejected, 0);
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(result.sourceRef, /^upload:\/\/keepamore\/[a-f0-9]{16}\//);

  const [product] = result.products;
  assert.equal(product.asin, "B012345678");
  assert.equal(product.title, "Washable round cat bed");
  assert.equal(product.brand, "Example Pet");
  assert.deepEqual(product.currentPrice, {
    amount: 29.99,
    minorUnits: 2999,
    currency: "USD",
    minorUnitScale: 100,
  });
  assert.equal(product.salesRank, 1234);
  assert.equal(product.rating, 4.7);
  assert.equal(product.reviewCount, 1200);
  assert.equal(product.monthlySold, 1000);
  assert.deepEqual(product.imageUrls, ["https://m.media-amazon.com/images/I/cat-bed.jpg"]);
  assert.equal(product.averagePrice30d, null);
  assert.equal(product.searchPosition, null);

  const currentPrice = result.observationBatch.observations.find((item) => item.metric === "current_price");
  assert.equal(currentPrice.value, 29.99);
  assert.equal(currentPrice.unit, "USD");
  assert.equal(currentPrice.source_hash, result.sourceHash);
  assert.equal(currentPrice.dimensions.import_row, 2);
  assert.equal(currentPrice.dimensions.import_filename, "cat-bed-export.csv");
  assert.equal(currentPrice.dimensions.import_format, "csv");
  assert.equal(result.observationBatch.quality.warnings.some((warning) => /not review-text VOC/.test(warning)), true);
});

test("multi-batch provenance columns accept strict JSON and normalize timestamps", async () => {
  const sourceQueries = ["cat bed", "cat cave bed"];
  const searchObservations = [
    { query: "cat bed", position: 1, observedAt: "2026-08-20T00:00:00Z" },
    { query: "cat cave bed", search_position: "7", observed_at: "2026-08-20T08:10:00+08:00" },
  ];
  const input = csv(`ASIN,Title,Source Queries,Search Observations,Category
B012345678,Multi-query cat bed,${csvCell(JSON.stringify(sourceQueries))},${csvCell(JSON.stringify(searchObservations))},cat bed
`);
  const result = await importer.parseKeepaMoreExport(input, options());

  assert.equal(result.products.length, 1);
  assert.deepEqual(result.products[0].sourceQueries, sourceQueries);
  assert.deepEqual(result.products[0].searchObservations, [
    { query: "cat bed", position: 1, observedAt: "2026-08-20T00:00:00.000Z" },
    { query: "cat cave bed", position: 7, observedAt: "2026-08-20T00:10:00.000Z" },
  ]);
  assert.equal(result.columnMap.sourceQueries, "Source Queries");
  assert.equal(result.columnMap.searchObservations, "Search Observations");
  assert.equal(result.category, "cat bed");
  assert.equal(result.rowQuality.rejected, 0);
});

test("stable provenance delimiters parse and observations can derive source queries", async (t) => {
  await t.test("both provenance columns", async () => {
    const result = await importer.parseKeepaMoreExport(csv(`
ASIN,Title,Source Queries,Search Observations
B012345678,Cat bed,cat bed || heated cat bed,cat bed :: 2 :: 2026-08-20T00:00:00Z || heated cat bed :: 11 :: 2026-08-20T00:05:00Z
`), options());
    assert.deepEqual(result.products[0].sourceQueries, ["cat bed", "heated cat bed"]);
    assert.deepEqual(result.products[0].searchObservations.map((item) => item.position), [2, 11]);
  });

  await t.test("observations-only provenance", async () => {
    const observations = [
      { query: "cat donut bed", position: 4, observedAt: "2026-08-20T00:00:00Z" },
      { query: "cat couch bed", position: 8, observedAt: "2026-08-20T00:01:00Z" },
    ];
    const result = await importer.parseKeepaMoreExport(
      csv(`ASIN,Title,Search Observations\nB012345678,Cat bed,${csvCell(JSON.stringify(observations))}\n`),
      options(),
    );
    assert.deepEqual(result.products[0].sourceQueries, ["cat donut bed", "cat couch bed"]);
    assert.equal(result.products[0].searchObservations.length, 2);
  });
});

test("malicious, contradictory, or invalid provenance fails closed per row", async (t) => {
  const validTime = "2026-08-20T00:00:00Z";
  const cases = [
    {
      name: "out-of-scope query",
      sourceQueries: ["dog bed"],
      observations: undefined,
      field: "sourceQueries",
    },
    {
      name: "markup payload",
      sourceQueries: ["cat bed <script>alert(1)</script>"],
      observations: undefined,
      field: "sourceQueries",
    },
    {
      name: "zero position",
      sourceQueries: ["cat bed"],
      observations: [{ query: "cat bed", position: 0, observedAt: validTime }],
      field: "searchObservations",
    },
    {
      name: "fractional position",
      sourceQueries: ["cat bed"],
      observations: [{ query: "cat bed", position: 1.5, observedAt: validTime }],
      field: "searchObservations",
    },
    {
      name: "timestamp without timezone",
      sourceQueries: ["cat bed"],
      observations: [{ query: "cat bed", position: 1, observedAt: "2026-08-20T00:00:00" }],
      field: "searchObservations",
    },
    {
      name: "future timestamp",
      sourceQueries: ["cat bed"],
      observations: [{ query: "cat bed", position: 1, observedAt: "2026-08-21T00:00:00Z" }],
      field: "searchObservations",
    },
    {
      name: "contradictory query sets",
      sourceQueries: ["cat bed"],
      observations: [{ query: "cat cave bed", position: 1, observedAt: validTime }],
      field: "searchObservations",
    },
    {
      name: "unsupported observation property",
      sourceQueries: ["cat bed"],
      observations: [{ query: "cat bed", position: 1, observedAt: validTime, sourceUrl: "https://evil.example" }],
      field: "searchObservations",
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const sourceCell = csvCell(JSON.stringify(item.sourceQueries));
      const observationsCell = item.observations === undefined ? "" : csvCell(JSON.stringify(item.observations));
      const result = await importer.parseKeepaMoreExport(
        csv(`ASIN,Title,Source Queries,Search Observations\nB012345678,Cat bed,${sourceCell},${observationsCell}\n`),
        options(),
      );
      assert.equal(result.products.length, 0);
      assert.equal(result.rowIssues.length, 1);
      assert.equal(result.rowIssues[0].code, "INVALID_PROVENANCE");
      assert.equal(result.rowIssues[0].field, item.field);
      assert.equal(result.observationBatch.complete, false);
    });
  }
});

test("provenance query and observation limits are enforced", async (t) => {
  const sourceQueries = ["cat bed", "cat cave bed"];
  const observations = sourceQueries.map((query, index) => ({
    query,
    position: index + 1,
    observedAt: "2026-08-20T00:00:00Z",
  }));
  await t.test("source query count", async () => {
    const result = await importer.parseKeepaMoreExport(
      csv(`ASIN,Source Queries\nB012345678,${csvCell(JSON.stringify(sourceQueries))}\n`),
      options({ limits: { maxSourceQueries: 1 } }),
    );
    assert.equal(result.products.length, 0);
    assert.equal(result.rowIssues[0].field, "sourceQueries");
  });
  await t.test("observation count", async () => {
    const result = await importer.parseKeepaMoreExport(
      csv(`ASIN,Search Observations\nB012345678,${csvCell(JSON.stringify(observations))}\n`),
      options({ limits: { maxSearchObservations: 1 } }),
    );
    assert.equal(result.products.length, 0);
    assert.equal(result.rowIssues[0].field, "searchObservations");
  });
  await t.test("query length", async () => {
    const result = await importer.parseKeepaMoreExport(
      csv(`ASIN,Source Queries\nB012345678,${csvCell(JSON.stringify(["extra fluffy indoor cat bed"]))}\n`),
      options({ limits: { maxQueryCharacters: 12 } }),
    );
    assert.equal(result.products.length, 0);
    assert.equal(result.rowIssues[0].field, "sourceQueries");
  });
});

test("missing optional values remain null and are never imputed", async () => {
  const result = await importer.parseKeepaMoreExport(
    csv("ASIN,Title,Brand,Price,Rating,Reviews\nB087654321,,,,N/A,--\n"),
    options(),
  );
  const [product] = result.products;
  assert.equal(product.title, null);
  assert.equal(product.brand, null);
  assert.equal(product.currentPrice, null);
  assert.equal(product.rating, null);
  assert.equal(product.reviewCount, null);
  assert.equal(product.salesRank, null);
  assert.equal(product.monthlySold, null);
  assert.equal(product.imageUrls.length, 0);
  assert.equal(result.observationBatch.observations.some((item) => item.metric === "current_price"), false);
});

test("valid two-decimal USD prices survive binary floating-point representation", async () => {
  const result = await importer.parseKeepaMoreExport(
    csv("ASIN,Title,Price\nB012345678,Small cat bed,$1.15\n"),
    options(),
  );
  assert.equal(result.products[0].currentPrice.amount, 1.15);
  assert.equal(result.products[0].currentPrice.minorUnits, 115);
});

test("bad rows and duplicate ASINs are rejected without contaminating valid products", async () => {
  const result = await importer.parseKeepaMoreExport(csv(`
ASIN,Title,Price,Rating,Image URL
B012345678,Valid cat bed,$25.50,4.6,https://example.com/cat-bed.jpg
B012345678,Duplicate,$26.50,4.5,https://example.com/duplicate.jpg
B111111111,Bad price,free,4.5,https://example.com/bad-price.jpg
B222222222,Bad rating,$19.99,5.5,https://example.com/bad-rating.jpg
B333333333,Bad image,$21.00,4.1,javascript:alert(1)
bad,Invalid ASIN,$20.00,4.0,https://example.com/bad-asin.jpg
`), options());

  assert.deepEqual(result.products.map((product) => product.asin), ["B012345678"]);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.rowQuality, {
    received: 6,
    accepted: 1,
    rejected: 5,
    ignoredBlank: 0,
  });
  assert.deepEqual(result.rowIssues.map((item) => item.code), [
    "DUPLICATE_ASIN",
    "INVALID_NUMBER",
    "INVALID_NUMBER",
    "INVALID_URL",
    "INVALID_ASIN",
  ]);
  assert.equal(result.observationBatch.complete, false);
  assert.equal(result.observationBatch.quality.rejected, 5);
});

test("row-level marketplace, currency, and category metadata cannot contradict the import scope", async (t) => {
  const cases = [
    ["Marketplace", "Amazon UK", "marketplace"],
    ["Currency", "EUR", "currency"],
    ["Category", "dog bed", "category"],
  ];
  for (const [header, value, field] of cases) {
    await t.test(field, async () => {
      const result = await importer.parseKeepaMoreExport(
        csv(`ASIN,Title,${header}\nB012345678,Cat bed,${value}\n`),
        options(),
      );
      assert.equal(result.products.length, 0);
      assert.equal(result.rowIssues[0].code, "METADATA_MISMATCH");
      assert.equal(result.rowIssues[0].field, field);
      assert.equal(result.observationBatch.complete, false);
    });
  }
});

test("only explicit Amazon US, USD, and cat bed import metadata is accepted", async (t) => {
  const input = csv("ASIN,Title\nB012345678,Cat bed\n");
  await t.test("missing metadata", async () => {
    await expectImportError(importer.parseKeepaMoreExport(input, {
      filename: "cat-bed.csv",
      marketplace: "",
      currency: "",
      category: "",
    }), "INVALID_METADATA");
  });
  await t.test("wrong marketplace", async () => {
    await expectImportError(importer.parseKeepaMoreExport(input, options({ marketplace: "Amazon UK" })), "INVALID_METADATA");
  });
  await t.test("wrong currency", async () => {
    await expectImportError(importer.parseKeepaMoreExport(input, options({ currency: "EUR" })), "INVALID_METADATA");
  });
  await t.test("wrong category", async () => {
    await expectImportError(importer.parseKeepaMoreExport(input, options({ category: "dog bed" })), "INVALID_METADATA");
  });
});

test("formula-like CSV text and real XLSX formulas fail closed", async (t) => {
  await t.test("CSV injection", async () => {
    const input = csv('ASIN,Title,Image URL\nB012345678,Cat bed,"=HYPERLINK(""https://evil.example"",""image"")"\n');
    await expectImportError(importer.parseKeepaMoreExport(input, options()), "FORMULA_NOT_ALLOWED");
  });

  await t.test("XLSX formula", async () => {
    const input = workbookBytes([
      ["ASIN", "Title", "Price"],
      ["B012345678", "Cat bed", 29.99],
    ], (sheet) => {
      sheet.C2 = { t: "n", v: 29.99, f: "1+1" };
    });
    await expectImportError(importer.parseKeepaMoreExport(
      input,
      options({ filename: "cat-bed.xlsx" }),
    ), "FORMULA_NOT_ALLOWED");
  });
});

test("a normal XLSX export uses the same normalization contract", async () => {
  const input = workbookBytes([
    ["KEEPAMORE FREE EXPORT"],
    ["product ASIN", "Product Name", "Brand Name", "Buy Box Price", "Sales Rank", "Star Rating", "Rating Count", "Monthly Sales", "Main Image URL"],
    ["B012345678", "Cave cat bed", "Pet House", "$35.00", "2.5K", 4.8, 345, "500+", "https://example.com/cave.jpg"],
  ]);
  const result = await importer.parseKeepaMoreExport(
    input,
    options({ filename: "keepamore-cat-bed.XLSX" }),
  );

  assert.equal(result.sheetName, "KeepaMore Export");
  assert.equal(result.headerRow, 2);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].currentPrice.amount, 35);
  assert.equal(result.products[0].salesRank, 2500);
  assert.equal(result.products[0].reviewCount, 345);
  assert.equal(result.products[0].monthlySold, 500);
  assert.equal(result.observationBatch.observations[0].dimensions.import_format, "xlsx");
});

test("ambiguous columns, invalid archives, invalid UTF-8, and configured limits are enforced", async (t) => {
  await t.test("ambiguous columns", async () => {
    const input = csv("ASIN,Product ASIN,Title\nB012345678,B012345678,Cat bed\n");
    await expectImportError(importer.parseKeepaMoreExport(input, options()), "AMBIGUOUS_COLUMNS");
  });
  await t.test("invalid XLSX", async () => {
    await expectImportError(importer.parseKeepaMoreExport(
      encoder.encode("not a zip archive"),
      options({ filename: "cat-bed.xlsx" }),
    ), "INVALID_WORKBOOK");
  });
  await t.test("invalid UTF-8 CSV", async () => {
    await expectImportError(importer.parseKeepaMoreExport(
      new Uint8Array([0xff, 0xfe, 0xfd]),
      options(),
    ), "INVALID_CSV_ENCODING");
  });
  await t.test("file-size limit", async () => {
    await expectImportError(importer.parseKeepaMoreExport(
      csv("ASIN,Title\nB012345678,Cat bed\n"),
      options({ limits: { maxFileBytes: 10 } }),
    ), "FILE_SIZE_LIMIT");
  });
  await t.test("row limit", async () => {
    await expectImportError(importer.parseKeepaMoreExport(
      csv("ASIN,Title\nB012345678,One\nB087654321,Two\n"),
      options({ limits: { maxRows: 1 } }),
    ), "ROW_LIMIT");
  });
});

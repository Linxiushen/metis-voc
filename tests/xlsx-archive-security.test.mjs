import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const encoder = new TextEncoder();

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;

let archiveModule;
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
  archiveModule = await server.ssrLoadModule("/lib/xlsx-archive.ts");
});

after(async () => {
  await server?.close();
});

function bytes(length, fill = 0x41) {
  return new Uint8Array(length).fill(fill);
}

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function setUint16(target, offset, value) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint16(offset, value, true);
}

function setUint32(target, offset, value) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value, true);
}

function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localRecord(entry, name, payload, compressedSize, uncompressedSize) {
  const extra = entry.localExtra ?? new Uint8Array();
  const record = new Uint8Array(30 + name.byteLength + extra.byteLength + payload.byteLength);
  setUint32(record, 0, LOCAL_FILE_HEADER);
  setUint16(record, 4, entry.versionNeeded ?? 20);
  setUint16(record, 6, entry.flags ?? 0);
  setUint16(record, 8, entry.compressionMethod ?? 0);
  setUint32(record, 14, entry.crc32 ?? crc32(payload));
  setUint32(record, 18, compressedSize);
  setUint32(record, 22, uncompressedSize);
  setUint16(record, 26, name.byteLength);
  setUint16(record, 28, extra.byteLength);
  record.set(name, 30);
  record.set(extra, 30 + name.byteLength);
  record.set(payload, 30 + name.byteLength + extra.byteLength);
  return record;
}

function centralRecord(entry, name, localHeaderOffset, compressedSize, uncompressedSize) {
  const extra = entry.centralExtra ?? new Uint8Array();
  const comment = encoder.encode(entry.comment ?? "");
  const record = new Uint8Array(46 + name.byteLength + extra.byteLength + comment.byteLength);
  setUint32(record, 0, entry.centralSignature ?? CENTRAL_DIRECTORY_HEADER);
  setUint16(record, 4, entry.versionMadeBy ?? 20);
  setUint16(record, 6, entry.versionNeeded ?? 20);
  setUint16(record, 8, entry.flags ?? 0);
  setUint16(record, 10, entry.compressionMethod ?? 0);
  setUint32(record, 16, entry.crc32 ?? crc32(entry.payload ?? new Uint8Array()));
  setUint32(record, 20, compressedSize);
  setUint32(record, 24, uncompressedSize);
  setUint16(record, 28, name.byteLength);
  setUint16(record, 30, extra.byteLength);
  setUint16(record, 32, comment.byteLength);
  setUint16(record, 34, entry.diskNumberStart ?? 0);
  setUint32(record, 38, entry.externalAttributes ?? 0);
  setUint32(record, 42, entry.localHeaderOffset ?? localHeaderOffset);
  record.set(name, 46);
  record.set(extra, 46 + name.byteLength);
  record.set(comment, 46 + name.byteLength + extra.byteLength);
  return record;
}

function buildZip(entries, options = {}) {
  const localRecords = [];
  const centralSpecs = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const payload = entry.payload ?? bytes(entry.payloadLength ?? 0);
    const compressedSize = entry.compressedSize ?? payload.byteLength;
    const uncompressedSize = entry.uncompressedSize ?? payload.byteLength;
    const local = localRecord(entry, name, payload, compressedSize, uncompressedSize);
    localRecords.push(local);
    centralSpecs.push({ entry, name, localOffset, compressedSize, uncompressedSize });
    localOffset += local.byteLength;
  }

  const centralOffset = localOffset;
  const centralRecords = centralSpecs.map((spec) => centralRecord(
    spec.entry,
    spec.name,
    spec.localOffset,
    spec.compressedSize,
    spec.uncompressedSize,
  ));
  const centralDirectory = concatBytes(...centralRecords);
  const beforeEocd = options.beforeEocd ?? new Uint8Array();
  const eocdComment = encoder.encode(options.eocdComment ?? "");
  const eocd = new Uint8Array(22 + eocdComment.byteLength);
  const entryCount = options.entryCount ?? entries.length;

  setUint32(eocd, 0, options.eocdSignature ?? END_OF_CENTRAL_DIRECTORY);
  setUint16(eocd, 4, options.diskNumber ?? 0);
  setUint16(eocd, 6, options.centralDirectoryDisk ?? 0);
  setUint16(eocd, 8, options.entriesOnDisk ?? entryCount);
  setUint16(eocd, 10, options.totalEntries ?? entryCount);
  setUint32(eocd, 12, options.centralDirectorySize ?? centralDirectory.byteLength);
  setUint32(eocd, 16, options.centralDirectoryOffset ?? centralOffset);
  setUint16(eocd, 20, options.eocdCommentLength ?? eocdComment.byteLength);
  eocd.set(eocdComment, 22);

  const archive = concatBytes(...localRecords, centralDirectory, beforeEocd, eocd);
  return {
    archive,
    centralOffset,
    centralSize: centralDirectory.byteLength,
    centralRecordOffsets: centralRecords.reduce((offsets, record) => {
      offsets.push(centralOffset + offsets.bytes);
      offsets.bytes += record.byteLength;
      return offsets;
    }, Object.assign([], { bytes: 0 })),
    eocdOffset: archive.byteLength - eocd.byteLength,
  };
}

async function expectAccepted(input, expected) {
  const result = await archiveModule.validateXlsxArchive(input);
  assert.deepEqual(result, expected);
}

async function expectRejected(input, code, limitExceeded = false) {
  let rejection;
  try {
    await archiveModule.validateXlsxArchive(input);
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection, `expected ${code}, but the archive was accepted`);
  assert.equal(rejection instanceof archiveModule.XlsxArchiveValidationError, true);
  assert.equal(rejection.code, code);
  assert.equal(rejection.limitExceeded, limitExceeded);
}

test("a minimal ZIP and XLSX-shaped archive pass with exact aggregate metadata", async () => {
  const zipPayload = encoder.encode("ok");
  const zip = buildZip([{ name: "hello.txt", payload: zipPayload }]).archive;
  await expectAccepted(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength), {
    entryCount: 1,
    totalCompressedBytes: zipPayload.byteLength,
    totalUncompressedBytes: zipPayload.byteLength,
  });

  const xlsxEntries = [
    { name: "[Content_Types].xml", payload: encoder.encode("<Types/>") },
    { name: "_rels/.rels", payload: encoder.encode("<Relationships/>") },
    { name: "xl/workbook.xml", payload: encoder.encode("<workbook/>") },
    { name: "xl/_rels/workbook.xml.rels", payload: encoder.encode("<Relationships/>") },
    { name: "xl/worksheets/sheet1.xml", payload: encoder.encode("<worksheet/>") },
  ];
  const xlsx = buildZip(xlsxEntries).archive;
  const total = xlsxEntries.reduce((sum, entry) => sum + entry.payload.byteLength, 0);
  await expectAccepted(xlsx, {
    entryCount: xlsxEntries.length,
    totalCompressedBytes: total,
    totalUncompressedBytes: total,
  });
});

test("total advertised uncompressed bytes above 25 MB are rejected", async () => {
  const archive = buildZip(Array.from({ length: 3 }, (_, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    payloadLength: 90_000,
    compressedSize: 90_000,
    uncompressedSize: 9_000_000,
    compressionMethod: 8,
  }))).archive;
  await expectRejected(archive, "TOTAL_SIZE_LIMIT", true);
});

test("one entry above 10 MB is rejected independently of the ratio limit", async () => {
  const archive = buildZip([{
    name: "xl/sharedStrings.xml",
    payloadLength: 100_001,
    compressedSize: 100_001,
    uncompressedSize: 10_000_001,
    compressionMethod: 8,
  }]).archive;
  await expectRejected(archive, "ENTRY_SIZE_LIMIT", true);
});

test("compression ratios above 100 and a zero compressed-size edge case are rejected", async (t) => {
  await t.test("finite ratio above the limit", async () => {
    const archive = buildZip([{
      name: "xl/sharedStrings.xml",
      payloadLength: 1,
      compressedSize: 1,
      uncompressedSize: 101,
      compressionMethod: 8,
    }]).archive;
    await expectRejected(archive, "COMPRESSION_RATIO_LIMIT", true);
  });

  await t.test("non-empty output advertised from zero compressed bytes", async () => {
    const archive = buildZip([{
      name: "xl/sharedStrings.xml",
      compressedSize: 0,
      uncompressedSize: 1,
      compressionMethod: 8,
    }]).archive;
    await expectRejected(archive, "COMPRESSION_RATIO_LIMIT", true);
  });
});

test("more than 2048 central-directory entries are rejected", async () => {
  const archive = buildZip(Array.from({ length: 2049 }, (_, index) => ({
    name: `xl/empty/${index}.xml`,
  }))).archive;
  await expectRejected(archive, "ENTRY_COUNT_LIMIT", true);
});

test("Zip64 records and sentinel placeholders are rejected before size arithmetic", async (t) => {
  await t.test("Zip64 EOCD locator", async () => {
    const zip64Record = new Uint8Array(56);
    setUint32(zip64Record, 0, ZIP64_END_OF_CENTRAL_DIRECTORY);
    const locator = new Uint8Array(20);
    setUint32(locator, 0, ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR);
    const archive = buildZip(
      [{ name: "xl/workbook.xml" }],
      { beforeEocd: concatBytes(zip64Record, locator) },
    ).archive;
    await expectRejected(archive, "ZIP64_UNSUPPORTED");
  });

  await t.test("EOCD entry-count sentinel", async () => {
    const archive = buildZip(
      [{ name: "xl/workbook.xml" }],
      { entriesOnDisk: 0xffff, totalEntries: 0xffff },
    ).archive;
    await expectRejected(archive, "ZIP64_UNSUPPORTED");
  });

  await t.test("EOCD central-directory size and offset sentinels", async () => {
    const archive = buildZip(
      [{ name: "xl/workbook.xml" }],
      { centralDirectorySize: 0xffffffff, centralDirectoryOffset: 0xffffffff },
    ).archive;
    await expectRejected(archive, "ZIP64_UNSUPPORTED");
  });

  await t.test("central-directory size and offset sentinels", async () => {
    const archive = buildZip([{
      name: "xl/workbook.xml",
      compressedSize: 0xffffffff,
      uncompressedSize: 0xffffffff,
      localHeaderOffset: 0xffffffff,
    }]).archive;
    await expectRejected(archive, "ZIP64_UNSUPPORTED");
  });
});

test("encrypted entries and unsupported compression methods fail closed", async (t) => {
  await t.test("general-purpose encryption flag", async () => {
    const archive = buildZip([{ name: "xl/workbook.xml", flags: 0x0001 }]).archive;
    await expectRejected(archive, "ENCRYPTED_ARCHIVE");
  });

  await t.test("compression method outside stored and deflate", async () => {
    const archive = buildZip([{ name: "xl/workbook.xml", compressionMethod: 12 }]).archive;
    await expectRejected(archive, "UNSUPPORTED_COMPRESSION");
  });
});

test("EOCD corruption, inconsistent disks, and directory bounds fail closed", async (t) => {
  await t.test("truncated EOCD", async () => {
    const archive = buildZip([{ name: "xl/workbook.xml" }]).archive;
    await expectRejected(archive.subarray(0, archive.byteLength - 1), "INVALID_ARCHIVE");
  });

  await t.test("bad EOCD signature", async () => {
    const fixture = buildZip([{ name: "xl/workbook.xml" }]);
    setUint32(fixture.archive, fixture.eocdOffset, 0xdeadbeef);
    await expectRejected(fixture.archive, "INVALID_ARCHIVE");
  });

  await t.test("multi-disk EOCD", async () => {
    const archive = buildZip(
      [{ name: "xl/workbook.xml" }],
      { diskNumber: 1, centralDirectoryDisk: 1 },
    ).archive;
    await expectRejected(archive, "INVALID_ARCHIVE");
  });

  await t.test("inconsistent per-disk and total entry counts", async () => {
    const archive = buildZip(
      [{ name: "xl/workbook.xml" }],
      { entriesOnDisk: 0, totalEntries: 1 },
    ).archive;
    await expectRejected(archive, "INVALID_ARCHIVE");
  });

  await t.test("central-directory offset beyond the input", async () => {
    const fixture = buildZip([{ name: "xl/workbook.xml" }]);
    setUint32(fixture.archive, fixture.eocdOffset + 16, fixture.archive.byteLength + 1);
    await expectRejected(fixture.archive, "INVALID_ARCHIVE");
  });

  await t.test("central directory overlaps its EOCD", async () => {
    const fixture = buildZip([{ name: "xl/workbook.xml" }]);
    setUint32(fixture.archive, fixture.eocdOffset + 12, fixture.centralSize + 1);
    await expectRejected(fixture.archive, "INVALID_ARCHIVE");
  });

  await t.test("EOCD comment length extends beyond the input", async () => {
    const archive = buildZip(
      [{ name: "xl/workbook.xml" }],
      { eocdCommentLength: 1 },
    ).archive;
    await expectRejected(archive, "INVALID_ARCHIVE");
  });
});

test("central-directory damage, duplicates, and local-range overlap fail closed", async (t) => {
  await t.test("bad central-directory signature", async () => {
    const fixture = buildZip([{ name: "xl/workbook.xml" }]);
    setUint32(fixture.archive, fixture.centralOffset, 0xdeadbeef);
    await expectRejected(fixture.archive, "INVALID_ARCHIVE");
  });

  await t.test("central entry variable fields exceed directory bounds", async () => {
    const fixture = buildZip([{ name: "xl/workbook.xml" }]);
    setUint16(fixture.archive, fixture.centralOffset + 28, 0xffff);
    await expectRejected(fixture.archive, "INVALID_ARCHIVE");
  });

  await t.test("duplicate entry names", async () => {
    const archive = buildZip([
      { name: "xl/workbook.xml" },
      { name: "xl/workbook.xml" },
    ]).archive;
    await expectRejected(archive, "INVALID_ARCHIVE");
  });

  await t.test("a local-header offset points into the central directory", async () => {
    const fixture = buildZip([{ name: "xl/workbook.xml" }]);
    setUint32(fixture.archive, fixture.centralOffset + 42, fixture.centralOffset);
    await expectRejected(fixture.archive, "INVALID_ARCHIVE");
  });

  await t.test("two central entries claim the same local record", async () => {
    const fixture = buildZip([
      { name: "xl/workbook.xml" },
      { name: "xl/worksheets/sheet1.xml" },
    ]);
    setUint32(fixture.archive, fixture.centralRecordOffsets[1] + 42, 0);
    await expectRejected(fixture.archive, "INVALID_ARCHIVE");
  });

  await t.test("distinct local records advertise overlapping data ranges", async () => {
    const archive = buildZip([
      {
        name: "xl/workbook.xml",
        payloadLength: 1,
        compressedSize: 50,
        uncompressedSize: 50,
        compressionMethod: 8,
        crc32: 0,
      },
      { name: "xl/worksheets/sheet1.xml", crc32: 0 },
    ]).archive;
    await expectRejected(archive, "INVALID_ARCHIVE");
  });

  await t.test("a duplicate EOCD leaves an unaccounted directory gap", async () => {
    const fixture = buildZip([{ name: "xl/workbook.xml" }]);
    const duplicateEocd = fixture.archive.slice(fixture.eocdOffset);
    await expectRejected(concatBytes(fixture.archive, duplicateEocd), "INVALID_ARCHIVE");
  });
});

test("non-ZIP and empty inputs are rejected", async (t) => {
  await t.test("arbitrary bytes", async () => {
    await expectRejected(encoder.encode("not a zip archive"), "INVALID_ARCHIVE");
  });

  await t.test("empty input", async () => {
    await expectRejected(new Uint8Array(), "INVALID_ARCHIVE");
  });
});

test("brief import validates the bounded XLSX archive before parsing it", async () => {
  const routeSource = await readFile(
    new URL("../app/api/[[...path]]/route.ts", import.meta.url),
    "utf8",
  );
  const start = routeSource.indexOf("async function importBrief");
  const end = routeSource.indexOf("\nasync function ", start + 1);
  assert.ok(start >= 0 && end > start, "importBrief must remain a distinct auditable handler");
  const importSource = routeSource.slice(start, end);

  assert.equal((importSource.match(/5_000_000/g) ?? []).length, 2);
  const validationOffset = importSource.indexOf("validateXlsxArchive(bytes)");
  const parserOffset = importSource.indexOf("XLSX.read(bytes");
  assert.ok(validationOffset >= 0, "the archive validator must receive the uploaded bytes");
  assert.ok(parserOffset > validationOffset, "archive validation must run before XLSX.read");
  assert.match(importSource, /error instanceof XlsxArchiveValidationError/);
  assert.match(importSource, /error\.limitExceeded[\s\S]{0,300}error\.limitExceeded\s*\?\s*413\s*:\s*400/);
});

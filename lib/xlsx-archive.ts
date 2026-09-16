const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_LOCATOR_SIGNATURE = 0x07064b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;

const LOCAL_FILE_HEADER_BYTES = 30;
const CENTRAL_DIRECTORY_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

export const DEFAULT_XLSX_ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 2_048,
  maxEntryUncompressedBytes: 10_000_000,
  maxTotalUncompressedBytes: 25_000_000,
  maxCompressionRatio: 100,
});

export type XlsxArchiveLimits = typeof DEFAULT_XLSX_ARCHIVE_LIMITS;

export type XlsxArchiveValidationCode =
  | "INVALID_ARCHIVE"
  | "ZIP64_UNSUPPORTED"
  | "ENCRYPTED_ARCHIVE"
  | "UNSUPPORTED_COMPRESSION"
  | "ENTRY_COUNT_LIMIT"
  | "ENTRY_SIZE_LIMIT"
  | "TOTAL_SIZE_LIMIT"
  | "COMPRESSION_RATIO_LIMIT";

const ERROR_MESSAGES: Record<XlsxArchiveValidationCode, string> = {
  INVALID_ARCHIVE: "Invalid XLSX ZIP archive",
  ZIP64_UNSUPPORTED: "Zip64 XLSX archives are not supported",
  ENCRYPTED_ARCHIVE: "Encrypted XLSX archives are not supported",
  UNSUPPORTED_COMPRESSION: "Unsupported XLSX ZIP compression method",
  ENTRY_COUNT_LIMIT: "XLSX ZIP entry count exceeds the safety limit",
  ENTRY_SIZE_LIMIT: "XLSX ZIP entry exceeds the uncompressed size limit",
  TOTAL_SIZE_LIMIT: "XLSX ZIP total uncompressed size exceeds the safety limit",
  COMPRESSION_RATIO_LIMIT: "XLSX ZIP compression ratio exceeds the safety limit",
};

export class XlsxArchiveValidationError extends Error {
  readonly limitExceeded: boolean;

  constructor(readonly code: XlsxArchiveValidationCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "XlsxArchiveValidationError";
    this.limitExceeded = [
      "ENTRY_COUNT_LIMIT",
      "ENTRY_SIZE_LIMIT",
      "TOTAL_SIZE_LIMIT",
      "COMPRESSION_RATIO_LIMIT",
    ].includes(code);
  }
}

export type XlsxArchiveSummary = {
  entryCount: number;
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
};

type CentralDirectoryEntry = {
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  flags: number;
  compressionMethod: number;
  localHeaderOffset: number;
  nameStart: number;
  nameLength: number;
};

function reject(code: XlsxArchiveValidationCode): never {
  throw new XlsxArchiveValidationError(code);
}

function checkedLimits(overrides: Partial<XlsxArchiveLimits>): XlsxArchiveLimits {
  const limits = { ...DEFAULT_XLSX_ARCHIVE_LIMITS, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new TypeError("XLSX archive limits must be positive integers");
    }
  }
  return limits;
}

function hasBytes(length: number, offset: number, count: number): boolean {
  return Number.isInteger(offset) && Number.isInteger(count) &&
    offset >= 0 && count >= 0 && offset <= length - count;
}

function findEndOfCentralDirectory(view: DataView): number {
  if (view.byteLength < END_OF_CENTRAL_DIRECTORY_BYTES) reject("INVALID_ARCHIVE");
  const earliest = Math.max(
    0,
    view.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES - MAX_ZIP_COMMENT_BYTES,
  );
  for (let offset = view.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + END_OF_CENTRAL_DIRECTORY_BYTES + commentLength === view.byteLength) {
      return offset;
    }
  }
  reject("INVALID_ARCHIVE");
}

function assertNoZip64Extra(view: DataView, start: number, length: number): void {
  const end = start + length;
  let cursor = start;
  while (cursor < end) {
    if (!hasBytes(view.byteLength, cursor, 4)) reject("INVALID_ARCHIVE");
    const fieldId = view.getUint16(cursor, true);
    const fieldLength = view.getUint16(cursor + 2, true);
    cursor += 4;
    if (!hasBytes(end, cursor, fieldLength)) reject("INVALID_ARCHIVE");
    if (fieldId === ZIP64_EXTRA_FIELD_ID) reject("ZIP64_UNSUPPORTED");
    cursor += fieldLength;
  }
  if (cursor !== end) reject("INVALID_ARCHIVE");
}

function rawNameKey(bytes: Uint8Array, start: number, length: number): string {
  let value = "";
  for (let index = start; index < start + length; index += 1) {
    value += bytes[index].toString(16).padStart(2, "0");
  }
  return value;
}

function namesEqual(
  bytes: Uint8Array,
  leftStart: number,
  rightStart: number,
  length: number,
): boolean {
  for (let index = 0; index < length; index += 1) {
    if (bytes[leftStart + index] !== bytes[rightStart + index]) return false;
  }
  return true;
}

function assertSupportedEntry(flags: number, compressionMethod: number): void {
  const encrypted = (flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || (flags & 0x2000) !== 0;
  if (encrypted) reject("ENCRYPTED_ARCHIVE");
  const allowedFlags = 0x0002 | 0x0004 | 0x0008 | 0x0800;
  if ((flags & ~allowedFlags) !== 0) reject("INVALID_ARCHIVE");
  if (compressionMethod !== 0 && compressionMethod !== 8) {
    reject("UNSUPPORTED_COMPRESSION");
  }
  if (compressionMethod === 0 && (flags & (0x0002 | 0x0004)) !== 0) {
    reject("INVALID_ARCHIVE");
  }
}

function dataDescriptorEnd(
  view: DataView,
  start: number,
  limit: number,
  entry: CentralDirectoryEntry,
): number {
  const descriptorMatches = (valueStart: number): boolean =>
    hasBytes(limit, valueStart, 12) &&
    view.getUint32(valueStart, true) === entry.crc32 &&
    view.getUint32(valueStart + 4, true) === entry.compressedSize &&
    view.getUint32(valueStart + 8, true) === entry.uncompressedSize;
  if (
    hasBytes(limit, start, 16) &&
    view.getUint32(start, true) === DATA_DESCRIPTOR_SIGNATURE &&
    descriptorMatches(start + 4)
  ) {
    return start + 16;
  }
  if (descriptorMatches(start)) return start + 12;
  reject("INVALID_ARCHIVE");
}

export function validateXlsxArchive(
  input: ArrayBuffer | Uint8Array,
  limitOverrides: Partial<XlsxArchiveLimits> = {},
): XlsxArchiveSummary {
  const limits = checkedLimits(limitOverrides);
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);

  if (
    eocdOffset >= 20 &&
    view.getUint32(eocdOffset - 20, true) === ZIP64_END_LOCATOR_SIGNATURE
  ) {
    reject("ZIP64_UNSUPPORTED");
  }

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (
    entriesOnDisk === 0xffff || entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff
  ) {
    reject("ZIP64_UNSUPPORTED");
  }
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    reject("INVALID_ARCHIVE");
  }
  if (entryCount === 0) reject("INVALID_ARCHIVE");
  if (entryCount > limits.maxEntries) reject("ENTRY_COUNT_LIMIT");
  if (centralDirectorySize < entryCount * CENTRAL_DIRECTORY_HEADER_BYTES) {
    reject("INVALID_ARCHIVE");
  }
  if (
    !hasBytes(eocdOffset, centralDirectoryOffset, centralDirectorySize) ||
    centralDirectoryOffset + centralDirectorySize !== eocdOffset
  ) {
    reject("INVALID_ARCHIVE");
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  const entries: CentralDirectoryEntry[] = [];
  const entryNames = new Set<string>();
  const localHeaderOffsets = new Set<number>();
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (!hasBytes(centralDirectoryEnd, cursor, CENTRAL_DIRECTORY_HEADER_BYTES)) {
      reject("INVALID_ARCHIVE");
    }
    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      reject("INVALID_ARCHIVE");
    }
    const versionNeeded = view.getUint16(cursor + 6, true);
    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const startDisk = view.getUint16(cursor + 34, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    if (
      versionNeeded >= 45 || compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff
    ) {
      reject("ZIP64_UNSUPPORTED");
    }
    if (startDisk !== 0 || nameLength === 0 || nameLength > 4_096) {
      reject("INVALID_ARCHIVE");
    }
    assertSupportedEntry(flags, compressionMethod);
    if (compressionMethod === 0 && compressedSize !== uncompressedSize) {
      reject("INVALID_ARCHIVE");
    }
    if (uncompressedSize > limits.maxEntryUncompressedBytes) reject("ENTRY_SIZE_LIMIT");
    if (
      uncompressedSize > 0 &&
      (compressedSize === 0 || uncompressedSize > compressedSize * limits.maxCompressionRatio)
    ) {
      reject("COMPRESSION_RATIO_LIMIT");
    }
    totalCompressedBytes += compressedSize;
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      reject("TOTAL_SIZE_LIMIT");
    }

    const variableLength = nameLength + extraLength + commentLength;
    const next = cursor + CENTRAL_DIRECTORY_HEADER_BYTES + variableLength;
    if (next > centralDirectoryEnd) reject("INVALID_ARCHIVE");
    const nameStart = cursor + CENTRAL_DIRECTORY_HEADER_BYTES;
    const extraStart = nameStart + nameLength;
    assertNoZip64Extra(view, extraStart, extraLength);
    const nameKey = rawNameKey(bytes, nameStart, nameLength);
    if (entryNames.has(nameKey) || localHeaderOffsets.has(localHeaderOffset)) {
      reject("INVALID_ARCHIVE");
    }
    entryNames.add(nameKey);
    localHeaderOffsets.add(localHeaderOffset);
    entries.push({
      compressedSize,
      uncompressedSize,
      crc32,
      flags,
      compressionMethod,
      localHeaderOffset,
      nameStart,
      nameLength,
    });
    cursor = next;
  }
  if (cursor !== centralDirectoryEnd) reject("INVALID_ARCHIVE");

  const localRanges: Array<{ start: number; end: number }> = [];
  for (const entry of entries) {
    const offset = entry.localHeaderOffset;
    if (!hasBytes(centralDirectoryOffset, offset, LOCAL_FILE_HEADER_BYTES)) {
      reject("INVALID_ARCHIVE");
    }
    if (view.getUint32(offset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
      reject("INVALID_ARCHIVE");
    }
    const localVersionNeeded = view.getUint16(offset + 4, true);
    const localFlags = view.getUint16(offset + 6, true);
    const localCompressionMethod = view.getUint16(offset + 8, true);
    const localCrc32 = view.getUint32(offset + 14, true);
    const localCompressedSize = view.getUint32(offset + 18, true);
    const localUncompressedSize = view.getUint32(offset + 22, true);
    const localNameLength = view.getUint16(offset + 26, true);
    const localExtraLength = view.getUint16(offset + 28, true);
    if (
      localVersionNeeded >= 45 || localCompressedSize === 0xffffffff ||
      localUncompressedSize === 0xffffffff
    ) {
      reject("ZIP64_UNSUPPORTED");
    }
    if (
      localFlags !== entry.flags || localCompressionMethod !== entry.compressionMethod ||
      localNameLength !== entry.nameLength
    ) {
      reject("INVALID_ARCHIVE");
    }
    const localNameStart = offset + LOCAL_FILE_HEADER_BYTES;
    const localExtraStart = localNameStart + localNameLength;
    const dataStart = localExtraStart + localExtraLength;
    if (!hasBytes(centralDirectoryOffset, localNameStart, localNameLength + localExtraLength)) {
      reject("INVALID_ARCHIVE");
    }
    if (!namesEqual(bytes, entry.nameStart, localNameStart, localNameLength)) {
      reject("INVALID_ARCHIVE");
    }
    assertNoZip64Extra(view, localExtraStart, localExtraLength);
    const usesDataDescriptor = (localFlags & 0x0008) !== 0;
    if (usesDataDescriptor) {
      if (
        (localCrc32 !== 0 && localCrc32 !== entry.crc32) ||
        (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize) ||
        (localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize)
      ) {
        reject("INVALID_ARCHIVE");
      }
    } else if (
      localCrc32 !== entry.crc32 || localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize
    ) {
      reject("INVALID_ARCHIVE");
    }
    const dataEnd = dataStart + entry.compressedSize;
    if (!hasBytes(centralDirectoryOffset, dataStart, entry.compressedSize)) {
      reject("INVALID_ARCHIVE");
    }
    const entryEnd = usesDataDescriptor
      ? dataDescriptorEnd(view, dataEnd, centralDirectoryOffset, entry)
      : dataEnd;
    localRanges.push({ start: offset, end: entryEnd });
  }

  localRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index].start < localRanges[index - 1].end) reject("INVALID_ARCHIVE");
  }

  return { entryCount, totalCompressedBytes, totalUncompressedBytes };
}

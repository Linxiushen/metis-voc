export const SECRET_SETTING_KEYS = [
  "spapi_refresh_token",
  "keepa_key",
  "keepamore_api_key",
  "dataforseo_login",
  "dataforseo_password",
] as const;

export type SecretSettingKey = typeof SECRET_SETTING_KEYS[number];
export type SecretSettings = Partial<Record<SecretSettingKey, string>>;

export const SECRET_SETTINGS_ENVELOPE_VERSION = 1 as const;

const SECRET_SETTINGS_ENVELOPE_FORMAT = "metis.secret-settings";
const SECRET_SETTINGS_ENVELOPE_ALGORITHM = "A256GCM";
const SECRET_SETTINGS_IV_BYTES = 12;
const SECRET_SETTINGS_KEY_BYTES = 32;

export type EncryptedSecretSettingsEnvelope = {
  format: typeof SECRET_SETTINGS_ENVELOPE_FORMAT;
  version: typeof SECRET_SETTINGS_ENVELOPE_VERSION;
  algorithm: typeof SECRET_SETTINGS_ENVELOPE_ALGORITHM;
  iv: string;
  ciphertext: string;
};

export class SecretSettingsCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretSettingsCryptoError";
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: unknown, field: string): Uint8Array {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SecretSettingsCryptoError(`${field}格式无效`);
  }
  const paddingLength = (4 - (value.length % 4)) % 4;
  if (paddingLength === 3) throw new SecretSettingsCryptoError(`${field}格式无效`);
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(paddingLength));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new SecretSettingsCryptoError(`${field}格式无效`);
  }
}

function encryptionKeyBytes(encryptionKey: string): Uint8Array {
  if (!encryptionKey) throw new SecretSettingsCryptoError("数据源加密密钥未配置");
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(encryptionKey, "数据源加密密钥");
  } catch {
    throw new SecretSettingsCryptoError("数据源加密密钥必须是 32-byte base64url");
  }
  if (bytes.byteLength !== SECRET_SETTINGS_KEY_BYTES) {
    throw new SecretSettingsCryptoError("数据源加密密钥必须是 32-byte base64url");
  }
  return bytes;
}

function normalizedTenantId(tenantId: number): number {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new SecretSettingsCryptoError("工作区编号无效");
  }
  return tenantId;
}

function envelopeAad(tenantId: number, version: number): Uint8Array {
  return new TextEncoder().encode(
    `${SECRET_SETTINGS_ENVELOPE_FORMAT}|tenant:${normalizedTenantId(tenantId)}|version:${version}`,
  );
}

function parsedStoredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    throw new SecretSettingsCryptoError("已存储的数据源设置格式无效");
  }
}

function looksLikeEncryptedEnvelope(value: unknown): boolean {
  const source = objectValue(value);
  return source.format === SECRET_SETTINGS_ENVELOPE_FORMAT ||
    "ciphertext" in source || "iv" in source || "algorithm" in source;
}

function encryptedEnvelope(value: unknown): EncryptedSecretSettingsEnvelope {
  const source = objectValue(value);
  if (
    source.format !== SECRET_SETTINGS_ENVELOPE_FORMAT ||
    source.version !== SECRET_SETTINGS_ENVELOPE_VERSION ||
    source.algorithm !== SECRET_SETTINGS_ENVELOPE_ALGORITHM ||
    typeof source.iv !== "string" ||
    typeof source.ciphertext !== "string"
  ) {
    throw new SecretSettingsCryptoError("数据源设置密文 envelope 无效或版本不受支持");
  }
  const iv = base64UrlToBytes(source.iv, "数据源设置 IV");
  const ciphertext = base64UrlToBytes(source.ciphertext, "数据源设置密文");
  if (iv.byteLength !== SECRET_SETTINGS_IV_BYTES || ciphertext.byteLength < 16) {
    throw new SecretSettingsCryptoError("数据源设置密文 envelope 无效");
  }
  return source as EncryptedSecretSettingsEnvelope;
}

async function aesKey(encryptionKey: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encryptionKeyBytes(encryptionKey) as BufferSource,
    { name: "AES-GCM" },
    false,
    [usage],
  );
}

export function parseStoredSettings(value: unknown): SecretSettings {
  let parsed: unknown = value;
  if (typeof value === "string" && value) {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }
  const source = objectValue(parsed);
  const result: SecretSettings = {};
  for (const key of SECRET_SETTING_KEYS) {
    const item = typeof source[key] === "string" ? source[key].trim() : "";
    if (item) result[key] = item;
  }
  return result;
}

function shouldClear(
  key: SecretSettingKey,
  incoming: Record<string, unknown>,
  clearValue: unknown,
): boolean {
  const clear = objectValue(clearValue);
  return clear[key] === true || incoming[`${key}_clear`] === true;
}

export function mergeSecretSettings(
  existingValue: unknown,
  incomingValue: unknown,
  clearValue: unknown = undefined,
): SecretSettings {
  const existing = parseStoredSettings(existingValue);
  const incoming = objectValue(incomingValue);
  const merged: SecretSettings = { ...existing };
  for (const key of SECRET_SETTING_KEYS) {
    if (shouldClear(key, incoming, clearValue)) {
      delete merged[key];
      continue;
    }
    if (!(key in incoming)) continue;
    const item = typeof incoming[key] === "string" ? incoming[key].trim() : "";
    // Blank fields are deliberately treated as unchanged. Clearing a stored
    // secret requires the explicit per-key flag above.
    if (!item) continue;
    if (item.length > 4_000) throw new Error(`${key}不能超过 4000 个字符`);
    merged[key] = item;
  }
  return merged;
}

export async function encryptSecretSettings(
  value: unknown,
  tenantId: number,
  encryptionKey: string,
): Promise<EncryptedSecretSettingsEnvelope> {
  const version = SECRET_SETTINGS_ENVELOPE_VERSION;
  const iv = crypto.getRandomValues(new Uint8Array(SECRET_SETTINGS_IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(parseStoredSettings(value)));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: envelopeAad(tenantId, version) as BufferSource,
      tagLength: 128,
    },
    await aesKey(encryptionKey, "encrypt"),
    plaintext,
  );
  return {
    format: SECRET_SETTINGS_ENVELOPE_FORMAT,
    version,
    algorithm: SECRET_SETTINGS_ENVELOPE_ALGORITHM,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function readSecretSettings(
  storedValue: unknown,
  tenantId: number,
  encryptionKey: string,
): Promise<SecretSettings> {
  normalizedTenantId(tenantId);
  encryptionKeyBytes(encryptionKey);
  const parsed = parsedStoredValue(storedValue);
  if (!looksLikeEncryptedEnvelope(parsed)) return parseStoredSettings(parsed);

  const envelope = encryptedEnvelope(parsed);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(envelope.iv, "数据源设置 IV") as BufferSource,
        additionalData: envelopeAad(tenantId, envelope.version) as BufferSource,
        tagLength: 128,
      },
      await aesKey(encryptionKey, "decrypt"),
      base64UrlToBytes(envelope.ciphertext, "数据源设置密文") as BufferSource,
    );
    const decoded = new TextDecoder().decode(plaintext);
    return parseStoredSettings(JSON.parse(decoded));
  } catch (error) {
    if (error instanceof SecretSettingsCryptoError) throw error;
    throw new SecretSettingsCryptoError("数据源设置无法解密");
  }
}

export async function mergeAndEncryptSecretSettings(
  existingValue: unknown,
  incomingValue: unknown,
  clearValue: unknown,
  tenantId: number,
  encryptionKey: string,
): Promise<{ settings: SecretSettings; envelope: EncryptedSecretSettingsEnvelope }> {
  const existing = await readSecretSettings(existingValue, tenantId, encryptionKey);
  const settings = mergeSecretSettings(existing, incomingValue, clearValue);
  return {
    settings,
    envelope: await encryptSecretSettings(settings, tenantId, encryptionKey),
  };
}

function maskedValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "********";
  const suffix = value.slice(-4);
  return `${"*".repeat(Math.min(8, Math.max(4, value.length - suffix.length)))}${suffix}`;
}

export function settingsForClient(value: unknown): Record<string, string | boolean> {
  const settings = parseStoredSettings(value);
  const result: Record<string, string | boolean> = {};
  for (const key of SECRET_SETTING_KEYS) {
    const item = settings[key] || "";
    // Keep legacy input fields blank so older clients remain usable without
    // ever receiving the stored value.
    result[key] = "";
    result[`${key}_configured`] = Boolean(item);
    result[`${key}_masked`] = maskedValue(item);
  }
  return result;
}

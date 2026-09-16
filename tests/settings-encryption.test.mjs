import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const keyFor = (seed) => Buffer.alloc(32, seed).toString("base64url");
let settingsModule;
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
  settingsModule = await server.ssrLoadModule("/lib/settings.ts");
});

after(async () => {
  await server?.close();
});

test("registered Keepa credentials are always treated as server-side secrets", () => {
  assert.ok(settingsModule.SECRET_SETTING_KEYS.includes("keepa_key"));
  assert.ok(settingsModule.SECRET_SETTING_KEYS.includes("keepamore_api_key"));

  const stored = Object.fromEntries(
    settingsModule.SECRET_SETTING_KEYS.map((secretKey, index) => [secretKey, `${secretKey}-sensitive-${index}`]),
  );
  const response = settingsModule.settingsForClient(stored);
  const serialized = JSON.stringify(response);

  for (const [secretKey, secretValue] of Object.entries(stored)) {
    assert.equal(response[secretKey], "");
    assert.equal(response[`${secretKey}_configured`], true);
    assert.equal(serialized.includes(secretValue), false);
  }
});

test("AES-GCM settings envelopes round-trip and use a fresh 12-byte IV", async () => {
  const key = keyFor(7);
  const settings = {
    spapi_refresh_token: "refresh-token-sensitive-1234",
    keepa_key: "keepa-sensitive-5678",
    dataforseo_login: "merchant@example.com",
    dataforseo_password: "password-sensitive-9999",
  };

  const first = await settingsModule.encryptSecretSettings(settings, 42, key);
  const second = await settingsModule.encryptSecretSettings(settings, 42, key);

  assert.equal(first.format, "metis.secret-settings");
  assert.equal(first.version, settingsModule.SECRET_SETTINGS_ENVELOPE_VERSION);
  assert.equal(first.algorithm, "A256GCM");
  assert.equal(Buffer.from(first.iv, "base64url").byteLength, 12);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.doesNotMatch(JSON.stringify(first), /refresh-token-sensitive|keepa-sensitive|password-sensitive/);
  assert.deepEqual(await settingsModule.readSecretSettings(first, 42, key), settings);
  assert.deepEqual(await settingsModule.readSecretSettings(JSON.stringify(first), 42, key), settings);
});

test("settings decryption fails closed for missing, invalid, wrong, or cross-tenant keys", async () => {
  const key = keyFor(11);
  const envelope = await settingsModule.encryptSecretSettings({ keepa_key: "sensitive-key" }, 42, key);
  const tampered = {
    ...envelope,
    ciphertext: `${envelope.ciphertext.slice(0, -1)}${envelope.ciphertext.endsWith("A") ? "B" : "A"}`,
  };

  await assert.rejects(
    settingsModule.readSecretSettings(envelope, 42, ""),
    /加密密钥未配置/,
  );
  await assert.rejects(
    settingsModule.readSecretSettings(envelope, 42, "not-a-32-byte-key"),
    /32-byte base64url/,
  );
  await assert.rejects(
    settingsModule.readSecretSettings(envelope, 42, keyFor(12)),
    /无法解密/,
  );
  await assert.rejects(
    settingsModule.readSecretSettings(envelope, 43, key),
    /无法解密/,
  );
  await assert.rejects(
    settingsModule.readSecretSettings(tampered, 42, key),
    /无法解密/,
  );
});

test("legacy plaintext settings migrate losslessly and persist only as ciphertext", async () => {
  const key = keyFor(21);
  const legacy = JSON.stringify({
    spapi_refresh_token: "legacy-refresh-1234",
    keepa_key: "legacy-keepa-5678",
    dataforseo_password: "legacy-password-9999",
  });

  assert.deepEqual(await settingsModule.readSecretSettings(legacy, 8, key), JSON.parse(legacy));

  const migrated = await settingsModule.mergeAndEncryptSecretSettings(
    legacy,
    { spapi_refresh_token: "", keepa_key: "replacement-0000" },
    { dataforseo_password: true },
    8,
    key,
  );
  assert.deepEqual(migrated.settings, {
    spapi_refresh_token: "legacy-refresh-1234",
    keepa_key: "replacement-0000",
  });
  assert.deepEqual(
    await settingsModule.readSecretSettings(migrated.envelope, 8, key),
    migrated.settings,
  );
  const persisted = JSON.stringify(migrated.envelope);
  assert.doesNotMatch(persisted, /legacy-refresh|replacement-0000|legacy-password/);
  for (const secretKey of settingsModule.SECRET_SETTING_KEYS) {
    assert.equal(Object.hasOwn(migrated.envelope, secretKey), false);
  }
});

test("malformed or unsupported encrypted envelopes never fall back to plaintext", async () => {
  const key = keyFor(31);
  const envelope = await settingsModule.encryptSecretSettings({ keepa_key: "sensitive-key" }, 5, key);

  await assert.rejects(
    settingsModule.readSecretSettings({ ...envelope, version: 2 }, 5, key),
    /envelope 无效或版本不受支持/,
  );
  await assert.rejects(
    settingsModule.readSecretSettings({ ciphertext: envelope.ciphertext }, 5, key),
    /envelope 无效或版本不受支持/,
  );
  await assert.rejects(
    settingsModule.readSecretSettings("not-json", 5, key),
    /已存储的数据源设置格式无效/,
  );
});

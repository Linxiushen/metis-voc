import { database, type AppUser } from "./database";

const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sessionTokenDigest(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(digest)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, rawIterations, saltHex, digestHex] = stored.split("$");
    if (scheme !== "pbkdf2") return false;
    const iterations = Number(rawIterations);
    if (!Number.isInteger(iterations) || iterations < 50_000 || iterations > PASSWORD_ITERATIONS) {
      return false;
    }
    if (!/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{64}$/i.test(digestHex)) return false;
    const actual = await derivePassword(password, hexToBytes(saltHex), iterations);
    const expected = hexToBytes(digestHex);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch {
    return false;
  }
}

export async function createSession(userId: number, tenantId: number): Promise<string> {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenDigest = await sessionTokenDigest(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_SECONDS;
  await database()
    .prepare("INSERT INTO sessions(token, user_id, tenant_id, expires_at) VALUES(?, ?, ?, ?)")
    .bind(tokenDigest, userId, tenantId, expiresAt)
    .run();
  return token;
}

export async function userFromToken(token: string): Promise<AppUser | null> {
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const tokenDigest = await sessionTokenDigest(token);
  const row = await database()
    .prepare(`SELECT u.id, u.tenant_id, u.email, COALESCE(u.name, '') AS name,
      COALESCE(u.role, 'member') AS role, COALESCE(u.status, 'active') AS status,
      COALESCE(t.plan, 'trial') AS plan
      FROM sessions s JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
      JOIN tenants t ON t.id = u.tenant_id
      WHERE s.token = ? AND s.expires_at > ?
        AND COALESCE(u.status, 'active') = 'active'`)
    .bind(tokenDigest, now)
    .first<AppUser>();
  return row ?? null;
}

export async function currentUser(request: Request, tokenOverride = ""): Promise<AppUser | null> {
  const token = tokenOverride || tokenFromRequest(request);
  return userFromToken(token);
}

export function tokenFromRequest(request: Request): string {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{32,128})$/);
  return match?.[1] || "";
}

export async function revokeSession(request: Request): Promise<void> {
  const token = tokenFromRequest(request);
  if (!token) return;
  const tokenDigest = await sessionTokenDigest(token);
  await database().prepare("DELETE FROM sessions WHERE token = ?").bind(tokenDigest).run();
}

import { randomBytes, pbkdf2Sync } from "node:crypto";
import { access, mkdir, open, unlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const exists = async (path) => access(path).then(() => true, (error) => {
  if (error.code === "ENOENT") return false;
  throw error;
});

export function createLocalCredentials(email = "admin@metis.local") {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("Local admin email is invalid.");
  }
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `pbkdf2$100000$${salt}$${pbkdf2Sync(password, Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex")}`;
  return { email: email.toLowerCase(), password, passwordHash, encryptionKey: randomBytes(32).toString("base64url") };
}

export async function setupLocal(directory = projectRoot, email = "admin@metis.local") {
  const envFile = join(directory, ".dev.vars");
  const localDirectory = join(directory, ".local");
  const credentialsFile = join(localDirectory, "admin-credentials.json");
  await mkdir(localDirectory, { recursive: true, mode: 0o700 });
  const lockFile = join(localDirectory, "setup.lock");
  let lock;
  try {
    lock = await open(lockFile, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Another local setup is running, or .local/setup.lock remains after interruption.");
    throw error;
  }
  try {
    if (await exists(envFile)) return { created: false, envFile, credentialsFile: await exists(credentialsFile) ? credentialsFile : null };
    if (await exists(credentialsFile)) {
      throw new Error("Existing admin credentials were preserved. Restore the missing .dev.vars instead of generating a different encryption key.");
    }
    const credentials = createLocalCredentials(email);
    const values = {
      BOOTSTRAP_ADMIN_EMAIL: credentials.email,
      BOOTSTRAP_ADMIN_PASSWORD_HASH: credentials.passwordHash,
      BOOTSTRAP_ADMIN_NAME: "Local administrator",
      SETTINGS_ENCRYPTION_KEY: credentials.encryptionKey,
      PAID_PROVIDER_CALLS_ENABLED: "false",
      ENABLE_EXAMPLE_REPORTS: "false",
      ALLOWED_API_ORIGINS: "",
    };
    // Exclusive creation protects custom configuration even if another process
    // writes it between the initial check and this write.
    await writeFile(credentialsFile, `${JSON.stringify({
      email: credentials.email, password: credentials.password, created_at: new Date().toISOString(),
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await writeFile(envFile,
      "# Local-only generated credentials. Do not commit this file.\n" +
      Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" });
    return { created: true, envFile, credentialsFile };
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--email")) {
    console.error("Usage: node scripts/setup-local.mjs [--email admin@example.com]");
    process.exitCode = 1;
  } else {
    setupLocal(projectRoot, args[1]).then((result) => {
      console.log(result.created ? "Local configuration created." : "Existing local configuration preserved; no values were changed.");
      console.log(`Configuration: ${result.envFile}`);
      if (result.credentialsFile) console.log(`Open this ignored file to read the login credentials: ${result.credentialsFile}`);
      console.log("Start: pnpm dev (local Cloudflare emulation; paid providers disabled by default).");
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}

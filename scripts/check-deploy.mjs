import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export function parseJsonConfig(text, filename = "wrangler.jsonc") {
  const result = ts.parseConfigFileTextToJson(filename, text);
  if (result.error) throw new Error(ts.flattenDiagnosticMessageText(result.error.messageText, "\n"));
  return result.config;
}

const placeholder = (value) => !value || /^(?:0+|-+)$/.test(value.replaceAll("-", "")) ||
  /(?:replace[_ -]?me|your[_ -]|placeholder|example|changeme)/i.test(value);

export function validateDeploymentConfig(config) {
  const errors = [];
  const database = config.d1_databases?.find((item) => item.binding === "DB");
  if (!database || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(database.database_id || "") || placeholder(database.database_id)) {
    errors.push("Set DB.database_id to your provisioned Cloudflare D1 database UUID (the checked-in zero UUID is local-only).");
  }
  if (config.account_id && (placeholder(config.account_id) || !/^[a-f0-9]{32}$/i.test(config.account_id))) {
    errors.push("account_id must be your Cloudflare account ID, or omit it and use Wrangler authentication.");
  }
  const producers = config.queues?.producers || [];
  const consumers = config.queues?.consumers || [];
  for (const binding of ["RESEARCH_QUEUE", "CONCEPT_ARCHIVE_QUEUE"]) {
    const producer = producers.find((item) => item.binding === binding);
    if (!producer || placeholder(producer.queue) || !consumers.some((item) => item.queue === producer.queue)) {
      errors.push(`${binding} needs a named queue with a matching consumer.`);
    }
  }
  for (const bucket of config.r2_buckets || []) {
    if (placeholder(bucket.bucket_name)) errors.push(`${bucket.binding}: replace the placeholder R2 bucket name.`);
  }
  for (const [key, value] of Object.entries(config.vars || {})) {
    if (value && /(?:API_KEY|ACCESS_KEY|SECRET_KEY|PROXY_TOKEN|ENCRYPTION_KEY|PASSWORD_HASH)$/.test(key)) {
      errors.push(`${key} must be configured with wrangler secret put, not committed under vars.`);
    }
  }
  for (const origin of String(config.vars?.ALLOWED_API_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean)) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.origin !== origin || url.hostname.includes("*") ||
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error();
    } catch { errors.push("ALLOWED_API_ORIGINS must contain exact production HTTPS origins without wildcards or paths."); }
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const args = process.argv.slice(2);
  const path = resolve(root, args.length === 2 && args[0] === "--config" ? args[1] : "wrangler.jsonc");
  if (args.length && (args.length !== 2 || args[0] !== "--config")) {
    console.error("Usage: node scripts/check-deploy.mjs [--config wrangler.jsonc]");
    process.exitCode = 1;
  } else {
    readFile(path, "utf8").then((text) => {
      const errors = validateDeploymentConfig(parseJsonConfig(text, path));
      if (errors.length) throw new Error(`Deployment configuration is incomplete:\n${errors.map((error) => `- ${error}`).join("\n")}`);
      console.log("Deployment configuration passed. Wrangler authentication, provisioned queues/DLQs and production secrets are still required.");
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}

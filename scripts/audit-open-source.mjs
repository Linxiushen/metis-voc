#!/usr/bin/env node
/** Release hygiene checks. Findings never contain source excerpts or matched values. */
import { readdir, readFile, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OMIT_DIRS = new Set([".git", "node_modules", ".next", ".vinext", ".wrangler", "dist", "coverage", ".codex-runtime", "outputs", "work", "tmp"]);
// Root-relative build/runtime locations ignored by this project's .gitignore.
// Only archive discovery uses this list; explicit files and tracked Git files
// are always audited, even when they were force-added from these locations.
const ARCHIVE_LOCAL_PATHS = new Set([
  ".local", ".openai", "out", "output", "public/bundle", "public/vendor",
  "research-kit/.venv", "research-kit/data",
]);
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp4", ".mp3", ".woff", ".woff2", ".ttf", ".otf", ".pdf", ".docx", ".xlsx", ".zip", ".gz", ".pyc"]);
const SAMPLE_VALUE = /^(?:\s*|\.{3}|\*+|<[^>]*>|\$\{[^}]+\}|(?:your|replace|example|placeholder|dummy|test|fixture|sample|redacted|fake)(?:[-_ :].*)?)$/i;
const EXPLICIT_TEST_VALUE = /(?:^|[-_ ])(?:test|fixture|dummy|fake|mock|example|unused)(?:[-_ ]|$)/i;
const SAFE_EMAIL_DOMAINS = /^(?:example\.(?:com|net|org)|(?:[^.]+\.)*example|(?:[^.]+\.)*test|metis\.local|localhost|invalid)$/i;

function location(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

/** Scan text without retaining any secret in returned diagnostics. */
export function scanText(file, text) {
  const findings = [];
  const add = (type, severity, offset) => {
    const line = location(text, offset);
    if (!findings.some((item) => item.type === type && item.line === line)) findings.push({ path: file, line, type, severity });
  };
  const match = (regex, type, severity = "error", accept = () => true) => {
    for (const item of text.matchAll(regex)) if (accept(item)) add(type, severity, item.index);
  };
  match(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, "private_key");
  match(/\b(?:sk-|sk_|ak_|km_)[A-Za-z0-9_.-]{24,}\b/g, "provider_key", "error", (m) => !/^(?:sk-|sk_|ak_|km_)(?:test|example|fixture|dummy|fake)[-_]/i.test(m[0]));
  match(/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/g, "cloud_or_source_control_key");
  match(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/g, "embedded_jwt");
  match(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/@:]+:[^\s/@]+@/gi, "credentialed_connection_string", "error", (m) => !/\$\{|<[^>]+>|(?:test|example|localhost)/i.test(m[0]));
  match(/\b([A-Z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET_KEY|ACCESS_TOKEN|REFRESH_TOKEN|PASSWORD_HASH|PROXY_TOKEN|ENCRYPTION_KEY)|apiKey|api_key|accessToken|refreshToken|clientSecret|client_secret|secretKey|passwordHash)["']?[ \t]*[:=][ \t]*(?:\r?\n[ \t]*)?["']([^"'\r\n]+)["']/g, "literal_credential", "error", (m) => {
    const value = m[2].trim();
    if (/^(?:DUMMY|TEST|FIXTURE|EXAMPLE|LOCAL)_/.test(m[1])) return false;
    if (/^(?:tests\/|scripts\/load-baseline)/.test(file) && (EXPLICIT_TEST_VALUE.test(value) || /^[a-z]+-(?:access|secret|token|key)$/.test(value))) return false;
    return value.length >= 12 && !SAMPLE_VALUE.test(value) && !/^(?:process\.env\.|env\.|[A-Z][A-Z0-9_]+$)/.test(value);
  });
  // Environment assignments may be unquoted; empty example values are allowed.
  match(/^(?:export[ \t]+)?[A-Z0-9_]*(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|REFRESH_TOKEN|PASSWORD_HASH|PROXY_TOKEN|ENCRYPTION_KEY)[ \t]*=[ \t]*([^\s#"']+)[ \t]*$/gm, "literal_credential", "error", (m) => !SAMPLE_VALUE.test(m[1]) && m[1].length >= 12);
  match(/[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\s"'<>]+/gi, "personal_absolute_path");
  match(/(?:\/Users\/|\/home\/)[^\s/"'<>]+\//g, "personal_absolute_path", "error", (m) => !/\/(?:user|example|runner|node)\/$/.test(m[0]));
  match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi, "personal_email", "review", (m) => !SAFE_EMAIL_DOMAINS.test(m[1]));
  match(/["'](?:account_id|database_id)["']\s*:\s*["']([A-Za-z0-9-]{20,})["']/g, "production_resource_id", "review", (m) => !SAMPLE_VALUE.test(m[1]) && !/^0+(?:-0+)*$/.test(m[1]));
  match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{24,}\/exec/g, "private_relay_endpoint");
  match(/https:\/\/[a-z0-9.-]+\.(?:workers\.dev|chatgpt\.site)(?:[/?#][^\s"'<>]*)?/gi, "existing_deployment_url", "review", (m) => !/(?:example|your-worker|your-subdomain)/i.test(m[0]));
  match(/https?:\/\/[^\s"'<>]+[?&](?:access_token|api_key|secret|signature|x-amz-signature)=[^&\s"'<>]+/gi, "url_credential");
  // Generic business capabilities are reusable product vocabulary. Flag actual
  // organization identifiers or explicit company revenue, not "logistics" alone.
  if (file !== "scripts/audit-open-source.mjs") match(/(?:\b(?:somle|wampat)\b|公司(?:年)?销售额[\s:：]*[\d０-９]|约?[ ]*8[ ]*亿元?(?:销售|规模))/gi, "organization_specific_context", "review");
  return findings;
}

async function candidateFiles(root) {
  // Audit the distributable tree when Git is initialized at this exact directory.
  try {
    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (path.resolve(gitRoot).toLowerCase() === path.resolve(root).toLowerCase()) {
      return [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean))];
    }
  } catch { /* An extracted source archive is also auditable. */ }
  const files = [];
  async function visit(directory, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (ARCHIVE_LOCAL_PATHS.has(file)) continue;
      if (!relative && (
        /^\.dev\.vars(?:\..*)?$/.test(entry.name) ||
        (/^\.env(?:\..*)?$/.test(entry.name) && entry.name !== ".env.example")
      )) continue;
      if (entry.isDirectory()) {
        if (!OMIT_DIRS.has(entry.name)) await visit(path.join(directory, entry.name), file);
      } else if (entry.isFile() || entry.isSymbolicLink()) files.push(file);
    }
  }
  await visit(root);
  return files;
}

export async function scanRepository(root = ROOT, { files } = {}) {
  const findings = [];
  const candidates = files || await candidateFiles(root);
  for (const rawPath of candidates.sort()) {
    const file = rawPath.replaceAll("\\", "/");
    const absolute = path.resolve(root, file);
    const relative = path.relative(path.resolve(root), absolute);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      findings.push({ path: file, line: 1, type: "path_outside_repository", severity: "error" });
      continue;
    }
    const name = path.basename(file);
    if (/^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/i.test(name) && !/\.(?:example|sample|template)$/i.test(name)) {
      findings.push({ path: file, line: 1, type: "private_environment_file", severity: "error" });
    }
    if (/\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|pyc|log)$/i.test(name) || /(?:^|\/)__pycache__\//.test(file)) {
      findings.push({ path: file, line: 1, type: "private_or_generated_artifact", severity: "error" });
    }
    let data;
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        findings.push({ path: file, line: 1, type: "symlink_requires_review", severity: "review" });
        continue;
      }
      if (!info.isFile()) continue;
      data = await readFile(absolute);
    } catch {
      findings.push({ path: file, line: 1, type: "unreadable_release_file", severity: "error" });
      continue;
    }
    if (/^public\/reports\/.*\.(?:png|jpe?g|webp)$/i.test(file)) {
      findings.push({ path: file, line: 1, type: "report_image_rights_review", severity: "review" });
    }
    if (/^(?:data\/voc_(?:night|drawer|bed)|public\/data\/voc-\d{4}\/)/.test(file) && !isDeclaredSyntheticDataset(data)) {
      findings.push({ path: file, line: 1, type: "third_party_review_dataset_rights_review", severity: "review" });
    }
    if (BINARY_EXTENSIONS.has(path.extname(file).toLowerCase()) || data.includes(0)) continue;
    findings.push(...scanText(file, data.toString("utf8")));
  }
  return { scannedFiles: candidates.length, findings, errors: findings.filter((f) => f.severity === "error").length, reviews: findings.filter((f) => f.severity === "review").length };
}

function isDeclaredSyntheticDataset(data) {
  try {
    const value = JSON.parse(data.toString("utf8"));
    if (value.synthetic !== true || value.source_mode !== "synthetic_fixture") return false;
    const visit = (item, key = "") => {
      if (Array.isArray(item)) return item.every((entry) => visit(entry, key));
      if (item && typeof item === "object") return Object.entries(item).every(([name, entry]) => visit(entry, name));
      if (/^(?:ratingCount|reviewCount|publicReviewUniverse|ratedReviewUniverse)$/.test(key)) return item === 0;
      if (typeof item === "string" && /^https?:\/\//.test(item)) return /^(?:example\.(?:com|net|org)|[^.]+\.test)$/.test(new URL(item).hostname);
      return true;
    };
    return visit(value);
  } catch { return false; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await scanRepository();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.errors || (process.argv.includes("--strict") && report.reviews) ? 1 : 0;
  } catch {
    console.error(JSON.stringify({ type: "audit_failed", severity: "error" }));
    process.exitCode = 1;
  }
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepository, scanText } from "../scripts/audit-open-source.mjs";
import { setupLocal } from "../scripts/setup-local.mjs";

async function temporaryRepository(t) {
  const root = await mkdtemp(join(tmpdir(), "metis-hygiene-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("credential findings disclose location and category but never the matched value", () => {
  const credential = ["sk", "-", "a".repeat(32)].join("");
  const content = `const API_KEY = "${credential}";`;
  const findings = scanText("config.js", content);
  assert.ok(findings.some((f) => f.type === "provider_key" && f.severity === "error"));
  assert.ok(!JSON.stringify(findings).includes(credential));
  assert.ok(findings.every((f) => Object.keys(f).every((key) => ["path", "line", "type", "severity"].includes(key))));
});

test("public API, documentation and marketplace URLs are not private credentials", () => {
  const content = [
    "https://api.deepseek.com/v1",
    "https://www.amazon.com/dp/B000000001",
    "https://github.com/example/project",
    "https://fred.stlouisfed.org/series/MRTSSM4423XUSS",
    "KEEPAMORE_API_KEY=",
    'const apiKey = "your-api-key";',
    "https://your-worker.your-subdomain.workers.dev",
    "author@example.com",
    "admin@metis.local",
  ].join("\n");
  assert.deepEqual(scanText("README.md", content), []);
});

test("empty environment keys cannot consume values from subsequent lines", () => {
  const content = [
    "DEEPSEEK_API_KEY=",
    "DEEPSEEK_BASE_URL=https://api.deepseek.com",
    "QWEN_API_KEY=  ",
    "QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
    "SETTINGS_ENCRYPTION_KEY=",
    "# documentation only",
    'const DUMMY_PASSWORD_HASH =\n  "public-authentication-timing-dummy";',
  ].join("\n");
  assert.deepEqual(scanText(".env.example", content), []);
});

test("generic logistics and design vocabulary is not treated as private company data", () => {
  assert.deepEqual(scanText("docs/workflow.md", "自有物流能力待验证；示例品牌 DNA；公司销售额待填写"), []);
  assert.ok(scanText("docs/company.md", ["公司销售额：", "800000000"].join("")).some((finding) => finding.type === "organization_specific_context"));
});

test("explicit mock credentials are allowed but unmarked values in tests remain checked", () => {
  const mock = 'const KEEPAMORE_API_KEY = "keepamore-queue-test-key";';
  assert.deepEqual(scanText("tests/queue.test.mjs", mock), []);
  const actualShape = ["R", "4tLp9", "Xv2Q", "m8Bc", "u6Zs"].join("");
  assert.ok(scanText("tests/queue.test.mjs", `const API_KEY = "${actualShape}";`).some((f) => f.type === "literal_credential"));
});

test("resource IDs and relay deployments are distinguishable from ordinary links", () => {
  const resource = "a".repeat(32);
  const relay = ["https://script.google.com/macros/s/", "x".repeat(30), "/exec"].join("");
  const findings = scanText("deploy.json", `{"account_id":"${resource}"}\n${relay}`);
  assert.ok(findings.some((f) => f.type === "production_resource_id" && f.line === 1 && f.severity === "review"));
  assert.ok(findings.some((f) => f.type === "private_relay_endpoint" && f.line === 2 && f.severity === "error"));
  assert.ok(!JSON.stringify(findings).includes(resource));
  assert.ok(!JSON.stringify(findings).includes(relay));
});

test("private machine paths and signed URLs are detected without printing values", () => {
  const personalPath = ["C:", "Users", "private-person", "report.pdf"].join("/");
  const signedUrl = ["https://media.example.com/file?", "X-Amz-Signature", "=", "b".repeat(64)].join("");
  const findings = scanText("example.json", `${personalPath}\n${signedUrl}`);
  assert.deepEqual(findings.map((f) => f.type), ["personal_absolute_path", "url_credential"]);
  assert.ok(!JSON.stringify(findings).includes(personalPath));
  assert.ok(!JSON.stringify(findings).includes(signedUrl));
});

test("publishable repository has no high-confidence credentials or private artifacts", async () => {
  const report = await scanRepository(fileURLToPath(new URL("..", import.meta.url)));
  const errors = report.findings.filter((f) => f.severity === "error");
  assert.equal(errors.length, 0, JSON.stringify(errors));
});

test("a configured deployment ID remains a release review item but is not a secret error", async (t) => {
  const root = await temporaryRepository(t);
  await writeFile(join(root, "wrangler.jsonc"), JSON.stringify({ database_id: "1".repeat(32) }));
  const report = await scanRepository(root);
  assert.equal(report.errors, 0);
  assert.equal(report.reviews, 1, "strict release mode still rejects configured resource IDs");
  assert.equal(report.findings[0].type, "production_resource_id");
});

test("ZIP installs remain auditable after setup without hiding explicitly selected private files", async (t) => {
  const root = await temporaryRepository(t);
  await setupLocal(root);
  await writeFile(join(root, ".dev.vars.preview"), await readFile(join(root, ".dev.vars")));
  await writeFile(join(root, ".env.local"), await readFile(join(root, ".dev.vars")));
  await writeFile(join(root, ".env.example"), "KEEPAMORE_API_KEY=\n");
  for (const directory of ["public/vendor", "public/bundle"]) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, "generated.js"), `const API_KEY = "${"b".repeat(32)}";`);
  }
  const installed = await scanRepository(root);
  assert.equal(installed.scannedFiles, 1, "only the public env template is a release source");
  assert.deepEqual(installed.findings, []);

  const explicit = await scanRepository(root, { files: [".dev.vars", ".dev.vars.preview", "public/bundle/generated.js"] });
  assert.ok(explicit.findings.some((finding) => finding.path === ".dev.vars" && finding.type === "private_environment_file" && finding.severity === "error"));
  assert.ok(explicit.findings.some((finding) => finding.path === ".dev.vars.preview" && finding.type === "literal_credential"));
  assert.ok(explicit.findings.some((finding) => finding.path === "public/bundle/generated.js" && finding.type === "literal_credential"));

  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", ".dev.vars"), await readFile(join(root, ".dev.vars")));
  const nested = await scanRepository(root);
  assert.ok(nested.findings.some((finding) => finding.path === "src/.dev.vars" && finding.type === "private_environment_file"), "root-only local exclusions must not hide an unexpected nested secret");
});

test("force-added private environment files remain release errors even when Git ignores them", async (t) => {
  const root = await temporaryRepository(t);
  await setupLocal(root);
  await writeFile(join(root, ".gitignore"), "/.dev.vars\n/.local/\n");
  const git = (args) => execFileSync("git", args, { cwd: root, stdio: "pipe", windowsHide: true });
  git(["init", "--quiet"]);
  git(["add", "--force", ".dev.vars"]);
  const report = await scanRepository(root);
  assert.ok(report.findings.some((finding) => finding.path === ".dev.vars" && finding.type === "private_environment_file" && finding.severity === "error"));
  assert.ok(report.findings.some((finding) => finding.path === ".dev.vars" && finding.type === "literal_credential"));
});

test("bundled review fixtures and public mirrors contain fictional records and zero real reviews", async () => {
  const pairs = [
    ["voc_night_sideboard_2026-08-01.json", "voc-nightstands-sideboard.json"],
    ["voc_drawer_coffee_2026-08-01.json", "voc-drawer-coffee.json"],
    ["voc_bed_market_qa_2026-08-01.json", "voc-bed-market-qa.json"],
  ];
  for (const [local, mirror] of pairs) {
    const fixture = JSON.parse(await readFile(new URL(`../data/${local}`, import.meta.url), "utf8"));
    const publicFixture = JSON.parse(await readFile(new URL(`../public/data/voc-2026/${mirror}`, import.meta.url), "utf8"));
    assert.deepEqual(publicFixture, fixture);
    assert.equal(fixture.synthetic, true);
    assert.equal(fixture.source_mode, "synthetic_fixture");
    assert.equal(fixture.decision_readiness, "insufficient_evidence");
    const sources = fixture.newSlattedPlatformBedVoc || Object.values(fixture.categories).flatMap((category) => Array.isArray(category) ? category : category.sources);
    assert.ok(sources.length > 0);
    for (const source of sources) {
      assert.equal(source.synthetic, true);
      assert.equal(source.ratingCount, 0);
      assert.equal(source.reviewCount, 0);
      assert.equal(new URL(source.url).hostname, "example.com");
      assert.ok(source.signals.every((signal) => signal.synthetic && /虚构样例/.test(signal.paraphrase || signal.evidence)));
    }
  }
});

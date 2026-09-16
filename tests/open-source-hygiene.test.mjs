import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { scanRepository, scanText } from "../scripts/audit-open-source.mjs";

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
  assert.ok(findings.some((f) => f.type === "production_resource_id" && f.line === 1));
  assert.ok(findings.some((f) => f.type === "private_relay_endpoint" && f.line === 2));
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

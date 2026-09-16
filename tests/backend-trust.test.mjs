import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
let reportModule;
let boardReportsModule;
let settingsModule;
let routeSource;
let databaseSource;
let workerSource;
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
  reportModule = await server.ssrLoadModule("/lib/report.ts");
  boardReportsModule = await server.ssrLoadModule("/lib/board-reports.ts");
  settingsModule = await server.ssrLoadModule("/lib/settings.ts");
  routeSource = await readFile(new URL("../app/api/[[...path]]/route.ts", import.meta.url), "utf8");
  databaseSource = await readFile(new URL("../lib/database.ts", import.meta.url), "utf8");
  workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
});

after(async () => {
  await server?.close();
});

for (const category of ["Nightstands", "camping chair"]) {
  test(`generic ${category} report is explicitly non-decision template data`, () => {
    const report = reportModule.buildReport(category, "US");
    const decision = report.modules.exec_summary_decision_scorecard.decision;
    const funnel = report.modules.decision_funnel;

    assert.equal(report.evidence_mode, "template_demo");
    assert.equal(report.decision_readiness, "insufficient_evidence");
    assert.equal(report.verdict, "证据不足");
    assert.match(report.demo_note, /模板演示/);
    assert.match(report.demo_note, /禁止据此/);
    assert.equal(report.concept_generation.eligible, false);
    assert.equal(decision.verdict, "insufficient_evidence");
    assert.match(decision.one_liner, /证据不足/);
    assert.equal(funnel.final.decision, "PENDING");
    assert.equal(funnel.final.score, 0);
    assert.equal(funnel.conversion_pct, 0);
    assert.deepEqual(funnel.raw.cells, []);
    assert.deepEqual(funnel.raw.scenarios, []);
    assert.ok(funnel.gates.every((gate) => gate.status === "PENDING" && gate.pass === false));
    assert.match(reportModule.conceptGenerationBlockReason(report), /禁止启动 Lovart/);
    assert.match(reportModule.conceptGenerationBlockReason(report), /框架演示/);
  });
}

test("partial evidence is distinguished from a template when concept generation is blocked", () => {
  const reason = reportModule.conceptGenerationBlockReason({
    evidence_mode: "partial_verified_research",
    decision_readiness: "insufficient_evidence",
  });
  assert.match(reason, /包含部分实证/);
  assert.doesNotMatch(reason, /模板演示/);
});

test("verified reports remain eligible for concept generation", () => {
  assert.equal(reportModule.conceptGenerationBlockReason({
    evidence_mode: "verified_research",
    decision_readiness: "ready_for_review",
  }), "");
});

test("bundled board report seeds cannot authorize a real decision or concept task", () => {
  assert.equal(boardReportsModule.boardReportSeeds.length, 5);
  for (const seed of boardReportsModule.boardReportSeeds) {
    assert.equal(seed.report.evidence_mode, "synthetic_fixture", seed.slug);
    assert.equal(seed.report.decision_readiness, "insufficient_evidence", seed.slug);
    assert.equal(seed.report.verdict, "证据不足", seed.slug);
    assert.equal(seed.report.concept_generation.eligible, false, seed.slug);
    assert.match(seed.title, /框架演示/, seed.slug);
    assert.match(seed.report.demo_note, /合成样例.*历史报告.*禁止据此/, seed.slug);
    assert.notEqual(reportModule.conceptGenerationBlockReason(seed.report), "", seed.slug);
    assert.match(reportModule.conceptGenerationBlockReason(seed.report), /框架演示/, seed.slug);
    assert.doesNotMatch(reportModule.conceptGenerationBlockReason(seed.report), /部分实证/, seed.slug);
    assert.equal(seed.report.modules.exec_summary_decision_scorecard.decision.verdict, "insufficient_evidence", seed.slug);
    assert.equal(seed.report.modules.decision_funnel.final.decision, "PENDING", seed.slug);
  }
});

test("Lovart creation requires an explicit local admin confirmation", () => {
  const confirmRunSource = routeSource.slice(
    routeSource.indexOf("async function confirmRun"),
    routeSource.indexOf("async function patchRun"),
  );
  const getConceptSource = routeSource.slice(
    routeSource.indexOf("async function getConcept"),
    routeSource.indexOf("async function requireGenerationConfirmation"),
  );
  const localGateSource = routeSource.slice(
    routeSource.indexOf("async function requireGenerationConfirmation"),
    routeSource.indexOf("async function approveConcept"),
  );

  assert.doesNotMatch(confirmRunSource, /startProductConcept/);
  assert.match(getConceptSource, /status:\s*"blocked"/);
  assert.match(getConceptSource, /status:\s*"unavailable"/);
  assert.match(getConceptSource, /generation_available:\s*false/);
  assert.match(getConceptSource, /status:\s*"not_started"/);
  assert.doesNotMatch(getConceptSource, /startProductConcept/);
  assert.match(localGateSource, /requireAdmin\(user\)/);
  assert.match(localGateSource, /body\.confirm_generation\s*!==\s*true/);
  assert.match(localGateSource, /async function startConcept[\s\S]+requireGenerationConfirmation\(request, user\)/);
  assert.match(localGateSource, /async function regenerateConcept[\s\S]+requireGenerationConfirmation\(request, user\)/);
  assert.match(routeSource, /path\[3\]\s*===\s*"start"[\s\S]{0,120}startConcept\(request, user, runId\)/);
  assert.match(routeSource, /path\[3\]\s*===\s*"regenerate"[\s\S]{0,140}regenerateConcept\(request, user, runId\)/);
});

test("Lovart remote confirmation remains a distinct existing-task flow", () => {
  const approveSource = routeSource.slice(
    routeSource.indexOf("async function approveConcept"),
    routeSource.indexOf("async function dispatch"),
  );
  assert.match(approveSource, /concept\.status\s*!==\s*"awaiting_confirmation"/);
  assert.match(approveSource, /requireGenerationConfirmation\(request, user\)/);
  assert.match(approveSource, /expected_concept_updated_at/);
  assert.match(approveSource, /expected_estimated_cost/);
  assert.match(approveSource, /confirmProductConcept\(concept\)/);
});

test("only an R2-backed Lovart artifact can replace the signed-report concept source", () => {
  assert.match(routeSource, /async function adoptConcept/);
  assert.match(routeSource, /conceptAssetForAdoption\(concept, assetIndex\)/);
  assert.match(routeSource, /if \(run\.reviewed\).*先撤销签核/);
  assert.match(routeSource, /expected_report_hash/);
  assert.match(routeSource, /action,[\s\S]+concept_adopted/);
  assert.match(databaseSource, /currentReport\.base_report_version \|\| currentReport\.report_version/);
});

test("Queue redelivery retries a live execution lease instead of acknowledging it", () => {
  assert.match(workerSource, /result\.outcome === "busy"[\s\S]+message\.retry/);
  assert.match(workerSource, /else\s*\{\s*message\.ack\(\)/);
});

test("markdown export puts the template warning before decision metadata", () => {
  const markdown = reportModule.reportToMarkdown(reportModule.buildReport("Nightstands", "US"));
  assert.match(markdown, /^# Nightstands\n\n> \*\*重要提示：\*\*/);
  assert.ok(markdown.indexOf("禁止据此") < markdown.indexOf("- AI 研究建议：证据不足"));
});

test("settings metadata never contains the original secrets", () => {
  const stored = {
    spapi_refresh_token: "refresh-token-sensitive-1234",
    keepa_key: "keepa-sensitive-5678",
  };
  const response = settingsModule.settingsForClient(stored);
  const serialized = JSON.stringify(response);

  assert.equal(response.spapi_refresh_token, "");
  assert.equal(response.spapi_refresh_token_configured, true);
  assert.match(response.spapi_refresh_token_masked, /1234$/);
  assert.equal(response.dataforseo_password_configured, false);
  assert.equal(response.dataforseo_password_masked, "");
  assert.doesNotMatch(serialized, /refresh-token-sensitive|keepa-sensitive/);

  const shortSecret = settingsModule.settingsForClient({ keepa_key: "abc" });
  assert.equal(shortSecret.keepa_key_masked, "********");
  assert.doesNotMatch(JSON.stringify(shortSecret), /abc/);
});

test("blank settings preserve secrets and explicit per-key clear removes them", () => {
  const stored = {
    spapi_refresh_token: "refresh-token-sensitive-1234",
    keepa_key: "keepa-sensitive-5678",
  };
  const preserved = settingsModule.mergeSecretSettings(stored, {
    spapi_refresh_token: "",
    keepa_key: "replacement-9999",
  });
  assert.equal(preserved.spapi_refresh_token, stored.spapi_refresh_token);
  assert.equal(preserved.keepa_key, "replacement-9999");

  const cleared = settingsModule.mergeSecretSettings(
    preserved,
    { spapi_refresh_token: "" },
    { spapi_refresh_token: true },
  );
  assert.equal("spapi_refresh_token" in cleared, false);
  assert.equal(cleared.keepa_key, "replacement-9999");
});

test("settings also accepts explicit inline clear flags", () => {
  const cleared = settingsModule.mergeSecretSettings(
    { dataforseo_password: "sensitive-password" },
    { dataforseo_password_clear: true },
  );
  assert.deepEqual(cleared, {});
});

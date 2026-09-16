import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [routeSource, briefSource] = await Promise.all([
  readFile(new URL("../app/api/[[...path]]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/brief.js", import.meta.url), "utf8"),
]);

test("KeepaMore free export route is bounded, idempotent, auditable, and credit-aware", () => {
  const start = routeSource.indexOf("async function importKeepaMoreResearch");
  const end = routeSource.indexOf("async function getConcept", start);
  assert.ok(start >= 0 && end > start);
  const source = routeSource.slice(start, end);

  assert.match(source, /idempotencyKey\(request, "keepamore-import"\)/);
  assert.match(source, /getRunByRequestKey\(user\.tenant_id, requestKey\)/);
  assert.match(source, /parseContentLength\(request\) > 5_500_000/);
  assert.match(source, /file\.size > 5_000_000/);
  assert.match(source, /parseKeepaMoreExport/);
  assert.match(source, /limits: \{ maxRows: 1_000 \}/);
  assert.match(source, /products\.slice\(0, 1_000\)/);
  assert.match(source, /sourceQueries/);
  assert.match(source, /searchObservationCount/);
  assert.match(source, /buildKeepaMoreReferenceReport/);
  assert.match(source, /rowIssues\.slice\(0, 50\)/);
  assert.match(source, /acquisition: "free_export"/);
  assert.match(source, /source_hash: imported\.sourceHash/);
  assert.match(source, /debitCreditsForRule/);
  assert.match(source, /compensateAcceptedCredit/);
  assert.match(source, /'done'/);
  assert.match(source, /evidence_mode, decision_readiness/);
  assert.doesNotMatch(source, /KEEPAMORE_API_KEY|X-API-Key|createKeepaMoreClient/);
  assert.match(routeSource, /path\[0\] === "keepamore"[\s\S]{0,160}importKeepaMoreResearch\(request, user\)/);
});

test("brief UI imports CSV or XLSX directly into a completed report", () => {
  assert.match(briefSource, /\/api\/keepamore\/import/);
  assert.match(briefSource, /"Idempotency-Key":crypto\.randomUUID\(\)/);
  assert.match(briefSource, /accept="\.csv,\.xlsx"/);
  assert.match(briefSource, /导入猫窝示例数据/);
  assert.match(briefSource, /独立示例入口/);
  assert.match(briefSource, /KeepaMore 免费版美国站猫窝样本/);
  assert.match(briefSource, /go\("#\/run\/"\+body\.id\)/);
});

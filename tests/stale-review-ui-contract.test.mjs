import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const integritySource = readFileSync(new URL("../public/integrity.js", import.meta.url), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source contract: ${startMarker}`);
  return source.slice(start, end);
}

const actionBarSource = sourceBetween(appSource, "function ReportActionBar", "function App");
const runViewSource = sourceBetween(appSource, "function RunView", "function Gate0");

test("the review UI signs the exact report revision shown to the reviewer", () => {
  const finalizeReviewSource = sourceBetween(
    actionBarSource,
    "const finalizeReview",
    "const revokeReview",
  );

  assert.match(finalizeReviewSource, /expected_report_hash\s*:/);
});

test("PDF and file exports send an explicit edition and expected report hash", () => {
  const printSource = sourceBetween(actionBarSource, "const printReport", "const dl");
  const downloadSource = sourceBetween(actionBarSource, "const dl", "const patch");

  assert.match(integritySource, /URLSearchParams\(\{[\s\S]*edition,[\s\S]*expected_report_hash:/);
  assert.match(printSource, /createExportProof\(isSigned\s*\?\s*"signed"\s*:\s*"review",\s*run\.report\)/);
  assert.match(downloadSource, /createExportProof\(isSigned\s*\?\s*"signed"\s*:\s*"review",\s*run\.report\)/);
  assert.match(printSource, /export-check\?/);
  assert.match(downloadSource, /export\.\$\{fmt\}\?/);
});

test("same-run reruns apply the returned report to RunView's independent report state", () => {
  const rerunSource = sourceBetween(actionBarSource, "const rerun", "const del");
  const reportActionRender = runViewSource.match(/<\$\{ReportActionBar\}[^>]+>/)?.[0] || "";
  const callbackMatch = reportActionRender.match(/(setRun|applyRun)=\$\{applyRun\}/);

  assert.ok(callbackMatch, "ReportActionBar must receive RunView.applyRun, not the raw state setter");
  const callbackName = callbackMatch[1];
  assert.match(actionBarSource, new RegExp(`function ReportActionBar\\(\\{\\s*run,\\s*${callbackName}\\s*\\}\\)`));
  assert.match(
    rerunSource,
    new RegExp(`Number\\(r\\.id\\)\\s*===\\s*Number\\(run\\.id\\)[\\s\\S]+${callbackName}\\(r\\)`),
  );
  assert.doesNotMatch(reportActionRender, /setRun=\$\{setRun\}/);
});

test("research confirmation merges compact receipts and fetches a completed report separately", () => {
  const confirmSource = sourceBetween(runViewSource, "async function confirm", "if (phase === \"loading\")");

  assert.match(confirmSource, /const confirmation = await api\(`\/runs\/\$\{id\}\/confirm`/);
  assert.match(confirmSource, /confirmation\.status === "done" && confirmation\.has_report/);
  assert.match(confirmSource, /applyRun\(await api\("\/runs\/" \+ id/);
  assert.match(confirmSource, /applyRun\(run \? \{ \.\.\.run, \.\.\.confirmation \} : confirmation\)/);
  assert.match(confirmSource, /\["queued", "executing"\]\.includes\(confirmation\.status\).*startStream\(\)/);
  assert.doesNotMatch(confirmSource, /applyRun\(confirmation\)/);
});

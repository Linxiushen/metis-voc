import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const reportSource = readFileSync(new URL("../public/report10x.js", import.meta.url), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source contract: ${startMarker}`);
  return source.slice(start, end);
}

const apiSource = sourceBetween(appSource, "async function api", "let runSummaryRequest");
const actionBarSource = sourceBetween(appSource, "function ReportActionBar", "function App");
const runViewSource = sourceBetween(appSource, "function RunView", "function Gate0");
const reportViewSource = sourceBetween(reportSource, "export function ReportView", "function LegacyReportView");
const unavailableSource = sourceBetween(reportSource, "function ReportIntegrityUnavailable", "function ReferenceReportExperience");

test("unavailable reports fail closed before any legacy or reference renderer", () => {
  const unavailableGuard = reportViewSource.indexOf("if(report.report_unavailable===true)");
  const referenceDecision = reportViewSource.indexOf("const isReferenceDeck");
  const legacyRender = reportViewSource.indexOf("LegacyReportView");

  assert.ok(unavailableGuard >= 0 && unavailableGuard < referenceDecision);
  assert.ok(unavailableGuard < legacyRender);
  assert.match(runViewSource, /if \(report\?\.report_unavailable === true\)[\s\S]+onReload=\$\{loadRun\}[\s\S]+onBack=/);
  assert.ok(
    runViewSource.indexOf("report?.report_unavailable === true") <
      runViewSource.indexOf("<${ReportActionBar}"),
    "the integrity page must render without the export action bar",
  );
  assert.match(actionBarSource, /reportUnavailable = run\.report\?\.report_unavailable === true/);
  assert.match(actionBarSource, /isDecisionReady = !reportUnavailable && evidenceState === "review_ready"/);
});

test("the integrity page exposes structural diagnostics, missing blocks, and recovery actions", () => {
  assert.match(unavailableSource, /return html`<section class="empty run-error report-integrity-error"/);
  assert.doesNotMatch(unavailableSource, /return html`<main/);
  assert.match(unavailableSource, /integrity\.errors/);
  assert.match(unavailableSource, /integrity\.missing_required_blocks/);
  assert.match(unavailableSource, /item\?\.code/);
  assert.match(unavailableSource, /item\?\.path/);
  assert.match(unavailableSource, /item\?\.block_id/);
  assert.match(unavailableSource, /系统已禁用签核与全部导出/);
  assert.match(unavailableSource, /onClick=\$\{onReload\}>重新加载报告/);
  assert.match(unavailableSource, /onClick=\$\{onBack\}>返回研究档案/);
});

test("caller cancellation remains AbortError while only the private timeout becomes TimeoutError", () => {
  assert.match(apiSource, /abortRequest\("timeout"\)/);
  assert.match(apiSource, /abortRequest\("caller"\)/);
  assert.match(apiSource, /signal\?\.aborted\) abortFromCaller\(\)/);
  assert.match(apiSource, /error\?\.name === "AbortError" && abortSource === "timeout"/);
  assert.match(apiSource, /timeoutError\.name = "TimeoutError"/);
  assert.doesNotMatch(apiSource, /if \(error\?\.name === "AbortError"\) throw new Error\("请求超时/);
});

test("RunView owns initial, polling, and completion requests by run id and sequence", () => {
  assert.match(runViewSource, /requestSequenceRef = useRef\(0\)/);
  assert.match(runViewSource, /activeRunIdRef = useRef\(String\(id\)\)/);
  assert.match(runViewSource, /function isCurrentRunRequest\(sequence, runId, controller\)/);
  assert.match(runViewSource, /requestSequenceRef\.current === sequence/);
  assert.match(runViewSource, /activeRunIdRef\.current === String\(runId\)/);
  assert.match(runViewSource, /const request = beginRunRequest\(\)/);
  assert.match(runViewSource, /api\("\/runs\/" \+ runId,[\s\S]+signal: controller\.signal/);
  assert.match(runViewSource, /status\.status === "done" && status\.has_report[\s\S]+signal: controller\.signal[\s\S]+isCurrentRunRequest\(sequence, runId, controller\)[\s\S]+applyRun\(completed, sequence, runId\)/);
  assert.match(runViewSource, /requestSequenceRef\.current \+= 1/);
  assert.match(runViewSource, /loadRef\.current\?\.abort\(\)/);
  assert.match(runViewSource, /streamRef\.current\?\.abort\(\)/);
  assert.match(runViewSource, /loadError\?\.name === "AbortError"/);
  assert.match(runViewSource, /streamError\?\.name === "AbortError"/);
});

test("decision controls and the export popup expose complete accessible state", () => {
  assert.match(actionBarSource, /role="group" aria-label="人工决策结果"/);
  assert.match(actionBarSource, /aria-pressed=\$\{String\(run\.decision_outcome===v\)\}/);
  assert.match(actionBarSource, /aria-haspopup="menu"/);
  assert.match(actionBarSource, /aria-expanded=\$\{String\(expOpen\)\}/);
  assert.match(actionBarSource, /aria-controls=\$\{exportMenuId\}/);
  assert.match(actionBarSource, /role="menu" aria-labelledby=/);
  assert.match(actionBarSource, /role="menuitem"/);
  assert.match(actionBarSource, /event\.key !== "Escape"/);
  assert.match(actionBarSource, /exportRootRef\.current\?\.contains\(event\.target\)/);
  assert.match(actionBarSource, /exportButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(actionBarSource, /document\.addEventListener\("pointerdown", onPointerDown, true\)/);
});

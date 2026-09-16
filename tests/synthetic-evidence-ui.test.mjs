import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function functionsBetween(relativePath, startMarker, endMarker, exports, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext(globals);
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.result = { ${exports.join(", ")} };`, context);
  return context.result;
}

const app = functionsBetween("../public/app.js", "const runReport =", "const runDecisionLabel =", [
  "evidenceStateOf", "isReviewableRun", "hasValidSignedDecision", "deriveRunUiState",
], { store: { user: { role: "admin" } } });
const deck = functionsBetween("../public/reference-deck.js", "function reportEvidenceState(", "function applyReviewSemantics(", [
  "reportEvidenceState", "runReviewDecision",
]);

for (const evidenceMode of ["template_demo", "synthetic_fixture"]) {
  test(`${evidenceMode} stays a non-signable demo on both report and dashboard`, () => {
    const report = { evidence_mode: evidenceMode, decision_readiness: "ready_for_review", demo_note: "虚构样例；禁止据此决策" };
    const run = {
      status: "done", report, reviewed: 1, decision_outcome: "进入", outcome_note: "stale fixture signoff",
      reviewer_id: 1, reviewer_name: "Demo", reviewed_at: 1_700_000_000,
      review_report_hash: "a".repeat(64), review_checks: { evidence: true, economics: true, risk: true },
    };
    assert.equal(app.isReviewableRun(run), false);
    assert.equal(app.hasValidSignedDecision(run), false);
    assert.equal(app.evidenceStateOf(run), "template_demo");
    const ui = app.deriveRunUiState(run);
    assert.equal(ui.evidence.label, "框架演示");
    assert.equal(ui.decision.label, "不可签核");
    assert.equal(ui.nextAction, "查看框架演示");
    const review = deck.runReviewDecision(run, report);
    assert.equal(review.reviewed, false);
    assert.equal(review.outcome, "框架演示");
    assert.equal(review.note, report.demo_note);
  });
}

test("explicit verified reports retain the real review gate and partial evidence stays distinct", () => {
  const verified = { evidence_mode: "verified_research", decision_readiness: "ready_for_review" };
  assert.equal(app.isReviewableRun(verified), true);
  assert.equal(deck.reportEvidenceState(verified), "review_ready");
  const partial = { status: "done", report: { evidence_mode: "partial_verified_research", decision_readiness: "insufficient_evidence" } };
  assert.equal(app.deriveRunUiState(partial).evidence.label, "部分实证");
  assert.equal(deck.reportEvidenceState(partial.report), "evidence_blocked");
});

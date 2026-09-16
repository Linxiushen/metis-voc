import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/[[...path]]/route.ts", import.meta.url), "utf8");
const databaseSource = readFileSync(new URL("../lib/database.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const headersSource = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
const researchQueueSource = readFileSync(new URL("../lib/research-queue.ts", import.meta.url), "utf8");
const wranglerSource = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("the research poller revalidates lightweight status responses with ETags", () => {
  assert.match(appSource, /"If-None-Match": ifNoneMatch/);
  assert.match(appSource, /res\.status === 304/);
  assert.match(appSource, /ifNoneMatch: statusEtag/);
  assert.match(appSource, /response\.notModified/);
  assert.match(routeSource, /path\[2\] === "status"[\s\S]{0,500}conditionalNotModified\(request, etag\)/);
  assert.match(workerSource, /Access-Control-Allow-Headers[^\n]+If-None-Match/);
});

test("schema upgrades invalidate legacy reviews in D1 without loading every report into Worker memory", () => {
  assert.doesNotMatch(databaseSource, /SELECT id, tenant_id, report, decision_outcome/);
  assert.doesNotMatch(databaseSource, /signedRows\.results/);
  assert.match(databaseSource, /INSERT INTO review_events\([\s\S]+FROM runs AS legacy_run/);
  assert.match(databaseSource, /UPDATE runs SET reviewed = 0[\s\S]+invalidLegacyReviewWhere/);
});

test("health reports AI research and concept generation as independent capabilities", () => {
  assert.match(routeSource, /conceptArchiveQueueConfigured\(\)/);
  assert.match(routeSource, /concept_archive_queue:/);
  assert.match(routeSource, /ready_for_concept_generation:/);
  assert.match(routeSource, /ready_for_ai_research:\s*readiness\.readyForAiResearch/);
  assert.match(routeSource, /ready_for_concept_generation:\s*readiness\.readyForConceptGeneration/);
  assert.doesNotMatch(routeSource, /const evidencePipelineReady = false/);
  assert.match(routeSource, /buildResearchDataAdapterRegistry\("health-check", "Amazon US"\)/);
  assert.match(routeSource, /id:\s*KEEPAMORE_ADAPTER_ID/);
  assert.match(routeSource, /status:\s*"operational_partial"/);
  assert.match(routeSource, /ready_for_full_evidence_research:/);
  assert.match(routeSource, /pending_adapters:\s*readiness\.pendingEvidenceAdapterIds/);
  assert.match(workerSource, /CONCEPT_ARCHIVE_QUEUE/);
});

test("concept billing fails before provider access when durable image storage is unavailable", () => {
  assert.match(routeSource, /function requireProductImageStorage\(\)/);
  for (const handler of ["startConcept", "regenerateConcept", "approveConcept"]) {
    const start = routeSource.indexOf(`async function ${handler}`);
    assert.ok(start > 0, `${handler} must exist`);
    const body = routeSource.slice(start, start + 900);
    assert.ok(
      body.indexOf("requireProductImageStorage();") < body.indexOf("requirePaidProviderAccess(user);"),
      `${handler} must require durable storage before allowing a billable provider call`,
    );
  }
});

test("the unused SSE route and its unbounded worker stream implementation are absent", () => {
  assert.doesNotMatch(routeSource, /async function streamRun/);
  assert.doesNotMatch(routeSource, /path\[2\] === "stream"/);
  assert.doesNotMatch(routeSource, /text\/event-stream/);
});

test("run summaries read denormalized metadata without parsing report JSON", () => {
  const listSource = databaseSource.slice(
    databaseSource.indexOf("export async function listRuns"),
    databaseSource.indexOf("export async function listArchivedRuns") + 1_500,
  );
  assert.match(listSource, /json_array\(evidence_mode, decision_readiness\) AS report_metadata/);
  assert.doesNotMatch(listSource, /json_valid\(report\)|json_extract\(report/);
  assert.match(databaseSource, /ORDER BY id DESC LIMIT \?/);
  assert.match(databaseSource, /ORDER BY deleted_at DESC, id DESC LIMIT \?/);
  assert.match(routeSource, /RUN_LIST_MAX_LIMIT/);
  assert.match(routeSource, /x-next-cursor/);
});

test("concept polling uses a narrow run gate and never hydrates the report", () => {
  const queryStart = databaseSource.indexOf("export async function getRunConceptGate");
  const queryEnd = databaseSource.indexOf("export async function getRunByRequestKey");
  const querySource = databaseSource.slice(queryStart, queryEnd);
  assert.ok(queryStart > 0 && queryEnd > queryStart);
  assert.match(querySource, /SELECT id, data_scope, evidence_mode, decision_readiness/);
  assert.doesNotMatch(querySource, /SELECT \*|hydrateRun\(|json_extract\(|\breport\b/);

  const handlerStart = routeSource.indexOf("async function getConcept");
  const handlerEnd = routeSource.indexOf("async function requireGenerationConfirmation");
  const handlerSource = routeSource.slice(handlerStart, handlerEnd);
  assert.match(handlerSource, /getRunConceptGate\(runId, user\.tenant_id\)/);
  assert.doesNotMatch(handlerSource, /getRun\(runId|run\.report/);
});

test("report metadata columns are migrated, backfilled, and transactionally synchronized", () => {
  for (const source of [databaseSource, schemaSource]) {
    assert.match(source, /evidence_mode/);
    assert.match(source, /decision_readiness/);
  }
  assert.match(databaseSource, /runs_report_metadata_after_insert[\s\S]+AFTER INSERT ON runs/);
  assert.match(databaseSource, /runs_report_metadata_after_update[\s\S]+AFTER UPDATE OF report ON runs/);
  assert.match(databaseSource, /UPDATE runs SET[\s\S]+evidence_mode = CASE WHEN report IS NOT NULL AND json_valid\(report\)/);
  assert.match(databaseSource, /decision_readiness = CASE WHEN report IS NOT NULL AND json_valid\(report\)/);
});

test("home, sidebar, and palette share one token-scoped run-summary request", () => {
  assert.match(appSource, /function loadRunSummaries\(\)/);
  assert.match(appSource, /runSummaryRequest && runSummaryRequestToken === token/);
  assert.equal((appSource.match(/api\("\/runs"\)/g) || []).length, 1);
  assert.ok((appSource.match(/loadRunSummaries\(\)/g) || []).length >= 4);
});

test("run activity, archive listing, and cleanup have covering indexes", () => {
  for (const source of [databaseSource, schemaSource]) {
    assert.match(source, /runs_tenant_deleted_id_idx/);
    assert.match(source, /runs_tenant_status_deleted_idx/);
    assert.match(source, /runs_status_deleted_updated_idx/);
  }
});

test("research acceptance is idempotently billed and minute-level Queue reconciliation recovers gaps", () => {
  assert.match(routeSource, /businessId: `research:\$\{runId\}:\$\{Math\.round\(now \* 1_000\)\}`/);
  assert.match(researchQueueSource, /export async function reconcileResearchQueue/);
  assert.match(researchQueueSource, /businessId: `research:\$\{run\.id\}:\$\{Math\.round\(claimedAt \* 1_000\)\}`/);
  assert.match(researchQueueSource, /boundedDeliveryAttempt < MAX_RESEARCH_DELIVERY_ATTEMPTS/);
  assert.match(workerSource, /executeResearchJob\(message\.body, message\.attempts\)/);
  assert.match(workerSource, /await reconcileResearchQueue\(\)/);
  assert.match(workerSource, /!isConceptArchiveJob\(message\.body\) && !isResearchJobMessage\(message\.body\)/);
  assert.match(workerSource, /outcome: "invalid_message_acknowledged"/);
  assert.match(wranglerSource, /"crons": \["\* \* \* \* \*"\]/);
});

test("legacy run columns are added before indexes reference them", () => {
  const addColumnAt = databaseSource.indexOf("ALTER TABLE runs ADD COLUMN");
  assert.ok(addColumnAt > 0, "the legacy runs-table upgrade must add missing columns");
  for (const migrationStep of [
    "runs_report_metadata_after_insert",
    "runs_report_metadata_after_update",
    "UPDATE runs SET\n          evidence_mode",
  ]) {
    assert.ok(
      databaseSource.indexOf(migrationStep) > addColumnAt,
      `${migrationStep} must run only after legacy columns are present`,
    );
  }
  for (const indexName of [
    "runs_tenant_deleted_id_idx",
    "runs_tenant_status_deleted_idx",
    "runs_status_deleted_updated_idx",
    "runs_tenant_request_key_unique",
  ]) {
    assert.ok(
      databaseSource.indexOf(indexName) > addColumnAt,
      `${indexName} must be created only after legacy columns are present`,
    );
  }
});

test("only known public concept-image directories override private report caching", () => {
  assert.match(headersSource, /\/reports\/\*\s+Cache-Control: private, no-store/);
  for (const directory of ["examples"]) {
    assert.match(
      headersSource,
      new RegExp(`/${directory}\\/\\*\\s+! Cache-Control\\s+Cache-Control: public, max-age=0, must-revalidate`),
    );
  }
  assert.match(headersSource, /\/data\/\*\s+Cache-Control: private, no-store/);
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const TEST_ENV_KEY = "__METIS_DATABASE_SEED_LIFECYCLE_TEST_ENV__";

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

class SeedLifecycleStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = normalizeSql(sql);
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    const sql = this.sql.toLowerCase();
    if (sql.startsWith("select applied_at from system_migrations")) {
      this.db.state.migrationReads += 1;
      return this.db.state.migrationCompleted
        ? { applied_at: 1_700_000_000 }
        : null;
    }
    if (sql.startsWith("select id, tenant_id from users where role = 'admin'")) {
      return { id: 7, tenant_id: 42 };
    }
    if (sql.startsWith("select id, tenant_id from users where email")) {
      return { id: 7, tenant_id: 42 };
    }
    if (sql.startsWith("select id from users where email")) {
      return { id: 7 };
    }
    if (
      sql.includes("from runs") &&
      sql.includes("where id = ? and tenant_id = ?") &&
      sql.includes("input_mode = 'board_research_2026'")
    ) {
      const [id, tenantId] = this.args;
      this.db.state.candidateReads.set(
        id,
        (this.db.state.candidateReads.get(id) || 0) + 1,
      );
      const run = this.db.state.runs.find((candidate) =>
        candidate.id === id && candidate.tenant_id === tenantId
      );
      return run ? {
        ...structuredClone(run),
        updated_at: Math.round(run.updated_at * 1_000) / 1_000,
      } : null;
    }
    throw new Error(`Unsupported first() SQL: ${this.sql}`);
  }

  async all() {
    const sql = this.sql.toLowerCase();
    if (sql.startsWith("pragma table_info(")) {
      return { results: [] };
    }
    if (sql.includes("from runs") && sql.includes("input_mode = 'board_research_2026'")) {
      assert.match(sql, /order by id desc$/);
      const ordered = [...this.db.state.runs].sort((left, right) => right.id - left.id);
      this.db.state.allReadUpdatedAts = ordered.map((run) =>
        Math.round(run.updated_at * 1_000) / 1_000
      );
      return {
        results: ordered.map((run) => ({
          ...structuredClone(run),
          updated_at: Math.round(run.updated_at * 1_000) / 1_000,
        })),
      };
    }
    throw new Error(`Unsupported all() SQL: ${this.sql}`);
  }

  async run() {
    const sql = this.sql.toLowerCase();
    if (sql.startsWith("create table if not exists system_migrations")) {
      return { meta: { changes: 0 } };
    }
    if (sql.startsWith("update users set name = ?")) {
      this.db.state.adminRepairs += 1;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("insert into system_migrations") && sql.includes("on conflict")) {
      this.db.state.lockClaims += 1;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("update runs set input_payload = ?")) {
      assert.match(sql, /where id = \? and tenant_id = \? and mutation_token is \? and reviewed = \? and deleted_at is null$/);
      assert.doesNotMatch(sql, /where .*updated_at = \?/);
      this.db.state.seedUpdateSql.push(this.sql);
      const [
        inputPayload,
        verdict,
        researchPlan,
        report,
        updatedAt,
        mutationToken,
        id,
        tenantId,
        expectedMutationToken,
        expectedReviewed,
      ] = this.args;
      this.db.state.updateAttempts.set(
        id,
        (this.db.state.updateAttempts.get(id) || 0) + 1,
      );
      const candidate = this.db.state.runs.find((run) =>
        run.id === id && run.tenant_id === tenantId
      );
      const applyRefresh = (run, nextMutationToken) => Object.assign(run, {
        input_payload: inputPayload,
        marketplace: "US",
        view_profile: "P1",
        data_scope: "public_ok",
        status: "done",
        verdict,
        research_plan: researchPlan,
        report,
        reviewed: 0,
        decision_outcome: null,
        outcome_note: null,
        reviewer_id: null,
        reviewer_name: null,
        reviewed_at: null,
        review_checks: null,
        review_report_hash: null,
        error_message: null,
        failed_at: null,
        updated_at: updatedAt,
        mutation_token: nextMutationToken,
      });
      const configuredBehavior = this.db.state.updateBehaviors.get(id);
      const behavior = Array.isArray(configuredBehavior)
        ? configuredBehavior.shift()
        : configuredBehavior;
      if (behavior === "stale-conflict" || behavior === "persistent-stale-conflict") {
        if (candidate) {
          candidate.mutation_token = `competing-stale-token-${this.db.state.updateAttempts.get(id)}`;
        }
        return { meta: { changes: 0 } };
      }
      if (behavior === "concurrent-current") {
        if (candidate) applyRefresh(candidate, "concurrent-worker-token");
        return { meta: { changes: 0 } };
      }
      const run = this.db.state.runs.find((current) =>
        current.id === id &&
        current.tenant_id === tenantId &&
        current.mutation_token === expectedMutationToken &&
        current.reviewed === expectedReviewed &&
        current.deleted_at == null
      );
      if (!run) return { meta: { changes: 0 } };
      applyRefresh(run, mutationToken);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("insert into review_events") && sql.includes("'superseded'")) {
      assert.match(sql, /where exists \(/);
      assert.match(sql, /reviewed = 0 and mutation_token = \?/);
      assert.doesNotMatch(sql, /where exists \([^)]*updated_at = \?/);
      const [
        runId,
        tenantId,
        reviewerId,
        reviewerName,
        decisionOutcome,
        outcomeNote,
        reviewChecks,
        reportHash,
        reportVersion,
        createdAt,
        conditionRunId,
        conditionTenantId,
        expectedMutationToken,
      ] = this.args;
      const postUpdateRun = this.db.state.runs.find((run) =>
        run.id === conditionRunId &&
        run.tenant_id === conditionTenantId &&
        run.reviewed === 0 &&
        run.mutation_token === expectedMutationToken &&
        run.deleted_at == null
      );
      if (!postUpdateRun) {
        return { meta: { changes: 0 } };
      }
      this.db.state.reviewEvents.push({
        run_id: runId,
        tenant_id: tenantId,
        reviewer_id: reviewerId,
        reviewer_name: reviewerName,
        action: "superseded",
        decision_outcome: decisionOutcome,
        outcome_note: outcomeNote,
        review_checks: reviewChecks,
        report_hash: reportHash,
        report_version: reportVersion,
        created_at: createdAt,
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("insert or replace into system_migrations")) {
      this.db.state.migrationCompleted = true;
      return { meta: { changes: 1 } };
    }
    if (
      sql.startsWith("create ") ||
      sql.startsWith("alter ") ||
      sql.startsWith("update ") ||
      sql.startsWith("delete ") ||
      sql.startsWith("insert ")
    ) {
      return { meta: { changes: 0 } };
    }
    throw new Error(`Unsupported run() SQL: ${this.sql}`);
  }
}

class SeedLifecycleD1 {
  constructor(state) {
    this.state = state;
  }

  prepare(sql) {
    return new SeedLifecycleStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

let boardReportSeeds;
let server;
let state;
let moduleCounter = 0;

function makeState() {
  return {
    migrationCompleted: true,
    migrationReads: 0,
    lockClaims: 0,
    adminRepairs: 0,
    seedUpdateSql: [],
    reviewEvents: [],
    candidateReads: new Map(),
    updateAttempts: new Map(),
    updateBehaviors: new Map(),
    allReadUpdatedAts: [],
    runs: boardReportSeeds.map((seed, index) => ({
      id: 101 + index,
      tenant_id: 42,
      user_id: 7,
      title: seed.title,
      input_mode: "board_research_2026",
      input_payload: JSON.stringify({ slug: seed.slug, version: "legacy-board-v1" }),
      marketplace: "US",
      view_profile: "P1",
      data_scope: "public_ok",
      status: "done",
      verdict: "旧结论",
      research_plan: JSON.stringify({ legacy: true }),
      report: JSON.stringify({
        ...structuredClone(seed.report),
        report_version: "legacy-board-v1",
      }),
      decision_outcome: index === 0 ? "approve_with_conditions" : null,
      outcome_note: index === 0 ? "保留原签核意见" : null,
      reviewed: index === 0 ? 1 : 0,
      reviewer_id: index === 0 ? 19 : null,
      reviewer_name: index === 0 ? "原审核人" : null,
      reviewed_at: index === 0 ? 1_700_000_010 : null,
      review_checks: index === 0 ? JSON.stringify({ evidence: true }) : null,
      review_report_hash: index === 0 ? "legacy-report-hash" : null,
      error_message: null,
      failed_at: null,
      deleted_at: null,
      mutation_token: null,
      created_at: 1_600_000_000 + index,
      updated_at: 1_600_000_100.123456 + index,
    })),
  };
}

async function loadDatabaseModule(nextState, label) {
  state = nextState;
  globalThis[TEST_ENV_KEY].DB = new SeedLifecycleD1(state);
  moduleCounter += 1;
  return server.ssrLoadModule(`/lib/database.ts?seed-lifecycle=${label}-${moduleCounter}`);
}

before(async () => {
  globalThis[TEST_ENV_KEY] = { ENABLE_EXAMPLE_REPORTS: "true" };
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
    plugins: [{
      name: "metis-seed-lifecycle-cloudflare-env",
      enforce: "pre",
      resolveId(id) {
        return id === "cloudflare:workers" ? "\0metis-seed-lifecycle-cloudflare-workers" : null;
      },
      load(id) {
        if (id !== "\0metis-seed-lifecycle-cloudflare-workers") return null;
        return `export const env = globalThis[${JSON.stringify(TEST_ENV_KEY)}];`;
      },
    }],
  });

  ({ boardReportSeeds } = await server.ssrLoadModule("/lib/board-reports.ts"));
});

after(async () => {
  await server?.close();
  delete globalThis[TEST_ENV_KEY];
});

test("a completed schema revision takes the cold-start fast path without hydrating board reports", async () => {
  const nextState = makeState();
  nextState.updateBehaviors.set(102, ["stale-conflict"]);
  nextState.updateBehaviors.set(103, ["concurrent-current"]);
  const databaseModule = await loadDatabaseModule(nextState, "retry-and-concurrent-success");
  const originalIds = state.runs.map((run) => run.id);
  const originalCreatedAt = state.runs.map((run) => run.created_at);
  const originalFractionalUpdatedAt = state.runs[0].updated_at;

  await databaseModule.ensureSchema();

  assert.equal(state.migrationReads, 1);
  assert.equal(state.lockClaims, 0, "the completed migration must stay on its fast path");
  assert.equal(state.adminRepairs, 0, "runtime cold starts must not repair bootstrap identities");
  assert.equal(state.runs.length, boardReportSeeds.length);
  assert.deepEqual(state.runs.map((run) => run.id), originalIds);
  assert.deepEqual(state.runs.map((run) => run.created_at), originalCreatedAt);
  assert.notEqual(originalFractionalUpdatedAt, Math.trunc(originalFractionalUpdatedAt));
  assert.deepEqual(state.allReadUpdatedAts, [], "completed revisions do not read giant report rows");
  assert.equal(state.seedUpdateSql.length, 0);
  assert.equal(state.updateAttempts.size, 0);
  assert.equal(state.candidateReads.size, 0);

  for (const seed of boardReportSeeds) {
    const run = state.runs.find((candidate) =>
      JSON.parse(candidate.input_payload).slug === seed.slug
    );
    assert.ok(run, `${seed.slug}: legacy row remains present`);
    assert.equal(JSON.parse(run.input_payload).version, "legacy-board-v1", `${seed.slug}: untouched payload`);
    assert.equal(JSON.parse(run.report).report_version, "legacy-board-v1", `${seed.slug}: untouched report`);
    assert.equal(run.mutation_token, null, `${seed.slug}: no runtime mutation token`);
  }

  assert.equal(state.reviewEvents.length, 0);
});

test("an incomplete schema revision refreshes stale seeds with bounded CAS retries", async () => {
  const nextState = makeState();
  nextState.migrationCompleted = false;
  nextState.updateBehaviors.set(102, ["stale-conflict"]);
  nextState.updateBehaviors.set(103, ["concurrent-current"]);
  const databaseModule = await loadDatabaseModule(nextState, "migration-refresh");
  const originalIds = state.runs.map((run) => run.id);
  const originalCreatedAt = state.runs.map((run) => run.created_at);

  await databaseModule.ensureSchema();

  assert.equal(state.migrationReads, 1);
  assert.equal(state.lockClaims, 1);
  assert.equal(state.migrationCompleted, true);
  assert.equal(state.runs.length, boardReportSeeds.length);
  assert.deepEqual(state.runs.map((run) => run.id), originalIds);
  assert.deepEqual(state.runs.map((run) => run.created_at), originalCreatedAt);
  assert.equal(state.allReadUpdatedAts[0] % 1 > 0, true, "fractional D1 timestamps survive reads");
  assert.equal(state.seedUpdateSql.length, boardReportSeeds.length + 1);
  assert.equal(state.updateAttempts.get(102), 2, "a stale CAS miss is retried after reread");
  assert.equal(state.candidateReads.get(102), 1);
  assert.equal(state.updateAttempts.get(103), 1, "a concurrent current seed needs no second update");
  assert.equal(state.candidateReads.get(103), 1);

  for (const seed of boardReportSeeds) {
    const run = state.runs.find((candidate) =>
      JSON.parse(candidate.input_payload).slug === seed.slug
    );
    assert.ok(run, `${seed.slug}: legacy row remains present`);
    assert.equal(JSON.parse(run.input_payload).version, seed.version, `${seed.slug}: payload version`);
    assert.equal(JSON.parse(run.report).report_version, seed.version, `${seed.slug}: report version`);
    assert.equal(run.reviewed, 0, `${seed.slug}: stale review is cleared`);
    assert.ok(run.mutation_token, `${seed.slug}: refresh is fenced by a mutation token`);
  }

  assert.equal(state.reviewEvents.length, 1);
  assert.deepEqual(
    {
      run_id: state.reviewEvents[0].run_id,
      action: state.reviewEvents[0].action,
      decision_outcome: state.reviewEvents[0].decision_outcome,
      review_checks: state.reviewEvents[0].review_checks,
      report_hash: state.reviewEvents[0].report_hash,
      report_version: state.reviewEvents[0].report_version,
    },
    {
      run_id: 101,
      action: "superseded",
      decision_outcome: "approve_with_conditions",
      review_checks: JSON.stringify({ evidence: true }),
      report_hash: "legacy-report-hash",
      report_version: "legacy-board-v1",
    },
  );
});

test("an incomplete migration surfaces bounded seed CAS conflicts", async () => {
  const nextState = makeState();
  nextState.migrationCompleted = false;
  const target = nextState.runs.at(-1);
  nextState.updateBehaviors.set(target.id, "persistent-stale-conflict");
  const databaseModule = await loadDatabaseModule(nextState, "persistent-conflict");

  await assert.rejects(
    databaseModule.ensureSchema(),
    (error) => {
      assert.equal(error.name, "BoardReportSeedRefreshError");
      assert.equal(error.code, "BOARD_REPORT_SEED_REFRESH_FAILED");
      assert.equal(error.slug, boardReportSeeds.at(-1).slug);
      assert.equal(error.runId, target.id);
      assert.equal(error.attempts, 3);
      assert.equal(error.reason, "conflict_exhausted");
      return true;
    },
  );

  assert.equal(state.updateAttempts.get(target.id), 3);
  assert.equal(state.candidateReads.get(target.id), 3);
  assert.equal(state.migrationCompleted, false);
  assert.equal(JSON.parse(target.input_payload).version, "legacy-board-v1");
});

test("current synthetic seeds remain current during an unfinished migration", async () => {
  const nextState = makeState();
  nextState.migrationCompleted = false;
  nextState.runs.forEach((run, index) => {
    const seed = boardReportSeeds[index];
    run.input_payload = JSON.stringify({ slug: seed.slug, version: seed.version });
    run.report = JSON.stringify(seed.report);
    assert.equal(seed.report.evidence_mode, "synthetic_fixture");
    assert.equal(seed.report.decision_readiness, "insufficient_evidence");
  });
  const databaseModule = await loadDatabaseModule(nextState, "current-synthetic-seeds");
  await databaseModule.ensureSchema();

  assert.equal(state.migrationCompleted, true);
  assert.equal(state.updateAttempts.size, 0, "current demos must not enter a refresh loop");
  assert.equal(state.seedUpdateSql.length, 0);
  assert.equal(state.reviewEvents.length, 0);
  await databaseModule.ensureSchema();
  assert.equal(state.updateAttempts.size, 0, "repeated initialization stays idempotent");
});

test("an incomplete migration refreshes the newest active duplicate slug", async () => {
  const nextState = makeState();
  nextState.migrationCompleted = false;
  const original = nextState.runs[0];
  const latestDuplicate = {
    ...structuredClone(original),
    id: 999,
    reviewed: 0,
    decision_outcome: null,
    outcome_note: null,
    reviewer_id: null,
    reviewer_name: null,
    reviewed_at: null,
    review_checks: null,
    review_report_hash: null,
    updated_at: original.updated_at + 10,
  };
  nextState.runs.push(latestDuplicate);
  const databaseModule = await loadDatabaseModule(nextState, "duplicate-slug");

  await databaseModule.ensureSchema();

  assert.equal(state.updateAttempts.get(999), 1);
  assert.equal(state.updateAttempts.has(original.id), false);
  assert.equal(JSON.parse(latestDuplicate.input_payload).version, boardReportSeeds[0].version);
  assert.equal(JSON.parse(original.input_payload).version, "legacy-board-v1");
});

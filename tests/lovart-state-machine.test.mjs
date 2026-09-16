import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const TEST_ENV_KEY = "__METIS_LOVART_STATE_TEST_ENV__";
const originalFetch = globalThis.fetch;
const ACTIVE_STATUSES = new Set([
  "queued",
  "generating",
  "archiving",
  "awaiting_confirmation",
  "submission_unknown",
  "confirmation_unknown",
]);

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

class MemoryStatement {
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
    this.db.failIfPlanned("first", this.sql);
    const sql = this.sql.toLowerCase();
    if (sql.startsWith("select * from concept_images where id = ?")) {
      const row = this.db.rows.find((item) => item.id === Number(this.args[0]));
      if (row && sql.includes("tenant_id = ?") && row.tenant_id !== Number(this.args[1])) return null;
      if (row && sql.includes("run_id = ?") && row.run_id !== Number(this.args[2])) return null;
      return row ? structuredClone(row) : null;
    }
    if (sql.includes("from concept_images") && sql.includes("order by id desc limit 1")) {
      const [runId, tenantId] = this.args.map(Number);
      const row = this.db.rows
        .filter((item) =>
          item.run_id === runId &&
          item.tenant_id === tenantId &&
          (!sql.includes("status in") || ACTIVE_STATUSES.has(item.status))
        )
        .sort((left, right) => right.id - left.id)[0];
      return row ? structuredClone(row) : null;
    }
    return null;
  }

  async run() {
    this.db.failIfPlanned("run", this.sql);
    const sql = this.sql.toLowerCase();
    if (sql.startsWith("insert into concept_images")) {
      if (sql.includes("where not exists")) {
        const runId = Number(this.args.at(-2));
        const tenantId = Number(this.args.at(-1));
        const active = this.db.rows.some((item) =>
          item.run_id === runId && item.tenant_id === tenantId && ACTIVE_STATUSES.has(item.status)
        );
        if (active) return { meta: { changes: 0 } };
      }
      const id = this.db.nextId++;
      const [
        runId,
        tenantId,
        userId,
        prompt,
        designBrief,
        model,
        projectId,
        publicToken,
        createdAt,
        updatedAt,
      ] = this.args;
      this.db.rows.push({
        id,
        run_id: Number(runId),
        tenant_id: Number(tenantId),
        user_id: Number(userId),
        status: "queued",
        prompt,
        design_brief: designBrief,
        model,
        lovart_project_id: projectId,
        lovart_thread_id: null,
        pending_confirmation: null,
        artifacts: null,
        public_token: publicToken,
        error: null,
        sync_lease_token: null,
        sync_lease_until: null,
        next_poll_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { meta: { changes: 1, last_row_id: id } };
    }

    const update = this.sql.match(/^UPDATE concept_images SET (.+) WHERE id = \?(.*)$/i);
    if (update) {
      const assignments = update[1].split(",").map((value) => value.trim());
      const id = Number(this.args[assignments.length]);
      const row = this.db.rows.find((item) => item.id === id);
      if (!row) return { meta: { changes: 0 } };
      let guardIndex = assignments.length + 1;
      if (/\band tenant_id = \?/i.test(update[2])) {
        if (row.tenant_id !== Number(this.args[guardIndex++])) return { meta: { changes: 0 } };
      }
      if (/\band run_id = \?/i.test(update[2])) {
        if (row.run_id !== Number(this.args[guardIndex++])) return { meta: { changes: 0 } };
      }
      if (/\band status = 'archiving'/i.test(update[2]) && row.status !== "archiving") {
        return { meta: { changes: 0 } };
      }
      if (/\band status = \?/i.test(update[2])) {
        if (row.status !== String(this.args[guardIndex++])) return { meta: { changes: 0 } };
      }
      if (/\band updated_at = \?/i.test(update[2])) {
        if (row.updated_at !== this.args[guardIndex++]) return { meta: { changes: 0 } };
      }
      if (/\band pending_confirmation = \?/i.test(update[2])) {
        if (row.pending_confirmation !== this.args[guardIndex++]) return { meta: { changes: 0 } };
      }
      if (/\band sync_lease_token = \?/i.test(update[2])) {
        if (row.sync_lease_token !== this.args[guardIndex++]) return { meta: { changes: 0 } };
      }
      if (/sync_lease_until is null or sync_lease_until <= \?/i.test(update[2])) {
        const now = Number(this.args[guardIndex++]);
        if (row.sync_lease_until != null && Number(row.sync_lease_until) > now) {
          return { meta: { changes: 0 } };
        }
      }
      if (/next_poll_at is null or next_poll_at <= \?/i.test(update[2])) {
        const now = Number(this.args[guardIndex++]);
        if (typeof row.next_poll_at === "number" && row.next_poll_at > now) {
          return { meta: { changes: 0 } };
        }
      }
      assignments.forEach((assignment, index) => {
        const match = assignment.match(/^(\w+) = \?$/);
        assert.ok(match, `unsupported concept assignment: ${assignment}`);
        row[match[1]] = this.args[index];
      });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }
}

class MemoryD1 {
  constructor() {
    this.rows = [];
    this.nextId = 1;
    this.failures = [];
  }

  failNext(operation, matcher, message = "injected D1 failure") {
    this.failures.push({ operation, matcher, message });
  }

  failIfPlanned(operation, sql) {
    const index = this.failures.findIndex((failure) =>
      failure.operation === operation && failure.matcher(sql)
    );
    if (index < 0) return;
    const [failure] = this.failures.splice(index, 1);
    throw new Error(failure.message);
  }

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function conceptRow(overrides = {}) {
  return {
    id: 1,
    run_id: 101,
    tenant_id: 42,
    user_id: 7,
    status: "generating",
    prompt: "design prompt",
    design_brief: JSON.stringify({ category: "Nightstands" }),
    model: "test-image-model",
    lovart_project_id: "project-fixed",
    lovart_thread_id: "thread-1",
    pending_confirmation: null,
    artifacts: null,
    public_token: "a".repeat(32),
    error: null,
    sync_lease_token: null,
    sync_lease_until: null,
    next_poll_at: null,
    created_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
    ...overrides,
  };
}

function hydrated(row) {
  return {
    ...structuredClone(row),
    design_brief: JSON.parse(row.design_brief),
    pending_confirmation: row.pending_confirmation ? JSON.parse(row.pending_confirmation) : null,
    artifacts: row.artifacts ? JSON.parse(row.artifacts) : null,
  };
}

function completedRun(id, category) {
  return {
    id,
    tenant_id: 42,
    user_id: 7,
    title: `${category} 选品报告`,
    input_mode: "board_research_2026",
    input_payload: {},
    marketplace: "US",
    view_profile: "P1",
    data_scope: "public_ok",
    status: "done",
    report: {
      category,
      marketplace: "Amazon US",
      evidence_mode: "verified_research",
      decision_readiness: "ready_for_review",
      modules: {},
    },
    created_at: 1,
    updated_at: 1,
  };
}

const adminUser = {
  id: 7,
  tenant_id: 42,
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
};

let db;
let lovart;
let server;
let archiveJobs;
let r2Objects;

before(async () => {
  db = new MemoryD1();
  archiveJobs = [];
  r2Objects = new Map();
  globalThis[TEST_ENV_KEY] = {
    DB: db,
    LOVART_ACCESS_KEY: "test-access",
    LOVART_SECRET_KEY: "test-secret",
    LOVART_BASE_URL: "https://lovart.test",
    LOVART_PROJECT_ID: "project-fixed",
    LOVART_IMAGE_MODEL: "test-image-model",
    CONCEPT_ARCHIVE_QUEUE: {
      send: async (message) => archiveJobs.push(structuredClone(message)),
    },
    PRODUCT_IMAGES: {
      put: async (key, bytes, options) => {
        r2Objects.set(key, {
          bytes: new Uint8Array(bytes),
          customMetadata: structuredClone(options.customMetadata),
          httpMetadata: structuredClone(options.httpMetadata),
        });
      },
      head: async (key) => {
        const object = r2Objects.get(key);
        return object ? {
          size: object.bytes.byteLength,
          customMetadata: object.customMetadata,
          httpMetadata: object.httpMetadata,
        } : null;
      },
    },
  };
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    resolve: { alias: { "@": root } },
    plugins: [{
      name: "metis-lovart-test-cloudflare-env",
      enforce: "pre",
      resolveId(id) {
        return id === "cloudflare:workers" ? "\0metis-lovart-test-workers" : null;
      },
      load(id) {
        if (id !== "\0metis-lovart-test-workers") return null;
        return `export const env = globalThis[${JSON.stringify(TEST_ENV_KEY)}];`;
      },
    }],
  });
  lovart = await server.ssrLoadModule("/lib/lovart.ts");
});

beforeEach(() => {
  db.rows = [];
  db.nextId = 1;
  db.failures = [];
  archiveJobs.length = 0;
  r2Objects.clear();
  globalThis.fetch = originalFetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
  delete globalThis[TEST_ENV_KEY];
});

test("a v3 product brief submits a geometry-locked six-scene master-first prompt", async () => {
  const roles = [
    "hero_master",
    "primary_lifestyle",
    "secondary_lifestyle",
    "functional_open_state",
    "detail_cmf",
    "packaging_logistics",
  ];
  const run = completedRun(301, "Slatted platform bed");
  const brief = lovart.buildProductConceptBrief(run.report, run.title);

  assert.equal(brief.brief_version, "metis-product-concept-v3-scene-suite");
  assert.equal(brief.design_dna.version, "metis-design-dna-v3");
  assert.match(brief.design_dna.id, /-v3$/);
  assert.equal(brief.scene_suite.version, "metis-scene-suite-v1");
  assert.equal(brief.scene_suite.design_dna_id, brief.design_dna.id);
  assert.equal(brief.scene_suite.expected_asset_count, 6);
  assert.equal(brief.scene_suite.max_asset_count, 6);
  assert.deepEqual(brief.scene_suite.slots.map((slot) => slot.role), roles);
  assert.deepEqual(brief.scene_suite.slots.map((slot) => slot.sequence), [1, 2, 3, 4, 5, 6]);
  assert.ok(brief.scene_suite.slots.every((slot) => slot.required === true));

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse(200, { code: 0, data: { thread_id: "thread-six-scene" } });
  };
  const concept = await lovart.startProductConcept(run, adminUser);
  assert.equal(concept.status, "generating");
  assert.equal(calls.length, 1);
  const submitted = JSON.parse(calls[0].init.body);
  assert.equal(submitted.mode, "thinking");
  assert.match(submitted.prompt, /必须先完成第 1 张 hero_master/);
  assert.match(submitted.prompt, /Master 自检通过前，不得开始第 2—6 张/);
  assert.match(submitted.prompt, /不要输出第 7 张图片/);
  assert.ok(
    submitted.prompt.indexOf("1. hero_master") < submitted.prompt.indexOf("2. primary_lifestyle"),
    "the master scene must precede all derived scenes",
  );
});

test("Lovart results are capped at six and retain the complete scene role contract", async () => {
  const brief = lovart.buildProductConceptBrief(
    completedRun(302, "Coffee bar counter").report,
    "Coffee bar counter 选品报告",
  );
  const row = conceptRow({
    run_id: 302,
    design_brief: JSON.stringify(brief),
  });
  db.rows.push(row);
  globalThis.fetch = async (url) => {
    if (String(url).includes("/chat/status")) {
      return jsonResponse(200, { code: 0, data: { status: "done" } });
    }
    return jsonResponse(200, {
      code: 0,
      data: {
        items: [{
          artifacts: Array.from({ length: 8 }, (_, index) => ({
            type: "image",
            content: `https://cdn.example.test/scene-${index + 1}.png`,
          })),
        }],
      },
    });
  };

  const result = await lovart.syncProductConcept(hydrated(row));
  assert.equal(result.status, "archiving");
  assert.equal(result.artifacts.length, 6);
  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.role),
    brief.scene_suite.slots.map((slot) => slot.role),
  );
  assert.deepEqual(result.artifacts.map((artifact) => artifact.sequence), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.title),
    brief.scene_suite.slots.map((slot) => slot.title),
  );
  assert.ok(result.artifacts.every((artifact) => artifact.required === true));
  assert.ok(result.artifacts.every((artifact) => artifact.role_assignment === "positional_unverified"));
  assert.equal(result.artifacts.some((artifact) => /scene-7/.test(artifact.source_url)), false);

  const client = lovart.conceptForClient(result, "https://metis.example.test");
  assert.equal(client.assets.length, 6);
  assert.equal(client.design_dna.id, brief.design_dna.id);
  assert.equal(client.scene_suite.version, "metis-scene-suite-v1");
  assert.equal(client.scene_suite.expected_asset_count, 6);
  assert.equal(client.scene_suite.required_asset_count, 6);
  assert.equal(client.scene_suite.completed_required_count, 6);
  assert.equal(client.scene_suite.is_complete, true);
  assert.equal(client.scene_suite.consistency_status, "pending_human_review");
  assert.equal(client.scene_suite.legacy_record, false);
  assert.ok(client.scene_suite.slots.every((slot) => slot.available === true));
  assert.deepEqual(
    client.assets.map((asset) => asset.role_assignment),
    Array(6).fill("positional_unverified"),
  );
});

test("legacy concept records remain readable without masquerading as a complete suite", () => {
  const artifacts = Array.from({ length: 8 }, (_, index) => ({
    type: "image",
    source_url: `https://cdn.example.test/legacy-${index + 1}.png`,
  }));
  const client = lovart.conceptForClient(hydrated(conceptRow({
    status: "done",
    design_brief: JSON.stringify({ category: "Nightstands" }),
    artifacts: JSON.stringify(artifacts),
  })));

  assert.equal(client.assets.length, 6);
  assert.equal(client.assets[0].role, "hero_master");
  assert.equal(client.assets[0].required, true);
  assert.ok(client.assets.slice(1).every((asset) => asset.role === "legacy_alternate"));
  assert.ok(client.assets.every((asset) => asset.role_assignment === "legacy_unassigned"));
  assert.equal(client.design_dna, null);
  assert.equal(client.scene_suite.version, "legacy-unversioned");
  assert.equal(client.scene_suite.expected_asset_count, 6);
  assert.equal(client.scene_suite.required_asset_count, 6);
  assert.equal(client.scene_suite.completed_required_count, 0);
  assert.equal(client.scene_suite.is_complete, false);
  assert.equal(client.scene_suite.consistency_status, "legacy_unverified");
  assert.equal(client.scene_suite.legacy_record, true);
  assert.deepEqual(client.scene_suite.slots, []);
});

test("an uncertain chat submission is retained and never submitted twice automatically", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse(503, { message: "gateway unavailable" });
  };

  const run = {
    id: 101,
    tenant_id: 42,
    user_id: 7,
    title: "Nightstands 选品报告",
    input_mode: "board_research_2026",
    input_payload: {},
    marketplace: "US",
    view_profile: "P1",
    data_scope: "public_ok",
    status: "done",
    report: {
      category: "Nightstands",
      marketplace: "Amazon US",
      evidence_mode: "verified_research",
      decision_readiness: "ready_for_review",
      modules: {},
    },
    created_at: 1,
    updated_at: 1,
  };
  const user = { id: 7, tenant_id: 42, email: "admin@example.com", name: "Admin", role: "admin" };

  const concept = await lovart.startProductConcept(run, user);
  assert.equal(concept.status, "submission_unknown");
  assert.match(concept.error, /不会自动重新提交/);
  assert.equal(calls.length, 1);
  assert.equal(
    new Headers(calls[0].init.headers).get("idempotency-key"),
    `metis-chat-${concept.public_token}`,
  );

  const sameConcept = await lovart.startProductConcept(run, user);
  assert.equal(sameConcept.id, concept.id);
  assert.equal(sameConcept.status, "submission_unknown");
  assert.equal(calls.length, 1);
});

test("a direct response-body failure after submission remains unknown instead of billable retryable failure", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"code":0,"data":'));
        controller.error(new Error("upstream body disconnected"));
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const run = {
    id: 102,
    tenant_id: 42,
    user_id: 7,
    title: "Drawer cabinet 选品报告",
    input_mode: "board_research_2026",
    input_payload: {},
    marketplace: "US",
    view_profile: "P1",
    data_scope: "public_ok",
    status: "done",
    report: {
      category: "Drawer cabinet",
      evidence_mode: "verified_research",
      decision_readiness: "ready_for_review",
      modules: {},
    },
    created_at: 1,
    updated_at: 1,
  };
  const user = { id: 7, tenant_id: 42, email: "admin@example.com", name: "Admin", role: "admin" };

  const concept = await lovart.startProductConcept(run, user);
  assert.equal(concept.status, "submission_unknown");
  assert.match(concept.error, /不会自动重新提交/);
  assert.equal(calls.length, 1);
});

test("a direct confirmation response-body timeout remains confirmation_unknown and posts once", async () => {
  const row = conceptRow({
    status: "awaiting_confirmation",
    pending_confirmation: JSON.stringify({ credits: 8 }),
  });
  db.rows.push(row);
  const calls = [];
  const nativeSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
    callback,
    delay === 30_000 ? 1 : delay,
    ...args,
  );
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(new ReadableStream({
      start(controller) {
        const watchdog = nativeSetTimeout(
          () => controller.error(new Error("test watchdog: confirmation request did not abort")),
          1_000,
        );
        const abort = () => {
          clearTimeout(watchdog);
          controller.error(new DOMException("timed out", "AbortError"));
        };
        if (init.signal.aborted) abort();
        else init.signal.addEventListener("abort", abort, { once: true });
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const concept = await lovart.confirmProductConcept(hydrated(row));
    assert.equal(concept.status, "confirmation_unknown");
    assert.match(concept.error, /不会重复提交确认/);
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
  }
  assert.equal(calls.filter((call) => call.init.method === "POST").length, 1);
});

test("a chunked direct response over 1MB is cancelled and remains submission_unknown", async () => {
  const calls = [];
  let cancelReason = "";
  let closeTimer;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(400_001));
        closeTimer = setTimeout(() => controller.close(), 1_000);
      },
      cancel(reason) {
        clearTimeout(closeTimer);
        cancelReason = String(reason);
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const run = {
    id: 103,
    tenant_id: 42,
    user_id: 7,
    title: "Oversized response 选品报告",
    input_mode: "board_research_2026",
    input_payload: {},
    marketplace: "US",
    view_profile: "P1",
    data_scope: "public_ok",
    status: "done",
    report: {
      category: "Oversized response",
      evidence_mode: "verified_research",
      decision_readiness: "ready_for_review",
      modules: {},
    },
    created_at: 1,
    updated_at: 1,
  };
  const user = { id: 7, tenant_id: 42, email: "admin@example.com", name: "Admin", role: "admin" };

  const concept = await lovart.startProductConcept(run, user);
  assert.equal(concept.status, "submission_unknown");
  assert.equal(cancelReason, "response too large");
  assert.equal(calls.filter((call) => call.init.method === "POST").length, 1);
});

test("a successful chat with a failed D1 settlement stays unknown and recovers with GETs only", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    db.failNext("run", (sql) => {
      const normalized = sql.toLowerCase();
      return normalized.startsWith("update concept_images set status = ?") &&
        normalized.includes("lovart_thread_id = ?");
    });
    return jsonResponse(200, { code: 0, data: { thread_id: "thread-d1-settlement" } });
  };

  const run = completedRun(104, "D1 settlement");
  const concept = await lovart.startProductConcept(run, adminUser);
  assert.equal(concept.status, "submission_unknown");
  assert.equal(concept.lovart_thread_id, "thread-d1-settlement");
  assert.equal(db.rows[0].status, "submission_unknown");
  assert.equal(db.rows[0].lovart_thread_id, "thread-d1-settlement");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);

  const sameConcept = await lovart.startProductConcept(run, adminUser, true);
  assert.equal(sameConcept.id, concept.id);
  assert.equal(db.rows.length, 1);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);

  db.rows[0].next_poll_at = Date.now() / 1000 - 1;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).includes("/chat/status")) {
      return jsonResponse(200, { code: 0, data: { status: "running" } });
    }
    return jsonResponse(200, { code: 0, data: { items: [] } });
  };
  const reconciled = await lovart.syncProductConcept(hydrated(db.rows[0]));
  assert.equal(reconciled.status, "generating");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(calls.filter((call) => call.method === "GET").length, 2);
});

test("a committed chat settlement with a failed D1 read is never overwritten as failed", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    db.failNext("first", (sql) =>
      sql.toLowerCase().startsWith("select * from concept_images where id = ?")
    );
    return jsonResponse(200, { code: 0, data: { thread_id: "thread-d1-read" } });
  };

  const run = completedRun(105, "D1 read settlement");
  const concept = await lovart.startProductConcept(run, adminUser);
  assert.equal(concept.status, "generating");
  assert.equal(db.rows[0].status, "generating");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);

  const sameConcept = await lovart.startProductConcept(run, adminUser, true);
  assert.equal(sameConcept.id, concept.id);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("a create preclaim D1 failure issues no Lovart POST", async () => {
  db.failNext("run", (sql) => {
    const normalized = sql.toLowerCase();
    return normalized.startsWith("update concept_images set status = ?, model = ?") &&
      normalized.includes("and status = ? and updated_at = ?");
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(200, { code: 0, data: { thread_id: "must-not-submit" } });
  };

  await assert.rejects(
    lovart.startProductConcept(completedRun(106, "Create preclaim"), adminUser),
    /injected D1 failure/,
  );
  assert.equal(calls, 0);
  assert.equal(db.rows[0].status, "queued");
});

test("a successful paid confirmation with a failed D1 settlement stays unknown and recovers with GETs only", async () => {
  const row = conceptRow({
    status: "awaiting_confirmation",
    pending_confirmation: JSON.stringify({ credits: 8 }),
  });
  db.rows.push(row);
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    db.failNext("run", (sql) => {
      const normalized = sql.toLowerCase();
      return normalized.startsWith("update concept_images set status = ?, pending_confirmation = ?") &&
        normalized.includes("and status = ?");
    });
    return jsonResponse(200, { code: 0, data: {} });
  };

  const concept = await lovart.confirmProductConcept(hydrated(row));
  assert.equal(concept.status, "confirmation_unknown");
  assert.deepEqual(concept.pending_confirmation, { credits: 8 });
  assert.equal(db.rows[0].status, "confirmation_unknown");
  assert.equal(db.rows[0].pending_confirmation, JSON.stringify({ credits: 8 }));
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);

  const unchanged = await lovart.confirmProductConcept(concept);
  assert.equal(unchanged.status, "confirmation_unknown");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);

  db.rows[0].next_poll_at = Date.now() / 1000 - 1;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).includes("/chat/status")) {
      return jsonResponse(200, { code: 0, data: { status: "running" } });
    }
    return jsonResponse(200, { code: 0, data: { items: [] } });
  };
  const reconciled = await lovart.syncProductConcept(hydrated(db.rows[0]));
  assert.equal(reconciled.status, "generating");
  assert.equal(reconciled.pending_confirmation, null);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(calls.filter((call) => call.method === "GET").length, 2);
});

test("a paid-confirmation preclaim D1 failure issues no Lovart POST", async () => {
  const row = conceptRow({
    status: "awaiting_confirmation",
    pending_confirmation: JSON.stringify({ credits: 8 }),
  });
  db.rows.push(row);
  db.failNext("run", (sql) => {
    const normalized = sql.toLowerCase();
    return normalized.startsWith("update concept_images set status = ?, next_poll_at = ?, error = ?") &&
      normalized.includes("and updated_at = ? and pending_confirmation = ?");
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(200, { code: 0, data: {} });
  };

  await assert.rejects(
    lovart.confirmProductConcept(hydrated(row)),
    /injected D1 failure/,
  );
  assert.equal(calls, 0);
  assert.equal(db.rows[0].status, "awaiting_confirmation");
});

test("concurrent initial starts atomically create and submit one concept task", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return jsonResponse(200, { code: 0, data: { thread_id: "thread-concurrent-start" } });
  };
  const run = {
    id: 201,
    tenant_id: 42,
    user_id: 7,
    title: "Sideboard 选品报告",
    input_mode: "board_research_2026",
    input_payload: {},
    marketplace: "US",
    view_profile: "P1",
    data_scope: "public_ok",
    status: "done",
    report: {
      category: "Sideboard",
      evidence_mode: "verified_research",
      decision_readiness: "ready_for_review",
      modules: {},
    },
    created_at: 1,
    updated_at: 1,
  };
  const user = { id: 7, tenant_id: 42, email: "admin@example.com", name: "Admin", role: "admin" };

  const [left, right] = await Promise.all([
    lovart.startProductConcept(run, user),
    lovart.startProductConcept(run, user),
  ]);
  assert.equal(left.id, right.id);
  assert.equal(db.rows.length, 1);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("concurrent regenerations atomically create and submit one replacement task", async () => {
  const failed = conceptRow({
    id: 1,
    run_id: 202,
    status: "failed",
    lovart_thread_id: null,
  });
  db.rows.push(failed);
  db.nextId = 2;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return jsonResponse(200, { code: 0, data: { thread_id: "thread-concurrent-regenerate" } });
  };
  const run = {
    id: 202,
    tenant_id: 42,
    user_id: 7,
    title: "Coffee bar counter 选品报告",
    input_mode: "board_research_2026",
    input_payload: {},
    marketplace: "US",
    view_profile: "P1",
    data_scope: "public_ok",
    status: "done",
    report: {
      category: "Coffee bar counter",
      evidence_mode: "verified_research",
      decision_readiness: "ready_for_review",
      modules: {},
    },
    created_at: 1,
    updated_at: 1,
  };
  const user = { id: 7, tenant_id: 42, email: "admin@example.com", name: "Admin", role: "admin" };

  const [left, right] = await Promise.all([
    lovart.startProductConcept(run, user, true),
    lovart.startProductConcept(run, user, true),
  ]);
  assert.equal(left.id, right.id);
  assert.equal(db.rows.length, 2);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("concurrent paid confirmations use CAS and issue one remote POST", async () => {
  const row = conceptRow({
    status: "awaiting_confirmation",
    pending_confirmation: JSON.stringify({ credits: 8 }),
  });
  db.rows.push(row);
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return jsonResponse(200, { code: 0, data: {} });
  };
  const record = hydrated(row);

  await Promise.all([
    lovart.confirmProductConcept(record),
    lovart.confirmProductConcept(record),
  ]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(db.rows[0].status, "generating");
});

test("a changed Lovart quote loses the confirmation CAS before any remote POST", async () => {
  const row = conceptRow({
    status: "awaiting_confirmation",
    pending_confirmation: JSON.stringify({ credits: 8 }),
  });
  db.rows.push(row);
  const staleRecord = hydrated(row);
  row.pending_confirmation = JSON.stringify({ credits: 12 });
  row.updated_at += 1;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return jsonResponse(200, { code: 0, data: {} });
  };

  const result = await lovart.confirmProductConcept(staleRecord);
  assert.equal(result.status, "awaiting_confirmation");
  assert.equal(calls.length, 0);
  assert.equal(db.rows[0].pending_confirmation, JSON.stringify({ credits: 12 }));
});

test("an uncertain paid confirmation is reconciled with GETs and never POSTed twice", async () => {
  const row = conceptRow({
    status: "awaiting_confirmation",
    pending_confirmation: JSON.stringify({ credits: 8 }),
  });
  db.rows.push(row);
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return jsonResponse(503, { message: "timeout after submit" });
  };

  const confirmStartedAt = Date.now() / 1000;
  const uncertain = await lovart.confirmProductConcept(hydrated(row));
  assert.equal(uncertain.status, "confirmation_unknown");
  assert.deepEqual(uncertain.pending_confirmation, { credits: 8 });
  assert.ok(uncertain.next_poll_at >= confirmStartedAt + 30);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);

  const elapsedPollAt = Date.now() / 1000 - 1;
  uncertain.next_poll_at = elapsedPollAt;
  row.next_poll_at = elapsedPollAt;

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).includes("/chat/status")) {
      return jsonResponse(200, { code: 0, data: { status: "running" } });
    }
    return jsonResponse(200, { code: 0, data: { items: [] } });
  };
  const reconciled = await lovart.syncProductConcept(uncertain);
  assert.equal(reconciled.status, "generating");
  assert.equal(reconciled.pending_confirmation, null);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(calls.filter((call) => call.method === "GET").length, 2);
});

test("an unresolved paid confirmation never reopens the billable confirmation action", async () => {
  const row = conceptRow({
    status: "confirmation_unknown",
    pending_confirmation: JSON.stringify({ credits: 8 }),
    updated_at: Date.now() / 1000 - 120,
  });
  db.rows.push(row);
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).includes("/chat/status")) {
      return jsonResponse(200, { code: 0, data: { status: "running" } });
    }
    return jsonResponse(200, {
      code: 0,
      data: { pending_confirmation: { credits: 8 }, items: [] },
    });
  };

  const result = await lovart.syncProductConcept(hydrated(row));
  assert.equal(result.status, "confirmation_unknown");
  assert.match(result.error, /不会再次提交确认/);
  assert.ok(result.next_poll_at >= Date.now() / 1000 + 9);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
});

test("a future persisted poll window suppresses all Lovart reads", async () => {
  const row = conceptRow({ next_poll_at: Date.now() / 1000 + 60 });
  db.rows.push(row);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("poll window was ignored");
  };

  const result = await lovart.syncProductConcept(hydrated(row));
  assert.equal(result.status, "generating");
  assert.equal(calls, 0);
  assert.equal(db.rows[0].sync_lease_token, null);
});

test("a running Lovart task persists a ten-second minimum poll interval", async () => {
  const row = conceptRow({ next_poll_at: null });
  db.rows.push(row);
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).includes("/chat/status")) {
      return jsonResponse(200, { code: 0, data: { status: "running" } });
    }
    return jsonResponse(200, { code: 0, data: { items: [] } });
  };

  const startedAt = Date.now() / 1000;
  const result = await lovart.syncProductConcept(hydrated(row));
  assert.equal(result.status, "generating");
  assert.ok(result.next_poll_at >= startedAt + 10);
  assert.equal(db.rows[0].next_poll_at, result.next_poll_at);
  assert.equal(calls, 2);

  await lovart.syncProductConcept(result);
  assert.equal(calls, 2, "the persisted window must suppress sequential refresh storms");
});

test("transient Lovart status and result failures persist a thirty-second backoff", async () => {
  const nativeSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
    callback,
    delay === 30_000 ? delay : Math.min(delay, 2),
    ...args,
  );
  try {
    for (const failurePoint of ["status", "result"]) {
      db.rows = [];
      const row = conceptRow({ next_poll_at: null });
      db.rows.push(row);
      let calls = 0;
      globalThis.fetch = async (url) => {
        calls += 1;
        if (failurePoint === "result" && String(url).includes("/chat/status")) {
          return jsonResponse(200, { code: 0, data: { status: "running" } });
        }
        return jsonResponse(503, { message: "temporarily unavailable" });
      };

      const startedAt = Date.now() / 1000;
      const result = await lovart.syncProductConcept(hydrated(row));
      assert.equal(result.status, "generating");
      assert.match(result.error, /自动重试|继续同步/);
      assert.ok(result.next_poll_at >= startedAt + 30);
      assert.equal(calls, failurePoint === "status" ? 3 : 4);

      await lovart.syncProductConcept(result);
      assert.equal(calls, failurePoint === "status" ? 3 : 4);
    }
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
  }
});

test("an awaiting-confirmation transition clears automatic polling", async () => {
  const row = conceptRow({ next_poll_at: null });
  db.rows.push(row);
  globalThis.fetch = async (url) => {
    if (String(url).includes("/chat/status")) {
      return jsonResponse(200, { code: 0, data: { status: "running" } });
    }
    return jsonResponse(200, {
      code: 0,
      data: { pending_confirmation: { credits: 8 }, items: [] },
    });
  };

  const result = await lovart.syncProductConcept(hydrated(row));
  assert.equal(result.status, "awaiting_confirmation");
  assert.equal(result.next_poll_at, null);
  assert.equal(lovart.conceptForClient(result).retry_after_seconds, 0);
});

test("malformed and legacy poll timestamps fail open and are repaired", async () => {
  for (const nextPollAt of ["not-a-timestamp", null]) {
    db.rows = [];
    const row = conceptRow({ next_poll_at: nextPollAt });
    db.rows.push(row);
    globalThis.fetch = async (url) => {
      if (String(url).includes("/chat/status")) {
        return jsonResponse(200, { code: 0, data: { status: "running" } });
      }
      return jsonResponse(200, { code: 0, data: { items: [] } });
    };

    const result = await lovart.syncProductConcept(hydrated(row));
    assert.equal(result.status, "generating");
    assert.equal(typeof result.next_poll_at, "number");
    assert.ok(Number.isFinite(result.next_poll_at));
  }
});

test("the client retry countdown is bounded and terminal-safe", () => {
  const originalNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    assert.equal(lovart.conceptForClient(hydrated(conceptRow({
      next_poll_at: 1_700_000_005.2,
    }))).retry_after_seconds, 6);
    assert.equal(lovart.conceptForClient(hydrated(conceptRow({
      status: "done",
      next_poll_at: 1_700_000_500,
    }))).retry_after_seconds, 0);
    assert.equal(lovart.conceptForClient(hydrated(conceptRow({
      next_poll_at: "invalid",
    }))).retry_after_seconds, 0);
    assert.equal(lovart.conceptForClient(hydrated(conceptRow({
      next_poll_at: null,
    }))).retry_after_seconds, 0);
  } finally {
    Date.now = originalNow;
  }
});

test("concurrent concept polling acquires one shared sync lease", async () => {
  const row = conceptRow({ status: "generating" });
  db.rows.push(row);
  let releaseStatus;
  let markStatusStarted;
  const statusStarted = new Promise((resolve) => { markStatusStarted = resolve; });
  const statusGate = new Promise((resolve) => { releaseStatus = resolve; });
  let statusCalls = 0;
  let resultCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/chat/status")) {
      statusCalls += 1;
      markStatusStarted();
      await statusGate;
      return jsonResponse(200, { code: 0, data: { status: "done" } });
    }
    resultCalls += 1;
    return jsonResponse(200, {
      code: 0,
      data: {
        items: [{ artifacts: [{ type: "image", content: "https://cdn.example.test/final.png" }] }],
      },
    });
  };
  const record = hydrated(row);

  const leader = lovart.syncProductConcept(record);
  await statusStarted;
  const followers = Promise.all(Array.from({ length: 19 }, () => lovart.syncProductConcept(record)));
  releaseStatus();
  const [leaderResult] = await Promise.all([leader, followers]);

  assert.equal(statusCalls, 1);
  assert.equal(resultCalls, 1);
  assert.equal(leaderResult.status, "archiving");
  assert.equal(db.rows[0].status, "archiving");
  assert.equal(db.rows[0].sync_lease_token, null);
  assert.equal(db.rows[0].sync_lease_until, null);
  assert.ok(db.rows[0].next_poll_at >= Date.now() / 1000 + 29);
  assert.equal(archiveJobs.length, 1);

  await Promise.all(Array.from({ length: 20 }, () => lovart.syncProductConcept(record)));
  assert.equal(statusCalls, 1, "stale followers must not poll after the terminal write");
  assert.equal(resultCalls, 1, "stale followers must not read results after the terminal write");
  assert.equal(db.rows[0].status, "archiving");

  const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  globalThis.fetch = async () => new Response(imageBytes, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(imageBytes.byteLength),
    },
  });
  const archiveResult = await lovart.executeConceptArchiveJob(archiveJobs[0], 1);
  assert.equal(archiveResult.outcome, "completed");
  assert.equal(db.rows[0].status, "done");
  const archivedArtifacts = JSON.parse(db.rows[0].artifacts);
  assert.match(archivedArtifacts[0].sha256, /^[a-f0-9]{64}$/);
  const stored = r2Objects.get(archivedArtifacts[0].r2_key);
  assert.equal(stored.customMetadata.sha256, archivedArtifacts[0].sha256);
  assert.equal(Number(stored.customMetadata.byte_size), imageBytes.byteLength);
});

test("archive redelivery waits for the full active lease instead of exhausting retries", async () => {
  const leaseUntil = Date.now() / 1000 + 300;
  const row = conceptRow({
    status: "archiving",
    artifacts: JSON.stringify([{ type: "image", source_url: "https://cdn.example.test/pending.png" }]),
    sync_lease_token: "active-archive-worker",
    sync_lease_until: leaseUntil,
  });
  db.rows.push(row);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("a busy archive delivery must not fetch the artifact");
  };

  const result = await lovart.executeConceptArchiveJob({
    kind: "concept_archive",
    conceptId: 1,
    runId: 101,
    tenantId: 42,
    queuedAt: Date.now() / 1000,
  }, 2);
  assert.equal(result.outcome, "busy");
  assert.ok(result.retryAfterSeconds > 290);
  assert.ok(result.retryAfterSeconds <= 300);
  assert.equal(calls, 0);
  assert.equal(db.rows[0].sync_lease_token, "active-archive-worker");
});

test("the archive worker rejects an oversized image before buffering or writing R2", async () => {
  const row = conceptRow({
    status: "archiving",
    artifacts: JSON.stringify([{
      type: "image",
      source_url: "https://cdn.example.test/oversized.png",
    }]),
  });
  db.rows.push(row);
  globalThis.fetch = async () => new Response(new Uint8Array([1]), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": "20000001",
    },
  });

  const result = await lovart.executeConceptArchiveJob({
    kind: "concept_archive",
    conceptId: 1,
    runId: 101,
    tenantId: 42,
    queuedAt: Date.now() / 1000,
  }, 4);
  assert.equal(result.outcome, "failed");
  assert.equal(db.rows[0].status, "failed");
  assert.match(db.rows[0].error, /超过 20MB/);
  assert.equal(r2Objects.size, 0);
});

test("the archive worker rejects local and ambiguous destinations before any download", async (t) => {
  const unsafeUrls = [
    "https://[::ffff:127.0.0.1]/image.png",
    "https://[::ffff:7f00:1]/image.png",
    "https://[::ffff:169.254.169.254]/image.png",
    "https://[::1]/image.png",
    "https://[2001:db8::1]/image.png",
    "https://127.1/image.png",
    "https://2130706433/image.png",
    "https://0.0.0.0/image.png",
    "https://100.64.0.1/image.png",
    "https://localhost./image.png",
    "https://sub.localhost/image.png",
    "https://host.local./image.png",
    "https://host.internal/image.png",
    "https://metadata/image.png",
    "https://user:password@cdn.example.test/image.png",
    "https://cdn.example.test:8443/image.png",
    "http://cdn.example.test/image.png",
  ];
  for (const sourceUrl of unsafeUrls) {
    await t.test(sourceUrl, async () => {
      db.rows = [conceptRow({
        status: "archiving",
        artifacts: JSON.stringify([{ type: "image", source_url: sourceUrl }]),
      })];
      let downloads = 0;
      globalThis.fetch = async () => {
        downloads += 1;
        return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
      };
      const result = await lovart.executeConceptArchiveJob({
        kind: "concept_archive", conceptId: 1, runId: 101, tenantId: 42,
        queuedAt: Date.now() / 1000,
      }, 4);
      assert.equal(result.outcome, "failed");
      assert.equal(downloads, 0);
      assert.equal(r2Objects.size, 0);
    });
  }
});

test("Lovart provider checks do not expose credentials reflected in error bodies", async (t) => {
  for (const status of [401, 200]) {
    await t.test(`HTTP ${status}`, async () => {
      globalThis.fetch = async () => jsonResponse(status, {
        code: "test-secret", message: "Invalid test-access signed with test-secret",
      });
      const result = await lovart.testLovartProvider();
      assert.equal(result.ok, false);
      assert.doesNotMatch(JSON.stringify(result), /test-access|test-secret/);
      assert.match(result.detail, /Lovart/);
    });
  }
});

test("the archive worker fails closed when the six-image suite exceeds 72MB", async () => {
  const sizes = [18_000_000, 18_000_000, 18_000_000, 18_000_000, 1_000_000, 1_000_000];
  const artifacts = sizes.map((size, index) => {
    const sha256 = String(index + 1).repeat(64);
    const r2Key = `concepts/42/101/1/${index}.png`;
    r2Objects.set(r2Key, {
      bytes: { byteLength: size },
      customMetadata: { sha256, byte_size: String(size) },
      httpMetadata: { contentType: "image/png" },
    });
    return {
      type: "image",
      source_url: `https://cdn.example.test/scene-${index + 1}.png`,
      r2_key: r2Key,
      sha256,
      byte_size: size,
      content_type: "image/png",
    };
  });
  const row = conceptRow({
    status: "archiving",
    artifacts: JSON.stringify(artifacts),
  });
  db.rows.push(row);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("suite budget exhaustion must stop all remaining downloads");
  };

  const result = await lovart.executeConceptArchiveJob({
    kind: "concept_archive",
    conceptId: 1,
    runId: 101,
    tenantId: 42,
    queuedAt: Date.now() / 1000,
  }, 4);

  assert.equal(result.outcome, "failed");
  assert.equal(db.rows[0].status, "failed");
  assert.match(db.rows[0].error, /套图文件合计超过 72MB/);
  assert.equal(calls, 0);
  const stored = JSON.parse(db.rows[0].artifacts);
  assert.equal(stored.filter((artifact) => artifact.r2_key).length, 4);
  assert.ok(stored.slice(4).every((artifact) => /72MB/.test(artifact.storage_error)));
});

test("an expired sync worker cannot overwrite a newer terminal state", async () => {
  const row = conceptRow({ status: "generating" });
  db.rows.push(row);
  let releaseStatus;
  let markStatusStarted;
  const statusStarted = new Promise((resolve) => { markStatusStarted = resolve; });
  const statusGate = new Promise((resolve) => { releaseStatus = resolve; });
  globalThis.fetch = async (url) => {
    if (String(url).includes("/chat/status")) {
      markStatusStarted();
      await statusGate;
      return jsonResponse(200, { code: 0, data: { status: "abort" } });
    }
    return jsonResponse(200, { code: 0, data: { items: [] } });
  };

  const staleSync = lovart.syncProductConcept(hydrated(row));
  await statusStarted;
  row.status = "done";
  row.artifacts = JSON.stringify([{ type: "image", source_url: "https://cdn.example.test/final.png" }]);
  row.sync_lease_token = "newer-owner";
  row.sync_lease_until = Date.now() / 1000 + 360;
  row.updated_at += 1;
  releaseStatus();

  const result = await staleSync;
  assert.equal(result.status, "done");
  assert.equal(db.rows[0].status, "done");
});

test("a permanent Lovart result-read error moves the task to failed", async () => {
  const row = conceptRow();
  db.rows.push(row);
  globalThis.fetch = async (url) => {
    if (String(url).includes("/chat/status")) {
      return jsonResponse(200, { code: 0, data: { status: "done" } });
    }
    return jsonResponse(401, { message: "invalid credentials" });
  };

  const result = await lovart.syncProductConcept(hydrated(row));
  assert.equal(result.status, "failed");
  assert.equal(result.next_poll_at, null);
  assert.match(result.error, /Lovart HTTP 401/);
});

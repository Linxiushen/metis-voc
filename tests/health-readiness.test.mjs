import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
let evaluateHealthReadiness;
let server;

before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  ({ evaluateHealthReadiness } = await server.ssrLoadModule("/lib/health-readiness.ts"));
});

after(async () => {
  await server?.close();
});

function healthyInput(overrides = {}) {
  return {
    researchQueue: true,
    settingsEncryption: true,
    modelProviders: true,
    paidProviderCalls: true,
    decisionCoordinator: true,
    conceptArchiveQueue: true,
    productImageStorage: true,
    lovart: true,
    operationalEvidenceAdapterIds: ["keepamore-amazon-market-adapter"],
    declaredEvidenceAdapters: [
      { id: "review-voc-adapter", status: "interface_ready_adapter_pending" },
      { id: "orders-returns-adapter", status: "interface_ready_adapter_pending" },
    ],
    ...overrides,
  };
}

test("AI research readiness is independent from Lovart and stays partial while evidence adapters are pending", () => {
  const result = evaluateHealthReadiness(healthyInput({ lovart: false }));

  assert.equal(result.readyForAiResearch, true);
  assert.equal(result.readyForConceptGeneration, false);
  assert.equal(result.partialEvidenceReady, true);
  assert.equal(result.fullEvidenceReady, false);
  assert.equal(result.readyForFullEvidenceResearch, false);
  assert.equal(result.evidenceLevel, "partial_verified_research");
  assert.deepEqual(result.pendingEvidenceAdapterIds, ["review-voc-adapter", "orders-returns-adapter"]);
});

test("concept generation readiness does not depend on research models, queue, or evidence adapters", () => {
  const result = evaluateHealthReadiness(healthyInput({
    researchQueue: false,
    settingsEncryption: false,
    modelProviders: false,
    operationalEvidenceAdapterIds: [],
    declaredEvidenceAdapters: [],
  }));

  assert.equal(result.readyForAiResearch, false);
  assert.equal(result.readyForConceptGeneration, true);
  assert.equal(result.serviceReady, true);
  assert.equal(result.evidenceLevel, "template_only");
});

test("full-evidence readiness requires every declared adapter to be operational", () => {
  const result = evaluateHealthReadiness(healthyInput({
    operationalEvidenceAdapterIds: [
      "keepamore-amazon-market-adapter",
      "review-voc-adapter",
      "orders-returns-adapter",
    ],
    declaredEvidenceAdapters: [
      { id: "review-voc-adapter", status: "ready" },
      { id: "orders-returns-adapter", status: "operational" },
    ],
  }));

  assert.equal(result.readyForAiResearch, true);
  assert.equal(result.fullEvidenceReady, true);
  assert.equal(result.readyForFullEvidenceResearch, true);
  assert.equal(result.evidenceLevel, "full_verified_research");
});

test("a registry-ready adapter stays pending until it is loaded at runtime", () => {
  const result = evaluateHealthReadiness(healthyInput({
    declaredEvidenceAdapters: [
      { id: "review-voc-adapter", status: "ready" },
    ],
  }));

  assert.equal(result.fullEvidenceReady, false);
  assert.equal(result.readyForFullEvidenceResearch, false);
  assert.equal(result.evidenceLevel, "partial_verified_research");
  assert.deepEqual(result.pendingEvidenceAdapterIds, ["review-voc-adapter"]);
});

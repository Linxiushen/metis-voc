export type HealthAdapterState = {
  id: unknown;
  status: unknown;
};

export type HealthReadinessInput = {
  researchQueue: boolean;
  settingsEncryption: boolean;
  modelProviders: boolean;
  paidProviderCalls: boolean;
  decisionCoordinator: boolean;
  conceptArchiveQueue: boolean;
  productImageStorage: boolean;
  lovart: boolean;
  operationalEvidenceAdapterIds: readonly string[];
  declaredEvidenceAdapters: readonly HealthAdapterState[];
};

const READY_ADAPTER_STATES = new Set(["ready", "operational", "active"]);

function adapterId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function evaluateHealthReadiness(input: HealthReadinessInput) {
  const operationalEvidenceAdapterIds = [...new Set(
    input.operationalEvidenceAdapterIds.map(adapterId).filter(Boolean),
  )];
  const operationalEvidenceAdapterIdSet = new Set(operationalEvidenceAdapterIds);
  const declaredEvidenceAdapters = input.declaredEvidenceAdapters
    .map((adapter) => ({
      id: adapterId(adapter.id),
      status: adapterId(adapter.status).toLowerCase(),
    }))
    .filter((adapter) => adapter.id);
  const pendingEvidenceAdapterIds = declaredEvidenceAdapters
    .filter((adapter) =>
      !READY_ADAPTER_STATES.has(adapter.status) ||
      !operationalEvidenceAdapterIdSet.has(adapter.id)
    )
    .map((adapter) => adapter.id);

  const partialEvidenceReady = operationalEvidenceAdapterIds.length > 0;
  const fullEvidenceReady = partialEvidenceReady &&
    declaredEvidenceAdapters.length > 0 &&
    pendingEvidenceAdapterIds.length === 0;
  const researchInfrastructureReady = input.researchQueue && input.settingsEncryption;
  const conceptInfrastructureReady = input.decisionCoordinator &&
    input.conceptArchiveQueue && input.productImageStorage;
  const readyForAiResearch = researchInfrastructureReady &&
    input.modelProviders && input.paidProviderCalls && partialEvidenceReady;
  const readyForConceptGeneration = conceptInfrastructureReady &&
    input.lovart && input.paidProviderCalls;

  return {
    serviceReady: researchInfrastructureReady || conceptInfrastructureReady,
    researchInfrastructureReady,
    conceptInfrastructureReady,
    readyForAiResearch,
    readyForFullEvidenceResearch: readyForAiResearch && fullEvidenceReady,
    readyForConceptGeneration,
    partialEvidenceReady,
    fullEvidenceReady,
    evidenceLevel: fullEvidenceReady
      ? "full_verified_research"
      : partialEvidenceReady
        ? "partial_verified_research"
        : "template_only",
    operationalEvidenceAdapterIds,
    pendingEvidenceAdapterIds,
  } as const;
}

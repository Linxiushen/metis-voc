import { env } from "cloudflare:workers";

type DecisionCoordinatorStub = {
  fetch(input: Request): Promise<Response>;
};

type DecisionCoordinatorNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): DecisionCoordinatorStub;
};

export type DecisionLease = {
  acquired: boolean;
  retryAfterSeconds: number;
  coordinated: boolean;
  release(): Promise<void>;
};

const runtimeEnv = env as unknown as Record<string, unknown>;

export function decisionCoordinatorConfigured(): boolean {
  const namespace = runtimeEnv.DECISION_COORDINATOR as DecisionCoordinatorNamespace | undefined;
  return Boolean(namespace?.idFromName && namespace?.get);
}

export async function acquireDecisionLease(key: string): Promise<DecisionLease> {
  const namespace = runtimeEnv.DECISION_COORDINATOR as DecisionCoordinatorNamespace | undefined;
  if (!namespace?.idFromName || !namespace?.get) {
    throw new Error("Decision coordinator binding is not configured");
  }

  const token = crypto.randomUUID();
  const stub = namespace.get(namespace.idFromName(key));
  const response = await stub.fetch(new Request("https://decision-coordinator.internal/acquire", {
    method: "POST",
    headers: { "x-decision-token": token },
  }));
  if (response.status === 429) {
    return {
      acquired: false,
      retryAfterSeconds: Math.max(1, Number(response.headers.get("retry-after") || 1)),
      coordinated: true,
      async release() {},
    };
  }
  if (!response.ok) {
    throw new Error(`Decision coordinator acquire failed with ${response.status}`);
  }

  return {
    acquired: true,
    retryAfterSeconds: 0,
    coordinated: true,
    async release() {
      const released = await stub.fetch(new Request("https://decision-coordinator.internal/release", {
        method: "POST",
        headers: { "x-decision-token": token },
      }));
      if (!released.ok) {
        throw new Error(`Decision coordinator release failed with ${released.status}`);
      }
    },
  };
}

const DECISION_LEASE_KEY = "active";
const DECISION_LEASE_MS = 60_000;

type StoredDecisionLease = {
  token: string;
  expiresAt: number;
};

type DecisionStorageTransaction = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
};

type DecisionCoordinatorState = {
  storage: {
    transaction<T>(operation: (transaction: DecisionStorageTransaction) => Promise<T>): Promise<T>;
  };
};

export class DecisionCoordinator {
  private readonly state: DecisionCoordinatorState;

  constructor(state: DecisionCoordinatorState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = request.headers.get("x-decision-token") || "";
    if (request.method !== "POST" || !token || token.length > 100) {
      return new Response("Invalid decision lease request", { status: 400 });
    }

    const now = Date.now();
    if (url.pathname === "/acquire") {
      const admission = await this.state.storage.transaction(async (transaction) => {
        const active = await transaction.get<StoredDecisionLease>(DECISION_LEASE_KEY);
        if (active?.token && active.expiresAt > now) {
          return {
            acquired: false,
            retryAfter: Math.max(1, Math.ceil((active.expiresAt - now) / 1_000)),
          };
        }
        await transaction.put(DECISION_LEASE_KEY, {
          token,
          expiresAt: now + DECISION_LEASE_MS,
        } satisfies StoredDecisionLease);
        return { acquired: true, retryAfter: 0 };
      });
      if (!admission.acquired) {
        return new Response(null, {
          status: 429,
          headers: { "retry-after": String(admission.retryAfter) },
        });
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/release") {
      await this.state.storage.transaction(async (transaction) => {
        const active = await transaction.get<StoredDecisionLease>(DECISION_LEASE_KEY);
        if (active?.token === token) await transaction.delete(DECISION_LEASE_KEY);
      });
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  }
}

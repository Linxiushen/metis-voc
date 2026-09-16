import { env } from "cloudflare:workers";

const runtimeEnv = env as unknown as {
  PAID_PROVIDER_CALLS_ENABLED?: string;
};

export function paidProviderCallsEnabled(): boolean {
  return String(runtimeEnv.PAID_PROVIDER_CALLS_ENABLED || "").toLowerCase() === "true";
}

export function tenantPlanAllowsPaidProviders(plan: unknown): boolean {
  return ["pro", "enterprise"].includes(String(plan || "").toLowerCase());
}

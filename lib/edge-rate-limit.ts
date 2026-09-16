import { env } from "cloudflare:workers";

type EdgeRateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

const runtimeEnv = env as unknown as Record<string, unknown>;

export async function consumeEdgeRateLimit(binding: string, key: string): Promise<boolean> {
  const limiter = runtimeEnv[binding] as EdgeRateLimiter | undefined;
  if (!limiter?.limit) return true;
  const result = await limiter.limit({ key });
  return result.success;
}

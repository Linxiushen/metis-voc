export type SlidingWindowRule = {
  bucket: string;
  limit: number;
  windowSeconds: number;
};

export type SlidingWindowResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function validateRules(rules: SlidingWindowRule[]): void {
  if (!rules.length || rules.length > 8) throw new Error("限流规则数量无效");
  for (const rule of rules) {
    if (!rule.bucket || rule.bucket.length > 200) throw new Error("限流桶无效");
    if (!Number.isInteger(rule.limit) || rule.limit <= 0) throw new Error("限流次数无效");
    if (!Number.isInteger(rule.windowSeconds) || rule.windowSeconds <= 0) {
      throw new Error("限流窗口无效");
    }
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function rateLimitBucket(scope: string, identifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${scope}\0${identifier}`),
  );
  return `${scope}:${bytesToHex(new Uint8Array(digest))}`;
}

export async function consumeSlidingWindow(
  db: D1Database,
  rules: SlidingWindowRule[],
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<SlidingWindowResult> {
  validateRules(rules);
  const now = Math.floor(nowSeconds);
  const requestedValues = rules.map(() => "(?, ?, ?)").join(", ");
  const bindings = rules.flatMap((rule) => [
    rule.bucket,
    now - rule.windowSeconds,
    rule.limit,
  ]);

  // One SQLite statement makes the count-and-insert decision atomic. Either
  // every requested bucket receives an event or none of them do.
  const result = await db
    .prepare(`WITH requested(bucket, cutoff, max_count) AS (
      VALUES ${requestedValues}
    ), admitted(ok) AS (
      SELECT NOT EXISTS (
        SELECT 1 FROM requested AS requested_rule
        WHERE (
          SELECT COUNT(*) FROM rate_limit_events AS event
          WHERE event.bucket = requested_rule.bucket
            AND event.event_at > requested_rule.cutoff
        ) >= requested_rule.max_count
      )
    )
    INSERT INTO rate_limit_events(bucket, event_at)
    SELECT requested.bucket, ?
    FROM requested CROSS JOIN admitted
    WHERE admitted.ok = 1`)
    .bind(...bindings, now)
    .run();

  return {
    allowed: Number(result.meta.changes || 0) === rules.length,
    retryAfterSeconds: Math.max(...rules.map((rule) => rule.windowSeconds)),
  };
}

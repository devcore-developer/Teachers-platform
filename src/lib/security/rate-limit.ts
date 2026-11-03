/**
 * Phase 12 — shared lightweight rate limiting (moved from
 * lib/surveys/rate-limit.ts so every sensitive flow can use it).
 *
 * Process-local sliding in-memory window keyed by `scope:subject`.
 * Best-effort by nature: limits reset on process restart and are
 * per-instance. For this platform's scale (single Next.js process,
 * SQLite dev phase) it stops burst abuse of public and sensitive
 * write paths (survey submissions, password-reset mail, certificate
 * verification) without adding infrastructure.
 */

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

/** Periodic sweep so abandoned buckets don't grow unbounded. */
const SWEEP_INTERVAL_MS = 300_000;
let lastSweep = 0;

function sweep(now: number, windowMs: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < windowMs);
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the next attempt is allowed (when blocked). */
  retryAfterSeconds: number;
}

export function checkRateLimit(
  scope: string,
  subject: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  sweep(now, windowMs);
  const key = `${scope}:${subject}`;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < windowMs);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    buckets.set(key, bucket);
    return { allowed: false, retryAfterSeconds };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test helper — clears all buckets (used by the integration suites). */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Best-effort client identity for rate limiting unauthenticated flows.
 * Reads the standard proxy headers; falls back to "unknown" so the
 * limiter still applies (one shared bucket) when no proxy headers
 * exist. Never used for authorization — rate limiting only.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
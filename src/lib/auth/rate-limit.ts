/* ------------------------------------------------------------------ */
/* In-memory login rate limiting.                                       */
/*                                                                      */
/* Reasonable brute-force protection for a single-server deployment:    */
/* per-email sliding window. Documented limitations (not hidden):       */
/*   1. Counters live in process memory — they reset on server restart  */
/*      and are not shared across multiple instances.                   */
/*   2. A distributed deployment should swap this module for a          */
/*      Redis/DB-backed limiter without touching call-sites.            */
/* ------------------------------------------------------------------ */

interface AttemptRecord {
  failures: number[];
  lockedUntil: number;
}

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const records = new Map<string, AttemptRecord>();

function keyFor(email: string, ip: string): string {
  return `${email.toLowerCase()}|${ip}`;
}

function prune(record: AttemptRecord, now: number) {
  record.failures = record.failures.filter((t) => now - t < WINDOW_MS);
}

/** True when the caller must be blocked right now. */
export function isRateLimited(email: string, ip: string): boolean {
  const record = records.get(keyFor(email, ip));
  if (!record) return false;
  const now = Date.now();
  if (record.lockedUntil > now) return true;
  prune(record, now);
  return record.failures.length >= MAX_FAILURES;
}

/** Seconds until the lockout lifts (for the Arabic message). */
export function retryAfterSeconds(email: string, ip: string): number {
  const record = records.get(keyFor(email, ip));
  if (!record) return 0;
  return Math.max(0, Math.ceil((record.lockedUntil - Date.now()) / 1000));
}

/** Record a failed attempt; locks the key once the window is exhausted. */
export function recordLoginFailure(email: string, ip: string): void {
  const key = keyFor(email, ip);
  const now = Date.now();
  const record = records.get(key) ?? { failures: [], lockedUntil: 0 };
  prune(record, now);
  record.failures.push(now);
  if (record.failures.length >= MAX_FAILURES) {
    record.lockedUntil = now + LOCKOUT_MS;
    record.failures = [];
  }
  records.set(key, record);
}

/** Record a successful login — clears the failure counter. */
export function recordLoginSuccess(email: string, ip: string): void {
  records.delete(keyFor(email, ip));
}

/** Test helper: clear all counters. */
export function resetRateLimiter(): void {
  records.clear();
}
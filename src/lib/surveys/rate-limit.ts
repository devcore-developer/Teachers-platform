/**
 * Phase 12 — moved to lib/security/rate-limit.ts so every sensitive
 * flow (survey submissions, password-reset mail, certificate
 * verification) shares one limiter implementation.
 *
 * This file remains as a re-export shim for backwards compatibility
 * with the existing Phase 9 imports.
 */
export {
  checkRateLimit,
  resetRateLimits,
  type RateLimitResult,
} from "@/lib/security/rate-limit";
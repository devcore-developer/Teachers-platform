/**
 * Phase 11 — safe internal notification destinations.
 *
 * Notifications may carry a destinationUrl that the UI renders as a
 * link. Because that value is stored in the database and rendered in
 * multiple surfaces, it is validated against a strict internal allow-list
 * at WRITE time: anything that is not a relative in-app path is dropped
 * (never stored), which structurally prevents open redirects and
 * `javascript:`/data: injection.
 */

/** First path segments allowed as notification destinations (existing app routes). */
const ALLOWED_SEGMENTS = [
  "dashboard",
  "assignments",
  "my-assignments",
  "surveys",
  "my-surveys",
  "follow-ups",
  "my-follow-ups",
  "certificates",
  "my-certificates",
  "growth",
  "my-growth",
  "analytics",
  "reports",
  "archive",
  "impact",
  "notifications",
  "integrations",
  "verify",
  "account",
] as const;

const MAX_DESTINATION_LENGTH = 300;

/**
 * Validates and normalizes a notification destination. Returns the safe
 * relative path (starting with a single "/") or null when the value is
 * not a safe internal destination — callers simply omit the link then.
 */
export function safeInternalUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_DESTINATION_LENGTH) return null;

  // Reject absolute URLs, protocol-relative, backslash tricks and control chars.
  if (value.startsWith("//") || value.includes("\\") || value.includes("\0")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;
  if (!value.startsWith("/")) return null;
  if (/[\r\n\t]/.test(value)) return null;

  const pathPart = value.split("?")[0].split("#")[0];
  const segment = pathPart.split("/").filter(Boolean)[0];
  if (!segment) return null;
  if (!(ALLOWED_SEGMENTS as readonly string[]).includes(segment)) return null;

  return value;
}

/**
 * Convenience builder: prefix + optional id is the dominant pattern
 * (e.g. `/assignments/${id}`). Returns null for unsafe/missing ids so
 * callers never persist a broken link.
 */
export function internalPath(segment: string, id?: string | null): string | null {
  if (id !== undefined && id !== null) {
    // Ids are server-generated cuids; only allow url-safe characters.
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    return safeInternalUrl(`/${segment}/${id}`);
  }
  return safeInternalUrl(`/${segment}`);
}
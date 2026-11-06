/* ------------------------------------------------------------------ */
/* Media storage configuration — Cloudflare R2.                         */
/*                                                                      */
/* Honest degradation contract: when the R2 environment variables are   */
/* missing, DIRECT UPLOADS ARE DISABLED (isR2Configured → false) and    */
/* every UI surface must say so in plain Arabic instead of pretending.  */
/* External-URL media input keeps working with zero configuration.      */
/*                                                                      */
/* Credentials live ONLY on the server — this module is imported by     */
/* server code exclusively (actions, API routes). Client bundles never  */
/* see it: the client learns only the FINAL public URL of a file.       */
/* ------------------------------------------------------------------ */

export type MediaKind = "image" | "video";

function positiveNumber(env: string | undefined, fallback: number): number {
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Upload size ceilings — server-verified (and pre-checked client-side). */
export const MEDIA_LIMITS = {
  /** Generic images (covers, program art, …). */
  image: positiveNumber(process.env.MEDIA_MAX_IMAGE_BYTES, 5 * 1024 * 1024),
  /** Lesson/course videos. Presigned PUT — never proxied through Next. */
  video: positiveNumber(process.env.MEDIA_MAX_VIDEO_BYTES, 512 * 1024 * 1024),
  /** School branding logos (matches lib/branding/validation LOGO_MAX_BYTES). */
  logo: 2 * 1024 * 1024,
} as const;

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export function allowedMimeTypesFor(kind: MediaKind): readonly string[] {
  return kind === "image" ? IMAGE_MIME_TYPES : VIDEO_MIME_TYPES;
}

export function maxBytesFor(kind: MediaKind): number {
  return kind === "image" ? MEDIA_LIMITS.image : MEDIA_LIMITS.video;
}

export function isAllowedMimeType(kind: MediaKind, mimeType: string): boolean {
  return (allowedMimeTypesFor(kind) as readonly string[]).includes(mimeType);
}

/* ------------------------------------------------------------------ */
/* R2 environment                                                       */
/* ------------------------------------------------------------------ */

export interface R2StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Optional public base (custom domain or r2.dev). No trailing slash. */
  publicBaseUrl: string | null;
}

const R2_REQUIRED_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
] as const;

/**
 * Resolved R2 config, or null when ANY required variable is missing.
 * Never throws — callers decide how to degrade.
 */
export function readR2Config(): R2StorageConfig | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  const rawPublic = process.env.R2_PUBLIC_URL?.trim() ?? "";
  let publicBaseUrl: string | null = null;
  if (rawPublic) {
    try {
      const parsed = new URL(rawPublic);
      // Only https public bases — mixed content would be blocked anyway.
      if (parsed.protocol === "https:") {
        publicBaseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, "");
      }
    } catch {
      publicBaseUrl = null;
    }
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

/** Exactly-which variables are missing — powers the honest Arabic error. */
export function missingR2Env(): string[] {
  return R2_REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
}

export function isR2Configured(): boolean {
  return readR2Config() !== null;
}

export const R2_ENDPOINT_BASE = "r2.cloudflarestorage.com";

/** Presigned URL lifetime for direct browser PUTs. */
export const PRESIGN_PUT_EXPIRES_SECONDS = 600;
/** Presigned GET lifetime used by the /api/media proxy redirect. */
export const PRESIGN_GET_EXPIRES_SECONDS = 300;
/* ------------------------------------------------------------------ */
/* Cloudflare R2 storage service (server-only).                         */
/*                                                                      */
/* S3-compatible API through the official AWS SDK v3. The client is     */
/* created LAZILY and cached — importing this module never touches the  */
/* network and never requires credentials (they are needed only when a  */
/* storage operation actually runs).                                    */
/*                                                                      */
/* Key layout (collision-safe, tenant-scoped, kind-scoped):             */
/*   media/school-<schoolId>/image/2025/11/<rand>-<safe-name>.<ext>     */
/*   media/platform/video/2025/11/<rand>-<safe-name>.<ext>              */
/* Original filenames are preserved as DB metadata (originalName) and   */
/* slugified into the key for human-readable object listings.           */
/* ------------------------------------------------------------------ */

import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

import {
  PRESIGN_GET_EXPIRES_SECONDS,
  PRESIGN_PUT_EXPIRES_SECONDS,
  R2_ENDPOINT_BASE,
  readR2Config,
  type MediaKind,
} from "@/lib/media/config";

/** Thrown with a stable code so callers can map it to Arabic copy. */
export class MediaStorageError extends Error {
  code:
    | "R2_NOT_CONFIGURED"
    | "OBJECT_NOT_FOUND"
    | "OBJECT_TOO_LARGE"
    | "STORAGE_UNAVAILABLE";

  constructor(
    code: MediaStorageError["code"],
    message: string
  ) {
    super(message);
    this.name = "MediaStorageError";
    this.code = code;
  }
}

let cachedClient: S3Client | null = null;

function s3Client(): S3Client {
  const cfg = readR2Config();
  if (!cfg) {
    throw new MediaStorageError(
      "R2_NOT_CONFIGURED",
      "Cloudflare R2 environment variables are not configured"
    );
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.${R2_ENDPOINT_BASE}`,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }
  return cachedClient;
}

/* ------------------------------------------------------------------ */
/* Keys                                                                 */
/* ------------------------------------------------------------------ */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Keep a readable, filesystem-safe fragment of the original filename. */
function safeNameFragment(originalName: string, max = 60): string {
  const base = originalName.split(/[\\/]/).pop() ?? "file";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return stem || "file";
}

export function extensionForMime(mimeType: string): string | null {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return map[mimeType] ?? null;
}

export interface BuildMediaKeyInput {
  kind: MediaKind;
  mimeType: string;
  originalName: string;
  /** Tenant scope: school id, or null for platform-level (SUPER_ADMIN). */
  schoolId: string | null;
}

export function buildMediaKey(input: BuildMediaKeyInput): string {
  const ext = extensionForMime(input.mimeType) ?? "bin";
  const now = new Date();
  const scope = input.schoolId ? `school-${input.schoolId}` : "platform";
  const rand = crypto.randomBytes(8).toString("hex");
  const name = safeNameFragment(input.originalName);
  return (
    `media/${scope}/${input.kind}/` +
    `${now.getFullYear()}/${pad2(now.getMonth() + 1)}/` +
    `${rand}-${name}.${ext}`
  );
}

/* ------------------------------------------------------------------ */
/* URL <-> key resolution                                               */
/* ------------------------------------------------------------------ */

/** App-relative serving path when no public base is configured. */
export function mediaApiPathFor(key: string): string {
  const encoded = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/media/${encoded}`;
}

/**
 * Final URL stored in the database for an R2 object:
 *  - with R2_PUBLIC_URL → direct public CDN/object URL;
 *  - without → the authenticated /api/media/… proxy (private by default).
 */
export function publicUrlFor(key: string): string {
  const cfg = readR2Config();
  const base = cfg?.publicBaseUrl ?? null;
  return base ? `${base}/${key}` : mediaApiPathFor(key);
}

/** Is this URL something this app manages in R2 (vs an external URL)? */
export function isManagedMediaUrl(url: string): boolean {
  if (url.startsWith("/api/media/")) return true;
  const cfg = readR2Config();
  if (cfg?.publicBaseUrl && url.startsWith(`${cfg.publicBaseUrl}/`)) return true;
  return false;
}

/** Inverse of publicUrlFor — null for external/unmanaged URLs. */
export function keyFromManagedUrl(url: string): string | null {
  if (url.startsWith("/api/media/")) {
    try {
      return url
        .slice("/api/media/".length)
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/");
    } catch {
      return null;
    }
  }
  const cfg = readR2Config();
  if (cfg?.publicBaseUrl && url.startsWith(`${cfg.publicBaseUrl}/`)) {
    return url.slice(cfg.publicBaseUrl.length + 1);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Object operations                                                    */
/* ------------------------------------------------------------------ */

/** Presigned PUT — the browser uploads DIRECTLY to R2 (progress via XHR);
 * the Next.js server never streams large files through an action. */
export async function presignedPutUrl(
  key: string,
  contentType: string
): Promise<string> {
  const cfg = readR2Config();
  if (!cfg) {
    throw new MediaStorageError("R2_NOT_CONFIGURED", "R2 is not configured");
  }
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3Client(), command, {
    expiresIn: PRESIGN_PUT_EXPIRES_SECONDS,
  });
}

export interface HeadInfo {
  sizeBytes: number;
  contentType: string | null;
}

export async function headObject(key: string): Promise<HeadInfo | null> {
  const cfg = readR2Config();
  if (!cfg) {
    throw new MediaStorageError("R2_NOT_CONFIGURED", "R2 is not configured");
  }
  try {
    const out = await s3Client().send(
      new HeadObjectCommand({ Bucket: cfg.bucket, Key: key })
    );
    return {
      sizeBytes: out.ContentLength ?? 0,
      contentType: out.ContentType ?? null,
    };
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === "NotFound" || name === "404") return null;
    const meta = error as { $metadata?: { httpStatusCode?: number } };
    if (meta?.$metadata?.httpStatusCode === 404) return null;
    throw new MediaStorageError(
      "STORAGE_UNAVAILABLE",
      error instanceof Error ? error.message : "R2 HEAD failed"
    );
  }
}

export async function deleteObject(key: string): Promise<void> {
  const cfg = readR2Config();
  if (!cfg) {
    throw new MediaStorageError("R2_NOT_CONFIGURED", "R2 is not configured");
  }
  await s3Client().send(
    new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })
  );
}

/** Presigned GET — used by the /api/media proxy for private media. */
export async function presignedGetUrl(key: string): Promise<string> {
  const cfg = readR2Config();
  if (!cfg) {
    throw new MediaStorageError("R2_NOT_CONFIGURED", "R2 is not configured");
  }
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    { expiresIn: PRESIGN_GET_EXPIRES_SECONDS }
  );
}
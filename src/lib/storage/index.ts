import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/* ------------------------------------------------------------------ */
/* Storage abstraction — Phase 5 attachments (covers, resources, videos)*/
/*                                                                      */
/* Bytes NEVER live in the relational database. This module defines the */
/* provider-agnostic adapter the platform talks to, plus a local-disk   */
/* driver suitable for the development phase.                           */
/*                                                                      */
/* CURRENT CONFIGURATION (honest statement):                            */
/*   - STORAGE_DRIVER=local (default) with LOCAL_STORAGE_DIR optional   */
/*     (defaults to <project>/storage/uploads). Files are persisted to  */
/*     disk for real and served ONLY through the authenticated route    */
/*     /api/files/[id] — nothing is fake.                               */
/*   - No cloud object storage (S3/GCS/Cloudinary) is configured in     */
/*     this environment. Production deployments must either keep the    */
/*     local driver on a persistent volume or implement StorageAdapter  */
/*     for their provider and set STORAGE_DRIVER accordingly — getSto-  */
/*     rage() fails loudly for unknown drivers instead of pretending.   */
/* ------------------------------------------------------------------ */

export interface PutResult {
  storageKey: string;
  sizeBytes: number;
}

export interface StorageAdapter {
  /** Active driver id ("local" for the disk implementation). */
  readonly driver: string;
  /** Persist bytes under a server-generated key. */
  put(key: string, data: Uint8Array): Promise<PutResult>;
  /** Read bytes back — null when the file is missing/unreadable. */
  get(key: string): Promise<Uint8Array | null>;
  /** Best-effort delete — never throws for a missing file. */
  delete(key: string): Promise<void>;
}

/** Local-disk adapter. Keys are relative POSIX paths inside the root. */
class LocalDiskStorage implements StorageAdapter {
  readonly driver = "local";

  constructor(private readonly rootDir: string) {}

  /** Resolve + jail the key inside the root (blocks path traversal). */
  private resolve(key: string): string {
    const normalized = key.split("\\").join("/");
    const abs = path.resolve(this.rootDir, normalized);
    const rootAbs = path.resolve(this.rootDir);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
      throw new Error("Unsafe storage key rejected");
    }
    return abs;
  }

  async put(key: string, data: Uint8Array): Promise<PutResult> {
    const abs = this.resolve(key);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data);
    return { storageKey: key, sizeBytes: data.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const abs = this.resolve(key);
      const buffer = await readFile(abs);
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      // Missing file is fine — deletion is best-effort.
    }
  }
}

let cached: StorageAdapter | null = null;

/**
 * Resolve the configured storage adapter. Unknown drivers throw a loud
 * configuration error — the platform never silently pretends uploads
 * succeeded without a real backend.
 */
export function getStorage(): StorageAdapter {
  if (cached) return cached;

  const driver = (process.env.STORAGE_DRIVER ?? "local").trim().toLowerCase();
  if (driver !== "local") {
    throw new Error(
      `STORAGE_DRIVER "${driver}" is not configured in this deployment. ` +
        "Use STORAGE_DRIVER=local (default) or implement StorageAdapter " +
        "for your cloud provider and register it in src/lib/storage."
    );
  }

  const configured = process.env.LOCAL_STORAGE_DIR?.trim();
  const rootDir =
    configured && configured.length > 0
      ? path.resolve(configured)
      : path.join(process.cwd(), "storage", "uploads");

  cached = new LocalDiskStorage(rootDir);
  return cached;
}

/** Where the local driver stores files (used by setup docs/tooling). */
export function localStorageRoot(): string {
  const configured = process.env.LOCAL_STORAGE_DIR?.trim();
  return configured && configured.length > 0
    ? path.resolve(configured)
    : path.join(process.cwd(), "storage", "uploads");
}

/**
 * Sanitize a client-supplied filename for DISPLAY and for embedding in
 * a generated key: basename only, restricted charset, bounded length
 * (tail preserved so the extension survives). The client path is never
 * used as a storage path.
 */
export function sanitizeFileName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (cleaned.length === 0) return "file";
  return cleaned.length > 80 ? cleaned.slice(-80) : cleaned;
}

/**
 * Build a collision-safe, traversal-safe storage key:
 *   courses/2026/02/<20-hex>-<sanitized-name>
 * The random segment guarantees uniqueness; the sanitized name keeps
 * the extension readable for operators only.
 */
export function buildStorageKey(
  scope: "courses" | "programs",
  originalName: string
): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const unique = randomUUID().replace(/-/g, "").slice(0, 20);
  return `${scope}/${yyyy}/${mm}/${unique}-${sanitizeFileName(originalName)}`;
}
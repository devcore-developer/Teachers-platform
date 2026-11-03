/**
 * Phase 7 — local-disk storage for submission attachments.
 *
 * SAFEST-POSSIBLE ABSTRACTION when no cloud storage is configured:
 *   - files are written under a single root, into DATE/UUID paths that
 *     contain ZERO user input (path traversal is structurally
 *     impossible for writes),
 *   - reads re-resolve the key and jail-check it against the root
 *     (defense in depth),
 *   - nothing is ever "pretend-uploaded": a failed write rejects the
 *     whole action and no DB row is created.
 *
 * ENV CONFIGURATION (documented for deployment):
 *   ASSIGNMENTS_STORAGE_DIR — absolute directory for submission files.
 *   Default when unset: <project>/.data/assignment-files
 *   Serve files ONLY through /api/assignment-files/[id], which enforces
 *   owner/reviewer authorization per request.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const ASSIGNMENTS_STORAGE_ROOT = process.env.ASSIGNMENTS_STORAGE_DIR
  ? path.resolve(process.env.ASSIGNMENTS_STORAGE_DIR)
  : path.join(process.cwd(), ".data", "assignment-files");

async function ensureRoot(): Promise<void> {
  await mkdir(ASSIGNMENTS_STORAGE_ROOT, { recursive: true });
}

/**
 * Persist bytes under a fresh server-generated key:
 *   <yyyy>/<mm>/<uuid>  (no segment originates from the client)
 */
export async function saveSubmissionObject(
  bytes: Buffer,
  _originalName: string
): Promise<{ storageKey: string; sizeBytes: number }> {
  await ensureRoot();
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const relative = path.join(yyyy, mm, randomUUID());
  const absolute = path.join(ASSIGNMENTS_STORAGE_ROOT, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes, { mode: 0o600 });
  return { storageKey: relative.split(path.sep).join("/"), sizeBytes: bytes.length };
}

/** Jailed read: resolved path must stay inside the storage root. */
export async function readSubmissionObject(storageKey: string): Promise<Buffer> {
  const root = path.resolve(ASSIGNMENTS_STORAGE_ROOT);
  const absolute = path.resolve(root, storageKey);
  if (!absolute.startsWith(root + path.sep)) {
    throw new Error("SUBMISSION_FILE_PATH_ESCAPE");
  }
  return readFile(absolute);
}

export async function deleteSubmissionObject(storageKey: string): Promise<void> {
  const root = path.resolve(ASSIGNMENTS_STORAGE_ROOT);
  const absolute = path.resolve(root, storageKey);
  if (!absolute.startsWith(root + path.sep)) {
    throw new Error("SUBMISSION_FILE_PATH_ESCAPE");
  }
  await unlink(absolute).catch((error: unknown) => {
    // A missing file must not break the DB deletion flow — the object
    // is already gone, which is the desired end state.
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  });
}

/** Best-effort cleanup used by tests and admin tooling. */
export async function deleteAllSubmissionObjects(): Promise<void> {
  await ensureRoot();
  const { rm } = await import("node:fs/promises");
  await rm(ASSIGNMENTS_STORAGE_ROOT, { recursive: true, force: true });
}
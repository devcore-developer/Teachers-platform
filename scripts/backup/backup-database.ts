/**
 * Phase 12 — safe SQLite backup (online, non-destructive).
 *
 * Usage:  bun scripts/backup/backup-database.ts
 * Env:    DATABASE_URL (file:...), BACKUP_DIR (default .data/backups),
 *         BACKUP_KEEP (default 14 — older backups are pruned)
 *
 * Uses SQLite's `VACUUM INTO`, which produces a consistent snapshot of
 * a live database WITHOUT locking out the app or touching the original
 * file. A SHA-256 checksum is written next to every backup so restores
 * can be verified. The script never deletes or modifies the source DB.
 *
 * Exit codes: 0 = backup taken and verified, 1 = failure (nothing is
 * ever reported as "success" without an integrity check passing).
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";

function resolveDatabasePath(): string {
  const raw = (process.env.DATABASE_URL ?? "").trim();
  if (!raw) throw new Error("DATABASE_URL is not set");
  if (!raw.startsWith("file:")) {
    throw new Error(
      `This backup script targets SQLite file databases only (received: ${raw.slice(0, 12)}…) — for a hosted database use the provider's snapshot tooling`
    );
  }
  const filePath = raw.slice("file:".length).split("?")[0];
  return path.resolve(process.cwd(), filePath);
}

async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function pruneOldBackups(dir: string, keep: number, prefix: string): Promise<number> {
  const entries = await readdir(dir);
  const backups = entries
    .filter((name) => name.startsWith(prefix) && name.endsWith(".sqlite"))
    .sort()
    .reverse();
  let pruned = 0;
  for (const stale of backups.slice(keep)) {
    await unlink(path.join(dir, stale)).catch(() => {});
    await unlink(path.join(dir, `${stale}.sha256`)).catch(() => {});
    pruned += 1;
  }
  return pruned;
}

async function main(): Promise<void> {
  const sourcePath = resolveDatabasePath();
  await stat(sourcePath); // throws when the file does not exist

  const backupDir = path.resolve(
    process.cwd(),
    process.env.BACKUP_DIR?.trim() || path.join(".data", "backups")
  );
  await mkdir(backupDir, { recursive: true });

  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("") + "-" + [
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const prefix = "platform-backup-";
  const targetPath = path.join(backupDir, `${prefix}${stamp}.sqlite`);

  // VACUUM INTO = consistent online snapshot; the source stays open to
  // the application and is never modified.
  const source = new Database(sourcePath, { readonly: true });
  try {
    source.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }

  // Verification: the backup is only "done" if it opens clean.
  const checksum = await sha256File(targetPath);
  const verify = new Database(targetPath, { readonly: true });
  let integrity = "";
  try {
    integrity = (verify.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  } finally {
    verify.close();
  }
  if (integrity !== "ok") {
    throw new Error(`Backup FAILED integrity check (${integrity}) — do not trust ${targetPath}`);
  }

  await writeFile(path.join(backupDir, `${prefix}${stamp}.sqlite.sha256`), `${checksum}  ${path.basename(targetPath)}\n`, "utf-8");

  const keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 14) || 14);
  const pruned = await pruneOldBackups(backupDir, keep, prefix);
  const sizeBytes = (await stat(targetPath)).size;

  console.log(
    JSON.stringify(
      {
        ok: true,
        backup: targetPath,
        sizeBytes,
        sha256: checksum,
        integrity,
        retentionPruned: pruned,
        takenAtUtc: now.toISOString(),
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error(
    "[backup] FAILED:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
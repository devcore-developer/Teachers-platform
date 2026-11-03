/**
 * Phase 12 — backup verification (read-only, never restores).
 *
 * Usage:  bun scripts/backup/verify-backup.ts <path-to-backup.sqlite>
 *
 * Checks, in order:
 *   1. PRAGMA integrity_check  → structural integrity of every page
 *   2. PRAGMA foreign_key_check → no orphaned rows
 *   3. Row counts of core tables → sanity (all-zero tables usually mean
 *      the wrong file was backed up)
 *
 * This script NEVER writes to the backup or the live database.
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";

const CORE_TABLES = [
  "schools",
  "users",
  "branches",
  "training_programs",
  "courses",
  "course_enrollments",
  "assessments",
  "assignments",
  "assignment_submissions",
  "certificates",
  "surveys",
  "survey_responses",
  "follow_ups",
  "notifications",
  "notification_preferences",
  "email_deliveries",
] as const;

async function main(): Promise<void> {
  const target = process.argv[2]?.trim();
  if (!target) {
    throw new Error("Usage: bun scripts/backup/verify-backup.ts <path-to-backup.sqlite>");
  }
  const backupPath = path.resolve(process.cwd(), target);
  await stat(backupPath); // throws when missing

  const db = new Database(backupPath, { readonly: true });
  try {
    const integrity = (
      db.query("PRAGMA integrity_check").get() as { integrity_check: string }
    ).integrity_check;

    const fkViolations = db.query("PRAGMA foreign_key_check").all() as unknown[];
    if (integrity !== "ok") {
      throw new Error(`integrity_check reported: ${integrity}`);
    }
    if (fkViolations.length > 0) {
      throw new Error(`foreign_key_check reported ${fkViolations.length} violation(s)`);
    }

    const counts: Record<string, number> = {};
    for (const table of CORE_TABLES) {
      const exists = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(table) as { name: string } | null;
      counts[table] = exists
        ? (db.query(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c
        : -1; // -1 = table not present in this backup
    }

    console.log(
      JSON.stringify({ ok: true, backup: backupPath, integrity, foreignKeyViolations: 0, tableCounts: counts }, null, 2)
    );
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error("[backup-verify] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
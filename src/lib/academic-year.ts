import { db } from "@/lib/db";

/* ------------------------------------------------------------------ */
/* Batch 2 — academic year handling (HTML v26 parity).                  */
/*                                                                      */
/* The ORIGINAL platform tagged every course/completion/certificate     */
/* with an academic year ("1448هـ") and allowed the office to start a   */
/* new year and archive the old one. The active year lives in the       */
/* SystemSetting table (key "academicYear.active") — created on demand  */
/* so existing databases keep working without a seed step.              */
/* ------------------------------------------------------------------ */

export const ACADEMIC_YEAR_SETTING_KEY = "academicYear.active";

/** The original platform's year — the default until the office changes it. */
export const DEFAULT_ACADEMIC_YEAR = "1448هـ";

/** Loose validation: digits + the هـ suffix (e.g. 1448هـ, 1449هـ). */
export function normalizeAcademicYear(raw: string): string | null {
  const value = raw.trim();
  if (!/^\d{4}هـ$/.test(value)) return null;
  const number = Number(value.slice(0, 4));
  if (number < 1400 || number > 1500) return null;
  return value;
}

/** Read the active academic year, creating the setting row on demand. */
export async function getActiveAcademicYear(): Promise<string> {
  const setting = await db.systemSetting.findUnique({
    where: { key: ACADEMIC_YEAR_SETTING_KEY },
  });
  return setting?.value ?? DEFAULT_ACADEMIC_YEAR;
}

/**
 * Start a new academic year (HTML v26StartYear). Returns the normalized
 * value or null when the input is not a valid year string.
 */
export async function setActiveAcademicYear(
  raw: string
): Promise<{ ok: true; year: string } | { ok: false; message: string }> {
  const year = normalizeAcademicYear(raw);
  if (!year) {
    return {
      ok: false,
      message: "صيغة العام الدراسي غير صحيحة — مثال صحيح: 1449هـ",
    };
  }
  await db.systemSetting.upsert({
    where: { key: ACADEMIC_YEAR_SETTING_KEY },
    create: { key: ACADEMIC_YEAR_SETTING_KEY, value: year },
    update: { value: year },
  });
  return { ok: true, year };
}
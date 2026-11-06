/**
 * Batch 3 — platform-level settings backed by the EXISTING SystemSetting
 * key/value table (no schema change, no migration).
 *
 * Keys (stable, documented):
 *   platform.name          — displayed platform identity (default: منارة)
 *   platform.tagline       — displayed tagline (default: مكتب التطوير التربوي)
 *   platform.supportEmail  — optional support contact
 *   academicYear.active    — the active academic year consumed by the
 *                            training-archive service (pre-existing key)
 *
 * Reads degrade gracefully: a database hiccup returns the built-in
 * defaults instead of crashing layout/pages. Writes are performed ONLY
 * by the SUPER_ADMIN server action (src/app/actions/platform-settings.ts).
 */
import { db } from "@/lib/db";

export interface PlatformSettings {
  platformName: string;
  platformTagline: string;
  supportEmail: string;
  activeAcademicYear: string;
}

export const PLATFORM_SETTING_KEYS = {
  platformName: "platform.name",
  platformTagline: "platform.tagline",
  supportEmail: "platform.supportEmail",
  activeAcademicYear: "academicYear.active",
} as const;

/** Built-in fallbacks — identical to the shipped config branding. */
const DEFAULTS: PlatformSettings = {
  platformName: "منارة",
  platformTagline: "مكتب التطوير التربوي",
  supportEmail: "",
  activeAcademicYear: "",
};

export async function getPlatformSettings(): Promise<PlatformSettings> {
  try {
    const rows = await db.systemSetting.findMany({
      where: { key: { in: Object.values(PLATFORM_SETTING_KEYS) } },
      select: { key: true, value: true },
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    return {
      platformName:
        byKey.get(PLATFORM_SETTING_KEYS.platformName)?.trim() ||
        DEFAULTS.platformName,
      platformTagline:
        byKey.get(PLATFORM_SETTING_KEYS.platformTagline)?.trim() ||
        DEFAULTS.platformTagline,
      supportEmail:
        byKey.get(PLATFORM_SETTING_KEYS.supportEmail)?.trim() ??
        DEFAULTS.supportEmail,
      activeAcademicYear:
        byKey.get(PLATFORM_SETTING_KEYS.activeAcademicYear)?.trim() ??
        DEFAULTS.activeAcademicYear,
    };
  } catch {
    // Never let a settings read break a page render.
    return { ...DEFAULTS };
  }
}

/** Low-level upsert used by the SUPER_ADMIN server action. */
export async function savePlatformSetting(
  key: string,
  value: string
): Promise<void> {
  await db.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
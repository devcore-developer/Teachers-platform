import { db } from "@/lib/db";
import { canAdministerSchool } from "@/lib/auth/roles";
import { defaultBranding } from "@/config/branding";
import type { PlatformBranding } from "@/lib/types";
import {
  adjustLightness,
  buildBrandRamp,
  hexToHsl,
  hslToHex,
  normalizeHex,
  readableForeground,
  softTint,
} from "@/lib/branding/colors";

/* ------------------------------------------------------------------ */
/* Dynamic multi-school branding — server resolution layer.             */
/*                                                                      */
/* Identity is split in two:                                            */
/*   • Platform identity: «منارة — مكتب التطوير التربوي» (constant).    */
/*   • School identity:    «منارة {اسم المدرسة}» + logo + palette,      */
/*     loaded from the School row of the authenticated user, or from    */
/*     the school context of a public page (login ?school=, register    */
/*     /register/{slug}).                                               */
/*                                                                      */
/* Colors reach the UI as CSS variables on a wrapper element; the       */
/* design system already resolves every brand-* utility through those   */
/* variables, so shared components never hardcode a school color.       */
/* Server components under the app render this module ONLY — never      */
/* import it from a client component (db access).                       */
/* ------------------------------------------------------------------ */

/** Display fallback for schools without a custom tagline. */
export const SCHOOL_DEFAULT_SUBTITLE = "منصة التنمية المهنية للمعلمين";

/** The palette used by «restore defaults» — the platform blue family. */
export const PLATFORM_DEFAULT_COLORS = {
  primary: "#1D5BD6",
  secondary: "#2AA5C0",
  accent: "#E8A13A",
  neutral: "#1E2A4A",
} as const;

/** Branding fields of a school — the ONLY columns this feature reads. */
export interface SchoolBrandingRecord {
  id: string;
  nameAr: string;
  slug: string;
  isActive: boolean;
  logoUrl: string | null;
  brandColor: string;
  brandColorSecondary: string | null;
  brandColorAccent: string | null;
  brandColorNeutral: string | null;
  brandTagline: string | null;
}

export interface ResolvedBranding {
  /** "school" when a real school context was resolved, else platform. */
  scope: "platform" | "school";
  school: { id: string; name: string; slug: string } | null;
  /** Ready-to-pass branding for existing shell components. */
  branding: PlatformBranding;
  /** CSS variables for a wrapper element (empty for platform scope). */
  cssVars: Record<string, string>;
  /** Fully resolved palette (after derivation) — for settings UIs. */
  colors: { primary: string; secondary: string; accent: string; neutral: string };
  tagline: string | null;
}

/** Defensively keep the deep-surface (sidebar) color dark enough for
 * the light sidebar text that the design system renders on it. */
function ensureDarkSurface(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  if (l <= 38) return normalizeHex(hex) ?? PLATFORM_DEFAULT_COLORS.neutral;
  return hslToHex(h, s, Math.min(l, 30));
}

/** Build the resolved branding from raw school columns (pure). */
export function resolveSchoolBranding(
  school: SchoolBrandingRecord | null
): ResolvedBranding {
  if (!school) {
    return {
      scope: "platform",
      school: null,
      branding: defaultBranding,
      cssVars: {},
      colors: { ...PLATFORM_DEFAULT_COLORS },
      tagline: null,
    };
  }

  const primary = normalizeHex(school.brandColor) ?? PLATFORM_DEFAULT_COLORS.primary;
  const secondary =
    normalizeHex(school.brandColorSecondary) ?? adjustLightness(hslToHex(hexToHsl(primary).h + 32, 55, 52), 0);
  const accent =
    normalizeHex(school.brandColorAccent) ?? hslToHex(hexToHsl(primary).h + 180, 62, 55);
  const neutral = ensureDarkSurface(
    normalizeHex(school.brandColorNeutral) ?? hslToHex(hexToHsl(primary).h, hexToHsl(primary).s * 0.55, 22)
  );

  const ramp = buildBrandRamp(primary);
  const productName = `منارة ${school.nameAr}`.replace(/\s+/g, " ").trim();
  const subtitle = school.brandTagline?.trim() || SCHOOL_DEFAULT_SUBTITLE;

  const branding: PlatformBranding = {
    productName,
    subtitle,
    shortName: "منارة",
    logoUrl: school.logoUrl ?? undefined,
    currentSchool: {
      id: school.id,
      name: school.nameAr,
      logoUrl: school.logoUrl ?? undefined,
      branches: [],
      stages: [],
    },
  };

  const cssVars: Record<string, string> = {
    "--brand-50": ramp["50"],
    "--brand-100": ramp["100"],
    "--brand-200": ramp["200"],
    "--brand-300": ramp["300"],
    "--brand-500": ramp["500"],
    "--brand-600": ramp["600"],
    "--brand-700": ramp["700"],
    "--brand-800": ramp["800"],
    "--brand-900": ramp["900"],
    "--brand-cyan": secondary,
    "--brand-cyan-soft": softTint(secondary),
    "--primary": primary,
    "--primary-foreground": readableForeground(primary),
    "--ring": ramp["500"],
    "--school-accent": accent,
    "--school-neutral": neutral,
    "--sidebar": neutral,
    "--sidebar-accent": adjustLightness(neutral, 8),
    "--sidebar-border": adjustLightness(neutral, 6),
    "--sidebar-primary": secondary,
    "--sidebar-ring": ramp["500"],
  };

  return {
    scope: "school",
    school: { id: school.id, name: school.nameAr, slug: school.slug },
    branding,
    cssVars,
    colors: { primary, secondary, accent, neutral },
    tagline: school.brandTagline,
  };
}

const BRANDING_SELECT = {
  id: true,
  nameAr: true,
  slug: true,
  isActive: true,
  logoUrl: true,
  brandColor: true,
  brandColorSecondary: true,
  brandColorAccent: true,
  brandColorNeutral: true,
  brandTagline: true,
} as const;

/** Active-school lookup by id — public branding fields only. */
export async function getActiveSchoolBrandingById(
  id: string | null | undefined
): Promise<ResolvedBranding> {
  if (!id) return resolveSchoolBranding(null);
  try {
    const school = await db.school.findUnique({
      where: { id },
      select: BRANDING_SELECT,
    });
    if (!school || !school.isActive) return resolveSchoolBranding(null);
    return resolveSchoolBranding(school);
  } catch {
    return resolveSchoolBranding(null);
  }
}

/** Active-school lookup by slug — used by /register/{slug}. */
export async function getActiveSchoolBrandingBySlug(
  slug: string | null | undefined
): Promise<ResolvedBranding> {
  if (!slug) return resolveSchoolBranding(null);
  try {
    const school = await db.school.findUnique({
      where: { slug },
      select: BRANDING_SELECT,
    });
    if (!school || !school.isActive) return resolveSchoolBranding(null);
    return resolveSchoolBranding(school);
  } catch {
    return resolveSchoolBranding(null);
  }
}

/**
 * Public-page resolution (login ?school=): accepts a slug OR an id.
 * Only public branding data is ever returned, so exposing it on a URL
 * cannot leak tenant data or bypass isolation.
 */
export async function resolvePublicBranding(
  schoolParam: string | null | undefined
): Promise<ResolvedBranding> {
  const value = (schoolParam ?? "").trim().slice(0, 120);
  if (!value) return resolveSchoolBranding(null);
  const bySlug = await getActiveSchoolBrandingBySlug(value);
  if (bySlug.scope === "school") return bySlug;
  return getActiveSchoolBrandingById(value);
}

/**
 * Branding for the whole app shell: the signed-in user's school wins;
 * anonymous or platform-level sessions get the platform identity.
 */
export async function resolveViewerBranding(user: {
  schoolId: string | null;
} | null): Promise<ResolvedBranding> {
  return getActiveSchoolBrandingById(user?.schoolId ?? null);
}

/* ------------------------------------------------------------------ */
/* Authorization                                                        */
/* ------------------------------------------------------------------ */

export type BrandingTargetResolution =
  | { ok: true; schoolId: string | null }
  | { ok: false; code: "FORBIDDEN" | "NO_SCHOOL" | "TENANT_MISMATCH" };

/**
 * Which school may the caller manage branding for?
 *  - SUPER_ADMIN: any school (requested id, or their own when set).
 *  - DEVELOPMENT_OFFICE_MANAGER: strictly their own school — a
 *    requested id for a different tenant is a hard rejection.
 *  - everyone else: rejected (fail-closed).
 * The result is resolved from the SESSION only; client input can never
 * widen the tenant scope.
 */
export function resolveManageableSchoolId(
  user: { role: string; schoolId: string | null } | null,
  requestedSchoolId?: string | null
): BrandingTargetResolution {
  if (!user || !canAdministerSchool(user.role)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const requested = (requestedSchoolId ?? "").trim() || null;

  if (user.role === "SUPER_ADMIN") {
    return { ok: true, schoolId: requested ?? user.schoolId ?? null };
  }
  if (!user.schoolId) return { ok: false, code: "NO_SCHOOL" };
  if (requested && requested !== user.schoolId) {
    return { ok: false, code: "TENANT_MISMATCH" };
  }
  return { ok: true, schoolId: user.schoolId };
}
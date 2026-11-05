import type { PlatformBranding } from "@/lib/types";

/**
 * Platform identity (NOT a school identity).
 *
 * The platform is a multi-school system: «منارة» is the product operated
 * by «مكتب التطوير التربوي», while every school tenant (قرطبة، الأندلس،
 * النور…) carries its own name, logo and colors loaded dynamically from
 * the database — see src/lib/branding.ts.
 *
 * This object is the FALLBACK identity shown when no school context is
 * resolved (platform-level sessions, public pages without a school
 * parameter). No component may hardcode a school name — always read the
 * resolved branding instead.
 */
export const defaultBranding: PlatformBranding = {
  productName: "منارة",
  subtitle: "مكتب التطوير التربوي",
  shortName: "منارة",
  logoUrl: undefined,
  currentSchool: undefined,
};

/**
 * Default school palette (the platform blue family) — used by the
 * branding manager for «restore defaults» and initial suggestions.
 * Keep in sync with the hand-tuned tokens in globals.css.
 */
export const PLATFORM_DEFAULT_COLORS = {
  primary: "#1D5BD6",
  secondary: "#2AA5C0",
  accent: "#E8A13A",
  neutral: "#1E2A4A",
} as const;
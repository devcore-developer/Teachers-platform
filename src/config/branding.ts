import type { PlatformBranding } from "@/lib/types";

/**
 * Default platform branding.
 *
 * The platform is designed as a multi-school system: every school will
 * eventually carry its own name, logo, branches and educational stages.
 * The object below is the fallback identity used until per-school
 * configuration is introduced in a later phase. No component should
 * hardcode a school name — always read from this config (or, in the
 * future, from the active tenant context).
 */
export const defaultBranding: PlatformBranding = {
  productName: "منارة قرطبة",
  subtitle: "منصة التنمية المهنية للمعلمين",
  shortName: "منارة",
  logoUrl: undefined,
  currentSchool: undefined,
};
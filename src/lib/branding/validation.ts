import { z } from "zod";

import { normalizeHex } from "@/lib/branding/colors";

/* ------------------------------------------------------------------ */
/* Validation for school branding — pure Zod, no server imports, so    */
/* both the server actions and the verification harness share one      */
/* source of truth.                                                    */
/* ------------------------------------------------------------------ */

const hexField = (label: string) =>
  z
    .string()
    .trim()
    .max(9, `${label}: قيمة لون غير صالحة`)
    .refine((v) => v === "" || normalizeHex(v) !== null, {
      message: `${label}: أدخل لونًا بصيغة #RRGGBB`,
    })
    .transform((v) => (v === "" ? null : normalizeHex(v)));

export const schoolBrandingSchema = z.object({
  /** SUPER_ADMIN only — the school being edited. Ignored for others. */
  schoolId: z.string().trim().min(1).max(64).optional(),
  /** Displayed school name (Arabic). Optional edit. */
  nameAr: z
    .string()
    .trim()
    .min(2, "اسم المدرسة قصير جدًا")
    .max(80, "اسم المدرسة طويل جدًا")
    .optional(),
  /** Optional tagline shown under the school name (empty clears it). */
  tagline: z.string().trim().max(120, "الوصف طويل جدًا (120 حرفًا كحد أقصى)").optional(),
  primary: hexField("اللون الأساسي"),
  secondary: hexField("اللون الثانوي"),
  accent: hexField("لون التمييز"),
  neutral: hexField("اللون المساند"),
  /** Remove the current logo (mutually exclusive with logoUrl). */
  removeLogo: z.boolean().optional(),
});

export type SchoolBrandingInput = z.infer<typeof schoolBrandingSchema>;

/** Allowed logo mime types — SVG is deliberately NOT uploadable. */
export const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2MB

export function logoExtensionFor(mime: string): string | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}
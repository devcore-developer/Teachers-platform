import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Educational stages                                                  */
/* ------------------------------------------------------------------ */

/** Canonical stage keys persisted in the database. */
export const BRANCH_STAGES = ["primary", "intermediate", "secondary"] as const;

export type BranchStage = (typeof BRANCH_STAGES)[number];

/** Arabic labels for the canonical stage keys (UI only — never stored). */
export const BRANCH_STAGE_LABELS: Record<BranchStage, string> = {
  primary: "المرحلة الابتدائية",
  intermediate: "المرحلة الإعدادية",
  secondary: "المرحلة الثانوية",
};

export function branchStageLabel(stage: string): string {
  return BRANCH_STAGE_LABELS[stage as BranchStage] ?? stage;
}

/* ------------------------------------------------------------------ */
/* Normalization helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * Normalize a free-text name: trim, collapse internal whitespace and
 * lowercase (no case for Arabic — affects Latin only). Used for the
 * in-school branch uniqueness strategy, both in application checks and
 * in the DB-level unique constraint on `Branch.nameNorm`.
 */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Build a URL-friendly slug from an English name. Arabic names cannot
 * produce Latin slugs, so callers fall back to a generated suffix when
 * only an Arabic name is available.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Random suffix fallback used when no English name exists to slugify. */
export function generateFallbackSlug(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `school-${random}`;
}

/** Resolve the final slug from optional user input + both names. */
export function resolveSlug(
  slugInput: string | undefined,
  nameEn: string | undefined
): string {
  const explicit = slugInput?.trim();
  if (explicit) return explicit;
  const fromEnglish = nameEn ? slugify(nameEn) : "";
  if (fromEnglish.length >= 2) return fromEnglish;
  return generateFallbackSlug();
}

/* ------------------------------------------------------------------ */
/* Shared field rules                                                  */
/* ------------------------------------------------------------------ */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;

const nameArField = z
  .string({ message: "الاسم بالعربية مطلوب" })
  .trim()
  .min(2, "الاسم بالعربية يجب ألا يقل عن حرفين")
  .max(120, "الاسم بالعربية طويل جدًا (الحد الأقصى 120 حرفًا)");

const nameEnField = z
  .string()
  .trim()
  .max(120, "الاسم بالإنجليزية طويل جدًا (الحد الأقصى 120 حرفًا)")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const slugField = z
  .string()
  .trim()
  .max(64, "الرابط المختصر طويل جدًا (الحد الأقصى 64 حرفًا)")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((v) => v === undefined || SLUG_PATTERN.test(v), {
    message:
      "الرابط المختصر يجب أن يحتوي على حروف إنجليزية صغيرة وأرقام وشرطات فقط (مثال: qurtuba-school)",
  });

const logoUrlField = z
  .string()
  .trim()
  .max(500, "رابط الشعار طويل جدًا")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((v) => v === undefined || URL_PATTERN.test(v), {
    message: "رابط الشعار غير صالح — يجب أن يبدأ بـ http:// أو https://",
  });

const brandColorField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((v) => v === undefined || HEX_COLOR_PATTERN.test(v), {
    message: "لون الهوية يجب أن يكون بصيغة #RRGGBB (مثال: #1D5BD6)",
  });

const isActiveField = z.boolean().default(true);

/* ------------------------------------------------------------------ */
/* School schemas                                                      */
/* ------------------------------------------------------------------ */

export const createSchoolSchema = z.object({
  nameAr: nameArField,
  nameEn: nameEnField,
  slug: slugField,
  logoUrl: logoUrlField,
  brandColor: brandColorField,
  isActive: isActiveField,
});

export const updateSchoolSchema = z.object({
  id: z.string().min(1, "معرّف المدرسة مطلوب"),
  nameAr: nameArField,
  nameEn: nameEnField,
  slug: slugField,
  logoUrl: logoUrlField,
  brandColor: brandColorField,
});

export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;
export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;

/* ------------------------------------------------------------------ */
/* Branch schemas                                                      */
/* ------------------------------------------------------------------ */

export const createBranchSchema = z.object({
  schoolId: z.string().min(1, "معرّف المدرسة مطلوب"),
  nameAr: nameArField,
  nameEn: nameEnField,
  stage: z.enum(BRANCH_STAGES, { message: "المرحلة التعليمية مطلوبة" }),
  isActive: isActiveField,
});

export const updateBranchSchema = z.object({
  schoolId: z.string().min(1, "معرّف المدرسة مطلوب"),
  branchId: z.string().min(1, "معرّف الفرع مطلوب"),
  nameAr: nameArField,
  nameEn: nameEnField,
  stage: z.enum(BRANCH_STAGES, { message: "المرحلة التعليمية مطلوبة" }),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

/* ------------------------------------------------------------------ */
/* Result helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Convert a ZodError into a flat field → Arabic message map using only
 * `error.issues` (stable across Zod major versions).
 */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/** Uniform service-layer result consumed by actions, UI and tests. */
export type ServiceResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** Arabic, user-facing error message. */
      message: string;
      fieldErrors?: Record<string, string>;
      code?: "VALIDATION_ERROR" | "DUPLICATE_SLUG" | "DUPLICATE_BRANCH" | "NOT_FOUND" | "RELATION_ERROR" | "FORBIDDEN";
    };
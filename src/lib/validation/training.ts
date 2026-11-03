import { z } from "zod";

import {
  ALLOWED_DOCUMENT_MIME,
  ALLOWED_IMAGE_MIME,
  ALLOWED_VIDEO_MIME,
  ATTACHMENT_KINDS,
  CONTENT_STATUSES,
  COURSE_LEVELS,
  EXTERNAL_VIDEO_HOSTS,
  LESSON_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  TRAINING_CATEGORIES,
} from "@/config/training";
import { normalizeName, zodFieldErrors } from "@/lib/validation/schools";

export { normalizeName, zodFieldErrors };

/* ------------------------------------------------------------------ */
/* Phase 5 — training academy validation.                               */
/*                                                                      */
/* Every write goes through these schemas; canonical keys (category,    */
/* status, lesson type) are validated against the config lists. The     */
/* service layer re-checks ownership/relations — validation here is     */
/* shape only, authorization never lives in the client.                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* External video URL policy                                            */
/* ------------------------------------------------------------------ */

/**
 * True when the URL is https AND its host is on the allow-list.
 * The server never fetches arbitrary external URLs — this gate keeps
 * embedded players to YouTube/Vimeo only.
 */
export function isAllowedExternalVideoUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return (EXTERNAL_VIDEO_HOSTS as readonly string[]).includes(
      url.hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Shared field rules                                                   */
/* ------------------------------------------------------------------ */

const titleArField = z
  .string({ message: "العنوان بالعربية مطلوب" })
  .trim()
  .min(3, "العنوان بالعربية يجب ألا يقل عن 3 أحرف")
  .max(150, "العنوان بالعربية طويل جدًا (الحد الأقصى 150 حرفًا)");

const titleEnField = z
  .string()
  .trim()
  .max(150, "العنوان بالإنجليزية طويل جدًا (الحد الأقصى 150 حرفًا)")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const descriptionArField = z
  .string({ message: "الوصف بالعربية مطلوب" })
  .trim()
  .min(10, "الوصف بالعربية يجب ألا يقل عن 10 أحرف")
  .max(4000, "الوصف بالعربية طويل جدًا (الحد الأقصى 4000 حرف)");

const descriptionEnField = z
  .string()
  .trim()
  .max(4000, "الوصف بالإنجليزية طويل جدًا (الحد الأقصى 4000 حرف)")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const categoryField = z.enum(TRAINING_CATEGORIES, {
  message: "التصنيف مطلوب — اختر تصنيفًا من القائمة",
});

const levelField = z
  .enum(COURSE_LEVELS, { message: "مستوى الصعوبة غير صالح" })
  .optional();

const estimatedHoursField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z
    .number({ message: "المدة التقديرية يجب أن تكون رقمًا" })
    .int("المدة التقديرية يجب أن تكون عددًا صحيحًا")
    .min(1, "أقل مدة مقبولة ساعة واحدة")
    .max(500, "المدة التقديرية طويلة جدًا (الحد الأقصى 500 ساعة)")
    .optional()
);

const idField = (label: string) =>
  z.string({ message: `${label} مطلوب` }).min(1, `${label} مطلوب`);

const optionalIdField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

/** "platform" | "school" — the service derives the real schoolId. */
const scopeField = z.enum(["platform", "school"], {
  message: "نطاق المحتوى غير صالح",
});

const schoolIdField = optionalIdField;

const statusField = z.enum(CONTENT_STATUSES, {
  message: "الحالة غير صالحة",
});

const descriptionShortField = z
  .string()
  .trim()
  .max(500, "الوصف المختصر طويل جدًا (الحد الأقصى 500 حرف)")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const videoUrlField = z
  .string()
  .trim()
  .max(500, "رابط الفيديو طويل جدًا")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine((v) => v === undefined || isAllowedExternalVideoUrl(v), {
    message:
      "رابط الفيديو الخارجي غير مسموح — YouTube أو Vimeo عبر https فقط",
  });

const attachmentIdField = optionalIdField;

const contentField = z
  .string()
  .max(20000, "نص الدرس طويل جدًا (الحد الأقصى 20000 حرف)")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const isPublishedField = z.boolean().default(false);

/* ------------------------------------------------------------------ */
/* Program schemas                                                      */
/* ------------------------------------------------------------------ */

/**
 * NOTE: schoolId is NOT required at the schema level — the owning school
 * is derived SERVER-SIDE in resolveScope(): office managers are pinned to
 * their own school, and SUPER_ADMIN must pick one for school-scoped
 * content (validated there). Never trust a client-supplied school id.
 */
export const createProgramSchema = z.object({
  nameAr: titleArField,
  nameEn: titleEnField,
  descriptionAr: descriptionArField,
  descriptionEn: descriptionEnField,
  category: categoryField,
  scope: scopeField,
  schoolId: schoolIdField,
});

export const updateProgramSchema = createProgramSchema.extend({
  programId: idField("معرّف البرنامج"),
});

export const setProgramStatusSchema = z.object({
  programId: idField("معرّف البرنامج"),
  status: statusField,
});

/* ------------------------------------------------------------------ */
/* Course schemas                                                       */
/* ------------------------------------------------------------------ */

export const createCourseSchema = z.object({
  titleAr: titleArField,
  titleEn: titleEnField,
  descriptionAr: descriptionArField,
  descriptionEn: descriptionEnField,
  category: categoryField,
  programId: optionalIdField,
  level: levelField,
  estimatedHours: estimatedHoursField,
  instructorId: optionalIdField,
  scope: scopeField,
  schoolId: schoolIdField,
});

export const updateCourseSchema = createCourseSchema.extend({
  courseId: idField("معرّف الدورة"),
});

export const setCourseStatusSchema = z.object({
  courseId: idField("معرّف الدورة"),
  status: statusField,
});

/* ------------------------------------------------------------------ */
/* Section schemas                                                      */
/* ------------------------------------------------------------------ */

const sectionTitleField = z
  .string({ message: "عنوان القسم مطلوب" })
  .trim()
  .min(2, "عنوان القسم يجب ألا يقل عن حرفين")
  .max(150, "عنوان القسم طويل جدًا (الحد الأقصى 150 حرفًا)");

export const createSectionSchema = z.object({
  courseId: idField("معرّف الدورة"),
  titleAr: sectionTitleField,
  description: descriptionShortField,
});

export const updateSectionSchema = createSectionSchema.extend({
  sectionId: idField("معرّف القسم"),
});

export const moveSectionSchema = z.object({
  courseId: idField("معرّف الدورة"),
  sectionId: idField("معرّف القسم"),
  direction: z.enum(["up", "down"], { message: "اتجاه الترتيب غير صالح" }),
});

/* ------------------------------------------------------------------ */
/* Lesson schemas — type-conditional requirements                       */
/* ------------------------------------------------------------------ */

export const createLessonSchema = z
  .object({
    courseId: idField("معرّف الدورة"),
    sectionId: idField("معرّف القسم"),
    titleAr: titleArField,
    description: descriptionShortField,
    type: z.enum(LESSON_TYPES, { message: "نوع الدرس مطلوب" }),
    content: contentField,
    videoUrl: videoUrlField,
    attachmentId: attachmentIdField,
    isPublished: isPublishedField,
  })
  .superRefine((v, ctx) => {
    if (v.type === "TEXT" && !v.content) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: "محتوى الدرس النصي مطلوب",
      });
    }
    if (v.type === "EXTERNAL_VIDEO" && !v.videoUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["videoUrl"],
        message: "رابط الفيديو الخارجي مطلوب",
      });
    }
    if ((v.type === "VIDEO" || v.type === "RESOURCE") && !v.attachmentId) {
      ctx.addIssue({
        code: "custom",
        path: ["attachmentId"],
        message: "ارفع الملف أولًا ثم احفظ الدرس",
      });
    }
  });

export const updateLessonSchema = createLessonSchema.and(
  z.object({
    lessonId: idField("معرّف الدرس"),
  })
);

export const moveLessonSchema = z.object({
  courseId: idField("معرّف الدورة"),
  lessonId: idField("معرّف الدرس"),
  direction: z.enum(["up", "down"], { message: "اتجاه الترتيب غير صالح" }),
});

/* ------------------------------------------------------------------ */
/* Enrollment                                                           */
/* ------------------------------------------------------------------ */

export const enrollSchema = z.object({
  courseId: idField("معرّف الدورة"),
});

/* ------------------------------------------------------------------ */
/* Upload validation — server-side type & size enforcement              */
/* ------------------------------------------------------------------ */

export interface UploadValidationInput {
  kind: (typeof ATTACHMENT_KINDS)[number] | "VIDEO";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export type UploadValidationResult =
  | { ok: true }
  | { ok: false; message: string };

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} ميغابايت`;
}

/**
 * Enforce allowed MIME types and size caps per upload kind. MIME is the
 * browser-declared content type; the file-serving route never executes
 * uploads (inline rendering with explicit content types only), so this
 * accept-list plus size caps is the server-side gate.
 */
export function validateUpload(
  input: UploadValidationInput
): UploadValidationResult {
  const mimeType = input.mimeType.toLowerCase();
  const sizeBytes = input.sizeBytes;

  if (kindIs(input.kind, "COVER")) {
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(mimeType)) {
      return {
        ok: false,
        message: "صورة الغلاف يجب أن تكون بصيغة PNG أو JPG أو WebP",
      };
    }
    if (sizeBytes <= 0) return { ok: false, message: "الملف فارغ" };
    if (sizeBytes > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        message: `حجم صورة الغلاف يتجاوز الحد المسموح (${mb(MAX_IMAGE_BYTES)})`,
      };
    }
    return { ok: true };
  }

  if (kindIs(input.kind, "VIDEO")) {
    if (!(ALLOWED_VIDEO_MIME as readonly string[]).includes(mimeType)) {
      return {
        ok: false,
        message: "الفيديو المرفوع يجب أن يكون بصيغة MP4 أو WebM",
      };
    }
    if (sizeBytes <= 0) return { ok: false, message: "الملف فارغ" };
    if (sizeBytes > MAX_VIDEO_BYTES) {
      return {
        ok: false,
        message: `حجم الفيديو يتجاوز الحد المسموح (${mb(MAX_VIDEO_BYTES)})`,
      };
    }
    return { ok: true };
  }

  // RESOURCE — documents and media allowed as downloadable resources.
  if (!(ALLOWED_DOCUMENT_MIME as readonly string[]).includes(mimeType)) {
    return {
      ok: false,
      message:
        "نوع الملف غير مسموح — المسموح: PDF، Word، Excel، PowerPoint، صور، نص، فيديو MP4/WebM",
    };
  }
  if (sizeBytes <= 0) return { ok: false, message: "الملف فارغ" };
  // Videos uploaded as lesson resources follow the video size cap.
  const cap = (ALLOWED_VIDEO_MIME as readonly string[]).includes(mimeType)
    ? MAX_VIDEO_BYTES
    : MAX_DOCUMENT_BYTES;
  if (sizeBytes > cap) {
    return {
      ok: false,
      message: `حجم الملف يتجاوز الحد المسموح (${mb(cap)})`,
    };
  }
  return { ok: true };
}

function kindIs(
  kind: UploadValidationInput["kind"],
  target: (typeof ATTACHMENT_KINDS)[number] | "VIDEO"
): boolean {
  return kind === target;
}

/* ------------------------------------------------------------------ */
/* Result type                                                          */
/* ------------------------------------------------------------------ */

export type TrainingErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "RELATION_ERROR"
  | "DUPLICATE"
  | "PUBLISH_BLOCKED"
  | "INVALID_FILE";

/** Uniform service-layer result consumed by actions, UI and tests. */
export type TrainingResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** Arabic, user-facing error message. */
      message: string;
      fieldErrors?: Record<string, string>;
      code?: TrainingErrorCode;
    };

export function normalizeContentName(value: string): string {
  return normalizeName(value);
}
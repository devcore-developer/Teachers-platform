/**
 * Phase 7 — Zod validation for assignments, submissions and review.
 *
 * Every write path re-validates its raw input here (Arabic messages),
 * mirroring the Phase 6 validation layer. Client payloads are NEVER
 * trusted: ids, scores, statuses and dates are all re-checked.
 *
 * Version note: written against the zod v3/v4 COMMON API subset — no
 * `required_error` / `invalid_type_error` / `errorMap` params (removed
 * in v4) and no `z.undefined()` inside unions (v4 runtime rejects it).
 */
import { z } from "zod";

import {
  AUDIENCE_MODES,
  MAX_CRITERION_POINTS,
  MAX_DESCRIPTION_LENGTH,
  MAX_FEEDBACK_LENGTH,
  MAX_RUBRIC_CRITERIA,
  MAX_SUBMISSION_TEXT,
  MAX_TARGET_IDS,
  MAX_TITLE_LENGTH,
} from "@/config/assignments";

/* ------------------------------------------------------------------ */
/* Result contract (same shape as the assessment layer)                 */
/* ------------------------------------------------------------------ */

export type AssignmentErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RELATION_ERROR"
  | "PUBLISH_BLOCKED"
  | "DEADLINE_PASSED"
  | "ALREADY_SUBMITTED"
  | "NOT_AVAILABLE"
  | "FILE_INVALID";

export type AssignmentResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      message: string;
      code: AssignmentErrorCode;
      fieldErrors?: Record<string, string>;
    };

export function assignmentFail<T>(
  message: string,
  code: AssignmentErrorCode
): AssignmentResult<T> {
  return { ok: false, message, code };
}

/** Flatten a ZodError into { "path.to.field": "رسالة" } — Arabic msgs live in the schemas. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function validationFail<T>(error: z.ZodError): AssignmentResult<T> {
  return {
    ok: false,
    message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
    code: "VALIDATION_ERROR",
    fieldErrors: zodFieldErrors(error),
  };
}

/* ------------------------------------------------------------------ */
/* Primitive helpers                                                    */
/* ------------------------------------------------------------------ */

const trimmedArabic = (max: number, label: string) =>
  z.preprocess(
    // Missing/non-string form fields degrade to "" so the Arabic
    // required-message below fires (works on zod v3 and v4 alike).
    (value) => (typeof value === "string" ? value : ""),
    z
      .string()
      .trim()
      .min(1, `${label} مطلوب`)
      .max(max, `${label} يتجاوز الحد الأقصى (${max} حرفًا)`)
  );

const optionalTrimmed = (max: number, label: string) =>
  z
    .preprocess(
      // undefined/null/non-string degrade to "" (never z.undefined() inside
      // a union — v4 rejects that shape at runtime; this form is identical
      // on v3 and v4).
      (value) => (typeof value === "string" ? value : ""),
      z.string().trim().max(max, `${label} يتجاوز الحد الأقصى (${max} حرفًا)`)
    )
    .transform((value) => (value.length > 0 ? value : null));

/** Form selects send "" for "none" — normalize to undefined before validation. */
const optionalId = (label: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .trim()
      .max(64, `${label} غير صالح`)
      .optional()
  );

const idList = (max: number) =>
  z
    .array(z.string().trim().min(1).max(64))
    .max(max, `القائمة تتجاوز الحد الأقصى (${max} عنصرًا)`)
    .default([]);

/** Accepts datetime-local strings ("2026-03-01T08:30") and ISO strings. */
const coerceDate = (label: string) =>
  z.preprocess(
    (value) => {
      if (value instanceof Date) return value;
      if (typeof value === "string" && value.trim() !== "") return new Date(value);
      if (typeof value === "number") return new Date(value);
      return undefined;
    },
    z.date().refine((date) => !Number.isNaN(date.getTime()), `${label} غير صالح`)
  );

/** Checkbox payloads arrive as "on"/"true"/"1" — never trust coercion alone. */
const booleanish = z
  .preprocess(
    (value) => value === true || value === "true" || value === "on" || value === 1 || value === "1",
    z.boolean()
  )
  .default(false);

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Assignment management                                                */
/* ------------------------------------------------------------------ */

const rubricCriterionInput = z.object({
  titleAr: trimmedArabic(200, "عنصر التقييم"),
  maxPoints: z
    .number()
    .int("درجة عنصر التقييم يجب أن تكون عددًا صحيحًا")
    .min(1, "أقل درجة للعنصر هي 1")
    .max(MAX_CRITERION_POINTS, `أقصى درجة للعنصر هي ${MAX_CRITERION_POINTS}`),
});

const assignmentCoreFields = {
  titleAr: trimmedArabic(MAX_TITLE_LENGTH, "عنوان التكليف"),
  titleEn: optionalTrimmed(MAX_TITLE_LENGTH, "العنوان بالإنجليزية"),
  descriptionAr: trimmedArabic(MAX_DESCRIPTION_LENGTH, "وصف/تعليمات التكليف"),
  descriptionEn: optionalTrimmed(MAX_DESCRIPTION_LENGTH, "الوصف بالإنجليزية"),
  programId: optionalId("البرنامج التدريبي"),
  courseId: optionalId("الدورة التدريبية"),
  sectionId: optionalId("القسم"),
  lessonId: optionalId("الدرس"),
  audienceMode: z.enum(AUDIENCE_MODES),
  teacherIds: idList(MAX_TARGET_IDS),
  branchIds: idList(MAX_TARGET_IDS),
  dueAt: coerceDate("تاريخ الاستحقاق"),
  allowLate: booleanish,
  lateUntil: coerceDate("نهاية القبول المتأخر").optional(),
} as const;

/** Cross-field business rules shared by create + update. */
function assignmentFormRefinements<
  T extends {
    audienceMode: (typeof AUDIENCE_MODES)[number];
    teacherIds: string[];
    branchIds: string[];
    dueAt: Date;
    lateUntil?: Date | null;
  },
>(input: T, ctx: z.RefinementCtx): void {
  if (input.lateUntil && input.lateUntil.getTime() <= input.dueAt.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "يجب أن تكون نهاية القبول المتأخر بعد تاريخ الاستحقاق",
      path: ["lateUntil"],
    });
  }
  if (input.audienceMode === "TEACHERS" && input.teacherIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "حدد معلمًا واحدًا على الأقل لهذه الفئة",
      path: ["teacherIds"],
    });
  }
  if (input.audienceMode === "BRANCHES" && input.branchIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "حدد فرعًا واحدًا على الأقل لهذه الفئة",
      path: ["branchIds"],
    });
  }
}

export const createAssignmentSchema = z
  .object(assignmentCoreFields)
  .superRefine(assignmentFormRefinements);

export const updateAssignmentSchema = z
  .object({
    assignmentId: z.string().trim().min(1, "معرّف التكليف مطلوب"),
    ...assignmentCoreFields,
  })
  .superRefine(assignmentFormRefinements);

export const setAssignmentStatusSchema = z.object({
  assignmentId: z.string().trim().min(1, "معرّف التكليف مطلوب"),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"]),
});

export const saveRubricSchema = z.object({
  assignmentId: z.string().trim().min(1, "معرّف التكليف مطلوب"),
  criteria: z
    .array(rubricCriterionInput)
    .max(MAX_RUBRIC_CRITERIA, `الحد الأقصى ${MAX_RUBRIC_CRITERIA} عناصر تقييم`),
});

/* ------------------------------------------------------------------ */
/* Teacher workspace                                                    */
/* ------------------------------------------------------------------ */

const submissionText = z
  .string()
  .max(MAX_SUBMISSION_TEXT, `نص التسليم يتجاوز الحد الأقصى (${MAX_SUBMISSION_TEXT} حرفًا)`)
  .default("");

export const saveSubmissionDraftSchema = z.object({
  assignmentId: z.string().trim().min(1, "معرّف التكليف مطلوب"),
  responseText: submissionText,
});

export const submitSubmissionSchema = z.object({
  assignmentId: z.string().trim().min(1, "معرّف التكليف مطلوب"),
  responseText: submissionText,
});

export const deleteSubmissionFileSchema = z.object({
  fileId: z.string().trim().min(1, "معرّف الملف مطلوب"),
});

/* ------------------------------------------------------------------ */
/* Review & grading                                                     */
/* ------------------------------------------------------------------ */

export const rubricScoreInput = z.object({
  criterionId: z.string().trim().min(1, "عنصر التقييم مطلوب"),
  points: z
    .number()
    .int("الدرجات أعداد صحيحة فقط")
    .min(0, "لا يمكن منح درجات سالبة"),
});

export const gradeSubmissionSchema = z
  .object({
    submissionId: z.string().trim().min(1, "معرّف التسليم مطلوب"),
    feedbackText: optionalTrimmed(MAX_FEEDBACK_LENGTH, "التغذية الراجعة"),
    scores: z.array(rubricScoreInput).max(50, "قائمة الدرجات طويلة جدًا").default([]),
    directScore: z.preprocess(
      (value) =>
        value === "" || value === null || value === undefined ? undefined : value,
      z.coerce
        .number()
        .int("الدرجة المباشرة يجب أن تكون عددًا صحيحًا")
        .min(0, "لا يمكن منح درجات سالبة")
        .optional()
    ),
  })
  .refine((input) => input.scores.length > 0 || input.directScore !== undefined, {
    message: "أدخل درجات عناصر التقييم أو درجة مباشرة",
    path: ["scores"],
  });

export const returnSubmissionSchema = z.object({
  submissionId: z.string().trim().min(1, "معرّف التسليم مطلوب"),
  feedbackText: trimmedArabic(MAX_FEEDBACK_LENGTH, "سبب الإعادة / التغذية الراجعة"),
});

export const markUnderReviewSchema = z.object({
  submissionId: z.string().trim().min(1, "معرّف التسليم مطلوب"),
});
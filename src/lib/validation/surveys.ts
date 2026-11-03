/**
 * Phase 9 — Zod validation for surveys, questions, responses and
 * follow-up records.
 *
 * Every write path re-validates its raw input here (Arabic messages),
 * mirroring the Phase 6/7/8 validation layer. Client payloads are NEVER
 * trusted: audience ids, content links, statuses and dates are all
 * re-checked against the database inside the service layer.
 *
 * Schema shapes are version-agnostic (zod v3 and v4): no
 * required_error/invalid_type_error params, no z.undefined() inside
 * unions — preprocess degrades missing fields instead.
 */
import { z } from "zod";

import {
  LIKERT_POINTS,
  MAX_FOLLOW_UP_NOTE_LENGTH,
  MAX_FOLLOW_UP_TITLE_LENGTH,
  MAX_LINK_PAIR_CODE_LENGTH,
  MAX_OPTION_TEXT_LENGTH,
  MAX_QUESTION_HELP_LENGTH,
  MAX_QUESTION_OPTIONS,
  MAX_QUESTION_TEXT_LENGTH,
  MAX_SURVEY_DESCRIPTION_LENGTH,
  MAX_SURVEY_INSTRUCTIONS_LENGTH,
  MAX_SURVEY_QUESTIONS,
  MAX_SURVEY_PURPOSE_LENGTH,
  MAX_SURVEY_TITLE_LENGTH,
  MAX_TARGET_IDS,
  MAX_TEXT_ANSWER_LENGTH,
  MIN_QUESTION_OPTIONS,
  RATING_MAX,
  RATING_MIN,
  SURVEY_AUDIENCE_MODES,
  SURVEY_QUESTION_TYPES,
  SURVEY_STAGES,
} from "@/config/surveys";

/* ------------------------------------------------------------------ */
/* Result contract (same shape as the assessment/assignment layers)     */
/* ------------------------------------------------------------------ */

export type SurveyErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RELATION_ERROR"
  | "AUDIENCE_INVALID"
  | "NOT_PUBLISHED"
  | "NOT_OPEN"
  | "ALREADY_SUBMITTED"
  | "REQUIRED_MISSING"
  | "ANSWER_INVALID"
  | "CLOSED"
  | "ARCHIVED"
  | "RATE_LIMITED";

export type SurveyResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      message: string;
      code: SurveyErrorCode;
      fieldErrors?: Record<string, string>;
    };

export function surveyFail<T>(
  message: string,
  code: SurveyErrorCode
): SurveyResult<T> {
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

export function validationFail<T>(error: z.ZodError): SurveyResult<T> {
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
      (value) => (typeof value === "string" ? value : ""),
      z.string().trim().max(max, `${label} يتجاوز الحد الأقصى (${max} حرفًا)`)
    )
    .transform((value) => (value.length > 0 ? value : null));

const optionalId = (max = 64) =>
  z
    .preprocess(
      (value) => (typeof value === "string" ? value : ""),
      z.string().trim().max(max, "معرّف غير صالح")
    )
    .transform((value) => (value.length > 0 ? value : null));

const optionalDate = (label: string) =>
  z.preprocess(
    (value) => {
      if (value instanceof Date) return value;
      if (typeof value === "string" && value.trim() !== "") return new Date(value);
      return undefined;
    },
    z
      .date()
      .refine((date) => !Number.isNaN(date.getTime()), `${label} غير صالحة`)
      .optional()
  );

const optionalBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "on" || value === "1";
  return false;
}, z.boolean());

/** JSON id-array field (audience targets) — tolerant parse, capped length. */
const optionalIdList = z.preprocess((value) => {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}, z.array(z.string().trim().min(1).max(64)).max(MAX_TARGET_IDS, "قائمة الاستهداف تتجاوز الحد المسموح"));

/* ------------------------------------------------------------------ */
/* Question schema (shared by create/update via the questions array)    */
/* ------------------------------------------------------------------ */

export const questionSchema = z.object({
  /** Client-generated stable key for the builder UI; re-keyed server-side. */
  clientId: optionalId(64),
  textAr: trimmedArabic(MAX_QUESTION_TEXT_LENGTH, "نص السؤال"),
  helpTextAr: optionalTrimmed(MAX_QUESTION_HELP_LENGTH, "سؤال مساعد"),
  type: z.enum(SURVEY_QUESTION_TYPES),
  required: optionalBoolean,
  /** Choice options (SINGLE_CHOICE / MULTI_CHOICE only). */
  options: z
    .array(
      z.preprocess(
        (value) => (typeof value === "string" ? value : ""),
        z
          .string()
          .trim()
          .min(1, "نص الخيار مطلوب")
          .max(MAX_OPTION_TEXT_LENGTH, `نص الخيار يتجاوز الحد الأقصى (${MAX_OPTION_TEXT_LENGTH} حرفًا)`)
      )
    )
    .max(MAX_QUESTION_OPTIONS, `الحد الأقصى ${MAX_QUESTION_OPTIONS} خيارات`)
    .optional()
    .default([]),
  /** RATING scale bounds; null → service applies 1..5 defaults. */
  minScore: z
    .preprocess(
      (value) => {
        if (value === null || value === undefined || value === "") return undefined;
        const num = Number(value);
        return Number.isFinite(num) ? num : undefined;
      },
      z.number().int().min(RATING_MIN).max(RATING_MAX).optional()
    ),
  maxScore: z
    .preprocess(
      (value) => {
        if (value === null || value === undefined || value === "") return undefined;
        const num = Number(value);
        return Number.isFinite(num) ? num : undefined;
      },
      z.number().int().min(RATING_MIN).max(RATING_MAX).optional()
    ),
});

export type QuestionInput = z.infer<typeof questionSchema>;

export const surveyDefinitionSchema = z
  .object({
    titleAr: trimmedArabic(MAX_SURVEY_TITLE_LENGTH, "عنوان الاستبيان"),
    titleEn: optionalTrimmed(MAX_SURVEY_TITLE_LENGTH, "العنوان الإنجليزي"),
    descriptionAr: optionalTrimmed(MAX_SURVEY_DESCRIPTION_LENGTH, "وصف الاستبيان"),
    descriptionEn: optionalTrimmed(MAX_SURVEY_DESCRIPTION_LENGTH, "الوصف الإنجليزي"),
    purposeAr: optionalTrimmed(MAX_SURVEY_PURPOSE_LENGTH, "الغرض"),
    instructionsAr: optionalTrimmed(MAX_SURVEY_INSTRUCTIONS_LENGTH, "التعليمات"),
    /** Optional evaluation stage (null = general survey). */
    stage: z
      .enum(SURVEY_STAGES)
      .optional()
      .nullable()
      .transform((value) => (typeof value === "string" && value.length > 0 ? value : null)),
    // Optional content links (validated against the DB in the service).
    programId: optionalId(),
    courseId: optionalId(),
    lessonId: optionalId(),
    assignmentId: optionalId(),
    certificateId: optionalId(),
    /** Pairing code joining pre/post surveys (required for comparisons). */
    linkPairCode: optionalTrimmed(MAX_LINK_PAIR_CODE_LENGTH, "رمز الربط"),
    // Audience.
    audienceMode: z.enum(SURVEY_AUDIENCE_MODES),
    targetBranchIds: optionalIdList,
    targetTeacherIds: optionalIdList,
    // Response policy.
    anonymous: optionalBoolean,
    allowMultipleResponses: optionalBoolean,
    linkResponsesEnabled: optionalBoolean,
    // Response window.
    opensAt: optionalDate("تاريخ الفتح"),
    closesAt: optionalDate("تاريخ الإغلاق"),
    questions: z
      .array(questionSchema)
      .min(1, "أضف سؤالًا واحدًا على الأقل")
      .max(MAX_SURVEY_QUESTIONS, `الحد الأقصى ${MAX_SURVEY_QUESTIONS} سؤالًا`),
  })
  .superRefine((value, ctx) => {
    // Choice questions need 2..N non-empty options (post-trim check).
    value.questions.forEach((question, index) => {
      if (question.type === "SINGLE_CHOICE" || question.type === "MULTI_CHOICE") {
        const options = question.options.filter((option) => option.length > 0);
        if (options.length < MIN_QUESTION_OPTIONS) {
          ctx.addIssue({
            code: "custom",
            path: ["questions", index, "options"],
            message: `أضف خيارين على الأقل لهذا السؤال`,
          });
        }
      }
      if (question.type === "RATING" && question.minScore !== undefined && question.maxScore !== undefined) {
        if (question.minScore >= question.maxScore) {
          ctx.addIssue({
            code: "custom",
            path: ["questions", index, "maxScore"],
            message: "أقصى درجة يجب أن تكون أكبر من أدنى درجة",
          });
        }
      }
    });

    // Response-window consistency.
    if (value.opensAt && value.closesAt && value.opensAt.getTime() >= value.closesAt.getTime()) {
      ctx.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "تاريخ الإغلاق يجب أن يكون بعد تاريخ الفتح",
      });
    }

    // Anonymous linking configuration consistency (explicit config only).
    if (value.linkResponsesEnabled && (!value.anonymous || !value.linkPairCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["linkResponsesEnabled"],
        message: "ربط الردود يتطلب استبيانًا مجهول الهوية ورمز ربط محددًا",
      });
    }

    // Stage comparisons need a content anchor + pair code.
    if (value.stage && (value.stage === "PRE_TRAINING" || value.stage === "AFTER_TRAINING")) {
      if (!value.programId && !value.courseId) {
        ctx.addIssue({
          code: "custom",
          path: ["stage"],
          message: "استبيانات ما قبل/بعد التدريب يجب أن ترتبط ببرنامج أو دورة تدريبية",
        });
      }
      if (!value.linkPairCode) {
        ctx.addIssue({
          code: "custom",
          path: ["linkPairCode"],
          message: "حدد رمز الربط لمقارنة نتائج ما قبل التدريب وما بعده",
        });
      }
    }

    // Branch/teacher audiences require explicit targets.
    if (value.audienceMode === "BRANCHES" && value.targetBranchIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["targetBranchIds"],
        message: "حدد فروعًا واحدة على الأقل",
      });
    }
    if (value.audienceMode === "TEACHERS" && value.targetTeacherIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["targetTeacherIds"],
        message: "حدد معلمين واحدًا على الأقل",
      });
    }
  });

export type SurveyDefinitionInput = z.infer<typeof surveyDefinitionSchema>;

/* ------------------------------------------------------------------ */
/* Answer schemas                                                       */
/* ------------------------------------------------------------------ */

export const answerInputSchema = z.object({
  questionId: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1, "معرّف السؤال مطلوب").max(64, "معرّف سؤال غير صالح")
  ),
  valueText: z
    .preprocess(
      (value) => (typeof value === "string" ? value : ""),
      z.string().max(MAX_TEXT_ANSWER_LENGTH, `الإجابة تتجاوز الحد الأقصى (${MAX_TEXT_ANSWER_LENGTH} حرفًا)`)
    )
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : null)),
  valueNumber: z
    .preprocess(
      (value) => {
        if (value === null || value === undefined || value === "") return undefined;
        const num = Number(value);
        return Number.isFinite(num) ? num : undefined;
      },
      z.number().int().optional()
    ),
  selectedOptions: z
    .preprocess((value) => {
      if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
      if (typeof value === "string" && value.trim() !== "") {
        try {
          const parsed: unknown = JSON.parse(value);
          return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === "string")
            : [];
        } catch {
          return [];
        }
      }
      return [];
    }, z.array(z.string().trim().min(1).max(MAX_OPTION_TEXT_LENGTH)).max(MAX_QUESTION_OPTIONS))
    .optional()
    .default([]),
});

export type AnswerInput = z.infer<typeof answerInputSchema>;

/** Both draft-saving and submission share this envelope. */
export const responsePayloadSchema = z.object({
  answers: z
    .array(answerInputSchema)
    .max(MAX_SURVEY_QUESTIONS, "عدد الإجابات يتجاوز عدد الأسئلة المسموح"),
});

export type ResponsePayloadInput = z.infer<typeof responsePayloadSchema>;

/* ------------------------------------------------------------------ */
/* Follow-up schemas                                                    */
/* ------------------------------------------------------------------ */

export const followUpDefinitionSchema = z
  .object({
    teacherId: z.preprocess(
      (value) => (typeof value === "string" ? value : ""),
      z.string().trim().min(1, "المعلم مطلوب").max(64, "معرّف غير صالح")
    ),
    /** Responsible supervisor — office manager picks; supervisors are self-assigned. */
    supervisorId: optionalId(),
    titleAr: trimmedArabic(MAX_FOLLOW_UP_TITLE_LENGTH, "عنوان المتابعة"),
    purposeAr: optionalTrimmed(MAX_FOLLOW_UP_NOTE_LENGTH, "الغرض"),
    followUpDate: z.preprocess(
      (value) => {
        if (value instanceof Date) return value;
        if (typeof value === "string" && value.trim() !== "") return new Date(value);
        return undefined;
      },
      z
        .date()
        .refine((date) => !Number.isNaN(date.getTime()), "تاريخ المتابعة غير صالح")
    ),
    nextFollowUpAt: optionalDate("موعد المتابعة القادمة"),
    programId: optionalId(),
    courseId: optionalId(),
    surveyId: optionalId(),
    assignmentId: optionalId(),
    observationAr: optionalTrimmed(MAX_FOLLOW_UP_NOTE_LENGTH, "ملاحظات التطبيق الصفي"),
    progressAr: optionalTrimmed(MAX_FOLLOW_UP_NOTE_LENGTH, "التقدم"),
    challengesAr: optionalTrimmed(MAX_FOLLOW_UP_NOTE_LENGTH, "التحديات"),
    supportNeedsAr: optionalTrimmed(MAX_FOLLOW_UP_NOTE_LENGTH, "احتياجات الدعم"),
    recommendationsAr: optionalTrimmed(MAX_FOLLOW_UP_NOTE_LENGTH, "التوصيات"),
    sharedWithTeacher: optionalBoolean,
  })
  .superRefine((value, ctx) => {
    if (value.nextFollowUpAt && value.nextFollowUpAt.getTime() < value.followUpDate.getTime()) {
      ctx.addIssue({
        code: "custom",
        path: ["nextFollowUpAt"],
        message: "موعد المتابعة القادمة يجب أن يكون بعد تاريخ المتابعة الحالية",
      });
    }
  });

export type FollowUpDefinitionInput = z.infer<typeof followUpDefinitionSchema>;

export const followUpStatusSchema = z.object({
  followUpId: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1, "معرّف المتابعة مطلوب").max(64, "معرّف غير صالح")
  ),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  note: optionalTrimmed(MAX_FOLLOW_UP_NOTE_LENGTH, "ملاحظة"),
});

export const followUpSharingSchema = z.object({
  followUpId: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1, "معرّف المتابعة مطلوب").max(64, "معرّف غير صالح")
  ),
  sharedWithTeacher: optionalBoolean,
});

/** Likert ordinal for a label index (index 0 = strongest agreement = 5). */
export function likertValueForIndex(index: number): number {
  return LIKERT_POINTS - index;
}
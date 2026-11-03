import { z } from "zod";

import {
  ATTEMPT_LIMIT_MAX,
  ATTEMPT_LIMIT_MIN,
  ASSESSMENT_STATUSES,
  EXPLANATION_MAX,
  MAX_QUESTIONS,
  OPTIONS_MAX,
  OPTION_TEXT_MAX,
  PASSING_SCORE_MAX,
  PASSING_SCORE_MIN,
  QUESTION_POINTS_MAX,
  QUESTION_POINTS_MIN,
  QUESTION_TEXT_MAX,
  QUESTION_TEXT_MIN,
  QUESTION_TYPES,
  SHORT_ANSWER_MAX,
  TIME_LIMIT_MAX,
  TIME_LIMIT_MIN,
} from "@/config/assessment";
import { zodFieldErrors } from "@/lib/validation/schools";

export { zodFieldErrors };

/* ------------------------------------------------------------------ */
/* Phase 6 — assessment validation.                                     */
/*                                                                      */
/* Every write goes through these schemas; the service layer re-checks  */
/* ownership, tenancy and relations — validation here is shape only.    */
/* Authorization never lives in the client.                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Shared field rules                                                   */
/* ------------------------------------------------------------------ */

const titleArField = z
  .string({ message: "عنوان الاختبار مطلوب" })
  .trim()
  .min(3, "عنوان الاختبار يجب ألا يقل عن 3 أحرف")
  .max(150, "عنوان الاختبار طويل جدًا (الحد الأقصى 150 حرفًا)");

const titleEnField = z
  .string()
  .trim()
  .max(150, "العنوان بالإنجليزية طويل جدًا (الحد الأقصى 150 حرفًا)")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const instructionsArField = z
  .string({ message: "تعليمات الاختبار مطلوبة" })
  .trim()
  .min(10, "تعليمات الاختبار يجب ألا تقل عن 10 أحرف")
  .max(4000, "تعليمات الاختبار طويلة جدًا (الحد الأقصى 4000 حرف)");

const instructionsEnField = z
  .string()
  .trim()
  .max(4000, "التعليمات بالإنجليزية طويلة جدًا (الحد الأقصى 4000 حرف)")
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const idField = (label: string) =>
  z.string({ message: `${label} مطلوب` }).min(1, `${label} مطلوب`);

const optionalIdField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

/** "platform" | "school" — the service derives the real schoolId. */
const scopeField = z.enum(["platform", "school"], {
  message: "نطاق الاختبار غير صالح",
});

const passingScoreField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z
    .number({ message: "درجة النجاح يجب أن تكون رقمًا" })
    .int("درجة النجاح يجب أن تكون عددًا صحيحًا")
    .min(PASSING_SCORE_MIN, `أقل درجة نجاح مقبولة ${PASSING_SCORE_MIN}`)
    .max(PASSING_SCORE_MAX, `درجة النجاح كبيرة جدًا (الحد الأقصى ${PASSING_SCORE_MAX})`)
);

const timeLimitField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z
    .number({ message: "المدة الزمنية يجب أن تكون رقمًا" })
    .int("المدة الزمنية يجب أن تكون عددًا صحيحًا")
    .min(TIME_LIMIT_MIN, `أقل مدة مقبولة ${TIME_LIMIT_MIN} دقائق`)
    .max(TIME_LIMIT_MAX, `المدة الزمنية طويلة جدًا (الحد الأقصى ${TIME_LIMIT_MAX} دقيقة)`)
    .optional()
);

const attemptLimitField = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z
    .number({ message: "حد المحاولات يجب أن يكون رقمًا" })
    .int("حد المحاولات يجب أن يكون عددًا صحيحًا")
    .min(ATTEMPT_LIMIT_MIN, `أقل حد محاولات مقبول ${ATTEMPT_LIMIT_MIN}`)
    .max(ATTEMPT_LIMIT_MAX, `حد المحاولات كبير جدًا (الحد الأقصى ${ATTEMPT_LIMIT_MAX})`)
    .optional()
);

/** Accepts Date instances (service/tests) or datetime-local strings (forms). */
function datetimeField(label: string) {
  return z.preprocess(
    (v) => {
      if (v === "" || v === null || v === undefined) return undefined;
      if (v instanceof Date) return v;
      const parsed = new Date(String(v));
      return Number.isNaN(parsed.getTime()) ? v : parsed;
    },
    z
      .date({ message: `${label} غير صالحة` })
      .optional()
  );
}

/* ------------------------------------------------------------------ */
/* Assessment schemas                                                   */
/* ------------------------------------------------------------------ */

const assessmentBaseShape = {
  titleAr: titleArField,
  titleEn: titleEnField,
  instructionsAr: instructionsArField,
  instructionsEn: instructionsEnField,
  /** Optional binding to a training course (same tenant, service-checked). */
  courseId: optionalIdField,
  scope: scopeField,
  /** Ignored for office managers — the service pins them to their school. */
  schoolId: optionalIdField,
  passingScore: passingScoreField,
  timeLimitMinutes: timeLimitField,
  attemptLimit: attemptLimitField,
  availableFrom: datetimeField("تاريخ بداية التوافر"),
  availableUntil: datetimeField("تاريخ نهاية التوافر"),
};

const availabilityWindowRefine = <T extends {
  availableFrom?: Date;
  availableUntil?: Date;
}>(data: T, ctx: z.RefinementCtx) => {
  if (data.availableFrom && data.availableUntil) {
    if (data.availableUntil.getTime() <= data.availableFrom.getTime()) {
      ctx.addIssue({
        code: "custom",
        path: ["availableUntil"],
        message: "نهاية التوافر يجب أن تكون بعد بدايته",
      });
    }
  }
};

export const createAssessmentSchema = z
  .object(assessmentBaseShape)
  .superRefine(availabilityWindowRefine);

export const updateAssessmentSchema = createAssessmentSchema.and(z.object({
  assessmentId: idField("معرّف الاختبار"),
}));

export const setAssessmentStatusSchema = z.object({
  assessmentId: idField("معرّف الاختبار"),
  status: z.enum(ASSESSMENT_STATUSES, { message: "الحالة غير صالحة" }),
});

/* ------------------------------------------------------------------ */
/* Question schemas — type-conditional rules                            */
/* ------------------------------------------------------------------ */

export const questionOptionInputSchema = z.object({
  textAr: z
    .string({ message: "نص الخيار مطلوب" })
    .trim()
    .min(1, "نص الخيار مطلوب")
    .max(OPTION_TEXT_MAX, `نص الخيار طويل جدًا (الحد الأقصى ${OPTION_TEXT_MAX} حرفًا)`),
});

export interface QuestionOptionInput {
  textAr: string;
}

const questionBaseShape = {
  type: z.enum(QUESTION_TYPES, { message: "نوع السؤال مطلوب" }),
  textAr: z
    .string({ message: "نص السؤال مطلوب" })
    .trim()
    .min(QUESTION_TEXT_MIN, `نص السؤال يجب ألا يقل عن ${QUESTION_TEXT_MIN} أحرف`)
    .max(QUESTION_TEXT_MAX, `نص السؤال طويل جدًا (الحد الأقصى ${QUESTION_TEXT_MAX} حرفًا)`),
  textEn: z
    .string()
    .trim()
    .max(QUESTION_TEXT_MAX, "نص السؤال بالإنجليزية طويل جدًا")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  points: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z
      .number({ message: "درجة السؤال يجب أن تكون رقمًا" })
      .int("درجة السؤال يجب أن تكون عددًا صحيحًا")
      .min(QUESTION_POINTS_MIN, `أقل درجة سؤال مقبولة ${QUESTION_POINTS_MIN}`)
      .max(QUESTION_POINTS_MAX, `درجة السؤال كبيرة جدًا (الحد الأقصى ${QUESTION_POINTS_MAX})`)
  ),
  isRequired: z.boolean().default(true),
  explanation: z
    .string()
    .trim()
    .max(EXPLANATION_MAX, `التغذية الراجعة طويلة جدًا (الحد الأقصى ${EXPLANATION_MAX} حرفًا)`)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  /** Choice types only — texts; the server generates option ids. */
  options: z.array(questionOptionInputSchema).max(OPTIONS_MAX).default([]),
  /** Choice types only — indexes into the submitted options array. */
  correctOptionIndexes: z
    .array(z.number().int().min(0).max(OPTIONS_MAX - 1))
    .max(OPTIONS_MAX)
    .default([]),
  /** TRUE_FALSE only. */
  correctValue: z.boolean().optional(),
  /** SHORT_ANSWER only — grading reference for the human reviewer. */
  modelAnswer: z
    .string()
    .trim()
    .max(SHORT_ANSWER_MAX, "الإجابة النموذجية طويلة جدًا")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
};

/**
 * Type-conditional validation. Unsupported or mismatched configurations
 * are REJECTED explicitly — the meaning of a question is never silently
 * changed (e.g. missing correct answer, correct answer referencing a
 * nonexistent option, options on non-choice types).
 */
export const questionInputSchema = z
  .object(questionBaseShape)
  .superRefine((data, ctx) => {
    const isChoice = data.type === "SINGLE_CHOICE" || data.type === "MULTIPLE_CHOICE";

    if (isChoice) {
      if (data.options.length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message: "أسئلة الاختيار تحتاج إلى خيارين على الأقل",
        });
        return;
      }
      if (data.correctOptionIndexes.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["correctOptionIndexes"],
          message: "حدّد الإجابة الصحيحة",
        });
        return;
      }
      for (const index of data.correctOptionIndexes) {
        if (index >= data.options.length) {
          ctx.addIssue({
            code: "custom",
            path: ["correctOptionIndexes"],
            message: "الإجابة الصحيحة تشير إلى خيار غير موجود",
          });
          return;
        }
      }
      const unique = new Set(data.correctOptionIndexes);
      if (unique.size !== data.correctOptionIndexes.length) {
        ctx.addIssue({
          code: "custom",
          path: ["correctOptionIndexes"],
          message: "لا يمكن تكرار الإجابة الصحيحة",
        });
        return;
      }
      if (data.type === "SINGLE_CHOICE" && unique.size !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["correctOptionIndexes"],
          message: "سؤال الإجابة الواحدة يقبل إجابة صحيحة واحدة فقط",
        });
      }
      return;
    }

    if (data.type === "TRUE_FALSE") {
      if (typeof data.correctValue !== "boolean") {
        ctx.addIssue({
          code: "custom",
          path: ["correctValue"],
          message: "حدّد الإجابة الصحيحة (صح أو خطأ)",
        });
      }
      return;
    }

    if (data.type === "SHORT_ANSWER") {
      // No auto grading — the model answer is an optional reviewer aid.
      return;
    }

    // Exhaustiveness guard: unknown types are rejected explicitly.
    ctx.addIssue({
      code: "custom",
      path: ["type"],
      message: "نوع السؤال غير مدعوم",
    });
  });

export const createQuestionSchema = questionInputSchema.and(z.object({
  assessmentId: idField("معرّف الاختبار"),
}));

export const updateQuestionSchema = createQuestionSchema.and(z.object({
  questionId: idField("معرّف السؤال"),
}));

export const moveQuestionSchema = z.object({
  assessmentId: idField("معرّف الاختبار"),
  questionId: idField("معرّف السؤال"),
  direction: z.enum(["up", "down"], { message: "اتجاه الترتيب غير صالح" }),
});

export const deleteQuestionSchema = z.object({
  questionId: idField("معرّف السؤال"),
});

/* ------------------------------------------------------------------ */
/* Attempt schemas (teacher side)                                       */
/* ------------------------------------------------------------------ */

/** One submitted answer — shape validated here, semantics in the service. */
export const answerEntrySchema = z.object({
  questionId: idField("معرّف السؤال"),
  /** Choice answers: selected option ids (server re-validates membership). */
  choice: z.array(z.string().min(1)).max(OPTIONS_MAX).optional(),
  /** TRUE_FALSE answers. */
  bool: z.boolean().optional(),
  /** SHORT_ANSWER free text. */
  text: z
    .string()
    .max(SHORT_ANSWER_MAX, "الإجابة القصيرة طويلة جدًا")
    .optional(),
});

export const answersArraySchema = z
  .array(answerEntrySchema)
  .max(MAX_QUESTIONS);

export const saveDraftSchema = z.object({
  attemptId: idField("معرّف المحاولة"),
  answers: answersArraySchema,
});

export const submitAttemptSchema = saveDraftSchema;

/* ------------------------------------------------------------------ */
/* Manual review schemas (short-answer grading)                         */
/* ------------------------------------------------------------------ */

export const reviewAttemptSchema = z.object({
  attemptId: idField("معرّف المحاولة"),
  /** Points awarded per short-answer question (service bounds-checks). */
  scores: z
    .array(
      z.object({
        questionId: idField("معرّف السؤال"),
        points: z
          .number({ message: "الدرجة يجب أن تكون رقمًا" })
          .int("الدرجة يجب أن تكون عددًا صحيحًا")
          .min(0, "لا يمكن منح درجات سالبة")
          .max(QUESTION_POINTS_MAX, `الدرجة كبيرة جدًا (الحد الأقصى ${QUESTION_POINTS_MAX})`),
      })
    )
    .min(1, "لا توجد درجات مراجعة لحفظها"),
});

/* ------------------------------------------------------------------ */
/* Result type                                                          */
/* ------------------------------------------------------------------ */

export type AssessmentErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "RELATION_ERROR"
  | "PUBLISH_BLOCKED"
  | "DUPLICATE"
  | "ATTEMPT_LIMIT_REACHED"
  | "DEADLINE_PASSED"
  | "NOT_AVAILABLE"
  | "ALREADY_SUBMITTED"
  | "INVALID_ANSWER"
  | "ENROLLMENT_REQUIRED";

/** Uniform service-layer result consumed by actions, UI and tests. */
export type AssessmentResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** Arabic, user-facing error message. */
      message: string;
      fieldErrors?: Record<string, string>;
      code?: AssessmentErrorCode;
    };
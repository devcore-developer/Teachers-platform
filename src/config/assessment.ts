/* ------------------------------------------------------------------ */
/* Phase 6 — exam engine: canonical keys, Arabic labels, server limits. */
/*                                                                      */
/* SQLite has no native enums, so question types / assessment statuses  */
/* / attempt statuses are canonical English keys validated with Zod on  */
/* every write. Arabic labels here are UI-only and never persisted.     */
/* ------------------------------------------------------------------ */

/** Supported question types (persisted in assessment_questions.type). */
export const QUESTION_TYPES = [
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "SHORT_ANSWER",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: "اختيار من متعدد (إجابة واحدة)",
  MULTIPLE_CHOICE: "اختيار من متعدد (عدة إجابات)",
  TRUE_FALSE: "صح أو خطأ",
  SHORT_ANSWER: "إجابة قصيرة (مراجعة يدوية)",
};

export function questionTypeLabel(type: string): string {
  return QUESTION_TYPE_LABELS[type as QuestionType] ?? type;
}

/** Question types graded automatically on the server (exact match). */
export const AUTO_GRADED_TYPES = [
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
] as const;

/** Question types that require a set of options. */
export const CHOICE_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE"] as const;

/** Assessment lifecycle — same canonical keys as training content. */
export const ASSESSMENT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const ASSESSMENT_STATUS_LABELS: Record<AssessmentStatus, string> = {
  DRAFT: "مسودة",
  PUBLISHED: "منشور",
  ARCHIVED: "مؤرشف",
};

export function assessmentStatusLabel(status: string): string {
  return (
    ASSESSMENT_STATUS_LABELS[status as AssessmentStatus] ?? status
  );
}

/** Attempt lifecycle (persisted in assessment_attempts.status). */
export const ATTEMPT_STATUSES = [
  "IN_PROGRESS",
  "EXPIRED",
  "NEEDS_REVIEW",
  "PASSED",
  "FAILED",
] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  IN_PROGRESS: "قيد التنفيذ",
  EXPIRED: "انتهى الوقت دون تسليم",
  NEEDS_REVIEW: "مُسلَّم — بانتظار المراجعة",
  PASSED: "ناجح",
  FAILED: "غير مجتاز",
};

export function attemptStatusLabel(status: string): string {
  return ATTEMPT_STATUS_LABELS[status as AttemptStatus] ?? status;
}

/** Semantic tone for badges (maps to StatusBadge tones). */
export function attemptStatusTone(
  status: string
): "success" | "info" | "warning" | "error" | "neutral" {
  if (status === "PASSED") return "success";
  if (status === "FAILED") return "error";
  if (status === "NEEDS_REVIEW") return "warning";
  if (status === "IN_PROGRESS") return "info";
  return "neutral";
}

/* ------------------------------------------------------------------ */
/* Server-side limits — enforced in validation + service, never client. */
/* ------------------------------------------------------------------ */

/** Maximum questions per assessment. */
export const MAX_QUESTIONS = 100;
/** Minimum questions required before publishing. */
export const MIN_QUESTIONS_TO_PUBLISH = 1;

export const QUESTION_TEXT_MIN = 3;
export const QUESTION_TEXT_MAX = 1000;

export const QUESTION_POINTS_MIN = 1;
export const QUESTION_POINTS_MAX = 100;
/** Total points cap across all questions of one assessment. */
export const MAX_ASSESSMENT_POINTS = 1000;

export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 6;
export const OPTION_TEXT_MAX = 200;

/** Passing score bounds (points, not percent). */
export const PASSING_SCORE_MIN = 1;
export const PASSING_SCORE_MAX = 1000;

/** Time limit bounds in minutes (null = untimed). */
export const TIME_LIMIT_MIN = 5;
export const TIME_LIMIT_MAX = 300;

/** Attempt limit bounds (null = unlimited). */
export const ATTEMPT_LIMIT_MIN = 1;
export const ATTEMPT_LIMIT_MAX = 10;

export const SHORT_ANSWER_MAX = 2000;

/** Explanation / feedback length cap. */
export const EXPLANATION_MAX = 1000;

/** Listing page sizes. */
export const ASSESSMENTS_PAGE_SIZE = 10;
export const ATTEMPTS_PREVIEW_LIMIT = 50;

/**
 * Fixed options for TRUE_FALSE questions (canonical boolean payload).
 * Rendered as صح / خطأ in the UI; the answer key stores a boolean.
 */
export const TRUE_FALSE_LABELS: Record<"true" | "false", string> = {
  true: "صح",
  false: "خطأ",
};
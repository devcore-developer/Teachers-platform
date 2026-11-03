/**
 * Phase 9 — canonical keys, numeric limits and Arabic UI labels for
 * impact surveys, responses, follow-up records and outcome analysis.
 *
 * SQLite has no enums: every persisted status/type/mode is a canonical
 * English string from this file, validated with Zod on every write.
 * All user-visible text lives here (UI is Arabic, code is English).
 */

/* ------------------------------------------------------------------ */
/* Limits & caps                                                        */
/* ------------------------------------------------------------------ */

export const SURVEYS_PAGE_SIZE = 10;
export const FOLLOW_UPS_PAGE_SIZE = 12;
/** Cap on scanned submitted responses per results computation. */
export const RESPONSES_LIST_LIMIT = 200;
/** Cap on free-text answers listed per question in results. */
export const MAX_LISTED_TEXT_ANSWERS = 50;
export const IMPACT_SCHOOLS_LIMIT = 50;

export const MAX_SURVEY_TITLE_LENGTH = 200;
export const MAX_SURVEY_DESCRIPTION_LENGTH = 2000;
export const MAX_SURVEY_PURPOSE_LENGTH = 1000;
export const MAX_SURVEY_INSTRUCTIONS_LENGTH = 2000;
export const MAX_SURVEY_QUESTIONS = 40;
export const MAX_QUESTION_TEXT_LENGTH = 500;
export const MAX_QUESTION_HELP_LENGTH = 300;
export const MAX_QUESTION_OPTIONS = 10;
export const MIN_QUESTION_OPTIONS = 2;
export const MAX_OPTION_TEXT_LENGTH = 200;
export const MAX_TEXT_ANSWER_LENGTH = 5000;
export const MAX_TARGET_IDS = 300;
export const MAX_LINK_PAIR_CODE_LENGTH = 40;

export const MAX_FOLLOW_UP_TITLE_LENGTH = 200;
export const MAX_FOLLOW_UP_NOTE_LENGTH = 4000;

/**
 * Small-group privacy threshold: anonymous aggregates (distributions,
 * free-text answers, pre/post pairings) are suppressed when fewer than
 * this many SUBMITTED responses exist — small counts can single out
 * individuals even in aggregate form.
 */
export const MIN_ANONYMOUS_AGGREGATE = 3;

/** Rating scale hard bounds (per-question bounds validated inside). */
export const RATING_MIN = 1;
export const RATING_MAX = 10;
export const RATING_DEFAULT_MAX = 5;

/** Abuse protection: response submissions per user per minute. */
export const SUBMIT_RATE_LIMIT = 10;
export const SUBMIT_RATE_WINDOW_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Canonical keys                                                       */
/* ------------------------------------------------------------------ */

export const SURVEY_STATUSES = ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

export const SURVEY_RESPONSE_STATUSES = ["DRAFT", "SUBMITTED"] as const;
export type SurveyResponseStatus = (typeof SURVEY_RESPONSE_STATUSES)[number];

export const SURVEY_STAGES = ["PRE_TRAINING", "AFTER_TRAINING", "APPLICATION_FOLLOWUP"] as const;
export type SurveyStage = (typeof SURVEY_STAGES)[number];

export const SURVEY_QUESTION_TYPES = [
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "RATING",
  "LIKERT",
  "SHORT_TEXT",
  "LONG_TEXT",
  "YES_NO",
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const SURVEY_AUDIENCE_MODES = ["ALL_TEACHERS", "BRANCHES", "TEACHERS"] as const;
export type SurveyAudienceMode = (typeof SURVEY_AUDIENCE_MODES)[number];

export const SURVEY_EVENT_TYPES = [
  "CREATED",
  "UPDATED",
  "PUBLISHED",
  "CLOSED",
  "ARCHIVED",
] as const;
export type SurveyEventType = (typeof SURVEY_EVENT_TYPES)[number];

export const FOLLOW_UP_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_EVENT_TYPES = [
  "CREATED",
  "UPDATED",
  "STATUS_CHANGED",
  "SHARING_CHANGED",
  "ARCHIVED",
  "RESTORED",
] as const;
export type FollowUpEventType = (typeof FOLLOW_UP_EVENT_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Arabic UI labels                                                     */
/* ------------------------------------------------------------------ */

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  DRAFT: "مسودة",
  PUBLISHED: "منشور",
  CLOSED: "مغلق",
  ARCHIVED: "مؤرشف",
};

export const SURVEY_RESPONSE_STATUS_LABELS: Record<SurveyResponseStatus, string> = {
  DRAFT: "حفظ مؤقت",
  SUBMITTED: "تم الإرسال",
};

export const SURVEY_STAGE_LABELS: Record<SurveyStage, string> = {
  PRE_TRAINING: "قبل التدريب",
  AFTER_TRAINING: "بعد التدريب مباشرة",
  APPLICATION_FOLLOWUP: "متابعة بعد التطبيق",
};

export const SURVEY_QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  SINGLE_CHOICE: "اختيار من متعدد (خيار واحد)",
  MULTI_CHOICE: "اختيار متعدد (عدة خيارات)",
  RATING: "تقييم رقمي (مقياس درجات)",
  LIKERT: "مقياس ليكرت (موافقة)",
  SHORT_TEXT: "إجابة نصية قصيرة",
  LONG_TEXT: "إجابة نصية طويلة",
  YES_NO: "نعم / لا",
};

export const SURVEY_AUDIENCE_LABELS: Record<SurveyAudienceMode, string> = {
  ALL_TEACHERS: "جميع المعلمين",
  BRANCHES: "فروع محددة",
  TEACHERS: "معلمون محددون",
};

export const SURVEY_EVENT_LABELS: Record<SurveyEventType, string> = {
  CREATED: "إنشاء الاستبيان",
  UPDATED: "تعديل الاستبيان",
  PUBLISHED: "نشر الاستبيان",
  CLOSED: "إغلاق الاستبيان",
  ARCHIVED: "أرشفة الاستبيان",
};

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  PLANNED: "مجدولة",
  IN_PROGRESS: "قيد التنفيذ",
  COMPLETED: "مكتملة",
  CANCELLED: "ملغاة",
};

export const FOLLOW_UP_EVENT_LABELS: Record<FollowUpEventType, string> = {
  CREATED: "إنشاء سجل المتابعة",
  UPDATED: "تحديث بيانات المتابعة",
  STATUS_CHANGED: "تغيير حالة المتابعة",
  SHARING_CHANGED: "تغيير المشاركة مع المعلم",
  ARCHIVED: "أرشفة سجل المتابعة",
  RESTORED: "استعادة سجل المتابعة من الأرشيف",
};

/** Canonical 5-point Likert scale (fixed — keeps results comparable). */
export const LIKERT_OPTIONS = [
  "موافق بشدة",
  "موافق",
  "محايد",
  "غير موافق",
  "غير موافق بشدة",
] as const;
/** Likert numeric encoding: 5 = موافق بشدة … 1 = غير موافق بشدة. */
export const LIKERT_POINTS = 5;

/* ------------------------------------------------------------------ */
/* Derivation helpers                                                   */
/* ------------------------------------------------------------------ */

export function isSurveyQuestionType(value: string): value is SurveyQuestionType {
  return (SURVEY_QUESTION_TYPES as readonly string[]).includes(value);
}

export function isSurveyStage(value: string): value is SurveyStage {
  return (SURVEY_STAGES as readonly string[]).includes(value);
}

export function isSurveyStatus(value: string): value is SurveyStatus {
  return (SURVEY_STATUSES as readonly string[]).includes(value);
}

export function isFollowUpStatus(value: string): value is FollowUpStatus {
  return (FOLLOW_UP_STATUSES as readonly string[]).includes(value);
}
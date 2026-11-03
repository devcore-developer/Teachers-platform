/**
 * Phase 7 — canonical keys, numeric limits and Arabic UI labels for
 * assignments, submissions and supervision.
 *
 * SQLite has no enums: every persisted status/mode is a canonical
 * English string from this file, validated with Zod on every write.
 * All user-visible text lives here (UI is Arabic, code is English).
 */

/* ------------------------------------------------------------------ */
/* Pagination & caps                                                    */
/* ------------------------------------------------------------------ */

export const ASSIGNMENTS_PAGE_SIZE = 10;
export const SUBMISSIONS_PAGE_SIZE = 20;
export const REVIEW_QUEUE_LIMIT = 100;
export const OVERVIEW_ROWS_LIMIT = 100;

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_SUBMISSION_TEXT = 10000;
export const MAX_FEEDBACK_LENGTH = 4000;

/** Max ids accepted per audience list (defense against huge payloads). */
export const MAX_TARGET_IDS = 300;
export const MAX_RUBRIC_CRITERIA = 10;
export const MAX_CRITERION_POINTS = 100;
export const MAX_TOTAL_POINTS = 1000;

/** When an assignment has NO rubric, a direct score uses this cap. */
export const MAX_NO_RUBRIC_SCORE = 100;

/* ------------------------------------------------------------------ */
/* Submission file policy (server-enforced, never client-trusted)       */
/* ------------------------------------------------------------------ */

export const MAX_FILES_PER_SUBMISSION = 5;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Whitelist of accepted MIME types with human-readable Arabic labels. */
export const ALLOWED_FILE_TYPES: Record<string, string> = {
  "application/pdf": "ملف PDF",
  "image/png": "صورة PNG",
  "image/jpeg": "صورة JPG",
  "text/plain": "ملف نصي",
  "application/msword": "مستند Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "مستند Word",
  "application/vnd.ms-excel": "جدول Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "جدول Excel",
  "application/vnd.ms-powerpoint": "عرض PowerPoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "عرض PowerPoint",
};

/* ------------------------------------------------------------------ */
/* Canonical keys                                                       */
/* ------------------------------------------------------------------ */

export const ASSIGNMENT_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "CLOSED",
  "ARCHIVED",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const AUDIENCE_MODES = [
  "ALL_TEACHERS",
  "BRANCHES",
  "TEACHERS",
] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

export const SUBMISSION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "RETURNED",
  "GRADED",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Statuses that count as "turned in" for metrics denominators. */
export const SUBMITTED_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "RETURNED", "GRADED"] as const;

/** Statuses a reviewer may act on. */
export const REVIEWABLE_STATUSES = ["SUBMITTED", "UNDER_REVIEW"] as const;

/** Submission statuses a teacher may still edit content on. */
export const TEACHER_EDITABLE_STATUSES = ["DRAFT", "RETURNED"] as const;

/* ------------------------------------------------------------------ */
/* Arabic labels                                                        */
/* ------------------------------------------------------------------ */

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  DRAFT: "مسودة",
  PUBLISHED: "منشور",
  CLOSED: "مغلق",
  ARCHIVED: "مؤرشف",
};

export const ASSIGNMENT_STATUS_CLASSES: Record<AssignmentStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 border-slate-200",
  PUBLISHED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CLOSED: "bg-amber-50 text-amber-700 border-amber-200",
  ARCHIVED: "bg-slate-100 text-slate-500 border-slate-200",
};

export const AUDIENCE_MODE_LABELS: Record<AudienceMode, string> = {
  ALL_TEACHERS: "جميع معلمي المدرسة",
  BRANCHES: "فروع محددة",
  TEACHERS: "معلمون محددون",
};

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  DRAFT: "مسودة",
  SUBMITTED: "مُسلَّم",
  UNDER_REVIEW: "قيد المراجعة",
  RETURNED: "أُعيد للتعديل",
  GRADED: "مُقيَّم",
};

export const SUBMISSION_STATUS_CLASSES: Record<SubmissionStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 border-slate-200",
  SUBMITTED: "bg-blue-50 text-blue-700 border-blue-200",
  UNDER_REVIEW: "bg-indigo-50 text-indigo-700 border-indigo-200",
  RETURNED: "bg-amber-50 text-amber-700 border-amber-200",
  GRADED: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
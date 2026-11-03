/**
 * Phase 10 — canonical keys, numeric limits and Arabic UI labels for
 * role-based dashboards, analytics, the report center and archiving.
 *
 * SQLite has no enums: every persisted key (archive entity types,
 * actions) is a canonical English string from this file, validated on
 * every write. All user-visible text lives here (UI is Arabic, code is
 * English). No fabricated numbers may ever be rendered for missing
 * data — the UI renders "—" for null metrics instead.
 */

/* ------------------------------------------------------------------ */
/* Limits & caps                                                        */
/* ------------------------------------------------------------------ */

/** Rows scanned per trend month-bucketing query (date-only columns). */
export const TREND_SCAN_LIMIT = 5000;
/** Months shown in every trend chart (fixed window, oldest first). */
export const TREND_MONTHS = 6;
/** Schools listed in the Super Admin platform dashboard table. */
export const PLATFORM_SCHOOLS_LIMIT = 50;
/** Schools a deputy dashboard expands in detail (grants beyond this
 * still appear as a count with a link to their reports). */
export const DEPUTY_SCHOOLS_LIMIT = 5;
/** Max rows loaded per school for computed percentage averages. */
export const PERCENTAGE_SAMPLE_LIMIT = 2000;
/** Report rows returned per preview page. */
export const REPORTS_PAGE_SIZE = 25;
/** Hard cap on rows computed for one report dataset. */
export const REPORT_ROW_LIMIT = 2000;
/** Hard cap on rows written into one export file. */
export const EXPORT_ROW_LIMIT = 5000;
/** Archived records listed per page in the archive center. */
export const ARCHIVE_PAGE_SIZE = 20;
/** Audit events listed per page in the archive center. */
export const ARCHIVE_EVENTS_LIMIT = 30;

/* ------------------------------------------------------------------ */
/* Canonical keys                                                       */
/* ------------------------------------------------------------------ */

export const ARCHIVE_ENTITY_TYPES = [
  "PROGRAM",
  "COURSE",
  "ASSESSMENT",
  "ASSIGNMENT",
  "SURVEY",
  "FOLLOW_UP",
] as const;
export type ArchiveEntityType = (typeof ARCHIVE_ENTITY_TYPES)[number];

export const ARCHIVE_ACTIONS = ["ARCHIVED", "RESTORED"] as const;
export type ArchiveAction = (typeof ARCHIVE_ACTIONS)[number];

/* ------------------------------------------------------------------ */
/* Arabic labels                                                        */
/* ------------------------------------------------------------------ */

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "مدير النظام",
  DEVELOPMENT_OFFICE_MANAGER: "مدير مكتب التطوير",
  EDUCATIONAL_DEPUTY: "الوكيل التعليمي",
  EDUCATIONAL_SUPERVISOR: "المشرف التربوي",
  TEACHER: "المعلم",
};

export const ARCHIVE_ENTITY_LABELS: Record<ArchiveEntityType, string> = {
  PROGRAM: "برنامج تدريبي",
  COURSE: "دورة تدريبية",
  ASSESSMENT: "تقييم",
  ASSIGNMENT: "تكليف",
  SURVEY: "استبيان",
  FOLLOW_UP: "سجل متابعة",
};

export const ARCHIVE_ACTION_LABELS: Record<ArchiveAction, string> = {
  ARCHIVED: "أرشفة",
  RESTORED: "استعادة",
};

/** Lifecycle labels for content the archive center displays read-only. */
export const CONTENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "مسودة",
  PUBLISHED: "منشور",
  CLOSED: "مغلق",
  ARCHIVED: "مؤرشف",
  ISSUED: "صادر",
  REVOKED: "ملغى",
  PLANNED: "مجدولة",
  IN_PROGRESS: "قيد التنفيذ",
  COMPLETED: "مكتملة",
  CANCELLED: "ملغاة",
};

/** Arabic month labels for trend charts (Gregorian, index = month-1). */
export const MONTH_LABELS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
] as const;
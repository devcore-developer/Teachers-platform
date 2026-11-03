/**
 * Phase 11 — Notifications, email delivery and integration configuration.
 *
 * Canonical English keys + Arabic UI labels (SQLite has no native enums,
 * so every status/type column is a canonical string key validated in the
 * service layer against the const arrays exported here).
 *
 * UI is Arabic; code is English — same convention as the other modules.
 */

/* ---- Notification event types ------------------------------------ */

/**
 * Stable event keys. Event-driven notifications also carry a derived
 * eventId (unique per recipient) so retried events never duplicate.
 */
export const NOTIFICATION_TYPES = [
  // Account & security (always delivered — never preference-gated).
  "ACCOUNT_ACTIVATED",
  "PASSWORD_CHANGED",
  "PASSWORD_RESET_REQUESTED",
  // Assignments.
  "ASSIGNMENT_PUBLISHED",
  "ASSIGNMENT_DEADLINE_REMINDER",
  "SUBMISSION_RECEIVED",
  "SUBMISSION_RETURNED",
  "SUBMISSION_GRADED",
  // Assessments (wired when the assessment service module is present).
  "ASSESSMENT_PUBLISHED",
  "ASSESSMENT_RESULT_RELEASED",
  // Courses.
  "COURSE_COMPLETED",
  // Certificates.
  "CERTIFICATE_ISSUED",
  "CERTIFICATE_REVOKED",
  // Surveys.
  "SURVEY_PUBLISHED",
  // Follow-ups.
  "FOLLOWUP_CREATED",
  "FOLLOWUP_UPDATED",
  "FOLLOWUP_STATUS_CHANGED",
  "FOLLOWUP_SHARED",
  // Platform-level notices (SUPER_ADMIN broadcast tooling).
  "PLATFORM_NOTICE",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/* ---- Categories --------------------------------------------------- */

export const NOTIFICATION_CATEGORIES = [
  "ACCOUNT",
  "ASSIGNMENTS",
  "ASSESSMENTS",
  "COURSES",
  "SURVEYS",
  "FOLLOWUPS",
  "CERTIFICATES",
  "PLATFORM",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Canonical type → category mapping (single source of truth). */
export const NOTIFICATION_CATEGORY_BY_TYPE: Record<NotificationType, NotificationCategory> = {
  ACCOUNT_ACTIVATED: "ACCOUNT",
  PASSWORD_CHANGED: "ACCOUNT",
  PASSWORD_RESET_REQUESTED: "ACCOUNT",
  ASSIGNMENT_PUBLISHED: "ASSIGNMENTS",
  ASSIGNMENT_DEADLINE_REMINDER: "ASSIGNMENTS",
  SUBMISSION_RECEIVED: "ASSIGNMENTS",
  SUBMISSION_RETURNED: "ASSIGNMENTS",
  SUBMISSION_GRADED: "ASSIGNMENTS",
  ASSESSMENT_PUBLISHED: "ASSESSMENTS",
  ASSESSMENT_RESULT_RELEASED: "ASSESSMENTS",
  COURSE_COMPLETED: "COURSES",
  CERTIFICATE_ISSUED: "CERTIFICATES",
  CERTIFICATE_REVOKED: "CERTIFICATES",
  SURVEY_PUBLISHED: "SURVEYS",
  FOLLOWUP_CREATED: "FOLLOWUPS",
  FOLLOWUP_UPDATED: "FOLLOWUPS",
  FOLLOWUP_STATUS_CHANGED: "FOLLOWUPS",
  FOLLOWUP_SHARED: "FOLLOWUPS",
  PLATFORM_NOTICE: "PLATFORM",
};

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  ACCOUNT: "الحساب والأمان",
  ASSIGNMENTS: "الواجبات",
  ASSESSMENTS: "الاختبارات",
  COURSES: "المقررات التدريبية",
  SURVEYS: "الاستبيانات",
  FOLLOWUPS: "المتابعات الميدانية",
  CERTIFICATES: "الشهادات",
  PLATFORM: "إشعارات المنصة",
};

/** Category → matching NotificationPreference boolean column. */
export const CATEGORY_PREFERENCE_FIELD: Record<NotificationCategory, string> = {
  ACCOUNT: "accountAlwaysOn",
  ASSIGNMENTS: "assignments",
  ASSESSMENTS: "assessments",
  COURSES: "courses",
  SURVEYS: "surveys",
  FOLLOWUPS: "followups",
  CERTIFICATES: "certificates",
  PLATFORM: "platform",
};

/** Chip classes per category (matches the project's badge conventions). */
export const NOTIFICATION_CATEGORY_CLASSES: Record<NotificationCategory, string> = {
  ACCOUNT: "bg-slate-100 text-slate-700 border-slate-200",
  ASSIGNMENTS: "bg-blue-50 text-blue-700 border-blue-200",
  ASSESSMENTS: "bg-indigo-50 text-indigo-700 border-indigo-200",
  COURSES: "bg-cyan-50 text-cyan-700 border-cyan-200",
  SURVEYS: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FOLLOWUPS: "bg-amber-50 text-amber-700 border-amber-200",
  CERTIFICATES: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PLATFORM: "bg-slate-100 text-slate-700 border-slate-200",
};

/* ---- Email delivery states ---------------------------------------- */

export const EMAIL_DELIVERY_STATUSES = ["QUEUED", "PROCESSING", "SENT", "FAILED"] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const EMAIL_DELIVERY_STATUS_LABELS: Record<EmailDeliveryStatus, string> = {
  QUEUED: "في قائمة الانتظار",
  PROCESSING: "قيد المعالجة",
  SENT: "تم الإرسال",
  FAILED: "فشل الإرسال",
};

export const EMAIL_DELIVERY_STATUS_CLASSES: Record<EmailDeliveryStatus, string> = {
  QUEUED: "bg-amber-50 text-amber-700 border-amber-200",
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-200",
  SENT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
};

/** Sanitized error categories persisted on EmailDelivery (never raw provider text). */
export const EMAIL_ERROR_CATEGORIES = [
  "NETWORK",
  "AUTH",
  "RATE_LIMIT",
  "VALIDATION",
  "PROVIDER",
  "NOT_CONFIGURED",
  "EXPIRED",
] as const;
export type EmailErrorCategory = (typeof EMAIL_ERROR_CATEGORIES)[number];

export const EMAIL_ERROR_CATEGORY_LABELS: Record<EmailErrorCategory, string> = {
  NETWORK: "خطأ شبكة مؤقت",
  AUTH: "خطأ مصادقة لدى المزوّد",
  RATE_LIMIT: "تجاوز حد المزوّد",
  VALIDATION: "بيانات رسالة غير صالحة",
  PROVIDER: "خطأ من مزوّد البريد",
  NOT_CONFIGURED: "البريد غير مُهيأ",
  EXPIRED: "تجاوز عمر الرسالة الحد المسموح",
};

/** Mirror statuses stored on Notification.emailStatus. */
export const NOTIFICATION_EMAIL_STATUSES = ["QUEUED", "SENT", "FAILED", "DISABLED"] as const;
export type NotificationEmailStatus = (typeof NOTIFICATION_EMAIL_STATUSES)[number];

export const NOTIFICATION_EMAIL_STATUS_LABELS: Record<NotificationEmailStatus, string> = {
  QUEUED: "البريد: في الانتظار",
  SENT: "البريد: تم الإرسال",
  FAILED: "البريد: فشل",
  DISABLED: "البريد: معطّل بحسب تفضيلاتك",
};

/* ---- Limits & scheduling ------------------------------------------ */

/** Rows per page on the full notification history. */
export const NOTIFICATIONS_PAGE_SIZE = 20;
/** Rows returned for the bell dropdown. */
export const NOTIFICATIONS_BELL_LIMIT = 8;
/** Hard cap on list queries (protection against unbounded histories). */
export const NOTIFICATIONS_MAX_SCAN = 500;

/** Assignment deadline reminders fire when the deadline is within this window. */
export const DEADLINE_REMINDER_WINDOW_HOURS = 24;
/** Maximum deadline reminders created per scan run (bounded work per tick). */
export const DEADLINE_REMINDER_BATCH_LIMIT = 500;
/** Maximum course-completion notifications created per scan run. */
export const COURSE_COMPLETION_BATCH_LIMIT = 500;

/** Outbound email queue defaults. */
export const EMAIL_MAX_ATTEMPTS_DEFAULT = 4;
/** Backoff (minutes) before retry N — index = attempt number that just failed. */
export const EMAIL_RETRY_BACKOFF_MINUTES = [2, 10, 30];
/** A queued message older than this is abandoned as EXPIRED (bounded queue). */
export const EMAIL_QUEUE_MAX_AGE_HOURS = 72;
/** Rows claimed per dispatcher run. */
export const EMAIL_DISPATCH_BATCH_LIMIT = 25;

/** Optional in-process scheduler tick (only when ENABLE_INTERNAL_SCHEDULER=true). */
export const INTERNAL_SCHEDULER_INTERVAL_SECONDS = 60;

/* ---- Public app origin (email links) ------------------------------- */

/**
 * Base URL used inside outbound emails. Required in production so links
 * point at the real deployment; falls back to a relative marker in dev.
 */
export function appPublicOrigin(): string | null {
  const raw = (process.env.APP_PUBLIC_ORIGIN ?? "").trim();
  if (!raw) return null;
  // Must be a plain https(s) origin — never a path, never user input.
  if (!/^https:\/\/[A-Za-z0-9.\-]+(:\d{2,5})?$/.test(raw)) return null;
  return raw.replace(/\/+$/, "");
}

/* ---- Integration provider keys ------------------------------------ */

export const EMAIL_PROVIDER_KINDS = ["NONE", "RESEND"] as const;
export type EmailProviderKind = (typeof EMAIL_PROVIDER_KINDS)[number];
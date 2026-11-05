/**
 * Phase 8 — canonical keys, numeric limits and Arabic UI labels for
 * certificates, verification and professional growth.
 *
 * SQLite has no enums: every persisted status is a canonical English
 * string from this file, validated with Zod on every write. All
 * user-visible text lives here (UI is Arabic, code is English).
 */

/* ------------------------------------------------------------------ */
/* Pagination & caps                                                    */
/* ------------------------------------------------------------------ */

export const CERTIFICATES_PAGE_SIZE = 10;
export const MAX_CERT_TITLE_LENGTH = 200;
export const MAX_CERT_DESCRIPTION_LENGTH = 2000;
export const MAX_REVOCATION_REASON_LENGTH = 500;
export const MAX_VERIFICATION_QUERY_LENGTH = 100;

/** Cap on the roster list (school-scale data; keeps queries bounded). */
export const GROWTH_ROSTER_LIMIT = 200;
/** Cap on the per-teacher history timeline. */
export const GROWTH_HISTORY_LIMIT = 60;
/** Cap on platform-wide school rows in the Super Admin aggregate. */
export const PLATFORM_SCHOOLS_LIMIT = 50;
/** Cap on scanned courses for the "eligible awaiting issuance" metric. */
export const METRICS_COURSES_LIMIT = 100;

/* ------------------------------------------------------------------ */
/* Identifier generation (server-side only, never client-trusted)       */
/* ------------------------------------------------------------------ */

/**
 * Crockford base32 without the ambiguous I/L/O/U — safe to read aloud
 * or print on a certificate. 256 % 32 === 0 so byte%len has no bias.
 */
export const CERTIFICATE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Verification code: 16 chars (~80 bits) — collision-resistant. */
export const VERIFICATION_CODE_LENGTH = 16;

/** Certificate number: MQ-YYYY-XXXXXX (6 random chars + year guard). */
export const CERT_NUMBER_RANDOM_LENGTH = 6;
export const CERT_NUMBER_PREFIX = "MQ";

/** Retry budget when the DB unique constraint rejects a generated id. */
export const IDENTIFIER_GENERATION_ATTEMPTS = 5;

/* ------------------------------------------------------------------ */
/* Canonical keys                                                       */
/* ------------------------------------------------------------------ */

/** Persisted certificate lifecycle states. */
export const CERTIFICATE_STATUSES = ["ISSUED", "REVOKED"] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

/** Derived display states (EXPIRED is computed from expiresAt, never stored). */
export const CERTIFICATE_EFFECTIVE_STATUSES = [
  "ISSUED",
  "REVOKED",
  "EXPIRED",
] as const;
export type CertificateEffectiveStatus =
  (typeof CERTIFICATE_EFFECTIVE_STATUSES)[number];

/** Audit event types (append-only CertificateEvent rows). */
export const CERTIFICATE_EVENT_TYPES = ["ISSUED", "REVOKED"] as const;
export type CertificateEventType = (typeof CERTIFICATE_EVENT_TYPES)[number];

/** The qualifying content a certificate may reference. */
export const CERT_CONTENT_TYPES = ["COURSE", "PROGRAM"] as const;
export type CertContentType = (typeof CERT_CONTENT_TYPES)[number];

/** Eligibility rule keys (stable keys persisted in the criteria snapshot). */
export const ELIGIBILITY_RULE_KEYS = [
  "ENROLLMENT",
  "ASSESSMENTS",
] as const;
export type EligibilityRuleKey = (typeof ELIGIBILITY_RULE_KEYS)[number];

/* ------------------------------------------------------------------ */
/* Arabic labels                                                        */
/* ------------------------------------------------------------------ */

export const CERTIFICATE_STATUS_LABELS: Record<CertificateStatus, string> = {
  ISSUED: "صادرة",
  REVOKED: "مُلغاة",
};

export const CERTIFICATE_STATUS_CLASSES: Record<CertificateStatus, string> = {
  ISSUED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REVOKED: "bg-red-50 text-red-700 border-red-200",
};

export const EFFECTIVE_STATUS_LABELS: Record<CertificateEffectiveStatus, string> = {
  ISSUED: "صادرة وسارية",
  REVOKED: "مُلغاة",
  EXPIRED: "منتهية الصلاحية",
};

export const EFFECTIVE_STATUS_CLASSES: Record<CertificateEffectiveStatus, string> = {
  ISSUED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REVOKED: "bg-red-50 text-red-700 border-red-200",
  EXPIRED: "bg-amber-50 text-amber-700 border-amber-200",
};

export const CERT_CONTENT_TYPE_LABELS: Record<CertContentType, string> = {
  COURSE: "دورة تدريبية",
  PROGRAM: "برنامج تدريبي",
};

export const ELIGIBILITY_RULE_LABELS: Record<EligibilityRuleKey, string> = {
  ENROLLMENT: "الالتحاق بالمحتوى التدريبي",
  ASSESSMENTS: "اجتياز التقييمات المرتبطة",
};

/** Issuing-authority labels snapshot (stored on the certificate). */
export const ISSUER_ROLE_LABELS: Record<string, string> = {
  DEVELOPMENT_OFFICE_MANAGER: "مدير مكتب التطوير",
  SCHOOL_MANAGER: "مدير المدرسة",
  SUPER_ADMIN: "الإدارة العامة للمنصة",
};

/** Audit event type labels (certificate detail timeline). */
export const CERTIFICATE_EVENT_TYPE_LABELS: Record<string, string> = {
  ISSUED: "إصدار",
  REVOKED: "إلغاء",
};

/** Growth history event type labels (display only). */
export const GROWTH_EVENT_TYPE_LABELS: Record<string, string> = {
  ENROLLMENT: "التحاق",
  ASSESSMENT: "تقييم",
  ASSIGNMENT: "تكليف",
  CERTIFICATE: "شهادة",
};

/** Platform name used on the printed certificate. */
export const PLATFORM_NAME_AR = "منارة قرطبة";

/** Brand fallback (matches School.brandColor default). */
export const DEFAULT_BRAND_COLOR = "#1D5BD6";
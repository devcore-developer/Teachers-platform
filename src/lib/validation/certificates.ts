/**
 * Phase 8 — Zod validation for certificates, revocation, verification
 * and growth params.
 *
 * Every write path re-validates its raw input here (Arabic messages),
 * mirroring the Phase 6/7 validation layer. Client payloads are NEVER
 * trusted: teacher ids, content ids, statuses and dates are all
 * re-checked against the database inside the service layer.
 *
 * Schema shapes are version-agnostic (zod v3 and v4): no
 * required_error/invalid_type_error params, no z.undefined() inside
 * unions — preprocess degrades missing fields instead.
 */
import { z } from "zod";

import {
  MAX_CERT_DESCRIPTION_LENGTH,
  MAX_CERT_TITLE_LENGTH,
  MAX_REVOCATION_REASON_LENGTH,
  MAX_VERIFICATION_QUERY_LENGTH,
} from "@/config/certificates";

/* ------------------------------------------------------------------ */
/* Result contract (same shape as the assessment/assignment layers)     */
/* ------------------------------------------------------------------ */

export type CertificateErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RELATION_ERROR"
  | "TEACHER_INVALID"
  | "CONTENT_INVALID"
  | "NOT_ELIGIBLE"
  | "ALREADY_ISSUED"
  | "ALREADY_REVOKED"
  | "RATE_LIMITED";

export type CertificateResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      message: string;
      code: CertificateErrorCode;
      fieldErrors?: Record<string, string>;
    };

export function certificateFail<T>(
  message: string,
  code: CertificateErrorCode
): CertificateResult<T> {
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

export function validationFail<T>(error: z.ZodError): CertificateResult<T> {
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

const requiredId = (label: string) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z
      .string()
      .trim()
      .min(1, `${label} مطلوب`)
      .max(64, `${label} غير صالح`)
  );

/**
 * Accepts datetime-local strings and ISO strings; empty degrades to
 * undefined (optional field). Manual preprocess keeps v3/v4 parity.
 */
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

/** Verification query: free text (number or code) — normalized later in the service. */
const verificationQuery = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z
    .string()
    .trim()
    .min(4, "أدخل رقم الشهادة أو رمز التحقق")
    .max(MAX_VERIFICATION_QUERY_LENGTH, `الاستعلام يتجاوز الحد الأقصى (${MAX_VERIFICATION_QUERY_LENGTH} حرفًا)`)
);

/* ------------------------------------------------------------------ */
/* Schemas                                                              */
/* ------------------------------------------------------------------ */

export const issueCertificateSchema = z.object({
  teacherId: requiredId("المعلم"),
  /** COURSE | PROGRAM — selects how contentId is interpreted. */
  contentType: z.enum(["COURSE", "PROGRAM"]),
  contentId: requiredId("المحتوى التدريبي"),
  /** Optional overrides — the server derives sensible defaults. */
  titleAr: optionalTrimmed(MAX_CERT_TITLE_LENGTH, "عنوان الشهادة"),
  titleEn: optionalTrimmed(MAX_CERT_TITLE_LENGTH, "العنوان الإنجليزي"),
  descriptionAr: optionalTrimmed(MAX_CERT_DESCRIPTION_LENGTH, "وصف الشهادة"),
  descriptionEn: optionalTrimmed(MAX_CERT_DESCRIPTION_LENGTH, "الوصف الإنجليزي"),
  /** Optional expiration (null = valid indefinitely). */
  expiresAt: optionalDate("تاريخ انتهاء الصلاحية"),
});

export type IssueCertificateInput = z.infer<typeof issueCertificateSchema>;

export const revokeCertificateSchema = z.object({
  certificateId: requiredId("الشهادة"),
  reason: trimmedArabic(MAX_REVOCATION_REASON_LENGTH, "سبب الإلغاء"),
});

export type RevokeCertificateInput = z.infer<typeof revokeCertificateSchema>;

export const verifyCertificateSchema = z.object({
  query: verificationQuery,
});

export type VerifyCertificateInput = z.infer<typeof verifyCertificateSchema>;

/**
 * Normalizes a verification query for lookup: uppercase + strip every
 * non-alphanumeric char (spaces/dashes from grouped display codes).
 */
export function normalizeVerificationQuery(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
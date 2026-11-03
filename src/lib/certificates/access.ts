/**
 * Phase 8 — pure access predicates and tenant scoping for certificates
 * and professional growth.
 *
 * No DB access lives here — every rule is unit-testable and the service
 * layer composes these helpers. The actor is ALWAYS built server-side
 * from the session user after an explicit role check; client payloads
 * can never widen it.
 *
 * Role capability matrix (fixed by the product, enforced server-side):
 *   DEVELOPMENT_OFFICE_MANAGER — issue/revoke/list within OWN school,
 *                                growth roster for the school.
 *   EDUCATIONAL_SUPERVISOR     — view certificates + growth of ASSIGNED
 *                                teachers. Never issues/revokes.
 *   EDUCATIONAL_DEPUTY         — read-only certificates/growth within
 *                                granted school/branch scope.
 *   SUPER_ADMIN                — platform-wide READ-ONLY stats and
 *                                records. Never issues/revokes.
 *   TEACHER                    — own certificates (view/print) and own
 *                                growth only. NEVER verification.
 */
import { certificateFail, type CertificateErrorCode, type CertificateResult } from "@/lib/validation/certificates";

/* ------------------------------------------------------------------ */
/* Actor identity (back-office; mirrors the Phase 7 AssignmentActor)    */
/* ------------------------------------------------------------------ */

export interface CertificateActor {
  id: string;
  name?: string;
  role:
    | "SUPER_ADMIN"
    | "DEVELOPMENT_OFFICE_MANAGER"
    | "EDUCATIONAL_SUPERVISOR"
    | "EDUCATIONAL_DEPUTY";
  schoolId: string | null;
}

/**
 * Any authenticated viewer projection used by read paths that also
 * serve teachers (own-certificate view, own growth). Built from the
 * session — never from a payload.
 */
export interface CertificateViewer {
  id: string;
  role: string;
  schoolId: string | null;
}

/* ------------------------------------------------------------------ */
/* Role capabilities                                                    */
/* ------------------------------------------------------------------ */

/** Issuance is school-office work — SUPER_ADMIN is intentionally excluded. */
export function canIssueCertificates(role: string): boolean {
  return role === "DEVELOPMENT_OFFICE_MANAGER";
}

/** Revocation follows the same rule as issuance (audit preserved). */
export function canRevokeCertificates(role: string): boolean {
  return role === "DEVELOPMENT_OFFICE_MANAGER";
}

/** Verification: authorized NON-teacher roles only (teachers never verify). */
export function canVerifyCertificates(role: string): boolean {
  return (
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "EDUCATIONAL_SUPERVISOR" ||
    role === "EDUCATIONAL_DEPUTY" ||
    role === "SUPER_ADMIN"
  );
}

/** Certificate management list pages (office manager workspace). */
export function canManageCertificateWorkspace(role: string): boolean {
  return role === "DEVELOPMENT_OFFICE_MANAGER";
}

/**
 * Read access to certificate RECORDS beyond ownership. Teachers are
 * handled separately (owner-only); SUPER_ADMIN may read records
 * platform-wide but never mutate.
 */
export function canReadCertificateRecords(role: string): boolean {
  return (
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "EDUCATIONAL_SUPERVISOR" ||
    role === "EDUCATIONAL_DEPUTY" ||
    role === "SUPER_ADMIN"
  );
}

/** Growth roster pages for back-office roles (Super Admin gets aggregates). */
export function canViewGrowthRoster(role: string): boolean {
  return (
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "EDUCATIONAL_SUPERVISOR" ||
    role === "EDUCATIONAL_DEPUTY"
  );
}

/* ------------------------------------------------------------------ */
/* Failure helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Certificates are always school-owned; a null/missing school context
 * can never match (this blocks SUPER_ADMIN operational access too).
 */
export function certificateScopeError(
  ctx: CertificateActor,
  schoolId: string | null
): CertificateResult<never> | null {
  if (!schoolId || ctx.schoolId !== schoolId) {
    return certificateFail(
      "لا تملك صلاحية الوصول إلى هذه الشهادة — النطاق المدرسي مختلف",
      "FORBIDDEN"
    );
  }
  return null;
}

export function issueGuard(ctx: CertificateActor): CertificateResult<never> | null {
  if (!canIssueCertificates(ctx.role)) {
    return certificateFail(
      "إصدار الشهادات متاح لمديري مكاتب التطوير فقط",
      "FORBIDDEN"
    );
  }
  if (!ctx.schoolId) {
    return certificateFail(
      "إصدار الشهادات يتطلب نطاقًا مدرسيًا محددًا",
      "FORBIDDEN"
    );
  }
  return null;
}

export function verifyGuard(ctx: CertificateActor): CertificateResult<never> | null {
  if (!canVerifyCertificates(ctx.role)) {
    return certificateFail(
      "التحقق من الشهادات متاح للأدوار الإدارية المعتمدة فقط — لا يشمل المعلمين",
      "FORBIDDEN"
    );
  }
  return null;
}

export type { CertificateErrorCode };
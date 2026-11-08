import type { AdminContext, SupervisorTrainingContext } from "@/lib/auth/dev-admin";
import type { AssessmentErrorCode, AssessmentResult } from "@/lib/validation/assessment";

/**
 * Any context allowed into the assessment management service layer:
 * the administrative trio PLUS the educational supervisor (whose
 * tenant fence is identical — own school only, never platform-wide).
 */
export type AssessmentManageContext = AdminContext | SupervisorTrainingContext;

/* ------------------------------------------------------------------ */
/* Assessments — authorization & visibility predicates.                 */
/*                                                                      */
/* Pure functions (no DB, no session) so the rules are unit-testable.   */
/* Tenancy rule mirrors the training academy: schoolId === null means   */
/* PLATFORM-WIDE shared content; only SUPER_ADMIN may create or manage  */
/* platform-wide records.                                               */
/* ------------------------------------------------------------------ */

/** Session-safe viewer identity used for read-side checks. */
export interface ViewerIdentity {
  id: string;
  role: string;
  schoolId: string | null;
}

/** Minimal projection of an assessment row for visibility checks. */
export interface ScopedAssessment {
  status: string;
  schoolId: string | null;
}

/**
 * Roles allowed to manage assessments. The educational supervisor
 * manages assessments for their OWN school only — the fence is
 * structural in `assessmentScopeError` below (platform-wide records
 * stay SUPER_ADMIN-only).
 */
export function canManageAssessments(role: string): boolean {
  return (
    role === "SUPER_ADMIN" ||
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "SCHOOL_MANAGER" ||
    role === "EDUCATIONAL_SUPERVISOR"
  );
}

/**
 * Can this viewer SEE a PUBLISHED assessment in ordinary browsing?
 *   - platform-wide (schoolId null) -> every authenticated viewer
 *   - school-owned                  -> viewers of the same school only
 * Non-published records are NEVER visible through this predicate —
 * managers reach drafts through the manage-scope path below.
 */
export function canViewPublishedAssessment(
  viewer: ViewerIdentity,
  record: ScopedAssessment
): boolean {
  if (record.status !== "PUBLISHED") return false;
  if (record.schoolId === null) return true;
  return viewer.schoolId !== null && viewer.schoolId === record.schoolId;
}

/**
 * Prisma `where` fragment for teacher catalog listings. SUPER_ADMIN
 * browses every published assessment; everyone else is confined to
 * platform-wide + their own school's published assessments.
 */
export function publishedAssessmentWhere(viewer: ViewerIdentity): {
  status: string;
  OR?: Array<{ schoolId: string | null }>;
} {
  if (viewer.role === "SUPER_ADMIN") {
    return { status: "PUBLISHED" };
  }
  const scopes: Array<{ schoolId: string | null }> = [{ schoolId: null }];
  if (viewer.schoolId) scopes.push({ schoolId: viewer.schoolId });
  return { status: "PUBLISHED", OR: scopes };
}

export type ScopeRejection = {
  ok: false;
  message: string;
  code: Extract<AssessmentErrorCode, "FORBIDDEN">;
};

/**
 * Manage-scope enforcement (mirror of the schools/training semantics,
 * extended for nullable school scope):
 *   SUPER_ADMIN                -> any record (incl. platform-wide)
 *   DEVELOPMENT_OFFICE_MANAGER -> only records owned by their school
 *   SCHOOL_MANAGER             -> only records owned by their school
 *   anything else              -> always rejected (defense in depth)
 * Platform-wide records (schoolId null) can never be managed by a
 * school-scoped role — no exceptions.
 */
export function assessmentScopeError(
  ctx: AssessmentManageContext,
  recordSchoolId: string | null
): ScopeRejection | null {
  if (ctx.role === "SUPER_ADMIN") return null;
  if (
    (ctx.role === "DEVELOPMENT_OFFICE_MANAGER" ||
      ctx.role === "SCHOOL_MANAGER" ||
      ctx.role === "EDUCATIONAL_SUPERVISOR") &&
    recordSchoolId !== null &&
    recordSchoolId === ctx.schoolId
  ) {
    return null;
  }
  return {
    ok: false,
    message: "ليس لديك صلاحية إدارة هذا الاختبار — العملية مرفوضة",
    code: "FORBIDDEN",
  };
}

/** Uniform failure helper shared with the service layer. */
export function assessmentFail<T>(
  message: string,
  code?: AssessmentErrorCode
): AssessmentResult<T> {
  return { ok: false, message, code };
}

/**
 * Availability state of a PUBLISHED assessment at a moment in time.
 * Returned to teachers so the UI can show honest, specific states.
 */
export type AvailabilityState =
  | "available"
  | "scheduled"
  | "closed";

export function availabilityState(
  record: { availableFrom: Date | null; availableUntil: Date | null },
  now: Date = new Date()
): AvailabilityState {
  if (record.availableFrom && now.getTime() < record.availableFrom.getTime()) {
    return "scheduled";
  }
  if (record.availableUntil && now.getTime() > record.availableUntil.getTime()) {
    return "closed";
  }
  return "available";
}
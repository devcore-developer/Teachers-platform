/**
 * Phase 9 — pure access predicates and tenant scoping for impact
 * surveys, responses, follow-ups and outcome analysis.
 *
 * No DB access lives here — every rule is unit-testable and the service
 * layer composes these helpers. The actor is ALWAYS built server-side
 * from the session user after an explicit role check; client payloads
 * can never widen it.
 *
 * Role capability matrix (fixed by the product, enforced server-side):
 *   DEVELOPMENT_OFFICE_MANAGER — create/manage ALL school surveys,
 *                                manage school follow-ups, full results
 *                                of non-anonymous surveys, individual
 *                                responses of non-anonymous surveys.
 *   EDUCATIONAL_SUPERVISOR     — create/manage OWN surveys within the
 *                                assigned scope, follow-ups for covered
 *                                teachers, results of OWN surveys.
 *   EDUCATIONAL_DEPUTY         — READ-ONLY school/branch summaries and
 *                                follow-up progress. Never creates,
 *                                publishes, closes or edits anything.
 *   SUPER_ADMIN                — platform-wide AGGREGATE statistics
 *                                only. Never edits school surveys,
 *                                never reads individual responses,
 *                                never modifies follow-up records.
 *   TEACHER                    — sees surveys targeted at them, submits
 *                                responses, sees own (identified)
 *                                response history and explicitly shared
 *                                follow-up info. Never supervisor notes.
 */
import { surveyFail, type SurveyErrorCode, type SurveyResult } from "@/lib/validation/surveys";

/* ------------------------------------------------------------------ */
/* Actor identity (back-office; mirrors the Phase 7/8 actor types)      */
/* ------------------------------------------------------------------ */

export interface SurveyActor {
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
 * serve teachers (available surveys, own responses, shared follow-ups).
 * Built from the session — never from a payload.
 */
export interface SurveyViewer {
  id: string;
  role: string;
  schoolId: string | null;
}

/* ------------------------------------------------------------------ */
/* Role capabilities                                                    */
/* ------------------------------------------------------------------ */

/**
 * Survey creation/management: office managers (whole school) and
 * supervisors (own surveys within assigned scope). Deputies and the
 * Super Admin are intentionally excluded — read-only/aggregate roles.
 */
export function canCreateSurveys(role: string): boolean {
  return role === "DEVELOPMENT_OFFICE_MANAGER" || role === "EDUCATIONAL_SUPERVISOR";
}

/** Follow-up creation: same two operational roles, same scoping. */
export function canManageFollowUps(role: string): boolean {
  return role === "DEVELOPMENT_OFFICE_MANAGER" || role === "EDUCATIONAL_SUPERVISOR";
}

/** Read-only access to school survey lists/summaries (deputies included). */
export function canViewSurveySummaries(role: string): boolean {
  return (
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "EDUCATIONAL_SUPERVISOR" ||
    role === "EDUCATIONAL_DEPUTY"
  );
}

/**
 * Aggregate results of a school survey: operational roles + deputies.
 * SUPER_ADMIN is excluded from per-survey results — platform aggregates
 * live in the impact service instead.
 */
export function canViewSurveyResults(role: string): boolean {
  return (
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "EDUCATIONAL_SUPERVISOR" ||
    role === "EDUCATIONAL_DEPUTY"
  );
}

/**
 * Individual (respondent-identified) answers: operational roles only,
 * AND only for non-anonymous surveys (second check lives in the
 * service and can never be bypassed by role alone).
 */
export function canViewIndividualResponses(role: string): boolean {
  return role === "DEVELOPMENT_OFFICE_MANAGER" || role === "EDUCATIONAL_SUPERVISOR";
}

/** Platform-wide impact aggregates (Super Admin dashboard). */
export function canViewPlatformImpact(role: string): boolean {
  return role === "SUPER_ADMIN";
}

/* ------------------------------------------------------------------ */
/* Failure guards                                                       */
/* ------------------------------------------------------------------ */

/**
 * Surveys/follow-ups are always school-owned; a null/missing school
 * context can never match (this blocks SUPER_ADMIN operational access).
 */
export function surveyScopeError(
  ctx: { role: string; schoolId: string | null },
  schoolId: string
): SurveyResult<never> | null {
  if (ctx.role === "SUPER_ADMIN") {
    return surveyFail(
      "الإدارة التشغيلية للاستبيانات المدرسية غير متاحة لحساب المنصة — الأدوار التشغيلية داخل المدرسة فقط",
      "FORBIDDEN"
    );
  }
  if (!ctx.schoolId || ctx.schoolId !== schoolId) {
    return surveyFail(
      "لا تملك صلاحية الوصول إلى هذا الاستبيان — النطاق المدرسي مختلف",
      "FORBIDDEN"
    );
  }
  return null;
}

export function createSurveyGuard(ctx: SurveyActor): SurveyResult<never> | null {
  if (!canCreateSurveys(ctx.role)) {
    return surveyFail(
      "إنشاء الاستبيانات متاح لمديري مكاتب التطوير والمشرفين التربويين فقط",
      "FORBIDDEN"
    );
  }
  if (!ctx.schoolId) {
    return surveyFail("إنشاء الاستبيانات يتطلب نطاقًا مدرسيًا محددًا", "FORBIDDEN");
  }
  return null;
}

export function manageFollowUpGuard(ctx: SurveyActor): SurveyResult<never> | null {
  if (!canManageFollowUps(ctx.role)) {
    return surveyFail(
      "إدارة سجلات المتابعة متاحة لمديري مكاتب التطوير والمشرفين التربويين فقط",
      "FORBIDDEN"
    );
  }
  if (!ctx.schoolId) {
    return surveyFail("إدارة سجلات المتابعة تتطلب نطاقًا مدرسيًا محددًا", "FORBIDDEN");
  }
  return null;
}

export type { SurveyErrorCode };
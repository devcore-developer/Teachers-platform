/**
 * Phase 7 — pure access predicates and tenant scoping for assignments.
 *
 * No DB access lives here (except none — this module is intentionally
 * side-effect free) so every rule is unit-testable. The service layer
 * composes these helpers and NEVER trusts client-provided scope:
 * the actor's school/branch/role always come from the session-backed
 * context, and supervisor reach comes from persisted assignments.
 */
import type { AudienceMode } from "@/config/assignments";
import {
  assignmentFail,
  type AssignmentErrorCode,
  type AssignmentResult,
} from "@/lib/validation/assignments";

/* ------------------------------------------------------------------ */
/* Viewer identity (teacher-side; same shape as the assessment layer)   */
/* ------------------------------------------------------------------ */

export interface ViewerIdentity {
  id: string;
  role: string;
  schoolId: string | null;
}

/**
 * Phase 7 actor (write-capable back-office roles). Defined LOCALLY on
 * purpose: assignments must also accept EDUCATIONAL_SUPERVISOR (review)
 * and EDUCATIONAL_DEPUTY (read-only overview) beyond the platform's own
 * AdminContext union. SCHOOL_MANAGER is admitted with the same powers as
 * the office manager — structurally confined to its own school by
 * `assignmentScopeError` (its schoolId comes from the DB session, never
 * from the client). Every value is built server-side from the session
 * user after an explicit role check — never from the payload.
 * `name` is optional so callers may pass a bare identity projection.
 */
export interface AssignmentActor {
  id: string;
  name?: string;
  role:
    | "SUPER_ADMIN"
    | "DEVELOPMENT_OFFICE_MANAGER"
    | "SCHOOL_MANAGER"
    | "EDUCATIONAL_SUPERVISOR"
    | "EDUCATIONAL_DEPUTY";
  schoolId: string | null;
}

/* ------------------------------------------------------------------ */
/* Role capabilities                                                    */
/* ------------------------------------------------------------------ */

/**
 * Assignment management is school-office work — SUPER_ADMIN is
 * stats-only. SCHOOL_MANAGER runs the same office inside its own school.
 */
export function canManageAssignments(role: string): boolean {
  return role === "DEVELOPMENT_OFFICE_MANAGER" || role === "SCHOOL_MANAGER";
}

/**
 * Reviewing/grading: office manager or school manager (whole school) or
 * supervisor (own assigned teachers only).
 */
export function canReviewSubmissions(role: string): boolean {
  return (
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "SCHOOL_MANAGER" ||
    role === "EDUCATIONAL_SUPERVISOR"
  );
}

/** Read-only summary roles (deputy) and platform stats (super admin). */
export function isReadOnlyOverviewRole(role: string): boolean {
  return role === "EDUCATIONAL_DEPUTY" || role === "SUPER_ADMIN";
}

/* ------------------------------------------------------------------ */
/* Failure helpers                                                      */
/* ------------------------------------------------------------------ */

export function assignmentScopeError(
  ctx: AssignmentActor,
  schoolId: string | null
): AssignmentResult<never> | null {
  // Assignments are always school-owned; a null/missing school context
  // can never match (this blocks SUPER_ADMIN operational access too,
  // and structurally confines SCHOOL_MANAGER to its own school).
  if (!schoolId || ctx.schoolId !== schoolId) {
    return assignmentFail(
      "لا تملك صلاحية الوصول إلى هذا التكليف — النطاق المدرسي مختلف",
      "FORBIDDEN"
    );
  }
  return null;
}

export function manageGuard(ctx: AssignmentActor): AssignmentResult<never> | null {
  if (!canManageAssignments(ctx.role)) {
    return assignmentFail(
      "إدارة التكليفات متاحة لمديري مكاتب التطوير ومديري المدارس فقط",
      "FORBIDDEN"
    );
  }
  return null;
}

export function reviewGuard(ctx: AssignmentActor): AssignmentResult<never> | null {
  if (!canReviewSubmissions(ctx.role)) {
    return assignmentFail(
      "مراجعة التسليمات متاحة للمشرفين التربويين ومديري مكاتب التطوير ومديري المدارس فقط",
      "FORBIDDEN"
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Audience targeting (pure)                                            */
/* ------------------------------------------------------------------ */

export interface TargetingSnapshot {
  audienceMode: string;
  targetTeacherIds: string[];
  targetBranchIds: string[];
}

export function parseJsonIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

/** Pure eligibility rule — the service feeds it DB-verified teacher rows. */
export function isTeacherTargeted(
  targeting: TargetingSnapshot,
  teacher: { id: string; branchId: string | null }
): boolean {
  if (targeting.audienceMode === "ALL_TEACHERS") return true;
  if (targeting.audienceMode === "BRANCHES") {
    return teacher.branchId !== null && targeting.targetBranchIds.includes(teacher.branchId);
  }
  return targeting.targetTeacherIds.includes(teacher.id);
}

/** Arabic explanation of who an assignment targets (detail pages). */
export function targetingSummary(targeting: TargetingSnapshot, labels: Record<AudienceMode, string>): string {
  const base = labels[targeting.audienceMode as AudienceMode] ?? "فئة غير معروفة";
  if (targeting.audienceMode === "BRANCHES") {
    return `${base} (${targeting.targetBranchIds.length})`;
  }
  if (targeting.audienceMode === "TEACHERS") {
    return `${base} (${targeting.targetTeacherIds.length})`;
  }
  return base;
}

export type { AssignmentErrorCode };
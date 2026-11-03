import type { AdminContext } from "@/lib/auth/dev-admin";
import type { TrainingErrorCode } from "@/lib/validation/training";

/* ------------------------------------------------------------------ */
/* Training academy — authorization & visibility predicates.            */
/*                                                                      */
/* Pure functions (no DB, no session) so the rules are unit-testable.   */
/* Tenancy rule: schoolId === null means PLATFORM-WIDE shared content;  */
/* only SUPER_ADMIN may create or manage platform-wide records.         */
/* ------------------------------------------------------------------ */

/** Session-safe viewer identity used for read-side checks. */
export interface ViewerIdentity {
  id: string;
  role: string;
  schoolId: string | null;
}

/** Minimal projection of program/course rows for visibility checks. */
export interface ScopedRecord {
  status: string;
  schoolId: string | null;
}

/** Administrative pair allowed to manage programs/courses/content. */
export function canManageTraining(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "DEVELOPMENT_OFFICE_MANAGER";
}

/**
 * Can this viewer see a PUBLISHED program/course in ordinary browsing?
 *   - platform-wide (schoolId null) -> every authenticated viewer
 *   - school-owned                  -> viewers of the same school only
 * Non-published records are NEVER visible through this predicate —
 * managers reach drafts through the manage-scope path below.
 */
export function canViewPublishedContent(
  viewer: ViewerIdentity,
  record: ScopedRecord
): boolean {
  if (record.status !== "PUBLISHED") return false;
  if (record.schoolId === null) return true;
  return viewer.schoolId !== null && viewer.schoolId === record.schoolId;
}

/**
 * Prisma `where` fragment for teacher/staff catalog listings. SUPER_ADMIN
 * (platform manager) browses every published course; everyone else is
 * confined to platform-wide + their own school's published courses.
 */
export function publishedVisibilityWhere(viewer: ViewerIdentity): {
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

export interface ScopeRejection {
  ok: false;
  message: string;
  code: TrainingErrorCode;
}

/**
 * Manage-scope enforcement for training records (mirror of the schools
 * `schoolScopeError` semantics, extended for nullable school scope):
 *   SUPER_ADMIN                -> any record (incl. platform-wide)
 *   DEVELOPMENT_OFFICE_MANAGER -> only records owned by their school
 *   anything else              -> always rejected (defense in depth)
 */
export function trainingScopeError(
  ctx: AdminContext,
  recordSchoolId: string | null
): ScopeRejection | null {
  if (ctx.role === "SUPER_ADMIN") return null;
  if (
    ctx.role === "DEVELOPMENT_OFFICE_MANAGER" &&
    recordSchoolId !== null &&
    recordSchoolId === ctx.schoolId
  ) {
    return null;
  }
  return {
    ok: false,
    message:
      "ليس لديك صلاحية إدارة هذا المحتوى التدريبي — العملية مرفوضة",
    code: "FORBIDDEN",
  };
}

/**
 * Attachment access decision for the file-serving route.
 *   - SUPER_ADMIN              -> always allowed
 *   - managers                 -> attachments of their own school's
 *                                 records (any status) + platform-wide
 *                                 PUBLISHED records
 *   - everyone else            -> attachments of PUBLISHED records
 *                                 visible to their school only
 * Attachments without an owning course/program can never be accessed
 * (they do not exist through normal flows).
 */
export function canAccessAttachment(
  viewer: ViewerIdentity,
  attachment: { courseId: string | null; programId: string | null },
  course: ScopedRecord | null,
  program: ScopedRecord | null
): boolean {
  if (viewer.role === "SUPER_ADMIN") return true;

  if (course) {
    if (
      canManageTraining(viewer.role) &&
      course.schoolId !== null &&
      course.schoolId === viewer.schoolId
    ) {
      return true;
    }
    return canViewPublishedContent(viewer, course);
  }

  if (program) {
    if (
      canManageTraining(viewer.role) &&
      program.schoolId !== null &&
      program.schoolId === viewer.schoolId
    ) {
      return true;
    }
    return canViewPublishedContent(viewer, program);
  }

  return false;
}
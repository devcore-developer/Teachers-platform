import { db } from "@/lib/db";

import type { AdminContext, SupervisorTrainingContext } from "@/lib/auth/dev-admin";
import type { TrainingErrorCode } from "@/lib/validation/training";

/**
 * Any context allowed into the training management service layer:
 * the administrative trio PLUS the educational supervisor (whose
 * tenant fence is identical — own school only, never platform-wide).
 */
export type TrainingManageContext = AdminContext | SupervisorTrainingContext;

/* ------------------------------------------------------------------ */
/* Training academy — authorization & visibility predicates.            */
/*                                                                      */
/* Predicate functions are pure (no session) so the rules are           */
/* unit-testable; the supervisor-training gate section at the bottom    */
/* adds the ONE DB-backed read it needs (the teacher's current          */
/* assignment) while keeping the rule itself a pure function on top.    */
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

/**
 * Roles allowed to manage programs/courses/content. The educational
 * supervisor manages training for their OWN school only — the fence is
 * structural in `trainingScopeError` below (platform-wide records stay
 * SUPER_ADMIN-only).
 */
export function canManageTraining(role: string): boolean {
  return (
    role === "SUPER_ADMIN" ||
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "SCHOOL_MANAGER" ||
    role === "EDUCATIONAL_SUPERVISOR"
  );
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
 *   SCHOOL_MANAGER             -> only records owned by their school
 *   anything else              -> always rejected (defense in depth)
 * Platform-wide records (schoolId null) can never be managed by a
 * school-scoped role — no exceptions.
 */
export function trainingScopeError(
  ctx: TrainingManageContext,
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

/* ------------------------------------------------------------------ */
/* Supervisor-training gate — the IT coordinator assignment rule.       */
/*                                                                      */
/* Business rule (server-enforced, single implementation):              */
/*   A course AUTHORED by an EDUCATIONAL_SUPERVISOR is "supervisor      */
/*   training". A TEACHER may see and reach it ONLY while the IT        */
/*   coordinator's current TeacherSupervisorAssignment points at THAT   */
/*   supervisor. Courses authored by SUPER_ADMIN / DEVELOPMENT_OFFICE_  */
/*   MANAGER / SCHOOL_MANAGER are NEVER gated — their training remains  */
/*   open to teachers unconditionally. Non-teacher viewers (managers    */
/*   previewing, supervisors, deputies, SUPER_ADMIN) are never gated.   */
/*                                                                      */
/*   The gate reads the assignment at QUERY time, so assigning,         */
/*   transferring or removing a supervisor updates the teacher's        */
/*   accessible training on the very next request — no backfill, no     */
/*   cache, no manual data changes.                                     */
/*                                                                      */
/*   Used by: the catalog listing (as a where-filter), the course and   */
/*   lesson learning views, enrollment, lesson completion writes and    */
/*   the playback gate — an unassigned teacher cannot reach supervisor  */
/*   training through a direct URL or a crafted action call.            */
/* ------------------------------------------------------------------ */

export interface SupervisorGateRejection {
  ok: false;
  message: string;
  code: "FORBIDDEN";
}

/**
 * Pure rule — unit-testable. Allowed unless the course is
 * supervisor-authored AND the viewer's assigned supervisor differs.
 */
export function supervisorCourseAllowed(
  creatorRole: string,
  creatorId: string,
  assignedSupervisorId: string | null
): boolean {
  if (creatorRole !== "EDUCATIONAL_SUPERVISOR") return true;
  return assignedSupervisorId !== null && assignedSupervisorId === creatorId;
}

/** The teacher's CURRENT explicit supervisor id (null = unassigned). */
export async function assignedSupervisorIdFor(
  teacherId: string
): Promise<string | null> {
  const row = await db.teacherSupervisorAssignment.findUnique({
    where: { teacherId },
    select: { supervisorId: true },
  });
  return row?.supervisorId ?? null;
}

/** Arabic rejection shown when the gate blocks a supervisor course. */
export const SUPERVISOR_GATE_MESSAGE =
  "هذا التدريب من إعداد المشرف التربوي — يتطلب إسنادًا ساريًا إليه من منسق تقنية المعلومات في مدرستك";

/**
 * Single-record gate (course view, lesson view, enrollment, completion
 * writes, playback). Returns the rejection, or null = allowed.
 * `course` must carry the creator's id and role — every call-site
 * selects `createdById` + `createdBy: { select: { role: true } }`.
 */
export async function supervisorTrainingGateError(
  viewer: ViewerIdentity,
  course: { createdById: string; createdBy: { role: string } }
): Promise<SupervisorGateRejection | null> {
  if (viewer.role !== "TEACHER") return null;
  const assignedSupervisorId = await assignedSupervisorIdFor(viewer.id);
  if (
    supervisorCourseAllowed(
      course.createdBy.role,
      course.createdById,
      assignedSupervisorId
    )
  ) {
    return null;
  }
  return { ok: false, message: SUPERVISOR_GATE_MESSAGE, code: "FORBIDDEN" };
}
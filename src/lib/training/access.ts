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
/* Supervisor-training gate (IT assignment rule) — DB-backed.           */
/*                                                                      */
/* Teachers can open/play lessons of supervisor-authored courses only   */
/* while currently covered by that exact supervisor (explicit           */
/* teacher→supervisor assignment, or branch coverage inside the         */
/* supervisor's own school). The administrative trio (SUPER_ADMIN /     */
/* DEVELOPMENT_OFFICE_MANAGER / SCHOOL_MANAGER) and the supervisors     */
/* themselves preview and manage freely — this gate fences TEACHER      */
/* learners only, so school management is never blocked.                */
/* ------------------------------------------------------------------ */

export interface SupervisorGateCourseRef {
  createdById: string;
  createdBy: { role: string } | null;
}

/**
 * Returns an Arabic rejection message when the viewer may NOT consume
 * this course, or null when access is allowed. The watch heartbeat and
 * the media proxy both go through it, so watch time cannot accumulate
 * on a supervisor-authored course without a current assignment.
 */
export async function supervisorTrainingGateError(
  viewer: ViewerIdentity,
  course: SupervisorGateCourseRef
): Promise<{ message: string } | null> {
  if (viewer.role !== "TEACHER") return null;
  if (!course.createdBy || course.createdBy.role !== "EDUCATIONAL_SUPERVISOR") {
    return null;
  }

  const [teacher, supervisor] = await Promise.all([
    db.user.findUnique({
      where: { id: viewer.id },
      select: { schoolId: true, branchId: true, isActive: true },
    }),
    db.user.findUnique({
      where: { id: course.createdById },
      select: {
        role: true,
        isActive: true,
        schoolId: true,
        supervisorAssignments: { select: { branchId: true } },
      },
    }),
  ]);

  if (!teacher || !teacher.isActive) {
    return { message: "حسابك غير متاح حاليًا — تواصل مع إدارة مدرستك" };
  }
  if (
    !supervisor ||
    supervisor.role !== "EDUCATIONAL_SUPERVISOR" ||
    !supervisor.isActive
  ) {
    return { message: "مشرف هذا التدريب غير متاح حاليًا — تواصل مع إدارة مدرستك" };
  }
  if (
    !teacher.schoolId ||
    supervisor.schoolId !== teacher.schoolId ||
    viewer.schoolId !== teacher.schoolId
  ) {
    return { message: "هذا التدريب غير متاح لك" };
  }

  const explicit = await db.teacherSupervisorAssignment.findFirst({
    where: {
      teacherId: viewer.id,
      supervisorId: course.createdById,
      schoolId: teacher.schoolId,
    },
    select: { id: true },
  });
  if (explicit) return null;

  const branchIds = supervisor.supervisorAssignments.map((row) => row.branchId);
  if (teacher.branchId && branchIds.includes(teacher.branchId)) return null;

  return {
    message:
      "هذا التدريب مخصص لمعلمي المشرف المربوط بهم — تواصل مع مشرفك التربوي أو إدارة مدرستك",
  };
}
/**
 * The supervisor (User id) currently explicitly assigned to a teacher,
 * or null — one row per teacher (unique `teacherId`). Mirrors the
 * explicit-assignment leg of the gate above so the catalog filter in
 * the training service and the play/enrollment gate can never drift
 * apart: assign, transfer or remove in the IT workspace updates the
 * teacher's catalog on the very next request.
 */
export async function assignedSupervisorIdFor(
  teacherId: string
): Promise<string | null> {
  const assignment = await db.teacherSupervisorAssignment.findUnique({
    where: { teacherId },
    select: { supervisorId: true },
  });
  return assignment?.supervisorId ?? null;
}
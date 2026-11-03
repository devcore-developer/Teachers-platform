/**
 * Phase 10 — safe archiving & restoration service.
 *
 * Principles (per the Phase 10 brief):
 *   • Status-based archival / soft deletion ONLY — nothing is ever
 *     physically deleted and no historical record is destroyed.
 *   • Entities that ALREADY carry a safe archive lifecycle reuse it:
 *       TrainingProgram / Course / Assessment → status = "ARCHIVED"
 *       Assignment                            → status = "ARCHIVED"
 *       Survey                                → status = "ARCHIVED" (+ archivedAt)
 *     This module does NOT duplicate their archive paths — it adds the
 *     missing RESTORE paths (guarded + audited) and the unified view.
 *   • FollowUp had NO archive mechanism — this module adds a soft
 *     archive (archivedAt / archivedById) that never alters its status.
 *   • Every archive/restore writes an append-only ArchiveEvent (and a
 *     FollowUpEvent for follow-ups, keeping that module's own trail).
 *   • Archived records disappear from active workflows (lists filter on
 *     archivedAt / ARCHIVED status) but stay viewable here, scoped by
 *     role and school.
 *
 * Authorization:
 *   DEVELOPMENT_OFFICE_MANAGER — archive/restore inside OWN school.
 *   EDUCATIONAL_SUPERVISOR     — archive/restore follow-up records of
 *                                their operational scope only.
 *   EDUCATIONAL_DEPUTY         — read-only archive views (grants).
 *   SUPER_ADMIN                — read-only views; may restore PLATFORM-
 *                                WIDE (schoolId null) content only —
 *                                never touches school-owned records.
 */
import { db } from "@/lib/db";
import {
  ARCHIVE_ENTITY_LABELS,
  ARCHIVE_PAGE_SIZE,
  ARCHIVE_EVENTS_LIMIT,
  type ArchiveEntityType,
} from "@/config/analytics";
import {
  analyticsFail,
  canOperateArchive,
  resolveReadableSchoolIds,
  supervisorCoverage,
  visibleTeacherIds,
  type AnalyticsActor,
  type AnalyticsResult,
} from "@/lib/analytics/access";

/* ------------------------------------------------------------------ */
/* Scoped event writer                                                  */
/* ------------------------------------------------------------------ */

async function recordArchiveEvent(input: {
  schoolId: string | null;
  entityType: ArchiveEntityType;
  entityId: string;
  entityTitle: string | null;
  action: "ARCHIVED" | "RESTORED";
  actorId: string;
  actorRole: string;
  note?: string;
}) {
  await db.archiveEvent.create({
    data: {
      schoolId: input.schoolId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: input.actorId,
      actorRole: input.actorRole,
      entityTitle: input.entityTitle,
      note: input.note,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Follow-up archive / restore (soft, status-preserving)                */
/* ------------------------------------------------------------------ */

async function followUpOperationalScope(
  actor: AnalyticsActor,
  followUpId: string
): Promise<AnalyticsResult<{ schoolId: string; titleAr: string; teacherId: string }>> {
  if (!canOperateArchive(actor.role) || !actor.schoolId) {
    return analyticsFail(
      "أرشفة سجلات المتابعة متاحة لمديري مكاتب التطوير والمشرفين التربويين فقط",
      "FORBIDDEN"
    );
  }
  const followUp = await db.followUp.findUnique({
    where: { id: followUpId },
    select: {
      id: true,
      schoolId: true,
      titleAr: true,
      teacherId: true,
      supervisorId: true,
      createdById: true,
      teacher: { select: { id: true, schoolId: true, branchId: true } },
    },
  });
  if (!followUp) return analyticsFail("سجل المتابعة غير موجود", "NOT_FOUND");
  if (followUp.schoolId !== actor.schoolId) {
    return analyticsFail("سجل المتابعة خارج نطاقك المدرسي", "FORBIDDEN");
  }
  if (actor.role === "EDUCATIONAL_SUPERVISOR") {
    const isResponsible = followUp.supervisorId === actor.id;
    const isCreator = followUp.createdById === actor.id;
    let covered = false;
    if (!isResponsible && !isCreator) {
      const coverage = await supervisorCoverage(actor, actor.schoolId);
      if (!coverage.ok) return coverage;
      covered =
        coverage.data.teacherIds.includes(followUp.teacherId) ||
        (followUp.teacher.branchId !== null &&
          coverage.data.branchIds.includes(followUp.teacher.branchId));
    }
    if (!isResponsible && !isCreator && !covered) {
      return analyticsFail("سجل المتابعة خارج نطاق إشرافك", "FORBIDDEN");
    }
  }
  return {
    ok: true,
    data: { schoolId: followUp.schoolId, titleAr: followUp.titleAr, teacherId: followUp.teacherId },
  };
}

export async function archiveFollowUp(
  actor: AnalyticsActor,
  followUpId: string
): Promise<AnalyticsResult<{ id: string }>> {
  const scope = await followUpOperationalScope(actor, followUpId);
  if (!scope.ok) return scope;

  const result = await db.$transaction(async (tx) => {
    // Conditional flip — a concurrent archive cannot double-fire.
    const updated = await tx.followUp.updateMany({
      where: { id: followUpId, schoolId: scope.data.schoolId, archivedAt: null },
      data: { archivedAt: new Date(), archivedById: actor.id },
    });
    if (updated.count !== 1) return null;
    await tx.followUpEvent.create({
      data: {
        followUpId,
        type: "ARCHIVED",
        actorId: actor.id,
        actorRole: actor.role,
        note: "تمت أرشفة السجل — تاريخ الحالة محفوظ كما هو",
      },
    });
    return { ok: true as const };
  });
  if (!result) {
    return analyticsFail("سجل المتابعة مؤرشف بالفعل", "VALIDATION_ERROR");
  }
  await recordArchiveEvent({
    schoolId: scope.data.schoolId,
    entityType: "FOLLOW_UP",
    entityId: followUpId,
    entityTitle: scope.data.titleAr,
    action: "ARCHIVED",
    actorId: actor.id,
    actorRole: actor.role,
  });
  return { ok: true, data: { id: followUpId } };
}

export async function restoreFollowUp(
  actor: AnalyticsActor,
  followUpId: string
): Promise<AnalyticsResult<{ id: string }>> {
  const scope = await followUpOperationalScope(actor, followUpId);
  if (!scope.ok) return scope;

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.followUp.updateMany({
      where: { id: followUpId, schoolId: scope.data.schoolId, archivedAt: { not: null } },
      data: { archivedAt: null, archivedById: null },
    });
    if (updated.count !== 1) return null;
    await tx.followUpEvent.create({
      data: {
        followUpId,
        type: "RESTORED",
        actorId: actor.id,
        actorRole: actor.role,
        note: "تمت استعادة السجل من الأرشيف",
      },
    });
    return { ok: true as const };
  });
  if (!result) {
    return analyticsFail("سجل المتابعة ليس في الأرشيف", "VALIDATION_ERROR");
  }
  await recordArchiveEvent({
    schoolId: scope.data.schoolId,
    entityType: "FOLLOW_UP",
    entityId: followUpId,
    entityTitle: scope.data.titleAr,
    action: "RESTORED",
    actorId: actor.id,
    actorRole: actor.role,
  });
  return { ok: true, data: { id: followUpId } };
}

/* ------------------------------------------------------------------ */
/* Restore of already-archived lifecycle content                        */
/* ------------------------------------------------------------------ */

/**
 * Assignment: ARCHIVED is terminal in the Phase 7 service, so restore
 * lands on CLOSED (out of active workflows; republishing goes through
 * the assignment page with all its server validations).
 */
export async function restoreAssignment(
  actor: AnalyticsActor,
  assignmentId: string
): Promise<AnalyticsResult<{ id: string }>> {
  if (actor.role !== "DEVELOPMENT_OFFICE_MANAGER" || !actor.schoolId) {
    return analyticsFail("استعادة التكليفات متاحة لمديري مكاتب التطوير فقط", "FORBIDDEN");
  }
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, schoolId: true, titleAr: true, status: true },
  });
  if (!assignment) return analyticsFail("التكليف غير موجود", "NOT_FOUND");
  if (assignment.schoolId !== actor.schoolId) {
    return analyticsFail("التكليف خارج نطاقك المدرسي", "FORBIDDEN");
  }
  const updated = await db.assignment.updateMany({
    where: { id: assignmentId, schoolId: actor.schoolId, status: "ARCHIVED" },
    data: { status: "CLOSED" },
  });
  if (updated.count !== 1) {
    return analyticsFail("التكليف ليس في الأرشيف", "VALIDATION_ERROR");
  }
  await recordArchiveEvent({
    schoolId: actor.schoolId,
    entityType: "ASSIGNMENT",
    entityId: assignmentId,
    entityTitle: assignment.titleAr,
    action: "RESTORED",
    actorId: actor.id,
    actorRole: actor.role,
    note: "أُعيد إلى حالة مغلق — إعادة النشر من صفحة التكليف",
  });
  return { ok: true, data: { id: assignmentId } };
}

/**
 * Course: restore to PUBLISHED when it was published before (publishedAt
 * is kept while archived), otherwise to DRAFT so the normal publish
 * workflow re-validates content.
 */
export async function restoreCourse(
  actor: AnalyticsActor,
  courseId: string
): Promise<AnalyticsResult<{ id: string }>> {
  const guard = await platformContentRestoreGuard(actor, courseId, "COURSE");
  if (!guard.ok) return guard;
  const { schoolId, title, publishedAt } = guard.data;
  const targetStatus = publishedAt ? "PUBLISHED" : "DRAFT";
  const updated = await db.course.updateMany({
    where: { id: courseId, status: "ARCHIVED" },
    data: { status: targetStatus },
  });
  if (updated.count !== 1) {
    return analyticsFail("الدورة ليست في الأرشيف", "VALIDATION_ERROR");
  }
  await recordArchiveEvent({
    schoolId,
    entityType: "COURSE",
    entityId: courseId,
    entityTitle: title,
    action: "RESTORED",
    actorId: actor.id,
    actorRole: actor.role,
    note:
      targetStatus === "PUBLISHED"
        ? "أُعيدت إلى حالة منشور"
        : "أُعيدت إلى حالة مسودة — انشرها بعد المراجعة",
  });
  return { ok: true, data: { id: courseId } };
}

/** Program: no publishedAt snapshot exists → restore lands on DRAFT. */
export async function restoreProgram(
  actor: AnalyticsActor,
  programId: string
): Promise<AnalyticsResult<{ id: string }>> {
  const guard = await platformContentRestoreGuard(actor, programId, "PROGRAM");
  if (!guard.ok) return guard;
  const { schoolId, title } = guard.data;
  const updated = await db.trainingProgram.updateMany({
    where: { id: programId, status: "ARCHIVED" },
    data: { status: "DRAFT" },
  });
  if (updated.count !== 1) {
    return analyticsFail("البرنامج ليس في الأرشيف", "VALIDATION_ERROR");
  }
  await recordArchiveEvent({
    schoolId,
    entityType: "PROGRAM",
    entityId: programId,
    entityTitle: title,
    action: "RESTORED",
    actorId: actor.id,
    actorRole: actor.role,
    note: "أُعيد إلى حالة مسودة — انشره بعد المراجعة",
  });
  return { ok: true, data: { id: programId } };
}

/** Assessment: no publishedAt snapshot exists → restore lands on DRAFT. */
export async function restoreAssessment(
  actor: AnalyticsActor,
  assessmentId: string
): Promise<AnalyticsResult<{ id: string }>> {
  const guard = await platformContentRestoreGuard(actor, assessmentId, "ASSESSMENT");
  if (!guard.ok) return guard;
  const { schoolId, title } = guard.data;
  const updated = await db.assessment.updateMany({
    where: { id: assessmentId, status: "ARCHIVED" },
    data: { status: "DRAFT" },
  });
  if (updated.count !== 1) {
    return analyticsFail("التقييم ليس في الأرشيف", "VALIDATION_ERROR");
  }
  await recordArchiveEvent({
    schoolId,
    entityType: "ASSESSMENT",
    entityId: assessmentId,
    entityTitle: title,
    action: "RESTORED",
    actorId: actor.id,
    actorRole: actor.role,
    note: "أُعيد إلى حالة مسودة — انشره بعد المراجعة",
  });
  return { ok: true, data: { id: assessmentId } };
}

/**
 * Shared guard for content restores. School managers restore their own
 * school's content; SUPER_ADMIN may restore PLATFORM-WIDE (schoolId
 * null) content only. Deputies/supervisors never restore content.
 */
async function platformContentRestoreGuard(
  actor: AnalyticsActor,
  entityId: string,
  entityType: "PROGRAM" | "COURSE" | "ASSESSMENT"
): Promise<AnalyticsResult<{ schoolId: string | null; title: string; publishedAt: Date | null }>> {
  if (actor.role === "DEVELOPMENT_OFFICE_MANAGER") {
    if (!actor.schoolId) {
      return analyticsFail("حسابك غير مرتبط بمدرسة", "FORBIDDEN");
    }
    const row = await loadContentRow(entityId, entityType);
    if (!row) return analyticsFail("السجل غير موجود", "NOT_FOUND");
    if (row.schoolId !== actor.schoolId) {
      return analyticsFail("السجل خارج نطاقك المدرسي", "FORBIDDEN");
    }
    return {
      ok: true,
      data: { schoolId: row.schoolId, title: row.title, publishedAt: row.publishedAt },
    };
  }
  if (actor.role === "SUPER_ADMIN") {
    const row = await loadContentRow(entityId, entityType);
    if (!row) return analyticsFail("السجل غير موجود", "NOT_FOUND");
    if (row.schoolId !== null) {
      return analyticsFail(
        "محتوى المدارس تديره أدوار المدرسة — حساب المنصة يستعيد المحتوى العام فقط",
        "FORBIDDEN"
      );
    }
    return {
      ok: true,
      data: { schoolId: null, title: row.title, publishedAt: row.publishedAt },
    };
  }
  return analyticsFail("استعادة المحتوى متاحة لمديري المكاتب والإدارة العامة فقط", "FORBIDDEN");
}

async function loadContentRow(
  entityId: string,
  entityType: "PROGRAM" | "COURSE" | "ASSESSMENT"
): Promise<{ schoolId: string | null; title: string; publishedAt: Date | null } | null> {
  if (entityType === "PROGRAM") {
    const row = await db.trainingProgram.findUnique({
      where: { id: entityId },
      select: { schoolId: true, nameAr: true },
    });
    return row ? { schoolId: row.schoolId, title: row.nameAr, publishedAt: null } : null;
  }
  if (entityType === "COURSE") {
    const row = await db.course.findUnique({
      where: { id: entityId },
      select: { schoolId: true, titleAr: true, publishedAt: true },
    });
    return row ? { schoolId: row.schoolId, title: row.titleAr, publishedAt: row.publishedAt } : null;
  }
  const row = await db.assessment.findUnique({
    where: { id: entityId },
    select: { schoolId: true, titleAr: true },
  });
  return row ? { schoolId: row.schoolId, title: row.titleAr, publishedAt: null } : null;
}

/* ------------------------------------------------------------------ */
/* Unified archived view                                                */
/* ------------------------------------------------------------------ */

export interface ArchivedRow {
  entityType: ArchiveEntityType;
  entityId: string;
  title: string;
  schoolId: string | null;
  schoolName: string | null;
  /** Persisted lifecycle status (ARCHIVED for status-based entities). */
  status: string;
  archivedAt: Date | null;
  /** For follow-ups: the record keeps its workflow status while archived. */
  workflowStatus: string | null;
  detail: string | null;
}

/**
 * Archived records visible to the actor. Manager/deputy: their school
 * scope. Supervisor: follow-ups of their operational scope + their own
 * surveys. SUPER_ADMIN: platform-wide content only.
 */
export async function listArchivedRecords(
  actor: AnalyticsActor,
  entityType: ArchiveEntityType | null,
  page = 1
): Promise<AnalyticsResult<{ rows: ArchivedRow[]; total: number; pageCount: number; page: number }>> {
  const rows: ArchivedRow[] = [];

  if (actor.role === "SUPER_ADMIN") {
    // Platform-wide content only (schoolId null).
    const [programs, courses, assessments] = await Promise.all([
      entityType === null || entityType === "PROGRAM"
        ? db.trainingProgram.findMany({
            where: { schoolId: null, status: "ARCHIVED" },
            select: { id: true, nameAr: true },
            take: ARCHIVE_PAGE_SIZE,
          })
        : Promise.resolve([]),
      entityType === null || entityType === "COURSE"
        ? db.course.findMany({
            where: { schoolId: null, status: "ARCHIVED" },
            select: { id: true, titleAr: true, publishedAt: true },
            take: ARCHIVE_PAGE_SIZE,
          })
        : Promise.resolve([]),
      entityType === null || entityType === "ASSESSMENT"
        ? db.assessment.findMany({
            where: { schoolId: null, status: "ARCHIVED" },
            select: { id: true, titleAr: true },
            take: ARCHIVE_PAGE_SIZE,
          })
        : Promise.resolve([]),
    ]);
    for (const row of programs) {
      rows.push({
        entityType: "PROGRAM",
        entityId: row.id,
        title: row.nameAr,
        schoolId: null,
        schoolName: "عام (المنصة)",
        status: "ARCHIVED",
        archivedAt: null,
        workflowStatus: null,
        detail: "برنامج عام — الاستعادة إلى مسودة",
      });
    }
    for (const row of courses) {
      rows.push({
        entityType: "COURSE",
        entityId: row.id,
        title: row.titleAr,
        schoolId: null,
        schoolName: "عام (المنصة)",
        status: "ARCHIVED",
        archivedAt: null,
        workflowStatus: null,
        detail: row.publishedAt ? "دورة عامة — الاستعادة إلى منشور" : "دورة عامة — الاستعادة إلى مسودة",
      });
    }
    for (const row of assessments) {
      rows.push({
        entityType: "ASSESSMENT",
        entityId: row.id,
        title: row.titleAr,
        schoolId: null,
        schoolName: "عام (المنصة)",
        status: "ARCHIVED",
        archivedAt: null,
        workflowStatus: null,
        detail: "تقييم عام — الاستعادة إلى مسودة",
      });
    }
    return { ok: true, data: { rows, total: rows.length, pageCount: 1, page: 1 } };
  }

  // School-scoped view (manager / deputy / supervisor).
  const readable = await resolveReadableSchoolIds(actor);
  if (!readable.ok) return readable;
  const schoolIds = readable.data;
  const isSupervisor = actor.role === "EDUCATIONAL_SUPERVISOR";

  // Supervisors: only follow-ups in their operational scope and surveys
  // they own. Manager/deputy: all six entity types of their scope.
  const types: ArchiveEntityType[] =
    entityType === null
      ? isSupervisor
        ? ["FOLLOW_UP", "SURVEY"]
        : ["PROGRAM", "COURSE", "ASSESSMENT", "ASSIGNMENT", "SURVEY", "FOLLOW_UP"]
      : isSupervisor && entityType !== "FOLLOW_UP" && entityType !== "SURVEY"
        ? []
        : [entityType];

  if (types.includes("PROGRAM")) {
    const programs = await db.trainingProgram.findMany({
      where: { schoolId: { in: schoolIds }, status: "ARCHIVED" },
      select: { id: true, nameAr: true, schoolId: true },
      take: ARCHIVE_PAGE_SIZE,
    });
    for (const row of programs) {
      rows.push({
        entityType: "PROGRAM",
        entityId: row.id,
        title: row.nameAr,
        schoolId: row.schoolId,
        schoolName: null,
        status: "ARCHIVED",
        archivedAt: null,
        workflowStatus: null,
        detail: "الاستعادة إلى مسودة",
      });
    }
  }
  if (types.includes("COURSE")) {
    const courses = await db.course.findMany({
      where: { schoolId: { in: schoolIds }, status: "ARCHIVED" },
      select: { id: true, titleAr: true, schoolId: true, publishedAt: true },
      take: ARCHIVE_PAGE_SIZE,
    });
    for (const row of courses) {
      rows.push({
        entityType: "COURSE",
        entityId: row.id,
        title: row.titleAr,
        schoolId: row.schoolId,
        schoolName: null,
        status: "ARCHIVED",
        archivedAt: null,
        workflowStatus: null,
        detail: row.publishedAt ? "الاستعادة إلى منشور" : "الاستعادة إلى مسودة",
      });
    }
  }
  if (types.includes("ASSESSMENT")) {
    const assessments = await db.assessment.findMany({
      where: { schoolId: { in: schoolIds }, status: "ARCHIVED" },
      select: { id: true, titleAr: true, schoolId: true },
      take: ARCHIVE_PAGE_SIZE,
    });
    for (const row of assessments) {
      rows.push({
        entityType: "ASSESSMENT",
        entityId: row.id,
        title: row.titleAr,
        schoolId: row.schoolId,
        schoolName: null,
        status: "ARCHIVED",
        archivedAt: null,
        workflowStatus: null,
        detail: "الاستعادة إلى مسودة",
      });
    }
  }
  if (types.includes("ASSIGNMENT")) {
    const assignments = await db.assignment.findMany({
      where: { schoolId: { in: schoolIds }, status: "ARCHIVED" },
      select: { id: true, titleAr: true, schoolId: true, dueAt: true },
      take: ARCHIVE_PAGE_SIZE,
    });
    for (const row of assignments) {
      rows.push({
        entityType: "ASSIGNMENT",
        entityId: row.id,
        title: row.titleAr,
        schoolId: row.schoolId,
        schoolName: null,
        status: "ARCHIVED",
        archivedAt: null,
        workflowStatus: null,
        detail: "الاستعادة إلى مغلق",
      });
    }
  }
  if (types.includes("SURVEY")) {
    const surveys = await db.survey.findMany({
      where: {
        schoolId: { in: schoolIds },
        status: "ARCHIVED",
        ...(isSupervisor ? { ownerUserId: actor.id } : {}),
      },
      select: { id: true, titleAr: true, schoolId: true, archivedAt: true },
      take: ARCHIVE_PAGE_SIZE,
    });
    for (const row of surveys) {
      rows.push({
        entityType: "SURVEY",
        entityId: row.id,
        title: row.titleAr,
        schoolId: row.schoolId,
        schoolName: null,
        status: "ARCHIVED",
        archivedAt: row.archivedAt,
        workflowStatus: null,
        detail: "حالة نهائية — الأرشفة يحفظ النتائج والتاريخ",
      });
    }
  }
  if (types.includes("FOLLOW_UP")) {
    let teacherIds: string[] | null = null;
    if (isSupervisor) {
      const scope = await visibleTeacherIds(actor, actor.schoolId ?? "__none__");
      teacherIds = scope.ok ? scope.data : [];
    }
    const followUps = await db.followUp.findMany({
      where: {
        schoolId: { in: schoolIds },
        archivedAt: { not: null },
        ...(isSupervisor
          ? {
              OR: [
                { supervisorId: actor.id },
                { createdById: actor.id },
                ...(teacherIds && teacherIds.length > 0
                  ? [{ teacherId: { in: teacherIds } }]
                  : []),
              ],
            }
          : {}),
      },
      select: {
        id: true,
        titleAr: true,
        schoolId: true,
        status: true,
        archivedAt: true,
        teacher: { select: { name: true } },
      },
      take: ARCHIVE_PAGE_SIZE,
    });
    for (const row of followUps) {
      rows.push({
        entityType: "FOLLOW_UP",
        entityId: row.id,
        title: row.titleAr,
        schoolId: row.schoolId,
        schoolName: null,
        status: "ARCHIVED",
        archivedAt: row.archivedAt,
        workflowStatus: row.status,
        detail: `حالة السجل وقت الأرشفة: ${row.status} — المعلم: ${row.teacher.name}`,
      });
    }
  }

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  return { ok: true, data: { rows, total, pageCount, page: safePage } };
}

/* ------------------------------------------------------------------ */
/* Eligible follow-ups for archiving (picker source)                    */
/* ------------------------------------------------------------------ */

export interface ArchivableFollowUpRow {
  id: string;
  titleAr: string;
  status: string;
  teacherName: string;
  followUpDate: Date;
}

/**
 * Non-archived follow-ups the actor may archive (terminal-ish records
 * first): manager sees the whole school; supervisors see records where
 * they are responsible/creator or the teacher is inside coverage.
 */
export async function listArchivableFollowUps(
  actor: AnalyticsActor
): Promise<AnalyticsResult<ArchivableFollowUpRow[]>> {
  if (actor.role === "DEVELOPMENT_OFFICE_MANAGER" && actor.schoolId) {
    const rows = await db.followUp.findMany({
      where: { schoolId: actor.schoolId, archivedAt: null },
      select: {
        id: true,
        titleAr: true,
        status: true,
        followUpDate: true,
        teacher: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { followUpDate: "desc" }],
      take: ARCHIVE_PAGE_SIZE * 2,
    });
    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        titleAr: row.titleAr,
        status: row.status,
        teacherName: row.teacher.name,
        followUpDate: row.followUpDate,
      })),
    };
  }
  if (actor.role === "EDUCATIONAL_SUPERVISOR" && actor.schoolId) {
    const visible = await visibleTeacherIds(actor, actor.schoolId);
    const rows = await db.followUp.findMany({
      where: {
        schoolId: actor.schoolId,
        archivedAt: null,
        OR: [
          { supervisorId: actor.id },
          { createdById: actor.id },
          ...(visible.ok && visible.data.length > 0
            ? [{ teacherId: { in: visible.data } }]
            : []),
        ],
      },
      select: {
        id: true,
        titleAr: true,
        status: true,
        followUpDate: true,
        teacher: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { followUpDate: "desc" }],
      take: ARCHIVE_PAGE_SIZE * 2,
    });
    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        titleAr: row.titleAr,
        status: row.status,
        teacherName: row.teacher.name,
        followUpDate: row.followUpDate,
      })),
    };
  }
  return analyticsFail(
    "أرشفة سجلات المتابعة متاحة لمديري مكاتب التطوير والمشرفين التربويين فقط",
    "FORBIDDEN"
  );
}

/* ------------------------------------------------------------------ */
/* Audit trail                                                          */
/* ------------------------------------------------------------------ */

export interface ArchiveEventRow {
  id: string;
  entityType: ArchiveEntityType;
  entityLabel: string;
  entityId: string;
  entityTitle: string | null;
  action: string;
  actorName: string | null;
  actorRole: string | null;
  createdAt: Date;
  note: string | null;
}

/** Unified audit trail: manager/deputy see their schools; supervisor
 * sees school events (read-only); SUPER_ADMIN sees platform events. */
export async function listArchiveEvents(
  actor: AnalyticsActor
): Promise<AnalyticsResult<ArchiveEventRow[]>> {
  let where: Record<string, unknown>;
  if (actor.role === "SUPER_ADMIN") {
    where = { schoolId: null };
  } else {
    const readable = await resolveReadableSchoolIds(actor);
    if (!readable.ok) return readable;
    where = { schoolId: { in: readable.data } };
  }
  const events = await db.archiveEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: ARCHIVE_EVENTS_LIMIT,
    include: { actor: { select: { name: true } } },
  });
  return {
    ok: true,
    data: events.map((event) => ({
      id: event.id,
      entityType: event.entityType as ArchiveEntityType,
      entityLabel: ARCHIVE_ENTITY_LABELS[event.entityType as ArchiveEntityType] ?? event.entityType,
      entityId: event.entityId,
      entityTitle: event.entityTitle,
      action: event.action,
      actorName: event.actor?.name ?? null,
      actorRole: event.actorRole,
      createdAt: event.createdAt,
      note: event.note,
    })),
  };
}

export type { AnalyticsResult };
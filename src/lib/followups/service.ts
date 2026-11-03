/**
 * Phase 9 — follow-up records service: supervisor-led classroom
 * application follow-up workflow with school/branch scoping, status
 * history and a strictly limited teacher-shared projection.
 *
 * Authorization model (mirrors the survey service):
 *   DEVELOPMENT_OFFICE_MANAGER — school-wide create/edit/status.
 *   EDUCATIONAL_SUPERVISOR     — records where they are the responsible
 *                                supervisor or the teacher is inside
 *                                their persisted coverage.
 *   EDUCATIONAL_DEPUTY         — read-only progress within grants.
 *   SUPER_ADMIN                — aggregates only (impact service);
 *                                no record-level access here.
 *   TEACHER                    — ONLY the explicitly shared subset of
 *                                records targeted at them; internal
 *                                supervisor notes are never projected.
 */
import { db } from "@/lib/db";
import {
  canManageFollowUps,
  surveyScopeError,
  type SurveyActor,
  type SurveyViewer,
} from "@/lib/surveys/access";
import {
  FOLLOW_UPS_PAGE_SIZE,
  FOLLOW_UP_STATUS_LABELS,
  type FollowUpStatus,
} from "@/config/surveys";
import {
  notifyFollowUpCreated,
  notifyFollowUpShared,
  notifyFollowUpStatusChanged,
  notifyFollowUpUpdated,
} from "@/lib/notifications/hooks";
import {
  followUpDefinitionSchema,
  followUpSharingSchema,
  followUpStatusSchema,
  surveyFail,
  validationFail,
  type SurveyResult,
} from "@/lib/validation/surveys";
import { validateContentLinks } from "@/lib/surveys/service";

/* ------------------------------------------------------------------ */
/* Scope resolution                                                     */
/* ------------------------------------------------------------------ */

async function supervisorCoversTeacher(
  supervisorId: string,
  schoolId: string,
  teacher: { id: string; schoolId: string | null; branchId: string | null }
): Promise<boolean> {
  if (teacher.schoolId !== schoolId) return false;
  const assigned = await db.teacherSupervisorAssignment.findFirst({
    where: { supervisorId, teacherId: teacher.id },
    select: { id: true },
  });
  if (assigned) return true;
  if (!teacher.branchId) return false;
  const branchGrant = await db.supervisorAssignment.findFirst({
    where: { supervisorId, schoolId, branchId: teacher.branchId },
    select: { id: true },
  });
  return branchGrant !== null;
}

async function deputySchoolIds(deputyId: string): Promise<string[]> {
  const grants = await db.deputyGrant.findMany({
    where: { userId: deputyId },
    select: { schoolId: true },
  });
  return Array.from(new Set(grants.map((grant) => grant.schoolId)));
}

/** Which school(s) a follow-up actor may operate on. */
async function effectiveSchoolIds(ctx: SurveyActor): Promise<string[]> {
  if (ctx.role === "EDUCATIONAL_DEPUTY") return deputySchoolIds(ctx.id);
  return ctx.schoolId ? [ctx.schoolId] : [];
}

/* ------------------------------------------------------------------ */
/* Create / update                                                      */
/* ------------------------------------------------------------------ */

export interface FollowUpListFilters {
  status?: string;
  teacherId?: string;
  upcoming?: string;
  page?: number;
}

export interface FollowUpRow {
  id: string;
  titleAr: string;
  status: FollowUpStatus;
  teacherName: string;
  teacherId: string;
  supervisorName: string;
  followUpDate: Date;
  nextFollowUpAt: Date | null;
  sharedWithTeacher: boolean;
  contentTitle: string | null;
  surveyTitle: string | null;
  hasChallenges: boolean;
  hasSupportNeeds: boolean;
}

export async function createFollowUp(
  ctx: SurveyActor,
  rawDefinition: unknown
): Promise<SurveyResult<{ id: string }>> {
  if (!canManageFollowUps(ctx.role) || !ctx.schoolId) {
    return surveyFail(
      "إنشاء سجلات المتابعة متاح لمديري مكاتب التطوير والمشرفين التربويين فقط",
      "FORBIDDEN"
    );
  }

  const parsed = followUpDefinitionSchema.safeParse(rawDefinition);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  // The teacher must be an active TEACHER of the actor's school.
  const teacher = await db.user.findUnique({
    where: { id: input.teacherId },
    select: { id: true, role: true, schoolId: true, branchId: true, isActive: true },
  });
  if (!teacher || teacher.role !== "TEACHER" || !teacher.isActive || teacher.schoolId !== ctx.schoolId) {
    return surveyFail("المعلم المحدد غير موجود في نطاق مدرستك", "RELATION_ERROR");
  }

  // Supervisors create follow-ups only for teachers inside their scope;
  // the responsible supervisor is themself. Office managers may assign
  // any active supervisor of the school.
  let supervisorId: string;
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") {
    const covered = await supervisorCoversTeacher(ctx.id, ctx.schoolId, teacher);
    if (!covered) {
      return surveyFail("المعلم المحدد خارج نطاق إشرافك", "FORBIDDEN");
    }
    supervisorId = ctx.id;
  } else {
    if (!input.supervisorId) {
      return surveyFail("حدد المشرف المسؤول عن المتابعة", "VALIDATION_ERROR");
    }
    const supervisor = await db.user.findUnique({
      where: { id: input.supervisorId },
      select: { id: true, role: true, schoolId: true, isActive: true },
    });
    if (!supervisor || supervisor.role !== "EDUCATIONAL_SUPERVISOR" || !supervisor.isActive || supervisor.schoolId !== ctx.schoolId) {
      return surveyFail("المشرف المحدد غير موجود في نطاق مدرستك", "RELATION_ERROR");
    }
    supervisorId = supervisor.id;
  }

  const links = await validateContentLinks(ctx.schoolId, {
    programId: input.programId,
    courseId: input.courseId,
    lessonId: null,
    assignmentId: input.assignmentId,
    certificateId: null,
  });
  if (!links.ok) return links;

  // Survey link must be a school survey.
  if (input.surveyId) {
    const survey = await db.survey.findUnique({
      where: { id: input.surveyId },
      select: { schoolId: true },
    });
    if (!survey || survey.schoolId !== ctx.schoolId) {
      return surveyFail("الاستبيان المرتبط غير موجود في نطاق مدرستك", "RELATION_ERROR");
    }
  }

  const followUp = await db.$transaction(async (tx) => {
    const created = await tx.followUp.create({
      data: {
        schoolId: ctx.schoolId!,
        teacherId: teacher.id,
        supervisorId,
        createdById: ctx.id,
        titleAr: input.titleAr,
        purposeAr: input.purposeAr,
        followUpDate: input.followUpDate,
        nextFollowUpAt: input.nextFollowUpAt ?? null,
        status: "PLANNED",
        programId: input.programId,
        courseId: input.courseId,
        surveyId: input.surveyId,
        assignmentId: input.assignmentId,
        observationAr: input.observationAr,
        progressAr: input.progressAr,
        challengesAr: input.challengesAr,
        supportNeedsAr: input.supportNeedsAr,
        recommendationsAr: input.recommendationsAr,
        sharedWithTeacher: input.sharedWithTeacher,
      },
    });
    await tx.followUpEvent.create({
      data: {
        followUpId: created.id,
        type: "CREATED",
        actorId: ctx.id,
        actorRole: ctx.role,
      },
    });
    return created;
  });

  // Phase 11 — event notification (best-effort, post-commit; teacher-facing
  // content is gated by sharing — never notify a teacher about a record
  // they are not yet authorized to see).
  await notifyFollowUpCreated({
    followUpId: followUp.id,
    teacherId: teacher.id,
    titleAr: input.titleAr,
    followUpDate: input.followUpDate,
    sharedWithTeacher: input.sharedWithTeacher,
  });

  return { ok: true, data: { id: followUp.id } };
}

/** Loads a follow-up with scope guards for an operational actor. */
async function loadFollowUpForOperation(ctx: SurveyActor, followUpId: string) {
  const followUp = await db.followUp.findUnique({
    where: { id: followUpId },
    include: {
      teacher: { select: { id: true, schoolId: true, branchId: true } },
      supervisor: { select: { id: true } },
      createdBy: { select: { id: true } },
    },
  });
  if (!followUp) return { ok: false as const, error: surveyFail<never>("سجل المتابعة غير موجود", "NOT_FOUND") };
  // Phase 10 — archived records are outside every active workflow. Any
  // operational action (edit/status/share) must restore first.
  if (followUp.archivedAt) {
    return {
      ok: false as const,
      error: surveyFail<never>(
        "سجل المتابعة مؤرشف — استعده من مركز الأرشيف قبل تنفيذ أي إجراء",
        "ARCHIVED"
      ),
    };
  }

  const schoolIds = await effectiveSchoolIds(ctx);
  if (!schoolIds.includes(followUp.schoolId)) {
    return { ok: false as const, error: surveyFail<never>("سجل المتابعة خارج نطاقك المدرسي", "FORBIDDEN") };
  }
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") {
    const isResponsible = followUp.supervisorId === ctx.id;
    const isCreator = followUp.createdById === ctx.id;
    const covered = isResponsible
      ? true
      : await supervisorCoversTeacher(ctx.id, followUp.schoolId, followUp.teacher);
    if (!isResponsible && !isCreator && !covered) {
      return { ok: false as const, error: surveyFail<never>("سجل المتابعة خارج نطاق إشرافك", "FORBIDDEN") };
    }
  }
  return { ok: true as const, followUp };
}

export async function updateFollowUp(
  ctx: SurveyActor,
  followUpId: string,
  rawDefinition: unknown
): Promise<SurveyResult<{ id: string }>> {
  if (!canManageFollowUps(ctx.role) || !ctx.schoolId) {
    return surveyFail("تعديل سجلات المتابعة متاح للأدوار التشغيلية فقط", "FORBIDDEN");
  }
  const loaded = await loadFollowUpForOperation(ctx, followUpId);
  if (!loaded.ok) return loaded.error;

  const parsed = followUpDefinitionSchema.safeParse(rawDefinition);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const teacher = await db.user.findUnique({
    where: { id: input.teacherId },
    select: { id: true, role: true, schoolId: true, branchId: true, isActive: true },
  });
  if (!teacher || teacher.role !== "TEACHER" || !teacher.isActive || teacher.schoolId !== ctx.schoolId) {
    return surveyFail("المعلم المحدد غير موجود في نطاق مدرستك", "RELATION_ERROR");
  }

  let supervisorId: string;
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") {
    // Delegation rule: only the responsible supervisor (assigned by the
    // office manager) or the creator may edit the record, and they may
    // re-target it ONLY to a teacher inside their own coverage — updates
    // never widen a supervisor's real scope.
    const isDelegated =
      loaded.followUp.supervisorId === ctx.id || loaded.followUp.createdById === ctx.id;
    if (!isDelegated) {
      return surveyFail("يمكن للمشرف تعديل السجلات المكلَّف بها فقط", "FORBIDDEN");
    }
    const sameTeacher = teacher.id === loaded.followUp.teacherId;
    if (!sameTeacher) {
      const covered = await supervisorCoversTeacher(ctx.id, ctx.schoolId, teacher);
      if (!covered) {
        return surveyFail("المعلم المحدد خارج نطاق إشرافك", "FORBIDDEN");
      }
    }
    supervisorId = loaded.followUp.supervisorId === ctx.id ? ctx.id : loaded.followUp.supervisorId;
  } else {
    if (!input.supervisorId) {
      return surveyFail("حدد المشرف المسؤول عن المتابعة", "VALIDATION_ERROR");
    }
    const supervisor = await db.user.findUnique({
      where: { id: input.supervisorId },
      select: { id: true, role: true, schoolId: true, isActive: true },
    });
    if (!supervisor || supervisor.role !== "EDUCATIONAL_SUPERVISOR" || !supervisor.isActive || supervisor.schoolId !== ctx.schoolId) {
      return surveyFail("المشرف المحدد غير موجود في نطاق مدرستك", "RELATION_ERROR");
    }
    supervisorId = supervisor.id;
  }

  const links = await validateContentLinks(ctx.schoolId, {
    programId: input.programId,
    courseId: input.courseId,
    lessonId: null,
    assignmentId: input.assignmentId,
    certificateId: null,
  });
  if (!links.ok) return links;

  if (input.surveyId) {
    const survey = await db.survey.findUnique({
      where: { id: input.surveyId },
      select: { schoolId: true },
    });
    if (!survey || survey.schoolId !== ctx.schoolId) {
      return surveyFail("الاستبيان المرتبط غير موجود في نطاق مدرستك", "RELATION_ERROR");
    }
  }

  await db.$transaction(async (tx) => {
    await tx.followUp.update({
      where: { id: followUpId },
      data: {
        teacherId: teacher.id,
        supervisorId,
        titleAr: input.titleAr,
        purposeAr: input.purposeAr,
        followUpDate: input.followUpDate,
        nextFollowUpAt: input.nextFollowUpAt ?? null,
        programId: input.programId,
        courseId: input.courseId,
        surveyId: input.surveyId,
        assignmentId: input.assignmentId,
        observationAr: input.observationAr,
        progressAr: input.progressAr,
        challengesAr: input.challengesAr,
        supportNeedsAr: input.supportNeedsAr,
        recommendationsAr: input.recommendationsAr,
      },
    });
    await tx.followUpEvent.create({
      data: { followUpId, type: "UPDATED", actorId: ctx.id, actorRole: ctx.role },
    });
  });
  // Phase 11 — event notification (best-effort, post-commit).
  await notifyFollowUpUpdated({
    followUpId,
    teacherId: teacher.id,
    titleAr: input.titleAr,
    followUpDate: input.followUpDate,
    sharedWithTeacher: loaded.followUp.sharedWithTeacher,
  });
  return { ok: true, data: { id: followUpId } };
}

export async function changeFollowUpStatus(
  ctx: SurveyActor,
  rawInput: unknown
): Promise<SurveyResult<{ id: string; status: FollowUpStatus }>> {
  if (!canManageFollowUps(ctx.role) || !ctx.schoolId) {
    return surveyFail("تغيير حالة المتابعة متاح للأدوار التشغيلية فقط", "FORBIDDEN");
  }
  const parsed = followUpStatusSchema.safeParse(rawInput);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const loaded = await loadFollowUpForOperation(ctx, input.followUpId);
  if (!loaded.ok) return loaded.error;
  const followUp = loaded.followUp;

  // Status changes are delegated work: responsible supervisor or creator.
  if (
    ctx.role === "EDUCATIONAL_SUPERVISOR" &&
    followUp.supervisorId !== ctx.id &&
    followUp.createdById !== ctx.id
  ) {
    return surveyFail("يمكن للمشرف تحديث حالة السجلات المكلَّف بها فقط", "FORBIDDEN");
  }

  if (followUp.status === "COMPLETED" || followUp.status === "CANCELLED") {
    return surveyFail(
      "لا يمكن تغيير حالة سجل مكتمل أو ملغى — أنشئ سجل متابعة جديدًا للحفاظ على سجل التاريخ",
      "VALIDATION_ERROR"
    );
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.followUp.update({
      where: { id: input.followUpId },
      data: {
        status: input.status,
        completedAt: input.status === "COMPLETED" ? now : null,
      },
    });
    await tx.followUpEvent.create({
      data: {
        followUpId: input.followUpId,
        type: "STATUS_CHANGED",
        actorId: ctx.id,
        actorRole: ctx.role,
        note: input.note,
      },
    });
  });
  // Phase 11 — event notification (best-effort, post-commit).
  await notifyFollowUpStatusChanged({
    followUpId: input.followUpId,
    teacherId: followUp.teacherId,
    titleAr: followUp.titleAr,
    statusLabel: FOLLOW_UP_STATUS_LABELS[input.status] ?? input.status,
    statusKey: input.status,
    sharedWithTeacher: followUp.sharedWithTeacher,
  });
  return { ok: true, data: { id: input.followUpId, status: input.status as FollowUpStatus } };
}

export async function setFollowUpSharing(
  ctx: SurveyActor,
  rawInput: unknown
): Promise<SurveyResult<{ id: string; sharedWithTeacher: boolean }>> {
  if (!canManageFollowUps(ctx.role) || !ctx.schoolId) {
    return surveyFail("تغيير المشاركة متاح للأدوار التشغيلية فقط", "FORBIDDEN");
  }
  const parsed = followUpSharingSchema.safeParse(rawInput);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const loaded = await loadFollowUpForOperation(ctx, input.followUpId);
  if (!loaded.ok) return loaded.error;

  // Sharing is delegated work: responsible supervisor or creator.
  if (
    ctx.role === "EDUCATIONAL_SUPERVISOR" &&
    loaded.followUp.supervisorId !== ctx.id &&
    loaded.followUp.createdById !== ctx.id
  ) {
    return surveyFail("يمكن للمشرف التحكم بمشاركة سجلاته المكلَّف بها فقط", "FORBIDDEN");
  }

  await db.$transaction(async (tx) => {
    await tx.followUp.update({
      where: { id: input.followUpId },
      data: { sharedWithTeacher: input.sharedWithTeacher },
    });
    await tx.followUpEvent.create({
      data: {
        followUpId: input.followUpId,
        type: "SHARING_CHANGED",
        actorId: ctx.id,
        actorRole: ctx.role,
        note: input.sharedWithTeacher ? "تمت المشاركة مع المعلم" : "أوقفت المشاركة مع المعلم",
      },
    });
  });
  // Phase 11 — event notification: the teacher gains visibility exactly
  // when sharing turns ON (best-effort, post-commit).
  if (input.sharedWithTeacher) {
    await notifyFollowUpShared({
      followUpId: input.followUpId,
      teacherId: loaded.followUp.teacherId,
      titleAr: loaded.followUp.titleAr,
    });
  }
  return { ok: true, data: { id: input.followUpId, sharedWithTeacher: input.sharedWithTeacher } };
}

/* ------------------------------------------------------------------ */
/* Lists & single views                                                 */
/* ------------------------------------------------------------------ */

export async function listFollowUps(
  ctx: SurveyActor,
  filters: FollowUpListFilters = {}
): Promise<SurveyResult<{ rows: FollowUpRow[]; total: number; pageCount: number; page: number }>> {
  if (!canManageFollowUps(ctx.role) && ctx.role !== "EDUCATIONAL_DEPUTY") {
    return surveyFail("سجلات المتابعة متاحة للأدوار الإدارية المدرسية فقط", "FORBIDDEN");
  }
  const schoolIds = await effectiveSchoolIds(ctx);
  if (schoolIds.length === 0) {
    return surveyFail("النطاق المدرسي غير محدد", "FORBIDDEN");
  }

  const where: Record<string, unknown> = { schoolId: { in: schoolIds }, archivedAt: null };
  // Supervisors see records they are responsible for or that fall inside
  // their coverage — the coverage set is resolved explicitly (never via
  // URL-supplied ids).
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") {
    const [assigned, branchGrants] = await Promise.all([
      db.teacherSupervisorAssignment.findMany({
        where: { supervisorId: ctx.id },
        select: { teacherId: true },
      }),
      db.supervisorAssignment.findMany({
        where: { supervisorId: ctx.id },
        select: { branchId: true },
      }),
    ]);
    const branchIds = branchGrants.map((row) => row.branchId);
    where.OR = [
      { supervisorId: ctx.id },
      { createdById: ctx.id },
      { teacherId: { in: assigned.map((row) => row.teacherId) } },
      { teacher: { branchId: { in: branchIds } } },
    ];
  }
  if (filters.status && ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(filters.status)) {
    where.status = filters.status;
  }
  if (filters.teacherId && filters.teacherId.trim() !== "") {
    where.teacherId = filters.teacherId.trim();
  }
  if (filters.upcoming === "1") {
    where.nextFollowUpAt = { gte: new Date() };
    where.status = { in: ["PLANNED", "IN_PROGRESS"] };
  }

  const total = await db.followUp.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / FOLLOW_UPS_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  const rows = await db.followUp.findMany({
    where,
    orderBy: [{ followUpDate: "desc" }],
    skip: (page - 1) * FOLLOW_UPS_PAGE_SIZE,
    take: FOLLOW_UPS_PAGE_SIZE,
    include: {
      teacher: { select: { name: true } },
      supervisor: { select: { name: true } },
      program: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
      survey: { select: { titleAr: true } },
      assignment: { select: { titleAr: true } },
    },
  });

  return {
    ok: true,
    data: {
      rows: rows.map((followUp) => ({
        id: followUp.id,
        titleAr: followUp.titleAr,
        status: followUp.status as FollowUpStatus,
        teacherName: followUp.teacher.name,
        teacherId: followUp.teacherId,
        supervisorName: followUp.supervisor.name,
        followUpDate: followUp.followUpDate,
        nextFollowUpAt: followUp.nextFollowUpAt,
        sharedWithTeacher: followUp.sharedWithTeacher,
        contentTitle:
          followUp.program?.nameAr ??
          followUp.course?.titleAr ??
          followUp.assignment?.titleAr ??
          null,
        surveyTitle: followUp.survey?.titleAr ?? null,
        hasChallenges: (followUp.challengesAr ?? "").trim().length > 0,
        hasSupportNeeds: (followUp.supportNeedsAr ?? "").trim().length > 0,
      })),
      total,
      pageCount,
      page,
    },
  };
}

export interface FollowUpManageView {
  id: string;
  titleAr: string;
  status: FollowUpStatus;
  purposeAr: string | null;
  followUpDate: Date;
  nextFollowUpAt: Date | null;
  completedAt: Date | null;
  sharedWithTeacher: boolean;
  teacherId: string;
  teacherName: string;
  supervisorId: string;
  supervisorName: string;
  programId: string | null;
  courseId: string | null;
  surveyId: string | null;
  assignmentId: string | null;
  programTitle: string | null;
  courseTitle: string | null;
  surveyTitle: string | null;
  assignmentTitle: string | null;
  observationAr: string | null;
  progressAr: string | null;
  challengesAr: string | null;
  supportNeedsAr: string | null;
  recommendationsAr: string | null;
  events: {
    id: string;
    type: string;
    actorName: string | null;
    actorRole: string | null;
    note: string | null;
    createdAt: Date;
  }[];
  canEdit: boolean;
}

export async function getFollowUpManageView(
  ctx: SurveyActor,
  followUpId: string
): Promise<SurveyResult<FollowUpManageView>> {
  if (!canManageFollowUps(ctx.role) && ctx.role !== "EDUCATIONAL_DEPUTY") {
    return surveyFail("عرض سجل المتابعة متاح للأدوار الإدارية المدرسية فقط", "FORBIDDEN");
  }
  const loaded = await loadFollowUpForOperation(ctx, followUpId);
  if (!loaded.ok) return loaded.error;
  const followUp = loaded.followUp;

  const detail = await db.followUp.findUnique({
    where: { id: followUpId },
    include: {
      teacher: { select: { name: true } },
      supervisor: { select: { name: true } },
      program: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
      survey: { select: { titleAr: true } },
      assignment: { select: { titleAr: true } },
      events: {
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { actor: { select: { name: true } } },
      },
    },
  });
  if (!detail) return surveyFail("سجل المتابعة غير موجود", "NOT_FOUND");

  const canEdit =
    canManageFollowUps(ctx.role) &&
    (ctx.role === "DEVELOPMENT_OFFICE_MANAGER" ||
      followUp.supervisorId === ctx.id ||
      followUp.createdById === ctx.id);

  return {
    ok: true,
    data: {
      id: detail.id,
      titleAr: detail.titleAr,
      status: detail.status as FollowUpStatus,
      purposeAr: detail.purposeAr,
      followUpDate: detail.followUpDate,
      nextFollowUpAt: detail.nextFollowUpAt,
      completedAt: detail.completedAt,
      sharedWithTeacher: detail.sharedWithTeacher,
      teacherId: detail.teacherId,
      teacherName: detail.teacher.name,
      supervisorId: detail.supervisorId,
      supervisorName: detail.supervisor.name,
      programId: detail.programId,
      courseId: detail.courseId,
      surveyId: detail.surveyId,
      assignmentId: detail.assignmentId,
      programTitle: detail.program?.nameAr ?? null,
      courseTitle: detail.course?.titleAr ?? null,
      surveyTitle: detail.survey?.titleAr ?? null,
      assignmentTitle: detail.assignment?.titleAr ?? null,
      observationAr: detail.observationAr,
      progressAr: detail.progressAr,
      challengesAr: detail.challengesAr,
      supportNeedsAr: detail.supportNeedsAr,
      recommendationsAr: detail.recommendationsAr,
      events: detail.events.map((event) => ({
        id: event.id,
        type: event.type,
        actorName: event.actor?.name ?? null,
        actorRole: event.actorRole,
        note: event.note,
        createdAt: event.createdAt,
      })),
      canEdit,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Teacher-shared projection                                            */
/* ------------------------------------------------------------------ */

export interface SharedFollowUpRow {
  id: string;
  titleAr: string;
  status: FollowUpStatus;
  purposeAr: string | null;
  followUpDate: Date;
  nextFollowUpAt: Date | null;
  recommendationsAr: string | null;
  supervisorName: string;
  programTitle: string | null;
  courseTitle: string | null;
}

/**
 * The ONLY follow-up data teachers can see: records explicitly shared
 * (sharedWithTeacher) and targeted at them, projected to the shared
 * subset. Observation/challenge/support-notes are structurally absent
 * from this query — not merely hidden in the UI.
 */
export async function listSharedFollowUpsForTeacher(
  viewer: SurveyViewer
): Promise<SurveyResult<SharedFollowUpRow[]>> {
  if (viewer.role !== "TEACHER" || !viewer.schoolId) {
    return surveyFail("سجلات المتابعة المشتركة متاحة للمعلمين فقط", "FORBIDDEN");
  }
  const rows = await db.followUp.findMany({
    where: {
      schoolId: viewer.schoolId,
      teacherId: viewer.id,
      sharedWithTeacher: true,
      archivedAt: null,
    },
    orderBy: { followUpDate: "desc" },
    take: 50,
    include: {
      supervisor: { select: { name: true } },
      program: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
    },
  });
  return {
    ok: true,
    data: rows.map((followUp) => ({
      id: followUp.id,
      titleAr: followUp.titleAr,
      status: followUp.status as FollowUpStatus,
      purposeAr: followUp.purposeAr,
      followUpDate: followUp.followUpDate,
      nextFollowUpAt: followUp.nextFollowUpAt,
      recommendationsAr: followUp.recommendationsAr,
      supervisorName: followUp.supervisor.name,
      programTitle: followUp.program?.nameAr ?? null,
      courseTitle: followUp.course?.titleAr ?? null,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Metrics                                                              */
/* ------------------------------------------------------------------ */

export interface FollowUpMetrics {
  total: number;
  planned: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  /** Denominator: total − cancelled. Null when there is nothing to count. */
  completionRatePercent: number | null;
  upcomingCount: number;
  /** Records where the supervisor reported challenges / support needs. */
  withChallenges: number;
  withSupportNeeds: number;
}

export async function getFollowUpMetrics(ctx: SurveyActor): Promise<SurveyResult<FollowUpMetrics>> {
  if (!canManageFollowUps(ctx.role) && ctx.role !== "EDUCATIONAL_DEPUTY") {
    return surveyFail("مؤشرات المتابعة متاحة للأدوار الإدارية المدرسية فقط", "FORBIDDEN");
  }
  const schoolIds = await effectiveSchoolIds(ctx);
  if (schoolIds.length === 0) {
    return surveyFail("النطاق المدرسي غير محدد", "FORBIDDEN");
  }

  const scopeWhere: Record<string, unknown> = { schoolId: { in: schoolIds }, archivedAt: null };
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") {
    scopeWhere.supervisorId = ctx.id;
  }

  const [total, planned, inProgress, completed, cancelled, upcoming, withChallenges, withSupportNeeds] =
    await Promise.all([
      db.followUp.count({ where: scopeWhere }),
      db.followUp.count({ where: { ...scopeWhere, status: "PLANNED" } }),
      db.followUp.count({ where: { ...scopeWhere, status: "IN_PROGRESS" } }),
      db.followUp.count({ where: { ...scopeWhere, status: "COMPLETED" } }),
      db.followUp.count({ where: { ...scopeWhere, status: "CANCELLED" } }),
      db.followUp.count({
        where: {
          ...scopeWhere,
          status: { in: ["PLANNED", "IN_PROGRESS"] },
          nextFollowUpAt: { gte: new Date() },
        },
      }),
      db.followUp.count({
        where: { ...scopeWhere, challengesAr: { not: null } },
      }),
      db.followUp.count({
        where: { ...scopeWhere, supportNeedsAr: { not: null } },
      }),
    ]);

  const denominator = total - cancelled;
  return {
    ok: true,
    data: {
      total,
      planned,
      inProgress,
      completed,
      cancelled,
      completionRatePercent:
        denominator > 0 ? Math.round((completed / denominator) * 100) : null,
      upcomingCount: upcoming,
      withChallenges,
      withSupportNeeds,
    },
  };
}

/** Form options: active school teachers + supervisors (manager picks). */
export async function listFollowUpFormOptions(
  ctx: SurveyActor
): Promise<
  SurveyResult<{
    teachers: { id: string; name: string; branchName: string | null }[];
    supervisors: { id: string; name: string }[];
  }>
> {
  if (!canManageFollowUps(ctx.role) || !ctx.schoolId) {
    return surveyFail("غير مصرح", "FORBIDDEN");
  }

  let teacherWhere: Record<string, unknown> = {
    schoolId: ctx.schoolId,
    role: "TEACHER",
    isActive: true,
  };
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") {
    const [assigned, branchGrants] = await Promise.all([
      db.teacherSupervisorAssignment.findMany({
        where: { supervisorId: ctx.id },
        select: { teacherId: true },
      }),
      db.supervisorAssignment.findMany({
        where: { supervisorId: ctx.id },
        select: { branchId: true },
      }),
    ]);
    teacherWhere = {
      ...teacherWhere,
      OR: [
        { id: { in: assigned.map((row) => row.teacherId) } },
        { branchId: { in: branchGrants.map((row) => row.branchId) } },
      ],
    };
  }

  const [teachers, supervisors] = await Promise.all([
    db.user.findMany({
      where: teacherWhere,
      select: { id: true, name: true, branch: { select: { nameAr: true } } },
      orderBy: { name: "asc" },
      take: 300,
    }),
    ctx.role === "DEVELOPMENT_OFFICE_MANAGER"
      ? db.user.findMany({
          where: {
            schoolId: ctx.schoolId,
            role: "EDUCATIONAL_SUPERVISOR",
            isActive: true,
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  return {
    ok: true,
    data: {
      teachers: teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        branchName: teacher.branch?.nameAr ?? null,
      })),
      supervisors,
    },
  };
}

/** Content-link options for the follow-up form (school-scoped). */
export async function listFollowUpLinkOptions(
  ctx: SurveyActor
): Promise<
  SurveyResult<{
    programs: { id: string; nameAr: string }[];
    courses: { id: string; titleAr: string }[];
    assignments: { id: string; titleAr: string }[];
  }>
> {
  if (!canManageFollowUps(ctx.role) || !ctx.schoolId) {
    return surveyFail("غير مصرح", "FORBIDDEN");
  }
  const schoolId = ctx.schoolId;
  const [programs, courses, assignments] = await Promise.all([
    db.trainingProgram.findMany({
      where: { status: { not: "ARCHIVED" }, OR: [{ schoolId }, { schoolId: null }] },
      select: { id: true, nameAr: true },
      orderBy: { nameAr: "asc" },
      take: 200,
    }),
    db.course.findMany({
      where: { status: { not: "ARCHIVED" }, OR: [{ schoolId }, { schoolId: null }] },
      select: { id: true, titleAr: true },
      orderBy: { titleAr: "asc" },
      take: 200,
    }),
    db.assignment.findMany({
      where: { schoolId, status: { not: "ARCHIVED" } },
      select: { id: true, titleAr: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  return { ok: true, data: { programs, courses, assignments } };
}
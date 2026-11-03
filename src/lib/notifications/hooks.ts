/**
 * Phase 11 — event hooks: the ONE place where product events become
 * notifications. Each hook resolves its own recipients from DB-verified
 * relationships (school/branch/supervisor scoping — never client input),
 * fans out through the idempotent + preference-aware notify machinery,
 * and swallows its own failures so a notification can never break the
 * underlying business transaction.
 */

import { db } from "@/lib/db";
import { parseJsonIds, isTeacherTargeted } from "@/lib/assignments/access";
import { notify, notifyMany } from "@/lib/notifications/service";
import { formatEmailDate } from "@/lib/integrations/email/templates";

/**
 * Phase 12 — every hook still swallows its own errors (a notification
 * failure must never break a business transaction), but the failure is
 * now logged with the hook name and the error message. No user content,
 * tokens or provider payloads are ever logged.
 */
function logHookFailure(hook: string, error: unknown): void {
  console.error(
    `[notification-hook] ${hook} failed:`,
    error instanceof Error ? error.message : error
  );
}

/* ------------------------------------------------------------------ */
/* Assignments                                                         */
/* ------------------------------------------------------------------ */

/** Fires on PUBLISHED: notify every DB-verified targeted teacher. */
export async function notifyAssignmentPublished(assignment: {
  id: string;
  schoolId: string;
  titleAr: string;
  dueAt: Date;
  audienceMode: string;
  targetTeacherIdsJson: string | null;
  targetBranchIdsJson: string | null;
  publishedAt: Date | null;
}): Promise<void> {
  try {
    const targeting = {
      audienceMode: assignment.audienceMode,
      targetTeacherIds: parseJsonIds(assignment.targetTeacherIdsJson),
      targetBranchIds: parseJsonIds(assignment.targetBranchIdsJson),
    };
    const teachers = await db.user.findMany({
      where: { role: "TEACHER", schoolId: assignment.schoolId, isActive: true },
      select: { id: true, branchId: true },
    });
    const recipients = teachers
      .filter((teacher) => isTeacherTargeted(targeting, teacher))
      .map((teacher) => teacher.id);
    if (recipients.length === 0) return;

    await notifyMany(recipients, {
      type: "ASSIGNMENT_PUBLISHED",
      titleAr: "واجب جديد متاح لك",
      bodyAr: `نُشر واجب «${assignment.titleAr}» ويجب تسليمه قبل ${formatEmailDate(assignment.dueAt)}.`,
      resourceType: "Assignment",
      resourceId: assignment.id,
      destinationUrl: `/my-assignments/${assignment.id}`,
      // Re-opening (CLOSED → PUBLISHED) keeps one notification per day-bucket
      // instead of none: the event itself is the same logical publish.
      eventId: `assignment-published:${assignment.id}:${assignment.publishedAt?.toISOString().slice(0, 10) ?? "republish"}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifyAssignmentPublished", error);
  }
}

/** Fires on submit: office managers + the teacher's covering supervisors. */
export async function notifySubmissionReceived(input: {
  schoolId: string;
  teacherId: string;
  assignmentId: string;
  assignmentTitleAr: string;
  isLate: boolean;
}): Promise<void> {
  try {
    const [managers, supervision] = await Promise.all([
      db.user.findMany({
        where: { role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: input.schoolId, isActive: true },
        select: { id: true },
      }),
      db.teacherSupervisorAssignment.findUnique({
        where: { teacherId: input.teacherId },
        select: { supervisorId: true },
      }),
    ]);
    const recipients = Array.from(
      new Set([managers.map((row) => row.id), supervision?.supervisorId ?? null].flat()),
    ).filter((id): id is string => Boolean(id) && id !== input.teacherId);
    if (recipients.length === 0) return;

    await notifyMany(recipients, {
      type: "SUBMISSION_RECEIVED",
      titleAr: "استلام تسليم جديد للمراجعة",
      bodyAr: `وصل تسليم${input.isLate ? " متأخر" : ""} على واجب «${input.assignmentTitleAr}» وهو بانتظار المراجعة.`,
      resourceType: "Assignment",
      resourceId: input.assignmentId,
      destinationUrl: `/assignments/${input.assignmentId}/submissions`,
      eventId: `submission-received:${input.assignmentId}:${input.teacherId}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifySubmissionReceived", error);
  }
}

/** Fires on RETURNED: the owning teacher only. */
export async function notifySubmissionReturned(input: {
  teacherId: string;
  assignmentId: string;
  assignmentTitleAr: string;
}): Promise<void> {
  try {
    await notify({
      userId: input.teacherId,
      type: "SUBMISSION_RETURNED",
      titleAr: "أُعيد تسليمك للتعديل",
      bodyAr: `أعاد المراجع تسليمك على واجب «${input.assignmentTitleAr}» مع ملاحظات للتعديل — راجع التغذية الراجعة ثم أعد التقديم.`,
      resourceType: "Assignment",
      resourceId: input.assignmentId,
      destinationUrl: `/my-assignments/${input.assignmentId}`,
      eventId: `submission-returned:${input.assignmentId}:${input.teacherId}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifySubmissionReturned", error);
  }
}

/** Fires on GRADED: the owning teacher only. */
export async function notifySubmissionGraded(input: {
  teacherId: string;
  assignmentId: string;
  assignmentTitleAr: string;
  scoreTotal: number;
  totalPoints: number;
}): Promise<void> {
  try {
    await notify({
      userId: input.teacherId,
      type: "SUBMISSION_GRADED",
      titleAr: "تم تقييم تسليمك",
      bodyAr: `نتيجتك على واجب «${input.assignmentTitleAr}»: ${input.scoreTotal} من ${input.totalPoints}. اطلع على معايير التقييم والتغذية الراجعة الكاملة.`,
      resourceType: "Assignment",
      resourceId: input.assignmentId,
      destinationUrl: `/my-assignments/${input.assignmentId}`,
      eventId: `submission-graded:${input.assignmentId}:${input.teacherId}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifySubmissionGraded", error);
  }
}

/* ------------------------------------------------------------------ */
/* Certificates                                                        */
/* ------------------------------------------------------------------ */

export async function notifyCertificateIssued(input: {
  teacherId: string;
  certificateId: string;
  titleAr: string;
}): Promise<void> {
  try {
    await notify({
      userId: input.teacherId,
      type: "CERTIFICATE_ISSUED",
      titleAr: "صادرت لك شهادة جديدة",
      bodyAr: `أصدرت إدارة المدرسة شهادة «${input.titleAr}» — يمكنك عرضها وطباعتها من صفحة شهاداتي.`,
      resourceType: "Certificate",
      resourceId: input.certificateId,
      destinationUrl: `/my-certificates`,
      eventId: `certificate-issued:${input.certificateId}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifyCertificateIssued", error);
  }
}

export async function notifyCertificateRevoked(input: {
  teacherId: string;
  certificateId: string;
  titleAr: string;
  reason: string | null;
}): Promise<void> {
  try {
    await notify({
      userId: input.teacherId,
      type: "CERTIFICATE_REVOKED",
      titleAr: "أُلغيت شهادة صادرة باسمك",
      bodyAr: `ألغيت إدارة المدرسة شهادة «${input.titleAr}»${input.reason ? ` والسبب: «${input.reason}»` : ""}. للاستفسار تواصل مع مدير مكتب التطوير.`,
      resourceType: "Certificate",
      resourceId: input.certificateId,
      destinationUrl: `/my-certificates`,
      eventId: `certificate-revoked:${input.certificateId}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifyCertificateRevoked", error);
  }
}

/* ------------------------------------------------------------------ */
/* Surveys                                                             */
/* ------------------------------------------------------------------ */

/** Fires on PUBLISHED: notify the resolved audience teachers. */
export async function notifySurveyPublished(survey: {
  id: string;
  titleAr: string;
  closesAt: Date | null;
  audienceTeacherIds: string[];
}): Promise<void> {
  try {
    if (survey.audienceTeacherIds.length === 0) return;
    await notifyMany(survey.audienceTeacherIds, {
      type: "SURVEY_PUBLISHED",
      titleAr: "استبيان جديد متاح لك",
      bodyAr: `نُشر استبيان «${survey.titleAr}»${
        survey.closesAt ? ` ويُغلق باب الإجابة بتاريخ ${formatEmailDate(survey.closesAt)}` : ""
      }. رأيك يثري قرارات التطوير.`,
      resourceType: "Survey",
      resourceId: survey.id,
      destinationUrl: `/my-surveys/${survey.id}`,
      eventId: `survey-published:${survey.id}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifySurveyPublished", error);
  }
}

/* ------------------------------------------------------------------ */
/* Follow-ups                                                          */
/* ------------------------------------------------------------------ */

export async function notifyFollowUpCreated(input: {
  followUpId: string;
  teacherId: string;
  titleAr: string;
  followUpDate: Date;
  /** Teacher-facing content is gated by sharing — never notify blind. */
  sharedWithTeacher: boolean;
}): Promise<void> {
  try {
    if (!input.sharedWithTeacher) return;
    await notify({
      userId: input.teacherId,
      type: "FOLLOWUP_CREATED",
      titleAr: "زيارة متابعة ميدانية مجدولة",
      bodyAr: `جدول المشرف زيارة متابعة «${input.titleAr}» بتاريخ ${formatEmailDate(input.followUpDate)}.`,
      resourceType: "FollowUp",
      resourceId: input.followUpId,
      destinationUrl: `/my-follow-ups`,
      eventId: `followup-created:${input.followUpId}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifyFollowUpCreated", error);
  }
}

export async function notifyFollowUpUpdated(input: {
  followUpId: string;
  teacherId: string;
  titleAr: string;
  followUpDate: Date;
  sharedWithTeacher: boolean;
}): Promise<void> {
  try {
    if (!input.sharedWithTeacher) return;
    await notify({
      userId: input.teacherId,
      type: "FOLLOWUP_UPDATED",
      titleAr: "تحديث على زيارة متابعة",
      bodyAr: `حُدّثت زيارة المتابعة «${input.titleAr}» والموعد الحالي: ${formatEmailDate(input.followUpDate)}.`,
      resourceType: "FollowUp",
      resourceId: input.followUpId,
      destinationUrl: `/my-follow-ups`,
      eventId: `followup-updated:${input.followUpId}:${input.followUpDate.toISOString().slice(0, 16)}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifyFollowUpUpdated", error);
  }
}

export async function notifyFollowUpStatusChanged(input: {
  followUpId: string;
  teacherId: string;
  titleAr: string;
  statusLabel: string;
  statusKey: string;
  sharedWithTeacher: boolean;
}): Promise<void> {
  try {
    if (!input.sharedWithTeacher) return;
    await notify({
      userId: input.teacherId,
      type: "FOLLOWUP_STATUS_CHANGED",
      titleAr: "تغيّرت حالة زيارة متابعة",
      bodyAr: `أصبحت حالة المتابعة «${input.titleAr}»: ${input.statusLabel}.`,
      resourceType: "FollowUp",
      resourceId: input.followUpId,
      destinationUrl: `/my-follow-ups`,
      // Updateable event → allow a new notification per status value.
      eventId: `followup-status:${input.followUpId}:${input.statusKey}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifyFollowUpStatusChanged", error);
  }
}

/** Fires when sharing is switched ON: the teacher gains visibility. */
export async function notifyFollowUpShared(input: {
  followUpId: string;
  teacherId: string;
  titleAr: string;
}): Promise<void> {
  try {
    await notify({
      userId: input.teacherId,
      type: "FOLLOWUP_SHARED",
      titleAr: "أُضيفت متابعة مشتركة إليك",
      bodyAr: `تمت مشاركة المتابعة «${input.titleAr}» معك — يمكنك الاطلاع على الملخص والتوصيات المتاحة لك.`,
      resourceType: "FollowUp",
      resourceId: input.followUpId,
      destinationUrl: `/my-follow-ups`,
      eventId: `followup-shared:${input.followUpId}`,
      email: true,
    });
  } catch (error) {
    // Notifications must never break the business flow — but the
    // failure is logged (Phase 12) instead of vanishing silently.
    logHookFailure("notifyFollowUpShared", error);
  }
}
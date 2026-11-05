import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/center";

/* ------------------------------------------------------------------ */
/* Phase 11 — certificate & assignment event hooks.                    */
/*                                                                     */
/* Batch 1 upgrade: these hooks used to be fire-and-forget log lines;  */
/* they now persist REAL notification rows through the notification    */
/* center (recipient = server-resolved userId, internal destination    */
/* paths, per-recipient idempotency keys where the event is unique).   */
/*                                                                     */
/* Contracts (call sites):                                             */
/*   - src/lib/certificates/service.ts  (manual issue / revoke)        */
/*   - src/lib/certificates/auto-issue.ts (completion auto-issue)      */
/*   - src/lib/assignments/service.ts   (publish / submit / return /   */
/*     grade)                                                          */
/*                                                                     */
/* Every hook is BEST-EFFORT by design: it runs AFTER the business     */
/* transaction committed, so any failure here is logged and swallowed  */
/* — it must never fail the flow that already succeeded.               */
/* ------------------------------------------------------------------ */

/** Course id for the assignments module deep links. */
const ASSIGNMENTS_URL = "/assignments";

function eventError(hook: string, error: unknown): void {
  console.error(`[notifications] ${hook} failed`, error);
}

/* ------------------------------------------------------------------ */
/* Certificates                                                         */
/* ------------------------------------------------------------------ */

export interface NotificationHookInput {
  teacherId: string;
  certificateId: string;
  titleAr: string;
}

/** Certificate ISSUED -> the owning teacher, deep link to the sheet. */
export async function notifyCertificateIssued(
  input: NotificationHookInput
): Promise<void> {
  try {
    const certificate = await db.certificate.findUnique({
      where: { id: input.certificateId },
      select: { certificateNumber: true },
    });
    await createNotification({
      userId: input.teacherId,
      type: "CERTIFICATE_ISSUED",
      category: "CERTIFICATES",
      titleAr: "شهادتك جاهزة 🎉",
      bodyAr: certificate
        ? `صدرت شهادة «${input.titleAr}» برقم ${certificate.certificateNumber} — افتحها لعرضها وطباعتها.`
        : `صدرت شهادتك «${input.titleAr}» — افتحها لعرضها وطباعتها.`,
      destinationUrl: `/certificates/${input.certificateId}`,
      resourceType: "Certificate",
      resourceId: input.certificateId,
      // One issuance event per certificate — retries collapse here.
      eventId: `CERT_ISSUED:${input.certificateId}`,
    });
  } catch (error) {
    eventError("notifyCertificateIssued", error);
  }
}

/** Certificate REVOKED -> the owning teacher, with the given reason. */
export async function notifyCertificateRevoked(
  input: NotificationHookInput & { reason: string }
): Promise<void> {
  try {
    await createNotification({
      userId: input.teacherId,
      type: "CERTIFICATE_REVOKED",
      category: "CERTIFICATES",
      titleAr: "إلغاء شهادة",
      bodyAr: `أُلغيت شهادة «${input.titleAr}». السبب: ${input.reason}`,
      destinationUrl: `/certificates/${input.certificateId}`,
      resourceType: "Certificate",
      resourceId: input.certificateId,
      eventId: `CERT_REVOKED:${input.certificateId}`,
    });
  } catch (error) {
    eventError("notifyCertificateRevoked", error);
  }
}

/* ------------------------------------------------------------------ */
/* Assignments                                                          */
/* ------------------------------------------------------------------ */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Parse a JSON string column defensively ("" / null / bad JSON -> []). */
function parseIdList(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: JsonValue = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** Arabic due-date text for notification bodies (Cairo time). */
function formatDueDate(dueAt: Date | null): string {
  if (!dueAt) return "";
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Africa/Cairo",
    }).format(dueAt);
  } catch {
    return "";
  }
}

export interface AssignmentPublishedHookInput {
  id: string;
  schoolId: string | null;
  titleAr: string;
  dueAt: Date | null;
  audienceMode: string;
  targetTeacherIdsJson: string | null;
  targetBranchIdsJson: string | null;
  publishedAt: Date;
}

/**
 * Assignment PUBLISHED -> every targeted ACTIVE TEACHER.
 * Recipients are resolved SERVER-SIDE from the persisted audience
 * columns (never from client input): explicit teacher ids, else the
 * teachers of the target branches, else the whole school's teachers
 * (platform-wide assignments reach every active teacher).
 */
export async function notifyAssignmentPublished(
  input: AssignmentPublishedHookInput
): Promise<void> {
  try {
    const teacherIds = parseIdList(input.targetTeacherIdsJson);
    const branchIds = parseIdList(input.targetBranchIdsJson);

    let recipients: Array<{ id: string }> = [];
    if (input.audienceMode === "TEACHERS" && teacherIds.length > 0) {
      recipients = await db.user.findMany({
        where: { id: { in: teacherIds }, role: "TEACHER", isActive: true },
        select: { id: true },
      });
    } else if (input.audienceMode === "BRANCHES" && branchIds.length > 0) {
      recipients = await db.user.findMany({
        where: {
          role: "TEACHER",
          isActive: true,
          branchId: { in: branchIds },
        },
        select: { id: true },
      });
    } else {
      recipients = await db.user.findMany({
        where: {
          role: "TEACHER",
          isActive: true,
          ...(input.schoolId ? { schoolId: input.schoolId } : {}),
        },
        select: { id: true },
      });
    }

    const dueText = formatDueDate(input.dueAt);
    const bodyAr = dueText
      ? `واجب جديد: «${input.titleAr}» — آخر موعد للتسليم ${dueText}.`
      : `واجب جديد: «${input.titleAr}» — راجع التفاصيل وابدأ العمل عليه.`;

    for (const recipient of recipients) {
      await createNotification({
        userId: recipient.id,
        type: "ASSIGNMENT_PUBLISHED",
        category: "ASSIGNMENTS",
        titleAr: "واجب جديد مكلف به",
        bodyAr,
        destinationUrl: ASSIGNMENTS_URL,
        resourceType: "Assignment",
        resourceId: input.id,
        eventId: `ASSIGNMENT_PUBLISHED:${input.id}:${recipient.id}`,
      });
    }
  } catch (error) {
    eventError("notifyAssignmentPublished", error);
  }
}

export interface SubmissionReceivedHookInput {
  schoolId: string | null;
  teacherId: string;
  assignmentId: string;
  assignmentTitleAr: string;
  isLate: boolean;
}

/**
 * Submission RECEIVED -> the school's development office (the reviewers).
 * Distinct lifecycle event (eventId null): a re-submission after a
 * return notifies the office again on purpose.
 */
export async function notifySubmissionReceived(
  input: SubmissionReceivedHookInput
): Promise<void> {
  try {
    if (!input.schoolId) return; // platform-wide assignments have no office
    const office = await db.user.findMany({
      where: {
        role: "DEVELOPMENT_OFFICE_MANAGER",
        schoolId: input.schoolId,
        isActive: true,
      },
      select: { id: true },
    });
    const lateText = input.isLate ? " (تسليم متأخر)" : "";
    for (const reviewer of office) {
      await createNotification({
        userId: reviewer.id,
        type: "ASSIGNMENT_SUBMISSION_RECEIVED",
        category: "ASSIGNMENTS",
        titleAr: "استلام تسليم واجب",
        bodyAr: `وصل تسليم جديد للواجب «${input.assignmentTitleAr}»${lateText} — بانتظار المراجعة.`,
        destinationUrl: ASSIGNMENTS_URL,
        resourceType: "Assignment",
        resourceId: input.assignmentId,
        eventId: null,
      });
    }
  } catch (error) {
    eventError("notifySubmissionReceived", error);
  }
}

export interface SubmissionReturnedHookInput {
  teacherId: string;
  assignmentId: string;
  assignmentTitleAr: string;
}

/** Submission RETURNED -> the owning teacher re-works it. */
export async function notifySubmissionReturned(
  input: SubmissionReturnedHookInput
): Promise<void> {
  try {
    await createNotification({
      userId: input.teacherId,
      type: "ASSIGNMENT_SUBMISSION_RETURNED",
      category: "ASSIGNMENTS",
      titleAr: "إعادة واجب للتعديل",
      bodyAr: `أُعيد تسليم «${input.assignmentTitleAr}» إليك للتعديل — راجع ملاحظات المراجع ثم أعد الإرسال.`,
      destinationUrl: ASSIGNMENTS_URL,
      resourceType: "Assignment",
      resourceId: input.assignmentId,
      eventId: null,
    });
  } catch (error) {
    eventError("notifySubmissionReturned", error);
  }
}

export interface SubmissionGradedHookInput {
  teacherId: string;
  assignmentId: string;
  assignmentTitleAr: string;
  scoreTotal: number;
  totalPoints: number;
}

/** Submission GRADED -> the owning teacher sees the score. */
export async function notifySubmissionGraded(
  input: SubmissionGradedHookInput
): Promise<void> {
  try {
    await createNotification({
      userId: input.teacherId,
      type: "ASSIGNMENT_SUBMISSION_GRADED",
      category: "ASSIGNMENTS",
      titleAr: "تقييم واجب",
      bodyAr: `تم تقييم «${input.assignmentTitleAr}»: ${input.scoreTotal} من ${input.totalPoints} نقطة.`,
      destinationUrl: ASSIGNMENTS_URL,
      resourceType: "Assignment",
      resourceId: input.assignmentId,
      eventId: null,
    });
  } catch (error) {
    eventError("notifySubmissionGraded", error);
  }
}

/* ------------------------------------------------------------------ */
/* Follow-ups (المتابعات)                                              */
/*                                                                     */
/* Batch 1 regression fix: the follow-ups module (src/lib/followups/    */
/* service.ts) has always imported these four hooks — they are part    */
/* of the module's public contract and are restored here on top of     */
/* the REAL notification center.                                        */
/*                                                                     */
/* The input is deliberately tolerant (every field optional + index     */
/* signature): the follow-ups service owns the call shapes, and this    */
/* hook reads only the fields it knows, resolving the rest from the    */
/* database when possible. Like every hook here: BEST-EFFORT — a       */
/* failure is logged, never thrown into the business flow.             */
/* ------------------------------------------------------------------ */

export interface FollowUpNotificationInput {
  followUpId?: string;
  id?: string;
  title?: string;
  followUpTitle?: string;
  teacherId?: string;
  teacherName?: string;
  supervisorId?: string;
  supervisorName?: string;
  creatorId?: string;
  creatorName?: string;
  actorId?: string;
  status?: string;
  oldStatus?: string;
  dueAt?: Date | string | null;
  sharedWithIds?: string[];
  sharedWith?: string[];
  // Tolerant index signature: the follow-ups service may pass richer
  // objects — unknown extra fields are ignored, never rejected.
  [key: string]: unknown;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function asOptionalId(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

async function followUpRecipients(
  input: FollowUpNotificationInput
): Promise<{ teacherId: string | null; supervisorId: string | null }> {
  // Explicit ids win; otherwise resolve the follow-up row from the DB.
  let teacherId = asOptionalId(input.teacherId);
  let supervisorId = asOptionalId(input.supervisorId) ?? asOptionalId(input.creatorId);
  const followUpId = asOptionalId(input.followUpId) ?? asOptionalId(input.id);
  if ((!teacherId || !supervisorId) && followUpId) {
    const followUp = await db.followUp.findUnique({
      where: { id: followUpId },
      select: {
        teacherId: true,
        createdById: true,
        assignment: { select: { titleAr: true } },
      },
    });
    if (followUp) {
      teacherId = teacherId ?? followUp.teacherId;
      supervisorId = supervisorId ?? followUp.createdById;
    }
  }
  return { teacherId, supervisorId };
}

function followUpDeepLink(followUpId: string | null): string {
  return followUpId ? `/assignments?followUp=${followUpId}` : ASSIGNMENTS_URL;
}

/** FOLLOW-UP CREATED -> the assigned teacher. */
export async function notifyFollowUpCreated(
  input: FollowUpNotificationInput
): Promise<void> {
  try {
    const { teacherId, supervisorId } = await followUpRecipients(input);
    if (!teacherId || teacherId === supervisorId) return;
    const followUpId = asOptionalId(input.followUpId) ?? asOptionalId(input.id);
    const title = asText(input.title) || asText(input.followUpTitle) || "متابعة جديدة";
    await createNotification({
      userId: teacherId,
      type: "FOLLOW_UP_CREATED",
      category: "ASSIGNMENTS",
      titleAr: "متابعة جديدة مكلف بها",
      bodyAr: `أُنشئت متابعة «${title}» — راجع التفاصيل والموعد المستحق.`,
      destinationUrl: followUpDeepLink(followUpId),
      resourceType: "FollowUp",
      resourceId: followUpId,
      eventId: followUpId ? `FOLLOW_UP_CREATED:${followUpId}` : null,
    });
  } catch (error) {
    eventError("notifyFollowUpCreated", error);
  }
}

/** FOLLOW-UP UPDATED -> the assigned teacher (content/deadline changes). */
export async function notifyFollowUpUpdated(
  input: FollowUpNotificationInput
): Promise<void> {
  try {
    const { teacherId, supervisorId } = await followUpRecipients(input);
    if (!teacherId || teacherId === supervisorId) return;
    const followUpId = asOptionalId(input.followUpId) ?? asOptionalId(input.id);
    const title = asText(input.title) || asText(input.followUpTitle) || "متابعة";
    await createNotification({
      userId: teacherId,
      type: "FOLLOW_UP_UPDATED",
      category: "ASSIGNMENTS",
      titleAr: "تحديث متابعة",
      bodyAr: `حُدّثت متابعة «${title}» — راجع التفاصيل والمرفقات الجديدة.`,
      destinationUrl: followUpDeepLink(followUpId),
      resourceType: "FollowUp",
      resourceId: followUpId,
      eventId: null, // repeated updates are each worth a ping
    });
  } catch (error) {
    eventError("notifyFollowUpUpdated", error);
  }
}

/** FOLLOW-UP STATUS CHANGED -> the teacher AND the supervisor sides. */
export async function notifyFollowUpStatusChanged(
  input: FollowUpNotificationInput
): Promise<void> {
  try {
    const { teacherId, supervisorId } = await followUpRecipients(input);
    const followUpId = asOptionalId(input.followUpId) ?? asOptionalId(input.id);
    const title = asText(input.title) || asText(input.followUpTitle) || "متابعة";
    const status = asText(input.status) || "محدثة";
    const oldStatus = asText(input.oldStatus);
    const statusText = oldStatus ? ` من «${oldStatus}» إلى «${status}»` : ` إلى «${status}»`;

    if (teacherId && teacherId !== supervisorId) {
      await createNotification({
        userId: teacherId,
        type: "FOLLOW_UP_STATUS_CHANGED",
        category: "ASSIGNMENTS",
        titleAr: "تغيير حالة متابعة",
        bodyAr: `تغيّرت حالة متابعة «${title}»${statusText}.`,
        destinationUrl: followUpDeepLink(followUpId),
        resourceType: "FollowUp",
        resourceId: followUpId,
        eventId: null,
      });
    }
    if (supervisorId && supervisorId !== teacherId) {
      await createNotification({
        userId: supervisorId,
        type: "FOLLOW_UP_STATUS_CHANGED",
        category: "ASSIGNMENTS",
        titleAr: "تحديث حالة متابعة",
        bodyAr: `حُدّثت حالة متابعة «${title}»${statusText} — بانتظار مراجعتك عند الحاجة.`,
        destinationUrl: followUpDeepLink(followUpId),
        resourceType: "FollowUp",
        resourceId: followUpId,
        eventId: null,
      });
    }
  } catch (error) {
    eventError("notifyFollowUpStatusChanged", error);
  }
}

/** FOLLOW-UP SHARED -> every explicitly shared recipient. */
export async function notifyFollowUpShared(
  input: FollowUpNotificationInput
): Promise<void> {
  try {
    const followUpId = asOptionalId(input.followUpId) ?? asOptionalId(input.id);
    const title = asText(input.title) || asText(input.followUpTitle) || "متابعة";
    const explicit = Array.isArray(input.sharedWithIds)
      ? input.sharedWithIds.filter((id): id is string => typeof id === "string" && id !== "")
      : [];
    const legacy = Array.isArray(input.sharedWith)
      ? input.sharedWith.filter((id): id is string => typeof id === "string" && id !== "")
      : [];
    const actorId = asOptionalId(input.actorId) ?? asOptionalId(input.creatorId);

    const recipients = [...new Set([...explicit, ...legacy])].filter(
      (id) => id && id !== actorId
    );
    for (const recipientId of recipients) {
      await createNotification({
        userId: recipientId,
        type: "FOLLOW_UP_SHARED",
        category: "ASSIGNMENTS",
        titleAr: "مشاركة متابعة",
        bodyAr: `شارُكت معك متابعة «${title}» — راجع تفاصيلها وحالتها.`,
        destinationUrl: followUpDeepLink(followUpId),
        resourceType: "FollowUp",
        resourceId: followUpId,
        eventId: followUpId ? `FOLLOW_UP_SHARED:${followUpId}:${recipientId}` : null,
      });
    }
  } catch (error) {
    eventError("notifyFollowUpShared", error);
  }
}
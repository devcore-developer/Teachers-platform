import { db } from "@/lib/db";

/* ------------------------------------------------------------------ */
/* Batch 1 — the notification center: ONE real persistence path for     */
/* every platform event (replaces the old mock/demo bell data).         */
/*                                                                      */
/* Design rules:                                                        */
/*   - Recipients are always SERVER-RESOLVED user ids (never names,    */
/*     never client payloads);                                          */
/*   - destinationUrl is an INTERNAL path only (sanitized below);       */
/*   - eventId gives per-recipient idempotency: a repeated event        */
/*     collapses into the original row instead of duplicating;          */
/*   - in-app delivery respects the user's NotificationPreference       */
/*     (the preference row is created on demand — model defaults).      */
/*                                                                      */
/* Batch 2 adds the MESSAGES and GROWTH categories plus the three       */
/* helpers used by messaging, the growth ladder and account security.  */
/* ------------------------------------------------------------------ */

/** Canonical categories the preferences model knows about. */
export const NOTIFICATION_CATEGORIES = [
  "ASSIGNMENTS",
  "COURSES",
  "CERTIFICATES",
  "SURVEYS",
  "MESSAGES",
  "GROWTH",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Canonical event keys written by this module. */
export const NOTIFICATION_TYPES = {
  coursePublished: "COURSE_PUBLISHED",
  courseCompleted: "COURSE_COMPLETED",
  lessonProgress: "COURSE_LESSON_PROGRESS",
  impactSurveyReady: "IMPACT_SURVEY_READY",
  impactResponseReceived: "IMPACT_RESPONSE_RECEIVED",
  messageReceived: "MESSAGE_RECEIVED",
  growthLevelSet: "GROWTH_LEVEL_SET",
  growthPromoted: "GROWTH_PROMOTED",
  passwordResetByAdmin: "PASSWORD_RESET_BY_ADMIN",
} as const;

/** Cap the list payload — the topbar and the page paginate client-side. */
const LIST_LIMIT = 50;
const MAX_BODY_LENGTH = 500;
const MAX_TITLE_LENGTH = 150;

export interface CreateNotificationInput {
  userId: string;
  type: string;
  category: NotificationCategory;
  titleAr: string;
  bodyAr: string;
  /** INTERNAL path ("/...") — built server-side, never client input. */
  destinationUrl?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  eventId?: string | null;
}

export interface CenterNotification {
  id: string;
  type: string;
  category: string;
  titleAr: string;
  bodyAr: string;
  destinationUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}

function sanitizeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null;
  // Internal paths only: must start with a single "/", never "//".
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value.slice(0, 500);
}

function clampText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Ensure the preference row exists, then decide whether in-app delivery
 * is on for this category. Missing row == model defaults (all on).
 */
async function inAppAllowed(
  userId: string,
  category: NotificationCategory
): Promise<boolean> {
  let preference = await db.notificationPreference.findUnique({
    where: { userId },
  });
  if (!preference) {
    preference = await db.notificationPreference.create({
      data: { userId },
    });
  }
  if (!preference.inAppEnabled) return false;
  switch (category) {
    case "ASSIGNMENTS":
      return preference.assignments;
    case "COURSES":
      return preference.courses;
    case "CERTIFICATES":
      return preference.certificates;
    case "SURVEYS":
      return preference.surveys;
    default:
      return true;
  }
}

/**
 * Create one notification. Idempotent per (userId, eventId) — a repeated
 * event collapses silently into the existing row (P2002 is expected).
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<CenterNotification | null> {
  if (!input.userId) return null;
  const allowed = await inAppAllowed(input.userId, input.category);
  if (!allowed) return null;

  const created = await db.notification
    .create({
      data: {
        userId: input.userId,
        type: input.type,
        category: input.category,
        titleAr: clampText(input.titleAr, MAX_TITLE_LENGTH),
        bodyAr: clampText(input.bodyAr, MAX_BODY_LENGTH),
        destinationUrl: sanitizeInternalPath(input.destinationUrl),
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        eventId: input.eventId ?? null,
      },
    })
    .catch((error) => {
      // Duplicate event for this recipient -> keep the original row.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return null;
      }
      throw error;
    });
  return created;
}

/** The owner's notifications, newest first (ownership-filtered). */
export async function listNotifications(
  userId: string,
  limit = LIST_LIMIT
): Promise<CenterNotification[]> {
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(1, limit), 100),
  });
}

export async function unreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

/** Mark every notification of the owner read (bulk, ownership-safe). */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

/**
 * Mark ONE notification read — the WHERE clause carries the owner id,
 * so a foreign id simply matches nothing (no error, no leak).
 */
export async function markNotificationRead(
  userId: string,
  notificationId: string
): Promise<boolean> {
  const result = await db.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

/* ------------------------------------------------------------------ */
/* Event helpers — course lifecycle                                    */
/* ------------------------------------------------------------------ */

/**
 * Course published -> notify every ACTIVE TEACHER of the audience.
 * Platform-wide courses (schoolId null) reach every active teacher;
 * school courses reach that school's teachers only. The deep link
 * carries the REAL course id (never a length or an index).
 */
export async function notifyCoursePublished(input: {
  courseId: string;
  courseTitleAr: string;
  schoolId: string | null;
  actorId: string;
}): Promise<number> {
  const teachers = await db.user.findMany({
    where: {
      role: "TEACHER",
      isActive: true,
      ...(input.schoolId ? { schoolId: input.schoolId } : {}),
    },
    select: { id: true },
  });
  let created = 0;
  for (const teacher of teachers) {
    if (teacher.id === input.actorId) continue;
    const notification = await createNotification({
      userId: teacher.id,
      type: NOTIFICATION_TYPES.coursePublished,
      category: "COURSES",
      titleAr: "تدريب منشور جديد",
      bodyAr: `تم نشر الدورة «${input.courseTitleAr}» — افتح الدورة وابدأ التعلّم.`,
      destinationUrl: `/academy/learn/${input.courseId}`,
      resourceType: "Course",
      resourceId: input.courseId,
      eventId: `COURSE_PUBLISHED:${input.courseId}`,
    });
    if (notification) created += 1;
  }
  return created;
}

/** Course completed -> the teacher's own milestone notification. */
export async function notifyCourseCompleted(input: {
  teacherId: string;
  courseId: string;
  completionId: string;
  certificateId: string | null;
  hours: number | null;
}): Promise<void> {
  const course = await db.course.findUnique({
    where: { id: input.courseId },
    select: { titleAr: true },
  });
  const courseTitle = course?.titleAr ?? "الدورة التدريبية";
  const hoursText = input.hours ? ` (${input.hours} ساعات تدريبية)` : "";
  await createNotification({
    userId: input.teacherId,
    type: NOTIFICATION_TYPES.courseCompleted,
    category: "COURSES",
    titleAr: "إتمام دورة تدريبية 🎉",
    bodyAr: input.certificateId
      ? `أحسنت! أتممت الدورة «${courseTitle}»${hoursText} وصدرت شهادتك — يمكنك عرضها وطباعتها الآن.`
      : `أحسنت! أتممت الدورة «${courseTitle}»${hoursText}. شهادتك قيد التوقيع وستُصدر قريبًا.`,
    destinationUrl: input.certificateId
      ? `/certificates/${input.certificateId}`
      : `/academy/learn/${input.courseId}`,
    resourceType: "CourseCompletion",
    resourceId: input.completionId,
    eventId: `COURSE_COMPLETED:${input.courseId}`,
  });
}

/** Per-lesson progress ping (only when a milestone % is crossed). */
export async function notifyCourseLessonCompleted(input: {
  teacherId: string;
  courseId: string;
  lessonsPercent: number;
}): Promise<void> {
  const milestones = [25, 50, 75, 100];
  if (!milestones.includes(input.lessonsPercent)) return;
  const course = await db.course.findUnique({
    where: { id: input.courseId },
    select: { titleAr: true },
  });
  await createNotification({
    userId: input.teacherId,
    type: NOTIFICATION_TYPES.lessonProgress,
    category: "COURSES",
    titleAr: "تقدم في مسار التعلّم",
    bodyAr: `أكملت ${input.lessonsPercent}% من دروس «${course?.titleAr ?? "الدورة"}» — واصل التقدم.`,
    destinationUrl: `/academy/learn/${input.courseId}`,
    resourceType: "Course",
    resourceId: input.courseId,
    eventId: `COURSE_PROGRESS:${input.courseId}:${input.lessonsPercent}`,
  });
}

/** Impact survey ready -> teacher prompt after completing the course. */
export async function notifyImpactSurveyReady(input: {
  teacherId: string;
  courseId: string;
  surveyId: string;
  courseTitleAr: string;
}): Promise<void> {
  await createNotification({
    userId: input.teacherId,
    type: NOTIFICATION_TYPES.impactSurveyReady,
    category: "SURVEYS",
    titleAr: "قياس أثر التدريب",
    bodyAr: `شاركنا تجربتك: املأ أدوات قياس الأثر للدورة «${input.courseTitleAr}».`,
    destinationUrl: `/academy/learn/${input.courseId}`,
    resourceType: "Survey",
    resourceId: input.surveyId,
    eventId: `IMPACT_READY:${input.surveyId}:${input.teacherId}`,
  });
}

/** Impact response received -> the survey owner is informed. */
export async function notifyImpactResponseReceived(input: {
  ownerUserId: string;
  courseId: string;
  surveyId: string;
  courseTitleAr: string;
  respondentName: string;
}): Promise<void> {
  await createNotification({
    userId: input.ownerUserId,
    type: NOTIFICATION_TYPES.impactResponseReceived,
    category: "SURVEYS",
    titleAr: "استجابة جديدة لقياس الأثر",
    bodyAr: `أ. ${input.respondentName} أرسل قياس الأثر للدورة «${input.courseTitleAr}».`,
    destinationUrl: `/academy/impact`,
    resourceType: "Survey",
    resourceId: input.surveyId,
    eventId: `IMPACT_RESPONSE:${input.surveyId}:${input.courseId}`,
  });
}

/* ------------------------------------------------------------------ */
/* Batch 2 — messaging, growth ladder and account security              */
/* ------------------------------------------------------------------ */

/**
 * Supervisor message received -> the teacher (HTML v38 "إرسال عبر
 * المنصة"). Every message is its own event (eventId null) — messages
 * are never deduplicated.
 */
export async function notifyMessageReceived(input: {
  recipientId: string;
  messageId: string;
  senderName: string;
  typeLabel: string;
  preview: string;
}): Promise<void> {
  await createNotification({
    userId: input.recipientId,
    type: NOTIFICATION_TYPES.messageReceived,
    category: "MESSAGES",
    titleAr: `${input.typeLabel} — من ${input.senderName}`,
    bodyAr: input.preview,
    destinationUrl: `/messages`,
    resourceType: "TeacherMessage",
    resourceId: input.messageId,
    eventId: null,
  });
}

/**
 * Growth level changed -> the teacher. The notification never contains
 * evaluator notes beyond the level itself (HTML parity: alert on the
 * ladder step) and links to the growth view (/reports).
 */
export async function notifyGrowthLevelChanged(input: {
  teacherId: string;
  fromLevel: string;
  toLevel: string;
  kind: "MANUAL" | "PROMOTION";
}): Promise<void> {
  const { growthLevelLabel } = await import("@/config/growth");
  const promoted = input.kind === "PROMOTION";
  await createNotification({
    userId: input.teacherId,
    type: promoted ? NOTIFICATION_TYPES.growthPromoted : NOTIFICATION_TYPES.growthLevelSet,
    category: "GROWTH",
    titleAr: promoted ? "ترقية في المسار المهني 🎉" : "تحديث التصنيف المهني",
    bodyAr: promoted
      ? `تم اعتماد انتقالك المهني إلى ${growthLevelLabel(input.toLevel)} — واصل التقدم.`
      : `حدّث مشرفك التربوي تصنيفك المهني إلى ${growthLevelLabel(input.toLevel)}.`,
    destinationUrl: `/reports`,
    resourceType: "GrowthEvent",
    resourceId: null,
    eventId: null,
  });
}

/**
 * Administrative password reset -> the account owner. The temporary
 * password is NEVER sent through the notification (or email) — the
 * admin who performed the reset reads it once in the UI; this notice
 * only tells the owner their password changed.
 */
export async function notifyPasswordResetByAdmin(input: {
  userId: string;
  actorName: string;
}): Promise<void> {
  await createNotification({
    userId: input.userId,
    type: NOTIFICATION_TYPES.passwordResetByAdmin,
    category: "MESSAGES",
    titleAr: "تم إعادة تعيين كلمة مرورك",
    bodyAr: `أعاد ${input.actorName} تعيين كلمة مرور حسابك. تواصل مع مكتب التطوير للحصول على كلمة المرور المؤقتة، وغيّرها فور الدخول من «أمان الحساب».`,
    destinationUrl: `/account-security`,
    resourceType: "User",
    resourceId: input.userId,
    eventId: null,
  });
}
/**
 * Phase 11 — scheduled reminder scans (idempotent, bounded).
 *
 * Both scans are SAFE TO RUN REPEATEDLY: every notification carries a
 * deterministic eventId, and the DB unique (userId, eventId) collapses
 * replays. Re-running a scan therefore never produces duplicate
 * notifications — it simply becomes a no-op.
 *
 * Scans:
 *  1. Assignment deadline reminders — PUBLISHED assignments whose dueAt
 *     falls inside the next DEADLINE_REMINDER_WINDOW_HOURS. Recipients are
 *     the DB-verified targeted teachers minus anyone who already submitted
 *     (reminding a submitted teacher is spam). One reminder per recipient
 *     per UTC day bucket.
 *  2. Course completions — the platform computes completion on the fly
 *     (every PUBLISHED assessment bound to the course has a PASSED attempt
 *     for that teacher). The scan detects newly-completed pairs and
 *     notifies each exactly once per (teacher, course) lifetime.
 *
 * Triggered only through the secured cron endpoint — never by timers that
 * assume an always-running dev server.
 */

import { db } from "@/lib/db";
import {
  COURSE_COMPLETION_BATCH_LIMIT,
  DEADLINE_REMINDER_BATCH_LIMIT,
  DEADLINE_REMINDER_WINDOW_HOURS,
} from "@/config/notifications";
import { parseJsonIds, isTeacherTargeted } from "@/lib/assignments/access";
import { notify, notifyMany } from "@/lib/notifications/service";
import { formatEmailDate } from "@/lib/integrations/email/templates";

export interface ReminderScanSummary {
  scanned: number;
  notified: number;
  skipped: number;
}

function utcDayBucket(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* 1. Assignment deadline reminders                                    */
/* ------------------------------------------------------------------ */

export async function scanAssignmentDeadlineReminders(now: Date = new Date()): Promise<ReminderScanSummary> {
  const windowEnd = new Date(now.getTime() + DEADLINE_REMINDER_WINDOW_HOURS * 60 * 60 * 1000);

  const assignments = await db.assignment.findMany({
    where: { status: "PUBLISHED", dueAt: { gt: now, lte: windowEnd } },
    select: {
      id: true,
      schoolId: true,
      titleAr: true,
      dueAt: true,
      audienceMode: true,
      targetTeacherIdsJson: true,
      targetBranchIdsJson: true,
    },
    orderBy: { dueAt: "asc" },
    take: DEADLINE_REMINDER_BATCH_LIMIT,
  });

  const summary: ReminderScanSummary = { scanned: assignments.length, notified: 0, skipped: 0 };
  const bucket = utcDayBucket(now);

  for (const assignment of assignments) {
    const targeting = {
      audienceMode: assignment.audienceMode,
      targetTeacherIds: parseJsonIds(assignment.targetTeacherIdsJson),
      targetBranchIds: parseJsonIds(assignment.targetBranchIdsJson),
    };

    // DB-verified targeted, ACTIVE teachers of the owning school.
    const teachers = await db.user.findMany({
      where: { role: "TEACHER", schoolId: assignment.schoolId, isActive: true },
      select: { id: true, branchId: true },
    });
    const targeted = teachers.filter((teacher) => isTeacherTargeted(targeting, teacher));

    // Already-submitted teachers (non-draft) must not be nagged.
    const submissions = await db.assignmentSubmission.findMany({
      where: { assignmentId: assignment.id, teacherId: { in: targeted.map((t) => t.id) } },
      select: { teacherId: true, status: true },
    });
    const submittedIds = new Set(
      submissions.filter((row) => row.status !== "DRAFT" && row.status !== "RETURNED").map((row) => row.teacherId),
    );
    const recipients = targeted.filter((teacher) => !submittedIds.has(teacher.id));
    summary.skipped += targeted.length - recipients.length;
    if (recipients.length === 0) continue;

    const dueText = formatEmailDate(assignment.dueAt);
    const outcome = await notifyMany(
      recipients.map((teacher) => teacher.id),
      {
        type: "ASSIGNMENT_DEADLINE_REMINDER",
        titleAr: "تذكير: موعد تسليم واجب يقترب",
        bodyAr: `موعد تسليم واجب «${assignment.titleAr}» في ${dueText}. لم نستلم تسليمك بعد — يُرجى التقديم قبل انتهاء المهلة.`,
        resourceType: "Assignment",
        resourceId: assignment.id,
        destinationUrl: `/my-assignments/${assignment.id}`,
        eventId: `deadline-reminder:${assignment.id}:${bucket}`,
        email: true,
      },
    );
    summary.notified += outcome.created;
  }

  return summary;
}

/* ------------------------------------------------------------------ */
/* 2. Course completion detection                                      */
/* ------------------------------------------------------------------ */

export async function scanCourseCompletions(now: Date = new Date()): Promise<ReminderScanSummary> {
  // Passed attempts on course-bound PUBLISHED assessments → (user, course) pairs.
  const attempts = await db.assessmentAttempt.findMany({
    where: { status: "PASSED", assessment: { status: "PUBLISHED", courseId: { not: null } } },
    select: { userId: true, assessment: { select: { courseId: true } } },
    orderBy: { updatedAt: "desc" },
    take: 5000,
  });
  const passedPairs = new Set(
    attempts
      .filter((attempt) => attempt.assessment.courseId)
      .map((attempt) => `${attempt.userId}:${attempt.assessment.courseId}`),
  );

  // Active enrollments in PUBLISHED courses.
  const enrollments = await db.courseEnrollment.findMany({
    where: { status: "ACTIVE", course: { status: "PUBLISHED" } },
    select: { userId: true, courseId: true, course: { select: { titleAr: true } } },
    orderBy: { enrolledAt: "desc" },
    take: 5000,
  });

  const completed = enrollments.filter((row) => passedPairs.has(`${row.userId}:${row.courseId}`));
  if (completed.length === 0) {
    return { scanned: enrollments.length, notified: 0, skipped: 0 };
  }

  // Filter out pairs already notified (deterministic eventId per pair).
  const eventIds = completed.map(
    (row) => `course-completed:${row.userId}:${row.courseId}`,
  );
  const existing = new Set<string>();
  const CHUNK = 80;
  for (let index = 0; index < eventIds.length; index += CHUNK) {
    const slice = eventIds.slice(index, index + CHUNK);
    const rows = await db.notification.findMany({
      where: { eventId: { in: slice } },
      select: { eventId: true },
    });
    for (const row of rows) if (row.eventId) existing.add(row.eventId);
  }

  const fresh = completed.filter(
    (row, position) => !existing.has(eventIds[position]),
  );
  const bounded = fresh.slice(0, COURSE_COMPLETION_BATCH_LIMIT);

  let notified = 0;
  for (const row of bounded) {
    const outcome = await notify({
      userId: row.userId,
      type: "COURSE_COMPLETED",
      titleAr: "أحسنت — أكملت مقررًا تدريبيًا",
      bodyAr: `استوفيت جميع متطلبات مقرر «${row.course.titleAr}» وفق قواعد الإكمال المعتمدة. قد تكون مؤهلًا لشهادة إتمام — راجع صفحة النمو المهني.`,
      resourceType: "Course",
      resourceId: row.courseId,
      destinationUrl: `/my-growth`,
      eventId: `course-completed:${row.userId}:${row.courseId}`,
      email: true,
    });
    if (outcome.ok && outcome.created) notified += 1;
  }

  return { scanned: enrollments.length, notified, skipped: completed.length - notified };
}
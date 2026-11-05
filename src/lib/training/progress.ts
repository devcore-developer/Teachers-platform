import { Prisma } from "@prisma/client";

import type { ViewerIdentity } from "@/lib/training/access";
import { canManageTraining } from "@/lib/training/access";
import { db } from "@/lib/db";
import {
  issueCourseCompletionCertificate,
  type CompletionCertificateOutcome,
} from "@/lib/certificates/auto-issue";
import {
  notifyCourseCompleted,
  notifyCourseLessonCompleted,
} from "@/lib/notifications/center";

/* ------------------------------------------------------------------ */
/* Batch 1 — learning progress & course completion.                    */
/*                                                                     */
/* Closes the original HTML platform's learning loop on real data:     */
/*   enroll -> complete every published lesson -> pass every published */
/*   course assessment -> CourseCompletion (hours + best score) ->     */
/*   auto-issued certificate (when a school signatory exists) ->       */
/*   in-app notifications.                                             */
/*                                                                     */
/* Server-side only: the viewer identity always comes from the         */
/* session; every write re-checks course visibility, lesson            */
/* publication and enrollment. Progress marks and completions are      */
/* idempotent through DB unique constraints.                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Result shape (mirrors the training service convention)              */
/* ------------------------------------------------------------------ */

export type ProgressErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ENROLLMENT_REQUIRED"
  | "LESSON_NOT_PUBLISHED"
  | "ALREADY_COMPLETED"
  | "UNKNOWN";

export type ProgressResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      message: string;
      code?: ProgressErrorCode;
    };

function progressFail<T>(
  message: string,
  code: ProgressErrorCode
): ProgressResult<T> {
  return { ok: false, message, code };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/* ------------------------------------------------------------------ */
/* Read model — the full learning status of one viewer on one course   */
/* ------------------------------------------------------------------ */

export interface LessonProgressRow {
  lessonId: string;
  completed: boolean;
  completedAt: Date | null;
}

export interface CourseLearningStatus {
  courseId: string;
  enrolled: boolean;
  /** Published lessons of the course (the requirement pool). */
  totalLessons: number;
  completedLessons: number;
  /** 0..100 — completion of the published-lesson pool. */
  lessonsPercent: number;
  completedLessonIds: string[];
  lessons: LessonProgressRow[];
  /** Published assessments bound to this course. */
  assessments: Array<{
    id: string;
    titleAr: string;
    passingScore: number;
    maxScore: number;
    bestPercentage: number | null;
    passed: boolean | null;
    attemptsUsed: number;
    attemptLimit: number | null;
  }>;
  /** Every published lesson completed AND every published assessment passed. */
  requirementsMet: boolean;
  completion: {
    id: string;
    completedAt: Date;
    totalLessons: number;
    completedLessons: number;
    bestPercentage: number | null;
    hours: number | null;
    certificateId: string | null;
  } | null;
}

/**
 * Full learning status for the course learning page. Visibility rules
 * mirror getCourseForViewer (published + own school or platform-wide;
 * managers may preview their school's non-published courses).
 */
export async function getCourseLearningStatus(
  viewer: ViewerIdentity,
  courseId: string
): Promise<ProgressResult<CourseLearningStatus>> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      status: true,
      schoolId: true,
      estimatedHours: true,
      sections: {
        orderBy: { orderIndex: "asc" },
        select: {
          lessons: {
            where: { isPublished: true },
            orderBy: { orderIndex: "asc" },
            select: { id: true },
          },
        },
      },
      assessments: {
        where: { status: "PUBLISHED" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          titleAr: true,
          passingScore: true,
          maxScore: true,
          attemptLimit: true,
        },
      },
    },
  });
  if (!course) return progressFail("الدورة غير موجودة", "NOT_FOUND");
  const publishedLessons = course.sections.flatMap((section) => section.lessons);

  const managerPreview =
    canManageTraining(viewer.role) &&
    (viewer.role === "SUPER_ADMIN" || course.schoolId === viewer.schoolId);
  const allowed =
    managerPreview ||
    (course.status === "PUBLISHED" &&
      (course.schoolId === null || course.schoolId === viewer.schoolId));
  if (!allowed) {
    return progressFail("هذه الدورة غير متاحة لك", "FORBIDDEN");
  }

  const [progressRows, enrollment, attempts, completion] = await Promise.all([
    db.courseLessonProgress.findMany({
      where: { courseId: course.id, userId: viewer.id },
      select: { lessonId: true, completedAt: true },
    }),
    db.courseEnrollment.findUnique({
      where: { courseId_userId: { courseId: course.id, userId: viewer.id } },
      select: { id: true },
    }),
    db.assessmentAttempt.findMany({
      where: {
        userId: viewer.id,
        assessmentId: {
          in: course.assessments.map((assessment) => assessment.id),
        },
      },
      select: {
        assessmentId: true,
        status: true,
        passed: true,
        percentage: true,
      },
    }),
    db.courseCompletion.findUnique({
      where: { courseId_userId: { courseId: course.id, userId: viewer.id } },
      select: {
        id: true,
        completedAt: true,
        totalLessons: true,
        completedLessons: true,
        bestPercentage: true,
        hours: true,
        certificateId: true,
      },
    }),
  ]);

  const completedAtByLesson = new Map(
    progressRows.map((row) => [row.lessonId, row.completedAt])
  );
  const completedLessonIds = publishedLessons
    .filter((lesson) => completedAtByLesson.has(lesson.id))
    .map((lesson) => lesson.id);

  // Best percentage per assessment across the viewer's attempts
  // (mirrors the manual eligibility engine: passed = flag or status).
  const assessmentRows = course.assessments.map((assessment) => {
    const own = attempts.filter(
      (attempt) => attempt.assessmentId === assessment.id
    );
    const passedAttempts = own.filter(
      (attempt) => attempt.passed === true || attempt.status === "PASSED"
    );
    const bestPercentage = passedAttempts.reduce<number | null>(
      (best, attempt) =>
        attempt.percentage !== null &&
        (best === null || attempt.percentage > best)
          ? attempt.percentage
          : best,
      null
    );
    return {
      id: assessment.id,
      titleAr: assessment.titleAr,
      passingScore: assessment.passingScore,
      maxScore: assessment.maxScore,
      bestPercentage,
      passed: passedAttempts.length > 0,
      attemptsUsed: own.length,
      attemptLimit: assessment.attemptLimit,
    };
  });

  const totalLessons = publishedLessons.length;
  const completedLessons = completedLessonIds.length;
  const allLessonsDone = totalLessons === 0 || completedLessons >= totalLessons;
  const allAssessmentsPassed = assessmentRows.every(
    (assessment) => assessment.passed
  );

  return {
    ok: true,
    data: {
      courseId: course.id,
      enrolled: enrollment !== null,
      totalLessons,
      completedLessons,
      lessonsPercent:
        totalLessons === 0
          ? 100
          : Math.round((completedLessons / totalLessons) * 100),
      completedLessonIds,
      lessons: publishedLessons.map((lesson) => ({
        lessonId: lesson.id,
        completed: completedAtByLesson.has(lesson.id),
        completedAt: completedAtByLesson.get(lesson.id) ?? null,
      })),
      assessments: assessmentRows,
      requirementsMet: allLessonsDone && allAssessmentsPassed,
      completion: completion ?? null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Exam gating — the original HTML rule: no test before the lessons    */
/* ------------------------------------------------------------------ */

export interface LessonGateStatus {
  required: number;
  completed: number;
  percent: number;
  unlocked: boolean;
}

/**
 * Server-side exam gate for course-bound assessments: the attempt can
 * start only after EVERY published lesson of the course is completed
 * (the original HTML v11CanTest rule). Courses without published
 * lessons are vacuously unlocked — the assessment engine keeps its own
 * availability/enrollment/attempt rules on top of this gate.
 */
export async function lessonGateStatus(
  viewer: ViewerIdentity,
  courseId: string
): Promise<LessonGateStatus> {
  const [total, completed] = await Promise.all([
    db.courseLesson.count({
      where: { isPublished: true, section: { courseId } },
    }),
    db.courseLessonProgress.count({
      where: {
        userId: viewer.id,
        lesson: { isPublished: true, section: { courseId } },
      },
    }),
  ]);
  return {
    required: total,
    completed,
    percent: total === 0 ? 100 : Math.round((completed / total) * 100),
    unlocked: completed >= total,
  };
}

/** Rejection message for a locked exam — surfaced verbatim by the
 * assessment service when startAttempt runs before the lessons are done. */
export function lessonGateMessage(gate: LessonGateStatus): string {
  return `أكمل دروس الدورة أولًا قبل إجراء الاختبار — أنجزت ${gate.completed} من ${gate.required} درسًا (${gate.percent}%)`;
}

/* ------------------------------------------------------------------ */
/* Writes — lesson completion                                          */
/* ------------------------------------------------------------------ */

export interface MarkLessonOutcome {
  alreadyCompleted: boolean;
  progressId: string;
  lessonsPercent: number;
  /** Set when this very mark satisfied the whole course. */
  courseCompleted: CourseCompletionOutcome | null;
}

/**
 * Mark one published lesson as completed for the viewer. TEACHERs are
 * auto-enrolled on the first mark (the original HTML "فتح التدريب"
 * behavior — opening the training starts it). Staff viewers
 * (managers/supervisors previewing) never write progress rows.
 */
export async function markLessonComplete(
  viewer: ViewerIdentity,
  courseId: string,
  lessonId: string
): Promise<ProgressResult<MarkLessonOutcome>> {
  const lesson = await db.courseLesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      isPublished: true,
      section: {
        select: {
          courseId: true,
          course: { select: { id: true, status: true, schoolId: true } },
        },
      },
    },
  });
  if (!lesson || lesson.section.courseId !== courseId) {
    return progressFail("الدرس غير موجود في هذه الدورة", "NOT_FOUND");
  }
  const course = lesson.section.course;
  const managerPreview =
    canManageTraining(viewer.role) &&
    (viewer.role === "SUPER_ADMIN" || course.schoolId === viewer.schoolId);
  const visible =
    managerPreview ||
    (course.status === "PUBLISHED" &&
      (course.schoolId === null || course.schoolId === viewer.schoolId));
  if (!visible) {
    return progressFail("هذه الدورة غير متاحة لك", "FORBIDDEN");
  }
  if (!lesson.isPublished) {
    return progressFail("هذا الدرس غير منشور بعد", "LESSON_NOT_PUBLISHED");
  }

  // Only teachers build progress; staff previews never write rows.
  if (viewer.role !== "TEACHER") {
    return progressFail("متابعة تقدم الدروس متاحة للمعلمين فقط", "FORBIDDEN");
  }

  // Auto-enroll on the first interaction (idempotent).
  const enrolled = await db.courseEnrollment.findUnique({
    where: { courseId_userId: { courseId: course.id, userId: viewer.id } },
    select: { id: true },
  });
  if (!enrolled) {
    try {
      await db.courseEnrollment.create({
        data: { courseId: course.id, userId: viewer.id, status: "ACTIVE" },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  const existing = await db.courseLessonProgress.findUnique({
    where: { lessonId_userId: { lessonId: lesson.id, userId: viewer.id } },
    select: { id: true },
  });
  let progressId = existing?.id ?? "";
  let alreadyCompleted = false;
  if (existing) {
    alreadyCompleted = true;
  } else {
    try {
      const created = await db.courseLessonProgress.create({
        data: { courseId: course.id, lessonId: lesson.id, userId: viewer.id },
        select: { id: true },
      });
      progressId = created.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await db.courseLessonProgress.findUnique({
        where: { lessonId_userId: { lessonId: lesson.id, userId: viewer.id } },
        select: { id: true },
      });
      progressId = raced?.id ?? "";
      alreadyCompleted = true;
    }
  }

  const gate = await lessonGateStatus(viewer, course.id);
  if (!alreadyCompleted) {
    await notifyCourseLessonCompleted({
      teacherId: viewer.id,
      courseId: course.id,
      lessonsPercent: gate.percent,
    });
  }

  // Every lesson done -> try to close the course now (a pending
  // assessment may still hold it back; maybeCompleteCourse re-checks).
  const courseCompleted = gate.unlocked
    ? await maybeCompleteCourse(viewer.id, course.id)
    : null;

  return {
    ok: true,
    data: {
      alreadyCompleted,
      progressId,
      lessonsPercent: gate.percent,
      courseCompleted,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Writes — course completion (idempotent, called from two paths)      */
/* ------------------------------------------------------------------ */

export interface CourseCompletionOutcome {
  created: boolean;
  completionId: string;
  hours: number | null;
  bestPercentage: number | null;
  certificate: CompletionCertificateOutcome | null;
  /** Why no certificate exists yet (null when one was issued/linked). */
  certificateBlockedReason: string | null;
}

/**
 * Create the CourseCompletion row when (and only when) the requirements
 * are met: every published lesson completed AND every published course
 * assessment passed. Idempotent — an existing completion short-circuits,
 * and concurrent callers collapse on the unique (courseId, userId)
 * constraint. Called after the last lesson mark and after any PASSED
 * attempt (auto-graded or manually reviewed).
 */
export async function maybeCompleteCourse(
  userId: string,
  courseId: string,
  certifiedById?: string
): Promise<CourseCompletionOutcome | null> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      schoolId: true,
      estimatedHours: true,
      sections: {
        select: {
          lessons: {
            where: { isPublished: true },
            select: { id: true },
          },
        },
      },
      assessments: { where: { status: "PUBLISHED" }, select: { id: true } },
    },
  });
  if (!course) return null;
  const publishedLessonIds = course.sections.flatMap(
    (section) => section.lessons
  );

  const existing = await db.courseCompletion.findUnique({
    where: { courseId_userId: { courseId: course.id, userId } },
    select: {
      id: true,
      hours: true,
      bestPercentage: true,
      certificateId: true,
    },
  });
  if (existing) {
    return {
      created: false,
      completionId: existing.id,
      hours: existing.hours,
      bestPercentage: existing.bestPercentage,
      certificate: existing.certificateId
        ? {
            certificateId: existing.certificateId,
            created: false,
            blockedReason: null,
          }
        : null,
      certificateBlockedReason: existing.certificateId
        ? null
        : "CERTIFICATE_PENDING",
    };
  }

  const [completedCount, attempts] = await Promise.all([
    db.courseLessonProgress.count({
      where: {
        userId,
        lesson: { isPublished: true, section: { courseId: course.id } },
      },
    }),
    db.assessmentAttempt.findMany({
      where: {
        userId,
        assessmentId: {
          in: course.assessments.map((assessment) => assessment.id),
        },
      },
      select: {
        assessmentId: true,
        status: true,
        passed: true,
        percentage: true,
      },
    }),
  ]);

  const totalLessons = publishedLessonIds.length;
  if (totalLessons > 0 && completedCount < totalLessons) return null;

  for (const assessment of course.assessments) {
    const passed = attempts.some(
      (attempt) =>
        attempt.assessmentId === assessment.id &&
        (attempt.status === "PASSED" || attempt.passed === true)
    );
    if (!passed) return null;
  }

  const passedPercentages = attempts
    .filter(
      (attempt) => attempt.status === "PASSED" || attempt.passed === true
    )
    .map((attempt) => attempt.percentage)
    .filter((value): value is number => value !== null);
  const bestPercentage = passedPercentages.length
    ? Math.max(...passedPercentages)
    : null;

  let created: { id: string };
  try {
    created = await db.courseCompletion.create({
      data: {
        courseId: course.id,
        userId,
        courseSchoolId: course.schoolId,
        totalLessons,
        completedLessons: completedCount,
        bestPercentage,
        hours: course.estimatedHours ?? null,
        certifiedById: certifiedById ?? null,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await db.courseCompletion.findUnique({
        where: { courseId_userId: { courseId: course.id, userId } },
        select: { id: true, hours: true, bestPercentage: true },
      });
      return raced
        ? {
            created: false,
            completionId: raced.id,
            hours: raced.hours,
            bestPercentage: raced.bestPercentage,
            certificate: null,
            certificateBlockedReason: "CERTIFICATE_PENDING",
          }
        : null;
    }
    throw error;
  }

  // Auto certificate — best effort: a missing school signatory blocks
  // ONLY the certificate, never the completion itself.
  const certificate = await issueCourseCompletionCertificate({
    teacherId: userId,
    courseId: course.id,
    completionId: created.id,
  });

  if (certificate.certificateId) {
    await db.courseCompletion.update({
      where: { id: created.id },
      data: { certificateId: certificate.certificateId },
    });
  }

  await notifyCourseCompleted({
    teacherId: userId,
    courseId: course.id,
    completionId: created.id,
    certificateId: certificate.certificateId,
    hours: course.estimatedHours ?? null,
  });

  return {
    created: true,
    completionId: created.id,
    hours: course.estimatedHours ?? null,
    bestPercentage,
    certificate: certificate.certificateId
      ? {
          certificateId: certificate.certificateId,
          created: true,
          blockedReason: null,
        }
      : null,
    certificateBlockedReason: certificate.blockedReason,
  };
}
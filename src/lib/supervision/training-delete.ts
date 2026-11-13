/* ------------------------------------------------------------------ */
/* Supervisor training DELETION — the destructive counterpart of the    */
/* unified training editor.                                             */
/*                                                                      */
/* SAFETY MODEL (mirrors the supervision training service rules):       */
/*   1. TENANT FENCE: the course must exist AND belong to the           */
/*      supervisor's own school (schoolId from the SESSION, never the   */
/*      client). Platform-wide courses (schoolId null) and other        */
/*      schools' courses are always rejected fail-closed.               */
/*   2. ONE TRANSACTION: every database row is removed inside a single  */
/*      db.$transaction — either the whole training disappears or      */
/*      nothing changes (no partial deletion is ever visible).          */
/*   3. SCHEMA-ACCURATE (verified against prisma/schema.prisma — no     */
/*      guessing): deleting the Course row cascades (onDelete: Cascade) */
/*      sections -> lessons, lesson attachments, course attachments,    */
/*      enrollments, lesson progress, watch states, completions and     */
/*      comments. BUT exams (Assessment.courseId), impact surveys       */
/*      (Survey.courseId) and certificates (Certificate.courseId) use   */
/*      onDelete: SetNull — they would SURVIVE detached. They are       */
/*      therefore deleted EXPLICITLY BEFORE the course row, inside the  */
/*      same transaction, so their own cascades run too:                */
/*        - Assessment  -> AssessmentQuestion (options + answer key),   */
/*                         AssessmentAttempt (answers, MCQ scores,      */
/*                         essay answers, review scores)                */
/*        - Survey      -> SurveyQuestion, SurveyResponse,              */
/*                         SurveyAnswer, SurveyEvent                    */
/*        - Certificate -> CertificateEvent                             */
/*   4. UNRELATED DATA IS PRESERVED: school records that merely LINK    */
/*      to the course through SetNull keep their history —              */
/*      assignments (with submissions/grades), follow-up visit records, */
/*      surveys also linked to other content, certificates issued for   */
/*      a program (courseId null), TrainingArchive snapshots and        */
/*      append-only audit trails (ArchiveEvent, notifications). Their   */
/*      dangling course FK is nulled by the database itself.            */
/*   5. MEDIA CLEANUP IS REFERENCE-SAFE: storage keys are collected     */
/*      BEFORE the transaction; after it commits, every managed URL     */
/*      goes through releaseMediaIfUnreferenced, which deletes the      */
/*      stored object ONLY when zero rows still reference it — shared   */
/*      objects (e.g. the same URL reused elsewhere) are never          */
/*      destroyed. R2 deletion cannot join the DB transaction (external */
/*      system), so failures are counted, returned to the caller and    */
/*      logged with a stable [training-delete] prefix for the ops trail.*/
/* ------------------------------------------------------------------ */

import type { SupervisorTrainingContext } from "@/lib/auth/dev-admin";
import { db } from "@/lib/db";
import { releaseMediaIfUnreferenced } from "@/lib/media/references";
import { isManagedMediaUrl, publicUrlFor } from "@/lib/media/r2";
import type { SupervisorResult } from "@/lib/supervision/training";

function fail<T>(message: string, code?: string): SupervisorResult<T> {
  return { ok: false, message, code };
}

/** Fail-closed tenant guard — same fence as every other supervisor write. */
async function courseInScopeForDelete(
  ctx: SupervisorTrainingContext,
  courseId: string
): Promise<{ id: string; schoolId: string | null; coverAttachmentId: string | null } | null> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, schoolId: true, coverAttachmentId: true },
  });
  if (!course || course.schoolId === null || course.schoolId !== ctx.schoolId) {
    return null;
  }
  return course;
}

export interface DeleteTrainingSummary {
  id: string;
  /** Rows removed by the explicit pre-course deleteMany calls. */
  assessments: number;
  surveys: number;
  certificates: number;
  /** Rows cascaded with the course (pre-counted for the audit trail). */
  sections: number;
  lessons: number;
  attachments: number;
  enrollments: number;
  completions: number;
  lessonProgress: number;
  watchStates: number;
  comments: number;
  /** Managed media URLs queued for post-commit storage cleanup. */
  mediaQueued: number;
  /** Storage objects that could NOT be removed after the commit. */
  mediaCleanupFailures: number;
}

/**
 * Permanently delete ONE training course of the supervisor's own school
 * with all of its dependent data. The confirmation word ("DELETE") is a
 * CLIENT-side safeguard; this service re-verifies the only things that
 * matter server-side: an authenticated supervisor session and course
 * ownership inside the session's school.
 */
export async function deleteSupervisorTraining(
  ctx: SupervisorTrainingContext,
  courseId: string
): Promise<SupervisorResult<DeleteTrainingSummary>> {
  const course = await courseInScopeForDelete(ctx, courseId);
  if (!course) {
    return fail("التدريب غير موجود أو خارج نطاق مدرستك — العملية مرفوضة", "FORBIDDEN");
  }

  /* ---------------- Pre-reads (outside the transaction) ------------- */
  /* Lesson ids + managed video URLs — lesson video attachments carry
   * lessonId with a NULL courseId, so the lesson branch is REQUIRED to
   * catch every media object of this training. */
  const lessonRows = await db.courseLesson.findMany({
    where: { section: { courseId: course.id } },
    select: { id: true, videoUrl: true },
  });
  const lessonIds = lessonRows.map((lesson) => lesson.id);

  const attachmentRows = await db.attachment.findMany({
    where: {
      OR: [
        { courseId: course.id },
        { lessonId: { in: lessonIds } },
        ...(course.coverAttachmentId ? [{ id: course.coverAttachmentId }] : []),
      ],
    },
    select: { id: true, storageKey: true },
  });

  const [sectionsCount, enrollmentsCount, completionsCount, progressCount, watchCount, commentsCount] =
    await Promise.all([
      db.courseSection.count({ where: { courseId: course.id } }),
      db.courseEnrollment.count({ where: { courseId: course.id } }),
      db.courseCompletion.count({ where: { courseId: course.id } }),
      db.courseLessonProgress.count({ where: { courseId: course.id } }),
      db.lessonWatchState.count({ where: { courseId: course.id } }),
      db.courseComment.count({ where: { courseId: course.id } }),
    ]);

  /* Managed media URLs behind this training — resolved to URLs so the
   * shared release helper can re-count references after the commit. */
  const mediaUrls = new Set<string>();
  for (const attachment of attachmentRows) {
    mediaUrls.add(publicUrlFor(attachment.storageKey));
  }
  for (const lesson of lessonRows) {
    if (lesson.videoUrl && isManagedMediaUrl(lesson.videoUrl)) {
      mediaUrls.add(lesson.videoUrl);
    }
  }

  /* ---------------- The deletion transaction ------------------------ */
  /* Order is deliberate: the SetNull-bound owners are removed FIRST
   * (while their courseId still points at this course), then the course
   * row itself fans the remaining Cascade relations out. */
  let deletedAssessments = 0;
  let deletedSurveys = 0;
  let deletedCertificates = 0;

  await db.$transaction(async (tx) => {
    // 1) Exams bound to this training — questions, options, answer keys,
    //    attempts, MCQ scores, essay answers and review grades all die
    //    with their own cascades (AssessmentQuestion/Attempt Cascade).
    const assessments = await tx.assessment.deleteMany({
      where: { courseId: course.id, schoolId: ctx.schoolId },
    });
    deletedAssessments = assessments.count;

    // 2) The impact-measurement tool bound EXCLUSIVELY to this training.
    //    Surveys also linked to other content (program/lesson/assignment/
    //    certificate) survive untouched — the course FK nulls itself.
    const surveys = await tx.survey.deleteMany({
      where: {
        courseId: course.id,
        schoolId: ctx.schoolId,
        programId: null,
        lessonId: null,
        assignmentId: null,
        certificateId: null,
      },
    });
    deletedSurveys = surveys.count;

    // 3) Certificates issued FOR this training (CourseCompletion.certificateId
    //    is SetNull — completions are cascaded away by the course below).
    const certificates = await tx.certificate.deleteMany({
      where: { courseId: course.id, schoolId: ctx.schoolId },
    });
    deletedCertificates = certificates.count;

    // 4) The course row — cascades sections -> lessons, lesson + course
    //    attachments, enrollments, lesson progress, watch states,
    //    completions and comments (all onDelete: Cascade in the schema).
    await tx.course.delete({ where: { id: course.id } });
  });

  /* ---------------- Post-commit storage cleanup --------------------- */
  /* Best-effort and reference-safe: an object is removed only when no
   * row references its URL anymore. Failures never invalidate the
   * committed deletion — they are counted, returned and logged so the
   * maintenance sweep / ops trail can pick them up. */
  let mediaCleanupFailures = 0;
  for (const url of mediaUrls) {
    try {
      await releaseMediaIfUnreferenced(url);
    } catch (error) {
      mediaCleanupFailures += 1;
      console.error(`[training-delete] media cleanup failed for ${url}`, error);
    }
  }

  const summary: DeleteTrainingSummary = {
    id: course.id,
    assessments: deletedAssessments,
    surveys: deletedSurveys,
    certificates: deletedCertificates,
    sections: sectionsCount,
    lessons: lessonIds.length,
    attachments: attachmentRows.length,
    enrollments: enrollmentsCount,
    completions: completionsCount,
    lessonProgress: progressCount,
    watchStates: watchCount,
    comments: commentsCount,
    mediaQueued: mediaUrls.size,
    mediaCleanupFailures,
  };

  console.log(
    `[training-delete] course ${course.id} deleted by supervisor ${ctx.id} ` +
      `(school ${ctx.schoolId}) — assessments:${deletedAssessments} surveys:${deletedSurveys} ` +
      `certificates:${deletedCertificates} sections:${sectionsCount} lessons:${lessonIds.length} ` +
      `attachments:${attachmentRows.length} enrollments:${enrollmentsCount} media:${mediaUrls.size} ` +
      `mediaFailures:${mediaCleanupFailures}`
  );

  return { ok: true, data: summary };
}
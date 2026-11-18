// ======================================================================
// src/lib/schools/delete.ts  (ملف جديد)
// ======================================================================
/* ------------------------------------------------------------------ */
/* SCHOOL DELETION — the destructive counterpart of the schools module. */
/*                                                                      */
/* SAFETY MODEL (mirrors lib/supervision/training-delete.ts):           */
/*   1. AUTHORIZATION: requireAdminContext() resolves the actor from    */
/*      the DB session; ONLY ctx.role === "SUPER_ADMIN" may proceed.    */
/*      Office/school managers are rejected even for their OWN school — */
/*      whole-tenant deletion is a platform-owner decision. The typed   */
/*      school name in the dialog is a CLIENT-side safeguard; this      */
/*      service re-verifies the only thing that matters server-side.    */
/*   2. ONE TRANSACTION: every database row is removed inside a single  */
/*      db.$transaction (60s timeout — a tenant wipe touches far more   */
/*      rows than a single course). Either the whole school disappears  */
/*      or nothing changes (no partial deletion is ever visible).       */
/*   3. SCHEMA-ACCURATE (verified against prisma/schema.prisma — no     */
/*      guessing). The School row is blocked by six onDelete: Restrict  */
/*      relations, so the order below removes every blocker BEFORE the  */
/*      school row, each one while its own cascades still fire:         */
/*        Restrict on School: Branch, User, TrainingProgram, Course,    */
/*                            Assessment, Certificate                  */
/*        Restrict on User (the school's accounts): Attachment,         */
/*                            Assessment.createdBy/Attempt.user,        */
/*                            Program/Course/Assessment .createdBy,     */
/*                            Certificate.teacher/issuedBy,             */
/*                            Survey.owner, FollowUp teacher/supervisor/ */
/*                            createdBy, Assignment.createdBy,          */
/*                            AssignmentSubmission.teacher              */
/*      Hence the deliberate order: assessments → certificates →        */
/*      followUps → surveys → assignments → programs → courses →        */
/*      leftover attachments → archive/email bookkeeping → USERS →      */
/*      BRANCHES → school. SetNull side-effects (Course.programId,      */
/*      *.courseId, User.branchId, User.registrationLinkId, actor       */
/*      columns …) only ever touch rows that are already gone or are    */
/*      being deleted in the same transaction.                          */
/*   4. PLATFORM-WIDE CONTENT SURVIVES: rows with schoolId null         */
/*      (shared programs/courses/assessments, platform archives) are    */
/*      never matched by the deleteMany filters.                        */
/*   5. STORAGE CLEANUP IS BEST-EFFORT AND REFERENCE-SAFE: managed R2   */
/*      URLs (school logo, lesson videos, course/lesson/program         */
/*      attachments + covers) are collected BEFORE the transaction and  */
/*      released AFTER it commits via releaseMediaIfUnreferenced — an    */
/*      object is deleted only when zero rows still reference it, so    */
/*      shared media (the same logo/video reused elsewhere) survives.   */
/*      Submission files live on LOCAL DISK (assignments/storage.ts),   */
/*      not R2 — their keys are collected too and unlinked after the    */
/*      commit. Neither storage system can join the DB transaction;     */
/*      failures are counted, returned and logged with a stable         */
/*      [school-delete] prefix for the ops trail.                       */
/* ------------------------------------------------------------------ */

import { Prisma } from "@prisma/client";

import { deleteSubmissionObject } from "@/lib/assignments/storage";
import { requireAdminContext, type AdminContext } from "@/lib/auth/dev-admin";
import { db } from "@/lib/db";
import { releaseMediaIfUnreferenced } from "@/lib/media/references";
import { isManagedMediaUrl, publicUrlFor } from "@/lib/media/r2";
import type { ServiceResult } from "@/lib/validation/schools";

/** What was removed — returned to the caller for feedback + ops trail. */
export interface SchoolDeletionSummary {
  id: string;
  nameAr: string;
  branches: number;
  /** Accounts that lived in the school (never SUPER_ADMIN — it has none). */
  users: number;
  registrationLinks: number;
  trainingPrograms: number;
  courses: number;
  assessments: number;
  assignments: number;
  certificates: number;
  surveys: number;
  followUps: number;
  /** TrainingArchive snapshots scoped to this school (plain column, no FK). */
  archiveSnapshots: number;
  /** EmailDelivery queue/audit rows scoped to this school (plain column). */
  emailDeliveries: number;
  /** Managed media URLs queued for post-commit storage cleanup. */
  mediaQueued: number;
  /** Local submission files queued for post-commit unlink. */
  submissionFilesQueued: number;
  /** Storage objects that could NOT be removed after the commit. */
  storageCleanupFailures: number;
}

/**
 * Permanently delete ONE school with ALL of its dependent data. The
 * platform keeps everything schoolId-null (platform-wide programs,
 * courses, assessments, archives) untouched.
 */
export async function deleteSchool(
  schoolId: string,
  actor?: AdminContext
): Promise<ServiceResult<SchoolDeletionSummary>> {
  const ctx = actor ?? (await requireAdminContext());
  if (ctx.role !== "SUPER_ADMIN") {
    return {
      ok: false,
      message: "حذف المدارس متاح لمدير المنصة فقط",
      code: "FORBIDDEN",
    };
  }

  if (!schoolId) {
    return { ok: false, message: "معرّف المدرسة مطلوب", code: "VALIDATION_ERROR" };
  }

  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    return { ok: false, message: "المدرسة غير موجودة", code: "NOT_FOUND" };
  }

  /* ---------------- Pre-reads (outside the transaction) ------------- */
  /* Ids and media references must be collected BEFORE any delete so the
   * post-commit cleanup knows exactly what to release. */

  const schoolUserRows = await db.user.findMany({
    where: { schoolId, role: { not: "SUPER_ADMIN" } },
    select: { id: true },
  });
  const schoolUserIds = schoolUserRows.map((row) => row.id);

  const courseRows = await db.course.findMany({
    where: { schoolId },
    select: { id: true, coverAttachmentId: true },
  });
  const courseIds = courseRows.map((row) => row.id);

  const programRows = await db.trainingProgram.findMany({
    where: { schoolId },
    select: { id: true, coverAttachmentId: true },
  });
  const programIds = programRows.map((row) => row.id);

  const lessonRows = await db.courseLesson.findMany({
    where: { section: { courseId: { in: courseIds } } },
    select: { id: true, videoUrl: true },
  });
  const lessonIds = lessonRows.map((lesson) => lesson.id);

  /* Superset query: school courses/lessons/programs attachments + covers
   * + anything a school user ever uploaded (the User Restrict blocker). */
  const attachmentRows = await db.attachment.findMany({
    where: {
      OR: [
        { courseId: { in: courseIds } },
        { lessonId: { in: lessonIds } },
        { programId: { in: programIds } },
        { uploadedById: { in: schoolUserIds } },
        ...courseRows
          .filter((row) => row.coverAttachmentId)
          .map((row) => ({ id: row.coverAttachmentId as string })),
        ...programRows
          .filter((row) => row.coverAttachmentId)
          .map((row) => ({ id: row.coverAttachmentId as string })),
      ],
    },
    select: { id: true, storageKey: true },
  });

  const submissionFileRows = await db.submissionFile.findMany({
    where: { submission: { assignment: { schoolId } } },
    select: { storageKey: true },
  });

  const [
    branchesCount,
    registrationLinksCount,
    programsCount,
    coursesCount,
    assessmentsCount,
    assignmentsCount,
    certificatesCount,
    surveysCount,
    followUpsCount,
    archiveSnapshotsCount,
    emailDeliveriesCount,
  ] = await Promise.all([
    db.branch.count({ where: { schoolId } }),
    db.registrationLink.count({ where: { schoolId } }),
    db.trainingProgram.count({ where: { schoolId } }),
    db.course.count({ where: { schoolId } }),
    db.assessment.count({ where: { schoolId } }),
    db.assignment.count({ where: { schoolId } }),
    db.certificate.count({ where: { schoolId } }),
    db.survey.count({ where: { schoolId } }),
    db.followUp.count({ where: { schoolId } }),
    db.trainingArchive.count({ where: { schoolId } }),
    db.emailDelivery.count({ where: { schoolId } }),
  ]);

  /* Managed media URLs behind this school — resolved to URLs so the
   * shared release helper can re-count references after the commit. */
  const mediaUrls = new Set<string>();
  if (school.logoUrl && isManagedMediaUrl(school.logoUrl)) {
    mediaUrls.add(school.logoUrl);
  }
  for (const lesson of lessonRows) {
    if (lesson.videoUrl && isManagedMediaUrl(lesson.videoUrl)) {
      mediaUrls.add(lesson.videoUrl);
    }
  }
  for (const attachment of attachmentRows) {
    mediaUrls.add(publicUrlFor(attachment.storageKey));
  }

  /* ---------------- The deletion transaction ------------------------ */
  /* Order is deliberate — see the safety model above. Every step deletes
   * the owner rows while their own onDelete: Cascade relations still
   * fire, so children (questions, attempts, submissions, responses,
   * events, rubric scores, submission files, …) never survive detached. */
  try {
    await db.$transaction(
      async (tx) => {
        // 1) School-owned exams — questions, options, answer keys,
        //    attempts and review scores die with their own cascades
        //    (also clears the User Restrict from attempts + createdBy).
        await tx.assessment.deleteMany({ where: { schoolId } });

        // 2) School-owned certificates — CertificateEvent cascades;
        //    CourseCompletion.certificateId / Survey.certificateId are
        //    SetNull and their owners are deleted below anyway.
        await tx.certificate.deleteMany({ where: { schoolId } });

        // 3) Follow-up visits — FollowUpEvent cascades; the three
        //    User Restrict anchors (teacher/supervisor/creator) are
        //    cleared before the users themselves.
        await tx.followUp.deleteMany({ where: { schoolId } });

        // 4) Impact surveys — questions, responses, answers and events
        //    cascade; Survey.owner (User Restrict) is cleared first.
        await tx.survey.deleteMany({ where: { schoolId } });

        // 5) Assignments — rubric criteria, submissions, files,
        //    revisions and rubric scores cascade; clears the
        //    Submission.teacher / createdBy User Restrict anchors.
        await tx.assignment.deleteMany({ where: { schoolId } });

        // 6) Training programs — program attachments cascade; courses
        //    lose their programId via SetNull (they are deleted next).
        await tx.trainingProgram.deleteMany({ where: { schoolId } });

        // 7) Academy courses — sections -> lessons, course + lesson
        //    attachments, enrollments, lesson progress, watch states,
        //    completions and comments all cascade (same behavior the
        //    supervisor training delete relies on).
        await tx.course.deleteMany({ where: { schoolId } });

        // 8) Yearly archive snapshots scoped to this school — plain
        //    schoolId column (no FK), so deleted explicitly.
        await tx.trainingArchive.deleteMany({ where: { schoolId } });

        // 9) Email queue/audit rows scoped to this school — plain
        //    schoolId column (no FK), so deleted explicitly.
        await tx.emailDelivery.deleteMany({ where: { schoolId } });

        // 10) Leftover attachments uploaded by school users (defensive:
        //     everything course/lesson/program-bound already cascaded in
        //     steps 6-7). Attachment.uploadedBy is User Restrict — this
        //     MUST run before the users themselves.
        if (schoolUserIds.length > 0) {
          await tx.attachment.deleteMany({
            where: { uploadedById: { in: schoolUserIds } },
          });
        }

        // 11) The school's accounts. Every remaining Restrict-to-User
        //     relation was cleared above; everything else is Cascade
        //     (tokens, enrollments, progress, notifications, messages,
        //     growth events …) or SetNull (actor / reviewer columns).
        //     SUPER_ADMIN never has a schoolId — the role filter is
        //     defense in depth.
        if (schoolUserIds.length > 0) {
          await tx.user.deleteMany({
            where: { schoolId, role: { not: "SUPER_ADMIN" } },
          });
        }

        // 12) Branches — the last Restrict blocker before the school row.
        //     Their user/assignment relations are already gone or Cascade.
        await tx.branch.deleteMany({ where: { schoolId } });

        // 13) The school row — remaining direct relations
        //     (SupervisorAssignment, DeputyGrant,
        //     TeacherSupervisorAssignment, RegistrationLink,
        //     ArchiveEvent) are onDelete: Cascade and now find nothing
        //     or only rows bound to die with them.
        await tx.school.delete({ where: { id: schoolId } });
      },
      // A tenant wipe touches far more rows than a single-course delete;
      // give the interactive transaction real headroom (default is 5s).
      { timeout: 60_000, maxWait: 10_000 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      // A foreign key we did not map rejected the deletion — fail closed
      // instead of leaving a half-deleted tenant behind.
      console.error(`[school-delete] FK violation while deleting school ${schoolId}`, error);
      return {
        ok: false,
        message:
          "تعذر حذف المدرسة — توجد بيانات مرتبطة غير متوقعة. لم يُحذف أي شيء، وتم تسجيل التفاصيل للمراجعة.",
        code: "RELATION_ERROR",
      };
    }
    return { ok: false, message: "تعذر حذف المدرسة — حدث خطأ غير متوقع" };
  }

  /* ---------------- Post-commit storage cleanup --------------------- */
  /* Best-effort: R2 objects are released reference-safe (a URL still
   * referenced by another school's lesson/logo survives); submission
   * files are unlinked from local disk. Failures never invalidate the
   * committed deletion — they are counted, returned and logged. */
  let storageCleanupFailures = 0;
  for (const url of mediaUrls) {
    try {
      await releaseMediaIfUnreferenced(url);
    } catch (error) {
      storageCleanupFailures += 1;
      console.error(`[school-delete] media cleanup failed for ${url}`, error);
    }
  }
  for (const key of submissionFileRows.map((row) => row.storageKey)) {
    try {
      await deleteSubmissionObject(key);
    } catch (error) {
      storageCleanupFailures += 1;
      console.error(`[school-delete] submission file cleanup failed for ${key}`, error);
    }
  }

  const summary: SchoolDeletionSummary = {
    id: school.id,
    nameAr: school.nameAr,
    branches: branchesCount,
    users: schoolUserIds.length,
    registrationLinks: registrationLinksCount,
    trainingPrograms: programsCount,
    courses: coursesCount,
    assessments: assessmentsCount,
    assignments: assignmentsCount,
    certificates: certificatesCount,
    surveys: surveysCount,
    followUps: followUpsCount,
    archiveSnapshots: archiveSnapshotsCount,
    emailDeliveries: emailDeliveriesCount,
    mediaQueued: mediaUrls.size,
    submissionFilesQueued: submissionFileRows.length,
    storageCleanupFailures,
  };

  console.log(
    `[school-delete] school ${school.id} (${school.nameAr}) deleted by admin ${ctx.id} — ` +
      `branches:${branchesCount} users:${schoolUserIds.length} programs:${programsCount} ` +
      `courses:${coursesCount} assessments:${assessmentsCount} assignments:${assignmentsCount} ` +
      `certificates:${certificatesCount} surveys:${surveysCount} followUps:${followUpsCount} ` +
      `media:${mediaUrls.size} submissionFiles:${submissionFileRows.length} ` +
      `storageFailures:${storageCleanupFailures}`
  );

  return { ok: true, data: summary };
}
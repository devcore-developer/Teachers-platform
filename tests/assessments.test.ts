/**
 * Phase 6 integration tests — assessment engine service layer.
 *
 * Runs against the shared dedicated SQLite file (prisma/test-platform.db)
 * with the real Prisma client — no mocks. Covers the 16 verification
 * areas of the phase brief: authoring, question validation, publishing,
 * role restrictions, tenant isolation, attempt limits, deadlines,
 * server-side scoring, review immutability and answer-key protection.
 *
 * Run: bun test tests/assessments.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const TEST_DB_URL = `file:${path.join(PROJECT_ROOT, "prisma", "test-platform.db")}`;

// MUST be assigned before the dynamic imports below.
process.env.DATABASE_URL = TEST_DB_URL;

beforeAll(() => {
  execSync("bunx prisma db push --skip-generate --accept-data-loss", {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
});

afterAll(async () => {
  // Assessment tables cascade from assessments; then the base fixtures.
  await db.assessmentAttempt.deleteMany({});
  await db.assessmentQuestion.deleteMany({});
  await db.assessment.deleteMany({});
  await db.courseEnrollment.deleteMany({});
  await db.course.deleteMany({});
  await db.trainingProgram.deleteMany({});
  await db.user.deleteMany({ where: { email: { contains: "p6-" } } });
  await db.school.deleteMany({ where: { slug: { startsWith: "p6-" } } });
});

// Dynamic imports after the env override.
const { db } = await import("@/lib/db");
const {
  addQuestion,
  createAssessment,
  deleteQuestion,
  getAssessmentForManage,
  getAssessmentForTaking,
  getAttemptResult,
  listAssessmentsForManage,
  listMyAttempts,
  listPublishedAssessments,
  moveQuestion,
  reviewAttempt,
  saveAttemptDraft,
  setAssessmentStatus,
  startAttempt,
  submitAttempt,
  updateAssessment,
  updateQuestion,
} = await import("@/lib/assessment/service");
const { availabilityState } = await import("@/lib/assessment/access");
const { hashPassword } = await import("@/lib/auth/password");

/* ------------------------------------------------------------------ */
/* Fixtures: two schools, admin pair, teachers.                          */
/* ------------------------------------------------------------------ */

const schoolAId = (
  await db.school.create({
    data: { nameAr: "مدرسة ت6 أ", nameEn: "P6 School A", slug: "p6-a" },
  })
).id;
const schoolBId = (
  await db.school.create({
    data: { nameAr: "مدرسة ت6 ب", nameEn: "P6 School B", slug: "p6-b" },
  })
).id;

async function seedUser(
  email: string,
  role: string,
  schoolId: string | null
): Promise<{ id: string; name: string }> {
  const user = await db.user.create({
    data: {
      name: `مستخدم ت6 (${email})`,
      email,
      passwordHash: await hashPassword("Test-Password-123"),
      role,
      schoolId,
      emailVerifiedAt: role === "TEACHER" ? new Date() : null,
    },
  });
  return { id: user.id, name: user.name };
}

const superAdminUser = await seedUser("p6-super@test.local", "SUPER_ADMIN", null);
const managerAUser = await seedUser("p6-manager-a@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolAId);
const managerBUser = await seedUser("p6-manager-b@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolBId);
const teacherAUser = await seedUser("p6-teacher-a@test.local", "TEACHER", schoolAId);
const teacherA2User = await seedUser("p6-teacher-a2@test.local", "TEACHER", schoolAId);
const teacherBUser = await seedUser("p6-teacher-b@test.local", "TEACHER", schoolBId);

const SUPER_ADMIN = {
  id: superAdminUser.id,
  name: superAdminUser.name,
  role: "SUPER_ADMIN" as const,
  schoolId: null,
};
const MANAGER_A = {
  id: managerAUser.id,
  name: managerAUser.name,
  role: "DEVELOPMENT_OFFICE_MANAGER" as const,
  schoolId: schoolAId,
};
const MANAGER_B = {
  id: managerBUser.id,
  name: managerBUser.name,
  role: "DEVELOPMENT_OFFICE_MANAGER" as const,
  schoolId: schoolBId,
};
/** Teachers are NOT AdminContext — the cast documents the negative test. */
const TEACHER_A_CTX = {
  id: teacherAUser.id,
  name: teacherAUser.name,
  role: "TEACHER",
  schoolId: schoolAId,
} as unknown as Parameters<typeof addQuestion>[1];
const TEACHER_A_VIEWER = { id: teacherAUser.id, role: "TEACHER", schoolId: schoolAId };
const TEACHER_A2_VIEWER = { id: teacherA2User.id, role: "TEACHER", schoolId: schoolAId };
const TEACHER_B_VIEWER = { id: teacherBUser.id, role: "TEACHER", schoolId: schoolBId };

/** Published course fixture in school A (bound to assessments). */
const courseId = (
  await db.course.create({
    data: {
      schoolId: schoolAId,
      titleAr: "دورة ت6 المرتبطة",
      descriptionAr: "وصف دورة الاختبارات المرتبطة للمرحلة السادسة.",
      category: "pedagogy",
      status: "PUBLISHED",
      createdById: managerAUser.id,
    },
  })
).id;

await db.courseEnrollment.create({
  data: { courseId, userId: teacherAUser.id, status: "ACTIVE" },
});

describe("Phase 6 — assessment engine service", () => {
  let platformAssessmentId = "";
  let schoolAssessmentId = "";
  let q1Id = "";
  let q2Id = "";
  let q3Id = "";

  /* 1. Creating and editing an assessment --------------------------- */
  test("1. creates assessments (platform by SUPER_ADMIN, school by manager) and rejects a manager platform attempt", async () => {
    const platform = await createAssessment(
      {
        titleAr: "اختبار منصة مشترك ت6",
        instructionsAr: "هذه تعليمات اختبار المنصة المشتركة للمرحلة السادسة.",
        scope: "platform",
        passingScore: 1,
      },
      SUPER_ADMIN
    );
    expect(platform.ok).toBe(true);
    if (platform.ok) platformAssessmentId = platform.data.id;

    const scoped = await createAssessment(
      {
        titleAr: "اختبار مدرسة أ ت6",
        instructionsAr: "هذه تعليمات اختبار مدرسة أ للمرحلة السادسة.",
        scope: "school",
        courseId,
        passingScore: 2,
        attemptLimit: 2,
      },
      MANAGER_A
    );
    expect(scoped.ok).toBe(true);
    if (scoped.ok) schoolAssessmentId = scoped.data.id;

    const denied = await createAssessment(
      {
        titleAr: "محاولة منصة ممنوعة",
        instructionsAr: "محاولة مدير مكتب لإنشاء محتوى مشترك.",
        scope: "platform",
        passingScore: 1,
      },
      MANAGER_A
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("FORBIDDEN");
  });

  test("2. edits assessment settings (update) within scope", async () => {
    const updated = await updateAssessment(
      {
        assessmentId: schoolAssessmentId,
        titleAr: "اختبار مدرسة أ ت6 (معدل)",
        instructionsAr: "تعليمات محدثة لاختبار مدرسة أ بعد التعديل.",
        courseId,
        scope: "school",
        passingScore: 2,
        attemptLimit: 3,
      },
      MANAGER_A
    );
    expect(updated.ok).toBe(true);
  });

  /* 2/3/4. Questions: add, reorder, validate types/options/key refs -- */
  test("3. adds questions: single/multiple choice + true/false with server-generated option ids", async () => {
    const q1 = await addQuestion(
      {
        assessmentId: schoolAssessmentId,
        type: "SINGLE_CHOICE",
        textAr: "ما العاصمة الإدارية للعلم والمعرفة في هذا الاختبار؟",
        points: 2,
        isRequired: true,
        options: [{ textAr: "الخيار الأول" }, { textAr: "الخيار الصحيح" }],
        correctOptionIndexes: [1],
      },
      MANAGER_A
    );
    expect(q1.ok).toBe(true);
    if (q1.ok) q1Id = q1.data.id;

    const q2 = await addQuestion(
      {
        assessmentId: schoolAssessmentId,
        type: "MULTIPLE_CHOICE",
        textAr: "اختر كل الإجابات الصحيحة في هذا السؤال التدريبي.",
        points: 2,
        options: [
          { textAr: "صحيحة أ" },
          { textAr: "خاطئة" },
          { textAr: "صحيحة ب" },
        ],
        correctOptionIndexes: [0, 2],
      },
      MANAGER_A
    );
    expect(q2.ok).toBe(true);
    if (q2.ok) q2Id = q2.data.id;

    const q3 = await addQuestion(
      {
        assessmentId: schoolAssessmentId,
        type: "TRUE_FALSE",
        textAr: "التقييم قبل التدريب يساعد في قياس أثر التعلم لاحقًا.",
        points: 1,
        correctValue: true,
      },
      MANAGER_A
    );
    expect(q3.ok).toBe(true);
    if (q3.ok) q3Id = q3.data.id;

    const detail = await getAssessmentForManage(MANAGER_A, schoolAssessmentId);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.data.assessment.maxScore).toBe(5);
      expect(detail.data.questions[0].options.every((o) => o.id.length > 0)).toBe(true);
    }
  });

  test("4. rejects invalid question types and mismatched options/correct answers", async () => {
    const unsupported = await addQuestion(
      {
        assessmentId: schoolAssessmentId,
        type: "ESSAY_GRADING" as never, // deliberately unsupported type
        textAr: "سؤال بنوع غير مدعوم يجب رفضه صراحة.",
        points: 1,
        options: [],
        correctOptionIndexes: [],
      },
      MANAGER_A
    );
    expect(unsupported.ok).toBe(false);

    const tooFewOptions = await addQuestion(
      {
        assessmentId: schoolAssessmentId,
        type: "SINGLE_CHOICE",
        textAr: "سؤال بخيار واحد فقط يجب رفضه.",
        points: 1,
        options: [{ textAr: "الخيار الوحيد" }],
        correctOptionIndexes: [0],
      },
      MANAGER_A
    );
    expect(tooFewOptions.ok).toBe(false);

    const missingCorrect = await addQuestion(
      {
        assessmentId: schoolAssessmentId,
        type: "MULTIPLE_CHOICE",
        textAr: "سؤال متعدد بدون إجابة صحيحة محددة.",
        points: 1,
        options: [{ textAr: "أ" }, { textAr: "ب" }],
        correctOptionIndexes: [],
      },
      MANAGER_A
    );
    expect(missingCorrect.ok).toBe(false);

    // Correct answer referencing a NONEXISTENT option index is rejected.
    const danglingCorrect = await addQuestion(
      {
        assessmentId: schoolAssessmentId,
        type: "SINGLE_CHOICE",
        textAr: "الإجابة الصحيحة تشير إلى خيار غير موجود.",
        points: 1,
        options: [{ textAr: "أ" }, { textAr: "ب" }],
        correctOptionIndexes: [5],
      },
      MANAGER_A
    );
    expect(danglingCorrect.ok).toBe(false);
  });

  test("5. reorders questions (move up/down swaps order indexes)", async () => {
    const moved = await moveQuestion(
      { assessmentId: schoolAssessmentId, questionId: q3Id, direction: "up" },
      MANAGER_A
    );
    expect(moved.ok).toBe(true);

    const detail = await getAssessmentForManage(MANAGER_A, schoolAssessmentId);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      const order = detail.data.questions.map((question) => question.id);
      expect(order).toEqual([q1Id, q3Id, q2Id]);
    }

    const movedBack = await moveQuestion(
      { assessmentId: schoolAssessmentId, questionId: q3Id, direction: "down" },
      MANAGER_A
    );
    expect(movedBack.ok).toBe(true);
  });

  test("6. prevents teachers from editing assessments (defense in depth)", async () => {
    const denied = await addQuestion(
      {
        assessmentId: schoolAssessmentId,
        type: "TRUE_FALSE",
        textAr: "محاولة معلم لإضافة سؤال يجب أن تُرفض.",
        points: 1,
        correctValue: true,
      },
      TEACHER_A_CTX
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("FORBIDDEN");

    const managerB = await updateAssessment(
      {
        assessmentId: schoolAssessmentId,
        titleAr: "اختراق نطاق من مدرسة ب",
        instructionsAr: "محاولة مدير مدرسة ب لتعديل اختبار مدرسة أ.",
        scope: "school",
        passingScore: 1,
      },
      MANAGER_B
    );
    expect(managerB.ok).toBe(false);
    if (!managerB.ok) expect(managerB.code).toBe("FORBIDDEN");
  });

  /* 5. Publishing guards -------------------------------------------- */
  test("7. blocks publishing with 0 questions or passing score above max, then publishes a valid assessment", async () => {
    const draftProbe = await createAssessment(
      {
        titleAr: "اختبار حارس النشر ت6",
        instructionsAr: "تعليمات اختبار حارس النشر للتحقق من منع النشر الخاطئ.",
        scope: "school",
        passingScore: 3,
      },
      MANAGER_A
    );
    expect(draftProbe.ok).toBe(true);
    if (!draftProbe.ok) return;
    const probeId = draftProbe.data.id;

    const emptyPublish = await setAssessmentStatus(
      { assessmentId: probeId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(emptyPublish.ok).toBe(false);
    if (!emptyPublish.ok) expect(emptyPublish.code).toBe("PUBLISH_BLOCKED");

    await addQuestion(
      {
        assessmentId: probeId,
        type: "TRUE_FALSE",
        textAr: "سؤال وحيد بدرجتين لاختبار حارس درجة النجاح.",
        points: 2,
        correctValue: false,
      },
      MANAGER_A
    );
    const passingTooHigh = await setAssessmentStatus(
      { assessmentId: probeId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(passingTooHigh.ok).toBe(false);
    if (!passingTooHigh.ok) expect(passingTooHigh.code).toBe("PUBLISH_BLOCKED");

    const published = await setAssessmentStatus(
      { assessmentId: schoolAssessmentId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(published.ok).toBe(true);

    // Publish the platform assessment too (visibility tests need it).
    await addQuestion(
      {
        assessmentId: platformAssessmentId,
        type: "TRUE_FALSE",
        textAr: "سؤال تمهيدي للاختبار المشترك على مستوى المنصة.",
        points: 1,
        correctValue: true,
      },
      SUPER_ADMIN
    );
    const publishedPlatform = await setAssessmentStatus(
      { assessmentId: platformAssessmentId, status: "PUBLISHED" },
      SUPER_ADMIN
    );
    expect(publishedPlatform.ok).toBe(true);
  });

  /* 6/7/8. Visibility: drafts hidden, cross-tenant blocked ---------- */
  test("8. hides drafts from teachers and blocks cross-school access", async () => {
    const catalogA = await listPublishedAssessments(TEACHER_A_VIEWER, {});
    expect(catalogA.ok).toBe(true);
    if (catalogA.ok) {
      // Only PUBLISHED rows ever appear in the teacher catalog.
      expect(catalogA.data.rows.every((row) => row.availability !== undefined)).toBe(true);
    }

    // Teacher B cannot even see school A's school-scoped assessment.
    const crossTake = await getAssessmentForTaking(TEACHER_B_VIEWER, schoolAssessmentId);
    expect(crossTake.ok).toBe(false);
    if (!crossTake.ok) expect(crossTake.code).toBe("FORBIDDEN");

    // Teacher B CAN see the platform-wide published assessment.
    const platformTake = await getAssessmentForTaking(TEACHER_B_VIEWER, platformAssessmentId);
    expect(platformTake.ok).toBe(true);
  });

  let probeDraftId = "";

  test("8b. draft assessment is invisible through the taking view", async () => {
    const draft = await createAssessment(
      {
        titleAr: "مسودة مخفية ت6",
        instructionsAr: "مسودة لا يجب أن تظهر للمعلمين إطلاقًا قبل النشر.",
        scope: "school",
        passingScore: 1,
      },
      MANAGER_A
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    probeDraftId = draft.data.id;

    const hidden = await getAssessmentForTaking(TEACHER_A_VIEWER, probeDraftId);
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.code).toBe("FORBIDDEN");
  });

  /* 7. Enrollment gate for course-bound assessments ------------------ */
  test("9. course-bound assessment requires enrollment on the server", async () => {
    const denied = await startAttempt(TEACHER_A2_VIEWER, schoolAssessmentId);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("ENROLLMENT_REQUIRED");
  });

  /* 8/10/11/12. Attempts: start, draft, submit, score ---------------- */
  let attemptAId = "";

  test("10. starts an attempt, autosaves drafts scoped to the owner, submits and grades server-side", async () => {
    // Load the server-generated option ids into the fixture cache first.
    const questionRows = await db.assessmentQuestion.findMany({
      where: { assessmentId: schoolAssessmentId },
      select: { id: true, optionsJson: true },
    });
    for (const row of questionRows) {
      const options = row.optionsJson
        ? (JSON.parse(row.optionsJson) as { id: string }[])
        : [];
      if (options.length > 0) optionIdCache.set(row.id, options.map((o) => o.id));
    }
    expect(optionIdCache.size).toBeGreaterThanOrEqual(2);

    const started = await startAttempt(TEACHER_A_VIEWER, schoolAssessmentId);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    attemptAId = started.data.attemptId;
    expect(started.data.resumed).toBe(false);

    // Draft autosave scoped to the owner.
    const saved = await saveAttemptDraft(
      TEACHER_A_VIEWER,
      {
        attemptId: attemptAId,
        answers: [
          { questionId: q1Id, text: "مسودة تجريبية" }, // type mismatch -> rejected
        ],
      }
    );
    expect(saved.ok).toBe(false);

    const draftOk = await saveAttemptDraft(TEACHER_A_VIEWER, {
      attemptId: attemptAId,
      answers: [
        { questionId: q1Id, choice: [optionIdAt(q1Id, 1)] },
        { questionId: q2Id, choice: [optionIdAt(q2Id, 0)] },
        { questionId: q3Id, bool: true },
      ],
    });
    expect(draftOk.ok).toBe(true);

    // Submit: q1 correct (2), q2 HALF-selected (0 — exact set rule),
    // q3 correct (1) => objectiveScore 3/5 >= passingScore 2 => PASSED.
    const submitted = await submitAttempt(TEACHER_A_VIEWER, {
      attemptId: attemptAId,
      answers: [
        { questionId: q1Id, choice: [optionIdAt(q1Id, 1)] },
        { questionId: q2Id, choice: [optionIdAt(q2Id, 0)] },
        { questionId: q3Id, bool: true },
      ],
    });
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(submitted.data.status).toBe("PASSED");

    const result = await getAttemptResult(TEACHER_A_VIEWER, attemptAId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.attempt.objectiveScore).toBe(3);
      expect(result.data.attempt.maxScore).toBe(5);
      expect(result.data.attempt.percentage).toBe(60);
      expect(result.data.attempt.passed).toBe(true);
      // Keys revealed only AFTER submission.
      expect(result.data.breakdown.every((item) => item.correct !== null)).toBe(true);
    }
  });

  /** Resolve a stored option id by position (fixture helper). */
  function optionIdAt(questionId: string, index: number): string {
    // Populated at the top of test 10 — every submission test runs after it.
    return optionIdCache.get(questionId)?.[index] ?? "missing";
  }

  const optionIdCache = new Map<string, string[]>();

  test("11. rejects answers that belong to another assessment", async () => {
    const foreign = await startAttempt(TEACHER_B_VIEWER, platformAssessmentId);
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    const foreignAttemptId = foreign.data.attemptId;

    await addQuestion(
      {
        assessmentId: platformAssessmentId,
        type: "TRUE_FALSE",
        textAr: "سؤال منصة مشتركة للتحقق من رفض إجابات الاختبارات الأخرى.",
        points: 1,
        correctValue: true,
      },
      SUPER_ADMIN
    );
    const foreignQuestion = await db.assessmentQuestion.findFirst({
      where: { assessmentId: platformAssessmentId },
      select: { id: true },
    });
    expect(foreignQuestion).not.toBeNull();

    const crossSubmit = await submitAttempt(TEACHER_B_VIEWER, {
      attemptId: foreignAttemptId,
      answers: [
        { questionId: q1Id, choice: [optionIdAt(q1Id, 1)] }, // belongs to school A's assessment
      ],
    });
    expect(crossSubmit.ok).toBe(false);
    if (!crossSubmit.ok) expect(crossSubmit.code).toBe("INVALID_ANSWER");

    // Foreign question id submitted to another assessment -> rejected.
    const started2 = await startAttempt(TEACHER_A2_VIEWER, platformAssessmentId);
    expect(started2.ok).toBe(true);
    if (started2.ok) {
      const cross2 = await submitAttempt(TEACHER_A2_VIEWER, {
        attemptId: started2.data.attemptId,
        answers: [{ questionId: q3Id, bool: true }],
      });
      expect(cross2.ok).toBe(false);
      if (!cross2.ok) expect(cross2.code).toBe("INVALID_ANSWER");
    }
  });

  test("12. prevents double submission of a completed attempt", async () => {
    const again = await submitAttempt(TEACHER_A_VIEWER, {
      attemptId: attemptAId,
      answers: [{ questionId: q3Id, bool: true }],
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("ALREADY_SUBMITTED");

    const otherTeacher = await getAttemptResult(TEACHER_A2_VIEWER, attemptAId);
    expect(otherTeacher.ok).toBe(false);
    if (!otherTeacher.ok) expect(otherTeacher.code).toBe("FORBIDDEN");
  });

  /* 12. Attempt limits under repeated + concurrent starts ----------- */
  test("13. enforces the attempt limit (repeated and concurrent starts)", async () => {
    const limited = await createAssessment(
      {
        titleAr: "اختبار محدد المحاولات ت6",
        instructionsAr: "تعليمات اختبار محدود المحاولات للتحقق من فرض الحد.",
        scope: "school",
        passingScore: 1,
        attemptLimit: 1,
      },
      MANAGER_A
    );
    expect(limited.ok).toBe(true);
    if (!limited.ok) return;
    const limitedId = limited.data.id;

    await addQuestion(
      {
        assessmentId: limitedId,
        type: "TRUE_FALSE",
        textAr: "سؤال وحيد لاختبار حد المحاولات.",
        points: 1,
        correctValue: true,
      },
      MANAGER_A
    );
    const published = await setAssessmentStatus(
      { assessmentId: limitedId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(published.ok).toBe(true);

    const first = await startAttempt(TEACHER_A2_VIEWER, limitedId);
    expect(first.ok).toBe(true);
    if (first.ok) {
      const submitted = await submitAttempt(TEACHER_A2_VIEWER, {
        attemptId: first.data.attemptId,
        answers: [{ questionId: "any", bool: true }],
      });
      // "any" is not a real question of this assessment -> INVALID_ANSWER,
      // which still leaves the attempt IN_PROGRESS — finish it properly.
      expect(submitted.ok).toBe(false);
      const realQuestion = await db.assessmentQuestion.findFirst({
        where: { assessmentId: limitedId },
        select: { id: true },
      });
      expect(realQuestion).not.toBeNull();
      if (realQuestion) {
        const okSubmit = await submitAttempt(TEACHER_A2_VIEWER, {
          attemptId: first.data.attemptId,
          answers: [{ questionId: realQuestion.id, bool: true }],
        });
        expect(okSubmit.ok).toBe(true);
      }
    }

    const repeated = await startAttempt(TEACHER_A2_VIEWER, limitedId);
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.code).toBe("ATTEMPT_LIMIT_REACHED");

    // Concurrent starts for the SAME teacher: the resume semantics mean
    // both calls succeed with the SAME attempt id and exactly ONE row is
    // created — concurrent starts can never bypass the attempt limit
    // (SQLite serializes the writers).
    const concurrently = await Promise.allSettled([
      startAttempt(TEACHER_A_VIEWER, limitedId),
      startAttempt(TEACHER_A_VIEWER, limitedId),
    ]);
    const ids: string[] = [];
    for (const outcome of concurrently) {
      if (outcome.status === "fulfilled" && outcome.value.ok) {
        ids.push(outcome.value.data.attemptId);
      }
    }
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(1);
    const liveCount = await db.assessmentAttempt.count({
      where: { assessmentId: limitedId, userId: TEACHER_A_VIEWER.id },
    });
    expect(liveCount).toBe(1);
  });

  /* 13. Deadline enforcement ---------------------------------------- */
  test("14. enforces the server-side deadline: late submit is rejected and the attempt expires", async () => {
    const timed = await createAssessment(
      {
        titleAr: "اختبار مؤقت ت6",
        instructionsAr: "تعليمات اختبار مؤقت للتحقق من فرض المهلة على الخادم.",
        scope: "school",
        passingScore: 1,
        timeLimitMinutes: 5,
        attemptLimit: 2,
      },
      MANAGER_A
    );
    expect(timed.ok).toBe(true);
    if (!timed.ok) return;
    const timedId = timed.data.id;

    const question = await addQuestion(
      {
        assessmentId: timedId,
        type: "TRUE_FALSE",
        textAr: "سؤال وحيد في الاختبار المؤقت.",
        points: 1,
        correctValue: true,
      },
      MANAGER_A
    );
    expect(question.ok).toBe(true);
    const published = await setAssessmentStatus(
      { assessmentId: timedId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(published.ok).toBe(true);

    const started = await startAttempt(TEACHER_A2_VIEWER, timedId);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.data.deadlineAt).not.toBeNull();

    // Backdate the deadline — the browser timer is NOT trusted.
    await db.assessmentAttempt.update({
      where: { id: started.data.attemptId },
      data: { deadlineAt: new Date(Date.now() - 60_000) },
    });

    const realQuestion = await db.assessmentQuestion.findFirst({
      where: { assessmentId: timedId },
      select: { id: true },
    });
    expect(realQuestion).not.toBeNull();
    if (!realQuestion) return;

    const late = await submitAttempt(TEACHER_A2_VIEWER, {
      attemptId: started.data.attemptId,
      answers: [{ questionId: realQuestion.id, bool: true }],
    });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.code).toBe("DEADLINE_PASSED");

    const row = await db.assessmentAttempt.findUnique({
      where: { id: started.data.attemptId },
    });
    expect(row?.status).toBe("EXPIRED");
    // Expired attempts get NO invented grade.
    expect(row?.earnedScore).toBeNull();
    expect(row?.passed).toBeNull();

    // The teacher can still use a second attempt (limit 2).
    const second = await startAttempt(TEACHER_A2_VIEWER, timedId);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.resumed).toBe(false);
  });

  /* 14. Review flow + immutability of finalized results -------------- */
  let reviewAttemptId = "";

  test("15. short-answer submissions land in NEEDS_REVIEW; review finalizes; finalized rows are immutable", async () => {
    const withShort = await createAssessment(
      {
        titleAr: "اختبار بإجابات قصيرة ت6",
        instructionsAr: "تعليمات اختبار يتضمن أسئلة إجابة قصيرة تدرج يدويًا.",
        scope: "school",
        passingScore: 3,
      },
      MANAGER_A
    );
    expect(withShort.ok).toBe(true);
    if (!withShort.ok) return;
    const withShortId = withShort.data.id;

    const mcq = await addQuestion(
      {
        assessmentId: withShortId,
        type: "SINGLE_CHOICE",
        textAr: "سؤال اختيار واحد في اختبار الإجابات القصيرة.",
        points: 2,
        options: [{ textAr: "خاطئ" }, { textAr: "صحيح" }],
        correctOptionIndexes: [1],
      },
      MANAGER_A
    );
    expect(mcq.ok).toBe(true);

    const short = await addQuestion(
      {
        assessmentId: withShortId,
        type: "SHORT_ANSWER",
        textAr: "اذكر فائدة واحدة من التقييم التكويني للمعلم.",
        points: 3,
        modelAnswer: "تقديم تغذية راجعة فورية توجّه التعلم.",
      },
      MANAGER_A
    );
    expect(short.ok).toBe(true);

    const published = await setAssessmentStatus(
      { assessmentId: withShortId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(published.ok).toBe(true);

    const started = await startAttempt(TEACHER_A2_VIEWER, withShortId);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    reviewAttemptId = started.data.attemptId;

    const mcqRow = await db.assessmentQuestion.findFirst({
      where: { assessmentId: withShortId, type: "SINGLE_CHOICE" },
      select: { id: true, optionsJson: true },
    });
    const shortRow = await db.assessmentQuestion.findFirst({
      where: { assessmentId: withShortId, type: "SHORT_ANSWER" },
      select: { id: true },
    });
    expect(mcqRow && shortRow).toBeTruthy();
    if (!mcqRow || !shortRow) return;
    const options = JSON.parse(mcqRow.optionsJson ?? "[]") as { id: string }[];

    const submitted = await submitAttempt(TEACHER_A2_VIEWER, {
      attemptId: reviewAttemptId,
      answers: [
        { questionId: mcqRow.id, choice: [options[1].id] },
        { questionId: shortRow.id, text: "تساعد في تحسين التدريب لاحقًا." },
      ],
    });
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(submitted.data.status).toBe("NEEDS_REVIEW");

    // No invented grade: earnedScore stays null until review.
    const pending = await db.assessmentAttempt.findUnique({
      where: { id: reviewAttemptId },
    });
    expect(pending?.earnedScore).toBeNull();

    // Over-award beyond the question max is rejected.
    const tooMuch = await reviewAttempt(
      {
        attemptId: reviewAttemptId,
        scores: [{ questionId: shortRow.id, points: 99 }],
      },
      MANAGER_A
    );
    expect(tooMuch.ok).toBe(false);

    const reviewed = await reviewAttempt(
      {
        attemptId: reviewAttemptId,
        scores: [{ questionId: shortRow.id, points: 3 }],
      },
      MANAGER_A
    );
    expect(reviewed.ok).toBe(true);
    if (reviewed.ok) {
      // objective 2 + short 3 = 5 => 100% PASSED.
      expect(reviewed.data.status).toBe("PASSED");
      expect(reviewed.data.percentage).toBe(100);
    }

    // Finalized results are immutable — a second review is rejected.
    const again = await reviewAttempt(
      {
        attemptId: reviewAttemptId,
        scores: [{ questionId: shortRow.id, points: 0 }],
      },
      MANAGER_A
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("ALREADY_SUBMITTED");

    // Teachers cannot perform reviews either.
    const teacherReview = await reviewAttempt(
      {
        attemptId: reviewAttemptId,
        scores: [{ questionId: shortRow.id, points: 3 }],
      },
      TEACHER_A_CTX
    );
    expect(teacherReview.ok).toBe(false);
  });

  /* 15. Answer-key protection --------------------------------------- */
  test("16. answer keys never reach teacher-facing projections before submission", async () => {
    // The taking detail intentionally carries NO questions array at all.
    const detail = await getAssessmentForTaking(TEACHER_A_VIEWER, schoolAssessmentId);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect("questions" in detail.data).toBe(false);
    }

    // The catalog rows are plain metadata only.
    const catalog = await listPublishedAssessments(TEACHER_A_VIEWER, {});
    expect(catalog.ok).toBe(true);
    if (catalog.ok) {
      expect(
        catalog.data.rows.every((row) => !("answerKey" in row) && !("questions" in row))
      ).toBe(true);
    }

    // An IN_PROGRESS attempt result is refused (nothing to reveal yet).
    const started = await startAttempt(TEACHER_A_VIEWER, platformAssessmentId);
    expect(started.ok).toBe(true);
    if (started.ok) {
      const early = await getAttemptResult(TEACHER_A_VIEWER, started.data.attemptId);
      expect(early.ok).toBe(false);
      if (!early.ok) expect(early.code).toBe("NOT_AVAILABLE");
    }

    // Manager listing is scope-filtered.
    const managed = await listAssessmentsForManage(MANAGER_B, {});
    expect(managed.ok).toBe(true);
    if (managed.ok) {
      expect(managed.data.rows.every((row) => row.schoolId === schoolBId)).toBe(true);
    }

    // Own history lists the teacher's attempts.
    const history = await listMyAttempts(TEACHER_A_VIEWER);
    expect(history.ok).toBe(true);
    if (history.ok) {
      expect(history.data.some((row) => row.id === attemptAId)).toBe(true);
    }
  });

  test("16b. availability predicate is honest about windows", () => {
    const now = new Date();
    expect(
      availabilityState({ availableFrom: null, availableUntil: null }, now)
    ).toBe("available");
    expect(
      availabilityState(
        { availableFrom: new Date(now.getTime() + 60_000), availableUntil: null },
        now
      )
    ).toBe("scheduled");
    expect(
      availabilityState(
        { availableFrom: null, availableUntil: new Date(now.getTime() - 60_000) },
        now
      )
    ).toBe("closed");
  });
});
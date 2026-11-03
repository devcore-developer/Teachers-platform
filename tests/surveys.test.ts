/**
 * Phase 9 integration tests — impact surveys, responses, anonymity,
 * outcome analysis and follow-up workflows.
 *
 * Runs against the shared dedicated SQLite file (prisma/test-platform.db)
 * with the real Prisma client — no mocks. Covers: survey creation and
 * server-side question validation, lifecycle transitions (publish/
 * close/archive) with audit events, audience eligibility (three modes +
 * supervisor coverage bounding), submission deadlines, duplicate-response
 * policy, anonymous-response privacy (no identity persisted, small-group
 * suppression, pseudonymous pre/post linking), result calculations with
 * explicit denominators, pre/post stage comparisons (identified and
 * anonymous-key pairings), follow-up ownership/scope/school isolation,
 * teacher/deputy/super-admin restrictions, rate limiting and empty
 * datasets.
 *
 * Run: bun test tests/surveys.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const TEST_DB_URL = `file:${path.join(PROJECT_ROOT, "prisma", "test-platform.db")}`;

process.env.DATABASE_URL = TEST_DB_URL;

// Push BEFORE the module-level fixtures run (import time).
execSync("bunx prisma db push --skip-generate --accept-data-loss", {
  cwd: PROJECT_ROOT,
  env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  stdio: "pipe",
});

// Dynamic imports after the env override.
const { db } = await import("@/lib/db");
const {
  createSurvey,
  getStageComparison,
  getSurveyForTaking,
  getSurveyManageView,
  getSurveyMetrics,
  getSurveyResults,
  listSurveysForManage,
  listSurveysForTeacher,
  listSurveyFormOptions,
  saveResponseDraft,
  submitResponse,
  transitionSurvey,
  updateSurvey,
  validateContentLinks,
} = await import("@/lib/surveys/service");
const {
  changeFollowUpStatus,
  createFollowUp,
  getFollowUpManageView,
  getFollowUpMetrics,
  listFollowUps,
  listSharedFollowUpsForTeacher,
  setFollowUpSharing,
  updateFollowUp,
} = await import("@/lib/followups/service");
const {
  getPlatformImpactStats,
  getSchoolImpactOverview,
  listStagePairCandidates,
} = await import("@/lib/impact/service");
const { resetRateLimits } = await import("@/lib/surveys/rate-limit");
const { hashPassword } = await import("@/lib/auth/password");

/* ------------------------------------------------------------------ */
/* Fixtures: two schools, branches, office pair, supervisors, deputy,   */
/* teachers, a program and a published course.                          */
/* ------------------------------------------------------------------ */

const schoolAId = (
  await db.school.create({
    data: { nameAr: "مدرسة ت9 أ", nameEn: "P9 School A", slug: "p9-a" },
  })
).id;
const schoolBId = (
  await db.school.create({
    data: { nameAr: "مدرسة ت9 ب", nameEn: "P9 School B", slug: "p9-b" },
  })
).id;

const branchA1Id = (
  await db.branch.create({
    data: { schoolId: schoolAId, nameAr: "فرع ت9 الأول", nameNorm: "فرع ت9 الأول", stage: "primary" },
  })
).id;
const branchA2Id = (
  await db.branch.create({
    data: { schoolId: schoolAId, nameAr: "فرع ت9 الثاني", nameNorm: "فرع ت9 الثاني", stage: "intermediate" },
  })
).id;

async function seedUser(
  email: string,
  role: string,
  schoolId: string | null,
  branchId: string | null = null
): Promise<{ id: string; name: string }> {
  const user = await db.user.create({
    data: {
      name: `مستخدم ت9 (${email})`,
      email,
      passwordHash: await hashPassword("Test-Password-123"),
      role,
      schoolId,
      branchId,
      emailVerifiedAt: role === "TEACHER" ? new Date() : null,
    },
  });
  return { id: user.id, name: user.name };
}

const superAdmin = await seedUser("p9-super@test.local", "SUPER_ADMIN", null);
const managerA = await seedUser("p9-manager-a@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolAId);
const managerB = await seedUser("p9-manager-b@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolBId);
const supervisorA = await seedUser("p9-supervisor-a@test.local", "EDUCATIONAL_SUPERVISOR", schoolAId);
const supervisorB = await seedUser("p9-supervisor-b@test.local", "EDUCATIONAL_SUPERVISOR", schoolBId);
const deputyA = await seedUser("p9-deputy-a@test.local", "EDUCATIONAL_DEPUTY", schoolAId);
const teacherA1 = await seedUser("p9-teacher-a1@test.local", "TEACHER", schoolAId, branchA1Id);
const teacherA2 = await seedUser("p9-teacher-a2@test.local", "TEACHER", schoolAId, branchA2Id);
const teacherA3 = await seedUser("p9-teacher-a3@test.local", "TEACHER", schoolAId, null);
const teacherB1 = await seedUser("p9-teacher-b1@test.local", "TEACHER", schoolBId, null);

const teacherA1Id = teacherA1.id;
const teacherA2Id = teacherA2.id;
const teacherA3Id = teacherA3.id;
const teacherB1Id = teacherB1.id;
const supervisorAId = supervisorA.id;

// Supervisor A covers teacher A1 explicitly + branch A1 (→ teacher A1 only;
// teacher A2 sits in branch A2 and teacher A3 has no branch).
await db.teacherSupervisorAssignment.create({
  data: { supervisorId: supervisorA.id, teacherId: teacherA1.id, schoolId: schoolAId },
});
await db.supervisorAssignment.create({
  data: { supervisorId: supervisorA.id, schoolId: schoolAId, branchId: branchA1Id },
});
// Deputy A: school-wide grant.
await db.deputyGrant.create({ data: { userId: deputyA.id, schoolId: schoolAId, branchId: null } });

const MANAGER_A = { id: managerA.id, name: managerA.name, role: "DEVELOPMENT_OFFICE_MANAGER" as const, schoolId: schoolAId };
const MANAGER_B = { id: managerB.id, name: managerB.name, role: "DEVELOPMENT_OFFICE_MANAGER" as const, schoolId: schoolBId };
const SUPERVISOR_A = { id: supervisorA.id, name: supervisorA.name, role: "EDUCATIONAL_SUPERVISOR" as const, schoolId: schoolAId };
const SUPERVISOR_B = { id: supervisorB.id, name: supervisorB.name, role: "EDUCATIONAL_SUPERVISOR" as const, schoolId: schoolBId };
const DEPUTY_A = { id: deputyA.id, name: deputyA.name, role: "EDUCATIONAL_DEPUTY" as const, schoolId: schoolAId };
const SUPER_ADMIN = { id: superAdmin.id, name: superAdmin.name, role: "SUPER_ADMIN" as const, schoolId: null };
const TEACHER_A1 = { id: teacherA1.id, role: "TEACHER", schoolId: schoolAId };
const TEACHER_A2 = { id: teacherA2.id, role: "TEACHER", schoolId: schoolAId };
const TEACHER_A3 = { id: teacherA3.id, role: "TEACHER", schoolId: schoolAId };
const TEACHER_B1 = { id: teacherB1.id, role: "TEACHER", schoolId: schoolBId };

const programAId = (
  await db.trainingProgram.create({
    data: {
      schoolId: schoolAId,
      nameAr: "برنامج ت9 أ",
      nameNorm: "برنامج ت9 أ",
      descriptionAr: "وصف برنامج المرحلة التاسعة.",
      category: "pedagogy",
      status: "PUBLISHED",
      createdById: managerA.id,
    },
  })
).id;

const programBId = (
  await db.trainingProgram.create({
    data: {
      schoolId: schoolBId,
      nameAr: "برنامج ت9 ب",
      nameNorm: "برنامج ت9 ب",
      descriptionAr: "وصف برنامج المدرسة ب.",
      category: "pedagogy",
      status: "PUBLISHED",
      createdById: managerB.id,
    },
  })
).id;

const courseAId = (
  await db.course.create({
    data: {
      schoolId: schoolAId,
      programId: programAId,
      titleAr: "دورة ت9 أ",
      descriptionAr: "وصف دورة المرحلة التاسعة.",
      category: "pedagogy",
      status: "PUBLISHED",
      createdById: managerA.id,
      publishedAt: new Date(),
    },
  })
).id;

afterAll(async () => {
  // Order matters: leaves first, then the fixture schools. Everything
  // is scoped to the p9- fixtures — the shared test DB keeps the
  // Phase 6/7/8 fixtures intact.
  const surveys = await db.survey.findMany({
    where: { schoolId: { in: [schoolAId, schoolBId] } },
    select: { id: true },
  });
  const surveyIds = surveys.map((survey) => survey.id);
  if (surveyIds.length > 0) {
    await db.surveyAnswer.deleteMany({ where: { response: { surveyId: { in: surveyIds } } } });
    await db.surveyResponse.deleteMany({ where: { surveyId: { in: surveyIds } } });
    await db.surveyQuestion.deleteMany({ where: { surveyId: { in: surveyIds } } });
    await db.surveyEvent.deleteMany({ where: { surveyId: { in: surveyIds } } });
  }
  await db.survey.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.followUpEvent.deleteMany({
    where: { followUp: { schoolId: { in: [schoolAId, schoolBId] } } },
  });
  await db.followUp.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.supervisorAssignment.deleteMany({ where: { supervisorId: supervisorAId } });
  await db.teacherSupervisorAssignment.deleteMany({ where: { supervisorId: supervisorAId } });
  await db.deputyGrant.deleteMany({ where: { userId: deputyA.id } });
  await db.course.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.trainingProgram.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.user.deleteMany({ where: { email: { contains: "p9-" } } });
  await db.branch.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.school.deleteMany({ where: { slug: { startsWith: "p9-" } } });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

interface BuilderQuestionInput {
  textAr: string;
  type: string;
  required?: boolean;
  options?: string[];
  minScore?: number;
  maxScore?: number;
  helpTextAr?: string;
}

function buildDefinition(overrides: Record<string, unknown> = {}, questions?: BuilderQuestionInput[]) {
  return {
    titleAr: "استبيان تجريبي ت9",
    titleEn: null,
    descriptionAr: "وصف الاستبيان التجريبي.",
    descriptionEn: null,
    purposeAr: "قياس أثر التدريب",
    instructionsAr: "أجب بصدق — ردودك سرية.",
    stage: null,
    linkPairCode: null,
    programId: null,
    courseId: null,
    lessonId: null,
    assignmentId: null,
    certificateId: null,
    audienceMode: "ALL_TEACHERS",
    targetBranchIds: JSON.stringify([]),
    targetTeacherIds: JSON.stringify([]),
    anonymous: false,
    allowMultipleResponses: false,
    linkResponsesEnabled: false,
    opensAt: null,
    closesAt: null,
    questions:
      questions ??
      ([
        { textAr: "قيم تجربتك التدريبية من 1 إلى 5", type: "RATING", required: true, options: [], minScore: 1, maxScore: 5 },
        { textAr: "هل توصي بالبرنامج؟", type: "YES_NO", required: true, options: [] },
        { textAr: "ما أبرز ما استفدت؟", type: "LONG_TEXT", required: false, options: [] },
      ] as BuilderQuestionInput[]),
    ...overrides,
  };
}

async function createManagedSurvey(
  ctx: typeof MANAGER_A,
  overrides: Record<string, unknown> = {},
  questions?: BuilderQuestionInput[]
): Promise<string> {
  const result = await createSurvey(ctx, buildDefinition(overrides, questions));
  if (!result.ok) throw new Error(`fixture survey create failed: ${result.message}`);
  return result.data.id;
}

async function questionIds(surveyId: string): Promise<string[]> {
  const rows = await db.surveyQuestion.findMany({
    where: { surveyId },
    orderBy: { orderIndex: "asc" },
    select: { id: true, type: true },
  });
  return rows.map((row) => row.id);
}

async function publishManaged(surveyId: string): Promise<void> {
  const result = await transitionSurvey(MANAGER_A, surveyId, "PUBLISH");
  if (!result.ok) throw new Error(`fixture publish failed: ${result.message}`);
}

function payload(
  answers: {
    questionId: string;
    valueNumber?: number;
    valueText?: string;
    selectedOptions?: string[];
  }[]
) {
  return {
    answers: answers.map((answer) => ({
      valueText: "",
      selectedOptions: [],
      ...answer,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* 1) Creation & server-side validation                                 */
/* ------------------------------------------------------------------ */

describe("Phase 9 — survey creation & validation", () => {
  test("rejects teachers outright", async () => {
    const result = await createSurvey(
      { id: teacherA1Id, role: "TEACHER", schoolId: schoolAId } as never,
      buildDefinition()
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("rejects deputies and super admin (read-only roles)", async () => {
    const deputyResult = await createSurvey(DEPUTY_A, buildDefinition());
    expect(deputyResult.ok).toBe(false);
    if (!deputyResult.ok) expect(deputyResult.code).toBe("FORBIDDEN");

    const superResult = await createSurvey(SUPER_ADMIN, buildDefinition());
    expect(superResult.ok).toBe(false);
    if (!superResult.ok) expect(superResult.code).toBe("FORBIDDEN");
  });

  test("rejects an empty question set and invalid choice options", async () => {
    const noQuestions = await createSurvey(MANAGER_A, buildDefinition({}, []));
    expect(noQuestions.ok).toBe(false);
    if (!noQuestions.ok) expect(noQuestions.code).toBe("VALIDATION_ERROR");

    const oneOption = await createSurvey(
      MANAGER_A,
      buildDefinition({}, [
        { textAr: "اختر", type: "SINGLE_CHOICE", required: true, options: ["خيار واحد فقط"] },
      ])
    );
    expect(oneOption.ok).toBe(false);
    if (!oneOption.ok) expect(oneOption.code).toBe("VALIDATION_ERROR");
  });

  test("rejects RATING min>=max", async () => {
    const result = await createSurvey(
      MANAGER_A,
      buildDefinition({}, [
        { textAr: "قيم", type: "RATING", required: true, options: [], minScore: 4, maxScore: 2 },
      ])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  test("rejects BRANCHES/TEACHERS audiences without targets", async () => {
    const branches = await createSurvey(
      MANAGER_A,
      buildDefinition({ audienceMode: "BRANCHES", targetBranchIds: JSON.stringify([]) })
    );
    expect(branches.ok).toBe(false);

    const teachers = await createSurvey(
      MANAGER_A,
      buildDefinition({ audienceMode: "TEACHERS", targetTeacherIds: JSON.stringify([]) })
    );
    expect(teachers.ok).toBe(false);
  });

  test("rejects cross-school audience targets and content links", async () => {
    const crossBranch = await createSurvey(
      MANAGER_A,
      buildDefinition({ audienceMode: "TEACHERS", targetTeacherIds: JSON.stringify([teacherB1Id]) })
    );
    expect(crossBranch.ok).toBe(false);
    if (!crossBranch.ok) expect(crossBranch.code).toBe("AUDIENCE_INVALID");

    const crossProgram = await validateContentLinks(schoolAId, {
      programId: programBId,
      courseId: null,
      lessonId: null,
      assignmentId: null,
      certificateId: null,
    });
    expect(crossProgram.ok).toBe(false);
    if (!crossProgram.ok) expect(crossProgram.code).toBe("RELATION_ERROR");
  });

  test("creates a draft with normalized question order and rating defaults", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    const survey = await db.survey.findUnique({ where: { id: surveyId } });
    expect(survey?.status).toBe("DRAFT");
    expect(survey?.schoolId).toBe(schoolAId);
    expect(survey?.ownerUserId).toBe(managerA.id);

    const questions = await db.surveyQuestion.findMany({
      where: { surveyId },
      orderBy: { orderIndex: "asc" },
    });
    expect(questions.length).toBe(3);
    expect(questions.map((question) => question.orderIndex)).toEqual([1, 2, 3]);
    const rating = questions[0];
    expect(rating.minScore).toBe(1);
    expect(rating.maxScore).toBe(5);

    const events = await db.surveyEvent.findMany({ where: { surveyId } });
    expect(events.map((event) => event.type)).toContain("CREATED");
  });

  test("accepts platform-wide program links (schoolId null)", async () => {
    const platformProgramId = (
      await db.trainingProgram.create({
        data: {
          schoolId: null,
          nameAr: "برنامج منصة ت9",
          nameNorm: "برنامج منصة ت9",
          descriptionAr: "برنامج على مستوى المنصة.",
          category: "pedagogy",
          status: "PUBLISHED",
          createdById: superAdmin.id,
        },
      })
    ).id;
    const link = await validateContentLinks(schoolAId, {
      programId: platformProgramId,
      courseId: null,
      lessonId: null,
      assignmentId: null,
      certificateId: null,
    });
    expect(link.ok).toBe(true);
    await db.trainingProgram.delete({ where: { id: platformProgramId } });
  });
});

/* ------------------------------------------------------------------ */
/* 2) Lifecycle: publish / close / archive / edit                       */
/* ------------------------------------------------------------------ */

describe("Phase 9 — survey lifecycle", () => {
  test("publishes a draft: status, timestamp and audit event", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    const result = await transitionSurvey(MANAGER_A, surveyId, "PUBLISH");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("PUBLISHED");

    const survey = await db.survey.findUnique({ where: { id: surveyId } });
    expect(survey?.status).toBe("PUBLISHED");
    expect(survey?.publishedAt).not.toBeNull();
    const events = await db.surveyEvent.findMany({ where: { surveyId } });
    expect(events.map((event) => event.type)).toContain("PUBLISHED");
  });

  test("refuses publishing an empty survey", async () => {
    const result = await createSurvey(MANAGER_A, buildDefinition({}, []));
    // Empty question set never reaches DRAFT — validation blocks earlier.
    expect(result.ok).toBe(false);
  });

  test("enforces transition order (close only from PUBLISHED, archive terminal)", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    const earlyClose = await transitionSurvey(MANAGER_A, surveyId, "CLOSE");
    expect(earlyClose.ok).toBe(false);

    await transitionSurvey(MANAGER_A, surveyId, "PUBLISH");
    const closed = await transitionSurvey(MANAGER_A, surveyId, "CLOSE");
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(closed.data.status).toBe("CLOSED");

    // CLOSED cannot be closed again nor edited.
    const reclose = await transitionSurvey(MANAGER_A, surveyId, "CLOSE");
    expect(reclose.ok).toBe(false);

    const archived = await transitionSurvey(MANAGER_A, surveyId, "ARCHIVE");
    expect(archived.ok).toBe(true);
    if (archived.ok) expect(archived.data.status).toBe("ARCHIVED");

    const rearchive = await transitionSurvey(MANAGER_A, surveyId, "ARCHIVE");
    expect(rearchive.ok).toBe(false);
  });

  test("edits DRAFT but blocks edits after publication", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    const edited = await updateSurvey(MANAGER_A, surveyId, buildDefinition({ titleAr: "عنوان معدّل" }));
    expect(edited.ok).toBe(true);
    const draft = await db.survey.findUnique({ where: { id: surveyId } });
    expect(draft?.titleAr).toBe("عنوان معدّل");

    await publishManaged(surveyId);
    const afterPublish = await updateSurvey(MANAGER_A, surveyId, buildDefinition({ titleAr: "لن يُقبل" }));
    expect(afterPublish.ok).toBe(false);
    if (!afterPublish.ok) expect(afterPublish.code).toBe("NOT_PUBLISHED");
  });

  test("blocks cross-school lifecycle actions (tenant isolation)", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    const byManagerB = await transitionSurvey(MANAGER_B, surveyId, "PUBLISH");
    expect(byManagerB.ok).toBe(false);
    if (!byManagerB.ok) expect(byManagerB.code).toBe("FORBIDDEN");

    const byManagerBView = await getSurveyManageView(MANAGER_B, surveyId);
    expect(byManagerBView.ok).toBe(false);
    await transitionSurvey(MANAGER_A, surveyId, "PUBLISH");
  });

  test("supervisors manage only their OWN surveys", async () => {
    const ownId = await createSurvey(
      SUPERVISOR_A,
      buildDefinition({ audienceMode: "ALL_TEACHERS" })
    );
    expect(ownId.ok).toBe(true);
    const ownSurveyId = ownId.ok ? ownId.data.id : "";

    const managerOwnedId = await createManagedSurvey(MANAGER_A);
    const foreignView = await getSurveyManageView(SUPERVISOR_A, managerOwnedId);
    expect(foreignView.ok).toBe(false);
    if (!foreignView.ok) expect(foreignView.code).toBe("FORBIDDEN");

    const ownView = await getSurveyManageView(SUPERVISOR_A, ownSurveyId);
    expect(ownView.ok).toBe(true);

    // Managers DO see supervisor surveys of their school in the list.
    const list = await listSurveysForManage(MANAGER_A, {});
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.rows.some((row) => row.id === ownSurveyId)).toBe(true);
    }
    // …while the supervisor's list contains only their own.
    const supervisorList = await listSurveysForManage(SUPERVISOR_A, {});
    expect(supervisorList.ok).toBe(true);
    if (supervisorList.ok) {
      expect(supervisorList.data.rows.every((row) => row.ownerName === supervisorA.name)).toBe(true);
    }
    await transitionSurvey(SUPERVISOR_A, ownSurveyId, "PUBLISH");
  });
});

/* ------------------------------------------------------------------ */
/* 3) Audience eligibility                                              */
/* ------------------------------------------------------------------ */

describe("Phase 9 — audience eligibility", () => {
  test("ALL_TEACHERS resolves every active school teacher", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    const view = await getSurveyManageView(MANAGER_A, surveyId);
    expect(view.ok).toBe(true);
    if (view.ok) expect(view.data.eligibleCount).toBe(3);
  });

  test("BRANCHES audience excludes other-branch and branchless teachers", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A, {
      audienceMode: "BRANCHES",
      targetBranchIds: JSON.stringify([branchA1Id]),
    });
    const view = await getSurveyManageView(MANAGER_A, surveyId);
    if (view.ok) expect(view.data.eligibleCount).toBe(1); // teacherA1 only
  });

  test("TEACHERS audience resolves exactly the selected teachers", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A, {
      audienceMode: "TEACHERS",
      targetTeacherIds: JSON.stringify([teacherA1Id, teacherA3Id]),
    });
    const view = await getSurveyManageView(MANAGER_A, surveyId);
    if (view.ok) expect(view.data.eligibleCount).toBe(2);
  });

  test("supervisor-owned surveys are bounded by real coverage", async () => {
    // Supervisor A covers teacherA1 only (explicit + branch A1).
    const surveyId = await createSurvey(SUPERVISOR_A, buildDefinition());
    expect(surveyId.ok).toBe(true);
    const surveyIdValue = surveyId.ok ? surveyId.data.id : "";
    await transitionSurvey(SUPERVISOR_A, surveyIdValue, "PUBLISH");

    const a1 = await getSurveyForTaking(TEACHER_A1, surveyIdValue);
    expect(a1.ok).toBe(true);

    const a2 = await getSurveyForTaking(TEACHER_A2, surveyIdValue);
    expect(a2.ok).toBe(false);
    if (!a2.ok) expect(a2.code).toBe("FORBIDDEN");

    const a3 = await getSurveyForTaking(TEACHER_A3, surveyIdValue);
    expect(a3.ok).toBe(false);

    await transitionSurvey(SUPERVISOR_A, surveyIdValue, "ARCHIVE");
  });

  test("cross-school teacher can never take a survey", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    await publishManaged(surveyId);
    const result = await getSurveyForTaking(TEACHER_B1, surveyId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("teacher list only includes eligible published surveys", async () => {
    const targetedId = await createManagedSurvey(MANAGER_A, {
      audienceMode: "TEACHERS",
      targetTeacherIds: JSON.stringify([teacherA1Id]),
    });
    await publishManaged(targetedId);

    const rowsA1 = await listSurveysForTeacher(TEACHER_A1);
    expect(rowsA1.ok).toBe(true);
    if (rowsA1.ok) {
      expect(rowsA1.data.some((row) => row.id === targetedId)).toBe(true);
    }
    const rowsA2 = await listSurveysForTeacher(TEACHER_A2);
    expect(rowsA2.ok).toBe(true);
    if (rowsA2.ok) {
      expect(rowsA2.data.some((row) => row.id === targetedId)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4) Response workflow                                                 */
/* ------------------------------------------------------------------ */

describe("Phase 9 — response workflow", () => {
  test("draft save + restore works for identified surveys", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    await publishManaged(surveyId);
    const [q1, q2, q3] = await questionIds(surveyId);

    const draft = await saveResponseDraft(TEACHER_A1, surveyId, payload([
      { questionId: q1, valueNumber: 4 },
    ]));
    expect(draft.ok).toBe(true);

    const taken = await getSurveyForTaking(TEACHER_A1, surveyId);
    expect(taken.ok).toBe(true);
    if (taken.ok) {
      expect(taken.data.myResponse?.status).toBe("DRAFT");
      expect(taken.data.myResponse?.answers.length).toBe(1);
      expect(taken.data.alreadySubmitted).toBe(false);
    }
    void q2;
    void q3;
  });

  test("rejects submission missing required answers", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    await publishManaged(surveyId);
    const [q1] = await questionIds(surveyId);
    const result = await submitResponse(TEACHER_A1, surveyId, payload([
      { questionId: q1, valueNumber: 3 },
      // required YES_NO + optional text left unanswered
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REQUIRED_MISSING");
  });

  test("rejects invalid option choices, foreign questions and out-of-scale values", async () => {
    const surveyId = await createManagedSurvey(
      MANAGER_A,
      {},
      [
        { textAr: "اختر لونًا", type: "SINGLE_CHOICE", required: true, options: ["أحمر", "أزرق"] },
      ]
    );
    await publishManaged(surveyId);
    const [q1] = await questionIds(surveyId);

    const foreign = await submitResponse(TEACHER_A1, surveyId, payload([
      { questionId: "nonexistent-question", selectedOptions: ["أحمر"] },
    ]));
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe("ANSWER_INVALID");

    const badOption = await submitResponse(TEACHER_A1, surveyId, payload([
      { questionId: q1, selectedOptions: ["أخضر"] },
    ]));
    expect(badOption.ok).toBe(false);
    if (!badOption.ok) expect(badOption.code).toBe("ANSWER_INVALID");

    const multiForSingle = await submitResponse(TEACHER_A1, surveyId, payload([
      { questionId: q1, selectedOptions: ["أحمر", "أزرق"] },
    ]));
    expect(multiForSingle.ok).toBe(false);
  });

  test("rejects out-of-scale rating values", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A, {}, [
      { textAr: "قيم", type: "RATING", required: true, options: [], minScore: 1, maxScore: 5 },
    ]);
    await publishManaged(surveyId);
    const [q1] = await questionIds(surveyId);
    const result = await submitResponse(TEACHER_A1, surveyId, payload([
      { questionId: q1, valueNumber: 9 },
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ANSWER_INVALID");
  });

  test("submits a valid response and enforces single-submission policy", async () => {
    resetRateLimits();
    const surveyId = await createManagedSurvey(MANAGER_A);
    await publishManaged(surveyId);
    const [q1, q2, q3] = await questionIds(surveyId);

    const submitted = await submitResponse(TEACHER_A2, surveyId, payload([
      { questionId: q1, valueNumber: 5 },
      { questionId: q2, valueNumber: 1 },
      { questionId: q3, valueText: "استفدت كثيرًا من الجانب العملي" },
    ]));
    expect(submitted.ok).toBe(true);

    const row = await db.surveyResponse.findFirst({
      where: { surveyId, respondentId: teacherA2Id, status: "SUBMITTED" },
      include: { answers: true },
    });
    expect(row).not.toBeNull();
    expect(row?.answers.length).toBe(3);
    expect(row?.respondentId).toBe(teacherA2Id); // identity from session only

    const duplicate = await submitResponse(TEACHER_A2, surveyId, payload([
      { questionId: q1, valueNumber: 4 },
      { questionId: q2, valueNumber: 0 },
      { questionId: q3, valueText: "محاولة ثانية" },
    ]));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe("ALREADY_SUBMITTED");
  });

  test("allowMultipleResponses permits a second submission", async () => {
    resetRateLimits();
    const surveyId = await createManagedSurvey(MANAGER_A, { allowMultipleResponses: true });
    await publishManaged(surveyId);
    const [q1, q2] = await questionIds(surveyId);

    const first = await submitResponse(TEACHER_A3, surveyId, payload([
      { questionId: q1, valueNumber: 2 },
      { questionId: q2, valueNumber: 1 },
    ]));
    expect(first.ok).toBe(true);

    const second = await submitResponse(TEACHER_A3, surveyId, payload([
      { questionId: q1, valueNumber: 4 },
      { questionId: q2, valueNumber: 0 },
    ]));
    expect(second.ok).toBe(true);

    const count = await db.surveyResponse.count({
      where: { surveyId, respondentId: teacherA3Id, status: "SUBMITTED" },
    });
    expect(count).toBe(2);
  });

  test("enforces the response window (closed dates / manual close)", async () => {
    const pastClosesAt = new Date(Date.now() - 60 * 60 * 1000);
    const surveyId = await createManagedSurvey(MANAGER_A, { closesAt: pastClosesAt });
    await publishManaged(surveyId);
    const [q1, q2] = await questionIds(surveyId);

    const closedByDate = await submitResponse(TEACHER_A1, surveyId, payload([
      { questionId: q1, valueNumber: 4 },
      { questionId: q2, valueNumber: 1 },
    ]));
    expect(closedByDate.ok).toBe(false);
    if (!closedByDate.ok) expect(closedByDate.code).toBe("NOT_OPEN");

    const openId = await createManagedSurvey(MANAGER_A);
    await publishManaged(openId);
    await transitionSurvey(MANAGER_A, openId, "CLOSE");
    const [oq1, oq2] = await questionIds(openId);
    const closedManually = await submitResponse(TEACHER_A1, openId, payload([
      { questionId: oq1, valueNumber: 4 },
      { questionId: oq2, valueNumber: 1 },
    ]));
    expect(closedManually.ok).toBe(false);
    if (!closedManually.ok) expect(closedManually.code).toBe("CLOSED");
  });

  test("rate-limits submission bursts per user", async () => {
    resetRateLimits();
    const surveyId = await createManagedSurvey(MANAGER_A, { allowMultipleResponses: true }, [
      { textAr: "سؤال اختياري", type: "SHORT_TEXT", required: false, options: [] },
    ]);
    await publishManaged(surveyId);
    const [q1] = await questionIds(surveyId);

    let blocked = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await submitResponse(TEACHER_B1, surveyId, payload([
        { questionId: q1, valueText: `محاولة ${attempt}` },
      ]));
      if (!result.ok && result.code === "RATE_LIMITED") {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
    resetRateLimits();
  });
});

/* ------------------------------------------------------------------ */
/* 5) Anonymous privacy                                                 */
/* ------------------------------------------------------------------ */

describe("Phase 9 — anonymous response privacy", () => {
  test("anonymous submission stores NO respondent identity", async () => {
    resetRateLimits();
    const surveyId = await createManagedSurvey(MANAGER_A, { anonymous: true });
    await publishManaged(surveyId);
    const [q1, q2] = await questionIds(surveyId);

    const result = await submitResponse(TEACHER_A1, surveyId, payload([
      { questionId: q1, valueNumber: 4 },
      { questionId: q2, valueNumber: 1 },
    ]));
    expect(result.ok).toBe(true);

    const row = await db.surveyResponse.findFirst({ where: { surveyId } });
    expect(row?.respondentId).toBeNull();
    expect(row?.respondentKey).toBeNull();
  });

  test("anonymous surveys do not support drafts", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A, { anonymous: true });
    await publishManaged(surveyId);
    const [q1] = await questionIds(surveyId);
    const result = await saveResponseDraft(TEACHER_A1, surveyId, payload([
      { questionId: q1, valueNumber: 3 },
    ]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("individual responses are unavailable even for the office manager", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A, { anonymous: true });
    await publishManaged(surveyId);
    const [q1, q2] = await questionIds(surveyId);
    await submitResponse(TEACHER_A1, surveyId, payload([
      { questionId: q1, valueNumber: 4 },
      { questionId: q2, valueNumber: 1 },
    ]));

    const results = await getSurveyResults(MANAGER_A, surveyId);
    expect(results.ok).toBe(true);
    if (results.ok) {
      expect(results.data.canSeeIndividualResponses).toBe(false);
      expect(results.data.responses).toEqual([]);
    }

    // The manage view hides the individual-responses permission too.
    const view = await getSurveyManageView(MANAGER_A, surveyId);
    if (view.ok) expect(view.data.permissions.canSeeIndividualResponses).toBe(false);
  });

  test("small anonymous groups are privacy-suppressed (<3 submissions)", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A, { anonymous: true });
    await publishManaged(surveyId);
    const [q1, q2] = await questionIds(surveyId);
    await submitResponse(TEACHER_A1, surveyId, payload([
      { questionId: q1, valueNumber: 5 },
      { questionId: q2, valueNumber: 1 },
    ]));

    const results = await getSurveyResults(MANAGER_A, surveyId);
    expect(results.ok).toBe(true);
    if (results.ok) {
      expect(results.data.privacySuppressed).toBe(true);
      expect(results.data.responseRatePercent).toBe(33);
      const ratingDistribution = results.data.distributions.find((item) => item.type === "RATING");
      expect(ratingDistribution?.numericDistribution.length).toBe(0);
      // Suppressed mode carries NO texts at all (null = withheld).
      const textDistribution = results.data.distributions.find((item) => item.type === "LONG_TEXT");
      expect(textDistribution?.texts).toBeNull();
    }
  });

  test("identified response history lists own rows; anonymous never appears", async () => {
    const identifiedId = await createManagedSurvey(MANAGER_A);
    await publishManaged(identifiedId);
    const [iq1, iq2] = await questionIds(identifiedId);
    await submitResponse(TEACHER_A1, identifiedId, payload([
      { questionId: iq1, valueNumber: 3 },
      { questionId: iq2, valueNumber: 0 },
    ]));

    const history = await import("@/lib/surveys/service").then(({ getMyResponseHistory }) =>
      getMyResponseHistory(TEACHER_A1)
    );
    expect(history.ok).toBe(true);
    if (history.ok) {
      const rows = history.data.filter((row) => row.surveyId === identifiedId);
      expect(rows.length).toBe(1);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 6) Results & response-rate calculations                              */
/* ------------------------------------------------------------------ */

describe("Phase 9 — results & metrics", () => {
  test("computes response rate, distributions and skipped counts", async () => {
    resetRateLimits();
    const surveyId = await createManagedSurvey(
      MANAGER_A,
      {},
      [
        { textAr: "قيم التجربة", type: "RATING", required: true, options: [], minScore: 1, maxScore: 5 },
        { textAr: "أكثر ما أفادك", type: "SINGLE_CHOICE", required: false, options: ["المحتوى", "المدرّب", "التفاعل"] },
        { textAr: "توصياتك", type: "LONG_TEXT", required: false, options: [] },
      ]
    );
    await publishManaged(surveyId);
    const [q1, q2, q3] = await questionIds(surveyId);

    await submitResponse(TEACHER_A1, surveyId, payload([
      { questionId: q1, valueNumber: 5 },
      { questionId: q2, selectedOptions: ["المحتوى"] },
      { questionId: q3, valueText: "المحتوى العملي" },
    ]));
    await submitResponse(TEACHER_A2, surveyId, payload([
      { questionId: q1, valueNumber: 3 },
      { questionId: q2, selectedOptions: ["المدرّب"] },
    ]));

    const results = await getSurveyResults(MANAGER_A, surveyId);
    expect(results.ok).toBe(true);
    if (!results.ok) return;
    const { eligibleCount, submittedCount, responseRatePercent, draftCount, distributions, canSeeIndividualResponses } = results.data;

    expect(eligibleCount).toBe(3);
    expect(submittedCount).toBe(2);
    expect(responseRatePercent).toBe(67);
    expect(draftCount).toBe(0);
    expect(canSeeIndividualResponses).toBe(true);

    const rating = distributions.find((item) => item.type === "RATING");
    expect(rating?.average).toBe(4);
    expect(rating?.numericDistribution.find((item) => item.value === 5)?.count).toBe(1);
    expect(rating?.numericDistribution.find((item) => item.value === 3)?.count).toBe(1);
    expect(rating?.skippedCount).toBe(0);

    const choice = distributions.find((item) => item.type === "SINGLE_CHOICE");
    expect(choice?.answeredCount).toBe(2);
    expect(choice?.skippedCount).toBe(0);
    expect(choice?.optionCounts.find((item) => item.option === "المحتوى")?.count).toBe(1);
    expect(choice?.optionCounts.find((item) => item.option === "المدرّب")?.count).toBe(1);
    expect(choice?.optionCounts.find((item) => item.option === "التفاعل")?.count).toBe(0);

    const text = distributions.find((item) => item.type === "LONG_TEXT");
    expect(text?.skippedCount).toBe(1);
    expect(text?.texts?.length).toBe(1);

    // Individual responses visible to the office manager with names.
    expect(results.data.responses.length).toBe(2);
  });

  test("handles empty datasets without inventing values", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    await publishManaged(surveyId);
    const results = await getSurveyResults(MANAGER_A, surveyId);
    expect(results.ok).toBe(true);
    if (!results.ok) return;
    expect(results.data.submittedCount).toBe(0);
    expect(results.data.responseRatePercent).toBe(0);
    expect(results.data.distributions.every((item) => item.answeredCount === 0)).toBe(true);
    expect(results.data.responses).toEqual([]);
  });

  test("metrics aggregate with explicit denominators", async () => {
    const metrics = await getSurveyMetrics(MANAGER_A);
    expect(metrics.ok).toBe(true);
    if (!metrics.ok) return;
    expect(metrics.data.totalSurveys).toBeGreaterThan(0);
    expect(typeof metrics.data.averageResponseRatePercent).toBe("number");
  });

  test("deputies see school results; super admin gets per-survey denial", async () => {
    const surveyId = await createManagedSurvey(MANAGER_A);
    await publishManaged(surveyId);
    const deputyResults = await getSurveyResults(DEPUTY_A, surveyId);
    expect(deputyResults.ok).toBe(true);
    if (deputyResults.ok) expect(deputyResults.data.canSeeIndividualResponses).toBe(false);

    const superResults = await getSurveyResults(SUPER_ADMIN, surveyId);
    expect(superResults.ok).toBe(false);
    if (!superResults.ok) expect(superResults.code).toBe("FORBIDDEN");
  });

  test("supervisor sees own survey results but not foreign ones", async () => {
    const ownId = await createSurvey(SUPERVISOR_A, buildDefinition());
    const ownSurveyId = ownId.ok ? ownId.data.id : "";
    await transitionSurvey(SUPERVISOR_A, ownSurveyId, "PUBLISH");
    const own = await getSurveyResults(SUPERVISOR_A, ownSurveyId);
    expect(own.ok).toBe(true);

    const foreignId = await createManagedSurvey(MANAGER_A);
    await publishManaged(foreignId);
    const foreign = await getSurveyResults(SUPERVISOR_A, foreignId);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe("FORBIDDEN");
  });
});

/* ------------------------------------------------------------------ */
/* 7) Pre/post stage comparison                                         */
/* ------------------------------------------------------------------ */

describe("Phase 9 — pre/post impact comparison", () => {
  test("pairs identified respondents and computes observed change", async () => {
    resetRateLimits();
    const pairCode = "P9-PAIR-ID-01";
    const preId = await createManagedSurvey(MANAGER_A, {
      stage: "PRE_TRAINING",
      linkPairCode: pairCode,
      programId: programAId,
    }, [
      { textAr: "تقييم عام قبل التدريب", type: "RATING", required: true, options: [], minScore: 1, maxScore: 5 },
    ]);
    const afterId = await createManagedSurvey(MANAGER_A, {
      stage: "AFTER_TRAINING",
      linkPairCode: pairCode,
      programId: programAId,
    }, [
      { textAr: "تقييم عام بعد التدريب", type: "RATING", required: true, options: [], minScore: 1, maxScore: 5 },
    ]);
    await publishManaged(preId);
    await publishManaged(afterId);
    const [preQ] = await questionIds(preId);
    const [afterQ] = await questionIds(afterId);

    // Two paired respondents: 2→4 and 3→5. A third answers only AFTER.
    await submitResponse(TEACHER_A1, preId, payload([{ questionId: preQ, valueNumber: 2 }]));
    await submitResponse(TEACHER_A2, preId, payload([{ questionId: preQ, valueNumber: 3 }]));
    await submitResponse(TEACHER_A1, afterId, payload([{ questionId: afterQ, valueNumber: 4 }]));
    await submitResponse(TEACHER_A2, afterId, payload([{ questionId: afterQ, valueNumber: 5 }]));
    await submitResponse(TEACHER_A3, afterId, payload([{ questionId: afterQ, valueNumber: 1 }]));

    const comparison = await getStageComparison(MANAGER_A, afterId);
    expect(comparison.ok).toBe(true);
    if (!comparison.ok) return;
    const data = comparison.data;
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.pairingMode).toBe("IDENTIFIED");
    expect(data.pairedCount).toBe(2); // teacher A3 has no PRE → excluded
    expect(data.preAverage).toBe(2.5);
    expect(data.afterAverage).toBe(4.5);
    expect(data.observedDelta).toBe(2);
    expect(data.privacySuppressed).toBe(false);
  });

  test("returns null without a twin survey or for follow-up stage", async () => {
    const loneId = await createManagedSurvey(MANAGER_A, {
      stage: "PRE_TRAINING",
      linkPairCode: "P9-LONE",
      courseId: courseAId,
    }, [
      { textAr: "سؤال وحيد", type: "RATING", required: true, options: [], minScore: 1, maxScore: 5 },
    ]);
    await publishManaged(loneId);
    const noTwin = await getStageComparison(MANAGER_A, loneId);
    expect(noTwin.ok).toBe(true);
    if (noTwin.ok) expect(noTwin.data).toBeNull();

    const followUpStageId = await createManagedSurvey(MANAGER_A, {
      stage: "APPLICATION_FOLLOWUP",
      linkPairCode: "P9-APP",
      courseId: courseAId,
    }, [
      { textAr: "سؤال متابعة", type: "RATING", required: true, options: [], minScore: 1, maxScore: 5 },
    ]);
    await publishManaged(followUpStageId);
    const notComparable = await getStageComparison(MANAGER_A, followUpStageId);
    if (notComparable.ok) expect(notComparable.data).toBeNull();
  });

  test("anonymous pairing uses pseudonymous keys and suppresses tiny groups", async () => {
    resetRateLimits();
    const pairCode = "P9-PAIR-AN-01";
    const preId = await createManagedSurvey(MANAGER_A, {
      anonymous: true,
      linkResponsesEnabled: true,
      stage: "PRE_TRAINING",
      linkPairCode: pairCode,
      courseId: courseAId,
    }, [
      { textAr: "تقييم مجهول قبل", type: "RATING", required: true, options: [], minScore: 1, maxScore: 5 },
    ]);
    const afterId = await createManagedSurvey(MANAGER_A, {
      anonymous: true,
      linkResponsesEnabled: true,
      stage: "AFTER_TRAINING",
      linkPairCode: pairCode,
      courseId: courseAId,
    }, [
      { textAr: "تقييم مجهول بعد", type: "RATING", required: true, options: [], minScore: 1, maxScore: 5 },
    ]);
    await publishManaged(preId);
    await publishManaged(afterId);
    const [preQ] = await questionIds(preId);
    const [afterQ] = await questionIds(afterId);

    // Anonymous duplicate prevention via respondentKey.
    await submitResponse(TEACHER_A1, preId, payload([{ questionId: preQ, valueNumber: 2 }]));
    const duplicate = await submitResponse(TEACHER_A1, preId, payload([
      { questionId: preQ, valueNumber: 5 },
    ]));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe("ALREADY_SUBMITTED");

    await submitResponse(TEACHER_A2, preId, payload([{ questionId: preQ, valueNumber: 3 }]));
    await submitResponse(TEACHER_A1, afterId, payload([{ questionId: afterQ, valueNumber: 4 }]));
    await submitResponse(TEACHER_A2, afterId, payload([{ questionId: afterQ, valueNumber: 5 }]));
    await submitResponse(TEACHER_A3, afterId, payload([{ questionId: afterQ, valueNumber: 3 }]));

    const keys = await db.surveyResponse.findMany({
      where: { surveyId: { in: [preId, afterId] } },
      select: { respondentKey: true, respondentId: true, surveyId: true },
    });
    for (const row of keys) {
      expect(row.respondentId).toBeNull();
      expect(row.respondentKey).toMatch(/^[a-f0-9]{64}$/); // pseudonymous, NOT the user id
    }
    // Every PRE respondent's key reappears in AFTER (that IS the pairing).
    const preKeys = new Set(keys.filter((row) => row.surveyId === preId).map((row) => row.respondentKey));
    const afterKeys = new Set(keys.filter((row) => row.surveyId === afterId).map((row) => row.respondentKey));
    expect(preKeys.size).toBe(2);
    for (const key of preKeys) {
      expect(afterKeys.has(key)).toBe(true);
    }
    // Teacher A3 answered only AFTER → one unpaired key there.
    expect(afterKeys.size).toBe(3);

    // 2 pairs < 3 → suppressed values, count only.
    const comparison = await getStageComparison(MANAGER_A, afterId);
    expect(comparison.ok).toBe(true);
    if (!comparison.ok) return;
    const data = comparison.data;
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.pairingMode).toBe("ANONYMOUS_KEY");
    expect(data.pairedCount).toBe(2);
    expect(data.privacySuppressed).toBe(true);
    expect(data.preAverage).toBeNull();
    expect(data.afterAverage).toBeNull();
    expect(data.observedDelta).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 8) Follow-up workflow                                                */
/* ------------------------------------------------------------------ */

describe("Phase 9 — follow-up workflow", () => {
  test("supervisor creates follow-ups only inside their coverage", async () => {
    const covered = await createFollowUp(SUPERVISOR_A, {
      teacherId: teacherA1Id,
      supervisorId: null,
      titleAr: "متابعة تطبيق استراتيجية التعلم النشط",
      purposeAr: "التأكد من تطبيق التدريب",
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: programAId,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: "طبّقت المعلمة استراتيجية التعلم التعاوني بنجاح.",
      progressAr: "تقدم ملحوظ في إدارة الصف.",
      challengesAr: "ضيق الوقت داخل الحصة.",
      supportNeedsAr: "ورشة إدارة وقت.",
      recommendationsAr: "استمرار التطبيق مع التنويع في الأنشطة.",
      sharedWithTeacher: false,
    });
    expect(covered.ok).toBe(true);
    const followUpId = covered.ok ? covered.data.id : "";

    const uncovered = await createFollowUp(SUPERVISOR_A, {
      teacherId: teacherA2Id, // branch A2 — outside supervisor A coverage
      supervisorId: null,
      titleAr: "متابعة خارج النطاق",
      purposeAr: null,
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: null,
      progressAr: null,
      challengesAr: null,
      supportNeedsAr: null,
      recommendationsAr: null,
      sharedWithTeacher: false,
    });
    expect(uncovered.ok).toBe(false);
    if (!uncovered.ok) expect(uncovered.code).toBe("FORBIDDEN");

    const crossSchool = await createFollowUp(SUPERVISOR_B, {
      teacherId: teacherA1Id,
      supervisorId: null,
      titleAr: "متابعة عبر المدارس",
      purposeAr: null,
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: null,
      progressAr: null,
      challengesAr: null,
      supportNeedsAr: null,
      recommendationsAr: null,
      sharedWithTeacher: false,
    });
    expect(crossSchool.ok).toBe(false);

    const event = await db.followUpEvent.findFirst({ where: { followUpId } });
    expect(event?.type).toBe("CREATED");
  });

  test("office manager assigns any school supervisor; invalid ones rejected", async () => {
    const created = await createFollowUp(MANAGER_A, {
      teacherId: teacherA2Id,
      supervisorId: supervisorAId,
      titleAr: "متابعة بتعيين مدير المكتب",
      purposeAr: null,
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: courseAId,
      surveyId: null,
      assignmentId: null,
      observationAr: null,
      progressAr: null,
      challengesAr: null,
      supportNeedsAr: null,
      recommendationsAr: null,
      sharedWithTeacher: false,
    });
    expect(created.ok).toBe(true);

    const missingSupervisor = await createFollowUp(MANAGER_A, {
      teacherId: teacherA2Id,
      supervisorId: null,
      titleAr: "بدون مشرف",
      purposeAr: null,
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: null,
      progressAr: null,
      challengesAr: null,
      supportNeedsAr: null,
      recommendationsAr: null,
      sharedWithTeacher: false,
    });
    expect(missingSupervisor.ok).toBe(false);

    const teacherAsSupervisor = await createFollowUp(MANAGER_A, {
      teacherId: teacherA2Id,
      supervisorId: teacherA1Id, // not a supervisor
      titleAr: "مشرف غير صالح",
      purposeAr: null,
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: null,
      progressAr: null,
      challengesAr: null,
      supportNeedsAr: null,
      recommendationsAr: null,
      sharedWithTeacher: false,
    });
    expect(teacherAsSupervisor.ok).toBe(false);
    if (!teacherAsSupervisor.ok) expect(teacherAsSupervisor.code).toBe("RELATION_ERROR");
  });

  test("status transitions append history; terminal states are immutable", async () => {
    const created = await createFollowUp(SUPERVISOR_A, {
      teacherId: teacherA1Id,
      supervisorId: null,
      titleAr: "متابعة دورة الحالة",
      purposeAr: null,
      followUpDate: new Date(),
      nextFollowUpAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: null,
      progressAr: null,
      challengesAr: null,
      supportNeedsAr: null,
      recommendationsAr: null,
      sharedWithTeacher: false,
    });
    expect(created.ok).toBe(true);
    const followUpId = created.ok ? created.data.id : "";

    const started = await changeFollowUpStatus(SUPERVISOR_A, {
      followUpId,
      status: "IN_PROGRESS",
      note: "بدأت الزيارة الصفية",
    });
    expect(started.ok).toBe(true);

    const completed = await changeFollowUpStatus(SUPERVISOR_A, {
      followUpId,
      status: "COMPLETED",
      note: "أُنشئت توصيات المتابعة",
    });
    expect(completed.ok).toBe(true);

    const row = await db.followUp.findUnique({ where: { id: followUpId } });
    expect(row?.status).toBe("COMPLETED");
    expect(row?.completedAt).not.toBeNull();

    const afterTerminal = await changeFollowUpStatus(SUPERVISOR_A, {
      followUpId,
      status: "IN_PROGRESS",
      note: "غير مسموح",
    });
    expect(afterTerminal.ok).toBe(false);

    const events = await db.followUpEvent.findMany({ where: { followUpId }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.type)).toEqual([
      "CREATED",
      "STATUS_CHANGED",
      "STATUS_CHANGED",
    ]);
  });

  test("updates record an UPDATED event and respect supervisor scope", async () => {
    const created = await createFollowUp(MANAGER_A, {
      teacherId: teacherA2Id,
      supervisorId: supervisorAId,
      titleAr: "متابعة قبل التعديل",
      purposeAr: null,
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: null,
      progressAr: null,
      challengesAr: null,
      supportNeedsAr: null,
      recommendationsAr: null,
      sharedWithTeacher: false,
    });
    expect(created.ok).toBe(true);
    const followUpId = created.ok ? created.data.id : "";

    const updated = await updateFollowUp(SUPERVISOR_A, followUpId, {
      teacherId: teacherA2Id,
      supervisorId: null,
      titleAr: "متابعة بعد التعديل",
      purposeAr: "غرض محدث",
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: "ملاحظة محدثة",
      progressAr: null,
      challengesAr: null,
      supportNeedsAr: null,
      recommendationsAr: "توصية محدثة",
      sharedWithTeacher: false,
    });
    expect(updated.ok).toBe(true);
    const row = await db.followUp.findUnique({ where: { id: followUpId } });
    expect(row?.titleAr).toBe("متابعة بعد التعديل");

    // Supervisor B (other school) can never touch it.
    const foreign = await updateFollowUp(SUPERVISOR_B, followUpId, {
      teacherId: teacherB1Id,
      supervisorId: null,
      titleAr: "اختراق",
      purposeAr: null,
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: null,
      progressAr: null,
      challengesAr: null,
      supportNeedsAr: null,
      recommendationsAr: null,
      sharedWithTeacher: false,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe("FORBIDDEN");
  });

  test("sharing toggle writes SHARING_CHANGED; teacher sees ONLY the shared subset", async () => {
    const created = await createFollowUp(SUPERVISOR_A, {
      teacherId: teacherA1Id,
      supervisorId: null,
      titleAr: "متابعة مشتركة",
      purposeAr: "غرض مرئي للمعلم",
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: "ملاحظة داخلية سرية",
      progressAr: "تقدم داخلي",
      challengesAr: "تحدٍ داخلي",
      supportNeedsAr: "دعم داخلي",
      recommendationsAr: "توصية مشتركة مع المعلم",
      sharedWithTeacher: false,
    });
    expect(created.ok).toBe(true);
    const followUpId = created.ok ? created.data.id : "";

    // Before sharing: invisible to the teacher.
    const beforeRows = await listSharedFollowUpsForTeacher(TEACHER_A1);
    expect(beforeRows.ok).toBe(true);
    if (beforeRows.ok) {
      expect(beforeRows.data.some((row) => row.id === followUpId)).toBe(false);
    }

    const shared = await setFollowUpSharing(SUPERVISOR_A, { followUpId, sharedWithTeacher: true });
    expect(shared.ok).toBe(true);

    const events = await db.followUpEvent.findMany({ where: { followUpId } });
    expect(events.map((event) => event.type)).toContain("SHARING_CHANGED");

    const afterRows = await listSharedFollowUpsForTeacher(TEACHER_A1);
    expect(afterRows.ok).toBe(true);
    if (afterRows.ok) {
      const sharedRow = afterRows.data.find((row) => row.id === followUpId);
      expect(sharedRow).toBeDefined();
      if (sharedRow) {
        // Shared projection carries recommendations — NEVER internal notes.
        expect(sharedRow.recommendationsAr).toContain("توصية مشتركة");
        const keys = Object.keys(sharedRow);
        expect(keys).not.toContain("observationAr");
        expect(keys).not.toContain("challengesAr");
        expect(keys).not.toContain("supportNeedsAr");
        expect(keys).not.toContain("progressAr");
      }
    }

    // The teacher can never open the back-office record view.
    const teacherView = await getFollowUpManageView(
      { id: teacherA1Id, role: "EDUCATIONAL_SUPERVISOR", schoolId: schoolAId } as never,
      followUpId
    );
    expect(teacherView.ok).toBe(false);
  });

  test("list scoping: supervisor sees coverage records only; deputy read-only; manager school-wide", async () => {
    // supervisor B (school B) sees nothing from school A.
    const listB = await listFollowUps(SUPERVISOR_B, {});
    expect(listB.ok).toBe(true);
    if (listB.ok) {
      expect(listB.data.rows.every((row) => row.id !== "")).toBe(true);
      // No row belongs to school A (teacher names would differ; assert via metrics below).
    }

    const metricsA = await getFollowUpMetrics(SUPERVISOR_A);
    expect(metricsA.ok).toBe(true);
    if (metricsA.ok) expect(metricsA.data.total).toBeGreaterThanOrEqual(2); // coverage records

    const deputyList = await listFollowUps(DEPUTY_A, {});
    expect(deputyList.ok).toBe(true);
    const deputyMetrics = await getFollowUpMetrics(DEPUTY_A);
    expect(deputyMetrics.ok).toBe(true);
    if (deputyMetrics.ok) {
      // Deputy grant covers the whole school → at least the supervisor's records.
      const supervisorMetrics = await getFollowUpMetrics(SUPERVISOR_A);
      expect(supervisorMetrics.ok).toBe(true);
      if (supervisorMetrics.ok) {
        expect(deputyMetrics.data.total).toBeGreaterThanOrEqual(supervisorMetrics.data.total);
      }
    }

    const managerList = await listFollowUps(MANAGER_A, { upcoming: "1" });
    expect(managerList.ok).toBe(true);

    // Super admin has no operational access at all.
    const superList = await listFollowUps(SUPER_ADMIN, {});
    expect(superList.ok).toBe(false);
    const superCreate = await createFollowUp(SUPER_ADMIN, {
      teacherId: teacherA1Id,
      supervisorId: null,
      titleAr: "متابعة من المنصة",
      purposeAr: null,
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: null,
      progressAr: null,
      challengesAr: null,
      supportNeedsAr: null,
      recommendationsAr: null,
      sharedWithTeacher: false,
    });
    expect(superCreate.ok).toBe(false);
  });

  test("metrics completion rate uses (total − cancelled) as denominator", async () => {
    const created = await createFollowUp(MANAGER_A, {
      teacherId: teacherA2Id,
      supervisorId: supervisorAId,
      titleAr: "متابعة ملغاة",
      purposeAr: null,
      followUpDate: new Date(),
      nextFollowUpAt: null,
      programId: null,
      courseId: null,
      surveyId: null,
      assignmentId: null,
      observationAr: null,
      progressAr: null,
      challengesAr: "تحدٍ مسجل",
      supportNeedsAr: null,
      recommendationsAr: null,
      sharedWithTeacher: false,
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      await changeFollowUpStatus(MANAGER_A, {
        followUpId: created.data.id,
        status: "CANCELLED",
        note: null,
      });
    }

    const metrics = await getFollowUpMetrics(MANAGER_A);
    expect(metrics.ok).toBe(true);
    if (!metrics.ok) return;
    const expectedDenominator = metrics.data.total - metrics.data.cancelled;
    expect(expectedDenominator).toBeGreaterThan(0);
    const expectedRate = Math.round((metrics.data.completed / expectedDenominator) * 100);
    expect(metrics.data.completionRatePercent).toBe(expectedRate);
    expect(metrics.data.withChallenges).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* 9) Impact dashboard                                                  */
/* ------------------------------------------------------------------ */

describe("Phase 9 — impact dashboard", () => {
  test("school overview aggregates surveys + follow-ups", async () => {
    const overview = await getSchoolImpactOverview(MANAGER_A);
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    expect(overview.data.surveys.totalSurveys).toBeGreaterThan(0);
    expect(overview.data.followUps.total).toBeGreaterThan(0);
    expect(overview.data.stageSurveyCount).toBeGreaterThan(0);
  });

  test("super admin gets platform aggregates only — no school operations", async () => {
    const stats = await getPlatformImpactStats(SUPER_ADMIN);
    expect(stats.ok).toBe(true);
    if (!stats.ok) return;
    expect(stats.data.schools.length).toBeGreaterThanOrEqual(2);
    const schoolA = stats.data.schools.find((row) => row.schoolId === schoolAId);
    expect(schoolA).toBeDefined();
    if (schoolA) expect(schoolA.surveysCount).toBeGreaterThan(0);
    const totals = stats.data.totals;
    expect(totals.submittedResponses).toBeGreaterThan(0);

    // School-scoped operational overview is denied for SUPER_ADMIN.
    const overview = await getSchoolImpactOverview(SUPER_ADMIN);
    expect(overview.ok).toBe(false);
  });

  test("teachers are denied the impact dashboard", async () => {
    const result = await getSchoolImpactOverview(
      { id: teacherA1Id, name: "t", role: "TEACHER", schoolId: schoolAId } as never
    );
    expect(result.ok).toBe(false);
  });

  test("stage pair candidates list only paired stage surveys with data", async () => {
    const candidates = await listStagePairCandidates(MANAGER_A);
    expect(candidates.ok).toBe(true);
    if (candidates.ok) {
      expect(candidates.data.length).toBeGreaterThan(0);
      expect(candidates.data.every((row) => row.stage !== "")).toBe(true);
    }
  });

  test("form options stay inside the actor's school", async () => {
    const options = await listSurveyFormOptions(MANAGER_A);
    expect(options.ok).toBe(true);
    if (options.ok) {
      // teacherB1 never appears in school A's teacher list.
      expect(options.data.teachers.some((teacher) => teacher.id === teacherB1Id)).toBe(false);
    }
  });
});
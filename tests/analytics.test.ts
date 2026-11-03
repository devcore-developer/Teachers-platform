/**
 * Phase 10 integration tests — dashboards, analytics, report center,
 * exports and archiving.
 *
 * Runs against the shared dedicated SQLite file (prisma/test-platform.db)
 * with the real Prisma client — no mocks. Covers: metric correctness
 * with exact numerators/denominators, empty/isolated datasets, role
 * visibility (five roles), school/branch isolation, supervisor and
 * teacher restrictions, deputy read-only paths, super-admin boundaries,
 * report filter validation and scope rejection, export content matching
 * the filtered dataset, Arabic text handling, CSV/Excel formula-injection
 * protection, and archive/restore with audit preservation.
 *
 * Run: bun test tests/analytics.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const TEST_DB_URL = `file:${path.join(PROJECT_ROOT, "prisma", "test-platform.db")}`;

process.env.DATABASE_URL = TEST_DB_URL;

execSync("bunx prisma db push --skip-generate --accept-data-loss", {
  cwd: PROJECT_ROOT,
  env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  stdio: "pipe",
});

// Dynamic imports after the env override.
const { db } = await import("@/lib/db");
const {
  getPlatformDashboard,
  getSchoolDashboard,
  getSupervisorDashboard,
  getTeacherDashboard,
} = await import("@/lib/analytics/service");
const {
  archiveFollowUp,
  restoreFollowUp,
  restoreAssignment,
  restoreAssessment,
  restoreCourse,
  restoreProgram,
  listArchivedRecords,
  listArchiveEvents,
} = await import("@/lib/archive/service");
const {
  buildReport,
  parseReportFilters,
  REPORT_CATALOG,
} = await import("@/lib/reports/service");
const {
  buildReportCsv,
  buildReportExcelXml,
  contentDispositionFor,
  escapeCsvCell,
  escapeXmlText,
  isUnsafeFormulaText,
} = await import("@/lib/reports/export");
const { listFollowUps, getFollowUpMetrics, updateFollowUp } = await import("@/lib/followups/service");
const { canExportReports, toAnalyticsActor } = await import("@/lib/analytics/access");
const { hashPassword } = await import("@/lib/auth/password");

/* ------------------------------------------------------------------ */
/* Fixtures: two schools, branches, all five roles, training content,   */
/* attempts, submissions, certificates, surveys, follow-ups, archives.  */
/* ------------------------------------------------------------------ */

const schoolAId = (
  await db.school.create({
    data: { nameAr: "مدرسة ت10 أ", nameEn: "P10 School A", slug: "p10-a" },
  })
).id;
const schoolBId = (
  await db.school.create({
    data: { nameAr: "مدرسة ت10 ب", nameEn: "P10 School B", slug: "p10-b" },
  })
).id;

const branchA1Id = (
  await db.branch.create({
    data: { schoolId: schoolAId, nameAr: "فرع ت10 الأول", nameNorm: "فرع ت10 الأول", stage: "primary" },
  })
).id;
const branchA2Id = (
  await db.branch.create({
    data: { schoolId: schoolAId, nameAr: "فرع ت10 الثاني", nameNorm: "فرع ت10 الثاني", stage: "secondary" },
  })
).id;

async function seedUser(
  email: string,
  role: string,
  schoolId: string | null,
  branchId: string | null = null,
  name?: string
): Promise<{ id: string; name: string }> {
  const user = await db.user.create({
    data: {
      name: name ?? `مستخدم ت10 (${email})`,
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

const superAdmin = await seedUser("p10-super@test.local", "SUPER_ADMIN", null);
const managerA = await seedUser("p10-manager-a@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolAId);
const managerB = await seedUser("p10-manager-b@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolBId);
const deputyA = await seedUser("p10-deputy-a@test.local", "EDUCATIONAL_DEPUTY", schoolAId);
const deputyNone = await seedUser("p10-deputy-none@test.local", "EDUCATIONAL_DEPUTY", schoolAId);
const supervisorA = await seedUser("p10-supervisor-a@test.local", "EDUCATIONAL_SUPERVISOR", schoolAId);
const supervisorC = await seedUser("p10-supervisor-c@test.local", "EDUCATIONAL_SUPERVISOR", schoolAId);
const teacherA1 = await seedUser("p10-teacher-a1@test.local", "TEACHER", schoolAId, branchA1Id);
const teacherA2 = await seedUser("p10-teacher-a2@test.local", "TEACHER", schoolAId, branchA1Id);
const teacherA3 = await seedUser("p10-teacher-a3@test.local", "TEACHER", schoolAId, branchA2Id);
const teacherA4 = await seedUser(
  "p10-teacher-a4@test.local",
  "TEACHER",
  schoolAId,
  branchA1Id,
  "=HYPERLINK('http://evil.example')"
);
const teacherB1 = await seedUser("p10-teacher-b1@test.local", "TEACHER", schoolBId);

const actorOf = (user: { id: string; name: string }, role: string, schoolId: string | null) =>
  ({ id: user.id, name: user.name, role, schoolId, branchId: null } as never);

const SUPER = actorOf(superAdmin, "SUPER_ADMIN", null);
const MANAGER_A = actorOf(managerA, "DEVELOPMENT_OFFICE_MANAGER", schoolAId);
const MANAGER_B = actorOf(managerB, "DEVELOPMENT_OFFICE_MANAGER", schoolBId);
const DEPUTY_A = actorOf(deputyA, "EDUCATIONAL_DEPUTY", schoolAId);
const DEPUTY_NONE = actorOf(deputyNone, "EDUCATIONAL_DEPUTY", schoolAId);
const SUPERVISOR_A = actorOf(supervisorA, "EDUCATIONAL_SUPERVISOR", schoolAId);
const SUPERVISOR_C = actorOf(supervisorC, "EDUCATIONAL_SUPERVISOR", schoolAId);

await db.deputyGrant.create({ data: { userId: deputyA.id, schoolId: schoolAId, branchId: null } });

// Supervisor A: branch grant on A1 + explicit assignments of A1 and A2.
await db.supervisorAssignment.create({
  data: { supervisorId: supervisorA.id, schoolId: schoolAId, branchId: branchA1Id },
});
await db.teacherSupervisorAssignment.create({
  data: { teacherId: teacherA1.id, supervisorId: supervisorA.id, schoolId: schoolAId },
});
await db.teacherSupervisorAssignment.create({
  data: { teacherId: teacherA2.id, supervisorId: supervisorA.id, schoolId: schoolAId },
});

const programA = await db.trainingProgram.create({
  data: {
    schoolId: schoolAId,
    nameAr: "برنامج ت10",
    nameNorm: "برنامج ت10",
    descriptionAr: "وصف البرنامج",
    descriptionEn: null,
    category: "pedagogy",
    status: "PUBLISHED",
    createdById: managerA.id,
  },
});
const programArch = await db.trainingProgram.create({
  data: {
    schoolId: schoolAId,
    nameAr: "برنامج ت10 مؤرشف",
    nameNorm: "برنامج ت10 مؤرشف",
    descriptionAr: "وصف",
    descriptionEn: null,
    category: "pedagogy",
    status: "ARCHIVED",
    createdById: managerA.id,
  },
});

const courseA1 = await db.course.create({
  data: {
    programId: programA.id,
    schoolId: schoolAId,
    titleAr: "دورة ت10 الأولى",
    descriptionAr: "وصف",
    descriptionEn: null,
    category: "pedagogy",
    status: "PUBLISHED",
    createdById: managerA.id,
  },
});
const courseA2 = await db.course.create({
  data: {
    schoolId: schoolAId,
    titleAr: "دورة ت10 الثانية",
    descriptionAr: "وصف",
    descriptionEn: null,
    category: "pedagogy",
    status: "PUBLISHED",
    createdById: managerA.id,
  },
});
const coursePlat = await db.course.create({
  data: {
    schoolId: null,
    titleAr: "دورة ت10 عامة",
    descriptionAr: "دورة على مستوى المنصة",
    descriptionEn: null,
    category: "pedagogy",
    status: "PUBLISHED",
    createdById: superAdmin.id,
  },
});
const courseA3Arch = await db.course.create({
  data: {
    schoolId: schoolAId,
    titleAr: "دورة ت10 مؤرشفة منشورة سابقًا",
    descriptionAr: "وصف",
    descriptionEn: null,
    category: "pedagogy",
    status: "ARCHIVED",
    publishedAt: new Date(),
    createdById: managerA.id,
  },
});
const courseA4Arch = await db.course.create({
  data: {
    schoolId: schoolAId,
    titleAr: "دورة ت10 مؤرشفة لم تُنشر",
    descriptionAr: "وصف",
    descriptionEn: null,
    category: "pedagogy",
    status: "ARCHIVED",
    createdById: managerA.id,
  },
});
const coursePlatArch = await db.course.create({
  data: {
    schoolId: null,
    titleAr: "دورة ت10 عامة مؤرشفة",
    descriptionAr: "وصف",
    descriptionEn: null,
    category: "pedagogy",
    status: "ARCHIVED",
    publishedAt: new Date(),
    createdById: superAdmin.id,
  },
});

const assessmentA1 = await db.assessment.create({
  data: {
    schoolId: schoolAId,
    courseId: courseA1.id,
    titleAr: "تقييم ت10 الأول",
    instructionsAr: "أجب عن جميع الأسئلة",
    status: "PUBLISHED",
    passingScore: 6,
    maxScore: 10,
    createdById: managerA.id,
  },
});
const assessmentA2 = await db.assessment.create({
  data: {
    schoolId: schoolAId,
    courseId: courseA2.id,
    titleAr: "تقييم ت10 الثاني",
    instructionsAr: "أجب",
    status: "PUBLISHED",
    passingScore: 5,
    maxScore: 10,
    createdById: managerA.id,
  },
});
const assessmentA3 = await db.assessment.create({
  data: {
    schoolId: schoolAId,
    courseId: courseA2.id,
    titleAr: "تقييم ت10 الثالث",
    instructionsAr: "أجب",
    status: "PUBLISHED",
    passingScore: 5,
    maxScore: 10,
    createdById: managerA.id,
  },
});
const assessmentArch = await db.assessment.create({
  data: {
    schoolId: schoolAId,
    titleAr: "تقييم ت10 مؤرشف",
    instructionsAr: "—",
    status: "ARCHIVED",
    passingScore: 1,
    maxScore: 10,
    createdById: managerA.id,
  },
});

await db.assessmentAttempt.create({
  data: {
    assessmentId: assessmentA1.id,
    userId: teacherA1.id,
    status: "PASSED",
    submittedAt: new Date(),
    objectiveScore: 8,
    earnedScore: 8,
    maxScore: 10,
    percentage: 80,
    passed: true,
  },
});
await db.assessmentAttempt.create({
  data: {
    assessmentId: assessmentA1.id,
    userId: teacherA2.id,
    status: "FAILED",
    submittedAt: new Date(),
    objectiveScore: 4,
    earnedScore: 4,
    maxScore: 10,
    percentage: 40,
    passed: false,
  },
});
await db.assessmentAttempt.create({
  data: {
    assessmentId: assessmentA1.id,
    userId: teacherA3.id,
    status: "PASSED",
    submittedAt: new Date(),
    objectiveScore: 10,
    earnedScore: 10,
    maxScore: 10,
    percentage: 100,
    passed: true,
  },
});
await db.assessmentAttempt.create({
  data: {
    assessmentId: assessmentA2.id,
    userId: teacherA1.id,
    status: "NEEDS_REVIEW",
    submittedAt: new Date(),
    objectiveScore: 5,
    maxScore: 10,
  },
});

for (const [user, course] of [
  [teacherA1, courseA1],
  [teacherA1, courseA2],
  [teacherA1, coursePlat],
  [teacherA2, courseA1],
  [teacherA3, courseA2],
  [teacherB1, courseA1],
] as const) {
  await db.courseEnrollment.create({
    data: { courseId: course.id, userId: user.id, status: "ACTIVE" },
  });
}

const assignmentA1 = await db.assignment.create({
  data: {
    schoolId: schoolAId,
    createdById: managerA.id,
    titleAr: "تكليف ت10",
    descriptionAr: "وصف التكليف",
    status: "PUBLISHED",
    audienceMode: "ALL_TEACHERS",
    dueAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    totalPoints: 10,
  },
});
const assignmentArch = await db.assignment.create({
  data: {
    schoolId: schoolAId,
    createdById: managerA.id,
    titleAr: "تكليف ت10 مؤرشف",
    descriptionAr: "وصف",
    status: "ARCHIVED",
    audienceMode: "ALL_TEACHERS",
    dueAt: new Date(),
    totalPoints: 10,
  },
});
await db.assignmentSubmission.create({
  data: {
    assignmentId: assignmentA1.id,
    teacherId: teacherA1.id,
    schoolId: schoolAId,
    status: "GRADED",
    responseText: "إجابتي",
    submittedAt: new Date(),
    scoreTotal: 8,
    feedbackText: "عمل جيد جدًا مع ملاحظات على التنسيق",
    reviewedById: managerA.id,
    reviewedAt: new Date(),
  },
});
await db.assignmentSubmission.create({
  data: {
    assignmentId: assignmentA1.id,
    teacherId: teacherA2.id,
    schoolId: schoolAId,
    status: "SUBMITTED",
    responseText: "إجابتي الثانية",
    submittedAt: new Date(),
  },
});
await db.assignmentSubmission.create({
  data: {
    assignmentId: assignmentA1.id,
    teacherId: teacherA3.id,
    schoolId: schoolAId,
    status: "DRAFT",
  },
});

await db.certificate.create({
  data: {
    schoolId: schoolAId,
    teacherId: teacherA1.id,
    certificateNumber: "MQ-P10-000001",
    verificationCode: "P10CODE00000000A",
    titleAr: "شهادة إتمام دورة ت10 الأولى",
    courseId: courseA1.id,
    status: "ISSUED",
    issuedAt: new Date(),
    issuedById: managerA.id,
  },
});
await db.certificate.create({
  data: {
    schoolId: schoolAId,
    teacherId: teacherA2.id,
    certificateNumber: "MQ-P10-000002",
    verificationCode: "P10CODE00000000B",
    titleAr: "شهادة ملغاة",
    courseId: courseA1.id,
    status: "REVOKED",
    issuedAt: new Date(),
    issuedById: managerA.id,
    revokedById: managerA.id,
    revokedAt: new Date(),
    revocationReason: "خطأ إداري",
  },
});
await db.certificate.create({
  data: {
    schoolId: schoolAId,
    teacherId: teacherA3.id,
    certificateNumber: "MQ-P10-000003",
    verificationCode: "P10CODE00000000C",
    titleAr: "شهادة منتهية",
    courseId: courseA1.id,
    status: "ISSUED",
    issuedAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
    expiresAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    issuedById: managerA.id,
  },
});

const surveyA1 = await db.survey.create({
  data: {
    schoolId: schoolAId,
    ownerUserId: managerA.id,
    titleAr: "استبيان ت10 الموجه",
    status: "PUBLISHED",
    audienceMode: "TEACHERS",
    targetTeacherIdsJson: JSON.stringify([teacherA1.id, teacherA2.id]),
    publishedAt: new Date(),
  },
});
const surveyA2 = await db.survey.create({
  data: {
    schoolId: schoolAId,
    ownerUserId: managerA.id,
    titleAr: "استبيان ت10 المغلق",
    status: "CLOSED",
    audienceMode: "ALL_TEACHERS",
    publishedAt: new Date(),
    closedAt: new Date(),
  },
});
const surveyA3 = await db.survey.create({
  data: {
    schoolId: schoolAId,
    ownerUserId: managerA.id,
    titleAr: "استبيان ت10 الثالث",
    status: "PUBLISHED",
    audienceMode: "TEACHERS",
    targetTeacherIdsJson: JSON.stringify([teacherA3.id]),
    publishedAt: new Date(),
  },
});
await db.surveyResponse.create({
  data: { surveyId: surveyA1.id, schoolId: schoolAId, respondentId: teacherA1.id, status: "SUBMITTED", submittedAt: new Date() },
});
await db.surveyResponse.create({
  data: { surveyId: surveyA1.id, schoolId: schoolAId, respondentId: teacherA2.id, status: "SUBMITTED", submittedAt: new Date() },
});

const followUpA1 = await db.followUp.create({
  data: {
    schoolId: schoolAId,
    teacherId: teacherA1.id,
    supervisorId: supervisorA.id,
    createdById: managerA.id,
    titleAr: "متابعة ت10 مكتملة",
    followUpDate: new Date(Date.now() - 7 * 24 * 3600 * 1000),
    status: "COMPLETED",
    completedAt: new Date(),
    progressAr: "طبقت المعلم استراتيجية التعلم النشط",
  },
});
const followUpA2 = await db.followUp.create({
  data: {
    schoolId: schoolAId,
    teacherId: teacherA1.id,
    supervisorId: supervisorA.id,
    createdById: managerA.id,
    titleAr: "متابعة ت10 متأخرة",
    followUpDate: new Date(Date.now() - 14 * 24 * 3600 * 1000),
    status: "PLANNED",
  },
});
const followUpA3 = await db.followUp.create({
  data: {
    schoolId: schoolAId,
    teacherId: teacherA3.id,
    supervisorId: supervisorC.id,
    createdById: managerA.id,
    titleAr: "متابعة ت10 لمشرف آخر",
    followUpDate: new Date(),
    status: "PLANNED",
  },
});
const followUpA4 = await db.followUp.create({
  data: {
    schoolId: schoolAId,
    teacherId: teacherA1.id,
    supervisorId: supervisorA.id,
    createdById: managerA.id,
    titleAr: "متابعة ت10 مؤرشفة مسبقًا",
    followUpDate: new Date(),
    status: "COMPLETED",
    archivedAt: new Date(),
  },
});

/* ------------------------------------------------------------------ */
/* 1) Platform dashboard (SUPER_ADMIN)                                  */
/* ------------------------------------------------------------------ */

describe("Phase 10 — platform dashboard", () => {
  test("super admin sees both schools with per-school aggregates", async () => {
    const result = await getPlatformDashboard(SUPER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = result.data;
    expect(stats.schoolsTotal).toBeGreaterThanOrEqual(2);
    const schoolARow = stats.perSchool.find((row) => row.schoolId === schoolAId);
    const schoolBRow = stats.perSchool.find((row) => row.schoolId === schoolBId);
    expect(schoolARow).toBeDefined();
    expect(schoolBRow).toBeDefined();
    if (schoolARow && schoolBRow) {
      expect(schoolARow.teachers).toBe(4);
      expect(schoolBRow.teachers).toBe(1);
      expect(schoolARow.surveys).toBe(3);
    }
    expect(stats.teachersActive).toBeGreaterThanOrEqual(5);
    expect(stats.enrollmentsTotal).toBeGreaterThanOrEqual(6);
    expect(stats.surveyResponsesSubmitted).toBeGreaterThanOrEqual(2);
    expect(stats.trends.labels.length).toBe(6);
    expect(stats.trends.enrollments.length).toBe(6);
  });

  test("users by role covers the five canonical roles", async () => {
    const result = await getPlatformDashboard(SUPER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roles = result.data.usersByRole.map((row) => row.role);
    expect(roles).toEqual([
      "SUPER_ADMIN",
      "DEVELOPMENT_OFFICE_MANAGER",
      "EDUCATIONAL_DEPUTY",
      "EDUCATIONAL_SUPERVISOR",
      "TEACHER",
    ]);
    const teachers = result.data.usersByRole.find((row) => row.role === "TEACHER");
    expect(teachers?.count).toBeGreaterThanOrEqual(5);
  });

  test("non-super roles are denied the platform dashboard", async () => {
    expect((await getPlatformDashboard(MANAGER_A)).ok).toBe(false);
    expect((await getPlatformDashboard(DEPUTY_A)).ok).toBe(false);
    expect((await getPlatformDashboard(SUPERVISOR_A)).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 2) School dashboard (manager + deputy) — exact metrics               */
/* ------------------------------------------------------------------ */

describe("Phase 10 — school dashboard metrics", () => {
  test("manager gets exact numerators/denominators for school A", async () => {
    const result = await getSchoolDashboard(MANAGER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = result.data;
    expect(stats.schoolName).toBe("مدرسة ت10 أ");
    expect(stats.teachersActive).toBe(4);
    expect(stats.enrollmentsTotal).toBe(5);
    expect(stats.enrolledTeachers).toBe(3);
    expect(stats.enrollmentRatePercent).toBe(75);
    // Completion pairs: A1×courseA1 (passed) + A1×coursePlat (vacuous).
    expect(stats.coursesCompletedPairs).toBe(2);
    expect(stats.attemptsFinalized).toBe(3);
    expect(stats.attemptsPassed).toBe(2);
    expect(stats.passRatePercent).toBe(67);
    expect(stats.avgPercentage).toBe(73);
    expect(stats.attemptsNeedingReview).toBe(1);
    expect(stats.assignmentsPublished).toBe(1);
    expect(stats.submissionsActive).toBe(2);
    expect(stats.submissionsPendingReview).toBe(1);
    expect(stats.submissionsGraded).toBe(1);
    expect(stats.certificatesIssued).toBe(2);
    expect(stats.certificatesRevoked).toBe(1);
    expect(stats.certificatesExpired).toBe(1);
    expect(stats.surveys.totalSurveys).toBe(3);
    expect(stats.surveys.openSurveys).toBe(2);
    expect(stats.surveys.submittedResponses).toBe(2);
    // Pooled rate: 2 submitted ÷ (2 + 4 + 1) eligible = 29%.
    expect(stats.surveys.averageResponseRatePercent).toBe(29);
    // followUps: A4 (archived) is excluded — A1 COMPLETED + A2/A3 PLANNED.
    expect(stats.followUps.total).toBe(3);
    expect(stats.followUps.completed).toBe(1);
    expect(stats.followUps.completionRatePercent).toBe(33);
    expect(stats.followUpsOverdue).toBe(1);
    expect(stats.trends.labels.length).toBe(6);
    // All six p10-A enrollments happened this month (B teacher excluded).
    expect(stats.trends.enrollments[5]).toBe(5);
  });

  test("cross-school teacher's enrollment never counts in school A", async () => {
    const enrollment = await db.courseEnrollment.findFirst({
      where: { userId: teacherB1.id, courseId: courseA1.id },
      select: { id: true },
    });
    expect(enrollment).not.toBeNull();
    const result = await getSchoolDashboard(MANAGER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.enrollmentsTotal).toBe(5);
  });

  test("manager B sees only school B data (isolation)", async () => {
    const result = await getSchoolDashboard(MANAGER_B);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.schoolId).toBe(schoolBId);
    expect(result.data.teachersActive).toBe(1);
    expect(result.data.surveys.totalSurveys).toBe(0);
    // teacherB1's enrollment in school A's course is honestly visible to
    // school B (the enrollment belongs to THEIR teacher).
    expect(result.data.enrollmentsTotal).toBe(1);
    expect(result.data.passRatePercent).toBeNull();
  });

  test("deputy with grant gets the same read-only school numbers; deputy without grants is denied", async () => {
    const deputyResult = await getSchoolDashboard(DEPUTY_A);
    const managerResult = await getSchoolDashboard(MANAGER_A);
    expect(deputyResult.ok).toBe(true);
    expect(managerResult.ok).toBe(true);
    if (deputyResult.ok && managerResult.ok) {
      expect(deputyResult.data.teachersActive).toBe(managerResult.data.teachersActive);
      expect(deputyResult.data.enrollmentsTotal).toBe(managerResult.data.enrollmentsTotal);
    }
    expect((await getSchoolDashboard(DEPUTY_NONE)).ok).toBe(false);
    expect((await getSchoolDashboard(SUPER)).ok).toBe(false);
    expect((await getSchoolDashboard(SUPERVISOR_A)).ok).toBe(false);
  });

  test("empty school branch list yields an empty branch table without NaN", async () => {
    const result = await getSchoolDashboard(MANAGER_B);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.teachersByBranch.length).toBe(0);
    expect(result.data.avgPercentage).toBeNull();
    expect(result.data.surveys.averageResponseRatePercent).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 3) Supervisor dashboard                                              */
/* ------------------------------------------------------------------ */

describe("Phase 10 — supervisor dashboard", () => {
  test("coverage = explicit assignments ∪ branch grants; queues are scoped", async () => {
    const result = await getSupervisorDashboard(SUPERVISOR_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = result.data;
    // Assigned A1+A2 ∪ branch A1 (A1, A2, A4) = 3 distinct teachers.
    expect(stats.coverageTeacherCount).toBe(3);
    expect(stats.coverageBranchCount).toBe(1);
    const rosterNames = stats.roster.map((row) => row.teacherName).sort();
    expect(rosterNames.length).toBe(3);
    // Only teachers inside coverage appear.
    expect(rosterNames.join("|")).not.toContain(teacherA3.name);
    expect(stats.submissionsPendingReview).toBe(1);
    expect(stats.attemptsNeedingReview).toBe(1);
    expect(stats.followUps.total).toBe(2);
    expect(stats.followUps.completionRatePercent).toBe(50);
    expect(stats.certificatesActive).toBe(1);
  });

  test("supervisor C (no grants, no assignments) gets an empty scope", async () => {
    const result = await getSupervisorDashboard(SUPERVISOR_C);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.coverageTeacherCount).toBe(0);
    expect(result.data.roster.length).toBe(0);
    expect(result.data.submissionsPendingReview).toBe(0);
    expect(result.data.attemptsNeedingReview).toBe(0);
  });

  test("non-supervisor roles are denied", async () => {
    expect((await getSupervisorDashboard(MANAGER_A)).ok).toBe(false);
    expect((await getSupervisorDashboard(SUPER)).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 4) Teacher dashboard                                                 */
/* ------------------------------------------------------------------ */

describe("Phase 10 — teacher dashboard", () => {
  test("teacher A1 sees own courses, completion, feedback and certificates", async () => {
    const result = await getTeacherDashboard({ id: teacherA1.id, role: "TEACHER", schoolId: schoolAId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = result.data;
    expect(stats.courses.length).toBe(3);
    expect(stats.coursesCompleted).toBe(2);
    expect(stats.availableAssessments).toBe(1);
    expect(stats.attemptsFinalized).toBe(1);
    expect(stats.attemptsPassed).toBe(1);
    expect(stats.avgPercentage).toBe(80);
    expect(stats.assignmentsGraded).toBe(1);
    expect(stats.assignmentsAwaitingReview).toBe(0);
    expect(stats.recentFeedback.length).toBe(1);
    expect(stats.recentFeedback[0].feedbackText).toContain("عمل جيد جدًا");
    expect(stats.certificatesActive).toBe(1);
    expect(stats.surveysAwaiting).toBe(0);
  });

  test("teacher A3 sees own draft as pending and the eligible survey as awaiting", async () => {
    const result = await getTeacherDashboard({ id: teacherA3.id, role: "TEACHER", schoolId: schoolAId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = result.data;
    expect(stats.courses.length).toBe(1);
    expect(stats.availableAssessments).toBe(2);
    expect(stats.assignmentsPending).toBe(1);
    expect(stats.assignmentsGraded).toBe(0);
    expect(stats.surveysAwaiting).toBe(1); // surveyA3 targets A3 and is unanswered
  });

  test("teacher A2 already answered the targeted survey — nothing awaiting", async () => {
    const result = await getTeacherDashboard({ id: teacherA2.id, role: "TEACHER", schoolId: schoolAId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.surveysAwaiting).toBe(0);
  });

  test("non-teacher roles are denied the teacher dashboard", async () => {
    expect(
      (await getTeacherDashboard({ id: managerA.id, role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: schoolAId })).ok
    ).toBe(false);
    expect((await getTeacherDashboard({ id: superAdmin.id, role: "SUPER_ADMIN", schoolId: null })).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 5) Report filters — validation + scope rejection                     */
/* ------------------------------------------------------------------ */

describe("Phase 10 — report filter validation", () => {
  test("catalog exposes exactly the nine Phase 10 reports", () => {
    expect(REPORT_CATALOG.length).toBe(9);
    expect(REPORT_CATALOG.map((report) => report.id)).toContain("development-summary");
  });

  test("manager cannot request another school", async () => {
    const result = await parseReportFilters(MANAGER_A, { schoolId: schoolBId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("manager cannot filter by a teacher outside their visibility", async () => {
    const result = await parseReportFilters(MANAGER_A, { teacherId: teacherB1.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("supervisor cannot filter by a teacher outside their coverage", async () => {
    const result = await parseReportFilters(SUPERVISOR_A, { teacherId: teacherA3.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("supervisor can filter by a covered teacher", async () => {
    const result = await parseReportFilters(SUPERVISOR_A, { teacherId: teacherA1.id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.teacherId).toBe(teacherA1.id);
  });

  test("invalid date order is rejected", async () => {
    const result = await parseReportFilters(MANAGER_A, {
      dateFrom: "2026-06-01",
      dateTo: "2026-01-01",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  test("invalid date strings are rejected", async () => {
    const result = await parseReportFilters(MANAGER_A, { dateFrom: "not-a-date" });
    expect(result.ok).toBe(false);
  });

  test("super admin must pick a school explicitly", async () => {
    const result = await parseReportFilters(SUPER, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
    const okResult = await parseReportFilters(SUPER, { schoolId: schoolAId });
    expect(okResult.ok).toBe(true);
  });

  test("deputy without grants cannot reach school reports", async () => {
    const result = await parseReportFilters(DEPUTY_NONE, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("branch filter must belong to the resolved school", async () => {
    const wrongBranch = await parseReportFilters(MANAGER_B, {});
    expect(wrongBranch.ok).toBe(true);
    const crossBranch = await parseReportFilters(MANAGER_B, { branchId: branchA1Id });
    expect(crossBranch.ok).toBe(false);
    if (!crossBranch.ok) expect(crossBranch.code).toBe("VALIDATION_ERROR");
  });
});

/* ------------------------------------------------------------------ */
/* 6) Report datasets — content matches the filtered scope              */
/* ------------------------------------------------------------------ */

describe("Phase 10 — report datasets", () => {
  test("school overview lists branches with exact teacher counts", async () => {
    const filters = await parseReportFilters(MANAGER_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(MANAGER_A, "school-overview", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const rows = report.data.rows;
    expect(rows.length).toBe(2);
    const branchA1Row = rows.find((row) => row.values.branch === "فرع ت10 الأول");
    expect(branchA1Row?.values.teachers).toBe(3);
    expect(branchA1Row?.values.enrollments).toBe(4);
    const branchA2Row = rows.find((row) => row.values.branch === "فرع ت10 الثاني");
    expect(branchA2Row?.values.teachers).toBe(1);
    const summary = report.data.summary.find((item) => item.label === "نسبة الالتحاق");
    expect(summary?.value).toBe("75%");
  });

  test("teacher directory is scope-bounded for supervisors and includes branch data", async () => {
    const filters = await parseReportFilters(SUPERVISOR_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(SUPERVISOR_A, "teacher-directory", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // Branch grant A1 pulls A1, A2 and A4 into coverage.
    expect(report.data.rows.length).toBe(3);
    const teacherA1Row = report.data.rows.find((row) => row.values.teacher === teacherA1.name);
    expect(teacherA1Row?.values.enrollments).toBe(3);
    expect(teacherA1Row?.values.completed).toBe(2);
    expect(teacherA1Row?.values.avgScore).toBe(80);
    expect(teacherA1Row?.values.certificates).toBe(1);
    // A3 (branch A2, unassigned) never leaks into the supervisor's rows.
    expect(report.data.rows.find((row) => row.values.teacher === teacherA3.name)).toBeUndefined();
  });

  test("teacher directory carries raw names (injection handled at export layer)", async () => {
    const filters = await parseReportFilters(MANAGER_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(MANAGER_A, "teacher-directory", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.rows.length).toBe(4);
    const injectionRow = report.data.rows.find((row) => row.values.teacher === "=HYPERLINK('http://evil.example')");
    expect(injectionRow).toBeDefined();
  });

  test("training completion counts only school teachers and applies the eligibility rule", async () => {
    const filters = await parseReportFilters(MANAGER_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(MANAGER_A, "training-completion", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const courseA1Row = report.data.rows.find((row) => row.values.course === "دورة ت10 الأولى");
    expect(courseA1Row?.values.enrollments).toBe(2);
    expect(courseA1Row?.values.completions).toBe(1);
    expect(courseA1Row?.values.completionRate).toBe(50);
    const platRow = report.data.rows.find((row) => row.values.course === "دورة ت10 عامة");
    expect(platRow?.values.enrollments).toBe(1);
    expect(platRow?.values.completions).toBe(1);
    expect(platRow?.values.completionRate).toBe(100);
  });

  test("assessment performance: finalized denominator excludes NEEDS_REVIEW", async () => {
    const filters = await parseReportFilters(MANAGER_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(MANAGER_A, "assessment-performance", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const row = report.data.rows.find((row) => row.values.assessment === "تقييم ت10 الأول");
    expect(row?.values.finalized).toBe(3);
    expect(row?.values.passed).toBe(2);
    expect(row?.values.passRate).toBe(67);
    expect(row?.values.avgScore).toBe(73);
  });

  test("assignment status: targeted counts and grade averages", async () => {
    const filters = await parseReportFilters(MANAGER_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(MANAGER_A, "assignment-status", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const row = report.data.rows.find((row) => row.values.assignment === "تكليف ت10");
    expect(row?.values.targeted).toBe(4);
    expect(row?.values.submitted).toBe(2);
    expect(row?.values.graded).toBe(1);
    expect(row?.values.avgScore).toBe(80);
    // Archived assignment excluded by default (status filter defaults to active set).
    expect(report.data.rows.find((row) => row.values.assignment === "تكليف ت10 مؤرشف")).toBeUndefined();
  });

  test("certificates report derives the effective EXPIRED status", async () => {
    const filters = await parseReportFilters(MANAGER_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(MANAGER_A, "certificates-growth", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.rows.length).toBe(3);
    const expiredRow = report.data.rows.find((row) => row.values.number === "MQ-P10-000003");
    expect(expiredRow?.values.status).toBe("منتهية الصلاحية");
    const summary = report.data.summary.find((item) => item.label === "سارية");
    expect(summary?.value).toBe("1");
  });

  test("certificates report honors the status filter", async () => {
    const filters = await parseReportFilters(MANAGER_A, { status: "ISSUED" });
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(MANAGER_A, "certificates-growth", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.rows.length).toBe(2);
  });

  test("survey results report shows response rates with real audiences — aggregates only", async () => {
    const filters = await parseReportFilters(MANAGER_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(MANAGER_A, "survey-results", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const targeted = report.data.rows.find((row) => row.values.survey === "استبيان ت10 الموجه");
    expect(targeted?.values.audience).toBe(2);
    expect(targeted?.values.responses).toBe(2);
    expect(targeted?.values.responseRate).toBe(100);
    const closed = report.data.rows.find((row) => row.values.survey === "استبيان ت10 المغلق");
    expect(closed?.values.responseRate).toBe(0);
    // No individual answer text ever appears in the columns.
    expect(report.data.columns.some((column) => column.key === "answers")).toBe(false);
  });

  test("follow-up activity report excludes archived records", async () => {
    const filters = await parseReportFilters(MANAGER_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(MANAGER_A, "followup-activity", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.rows.length).toBe(3);
    expect(
      report.data.rows.find((row) => row.values.title === "متابعة ت10 مؤرشفة مسبقًا")
    ).toBeUndefined();
  });

  test("supervisor sees only their coverage rows in the follow-up report", async () => {
    const filters = await parseReportFilters(SUPERVISOR_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(SUPERVISOR_A, "followup-activity", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // Responsible for A1/A2 records; teacherA3's record belongs to supervisor C.
    expect(report.data.rows.length).toBe(2);
  });

  test("development summary separates facts, metrics and readings", async () => {
    const filters = await parseReportFilters(MANAGER_A, {});
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(MANAGER_A, "development-summary", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.sections?.length).toBe(4);
    const metricsSection = report.data.sections?.[1];
    const enrollment = metricsSection?.items.find((item) => item.label === "نسبة الالتحاق بالتدريب");
    expect(enrollment?.value).toBe("75%");
    expect(enrollment?.note).toContain("المقام");
    const readings = report.data.sections?.[3];
    expect(readings?.items.length).toBe(5);
    expect(readings?.note).toContain("لا تدّعي");
  });

  test("super admin can build a school report read-only with explicit school", async () => {
    const filters = await parseReportFilters(SUPER, { schoolId: schoolAId });
    expect(filters.ok).toBe(true);
    if (!filters.ok) return;
    const report = await buildReport(SUPER, "school-overview", filters.data);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.data.meta.schoolName).toBe("مدرسة ت10 أ");
  });
});

/* ------------------------------------------------------------------ */
/* 7) Exports — CSV/Excel, Arabic, injection protection                 */
/* ------------------------------------------------------------------ */

describe("Phase 10 — export builders", () => {
  async function directoryCsv() {
    const filters = await parseReportFilters(MANAGER_A, {});
    if (!filters.ok) throw new Error("filters failed");
    const report = await buildReport(MANAGER_A, "teacher-directory", filters.data);
    if (!report.ok) throw new Error("report failed");
    return buildReportCsv(report.data);
  }

  test("CSV starts with UTF-8 BOM and preserves Arabic", async () => {
    const csv = await directoryCsv();
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("دليل المعلمين والمشاركة");
    expect(csv).toContain("مدرسة ت10 أ");
    expect(csv).toContain(teacherA1.name);
  });

  test("CSV neutralizes formula injection in text cells only", async () => {
    const csv = await directoryCsv();
    expect(csv).toContain("'=HYPERLINK('http://evil.example')");
    expect(csv).not.toContain("\n=HYPERLINK");
  });

  test("escapeCsvCell covers the OWASP leading-character set", () => {
    expect(escapeCsvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(escapeCsvCell("+1+1")).toBe("'+1+1");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("@SUM(1)")).toBe("'@SUM(1)");
    expect(escapeCsvCell("مدرسة سلام")).toBe("مدرسة سلام");
    expect(escapeCsvCell('a"b,c')).toBe('"a""b,c"');
    expect(isUnsafeFormulaText("-خالد")).toBe(true);
    expect(isUnsafeFormulaText("خالد")).toBe(false);
  });

  test("CSV dataset matches the on-screen rows (same builder)", async () => {
    const csv = await directoryCsv();
    const dataLines = csv.split("\r\n").filter((line) => line.includes(teacherA1.name));
    expect(dataLines.length).toBe(1);
    // A1: 3 enrollments, 2 completed, 80 avg, 1 submission, 1 certificate.
    expect(dataLines[0]).toContain(",3,");
    expect(dataLines[0]).toContain(",2,");
  });

  test("Excel XML keeps RTL and escapes XML entities", async () => {
    const filters = await parseReportFilters(MANAGER_A, {});
    if (!filters.ok) throw new Error("filters failed");
    const report = await buildReport(MANAGER_A, "school-overview", filters.data);
    if (!report.ok) throw new Error("report failed");
    const xml = buildReportExcelXml(report.data);
    expect(xml).toContain("DisplayRightToLeft");
    expect(xml).toContain('encoding="UTF-8"');
    expect(xml).toContain("مدرسة ت10 أ");
    // XML-unsafe characters never reach the sheet unescaped.
    expect(escapeXmlText("<R&D>")).toBe("&lt;R&amp;D&gt;");
    expect(escapeXmlText('مدرسة "الأمل"')).toBe("مدرسة &quot;الأمل&quot;");
  });

  test("export permission excludes teachers", () => {
    expect(canExportReports("TEACHER")).toBe(false);
    expect(canExportReports("DEVELOPMENT_OFFICE_MANAGER")).toBe(true);
    expect(canExportReports("EDUCATIONAL_DEPUTY")).toBe(true);
    expect(canExportReports("EDUCATIONAL_SUPERVISOR")).toBe(true);
    expect(canExportReports("SUPER_ADMIN")).toBe(true);
  });

  test("content disposition encodes Arabic filenames per RFC 5987", () => {
    const header = contentDispositionFor("دليل المعلمين", "csv");
    expect(header).toContain('filename="report-');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent("دليل المعلمين.csv"));
  });

  test("actor projection rejects unknown roles", () => {
    expect(toAnalyticsActor({ id: "x", role: "UNKNOWN", schoolId: null, branchId: null })).toBeNull();
    expect(toAnalyticsActor({ id: "x", role: "TEACHER", schoolId: "s", branchId: null })?.role).toBe("TEACHER");
  });
});

/* ------------------------------------------------------------------ */
/* 8) Archive — follow-up archive/restore with audit                    */
/* ------------------------------------------------------------------ */

describe("Phase 10 — follow-up archive & restore", () => {
  test("manager archives a follow-up: soft fields set, lists/metrics exclude it, audits written", async () => {
    const archived = await archiveFollowUp(MANAGER_A, followUpA1.id);
    expect(archived.ok).toBe(true);

    const after = await db.followUp.findUnique({ where: { id: followUpA1.id } });
    expect(after?.archivedAt).not.toBeNull();
    expect(after?.status).toBe("COMPLETED"); // status preserved

    const metrics = await getFollowUpMetrics(MANAGER_A);
    expect(metrics.ok).toBe(true);
    if (metrics.ok) expect(metrics.data.total).toBe(2); // A4 + A1 hidden

    const followUpEvent = await db.followUpEvent.findFirst({
      where: { followUpId: followUpA1.id, type: "ARCHIVED" },
    });
    expect(followUpEvent).not.toBeNull();
    const archiveEvent = await db.archiveEvent.findFirst({
      where: { entityType: "FOLLOW_UP", entityId: followUpA1.id, action: "ARCHIVED" },
    });
    expect(archiveEvent).not.toBeNull();

    // Archived records reject operational actions.
    const editAttempt = await updateFollowUp(
      { id: managerA.id, role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: schoolAId } as never,
      followUpA1.id,
      {}
    );
    expect(editAttempt.ok).toBe(false);
    if (!editAttempt.ok) expect(editAttempt.message).toContain("مؤرشف");

    // Restore brings it back with the same status and a RESTORED audit.
    const restored = await restoreFollowUp(MANAGER_A, followUpA1.id);
    expect(restored.ok).toBe(true);
    const back = await db.followUp.findUnique({ where: { id: followUpA1.id } });
    expect(back?.archivedAt).toBeNull();
    expect(back?.status).toBe("COMPLETED");
    const restoredMetrics = await getFollowUpMetrics(MANAGER_A);
    if (restoredMetrics.ok) expect(restoredMetrics.data.total).toBe(3);
    const restoreEvent = await db.archiveEvent.findFirst({
      where: { entityType: "FOLLOW_UP", entityId: followUpA1.id, action: "RESTORED" },
    });
    expect(restoreEvent).not.toBeNull();
  });

  test("double archive fails cleanly", async () => {
    await archiveFollowUp(MANAGER_A, followUpA1.id);
    const second = await archiveFollowUp(MANAGER_A, followUpA1.id);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("VALIDATION_ERROR");
    await restoreFollowUp(MANAGER_A, followUpA1.id);
  });

  test("supervisor can archive records they are responsible for; not others' records", async () => {
    const own = await archiveFollowUp(SUPERVISOR_A, followUpA2.id);
    expect(own.ok).toBe(true);
    await restoreFollowUp(SUPERVISOR_A, followUpA2.id);

    const foreign = await archiveFollowUp(SUPERVISOR_A, followUpA3.id);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe("FORBIDDEN");
  });

  test("deputy, super admin and cross-school managers can never archive", async () => {
    expect((await archiveFollowUp(DEPUTY_A, followUpA1.id)).ok).toBe(false);
    expect((await archiveFollowUp(SUPER, followUpA1.id)).ok).toBe(false);
    expect((await archiveFollowUp(MANAGER_B, followUpA1.id)).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 9) Archive — content restores + unified views                        */
/* ------------------------------------------------------------------ */

describe("Phase 10 — content restore & archive views", () => {
  test("archive views are role-scoped: manager sees school records, supervisor only follow-ups/surveys, super platform-wide only", async () => {
    const managerView = await listArchivedRecords(MANAGER_A, null, 1);
    expect(managerView.ok).toBe(true);
    if (managerView.ok) {
      const types = new Set(managerView.data.rows.map((row) => row.entityType));
      expect(types.has("COURSE")).toBe(true);
      expect(types.has("ASSIGNMENT")).toBe(true);
      expect(types.has("FOLLOW_UP")).toBe(true); // followUpA4 archived in fixtures
    }

    const supervisorView = await listArchivedRecords(SUPERVISOR_A, null, 1);
    expect(supervisorView.ok).toBe(true);
    if (supervisorView.ok) {
      for (const row of supervisorView.data.rows) {
        expect(["FOLLOW_UP", "SURVEY"]).toContain(row.entityType);
      }
      expect(
        supervisorView.data.rows.find((row) => row.title === "متابعة ت10 مؤرشفة مسبقًا")
      ).toBeDefined();
    }

    const superView = await listArchivedRecords(SUPER, null, 1);
    expect(superView.ok).toBe(true);
    if (superView.ok) {
      for (const row of superView.data.rows) {
        expect(row.schoolId).toBeNull();
      }
      expect(superView.data.rows.find((row) => row.title === "دورة ت10 عامة مؤرشفة")).toBeDefined();
    }
  });

  test("course restore: previously published → PUBLISHED, never-published → DRAFT", async () => {
    const published = await restoreCourse(MANAGER_A, courseA3Arch.id);
    expect(published.ok).toBe(true);
    const publishedRow = await db.course.findUnique({ where: { id: courseA3Arch.id } });
    expect(publishedRow?.status).toBe("PUBLISHED");

    const draft = await restoreCourse(MANAGER_A, courseA4Arch.id);
    expect(draft.ok).toBe(true);
    const draftRow = await db.course.findUnique({ where: { id: courseA4Arch.id } });
    expect(draftRow?.status).toBe("DRAFT");

    const again = await restoreCourse(MANAGER_A, courseA3Arch.id);
    expect(again.ok).toBe(false); // no longer archived
  });

  test("program and assessment restores land on DRAFT", async () => {
    const program = await restoreProgram(MANAGER_A, programArch.id);
    expect(program.ok).toBe(true);
    expect((await db.trainingProgram.findUnique({ where: { id: programArch.id } }))?.status).toBe("DRAFT");

    const assessment = await restoreAssessment(MANAGER_A, assessmentArch.id);
    expect(assessment.ok).toBe(true);
    expect((await db.assessment.findUnique({ where: { id: assessmentArch.id } }))?.status).toBe("DRAFT");
  });

  test("assignment restore goes to CLOSED (Phase 7 keeps ARCHIVED terminal)", async () => {
    const restored = await restoreAssignment(MANAGER_A, assignmentArch.id);
    expect(restored.ok).toBe(true);
    const row = await db.assignment.findUnique({ where: { id: assignmentArch.id } });
    expect(row?.status).toBe("CLOSED");

    const supervisorAttempt = await restoreAssignment(SUPERVISOR_A, assignmentArch.id);
    expect(supervisorAttempt.ok).toBe(false);
    if (!supervisorAttempt.ok) expect(supervisorAttempt.code).toBe("FORBIDDEN");
  });

  test("platform-wide content restores: manager denied, super admin allowed", async () => {
    const managerAttempt = await restoreCourse(MANAGER_A, coursePlatArch.id);
    expect(managerAttempt.ok).toBe(false);
    if (!managerAttempt.ok) expect(managerAttempt.code).toBe("FORBIDDEN");

    const superRestore = await restoreCourse(SUPER, coursePlatArch.id);
    expect(superRestore.ok).toBe(true);
    expect((await db.course.findUnique({ where: { id: coursePlatArch.id } }))?.status).toBe("PUBLISHED");

    const superOnSchool = await restoreProgram(SUPER, programArch.id);
    expect(superOnSchool.ok).toBe(false);
  });

  test("restore audit trail is queryable and role-scoped", async () => {
    const events = await listArchiveEvents(MANAGER_A);
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.data.length).toBeGreaterThan(0);
      expect(events.data.some((event) => event.action === "RESTORED" && event.entityType === "COURSE")).toBe(true);
      // No foreign-school events leak in.
      const foreign = events.data.filter(
        (event) => event.entityId === assignmentArch.id && event.actorRole === "EDUCATIONAL_SUPERVISOR" && event.action === "ARCHIVED"
      );
      expect(foreign.length).toBe(0);
    }
    const superEvents = await listArchiveEvents(SUPER);
    expect(superEvents.ok).toBe(true);
    if (superEvents.ok) {
      for (const event of superEvents.data) {
        expect(event.entityType === "COURSE" || event.entityType === "PROGRAM").toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Cleanup (leaves first, then fixture schools)                         */
/* ------------------------------------------------------------------ */

afterAll(async () => {
  const surveyIds = (
    await db.survey.findMany({ where: { schoolId: { in: [schoolAId, schoolBId] } }, select: { id: true } })
  ).map((survey) => survey.id);
  if (surveyIds.length > 0) {
    await db.surveyAnswer.deleteMany({ where: { response: { surveyId: { in: surveyIds } } } });
    await db.surveyResponse.deleteMany({ where: { surveyId: { in: surveyIds } } });
    await db.surveyEvent.deleteMany({ where: { surveyId: { in: surveyIds } } });
    await db.survey.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  }
  await db.followUpEvent.deleteMany({ where: { followUp: { schoolId: { in: [schoolAId, schoolBId] } } } });
  await db.followUp.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.archiveEvent.deleteMany({
    where: { OR: [{ schoolId: { in: [schoolAId, schoolBId] } }, { schoolId: null }] },
  });
  await db.assignmentSubmission.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.assignment.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.certificate.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.assessmentAttempt.deleteMany({
    where: { assessment: { schoolId: { in: [schoolAId, schoolBId] } } },
  });
  await db.assessment.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.courseEnrollment.deleteMany({
    where: { OR: [{ course: { schoolId: { in: [schoolAId, schoolBId] } } }, { course: { schoolId: null, titleAr: "دورة ت10 عامة" } }] },
  });
  await db.course.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.course.deleteMany({ where: { schoolId: null, titleAr: { in: ["دورة ت10 عامة", "دورة ت10 عامة مؤرشفة"] } } });
  await db.trainingProgram.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.teacherSupervisorAssignment.deleteMany({ where: { supervisorId: supervisorA.id } });
  await db.supervisorAssignment.deleteMany({ where: { supervisorId: supervisorA.id } });
  await db.deputyGrant.deleteMany({ where: { userId: { in: [deputyA.id, deputyNone.id] } } });
  await db.user.deleteMany({ where: { email: { contains: "p10-" } } });
  await db.branch.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.school.deleteMany({ where: { slug: { startsWith: "p10-" } } });
});
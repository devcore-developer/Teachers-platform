/**
 * Phase 8 integration tests — certificates, eligibility, verification
 * and professional growth.
 *
 * Runs against the shared dedicated SQLite file (prisma/test-platform.db)
 * with the real Prisma client — no mocks. Covers: role guards on
 * issuance/revocation, tenant isolation, server-side eligibility
 * (enrollment + published assessments), duplicate prevention (service
 * AND DB-level), audit events, teacher ownership, supervisor scope,
 * deputy grants, super-admin restrictions, verification of
 * valid/revoked/expired/unknown codes, verification privacy, metrics
 * accuracy with explicit denominators, growth projections and rosters
 * derived from persisted data.
 *
 * Run: bun test tests/certificates.test.ts
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

afterAll(async () => {
  // Order matters: leaves first, then the fixture schools. Everything
  // is scoped to the p8- fixtures — the shared test DB keeps the
  // Phase 6/7 fixtures intact.
  await db.certificate.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.assignmentSubmission.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.assignment.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.assessmentAttempt.deleteMany({ where: { userId: { in: [teacherA1Id, teacherA2Id, teacherA3Id, teacherB1Id] } } });
  await db.courseEnrollment.deleteMany({ where: { userId: { in: [teacherA1Id, teacherA2Id, teacherA3Id, teacherB1Id] } } });
  await db.assessmentQuestion.deleteMany({});
  await db.assessment.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.course.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.trainingProgram.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.teacherSupervisorAssignment.deleteMany({ where: { supervisorId: supervisorAId } });
  await db.deputyGrant.deleteMany({ where: { userId: deputyAId } });
  await db.user.deleteMany({ where: { email: { contains: "p8-" } } });
  await db.branch.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.school.deleteMany({ where: { slug: { startsWith: "p8-" } } });
});

// Dynamic imports after the env override.
const { db } = await import("@/lib/db");
const {
  buildCertificateNumber,
  buildVerificationCode,
  effectiveStatusOf,
  formatCodeGrouped,
  getCertificateMetrics,
  getCertificateView,
  getIssueEligibility,
  issueCertificate,
  listCertificatesForManage,
  listCertificatesForTeacher,
  listIssueContentOptions,
  revokeCertificate,
  verifyCertificate,
} = await import("@/lib/certificates/service");
const {
  getPlatformGrowthStats,
  getTeacherGrowth,
  listGrowthRoster,
} = await import("@/lib/growth/service");
const { hashPassword } = await import("@/lib/auth/password");

/* ------------------------------------------------------------------ */
/* Fixtures: two schools, branches, office pair, supervisor, deputy,    */
/* teachers, courses with published assessments, a program.             */
/* ------------------------------------------------------------------ */

const schoolAId = (
  await db.school.create({
    data: { nameAr: "مدرسة ت8 أ", nameEn: "P8 School A", slug: "p8-a" },
  })
).id;
const schoolBId = (
  await db.school.create({
    data: { nameAr: "مدرسة ت8 ب", nameEn: "P8 School B", slug: "p8-b" },
  })
).id;

const branchA1Id = (
  await db.branch.create({
    data: { schoolId: schoolAId, nameAr: "فرع ت8 الأول", nameNorm: "فرع ت8 الأول", stage: "primary" },
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
      name: `مستخدم ت8 (${email})`,
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

const superAdmin = await seedUser("p8-super@test.local", "SUPER_ADMIN", null);
const managerA = await seedUser("p8-manager-a@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolAId);
const managerB = await seedUser("p8-manager-b@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolBId);
const supervisorA = await seedUser("p8-supervisor-a@test.local", "EDUCATIONAL_SUPERVISOR", schoolAId);
const supervisorB = await seedUser("p8-supervisor-b@test.local", "EDUCATIONAL_SUPERVISOR", schoolBId);
const deputyA = await seedUser("p8-deputy-a@test.local", "EDUCATIONAL_DEPUTY", schoolAId);
const teacherA1 = await seedUser("p8-teacher-a1@test.local", "TEACHER", schoolAId, branchA1Id);
const teacherA2 = await seedUser("p8-teacher-a2@test.local", "TEACHER", schoolAId, branchA1Id);
const teacherA3 = await seedUser("p8-teacher-a3@test.local", "TEACHER", schoolAId, null);
const teacherB1 = await seedUser("p8-teacher-b1@test.local", "TEACHER", schoolBId, null);

const teacherA1Id = teacherA1.id;
const teacherA2Id = teacherA2.id;
const teacherA3Id = teacherA3.id;
const teacherB1Id = teacherB1.id;
const supervisorAId = supervisorA.id;
const deputyAId = deputyA.id;

// Supervisor A is the assigned supervisor of teacher A1 only.
await db.teacherSupervisorAssignment.create({
  data: { supervisorId: supervisorA.id, teacherId: teacherA1.id, schoolId: schoolAId },
});
// Deputy A: school-wide grant.
await db.deputyGrant.create({ data: { userId: deputyA.id, schoolId: schoolAId, branchId: null } });

const SUPERVISOR_A = { id: supervisorA.id, name: supervisorA.name, role: "EDUCATIONAL_SUPERVISOR" as const, schoolId: schoolAId };
const SUPERVISOR_B = { id: supervisorB.id, name: supervisorB.name, role: "EDUCATIONAL_SUPERVISOR" as const, schoolId: schoolBId };
const DEPUTY_A = { id: deputyA.id, name: deputyA.name, role: "EDUCATIONAL_DEPUTY" as const, schoolId: schoolAId };
const MANAGER_A = { id: managerA.id, name: managerA.name, role: "DEVELOPMENT_OFFICE_MANAGER" as const, schoolId: schoolAId };
const MANAGER_B = { id: managerB.id, name: managerB.name, role: "DEVELOPMENT_OFFICE_MANAGER" as const, schoolId: schoolBId };
const SUPER_ADMIN = { id: superAdmin.id, name: superAdmin.name, role: "SUPER_ADMIN" as const, schoolId: null };
const TEACHER_A1_VIEWER = { id: teacherA1.id, role: "TEACHER", schoolId: schoolAId };
const TEACHER_A2_VIEWER = { id: teacherA2.id, role: "TEACHER", schoolId: schoolAId };

async function seedCourse(input: {
  schoolId: string;
  titleAr: string;
  status?: string;
  programId?: string | null;
}): Promise<string> {
  const course = await db.course.create({
    data: {
      schoolId: input.schoolId,
      programId: input.programId ?? null,
      titleAr: input.titleAr,
      descriptionAr: "وصف دورة اختبارات المرحلة الثامنة.",
      category: "pedagogy",
      status: input.status ?? "PUBLISHED",
      createdById: managerA.id,
      publishedAt: (input.status ?? "PUBLISHED") === "PUBLISHED" ? new Date() : null,
    },
  });
  return course.id;
}

async function seedAssessment(input: {
  schoolId: string;
  courseId: string;
  titleAr: string;
  status?: string;
}): Promise<string> {
  const assessment = await db.assessment.create({
    data: {
      schoolId: input.schoolId,
      courseId: input.courseId,
      titleAr: input.titleAr,
      instructionsAr: "أجب عن جميع الأسئلة.",
      status: input.status ?? "PUBLISHED",
      passingScore: 5,
      maxScore: 10,
      createdById: managerA.id,
    },
  });
  await db.assessmentQuestion.create({
    data: {
      assessmentId: assessment.id,
      type: "TRUE_FALSE",
      textAr: "السؤال الأول",
      orderIndex: 0,
      points: 10,
      answerKeyJson: JSON.stringify({ value: true }),
    },
  });
  return assessment.id;
}

async function seedAttempt(input: {
  assessmentId: string;
  userId: string;
  status: string;
  passed: boolean | null;
  percentage: number | null;
}): Promise<void> {
  await db.assessmentAttempt.create({
    data: {
      assessmentId: input.assessmentId,
      userId: input.userId,
      status: input.status,
      passed: input.passed,
      percentage: input.percentage,
      earnedScore: input.passed ? 9 : 3,
      maxScore: 10,
      submittedAt: new Date(),
    },
  });
}

// Course A: one published assessment — the main eligibility fixture.
const courseAId = await seedCourse({ schoolId: schoolAId, titleAr: "دورة ت8 أ" });
const assessA1Id = await seedAssessment({ schoolId: schoolAId, courseId: courseAId, titleAr: "تقييم دورة ت8 أ" });
await db.courseEnrollment.create({ data: { courseId: courseAId, userId: teacherA1.id } });
await seedAttempt({ assessmentId: assessA1Id, userId: teacherA1.id, status: "PASSED", passed: true, percentage: 90 });
await seedAttempt({ assessmentId: assessA1Id, userId: teacherA2.id, status: "FAILED", passed: false, percentage: 30 });
// A DRAFT assessment must be ignored by the eligibility engine.
await seedAssessment({ schoolId: schoolAId, courseId: courseAId, titleAr: "تقييم مسودة", status: "DRAFT" });

// Course C: published with NO assessments (vacuous rule fixture).
const courseCId = await seedCourse({ schoolId: schoolAId, titleAr: "دورة ت8 ج" });
await db.courseEnrollment.create({ data: { courseId: courseCId, userId: teacherA1.id } });

// Draft course fixture.
const draftCourseId = await seedCourse({ schoolId: schoolAId, titleAr: "دورة ت8 مسودة", status: "DRAFT" });

// School B course (tenant mismatch fixture).
const courseBId = await seedCourse({ schoolId: schoolBId, titleAr: "دورة ت8 ب" });

// Program fixture with one member course + its published assessment.
const programAId = (
  await db.trainingProgram.create({
    data: {
      schoolId: schoolAId,
      nameAr: "برنامج ت8 أ",
      nameNorm: "برنامج ت8 أ",
      descriptionAr: "وصف برنامج اختبارات المرحلة الثامنة.",
      category: "pedagogy",
      status: "PUBLISHED",
      createdById: managerA.id,
    },
  })
).id;
const progCourseAId = await seedCourse({ schoolId: schoolAId, titleAr: "دورة برنامج ت8", programId: programAId });
const progAssessId = await seedAssessment({ schoolId: schoolAId, courseId: progCourseAId, titleAr: "تقييم دورة البرنامج" });
await db.courseEnrollment.create({ data: { courseId: progCourseAId, userId: teacherA1.id } });
await seedAttempt({ assessmentId: progAssessId, userId: teacherA1.id, status: "PASSED", passed: true, percentage: 85 });

// Assignment fixture (Phase 7 integration into the growth view).
const assignmentAId = (
  await db.assignment.create({
    data: {
      schoolId: schoolAId,
      createdById: managerA.id,
      titleAr: "تكليف ت8",
      descriptionAr: "وصف تكليف اختبارات المرحلة الثامنة.",
      status: "PUBLISHED",
      audienceMode: "ALL_TEACHERS",
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      publishedAt: new Date(),
    },
  })
).id;
await db.assignmentSubmission.create({
  data: {
    assignmentId: assignmentAId,
    teacherId: teacherA1.id,
    schoolId: schoolAId,
    status: "GRADED",
    responseText: "إجابة المعلم الأول.",
    submittedAt: new Date(),
    lastSubmittedAt: new Date(),
    scoreTotal: 8,
    reviewedById: managerA.id,
    reviewedAt: new Date(),
  },
});

/* ------------------------------------------------------------------ */
/* Actor casts documenting the negative tests                           */
/* ------------------------------------------------------------------ */
const TEACHER_AS_ACTOR = TEACHER_A1_VIEWER as unknown as Parameters<typeof issueCertificate>[0];

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const CODE_ALPHABET = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;

async function issueFor(
  ctx: Parameters<typeof issueCertificate>[0],
  teacherId: string,
  contentType: "COURSE" | "PROGRAM",
  contentId: string,
  extra: Record<string, unknown> = {}
) {
  return issueCertificate(ctx, { teacherId, contentType, contentId, ...extra });
}

/* ------------------------------------------------------------------ */
/* Issuance guards                                                      */
/* ------------------------------------------------------------------ */

describe("certificate issuance guards", () => {
  test("teacher actor cannot issue", async () => {
    const result = await issueFor(TEACHER_AS_ACTOR, teacherA2.id, "COURSE", courseAId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("supervisor cannot issue", async () => {
    const result = await issueFor(SUPERVISOR_A, teacherA1.id, "COURSE", courseAId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("deputy cannot issue", async () => {
    const result = await issueFor(DEPUTY_A, teacherA1.id, "COURSE", courseAId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("super admin cannot issue school certificates", async () => {
    const result = await issueFor(SUPER_ADMIN, teacherA1.id, "COURSE", courseAId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("cross-school content is rejected", async () => {
    const result = await issueFor(MANAGER_A, teacherA1.id, "COURSE", courseBId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("teacher from another school is rejected", async () => {
    const result = await issueFor(MANAGER_A, teacherB1.id, "COURSE", courseAId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TEACHER_INVALID");
  });

  test("draft content is rejected", async () => {
    const result = await issueFor(MANAGER_A, teacherA1.id, "COURSE", draftCourseId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONTENT_INVALID");
  });
});

/* ------------------------------------------------------------------ */
/* Eligibility engine                                                   */
/* ------------------------------------------------------------------ */

describe("eligibility engine", () => {
  test("roster shows eligible teacher with met requirements", async () => {
    const result = await getIssueEligibility(MANAGER_A, "COURSE", courseAId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rowA1 = result.data.rows.find((row) => row.teacherId === teacherA1.id);
    expect(rowA1).toBeDefined();
    expect(rowA1?.eligible).toBe(true);
    expect(rowA1?.requirements.every((requirement) => requirement.met)).toBe(true);
    expect(rowA1?.assessments[0]?.passed).toBe(true);
    expect(rowA1?.assessments[0]?.bestPercentage).toBe(90);
  });

  test("roster shows missing enrollment and failed assessment", async () => {
    const result = await getIssueEligibility(MANAGER_A, "COURSE", courseAId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rowA2 = result.data.rows.find((row) => row.teacherId === teacherA2.id);
    expect(rowA2?.eligible).toBe(false);
    const enrollmentRule = rowA2?.requirements.find((requirement) => requirement.key === "ENROLLMENT");
    const assessmentsRule = rowA2?.requirements.find((requirement) => requirement.key === "ASSESSMENTS");
    expect(enrollmentRule?.met).toBe(false);
    expect(assessmentsRule?.met).toBe(false);
  });

  test("roster is tenant-scoped (no school B teachers)", async () => {
    const result = await getIssueEligibility(MANAGER_A, "COURSE", courseAId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows.find((row) => row.teacherId === teacherB1.id)).toBeUndefined();
  });

  test("draft assessments do not gate eligibility", async () => {
    const result = await getIssueEligibility(MANAGER_A, "COURSE", courseAId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rowA1 = result.data.rows.find((row) => row.teacherId === teacherA1.id);
    // Only the PUBLISHED assessment appears; the draft one is ignored.
    expect(rowA1?.assessments).toHaveLength(1);
  });

  test("vacuous rule: content without published assessments stays issuable", async () => {
    const result = await getIssueEligibility(MANAGER_A, "COURSE", courseCId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rowA1 = result.data.rows.find((row) => row.teacherId === teacherA1.id);
    expect(rowA1?.requirements.find((requirement) => requirement.key === "ASSESSMENTS")?.met).toBe(true);
    expect(rowA1?.eligible).toBe(true);
  });

  test("issuing for an unmet teacher is blocked with the missing rules", async () => {
    const result = await issueFor(MANAGER_A, teacherA2.id, "COURSE", courseAId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NOT_ELIGIBLE");
      expect(result.message).toContain("الالتحاق");
    }
  });

  test("content options exclude drafts and foreign schools", async () => {
    const result = await listIssueContentOptions(MANAGER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.courses.find((course) => course.id === draftCourseId)).toBeUndefined();
    expect(result.data.courses.find((course) => course.id === courseBId)).toBeUndefined();
    expect(result.data.courses.find((course) => course.id === courseAId)).toBeDefined();
    expect(result.data.programs.find((program) => program.id === programAId)).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* Issuance                                                             */
/* ------------------------------------------------------------------ */

describe("certificate issuance", () => {
  test("eligible teacher gets a certificate with identifiers, audit event and snapshot", async () => {
    const result = await issueFor(MANAGER_A, teacherA1.id, "COURSE", courseAId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.certificateNumber).toMatch(/^MQ-\d{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    expect(result.data.verificationCode).toMatch(CODE_ALPHABET);
    expect(result.data.verificationCode).toHaveLength(16);

    const row = await db.certificate.findUnique({ where: { id: result.data.id } });
    expect(row?.status).toBe("ISSUED");
    expect(row?.schoolId).toBe(schoolAId);
    expect(row?.courseId).toBe(courseAId);
    expect(row?.issuedById).toBe(managerA.id);
    expect(row?.issuerRoleLabel).toBe("مدير مكتب التطوير");
    expect(row?.criteriaSnapshotJson).toContain("ENROLLMENT");

    const events = await db.certificateEvent.findMany({ where: { certificateId: result.data.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("ISSUED");
    expect(events[0]?.actorId).toBe(managerA.id);
  });

  test("duplicate issuance for the same teacher+course is blocked by the service", async () => {
    const result = await issueFor(MANAGER_A, teacherA1.id, "COURSE", courseAId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ALREADY_ISSUED");
      expect(result.message).toMatch(/MQ-\d{4}-/);
    }
  });

  test("duplicate issuance is blocked at the DB level (unique index)", async () => {
    let threw = false;
    try {
      await db.certificate.create({
        data: {
          schoolId: schoolAId,
          teacherId: teacherA1.id,
          courseId: courseAId,
          certificateNumber: buildCertificateNumber(),
          verificationCode: buildVerificationCode(),
          titleAr: "شهادة مكررة",
          status: "ISSUED",
          issuedAt: new Date(),
          issuedById: managerA.id,
        },
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("custom title and expiration are honored", async () => {
    const result = await issueFor(MANAGER_A, teacherA1.id, "COURSE", courseCId, {
      titleAr: "شهادة مخصصة",
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await db.certificate.findUnique({ where: { id: result.data.id } });
    expect(row?.titleAr).toBe("شهادة مخصصة");
    expect(row?.expiresAt).not.toBeNull();
  });

  test("program-bound issuance uses program eligibility rules", async () => {
    const result = await issueFor(MANAGER_A, teacherA1.id, "PROGRAM", programAId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await db.certificate.findUnique({ where: { id: result.data.id } });
    expect(row?.programId).toBe(programAId);
    expect(row?.titleAr).toContain("برنامج ت8 أ");
  });

  test("grouped verification code formatting", () => {
    expect(formatCodeGrouped("ABCD1234EFGH5678")).toBe("ABCD-1234-EFGH-5678");
  });
});

/* ------------------------------------------------------------------ */
/* Revocation                                                           */
/* ------------------------------------------------------------------ */

describe("certificate revocation", () => {
  test("teacher cannot revoke", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseCId } });
    const result = await revokeCertificate(TEACHER_AS_ACTOR, {
      certificateId: rows[0]?.id,
      reason: "محاولة غير مصرح بها",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("super admin cannot revoke school certificates", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseCId } });
    const result = await revokeCertificate(SUPER_ADMIN, {
      certificateId: rows[0]?.id,
      reason: "محاولة غير مصرح بها",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("cross-school manager cannot revoke", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseCId } });
    const result = await revokeCertificate(MANAGER_B, {
      certificateId: rows[0]?.id,
      reason: "نطاق مختلف",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("authorized manager revokes with audit trail", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseCId } });
    const targetId = rows[0]?.id as string;
    const result = await revokeCertificate(MANAGER_A, {
      certificateId: targetId,
      reason: "عدم استيفاء المتطلبات بعد إعادة التدقيق",
    });
    expect(result.ok).toBe(true);
    const row = await db.certificate.findUnique({ where: { id: targetId } });
    expect(row?.status).toBe("REVOKED");
    expect(row?.revokedById).toBe(managerA.id);
    expect(row?.revocationReason).toBe("عدم استيفاء المتطلبات بعد إعادة التدقيق");
    const events = await db.certificateEvent.findMany({
      where: { certificateId: targetId },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe("REVOKED");
  });

  test("double revocation is rejected", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseCId } });
    const result = await revokeCertificate(MANAGER_A, {
      certificateId: rows[0]?.id,
      reason: "إلغاء مكرر",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ALREADY_REVOKED");
  });
});

/* ------------------------------------------------------------------ */
/* Certificate view access                                              */
/* ------------------------------------------------------------------ */

describe("certificate view access", () => {
  test("owner teacher views own certificate", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseAId, teacherId: teacherA1.id } });
    const result = await getCertificateView(TEACHER_A1_VIEWER, rows[0]?.id as string);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.teacherId).toBe(teacherA1.id);
    expect(result.data.verificationCode).toHaveLength(16);
    expect(result.data.snapshot?.rules.length).toBeGreaterThan(0);
    expect(result.data.school.nameAr).toBe("مدرسة ت8 أ");
  });

  test("another teacher is rejected", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseAId, teacherId: teacherA1.id } });
    const result = await getCertificateView(TEACHER_A2_VIEWER, rows[0]?.id as string);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("same-school supervisor can view; foreign supervisor cannot", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseAId, teacherId: teacherA1.id } });
    const ok = await getCertificateView(SUPERVISOR_A, rows[0]?.id as string);
    expect(ok.ok).toBe(true);
    const denied = await getCertificateView(SUPERVISOR_B, rows[0]?.id as string);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("FORBIDDEN");
  });

  test("deputy (granted) can view; foreign manager cannot", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseAId, teacherId: teacherA1.id } });
    const ok = await getCertificateView(DEPUTY_A, rows[0]?.id as string);
    expect(ok.ok).toBe(true);
    const denied = await getCertificateView(MANAGER_B, rows[0]?.id as string);
    expect(denied.ok).toBe(false);
  });

  test("super admin has platform-wide read-only view", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseAId, teacherId: teacherA1.id } });
    const result = await getCertificateView(SUPER_ADMIN, rows[0]?.id as string);
    expect(result.ok).toBe(true);
  });

  test("revocation details appear in the view", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseCId } });
    const result = await getCertificateView(MANAGER_A, rows[0]?.id as string);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("REVOKED");
    expect(result.data.effectiveStatus).toBe("REVOKED");
    expect(result.data.revocation?.reason).toContain("إعادة التدقيق");
    expect(result.data.events.length).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Verification                                                         */
/* ------------------------------------------------------------------ */

describe("certificate verification", () => {
  let validCert: { certificateNumber: string; verificationCode: string } | null = null;

  test("setup: expired certificate row for derived-status tests", async () => {
    await db.certificate.create({
      data: {
        schoolId: schoolAId,
        teacherId: teacherA2.id,
        courseId: courseAId,
        certificateNumber: buildCertificateNumber(),
        verificationCode: buildVerificationCode(),
        titleAr: "شهادة منتهية",
        status: "ISSUED",
        issuedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        issuedById: managerA.id,
      },
    });
  });

  test("valid certificate found by verification code", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseAId, teacherId: teacherA1.id } });
    validCert = {
      certificateNumber: rows[0]?.certificateNumber as string,
      verificationCode: rows[0]?.verificationCode as string,
    };
    const result = await verifyCertificate(MANAGER_A, { query: validCert.verificationCode });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.found) return;
    expect(result.data.certificate.effectiveStatus).toBe("ISSUED");
    expect(result.data.certificate.teacherName).toBe(teacherA1.name);
    expect(result.data.certificate.schoolName).toBe("مدرسة ت8 أ");
  });

  test("found by certificate number with case/spacing normalization", async () => {
    if (!validCert) return;
    const sloppy = `  ${validCert.certificateNumber.toLowerCase().replace(/-/g, " ")}  `;
    const result = await verifyCertificate(MANAGER_A, { query: sloppy });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.found) return;
    expect(result.data.certificate.certificateNumber).toBe(validCert.certificateNumber);
  });

  test("revoked certificate is distinguished", async () => {
    const rows = await db.certificate.findMany({ where: { courseId: courseCId } });
    const result = await verifyCertificate(MANAGER_A, { query: rows[0]?.verificationCode as string });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.found) return;
    expect(result.data.certificate.effectiveStatus).toBe("REVOKED");
    expect(result.data.certificate.revokedAt).not.toBeNull();
  });

  test("expired certificate is distinguished (derived, not stored)", async () => {
    const row = await db.certificate.findFirst({ where: { teacherId: teacherA2.id } });
    const result = await verifyCertificate(MANAGER_A, { query: row?.verificationCode as string });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.found) return;
    expect(result.data.certificate.effectiveStatus).toBe("EXPIRED");
  });

  test("unknown code returns not-found (no existence leak)", async () => {
    const result = await verifyCertificate(MANAGER_A, { query: "MQ-2099-ZZZZZZ" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.found).toBe(false);
  });

  test("cross-school isolation: foreign manager cannot verify", async () => {
    if (!validCert) return;
    const result = await verifyCertificate(MANAGER_B, { query: validCert.verificationCode });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.found).toBe(false);
  });

  test("teacher is explicitly rejected from verification", async () => {
    const result = await verifyCertificate(TEACHER_AS_ACTOR, { query: "MQ-2099-ZZZZZZ" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("super admin verifies platform-wide", async () => {
    if (!validCert) return;
    const result = await verifyCertificate(SUPER_ADMIN, { query: validCert.verificationCode });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.found) return;
    expect(result.data.certificate.effectiveStatus).toBe("ISSUED");
  });

  test("verification response exposes minimum information only", async () => {
    if (!validCert) return;
    const result = await verifyCertificate(MANAGER_A, { query: validCert.verificationCode });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.found) return;
    const match = result.data.certificate as unknown as Record<string, unknown>;
    expect(match["teacherId"]).toBeUndefined();
    expect(match["email"]).toBeUndefined();
    expect(match["verificationCode"]).toBeUndefined();
    expect(match["criteriaSnapshotJson"]).toBeUndefined();
    expect(match["percentage"]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Lists & metrics                                                      */
/* ------------------------------------------------------------------ */

describe("certificate lists and metrics", () => {
  test("management list is tenant-scoped and filterable", async () => {
    const all = await listCertificatesForManage(MANAGER_A, {});
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    const schoolATotal = await db.certificate.count({ where: { schoolId: schoolAId } });
    expect(all.data.total).toBe(schoolATotal);

    const issued = await listCertificatesForManage(MANAGER_A, { status: "ISSUED" });
    if (issued.ok) {
      expect(issued.data.rows.every((row) => row.status === "ISSUED")).toBe(true);
    }
    const foreign = await listCertificatesForManage(MANAGER_B, {});
    if (foreign.ok) expect(foreign.data.total).toBe(0);
  });

  test("teacher list returns only own certificates", async () => {
    const mine = await listCertificatesForTeacher(TEACHER_A1_VIEWER);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.data.every((row) => row.teacherName === teacherA1.name)).toBe(true);

    const otherTeacher = await listCertificatesForTeacher(TEACHER_A2_VIEWER);
    if (otherTeacher.ok) expect(otherTeacher.data).toHaveLength(1);
  });

  test("metrics counts match seeded data with clear denominators", async () => {
    const result = await getCertificateMetrics(MANAGER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const total = await db.certificate.count({ where: { schoolId: schoolAId } });
    const revoked = await db.certificate.count({ where: { schoolId: schoolAId, status: "REVOKED" } });
    const expired = await db.certificate.count({
      where: { schoolId: schoolAId, status: "ISSUED", expiresAt: { lt: new Date() } },
    });
    expect(result.data.total).toBe(total);
    expect(result.data.revoked).toBe(revoked);
    expect(result.data.expired).toBe(expired);
    expect(result.data.active).toBe(total - revoked - expired);
    expect(result.data.teachersWithCertificates).toBe(2);
    // Eligible awaiting: (tA1 × progCourseA) is enrolled + passed but
    // has NO course-bound certificate (the program certificate covers
    // programA, not progCourseA). courseA/courseC pairs are certified.
    expect(result.data.eligibleAwaiting).toBe(1);
  });

  test("metrics are forbidden for supervisor/deputy/teacher", async () => {
    const supervisor = await getCertificateMetrics(SUPERVISOR_A);
    expect(supervisor.ok).toBe(false);
    const deputy = await getCertificateMetrics(DEPUTY_A);
    expect(deputy.ok).toBe(false);
    const teacher = await getCertificateMetrics(TEACHER_AS_ACTOR);
    expect(teacher.ok).toBe(false);
  });

  test("super admin metrics are platform-wide without school ops", async () => {
    const result = await getCertificateMetrics(SUPER_ADMIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const total = await db.certificate.count({});
    expect(result.data.total).toBe(total);
    expect(result.data.eligibleAwaiting).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Professional growth                                                  */
/* ------------------------------------------------------------------ */

describe("professional growth", () => {
  test("teacher sees own real projection (courses, assessments, assignments, certificates, history)", async () => {
    const result = await getTeacherGrowth(TEACHER_A1_VIEWER, teacherA1.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data;

    expect(data.totals.coursesEnrolled).toBe(3);
    // courseA (assessments passed), progCourseA (passed), courseC
    // (no published assessments → vacuously met).
    expect(data.totals.coursesCompleted).toBe(3);
    expect(data.totals.assessmentsPassed).toBe(2);
    expect(data.totals.assignmentsTargeted).toBe(1);
    expect(data.totals.assignmentsGraded).toBe(1);
    expect(data.totals.certificatesActive).toBe(2);
    expect(data.totals.avgBestPercentage).toBe(88);
    expect(data.totals.overallProgressPercent).toBe(100);

    const courseARow = data.courses.find((course) => course.courseId === courseAId);
    expect(courseARow?.requirementsMet).toBe(true);
    expect(courseARow?.assessmentsPassed).toBe(1);

    const types = new Set(data.history.map((event) => event.type));
    expect(types.has("ENROLLMENT")).toBe(true);
    expect(types.has("ASSESSMENT")).toBe(true);
    expect(types.has("ASSIGNMENT")).toBe(true);
    expect(types.has("CERTIFICATE")).toBe(true);
    const assignmentEvent = data.history.find((event) => event.type === "ASSIGNMENT");
    expect(assignmentEvent?.detail).toContain("8");
  });

  test("unmet requirements are not marked completed", async () => {
    // teacher A2 failed the course A assessment and is not enrolled.
    const result = await getTeacherGrowth(MANAGER_A, teacherA2.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totals.coursesEnrolled).toBe(0);
    expect(result.data.totals.coursesCompleted).toBe(0);
    expect(result.data.totals.overallProgressPercent).toBeNull();
  });

  test("teacher cannot view another teacher's growth", async () => {
    const result = await getTeacherGrowth(TEACHER_A2_VIEWER, teacherA1.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("supervisor sees assigned teachers only", async () => {
    const assigned = await getTeacherGrowth(SUPERVISOR_A, teacherA1.id);
    expect(assigned.ok).toBe(true);

    const unassigned = await getTeacherGrowth(SUPERVISOR_A, teacherA3.id);
    expect(unassigned.ok).toBe(false);
    if (!unassigned.ok) expect(unassigned.code).toBe("FORBIDDEN");

    const foreign = await getTeacherGrowth(SUPERVISOR_B, teacherA1.id);
    expect(foreign.ok).toBe(false);
  });

  test("deputy (granted) and manager (own school) can view; foreign manager cannot", async () => {
    const deputy = await getTeacherGrowth(DEPUTY_A, teacherA1.id);
    expect(deputy.ok).toBe(true);
    const manager = await getTeacherGrowth(MANAGER_A, teacherA1.id);
    expect(manager.ok).toBe(true);
    const foreign = await getTeacherGrowth(MANAGER_B, teacherA1.id);
    expect(foreign.ok).toBe(false);
  });

  test("super admin has no per-teacher profile view (aggregates only)", async () => {
    const result = await getTeacherGrowth(SUPER_ADMIN, teacherA1.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  test("roster is role-scoped: manager=school, supervisor=assigned, deputy=grants", async () => {
    const managerRoster = await listGrowthRoster(MANAGER_A);
    expect(managerRoster.ok).toBe(true);
    if (!managerRoster.ok) return;
    expect(managerRoster.data.rows).toHaveLength(3);
    const a1 = managerRoster.data.rows.find((row) => row.teacherId === teacherA1.id);
    expect(a1?.coursesEnrolled).toBe(3);
    expect(a1?.coursesCompleted).toBe(3);
    expect(a1?.certificatesActive).toBe(2);

    const supervisorRoster = await listGrowthRoster(SUPERVISOR_A);
    if (supervisorRoster.ok) {
      expect(supervisorRoster.data.rows).toHaveLength(1);
      expect(supervisorRoster.data.rows[0]?.teacherId).toBe(teacherA1.id);
    }

    const deputyRoster = await listGrowthRoster(DEPUTY_A);
    if (deputyRoster.ok) expect(deputyRoster.data.rows).toHaveLength(3);
  });

  test("roster is forbidden for super admin and teachers", async () => {
    const superResult = await listGrowthRoster(SUPER_ADMIN);
    expect(superResult.ok).toBe(false);
    const teacherResult = await listGrowthRoster(TEACHER_AS_ACTOR);
    expect(teacherResult.ok).toBe(false);
  });

  test("platform stats are super-admin-only and accurate", async () => {
    const denied = await getPlatformGrowthStats(MANAGER_A);
    expect(denied.ok).toBe(false);

    const result = await getPlatformGrowthStats(SUPER_ADMIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const total = await db.certificate.count({});
    expect(result.data.totals.certificatesIssued).toBe(total);
    const schoolARow = result.data.schools.find((school) => school.schoolId === schoolAId);
    expect(schoolARow?.teachers).toBe(3);
    expect(schoolARow?.assignmentsGraded).toBe(1);
    // Passed attempts belonging to school A teachers: tA1's two
    // (course A + program course). tA2's attempt is FAILED.
    expect(schoolARow?.assessmentsPassed).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Derived status helpers (pure)                                        */
/* ------------------------------------------------------------------ */

describe("derived status helpers", () => {
  test("effectiveStatusOf derives EXPIRED without storing it", () => {
    const now = new Date();
    expect(effectiveStatusOf({ status: "ISSUED", expiresAt: null }, now)).toBe("ISSUED");
    expect(
      effectiveStatusOf({ status: "ISSUED", expiresAt: new Date(now.getTime() - 1000) }, now)
    ).toBe("EXPIRED");
    expect(
      effectiveStatusOf({ status: "REVOKED", expiresAt: new Date(now.getTime() - 1000) }, now)
    ).toBe("REVOKED");
  });
});
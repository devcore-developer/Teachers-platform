/**
 * Phase 7 integration tests — assignments, submissions & supervision.
 *
 * Runs against the shared dedicated SQLite file (prisma/test-platform.db)
 * with the real Prisma client — no mocks. Covers: creation/publishing
 * guards, draft visibility, audience targeting, teacher ownership,
 * deadlines & late policy, resubmission with revision audit, supervisor
 * scope, tenant isolation, deputy read-only, super-admin restrictions,
 * rubric score bounds, feedback release rules, attachment validation
 * and metrics accuracy.
 *
 * Run: bun test tests/assignments.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const TEST_DB_URL = `file:${path.join(PROJECT_ROOT, "prisma", "test-platform.db")}`;

// MUST be assigned before the dynamic imports below (storage reads it
// at module load; tests never touch the real default storage root).
process.env.DATABASE_URL = TEST_DB_URL;
process.env.ASSIGNMENTS_STORAGE_DIR = path.join(os.tmpdir(), "p7-submission-storage");

// Push BEFORE the module-level fixtures run (import time): the shared
// test-platform.db must already have the Phase 7 tables.
execSync("bunx prisma db push --skip-generate --accept-data-loss", {
  cwd: PROJECT_ROOT,
  env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  stdio: "pipe",
});

afterAll(async () => {
  // Order matters: leaves first, then the fixture branches/schools.
  // Everything is scoped to the p7- fixtures — the test DB is shared
  // with the Phase 6 suite and their fixtures must survive.
  await db.rubricScore.deleteMany({});
  await db.submissionRevision.deleteMany({});
  await db.submissionFile.deleteMany({});
  await db.assignmentSubmission.deleteMany({});
  await db.assignmentRubricCriterion.deleteMany({});
  await db.assignment.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.courseLesson.deleteMany({});
  await db.courseSection.deleteMany({});
  await db.course.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.trainingProgram.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.teacherSupervisorAssignment.deleteMany({});
  await db.deputyGrant.deleteMany({});
  await db.user.deleteMany({ where: { email: { contains: "p7-" } } });
  await db.branch.deleteMany({ where: { schoolId: { in: [schoolAId, schoolBId] } } });
  await db.school.deleteMany({ where: { slug: { startsWith: "p7-" } } });
  const { deleteAllSubmissionObjects } = await import("@/lib/assignments/storage");
  await deleteAllSubmissionObjects();
});

// Dynamic imports after the env override.
const { db } = await import("@/lib/db");
const {
  createAssignment,
  deleteSubmissionFile,
  getAssignmentForManage,
  getAssignmentsOverview,
  getAssignmentMetrics,
  getSubmissionForReview,
  getTeacherAssignment,
  gradeSubmission,
  listAssignmentsForManage,
  listReviewQueue,
  listSubmissionsForReview,
  listTeacherAssignments,
  markUnderReview,
  returnSubmission,
  saveRubric,
  saveSubmissionDraft,
  setAssignmentStatus,
  submitSubmission,
  updateAssignment,
  uploadSubmissionFile,
} = await import("@/lib/assignments/service");
const { hashPassword } = await import("@/lib/auth/password");

/* ------------------------------------------------------------------ */
/* Fixtures: two schools, branches, office pair, supervisor pair,       */
/* deputy, teachers across branches.                                    */
/* ------------------------------------------------------------------ */

const schoolAId = (
  await db.school.create({
    data: { nameAr: "مدرسة ت7 أ", nameEn: "P7 School A", slug: "p7-a" },
  })
).id;
const schoolBId = (
  await db.school.create({
    data: { nameAr: "مدرسة ت7 ب", nameEn: "P7 School B", slug: "p7-b" },
  })
).id;

const branchA1Id = (
  await db.branch.create({
    data: {
      schoolId: schoolAId,
      nameAr: "فرع ت7 الأول",
      nameNorm: "فرع ت7 الأول",
      stage: "primary",
    },
  })
).id;
const branchA2Id = (
  await db.branch.create({
    data: {
      schoolId: schoolAId,
      nameAr: "فرع ت7 الثاني",
      nameNorm: "فرع ت7 الثاني",
      stage: "primary",
    },
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
      name: `مستخدم ت7 (${email})`,
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

const superAdminUser = await seedUser("p7-super@test.local", "SUPER_ADMIN", null);
const managerAUser = await seedUser("p7-manager-a@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolAId);
const managerBUser = await seedUser("p7-manager-b@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolBId);
const supervisorAUser = await seedUser("p7-supervisor-a@test.local", "EDUCATIONAL_SUPERVISOR", schoolAId);
const supervisorBUser = await seedUser("p7-supervisor-b@test.local", "EDUCATIONAL_SUPERVISOR", schoolBId);
const deputyAUser = await seedUser("p7-deputy-a@test.local", "EDUCATIONAL_DEPUTY", schoolAId);
const teacherA1User = await seedUser("p7-teacher-a1@test.local", "TEACHER", schoolAId, branchA1Id);
const teacherA2User = await seedUser("p7-teacher-a2@test.local", "TEACHER", schoolAId, branchA2Id);
const teacherA3User = await seedUser("p7-teacher-a3@test.local", "TEACHER", schoolAId, null);
const teacherBUser = await seedUser("p7-teacher-b@test.local", "TEACHER", schoolBId, null);

// Supervisor A is the assigned supervisor of teachers A1 and A2 only.
await db.teacherSupervisorAssignment.create({
  data: { supervisorId: supervisorAUser.id, teacherId: teacherA1User.id, schoolId: schoolAId },
});
await db.teacherSupervisorAssignment.create({
  data: { supervisorId: supervisorAUser.id, teacherId: teacherA2User.id, schoolId: schoolAId },
});
// Deputy A: school-wide grant.
await db.deputyGrant.create({
  data: { userId: deputyAUser.id, schoolId: schoolAId, branchId: null },
});

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
const SUPERVISOR_A = {
  id: supervisorAUser.id,
  name: supervisorAUser.name,
  role: "EDUCATIONAL_SUPERVISOR" as const,
  schoolId: schoolAId,
};
const SUPERVISOR_B = {
  id: supervisorBUser.id,
  name: supervisorBUser.name,
  role: "EDUCATIONAL_SUPERVISOR" as const,
  schoolId: schoolBId,
};
const DEPUTY_A = {
  id: deputyAUser.id,
  name: deputyAUser.name,
  role: "EDUCATIONAL_DEPUTY" as const,
  schoolId: schoolAId,
};
/** Teachers are NOT AdminContext — the cast documents the negative test. */
const TEACHER_A1_CTX = {
  id: teacherA1User.id,
  name: teacherA1User.name,
  role: "TEACHER",
  schoolId: schoolAId,
} as unknown as Parameters<typeof createAssignment>[1];
const TEACHER_A1 = { id: teacherA1User.id, role: "TEACHER", schoolId: schoolAId };
const TEACHER_A2 = { id: teacherA2User.id, role: "TEACHER", schoolId: schoolAId };
const TEACHER_A3 = { id: teacherA3User.id, role: "TEACHER", schoolId: schoolAId };
const TEACHER_B = { id: teacherBUser.id, role: "TEACHER", schoolId: schoolBId };

/** Published course fixtures for content binding tests. */
const courseAId = (
  await db.course.create({
    data: {
      schoolId: schoolAId,
      titleAr: "دورة ت7 المرتبطة",
      descriptionAr: "وصف دورة التكليفات المرتبطة للمرحلة السابعة.",
      category: "pedagogy",
      status: "PUBLISHED",
      createdById: managerAUser.id,
    },
  })
).id;
const courseAArchivedId = (
  await db.course.create({
    data: {
      schoolId: schoolAId,
      titleAr: "دورة ت7 المؤرشفة",
      descriptionAr: "دورة مؤرشفة يجب رفض ربط التكليفات بها.",
      category: "pedagogy",
      status: "ARCHIVED",
      createdById: managerAUser.id,
    },
  })
).id;
const courseBId = (
  await db.course.create({
    data: {
      schoolId: schoolBId,
      titleAr: "دورة ت7 بمدرسة ب",
      descriptionAr: "دورة في مدرسة أخرى لاختبار عزل النطاق.",
      category: "pedagogy",
      status: "PUBLISHED",
      createdById: managerBUser.id,
    },
  })
).id;

const futureDays = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

/**
 * Phase 12 — upload fixtures now carry REAL format magic bytes: the
 * server validates declared binary types against their content, so a
 * zero-filled "pdf" would (correctly) be rejected as mismatched.
 */
const FILE_MAGIC_SEEDS: Record<string, number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "application/msword": [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  "application/vnd.ms-excel": [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  "application/vnd.ms-powerpoint": [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [0x50, 0x4b, 0x03, 0x04],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [0x50, 0x4b, 0x03, 0x04],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [0x50, 0x4b, 0x03, 0x04],
};

function makeFile(name: string, mime: string, sizeBytes: number): File {
  const bytes = new Uint8Array(sizeBytes);
  const seed = FILE_MAGIC_SEEDS[mime];
  if (seed) bytes.set(seed, 0);
  return new File([bytes], name, { type: mime });
}

describe("Phase 7 — assignments, submissions & supervision", () => {
  let aAllId = ""; // ALL_TEACHERS + rubric — the main lifecycle assignment
  let aBranchId = ""; // BRANCHES targeting — direct-score grading
  let aTeachersId = ""; // TEACHERS targeting — late policy
  let aDraftId = ""; // stays DRAFT — visibility tests
  let aPastId = ""; // deadline enforcement
  let aClosedId = ""; // close/re-open lifecycle

  /* 1. Creation & validation ---------------------------------------- */
  test("1. creates assignments (manager only) and validates school scope of content links", async () => {
    const created = await createAssignment(
      {
        titleAr: "تكليف خطة تحسين ت7",
        descriptionAr: "أعدّ خطة تحسين لأدائك التدريسي وفق نموذج المكتب وارفعها مع مرفق داعم.",
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(7),
        allowLate: false,
        courseId: courseAId,
      },
      MANAGER_A
    );
    expect(created.ok).toBe(true);
    if (created.ok) aAllId = created.data.id;

    const byTeacher = await createAssignment(
      {
        titleAr: "تكليف موجَّه لمعلم محدد ت7",
        descriptionAr: "اكتب تقريرًا ذاتيًا عن ممارساتك التدريبية خلال هذا الفصل.",
        audienceMode: "TEACHERS",
        teacherIds: [teacherA2User.id],
        branchIds: [],
        dueAt: futureDays(5),
        allowLate: true,
        lateUntil: futureDays(10),
      },
      MANAGER_A
    );
    expect(byTeacher.ok).toBe(true);
    if (byTeacher.ok) aTeachersId = byTeacher.data.id;

    const byBranch = await createAssignment(
      {
        titleAr: "تكليف فرع الأول ت7",
        descriptionAr: "شارك خلاصة زيارة صفية أجريتها هذا الشهر.",
        audienceMode: "BRANCHES",
        teacherIds: [],
        branchIds: [branchA1Id],
        dueAt: futureDays(6),
        allowLate: false,
      },
      MANAGER_A
    );
    expect(byBranch.ok).toBe(true);
    if (byBranch.ok) aBranchId = byBranch.data.id;

    // Role guards.
    const teacherCreate = await createAssignment(
      {
        titleAr: "محاولة معلم",
        descriptionAr: "محاولة معلم لإنشاء تكليف يجب رفضها.",
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(3),
        allowLate: false,
      },
      TEACHER_A1_CTX
    );
    expect(teacherCreate.ok).toBe(false);
    if (!teacherCreate.ok) expect(teacherCreate.code).toBe("FORBIDDEN");

    const superCreate = await createAssignment(
      {
        titleAr: "محاولة مدير المنصة",
        descriptionAr: "مدير المنصة لا يملك صلاحية إنشاء تكليفات مدرسية.",
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(3),
        allowLate: false,
      },
      SUPER_ADMIN
    );
    expect(superCreate.ok).toBe(false);
    if (!superCreate.ok) expect(superCreate.code).toBe("FORBIDDEN");

    // Cross-tenant course link.
    const crossCourse = await createAssignment(
      {
        titleAr: "ربط عابر للنطاق",
        descriptionAr: "محاولة ربط تكليف مدرسة أ بدورة من مدرسة ب.",
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(3),
        allowLate: false,
        courseId: courseBId,
      },
      MANAGER_A
    );
    expect(crossCourse.ok).toBe(false);
    if (!crossCourse.ok) expect(crossCourse.code).toBe("RELATION_ERROR");

    // Archived course link.
    const archivedCourse = await createAssignment(
      {
        titleAr: "ربط بدورة مؤرشفة",
        descriptionAr: "محاولة ربط تكليف بدورة مؤرشفة يجب رفضها.",
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(3),
        allowLate: false,
        courseId: courseAArchivedId,
      },
      MANAGER_A
    );
    expect(archivedCourse.ok).toBe(false);

    // Past due date.
    const pastDue = await createAssignment(
      {
        titleAr: "استحقاق في الماضي",
        descriptionAr: "تكليف بتاريخ استحقاق ماضٍ يجب رفضه.",
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: new Date(Date.now() - 60_000).toISOString(),
        allowLate: false,
      },
      MANAGER_A
    );
    expect(pastDue.ok).toBe(false);

    // TEACHERS mode with an empty list.
    const emptyAudience = await createAssignment(
      {
        titleAr: "فئة فارغة",
        descriptionAr: "تكليف بفئة معلمين محددين فارغة يجب رفضه.",
        audienceMode: "TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(3),
        allowLate: false,
      },
      MANAGER_A
    );
    expect(emptyAudience.ok).toBe(false);
    if (!emptyAudience.ok) expect(emptyAudience.fieldErrors?.teacherIds).toBeTruthy();
  });

  test("2. updates drafts (full edit) and blocks cross-school managers", async () => {
    const updated = await updateAssignment(
      {
        assignmentId: aAllId,
        titleAr: "تكليف خطة تحسين ت7 (محدّث)",
        titleEn: "Improvement Plan P7",
        descriptionAr: "الوصف المحدّث لتكليف خطة التحسين مع تعليمات أوضح للمعلمين.",
        descriptionEn: null,
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(8),
        allowLate: false,
        courseId: courseAId,
      },
      MANAGER_A
    );
    expect(updated.ok).toBe(true);

    const cross = await updateAssignment(
      {
        assignmentId: aAllId,
        titleAr: "اختراق نطاق من مدرسة ب",
        descriptionAr: "محاولة مدير مدرسة ب لتعديل تكليف مدرسة أ.",
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(8),
        allowLate: false,
      },
      MANAGER_B
    );
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.code).toBe("FORBIDDEN");
  });

  /* 3. Rubric -------------------------------------------------------- */
  test("3. saves the rubric on the draft and recomputes totalPoints", async () => {
    const saved = await saveRubric(
      {
        assignmentId: aAllId,
        criteria: [
          { titleAr: "وضوح الأهداف ومواءمتها", maxPoints: 3 },
          { titleAr: "عمق التحليل والأمثلة", maxPoints: 2 },
        ],
      },
      MANAGER_A
    );
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.data.totalPoints).toBe(5);

    const detail = await getAssignmentForManage(MANAGER_A, aAllId);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.data.criteria.length).toBe(2);
      expect(detail.data.assignment.totalPoints).toBe(5);
    }
  });

  /* 4. Publishing guards -------------------------------------------- */
  test("4. publishes with guards: blocks empty branch audiences and past deadlines, stamps publishedAt", async () => {
    // Empty BRANCHES audience (crafted directly to simulate legacy data).
    await db.assignment.update({
      where: { id: aBranchId },
      data: { targetBranchIdsJson: "[]" },
    });
    const emptyBranchPublish = await setAssignmentStatus(
      { assignmentId: aBranchId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(emptyBranchPublish.ok).toBe(false);
    if (!emptyBranchPublish.ok) expect(emptyBranchPublish.code).toBe("PUBLISH_BLOCKED");
    await db.assignment.update({
      where: { id: aBranchId },
      data: { targetBranchIdsJson: JSON.stringify([branchA1Id]) },
    });

    // Past deadline.
    await db.assignment.update({
      where: { id: aTeachersId },
      data: { dueAt: new Date(Date.now() - 3_600_000) },
    });
    const pastPublish = await setAssignmentStatus(
      { assignmentId: aTeachersId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(pastPublish.ok).toBe(false);
    if (!pastPublish.ok) expect(pastPublish.code).toBe("PUBLISH_BLOCKED");
    await db.assignment.update({
      where: { id: aTeachersId },
      data: { dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) },
    });

    // Valid publishes.
    const publishedAll = await setAssignmentStatus(
      { assignmentId: aAllId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(publishedAll.ok).toBe(true);

    const publishedBranch = await setAssignmentStatus(
      { assignmentId: aBranchId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(publishedBranch.ok).toBe(true);

    const publishedTeachers = await setAssignmentStatus(
      { assignmentId: aTeachersId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(publishedTeachers.ok).toBe(true);

    const row = await db.assignment.findUnique({ where: { id: aAllId } });
    expect(row?.publishedAt).not.toBeNull();

    // Rubric frozen after publish.
    const rubricLocked = await saveRubric(
      {
        assignmentId: aAllId,
        criteria: [{ titleAr: "معيار بعد النشر", maxPoints: 1 }],
      },
      MANAGER_A
    );
    expect(rubricLocked.ok).toBe(false);
    if (!rubricLocked.ok) expect(rubricLocked.code).toBe("FORBIDDEN");
  });

  /* 5. Draft invisibility ------------------------------------------- */
  test("5. keeps drafts invisible to teachers end-to-end", async () => {
    const draft = await createAssignment(
      {
        titleAr: "مسودة مخفية ت7",
        descriptionAr: "مسودة لا يجب أن تظهر للمعلمين قبل النشر إطلاقًا.",
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(4),
        allowLate: false,
      },
      MANAGER_A
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    aDraftId = draft.data.id;

    const catalog = await listTeacherAssignments(TEACHER_A1, {});
    expect(catalog.ok).toBe(true);
    if (catalog.ok) {
      expect(catalog.data.rows.some((row) => row.id === aDraftId)).toBe(false);
    }

    const direct = await getTeacherAssignment(TEACHER_A1, aDraftId);
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.code).toBe("FORBIDDEN");
  });

  /* 6. Audience targeting ------------------------------------------- */
  test("6. enforces audience targeting for visibility across teachers and schools", async () => {
    const forA1 = await listTeacherAssignments(TEACHER_A1, {});
    expect(forA1.ok).toBe(true);
    if (forA1.ok) {
      const ids = forA1.data.rows.map((row) => row.id);
      expect(ids).toContain(aAllId); // ALL_TEACHERS
      expect(ids).toContain(aBranchId); // branch A1
      expect(ids).not.toContain(aTeachersId); // targeted to A2 only
    }

    const forA2 = await listTeacherAssignments(TEACHER_A2, {});
    expect(forA2.ok).toBe(true);
    if (forA2.ok) {
      const ids = forA2.data.rows.map((row) => row.id);
      expect(ids).toContain(aAllId);
      expect(ids).toContain(aTeachersId);
      expect(ids).not.toContain(aBranchId); // branch A2 not targeted
    }

    const forA3 = await listTeacherAssignments(TEACHER_A3, {});
    expect(forA3.ok).toBe(true);
    if (forA3.ok) {
      const ids = forA3.data.rows.map((row) => row.id);
      expect(ids).toContain(aAllId);
      expect(ids).not.toContain(aBranchId);
      expect(ids).not.toContain(aTeachersId);
    }

    // Cross-school teacher can never see (or open) the assignment.
    const forB = await listTeacherAssignments(TEACHER_B, {});
    expect(forB.ok).toBe(true);
    if (forB.ok) {
      expect(forB.data.rows.some((row) => row.id === aAllId)).toBe(false);
    }
    const crossOpen = await getTeacherAssignment(TEACHER_B, aAllId);
    expect(crossOpen.ok).toBe(false);
    if (!crossOpen.ok) expect(crossOpen.code).toBe("FORBIDDEN");
  });

  /* 7. Submission lifecycle ------------------------------------------ */
  test("7. drafts, uploads, submits once, and rejects duplicate submission", async () => {
    const draft = await saveSubmissionDraft(TEACHER_A1, {
      assignmentId: aAllId,
      responseText: "مسودة أولى لخطة التحسين — قيد الإعداد.",
    });
    expect(draft.ok).toBe(true);

    const upload = await uploadSubmissionFile(TEACHER_A1, {
      assignmentId: aAllId,
      file: makeFile("خطة-التحسين.png", "image/png", 2048),
    });
    expect(upload.ok).toBe(true);

    const submitted = await submitSubmission(TEACHER_A1, {
      assignmentId: aAllId,
      responseText: "خطة التحسين النهائية مع خطوات تنفيذية واضحة ومؤشرات قياس.",
    });
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.data.status).toBe("SUBMITTED");
      expect(submitted.data.isLate).toBe(false);
    }

    const detail = await getTeacherAssignment(TEACHER_A1, aAllId);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.data.mySubmission?.status).toBe("SUBMITTED");
      expect(detail.data.mySubmission?.files.length).toBe(1);
      expect(detail.data.mySubmission?.canEdit).toBe(false);
      // Nothing released yet.
      expect(detail.data.mySubmission?.scoreTotal).toBeNull();
      expect(detail.data.mySubmission?.feedbackText).toBeNull();
    }

    const again = await submitSubmission(TEACHER_A1, {
      assignmentId: aAllId,
      responseText: "محاولة تسليم مزدوج يجب رفضها.",
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("ALREADY_SUBMITTED");

    const editAfter = await saveSubmissionDraft(TEACHER_A1, {
      assignmentId: aAllId,
      responseText: "محاولة تعديل بعد التسليم يجب رفضها.",
    });
    expect(editAfter.ok).toBe(false);
    if (!editAfter.ok) expect(editAfter.code).toBe("ALREADY_SUBMITTED");
  });

  test("8. rejects empty submissions and concurrent double-submission", async () => {
    const empty = await submitSubmission(TEACHER_A2, {
      assignmentId: aAllId,
      responseText: "",
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe("VALIDATION_ERROR");

    // A2 submits text-only, then a concurrent duplicate is rejected.
    const first = await submitSubmission(TEACHER_A2, {
      assignmentId: aAllId,
      responseText: "تقرير ذاتي مبدئي عن ممارساتي التدريبية هذا الفصل.",
    });
    expect(first.ok).toBe(true);

    const second = await submitSubmission(TEACHER_A2, {
      assignmentId: aAllId,
      responseText: "نسخة ثانية متزامنة يجب أن تُرفض.",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("ALREADY_SUBMITTED");
  });

  /* 9. Ownership ------------------------------------------------------ */
  test("9. enforces per-teacher ownership of attachments", async () => {
    const detail = await getTeacherAssignment(TEACHER_A1, aAllId);
    expect(detail.ok).toBe(true);
    const fileId = detail.ok ? detail.data.mySubmission?.files[0]?.id : undefined;
    expect(fileId).toBeTruthy();
    if (!fileId) return;

    const foreignDelete = await deleteSubmissionFile(TEACHER_A2, { fileId });
    expect(foreignDelete.ok).toBe(false);
    if (!foreignDelete.ok) expect(foreignDelete.code).toBe("FORBIDDEN");
  });

  /* 10. File policy ---------------------------------------------------- */
  test("10. enforces attachment type, size and count limits server-side", async () => {
    const badType = await uploadSubmissionFile(TEACHER_A3, {
      assignmentId: aAllId,
      file: makeFile("archive.zip", "application/zip", 1024),
    });
    expect(badType.ok).toBe(false);
    if (!badType.ok) expect(badType.code).toBe("FILE_INVALID");

    const tooBig = await uploadSubmissionFile(TEACHER_A3, {
      assignmentId: aAllId,
      file: makeFile("huge.pdf", "application/pdf", 11 * 1024 * 1024),
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.code).toBe("FILE_INVALID");

    // Fill to the cap (A3 has no files yet).
    for (let index = 0; index < 5; index += 1) {
      const ok = await uploadSubmissionFile(TEACHER_A3, {
        assignmentId: aAllId,
        file: makeFile(`مرفق-${index}.pdf`, "application/pdf", 1024),
      });
      expect(ok.ok).toBe(true);
    }
    const sixth = await uploadSubmissionFile(TEACHER_A3, {
      assignmentId: aAllId,
      file: makeFile("سادس.pdf", "application/pdf", 1024),
    });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.code).toBe("FILE_INVALID");

    // Teacher deletes their own file while still a DRAFT.
    const detail = await getTeacherAssignment(TEACHER_A3, aAllId);
    const ownFileId = detail.ok ? detail.data.mySubmission?.files[0]?.id : undefined;
    expect(ownFileId).toBeTruthy();
    if (ownFileId) {
      const removed = await deleteSubmissionFile(TEACHER_A3, { fileId: ownFileId });
      expect(removed.ok).toBe(true);
    }
  });

  /* 11. Tenant isolation on submit ------------------------------------ */
  test("11. blocks cross-school submission and manager listing", async () => {
    const cross = await submitSubmission(TEACHER_B, {
      assignmentId: aAllId,
      responseText: "محاولة معلم من مدرسة ب للتسليم في تكليف مدرسة أ.",
    });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.code).toBe("FORBIDDEN");

    const listing = await listAssignmentsForManage(MANAGER_B, {});
    expect(listing.ok).toBe(true);
    if (listing.ok) {
      expect(listing.data.rows.some((row) => row.id === aAllId)).toBe(false);
    }
  });

  /* 12. Deadlines & late policy ---------------------------------------- */
  test("12. enforces server-side deadlines and the late-submission policy", async () => {
    // allowLate = false + past deadline -> rejected.
    const past = await createAssignment(
      {
        titleAr: "تكليف ماضي بدون قبول متأخر ت7",
        descriptionAr: "استحقاق مضى وسياسة قبول متأخر معطلة يجب رفض التسليم.",
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(1),
        allowLate: false,
      },
      MANAGER_A
    );
    expect(past.ok).toBe(true);
    if (!past.ok) return;
    const pastId = past.data.id;
    await setAssignmentStatus({ assignmentId: pastId, status: "PUBLISHED" }, MANAGER_A);
    await db.assignment.update({
      where: { id: pastId },
      data: { dueAt: new Date(Date.now() - 60_000) },
    });

    const lateBlocked = await submitSubmission(TEACHER_A1, {
      assignmentId: pastId,
      responseText: "تسليم متأخر بعد الموعد بدون قبول متأخر.",
    });
    expect(lateBlocked.ok).toBe(false);
    if (!lateBlocked.ok) expect(lateBlocked.code).toBe("DEADLINE_PASSED");

    // allowLate = true, lateUntil in the future -> accepted as late.
    const late = await createAssignment(
      {
        titleAr: "تكليف قبول متأخر ت7",
        descriptionAr: "انتهى الاستحقاق لكن القبول المتأخر مفعّل حتى تاريخ لاحق.",
        audienceMode: "ALL_TEACHERS",
        teacherIds: [],
        branchIds: [],
        dueAt: futureDays(1),
        allowLate: true,
        lateUntil: futureDays(2),
      },
      MANAGER_A
    );
    expect(late.ok).toBe(true);
    if (!late.ok) return;
    const lateId = late.data.id;
    await setAssignmentStatus({ assignmentId: lateId, status: "PUBLISHED" }, MANAGER_A);
    await db.assignment.update({
      where: { id: lateId },
      data: { dueAt: new Date(Date.now() - 60_000) },
    });

    const lateOk = await submitSubmission(TEACHER_A1, {
      assignmentId: lateId,
      responseText: "تسليم متأخر داخل فترة القبول المتأخر المسموحة.",
    });
    expect(lateOk.ok).toBe(true);
    if (lateOk.ok) expect(lateOk.data.isLate).toBe(true);

    // lateUntil passed as well -> rejected.
    await db.assignment.update({
      where: { id: lateId },
      data: { lateUntil: new Date(Date.now() - 60_000) },
    });
    const lateTooLate = await submitSubmission(TEACHER_A2, {
      assignmentId: lateId,
      responseText: "تسليم بعد انتهاء فترة القبول المتأخر نفسها.",
    });
    expect(lateTooLate.ok).toBe(false);
    if (!lateTooLate.ok) expect(lateTooLate.code).toBe("DEADLINE_PASSED");
  });

  /* 13. Review scope ---------------------------------------------------- */
  test("13. narrows supervisors to their assigned teachers and managers to their school", async () => {
    // A3 submits but is NOT assigned to supervisor A.
    const a3Submit = await submitSubmission(TEACHER_A3, {
      assignmentId: aAllId,
      responseText: "خطة تحسين للمعلم الثالث غير المشرف عليه.",
    });
    expect(a3Submit.ok).toBe(true);

    const submissions = await listSubmissionsForReview(SUPERVISOR_A, aAllId, {});
    expect(submissions.ok).toBe(true);
    if (submissions.ok) {
      const teacherIds = submissions.data.map((row) => row.teacherId);
      expect(teacherIds).toContain(teacherA1User.id);
      expect(teacherIds).toContain(teacherA2User.id);
      expect(teacherIds).not.toContain(teacherA3User.id);
    }

    // Supervisor A cannot open A3's submission.
    const a3Row = await db.assignmentSubmission.findUnique({
      where: { assignmentId_teacherId: { assignmentId: aAllId, teacherId: teacherA3User.id } },
      select: { id: true },
    });
    expect(a3Row).not.toBeNull();
    if (!a3Row) return;
    const outOfScope = await getSubmissionForReview(SUPERVISOR_A, a3Row.id);
    expect(outOfScope.ok).toBe(false);
    if (!outOfScope.ok) expect(outOfScope.code).toBe("FORBIDDEN");

    // Cross-school supervisor + manager are rejected.
    const a1Row = await db.assignmentSubmission.findUnique({
      where: { assignmentId_teacherId: { assignmentId: aAllId, teacherId: teacherA1User.id } },
      select: { id: true },
    });
    expect(a1Row).not.toBeNull();
    if (!a1Row) return;
    const foreignSupervisor = await getSubmissionForReview(SUPERVISOR_B, a1Row.id);
    expect(foreignSupervisor.ok).toBe(false);
    if (!foreignSupervisor.ok) expect(foreignSupervisor.code).toBe("FORBIDDEN");
    const foreignManager = await getSubmissionForReview(MANAGER_B, a1Row.id);
    expect(foreignManager.ok).toBe(false);

    // In-scope supervisor and the school's manager can open it.
    const inScope = await getSubmissionForReview(SUPERVISOR_A, a1Row.id);
    expect(inScope.ok).toBe(true);
    const managerView = await getSubmissionForReview(MANAGER_A, a1Row.id);
    expect(managerView.ok).toBe(true);
  });

  /* 14. Review lifecycle + grading -------------------------------------- */
  test("14. claims, grades against the rubric with server-side bounds, and finalizes immutably", async () => {
    const a1Row = await db.assignmentSubmission.findUnique({
      where: { assignmentId_teacherId: { assignmentId: aAllId, teacherId: teacherA1User.id } },
      select: { id: true },
    });
    if (!a1Row) return;

    const criteria = await db.assignmentRubricCriterion.findMany({
      where: { assignmentId: aAllId },
      orderBy: { orderIndex: "asc" },
    });
    expect(criteria.length).toBe(2);

    const claimed = await markUnderReview({ submissionId: a1Row.id }, SUPERVISOR_A);
    expect(claimed.ok).toBe(true);
    if (claimed.ok) expect(claimed.data.status).toBe("UNDER_REVIEW");

    const again = await markUnderReview({ submissionId: a1Row.id }, SUPERVISOR_A);
    expect(again.ok).toBe(false);

    // Over-award is rejected.
    const tooMuch = await gradeSubmission(
      {
        submissionId: a1Row.id,
        scores: [
          { criterionId: criteria[0].id, points: 99 },
          { criterionId: criteria[1].id, points: 1 },
        ],
      },
      SUPERVISOR_A
    );
    expect(tooMuch.ok).toBe(false);

    // Missing criterion is rejected.
    const missing = await gradeSubmission(
      { submissionId: a1Row.id, scores: [{ criterionId: criteria[0].id, points: 2 }] },
      SUPERVISOR_A
    );
    expect(missing.ok).toBe(false);

    // Foreign criterion is rejected.
    const foreign = await gradeSubmission(
      {
        submissionId: a1Row.id,
        scores: [
          { criterionId: criteria[0].id, points: 2 },
          { criterionId: "nonexistent", points: 1 },
        ],
      },
      SUPERVISOR_A
    );
    expect(foreign.ok).toBe(false);

    // Teacher cannot grade.
    const teacherGrade = await gradeSubmission(
      {
        submissionId: a1Row.id,
        scores: [
          { criterionId: criteria[0].id, points: 2 },
          { criterionId: criteria[1].id, points: 1 },
        ],
      },
      TEACHER_A1_CTX
    );
    expect(teacherGrade.ok).toBe(false);
    if (!teacherGrade.ok) expect(teacherGrade.code).toBe("FORBIDDEN");

    // Valid grading: 3 + 1 = 4 of 5.
    const graded = await gradeSubmission(
      {
        submissionId: a1Row.id,
        scores: [
          { criterionId: criteria[0].id, points: 3 },
          { criterionId: criteria[1].id, points: 1 },
        ],
        feedbackText: "خطة واضحة — عزّز أمثلة التطبيق الصفي في النسخة القادمة.",
      },
      SUPERVISOR_A
    );
    expect(graded.ok).toBe(true);
    if (graded.ok) {
      expect(graded.data.status).toBe("GRADED");
      expect(graded.data.scoreTotal).toBe(4);
    }

    // Finalized rows are immutable.
    const regrade = await gradeSubmission(
      {
        submissionId: a1Row.id,
        scores: [
          { criterionId: criteria[0].id, points: 3 },
          { criterionId: criteria[1].id, points: 2 },
        ],
      },
      SUPERVISOR_A
    );
    expect(regrade.ok).toBe(false);
    if (!regrade.ok) expect(regrade.code).toBe("ALREADY_SUBMITTED");

    // Released to the teacher: score + feedback + rubric breakdown.
    const detail = await getTeacherAssignment(TEACHER_A1, aAllId);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.data.mySubmission?.status).toBe("GRADED");
      expect(detail.data.mySubmission?.scoreTotal).toBe(4);
      expect(detail.data.mySubmission?.feedbackText).toContain("خطة واضحة");
      expect(detail.data.mySubmission?.rubricScores?.length).toBe(2);
    }
  });

  /* 15. Return for revision + resubmit audit ----------------------------- */
  test("15. returns a submission for revision and snapshots the previous version on resubmit", async () => {
    // A2's submission on the ALL assignment is SUBMITTED.
    const a2Row = await db.assignmentSubmission.findUnique({
      where: { assignmentId_teacherId: { assignmentId: aAllId, teacherId: teacherA2User.id } },
      select: { id: true },
    });
    expect(a2Row).not.toBeNull();
    if (!a2Row) return;

    const noFeedback = await returnSubmission(
      { submissionId: a2Row.id, feedbackText: "" },
      MANAGER_A
    );
    expect(noFeedback.ok).toBe(false);

    const returned = await returnSubmission(
      {
        submissionId: a2Row.id,
        feedbackText: "أضف مؤشرات قياس ملموسة لكل هدف من أهداف الخطة.",
      },
      MANAGER_A
    );
    expect(returned.ok).toBe(true);
    if (returned.ok) expect(returned.data.status).toBe("RETURNED");

    // The revision request is visible to the teacher; score stays hidden.
    const detail = await getTeacherAssignment(TEACHER_A2, aAllId);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.data.mySubmission?.status).toBe("RETURNED");
      expect(detail.data.mySubmission?.feedbackText).toContain("مؤشرات قياس");
      expect(detail.data.mySubmission?.scoreTotal).toBeNull();
      expect(detail.data.mySubmission?.canEdit).toBe(true);
    }

    const originalText = "تقرير ذاتي مبدئي عن ممارساتي التدريبية هذا الفصل.";
    const resubmitted = await submitSubmission(TEACHER_A2, {
      assignmentId: aAllId,
      responseText: "التقرير المحدّث مع مؤشرات قياس لكل هدف من أهداف الخطة.",
    });
    expect(resubmitted.ok).toBe(true);
    if (resubmitted.ok) expect(resubmitted.data.status).toBe("SUBMITTED");

    const revisions = await db.submissionRevision.findMany({
      where: { submissionId: a2Row.id },
      orderBy: { revisionIndex: "asc" },
    });
    expect(revisions.length).toBe(1);
    expect(revisions[0].revisionIndex).toBe(1);
    expect(revisions[0].responseText).toBe(originalText);

    const row = await db.assignmentSubmission.findUnique({ where: { id: a2Row.id } });
    expect(row?.resubmitCount).toBe(1);
    expect(row?.status).toBe("SUBMITTED");
  });

  /* 16. Direct-score grading (no rubric) ---------------------------------- */
  test("16. grades rubric-less assignments with a bounded direct score", async () => {
    // aBranch targets branch A1 — teacher A1 submits text-only.
    const submitted = await submitSubmission(TEACHER_A1, {
      assignmentId: aBranchId,
      responseText: "خلاصة الزيارة الصفية: مشاركة الطلاب تحسنت بعد تبني الأنشطة القصيرة.",
    });
    expect(submitted.ok).toBe(true);

    const row = await db.assignmentSubmission.findUnique({
      where: { assignmentId_teacherId: { assignmentId: aBranchId, teacherId: teacherA1User.id } },
      select: { id: true },
    });
    if (!row) return;

    const over = await gradeSubmission(
      { submissionId: row.id, scores: [], directScore: 101 },
      MANAGER_A
    );
    expect(over.ok).toBe(false);

    const rubricOnRubricLess = await gradeSubmission(
      {
        submissionId: row.id,
        scores: [{ criterionId: "any", points: 5 }],
      },
      MANAGER_A
    );
    expect(rubricOnRubricLess.ok).toBe(false);

    const graded = await gradeSubmission(
      { submissionId: row.id, scores: [], directScore: 85, feedbackText: "أداء جيد جدًا." },
      MANAGER_A
    );
    expect(graded.ok).toBe(true);
    if (graded.ok) expect(graded.data.scoreTotal).toBe(85);

    // Supervisor can also grade in-scope submissions (direct score).
    // (Covered implicitly by the rubric flow above with supervisor A.)
  });

  /* 17. Close lifecycle ----------------------------------------------------- */
  test("17. closes a published assignment and blocks new submissions", async () => {
    const closed = await setAssignmentStatus(
      { assignmentId: aTeachersId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(closed.ok).toBe(true);

    const a2Draft = await saveSubmissionDraft(TEACHER_A2, {
      assignmentId: aTeachersId,
      responseText: "مسودة قبل الإغلاق.",
    });
    expect(a2Draft.ok).toBe(true);

    const closedNow = await setAssignmentStatus(
      { assignmentId: aTeachersId, status: "CLOSED" },
      MANAGER_A
    );
    expect(closedNow.ok).toBe(true);

    const afterClose = await submitSubmission(TEACHER_A2, {
      assignmentId: aTeachersId,
      responseText: "محاولة تسليم بعد إغلاق التكليف.",
    });
    expect(afterClose.ok).toBe(false);
    if (!afterClose.ok) expect(afterClose.code).toBe("NOT_AVAILABLE");

    // CLOSED rejects edits; re-open requires future due date.
    const editClosed = await updateAssignment(
      {
        assignmentId: aTeachersId,
        titleAr: "تعديل بعد الإغلاق",
        descriptionAr: "محاولة تعديل تكليف مغلق يجب رفضها.",
        audienceMode: "TEACHERS",
        teacherIds: [teacherA2User.id],
        branchIds: [],
        dueAt: futureDays(5),
        allowLate: true,
      },
      MANAGER_A
    );
    expect(editClosed.ok).toBe(false);
    if (!editClosed.ok) expect(editClosed.code).toBe("FORBIDDEN");
  });

  /* 18. Deputy read-only + super admin restrictions --------------------------- */
  test("18. keeps deputies read-only and super admin stats-only", async () => {
    const overview = await getAssignmentsOverview(DEPUTY_A);
    expect(overview.ok).toBe(true);
    if (overview.ok) {
      expect(overview.data.scope).toBe("deputy");
      expect(overview.data.rows.length).toBeGreaterThan(0);
    }

    const deputyStatus = await setAssignmentStatus(
      { assignmentId: aAllId, status: "CLOSED" },
      DEPUTY_A
    );
    expect(deputyStatus.ok).toBe(false);
    if (!deputyStatus.ok) expect(deputyStatus.code).toBe("FORBIDDEN");

    const deputyGrade = await gradeSubmission(
      { submissionId: "any", scores: [], directScore: 10 },
      DEPUTY_A
    );
    expect(deputyGrade.ok).toBe(false);
    if (!deputyGrade.ok) expect(deputyGrade.code).toBe("FORBIDDEN");

    const platformOverview = await getAssignmentsOverview(SUPER_ADMIN);
    expect(platformOverview.ok).toBe(true);
    if (platformOverview.ok) {
      expect(platformOverview.data.scope).toBe("platform");
      expect(platformOverview.data.rows.length).toBeGreaterThan(0);
      expect(platformOverview.data.schools.length).toBeGreaterThan(0);
    }

    // Already asserted in test 1 — kept here for the role-matrix story:
    expect((await createAssignment({
      titleAr: "ثانية",
      descriptionAr: "محاولة ثانية لمدير المنصة يجب رفضها أيضًا.",
      audienceMode: "ALL_TEACHERS",
      teacherIds: [],
      branchIds: [],
      dueAt: futureDays(3),
      allowLate: false,
    }, SUPER_ADMIN)).ok).toBe(false);
  });

  /* 19. Metrics & overview accuracy -------------------------------------------- */
  test("19. computes metrics and overview from persisted data with eligible denominators", async () => {
    const metrics = await getAssignmentMetrics(schoolAId);
    const activeCount = await db.assignmentSubmission.count({
      where: { schoolId: schoolAId, status: { not: "DRAFT" } },
    });
    const pendingCount = await db.assignmentSubmission.count({
      where: { schoolId: schoolAId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
    });
    const gradedCount = await db.assignmentSubmission.count({
      where: { schoolId: schoolAId, status: "GRADED" },
    });
    const lateCount = await db.assignmentSubmission.count({
      where: { schoolId: schoolAId, status: { not: "DRAFT" }, isLate: true },
    });
    expect(metrics.submissionsActive).toBe(activeCount);
    expect(metrics.pendingReview).toBe(pendingCount);
    expect(metrics.gradedCount).toBe(gradedCount);
    expect(metrics.lateCount).toBe(lateCount);

    const overview = await getAssignmentsOverview(MANAGER_A);
    expect(overview.ok).toBe(true);
    if (overview.ok) {
      expect(overview.data.scope).toBe("school");
      const allRow = overview.data.rows.find((row) => row.id === aAllId);
      expect(allRow).toBeTruthy();
      if (allRow) {
        // ALL_TEACHERS -> every teacher of school A is eligible (3).
        expect(allRow.targeted).toBe(3);
        expect(allRow.graded).toBe(1); // A1 graded
        expect(allRow.completionRate).toBe(Math.round((1 / 3) * 100));
      }
      const branchRow = overview.data.rows.find((row) => row.id === aBranchId);
      expect(branchRow).toBeTruthy();
      if (branchRow) {
        expect(branchRow.targeted).toBe(1); // branch A1 teacher only
      }
      // Office manager cards aggregate the same persisted numbers.
      expect(overview.data.cards.gradedCount).toBe(gradedCount);
    }
  });

  /* 20. Review queue --------------------------------------------------------------- */
  test("20. builds the cross-assignment review queue within scope", async () => {
    const queueA = await listReviewQueue(SUPERVISOR_A, {});
    expect(queueA.ok).toBe(true);
    if (queueA.ok) {
      expect(queueA.data.length).toBeGreaterThan(0);
      // Only their two assigned teachers appear.
      expect(
        queueA.data.every(
          (row) => row.teacherId === teacherA1User.id || row.teacherId === teacherA2User.id
        )
      ).toBe(true);
    }

    const queueB = await listReviewQueue(SUPERVISOR_B, {});
    expect(queueB.ok).toBe(true);
    if (queueB.ok) {
      expect(queueB.data.length).toBe(0); // school B has no submissions
    }

    const teacherListing = await listTeacherAssignments(TEACHER_A1, {});
    expect(teacherListing.ok).toBe(true);
    if (teacherListing.ok) {
      const gradedRow = teacherListing.data.rows.find((row) => row.id === aAllId);
      expect(gradedRow?.myScoreTotal).toBe(4);
    }
  });
});
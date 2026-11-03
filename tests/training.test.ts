/**
 * Phase 5 integration tests — training academy service layer.
 *
 * Runs against the dedicated SQLite file (prisma/test-platform.db) with
 * the real Prisma client — no mocks. Files go to a REAL local-disk
 * storage directory (storage-test-uploads) via the storage adapter.
 *
 * Run: bun test tests/training.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const TEST_DB_URL = `file:${path.join(PROJECT_ROOT, "prisma", "test-platform.db")}`;
const UPLOAD_DIR = path.join(PROJECT_ROOT, "storage-test-uploads");

// MUST be assigned before the dynamic imports below.
process.env.DATABASE_URL = TEST_DB_URL;
process.env.LOCAL_STORAGE_DIR = UPLOAD_DIR;
process.env.STORAGE_DRIVER = "local";

beforeAll(() => {
  execSync("bunx prisma db push --skip-generate --accept-data-loss", {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
});

afterAll(async () => {
  // Training tables first (FK order), then the base records.
  await db.courseEnrollment.deleteMany({});
  await db.courseLesson.deleteMany({});
  await db.attachment.deleteMany({});
  await db.courseSection.deleteMany({});
  await db.course.deleteMany({});
  await db.trainingProgram.deleteMany({});
  await db.user.deleteMany({});
  await db.school.deleteMany({});
  rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

// Dynamic imports after the env override.
const { db } = await import("@/lib/db");
const { getSchoolsMetrics } = await import("@/lib/schools/service");
const {
  createProgram,
  updateProgram,
  listProgramsForManage,
} = await import("@/lib/training/service");
const {
  createCourse,
  updateCourse,
  setCourseStatus,
  listCoursesForManage,
  listPublishedCourses,
  getCourseForViewer,
  getLessonForViewer,
  enrollTeacher,
  getAcademyMetrics,
} = await import("@/lib/training/service");
const {
  createSection,
  updateSection,
  moveSection,
  deleteSection,
  createLesson,
  updateLesson,
  moveLesson,
  deleteLesson,
  uploadAttachment,
} = await import("@/lib/training/content");
const {
  canViewPublishedContent,
  canAccessAttachment,
  publishedVisibilityWhere,
} = await import("@/lib/training/access");
const { validateUpload, isAllowedExternalVideoUrl } = await import(
  "@/lib/validation/training"
);
const { getStorage, buildStorageKey, sanitizeFileName } = await import(
  "@/lib/storage"
);

/* ------------------------------------------------------------------ */
/* Fixtures: two schools + real users (createdById hits the FK).        */
/* ------------------------------------------------------------------ */

const schoolAId = (
  await db.school.create({
    data: { nameAr: "مدرسة الأكاديمية أ", nameEn: "Academy School A", slug: "academy-a" },
  })
).id;
const schoolBId = (
  await db.school.create({
    data: { nameAr: "مدرسة الأكاديمية ب", nameEn: "Academy School B", slug: "academy-b" },
  })
).id;

async function seedUser(
  email: string,
  role: string,
  schoolId: string | null
): Promise<{ id: string; name: string }> {
  const { hashPassword } = await import("@/lib/auth/password");
  const user = await db.user.create({
    data: {
      name: `مستخدم ${role} (${email})`,
      email,
      passwordHash: await hashPassword("Test-Password-123"),
      role,
      schoolId,
      emailVerifiedAt: role === "TEACHER" ? new Date() : null,
    },
  });
  return { id: user.id, name: user.name };
}

const superAdminUser = await seedUser("p5-super@test.local", "SUPER_ADMIN", null);
const managerAUser = await seedUser("p5-manager-a@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolAId);
const managerBUser = await seedUser("p5-manager-b@test.local", "DEVELOPMENT_OFFICE_MANAGER", schoolBId);
const teacherAUser = await seedUser("p5-teacher-a@test.local", "TEACHER", schoolAId);
const teacherBUser = await seedUser("p5-teacher-b@test.local", "TEACHER", schoolBId);

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
/** Teacher is NOT an AdminContext — cast documents that explicitly. */
const TEACHER_A_CTX = {
  id: teacherAUser.id,
  name: teacherAUser.name,
  role: "TEACHER",
  schoolId: schoolAId,
} as unknown as Parameters<typeof setCourseStatus>[1];
const TEACHER_A_VIEWER = { id: teacherAUser.id, role: "TEACHER", schoolId: schoolAId };
const TEACHER_B_VIEWER = { id: teacherBUser.id, role: "TEACHER", schoolId: schoolBId };

describe("Phase 5 — training academy service", () => {
  let programPlatformId = "";
  let programAId = "";
  let courseId = "";
  let otherCourseId = "";
  let publishedCourseId = "";
  let sectionAId = "";
  let sectionBId = "";

  /* 1. Creating training programs ----------------------------------- */
  test("1. creates programs: platform-wide by SUPER_ADMIN, school-scoped by office manager", async () => {
    const platform = await createProgram(
      {
        nameAr: "برنامج منصة مشترك للاختبار",
        descriptionAr: "وصف برنامج مشترك على مستوى المنصة للاختبار.",
        category: "pedagogy",
        scope: "platform",
      },
      SUPER_ADMIN
    );
    expect(platform.ok).toBe(true);
    if (platform.ok) programPlatformId = platform.data.id;

    const scoped = await createProgram(
      {
        nameAr: "برنامج مدرسة أ للاختبار",
        descriptionAr: "وصف برنامج خاص بمدرسة أ للاختبار.",
        category: "technology",
        scope: "school",
      },
      MANAGER_A
    );
    expect(scoped.ok).toBe(true);
    if (scoped.ok) programAId = scoped.data.id;

    // Office manager can never create platform-wide content.
    const denied = await createProgram(
      {
        nameAr: "محاولة مشتركة",
        descriptionAr: "محاولة مدير مكتب لإنشاء محتوى مشترك.",
        category: "pedagogy",
        scope: "platform",
      },
      MANAGER_A
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("FORBIDDEN");
  });

  /* 2. Creating and editing a course -------------------------------- */
  test("2. creates and edits a course with persisted changes", async () => {
    const created = await createCourse(
      {
        titleAr: "دورة التعلم النشط",
        descriptionAr: "دورة تدريبية عن استراتيجيات التعلم النشط في الصف.",
        category: "pedagogy",
        programId: programAId,
        level: "BEGINNER",
        estimatedHours: "5",
        scope: "school",
      },
      MANAGER_A
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    courseId = created.data.id;

    const edited = await updateCourse(
      {
        courseId,
        titleAr: "دورة التعلم النشط المحدّثة",
        descriptionAr: "وصف محدّث لاستراتيجيات التعلم النشط في الصف.",
        category: "pedagogy",
        estimatedHours: "6",
        scope: "school",
      },
      MANAGER_A
    );
    expect(edited.ok).toBe(true);

    const reloaded = await db.course.findUnique({ where: { id: courseId } });
    expect(reloaded?.titleAr).toBe("دورة التعلم النشط المحدّثة");
    expect(reloaded?.status).toBe("DRAFT");
    expect(reloaded?.estimatedHours).toBe(6);
  });

  /* 3. Arabic required-field validation ------------------------------ */
  test("3. rejects missing Arabic title/short description with field errors", async () => {
    const noTitle = await createCourse(
      {
        titleAr: "",
        descriptionAr: "وصف كافٍ للتحقق من مسار الخطأ هنا.",
        category: "pedagogy",
        scope: "school",
      },
      MANAGER_A
    );
    expect(noTitle.ok).toBe(false);
    if (!noTitle.ok) {
      expect(noTitle.code).toBe("VALIDATION_ERROR");
      expect(noTitle.fieldErrors?.titleAr).toBeTruthy();
    }

    const shortDescription = await createCourse(
      {
        titleAr: "عنوان صحيح",
        descriptionAr: "قصير",
        category: "pedagogy",
        scope: "school",
      },
      MANAGER_A
    );
    expect(shortDescription.ok).toBe(false);
    if (!shortDescription.ok) {
      expect(shortDescription.fieldErrors?.descriptionAr).toBeTruthy();
    }
  });

  /* 4. Sections and lessons + relation validation --------------------- */
  test("4. creates sections and lessons, validating section-course membership", async () => {
    const s1 = await createSection(
      { courseId, titleAr: "الوحدة الأولى" },
      MANAGER_A
    );
    expect(s1.ok).toBe(true);
    if (s1.ok) sectionAId = s1.data.id;

    const s2 = await createSection(
      { courseId, titleAr: "الوحدة الثانية" },
      MANAGER_A
    );
    expect(s2.ok).toBe(true);
    if (s2.ok) sectionBId = s2.data.id;

    const textLesson = await createLesson(
      {
        courseId,
        sectionId: sectionAId,
        titleAr: "مقدمة نظرية",
        type: "TEXT",
        content: "محتوى نصي للدرس الأول يشرح مدخل التعلم النشط.",
        isPublished: true,
      },
      MANAGER_A
    );
    expect(textLesson.ok).toBe(true);

    const externalLesson = await createLesson(
      {
        courseId,
        sectionId: sectionAId,
        titleAr: "فيديو تعريفي",
        type: "EXTERNAL_VIDEO",
        videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        isPublished: true,
      },
      MANAGER_A
    );
    expect(externalLesson.ok).toBe(true);

    // TEXT lesson without content is rejected.
    const emptyText = await createLesson(
      {
        courseId,
        sectionId: sectionAId,
        titleAr: "درس نصي فارغ",
        type: "TEXT",
      },
      MANAGER_A
    );
    expect(emptyText.ok).toBe(false);

    // A section from ANOTHER course is rejected for this course.
    const otherCourse = await createCourse(
      {
        titleAr: "دورة أخرى لمدرسة أ",
        descriptionAr: "دورة مستقلة للتحقق من صحة العلاقات بين الكيانات.",
        category: "classroom",
        scope: "school",
      },
      MANAGER_A
    );
    expect(otherCourse.ok).toBe(true);
    if (!otherCourse.ok) return;
    otherCourseId = otherCourse.data.id;
    const otherSection = await createSection(
      { courseId: otherCourseId, titleAr: "قسم الدورة الأخرى" },
      MANAGER_A
    );
    expect(otherSection.ok).toBe(true);

    const wrongSectionLesson = await createLesson(
      {
        courseId,
        sectionId: otherSection.ok ? otherSection.data.id : "",
        titleAr: "درس بقسم خاطئ",
        type: "TEXT",
        content: "محتوى لن يُحفظ لأن القسم لا ينتمي للدورة.",
      },
      MANAGER_A
    );
    expect(wrongSectionLesson.ok).toBe(false);
    if (!wrongSectionLesson.ok) {
      expect(wrongSectionLesson.code).toBe("RELATION_ERROR");
    }
  });

  /* 5. Section and lesson ordering (swap moves persist) --------------- */
  test("5. preserves and re-orders sections and lessons", async () => {
    let sections = await db.courseSection.findMany({
      where: { courseId },
      orderBy: { orderIndex: "asc" },
    });
    expect(sections.map((section) => section.orderIndex)).toEqual([0, 1]);

    const moved = await moveSection(
      { courseId, sectionId: sectionBId, direction: "up" },
      MANAGER_A
    );
    expect(moved.ok).toBe(true);
    sections = await db.courseSection.findMany({
      where: { courseId },
      orderBy: { orderIndex: "asc" },
    });
    expect(sections[0].id).toBe(sectionBId);
    expect(sections[1].id).toBe(sectionAId);

    const movedBack = await moveSection(
      { courseId, sectionId: sectionBId, direction: "down" },
      MANAGER_A
    );
    expect(movedBack.ok).toBe(true);
    sections = await db.courseSection.findMany({
      where: { courseId },
      orderBy: { orderIndex: "asc" },
    });
    expect(sections[0].id).toBe(sectionAId);

    // Lesson swap inside section A.
    const lessons = await db.courseLesson.findMany({
      where: { sectionId: sectionAId },
      orderBy: { orderIndex: "asc" },
    });
    expect(lessons.length).toBe(2);
    const firstId = lessons[0].id;
    const swap = await moveLesson(
      { courseId, lessonId: firstId, direction: "down" },
      MANAGER_A
    );
    expect(swap.ok).toBe(true);
    const swapped = await db.courseLesson.findMany({
      where: { sectionId: sectionAId },
      orderBy: { orderIndex: "asc" },
    });
    expect(swapped[0].id).not.toBe(firstId);
    expect(swapped[1].id).toBe(firstId);
  });

  /* 6 + 7. Publish workflow validation -------------------------------- */
  test("6. publishes a valid course and stamps publishedAt", async () => {
    const published = await setCourseStatus(
      { courseId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(published.ok).toBe(true);
    if (published.ok) {
      expect(published.data.status).toBe("PUBLISHED");
      expect(published.data.publishedAt).not.toBeNull();
    }
    publishedCourseId = courseId;
  });

  test("7. rejects publishing a course with no content", async () => {
    const empty = await setCourseStatus(
      { courseId: otherCourseId, status: "PUBLISHED" },
      MANAGER_A
    );
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe("PUBLISH_BLOCKED");
  });

  /* 8. Teachers can never publish or manage --------------------------- */
  test("8. rejects teacher role from publishing and content mutations", async () => {
    const publish = await setCourseStatus(
      { courseId, status: "PUBLISHED" },
      TEACHER_A_CTX
    );
    expect(publish.ok).toBe(false);
    if (!publish.ok) expect(publish.code).toBe("FORBIDDEN");

    const section = await createSection(
      { courseId, titleAr: "قسم بمعلم" },
      TEACHER_A_CTX!
    );
    expect(section.ok).toBe(false);
    if (!section.ok) expect(section.code).toBe("FORBIDDEN");
  });

  /* 9. Cross-school isolation ----------------------------------------- */
  test("9. blocks cross-school management and private-course viewing", async () => {
    const edit = await updateCourse(
      {
        courseId,
        titleAr: "عنوان من مدرسة ب",
        descriptionAr: "محاولة تعديل من مدير مدرسة أخرى — يجب أن تُرفض.",
        category: "pedagogy",
        scope: "school",
      },
      MANAGER_B
    );
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.code).toBe("FORBIDDEN");

    // Teacher of school B cannot open school A's course.
    const view = await getCourseForViewer(TEACHER_B_VIEWER, courseId);
    expect(view.ok).toBe(false);
    if (!view.ok) expect(view.code).toBe("FORBIDDEN");

    // And it never appears in B's catalog.
    const catalog = await listPublishedCourses(TEACHER_B_VIEWER, {});
    expect(catalog.ok).toBe(true);
    if (catalog.ok) {
      expect(catalog.data.rows.some((row) => row.id === courseId)).toBe(false);
    }
  });

  /* 10. Drafts/archived hidden from teacher browsing ------------------- */
  test("10. hides draft and archived courses from the teacher catalog", async () => {
    // Archivable course (school A): needs valid content to publish first.
    const archivable = await createCourse(
      {
        titleAr: "دورة ستُؤرشف للاختبار",
        descriptionAr: "دورة كاملة المحتوى سيتم نشرها ثم أرشفتها للاختبار.",
        category: "growth",
        scope: "school",
      },
      MANAGER_A
    );
    expect(archivable.ok).toBe(true);
    let archivedId = "";
    if (archivable.ok) {
      archivedId = archivable.data.id;
      const section = await createSection(
        { courseId: archivedId, titleAr: "قسم الدورة المؤرشفة" },
        MANAGER_A
      );
      expect(section.ok).toBe(true);
      if (section.ok) {
        const lesson = await createLesson(
          {
            courseId: archivedId,
            sectionId: section.data.id,
            titleAr: "درس الدورة المؤرشفة",
            type: "TEXT",
            content: "محتوى يكمل شرط النشر قبل الأرشفة.",
            isPublished: true,
          },
          MANAGER_A
        );
        expect(lesson.ok).toBe(true);
      }
      const published = await setCourseStatus(
        { courseId: archivedId, status: "PUBLISHED" },
        MANAGER_A
      );
      expect(published.ok).toBe(true);
      const archived = await setCourseStatus(
        { courseId: archivedId, status: "ARCHIVED" },
        MANAGER_A
      );
      expect(archived.ok).toBe(true);
    }

    // Draft course (school A).
    const draft = await createCourse(
      {
        titleAr: "دورة مسودة للاختبار",
        descriptionAr: "دورة لم تُنشر بعد ويجب ألا تظهر للمعلمين.",
        category: "growth",
        scope: "school",
      },
      MANAGER_A
    );
    expect(draft.ok).toBe(true);

    const catalog = await listPublishedCourses(TEACHER_A_VIEWER, {});
    expect(catalog.ok).toBe(true);
    if (catalog.ok) {
      const ids = catalog.data.rows.map((row) => row.id);
      expect(ids).toContain(courseId);
      expect(ids).not.toContain(archivedId);
      expect(ids).not.toContain(otherCourseId);
      if (draft.ok) expect(ids).not.toContain(draft.data.id);
    }

    // Visibility predicate agrees.
    expect(canViewPublishedContent(TEACHER_A_VIEWER, { status: "DRAFT", schoolId: schoolAId })).toBe(false);
    expect(canViewPublishedContent(TEACHER_A_VIEWER, { status: "ARCHIVED", schoolId: schoolAId })).toBe(false);
    expect(canViewPublishedContent(TEACHER_A_VIEWER, { status: "PUBLISHED", schoolId: schoolAId })).toBe(true);
  });

  /* 11. Attachment ownership & access ---------------------------------- */
  test("11. validates attachment ownership and access rules", async () => {
    // Real upload into school A's course (PNG cover).
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10])], "cover.png", {
      type: "image/png",
    });
    const uploaded = await uploadAttachment(
      { kind: "COVER", courseId, file },
      MANAGER_A
    );
    expect(uploaded.ok).toBe(true);
    const coverId = uploaded.ok ? uploaded.data.id : "";
    if (coverId) {
      const bytes = await getStorage().get(
        (
          await db.attachment.findUnique({
            where: { id: coverId },
            select: { storageKey: true },
          })
        )?.storageKey ?? ""
      );
      expect(bytes?.byteLength).toBe(6);
    }

    // A RESOURCE attachment in the OTHER course must be rejected when a
    // lesson of the first course references it.
    const foreignFile = new File([new Uint8Array([1, 2, 3])], "doc.pdf", {
      type: "application/pdf",
    });
    const foreign = await uploadAttachment(
      { kind: "RESOURCE", courseId: otherCourseId, file: foreignFile },
      MANAGER_A
    );
    expect(foreign.ok).toBe(true);
    if (foreign.ok) {
      const lesson = await createLesson(
        {
          courseId,
          sectionId: sectionAId,
          titleAr: "درس بملف أجنبي",
          type: "RESOURCE",
          attachmentId: foreign.data.id,
        },
        MANAGER_A
      );
      expect(lesson.ok).toBe(false);
      if (!lesson.ok) expect(lesson.code).toBe("RELATION_ERROR");
    }

    // Access checks on the cover attachment (owned by school A course).
    const attachmentRow = await db.attachment.findUnique({
      where: { id: coverId },
      select: { courseId: true },
    });
    const courseRow = await db.course.findUnique({
      where: { id: courseId },
      select: { status: true, schoolId: true },
    });
    const attachmentForAccess = {
      courseId: attachmentRow?.courseId ?? null,
      programId: null,
    };
    expect(
      canAccessAttachment(
        TEACHER_A_VIEWER,
        attachmentForAccess,
        courseRow,
        null
      )
    ).toBe(true);
    expect(
      canAccessAttachment(
        TEACHER_B_VIEWER,
        attachmentForAccess,
        courseRow,
        null
      )
    ).toBe(false);
  });

  /* 12. Upload type & size validation ---------------------------------- */
  test("12. enforces upload MIME allow-lists and size caps", () => {
    expect(
      validateUpload({
        kind: "COVER",
        fileName: "evil.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 10,
      }).ok
    ).toBe(false);
    expect(
      validateUpload({
        kind: "COVER",
        fileName: "big.png",
        mimeType: "image/png",
        sizeBytes: 6 * 1024 * 1024,
      }).ok
    ).toBe(false);
    expect(
      validateUpload({
        kind: "VIDEO",
        fileName: "lesson.mp4",
        mimeType: "video/mp4",
        sizeBytes: 201 * 1024 * 1024,
      }).ok
    ).toBe(false);
    expect(
      validateUpload({
        kind: "RESOURCE",
        fileName: "handout.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }).ok
    ).toBe(true);
    // External video URLs: https + allow-listed hosts only.
    expect(isAllowedExternalVideoUrl("https://www.youtube.com/watch?v=x")).toBe(true);
    expect(isAllowedExternalVideoUrl("http://www.youtube.com/watch?v=x")).toBe(false);
    expect(isAllowedExternalVideoUrl("https://evil.example.com/video")).toBe(false);

    // Storage keys never trust client paths.
    const key = buildStorageKey("courses", "../../etc/passwd");
    expect(key.startsWith("courses/")).toBe(true);
    expect(key.includes("..")).toBe(false);
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("/");
  });

  /* 13. Persistence after refresh (re-query everything) ---------------- */
  test("13. persists publishing, ordering and edits after re-query", async () => {
    const manage = await listCoursesForManage(MANAGER_A, {});
    expect(manage.ok).toBe(true);
    if (manage.ok) {
      const row = manage.data.rows.find((item) => item.id === courseId);
      expect(row?.status).toBe("PUBLISHED");
      expect(row?.lessonsCount).toBe(2);
      expect(row?.sectionsCount).toBe(2);
    }

    const view = await getCourseForViewer(TEACHER_A_VIEWER, courseId);
    expect(view.ok).toBe(true);
    if (view.ok) {
      expect(view.data.sections.map((section) => section.orderIndex)).toEqual([0, 1]);
      const flatLessons = view.data.sections.flatMap((section) => section.lessons);
      expect(flatLessons.length).toBe(2);
      const lessonNav = await getLessonForViewer(
        TEACHER_A_VIEWER,
        courseId,
        flatLessons[0].id
      );
      expect(lessonNav.ok).toBe(true);
      if (lessonNav.ok) {
        expect(lessonNav.data.course.id).toBe(courseId);
        expect(lessonNav.data.outline.length).toBe(2);
      }
    }

    // Manage listing (programs) reflects created rows.
    const programs = await listProgramsForManage(MANAGER_A);
    expect(programs.ok).toBe(true);
    if (programs.ok) {
      expect(programs.data.some((program) => program.id === programAId)).toBe(true);
    }
  });

  /* 14. Existing phases still work + academy metrics ------------------- */
  test("14. keeps existing school metrics working and exposes academy metrics", async () => {
    const schools = await getSchoolsMetrics();
    expect(schools.totalSchools).toBeGreaterThanOrEqual(2);

    const metrics = await getAcademyMetrics(schoolAId);
    expect(metrics.coursesTotal).toBeGreaterThanOrEqual(3);
    expect(metrics.coursesPublished).toBeGreaterThanOrEqual(1);
    expect(metrics.programsTotal).toBeGreaterThanOrEqual(1);

    // Enrollment flow: teacher A enrolls in the published course; teacher
    // B (other school) is rejected; duplicate enrollment is idempotent.
    const enroll = await enrollTeacher(TEACHER_A_VIEWER, { courseId });
    expect(enroll.ok).toBe(true);
    if (enroll.ok) expect(enroll.data.alreadyEnrolled).toBe(false);

    const duplicate = await enrollTeacher(TEACHER_A_VIEWER, { courseId });
    expect(duplicate.ok).toBe(true);
    if (duplicate.ok) expect(duplicate.data.alreadyEnrolled).toBe(true);

    const foreign = await enrollTeacher(TEACHER_B_VIEWER, { courseId });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe("FORBIDDEN");

    const metricsAfter = await getAcademyMetrics(schoolAId);
    expect(metricsAfter.enrollmentsCount).toBe(metrics.enrollmentsCount + 1);

    // Section deletion cascades lessons + attachments cleanly.
    const removed = await deleteSection(courseId, sectionBId, MANAGER_A);
    expect(removed.ok).toBe(true);
    const remainingSections = await db.courseSection.count({
      where: { courseId },
    });
    expect(remainingSections).toBe(1);
  });
});
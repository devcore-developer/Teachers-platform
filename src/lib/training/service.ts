import { Prisma } from "@prisma/client";

import type { AdminContext } from "@/lib/auth/dev-admin";
import type { ViewerIdentity } from "@/lib/training/access";
import {
  canManageTraining,
  publishedVisibilityWhere,
  trainingScopeError,
} from "@/lib/training/access";
import { db } from "@/lib/db";
import {
  COURSES_PAGE_SIZE,
  CONTENT_STATUSES,
} from "@/config/training";
import {
  createCourseSchema,
  createProgramSchema,
  enrollSchema,
  normalizeContentName,
  setCourseStatusSchema,
  setProgramStatusSchema,
  updateCourseSchema,
  updateProgramSchema,
  zodFieldErrors,
  type TrainingErrorCode,
  type TrainingResult,
} from "@/lib/validation/training";

/* ------------------------------------------------------------------ */
/* Phase 5 — training service: programs, courses, publishing,           */
/* enrollment and metrics.                                              */
/*                                                                      */
/* Every mutation re-validates ownership on the server: the actor's     */
/* scope comes from AdminContext (session-backed), never from the       */
/* client. Platform-wide records (schoolId null) are SUPER_ADMIN-only.  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Shared row shapes consumed by pages (RSC-serializable).              */
/* ------------------------------------------------------------------ */

export interface CourseCatalogRow {
  id: string;
  titleAr: string;
  category: string;
  level: string | null;
  estimatedHours: number | null;
  status: string;
  updatedAt: Date;
  coverAttachmentId: string | null;
  programId: string | null;
  programName: string | null;
  schoolName: string | null;
  sectionsCount: number;
  lessonsCount: number;
  enrolled?: boolean;
}

export interface ViewerLesson {
  id: string;
  titleAr: string;
  type: string;
  description: string | null;
  content: string | null;
  videoUrl: string | null;
  attachmentId: string | null;
  attachmentName: string | null;
  orderIndex: number;
}

export interface ViewerSection {
  id: string;
  titleAr: string;
  description: string | null;
  orderIndex: number;
  lessons: ViewerLesson[];
}

export interface CourseLearningView {
  course: {
    id: string;
    titleAr: string;
    titleEn: string | null;
    descriptionAr: string;
    descriptionEn: string | null;
    category: string;
    level: string | null;
    estimatedHours: number | null;
    status: string;
    coverAttachmentId: string | null;
    programName: string | null;
    instructorName: string | null;
    schoolName: string | null;
  };
  sections: ViewerSection[];
  publishedLessonsCount: number;
  enrollment: { id: string; enrolledAt: Date } | null;
}

export interface LessonLearningView {
  course: { id: string; titleAr: string };
  sectionTitle: string;
  lesson: ViewerLesson;
  outline: ViewerSection[];
  prevLessonId: string | null;
  nextLessonId: string | null;
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                     */
/* ------------------------------------------------------------------ */

function fail<T>(
  message: string,
  code?: TrainingErrorCode,
  fieldErrors?: Record<string, string>
): TrainingResult<T> {
  return { ok: false, message, code, fieldErrors };
}

function validationFail<T>(error: { issues: unknown[] }): TrainingResult<T> {
  // Narrow local cast — zod v4 ZodError shape.
  const fieldErrors = zodFieldErrors(error as never);
  return {
    ok: false,
    message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
    fieldErrors,
    code: "VALIDATION_ERROR",
  };
}

/** Resolve the owning school for a new program/course from the actor. */
function resolveScope(
  ctx: AdminContext,
  scope: "platform" | "school",
  schoolId: string | undefined
): { ok: true; schoolId: string | null } | { ok: false; message: string; code: TrainingErrorCode } {
  if (ctx.role === "DEVELOPMENT_OFFICE_MANAGER") {
    if (scope === "platform") {
      return {
        ok: false,
        message:
          "المحتوى المشترك على مستوى المنصة متاح لمدير المنصة فقط",
        code: "FORBIDDEN",
      };
    }
    return { ok: true, schoolId: ctx.schoolId };
  }
  // SUPER_ADMIN
  if (scope === "platform") return { ok: true, schoolId: null };
  if (!schoolId) {
    return {
      ok: false,
      message: "اختر المدرسة المالكة للمحتوى",
      code: "VALIDATION_ERROR",
    };
  }
  return { ok: true, schoolId };
}

/** Defense-in-depth guard: content mutations are manager-only. */
function managerGuard(ctx: AdminContext): TrainingResult<never> | null {
  if (!canManageTraining(ctx.role)) {
    return {
      ok: false,
      message: "إدارة المحتوى التدريبي متاحة لمدير المنصة ومديري مكاتب التطوير فقط",
      code: "FORBIDDEN",
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Programs                                                             */
/* ------------------------------------------------------------------ */

/** Program options for the course form: own (non-archived) + platform PUBLISHED. */
export async function listProgramOptionsForManage(
  ctx: AdminContext
): Promise<{ id: string; nameAr: string; schoolId: string | null; platformWide: boolean }[]> {
  if (ctx.role === "SUPER_ADMIN") {
    const rows = await db.trainingProgram.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { id: true, nameAr: true, schoolId: true },
      orderBy: { nameAr: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      nameAr: row.nameAr,
      schoolId: row.schoolId,
      platformWide: row.schoolId === null,
    }));
  }
  const rows = await db.trainingProgram.findMany({
    where: {
      status: { not: "ARCHIVED" },
      OR: [{ schoolId: ctx.schoolId }, { schoolId: null, status: "PUBLISHED" }],
    },
    select: { id: true, nameAr: true, schoolId: true },
    orderBy: { nameAr: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    nameAr: row.nameAr,
    schoolId: row.schoolId,
    platformWide: row.schoolId === null,
  }));
}

export interface ManageProgramRow {
  id: string;
  nameAr: string;
  nameEn: string | null;
  descriptionAr: string;
  descriptionEn: string | null;
  category: string;
  status: string;
  schoolId: string | null;
  schoolName: string | null;
  coursesCount: number;
  updatedAt: Date;
}

export async function listProgramsForManage(
  ctx: AdminContext
): Promise<TrainingResult<ManageProgramRow[]>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const where: Prisma.TrainingProgramWhereInput =
    ctx.role === "SUPER_ADMIN" ? {} : { schoolId: ctx.schoolId };

  const rows = await db.trainingProgram.findMany({
    where,
    include: {
      school: { select: { nameAr: true } },
      _count: { select: { courses: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      descriptionAr: row.descriptionAr,
      descriptionEn: row.descriptionEn,
      category: row.category,
      status: row.status,
      schoolId: row.schoolId,
      schoolName: row.school?.nameAr ?? null,
      coursesCount: row._count.courses,
      updatedAt: row.updatedAt,
    })),
  };
}

export async function createProgram(
  raw: unknown,
  actor?: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = createProgramSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const scope = resolveScope(ctx, input.scope, input.schoolId);
  if (!scope.ok) return scope;

  const nameNorm = normalizeContentName(input.nameAr);
  const duplicate = await db.trainingProgram.findFirst({
    where: { nameNorm, schoolId: scope.schoolId },
    select: { id: true },
  });
  if (duplicate) {
    return fail(
      "يوجد برنامج بنفس الاسم في هذا النطاق بالفعل",
      "DUPLICATE",
      { nameAr: "اسم البرنامج مستخدم بالفعل" }
    );
  }

  const program = await db.trainingProgram.create({
    data: {
      schoolId: scope.schoolId,
      nameAr: input.nameAr,
      nameEn: input.nameEn ?? null,
      nameNorm,
      descriptionAr: input.descriptionAr,
      descriptionEn: input.descriptionEn ?? null,
      category: input.category,
      status: "DRAFT",
      createdById: ctx.id,
    },
    select: { id: true },
  });
  return { ok: true, data: program };
}

export async function updateProgram(
  raw: unknown,
  actor?: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = updateProgramSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const program = await db.trainingProgram.findUnique({
    where: { id: input.programId },
  });
  if (!program) return fail("البرنامج غير موجود", "NOT_FOUND");
  const scopeCheck = trainingScopeError(ctx, program.schoolId);
  if (scopeCheck) return scopeCheck;

  // Scope never changes after creation (moving content across tenants
  // is intentionally unsupported).
  const nameNorm = normalizeContentName(input.nameAr);
  const duplicate = await db.trainingProgram.findFirst({
    where: { nameNorm, schoolId: program.schoolId, id: { not: program.id } },
    select: { id: true },
  });
  if (duplicate) {
    return fail(
      "يوجد برنامج بنفس الاسم في هذا النطاق بالفعل",
      "DUPLICATE",
      { nameAr: "اسم البرنامج مستخدم بالفعل" }
    );
  }

  const updated = await db.trainingProgram.update({
    where: { id: program.id },
    data: {
      nameAr: input.nameAr,
      nameEn: input.nameEn ?? null,
      nameNorm,
      descriptionAr: input.descriptionAr,
      descriptionEn: input.descriptionEn ?? null,
      category: input.category,
    },
    select: { id: true },
  });
  return { ok: true, data: updated };
}

export async function setProgramStatus(
  raw: unknown,
  actor?: AdminContext
): Promise<TrainingResult<{ id: string; status: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = setProgramStatusSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const program = await db.trainingProgram.findUnique({
    where: { id: input.programId },
  });
  if (!program) return fail("البرنامج غير موجود", "NOT_FOUND");
  const scopeCheck = trainingScopeError(ctx, program.schoolId);
  if (scopeCheck) return scopeCheck;

  const updated = await db.trainingProgram.update({
    where: { id: program.id },
    data: { status: input.status },
    select: { id: true, status: true },
  });
  return { ok: true, data: updated };
}

/* ------------------------------------------------------------------ */
/* Courses — manage side                                                */
/* ------------------------------------------------------------------ */

export interface CourseManageFilters {
  q?: string;
  status?: string;
  category?: string;
  programId?: string;
  page?: number;
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listCoursesForManage(
  ctx: AdminContext,
  filters: CourseManageFilters
): Promise<TrainingResult<Paginated<CourseCatalogRow>>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const where: Prisma.CourseWhereInput =
    ctx.role === "SUPER_ADMIN" ? {} : { schoolId: ctx.schoolId };

  if (filters.q && filters.q.trim().length > 0) {
    where.titleAr = { contains: filters.q.trim() };
  }
  if (
    filters.status &&
    (CONTENT_STATUSES as readonly string[]).includes(filters.status)
  ) {
    where.status = filters.status;
  }
  if (filters.category && filters.category.trim().length > 0) {
    where.category = filters.category.trim();
  }
  if (filters.programId && filters.programId.trim().length > 0) {
    where.programId = filters.programId.trim();
  }

  const total = await db.course.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / COURSES_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  const rows = await db.course.findMany({
    where,
    include: {
      program: { select: { nameAr: true } },
      school: { select: { nameAr: true } },
      _count: { select: { sections: true } },
    },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * COURSES_PAGE_SIZE,
    take: COURSES_PAGE_SIZE,
  });

  const lessonCounts = await lessonsCountByCourse(
    rows.map((row) => row.id),
    false
  );

  return {
    ok: true,
    data: {
      rows: rows.map((row) => ({
        id: row.id,
        titleAr: row.titleAr,
        category: row.category,
        level: row.level,
        estimatedHours: row.estimatedHours,
        status: row.status,
        updatedAt: row.updatedAt,
        coverAttachmentId: row.coverAttachmentId,
        programId: row.programId,
        programName: row.program?.nameAr ?? null,
        schoolName: row.school?.nameAr ?? null,
        sectionsCount: row._count.sections,
        lessonsCount: lessonCounts[row.id] ?? 0,
      })),
      total,
      page,
      pageCount,
    },
  };
}

/** Batch-compute lesson counts per course id (optionally published only). */
async function lessonsCountByCourse(
  courseIds: string[],
  publishedOnly: boolean
): Promise<Record<string, number>> {
  if (courseIds.length === 0) return {};
  const sections = await db.courseSection.findMany({
    where: { courseId: { in: courseIds } },
    select: { id: true, courseId: true },
  });
  const sectionToCourse = new Map(sections.map((s) => [s.id, s.courseId]));
  const lessons = await db.courseLesson.findMany({
    where: {
      sectionId: { in: sections.map((s) => s.id) },
      ...(publishedOnly ? { isPublished: true } : {}),
    },
    select: { sectionId: true },
  });
  const counts: Record<string, number> = {};
  for (const lesson of lessons) {
    const courseId = sectionToCourse.get(lesson.sectionId);
    if (courseId) counts[courseId] = (counts[courseId] ?? 0) + 1;
  }
  return counts;
}

export interface CourseManageDetail {
  id: string;
  titleAr: string;
  titleEn: string | null;
  descriptionAr: string;
  descriptionEn: string | null;
  category: string;
  level: string | null;
  estimatedHours: number | null;
  status: string;
  publishedAt: Date | null;
  programId: string | null;
  schoolId: string | null;
  instructorId: string | null;
  coverAttachmentId: string | null;
  sections: {
    id: string;
    titleAr: string;
    description: string | null;
    orderIndex: number;
    lessons: {
      id: string;
      titleAr: string;
      description: string | null;
      type: string;
      content: string | null;
      videoUrl: string | null;
      attachmentId: string | null;
      attachmentName: string | null;
      isPublished: boolean;
      orderIndex: number;
    }[];
  }[];
}

export async function getCourseForManage(
  ctx: AdminContext,
  courseId: string
): Promise<TrainingResult<CourseManageDetail>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const course = await db.course.findUnique({
    where: { id: courseId },
    include: {
      sections: {
        orderBy: { orderIndex: "asc" },
        include: {
          lessons: {
            orderBy: { orderIndex: "asc" },
            include: { attachment: { select: { originalName: true } } },
          },
        },
      },
    },
  });
  if (!course) return fail("الدورة غير موجودة", "NOT_FOUND");
  const scopeCheck = trainingScopeError(ctx, course.schoolId);
  if (scopeCheck) return scopeCheck;

  return {
    ok: true,
    data: {
      id: course.id,
      titleAr: course.titleAr,
      titleEn: course.titleEn,
      descriptionAr: course.descriptionAr,
      descriptionEn: course.descriptionEn,
      category: course.category,
      level: course.level,
      estimatedHours: course.estimatedHours,
      status: course.status,
      publishedAt: course.publishedAt,
      programId: course.programId,
      schoolId: course.schoolId,
      instructorId: course.instructorId,
      coverAttachmentId: course.coverAttachmentId,
      sections: course.sections.map((section) => ({
        id: section.id,
        titleAr: section.titleAr,
        description: section.description,
        orderIndex: section.orderIndex,
        lessons: section.lessons.map((lesson) => ({
          id: lesson.id,
          titleAr: lesson.titleAr,
          description: lesson.description,
          type: lesson.type,
          content: lesson.content,
          videoUrl: lesson.videoUrl,
          attachmentId: lesson.attachmentId,
          attachmentName: lesson.attachment?.originalName ?? null,
          isPublished: lesson.isPublished,
          orderIndex: lesson.orderIndex,
        })),
      })),
    },
  };
}

/* --------------------------- create/update ------------------------- */

export async function createCourse(
  raw: unknown,
  actor?: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = createCourseSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const scope = resolveScope(ctx, input.scope, input.schoolId);
  if (!scope.ok) return scope;

  const relationError = await validateCourseRelations(
    scope.schoolId,
    input.programId,
    input.instructorId
  );
  if (relationError) return relationError;

  const course = await db.course.create({
    data: {
      schoolId: scope.schoolId,
      programId: input.programId ?? null,
      titleAr: input.titleAr,
      titleEn: input.titleEn ?? null,
      descriptionAr: input.descriptionAr,
      descriptionEn: input.descriptionEn ?? null,
      category: input.category,
      level: input.level ?? null,
      estimatedHours: input.estimatedHours ?? null,
      instructorId: input.instructorId ?? null,
      status: "DRAFT",
      createdById: ctx.id,
    },
    select: { id: true },
  });
  return { ok: true, data: course };
}

export async function updateCourse(
  raw: unknown,
  actor?: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = updateCourseSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const course = await db.course.findUnique({ where: { id: input.courseId } });
  if (!course) return fail("الدورة غير موجودة", "NOT_FOUND");
  const scopeCheck = trainingScopeError(ctx, course.schoolId);
  if (scopeCheck) return scopeCheck;

  const relationError = await validateCourseRelations(
    course.schoolId,
    input.programId,
    input.instructorId
  );
  if (relationError) return relationError;

  const updated = await db.course.update({
    where: { id: course.id },
    data: {
      programId: input.programId ?? null,
      titleAr: input.titleAr,
      titleEn: input.titleEn ?? null,
      descriptionAr: input.descriptionAr,
      descriptionEn: input.descriptionEn ?? null,
      category: input.category,
      level: input.level ?? null,
      estimatedHours: input.estimatedHours ?? null,
      instructorId: input.instructorId ?? null,
    },
    select: { id: true },
  });
  return { ok: true, data: updated };
}

/** Program + instructor relation validation shared by create/update. */
async function validateCourseRelations(
  schoolId: string | null,
  programId: string | undefined,
  instructorId: string | undefined
): Promise<TrainingResult<never> | null> {
  if (programId) {
    const program = await db.trainingProgram.findUnique({
      where: { id: programId },
      select: { schoolId: true },
    });
    if (!program) {
      return fail("البرنامج المحدد غير موجود", "NOT_FOUND");
    }
    if (program.schoolId !== null && program.schoolId !== schoolId) {
      return fail(
        "البرنامج المحدد لا ينتمي إلى نطاق هذه الدورة",
        "RELATION_ERROR"
      );
    }
  }
  if (instructorId) {
    const instructor = await db.user.findUnique({
      where: { id: instructorId },
      select: { schoolId: true, isActive: true },
    });
    if (!instructor || !instructor.isActive) {
      return fail("المدرّب المحدد غير موجود أو غير نشط", "NOT_FOUND");
    }
    if ((instructor.schoolId ?? null) !== schoolId) {
      return fail(
        "المدرّب المحدد لا ينتمي إلى نطاق هذه الدورة",
        "RELATION_ERROR"
      );
    }
  }
  return null;
}

/* --------------------------- publish workflow ---------------------- */

export async function setCourseStatus(
  raw: unknown,
  actor?: AdminContext
): Promise<TrainingResult<{ id: string; status: string; publishedAt: Date | null }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = setCourseStatusSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const course = await db.course.findUnique({ where: { id: input.courseId } });
  if (!course) return fail("الدورة غير موجودة", "NOT_FOUND");
  const scopeCheck = trainingScopeError(ctx, course.schoolId);
  if (scopeCheck) return scopeCheck;

  if (input.status === "PUBLISHED") {
    const [sectionCount, lessonCount] = await Promise.all([
      db.courseSection.count({ where: { courseId: course.id } }),
      db.courseLesson.count({ where: { section: { courseId: course.id } } }),
    ]);
    if (sectionCount < 1 || lessonCount < 1) {
      return fail(
        "لا يمكن نشر الدورة — أضف قسمًا واحدًا على الأقل ودرسًا واحدًا على الأقل قبل النشر",
        "PUBLISH_BLOCKED"
      );
    }
  }

  const updated = await db.course.update({
    where: { id: course.id },
    data: {
      status: input.status,
      ...(input.status === "PUBLISHED"
        ? { publishedAt: course.publishedAt ?? new Date() }
        : {}),
    },
    select: { id: true, status: true, publishedAt: true },
  });
  return { ok: true, data: updated };
}

/* ------------------------------------------------------------------ */
/* Courses — teacher/staff learning side                                */
/* ------------------------------------------------------------------ */

export interface PublishedCourseFilters {
  q?: string;
  category?: string;
  programId?: string;
  mine?: boolean;
  page?: number;
}

export async function listPublishedCourses(
  viewer: ViewerIdentity,
  filters: PublishedCourseFilters
): Promise<TrainingResult<Paginated<CourseCatalogRow>>> {
  const visibility = publishedVisibilityWhere(viewer);
  const where: Prisma.CourseWhereInput = { ...visibility };

  if (filters.q && filters.q.trim().length > 0) {
    where.titleAr = { contains: filters.q.trim() };
  }
  if (filters.category && filters.category.trim().length > 0) {
    where.category = filters.category.trim();
  }
  if (filters.programId && filters.programId.trim().length > 0) {
    where.programId = filters.programId.trim();
  }
  if (filters.mine) {
    where.enrollments = { some: { userId: viewer.id } };
  }

  const total = await db.course.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / COURSES_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  const rows = await db.course.findMany({
    where,
    include: {
      program: { select: { nameAr: true } },
      school: { select: { nameAr: true } },
      _count: { select: { sections: true } },
      enrollments: {
        where: { userId: viewer.id },
        select: { id: true },
      },
    },
    orderBy: { publishedAt: "desc" },
    skip: (page - 1) * COURSES_PAGE_SIZE,
    take: COURSES_PAGE_SIZE,
  });

  const lessonCounts = await lessonsCountByCourse(
    rows.map((row) => row.id),
    true
  );

  return {
    ok: true,
    data: {
      rows: rows.map((row) => ({
        id: row.id,
        titleAr: row.titleAr,
        category: row.category,
        level: row.level,
        estimatedHours: row.estimatedHours,
        status: row.status,
        updatedAt: row.updatedAt,
        coverAttachmentId: row.coverAttachmentId,
        programId: row.programId,
        programName: row.program?.nameAr ?? null,
        schoolName: row.school?.nameAr ?? null,
        sectionsCount: row._count.sections,
        lessonsCount: lessonCounts[row.id] ?? 0,
        enrolled: row.enrollments.length > 0,
      })),
      total,
      page,
      pageCount,
    },
  };
}

/** Full learning view for one published course (access-checked). */
export async function getCourseForViewer(
  viewer: ViewerIdentity,
  courseId: string
): Promise<TrainingResult<CourseLearningView>> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: {
      program: { select: { nameAr: true } },
      school: { select: { nameAr: true } },
      instructor: { select: { name: true } },
      sections: {
        orderBy: { orderIndex: "asc" },
        include: {
          lessons: {
            where: { isPublished: true },
            orderBy: { orderIndex: "asc" },
            include: { attachment: { select: { originalName: true } } },
          },
        },
      },
      enrollments: {
        where: { userId: viewer.id },
        select: { id: true, enrolledAt: true },
      },
    },
  });
  if (!course) return fail("الدورة غير موجودة", "NOT_FOUND");

  // Visibility: published + own school or platform-wide for everyone;
  // managers additionally preview their own school's (or any, for the
  // platform admin) non-published courses through the learning view.
  const managerPreview =
    canManageTraining(viewer.role) &&
    (viewer.role === "SUPER_ADMIN" || course.schoolId === viewer.schoolId);
  const allowed =
    managerPreview ||
    (course.status === "PUBLISHED" &&
      (course.schoolId === null || course.schoolId === viewer.schoolId));
  if (!allowed) {
    return fail("هذه الدورة غير متاحة لك", "FORBIDDEN");
  }

  const sections: ViewerSection[] = course.sections.map((section) => ({
    id: section.id,
    titleAr: section.titleAr,
    description: section.description,
    orderIndex: section.orderIndex,
    lessons: section.lessons.map((lesson) => ({
      id: lesson.id,
      titleAr: lesson.titleAr,
      type: lesson.type,
      description: lesson.description,
      content: lesson.content,
      videoUrl: lesson.videoUrl,
      attachmentId: lesson.attachmentId,
      attachmentName: lesson.attachment?.originalName ?? null,
      orderIndex: lesson.orderIndex,
    })),
  }));

  const publishedLessonsCount = sections.reduce(
    (sum, section) => sum + section.lessons.length,
    0
  );

  return {
    ok: true,
    data: {
      course: {
        id: course.id,
        titleAr: course.titleAr,
        titleEn: course.titleEn,
        descriptionAr: course.descriptionAr,
        descriptionEn: course.descriptionEn,
        category: course.category,
        level: course.level,
        estimatedHours: course.estimatedHours,
        status: course.status,
        coverAttachmentId: course.coverAttachmentId,
        programName: course.program?.nameAr ?? null,
        instructorName: course.instructor?.name ?? null,
        schoolName: course.school?.nameAr ?? null,
      },
      sections,
      publishedLessonsCount,
      enrollment: course.enrollments[0]
        ? {
            id: course.enrollments[0].id,
            enrolledAt: course.enrollments[0].enrolledAt,
          }
        : null,
    },
  };
}

/** One published lesson + navigation outline (access-checked). */
export async function getLessonForViewer(
  viewer: ViewerIdentity,
  courseId: string,
  lessonId: string
): Promise<TrainingResult<LessonLearningView>> {
  const view = await getCourseForViewer(viewer, courseId);
  if (!view.ok) return view;

  const outline = view.data.sections;
  const flat = outline.flatMap((section) =>
    section.lessons.map((lesson) => ({ sectionTitle: section.titleAr, lesson }))
  );
  const index = flat.findIndex((entry) => entry.lesson.id === lessonId);
  if (index === -1) {
    return fail("الدرس غير متاح — قد يكون مسودة أو غير موجود", "NOT_FOUND");
  }

  const entry = flat[index];
  return {
    ok: true,
    data: {
      course: view.data.course,
      sectionTitle: entry.sectionTitle,
      lesson: entry.lesson,
      outline,
      prevLessonId: index > 0 ? flat[index - 1].lesson.id : null,
      nextLessonId:
        index < flat.length - 1 ? flat[index + 1].lesson.id : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Enrollment                                                           */
/* ------------------------------------------------------------------ */

export interface EnrollmentOutcome {
  alreadyEnrolled: boolean;
  enrollmentId: string;
}

export async function enrollTeacher(
  viewer: ViewerIdentity,
  raw: unknown
): Promise<TrainingResult<EnrollmentOutcome>> {
  const parsed = enrollSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);

  if (viewer.role !== "TEACHER") {
    return fail("التسجيل في الدورات متاح للمعلمين فقط", "FORBIDDEN");
  }

  const course = await db.course.findUnique({
    where: { id: parsed.data.courseId },
    select: { id: true, status: true, schoolId: true },
  });
  if (!course) return fail("الدورة غير موجودة", "NOT_FOUND");

  const visible =
    course.status === "PUBLISHED" &&
    (course.schoolId === null || course.schoolId === viewer.schoolId);
  if (!visible) {
    return fail("هذه الدورة غير متاحة لتسجيلك", "FORBIDDEN");
  }

  const existing = await db.courseEnrollment.findUnique({
    where: { courseId_userId: { courseId: course.id, userId: viewer.id } },
    select: { id: true },
  });
  if (existing) {
    return { ok: true, data: { alreadyEnrolled: true, enrollmentId: existing.id } };
  }

  try {
    const enrollment = await db.courseEnrollment.create({
      data: { courseId: course.id, userId: viewer.id, status: "ACTIVE" },
      select: { id: true },
    });
    return { ok: true, data: { alreadyEnrolled: false, enrollmentId: enrollment.id } };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        ok: true,
        data: { alreadyEnrolled: true, enrollmentId: "existing" },
      };
    }
    return fail("تعذر إتمام التسجيل — حدث خطأ غير متوقع");
  }
}

/* ------------------------------------------------------------------ */
/* Dashboard metrics                                                    */
/* ------------------------------------------------------------------ */

export interface AcademyMetrics {
  coursesTotal: number;
  coursesPublished: number;
  programsTotal: number;
  enrollmentsCount: number;
}

/** Real persisted academy metrics scoped by school (null = platform). */
export async function getAcademyMetrics(
  schoolId: string | null
): Promise<AcademyMetrics> {
  const courseWhere: Prisma.CourseWhereInput = schoolId ? { schoolId } : {};
  const programWhere: Prisma.TrainingProgramWhereInput = schoolId
    ? { schoolId }
    : {};
  const enrollmentWhere: Prisma.CourseEnrollmentWhereInput = schoolId
    ? { user: { schoolId } }
    : {};

  const [coursesTotal, coursesPublished, programsTotal, enrollmentsCount] =
    await Promise.all([
      db.course.count({ where: courseWhere }),
      db.course.count({
        where: { ...courseWhere, status: "PUBLISHED" },
      }),
      db.trainingProgram.count({ where: programWhere }),
      db.courseEnrollment.count({ where: enrollmentWhere }),
    ]);

  return { coursesTotal, coursesPublished, programsTotal, enrollmentsCount };
}

/* ------------------------------------------------------------------ */
/* Form option helpers                                                  */
/* ------------------------------------------------------------------ */

export async function getInstructorOptions(
  ctx: AdminContext,
  schoolId: string | null
): Promise<{ id: string; name: string }[]> {
  if (!schoolId) return []; // platform-wide courses: instructors come later
  const rows = await db.user.findMany({
    where: {
      schoolId,
      role: { in: ["TEACHER", "EDUCATIONAL_SUPERVISOR"] },
      isActive: true,
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows;
}

/* ------------------------------------------------------------------ */
/* Internal                                                             */
/* ------------------------------------------------------------------ */

async function requireAdmin(): Promise<AdminContext> {
  // Services are called from server actions that already resolved the
  // context; this fallback exists for tests and keeps the signature
  // symmetric with the schools service.
  const { requireAdminContext } = await import("@/lib/auth/dev-admin");
  return requireAdminContext();
}
/* ------------------------------------------------------------------ */
/* Supervisor training service — the EDUCATIONAL_SUPERVISOR's complete  */
/* training-management layer.                                           */
/*                                                                      */
/* Design rules:                                                        */
/*   1. REUSE, never duplicate: course CRUD, detail, publish workflow,  */
/*      program options, assessment CRUD and question CRUD all delegate */
/*      to the existing services after widening their access fences to  */
/*      admit this role (see training/access.ts, assessment/access.ts). */
/*   2. TENANT FENCE: the supervisor's schoolId comes from the session  */
/*      (requireSupervisorContext) and is re-verified against every     */
/*      record before any read or write. Platform-wide records stay     */
/*      SUPER_ADMIN-only — the supervisor can never touch them.         */
/*   3. ADDITIVE ONLY: sections/lessons CRUD, enrollments, dashboard    */
/*      aggregation and impact-survey authoring live HERE because the   */
/*      legacy service has no such functions — nothing existing is      */
/*      modified or duplicated.                                         */
/* ------------------------------------------------------------------ */

import { z } from "zod";

import {
  requireSupervisorContext,
  type AdminContext,
  type SupervisorTrainingContext,
} from "@/lib/auth/dev-admin";
import { db } from "@/lib/db";
import { supervisorScopedTeacherRecords } from "@/lib/growth/service";
import {
  addQuestion,
  createAssessment,
  deleteQuestion,
  listAssessmentsForManage,
  moveQuestion,
  setAssessmentStatus,
  updateAssessment,
  updateQuestion,
} from "@/lib/assessment/service";
import {
  createCourse,
  getCourseForManage,
  listCoursesForManage,
  listProgramOptionsForManage,
  setCourseStatus,
  updateCourse,
} from "@/lib/training/service";

/* ------------------------------------------------------------------ */
/* Context helpers                                                      */
/* ------------------------------------------------------------------ */

export { requireSupervisorContext };
export type { SupervisorTrainingContext };

/**
 * Runtime-safe bridge into the legacy manage services.
 *
 * WHY THIS IS SAFE (deliberate, reviewed):
 *   • `managerGuard` inside those services now admits
 *     EDUCATIONAL_SUPERVISOR (access-layer widening).
 *   • Every WRITE path re-checks tenancy via
 *     `trainingScopeError` / `assessmentScopeError`, which only accept
 *     a supervisor when record.schoolId === ctx.schoolId.
 *   • CREATE paths receive scope:"school" + schoolId hard-bound to
 *     ctx.schoolId HERE — the client can never choose the tenant.
 *   • Platform-wide records (schoolId null) are rejected for this
 *     role in every fence above.
 */
function asManageContext(ctx: SupervisorTrainingContext): AdminContext {
  return ctx as unknown as AdminContext;
}

/** Shared failure shape mirrors the existing ServiceResult pattern. */
export type SupervisorResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code?: string; fieldErrors?: Record<string, string> };

function fail<T>(message: string, code?: string): SupervisorResult<T> {
  return { ok: false, message, code };
}

function zodFail<T>(error: { issues: unknown[] }): SupervisorResult<T> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of (error.issues ?? []) as Array<{
    path: (string | number | symbol)[];
    message: string;
  }>) {
    const key = issue.path.map(String).join(".") || "form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return {
    ok: false,
    message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
    code: "VALIDATION_ERROR",
    fieldErrors,
  };
}

/** The supervisor's authorized teachers — explicit ∪ branch coverage. */
export async function listSupervisorTeachers(
  ctx: SupervisorTrainingContext
): Promise<
  Array<{
    id: string;
    name: string;
    email: string | null;
    growthLevel: string;
    branchId: string | null;
  }>
> {
  const records = await supervisorScopedTeacherRecords(ctx.id);
  if (!records.ok) return [];
  return records.data.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email ?? null,
    growthLevel: row.growthLevel,
    branchId: row.branchId ?? null,
  }));
}

/** Fail-closed: does this course belong to the supervisor's school? */
async function courseInScope(
  ctx: SupervisorTrainingContext,
  courseId: string
): Promise<{
  id: string;
  schoolId: string | null;
  status: string;
  publishedAt: Date | null;
  coverAttachmentId: string | null;
} | null> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      schoolId: true,
      status: true,
      publishedAt: true,
      coverAttachmentId: true,
    },
  });
  if (!course || course.schoolId === null || course.schoolId !== ctx.schoolId) {
    return null;
  }
  return course;
}

/* ------------------------------------------------------------------ */
/* Courses — thin delegated wrappers                                    */
/* ------------------------------------------------------------------ */

export interface SupervisorCourseFilters {
  q?: string;
  status?: string;
  category?: string;
  programId?: string;
  page?: number;
}

export async function listSupervisorCourses(
  ctx: SupervisorTrainingContext,
  filters: SupervisorCourseFilters
) {
  return listCoursesForManage(asManageContext(ctx), filters);
}

export async function getSupervisorCourse(ctx: SupervisorTrainingContext, courseId: string) {
  return getCourseForManage(asManageContext(ctx), courseId);
}

export async function listSupervisorProgramOptions(ctx: SupervisorTrainingContext) {
  return listProgramOptionsForManage(asManageContext(ctx));
}

/** Category keys proven valid in this tenant (distinct from DB rows). */
export async function listSupervisorCategoryOptions(
  ctx: SupervisorTrainingContext
): Promise<string[]> {
  const rows = await db.course.findMany({
    where: { schoolId: ctx.schoolId },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.map((row) => row.category);
}

const supervisorCourseSchema = z.object({
  titleAr: z.string().trim().min(3).max(150),
  titleEn: z.string().trim().max(150).optional(),
  descriptionAr: z.string().trim().min(5).max(4000),
  descriptionEn: z.string().trim().max(4000).optional(),
  category: z.string().trim().min(2).max(60),
  level: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).optional(),
  estimatedHours: z.coerce.number().int().min(1).max(200).optional(),
  programId: z.string().trim().max(64).optional(),
});

export async function createSupervisorCourse(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const parsed = supervisorCourseSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const input = parsed.data;

  // Tenant hard-bound — never taken from the client.
  const result = await createCourse(
    { ...input, scope: "school", schoolId: ctx.schoolId },
    asManageContext(ctx)
  );
  return result.ok
    ? result
    : { ok: false, message: result.message, code: result.code, fieldErrors: result.fieldErrors };
}

export async function updateSupervisorCourse(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const parsed = supervisorCourseSchema
    .extend({ courseId: z.string().trim().min(1) })
    .safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const { courseId, ...input } = parsed.data;

  const course = await courseInScope(ctx, courseId);
  if (!course) return fail("الدورة غير موجودة أو خارج نطاق مدرستك", "FORBIDDEN");

  const result = await updateCourse({ ...input, courseId }, asManageContext(ctx));
  return result.ok
    ? result
    : { ok: false, message: result.message, code: result.code, fieldErrors: result.fieldErrors };
}

const courseStatusSchema = z.object({
  courseId: z.string().trim().min(1),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
});

export async function setSupervisorCourseStatus(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string; status: string; publishedAt: Date | null }>> {
  const parsed = courseStatusSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);

  const course = await courseInScope(ctx, parsed.data.courseId);
  if (!course) return fail("الدورة غير موجودة أو خارج نطاق مدرستك", "FORBIDDEN");

  const result = await setCourseStatus(parsed.data, asManageContext(ctx));
  return result.ok ? result : { ok: false, message: result.message, code: result.code };
}

/* ------------------------------------------------------------------ */
/* Sections — additive CRUD (legacy service has none)                   */
/* ------------------------------------------------------------------ */

const sectionSchema = z.object({
  courseId: z.string().trim().min(1),
  sectionId: z.string().trim().min(1).optional(),
  titleAr: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});

export async function saveSupervisorSection(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const parsed = sectionSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const { courseId, sectionId, titleAr, description } = parsed.data;

  const course = await courseInScope(ctx, courseId);
  if (!course) return fail("الدورة غير موجودة أو خارج نطاق مدرستك", "FORBIDDEN");

  if (sectionId) {
    const section = await db.courseSection.findUnique({
      where: { id: sectionId },
      select: { id: true, courseId: true },
    });
    if (!section || section.courseId !== courseId) {
      return fail("القسم غير موجود داخل هذه الدورة", "NOT_FOUND");
    }
    const updated = await db.courseSection.update({
      where: { id: sectionId },
      data: { titleAr, description: description ?? null },
      select: { id: true },
    });
    return { ok: true, data: updated };
  }

  const count = await db.courseSection.count({ where: { courseId } });
  const created = await db.courseSection.create({
    data: {
      courseId,
      titleAr,
      description: description ?? null,
      orderIndex: count,
    },
    select: { id: true },
  });
  return { ok: true, data: created };
}

export async function deleteSupervisorSection(
  ctx: SupervisorTrainingContext,
  sectionId: string
): Promise<SupervisorResult<{ id: string }>> {
  const section = await db.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, courseId: true },
  });
  if (!section) return fail("القسم غير موجود", "NOT_FOUND");
  const course = await courseInScope(ctx, section.courseId);
  if (!course) return fail("خارج نطاق مدرستك — العملية مرفوضة", "FORBIDDEN");

  await db.courseSection.delete({ where: { id: sectionId } });
  return { ok: true, data: { id: sectionId } };
}

export async function moveSupervisorSection(
  ctx: SupervisorTrainingContext,
  sectionId: string,
  direction: "up" | "down"
): Promise<SupervisorResult<{ id: string }>> {
  const section = await db.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, courseId: true, orderIndex: true },
  });
  if (!section) return fail("القسم غير موجود", "NOT_FOUND");
  const course = await courseInScope(ctx, section.courseId);
  if (!course) return fail("خارج نطاق مدرستك — العملية مرفوضة", "FORBIDDEN");

  const siblings = await db.courseSection.findMany({
    where: { courseId: section.courseId },
    orderBy: { orderIndex: "asc" },
    select: { id: true, orderIndex: true },
  });
  const index = siblings.findIndex((row) => row.id === sectionId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= siblings.length) {
    return fail("القسم في أقصى الترتيب بالفعل", "VALIDATION_ERROR");
  }

  const neighbor = siblings[swapWith];
  await db.$transaction([
    db.courseSection.update({
      where: { id: section.id },
      data: { orderIndex: neighbor.orderIndex },
    }),
    db.courseSection.update({
      where: { id: neighbor.id },
      data: { orderIndex: section.orderIndex },
    }),
  ]);
  return { ok: true, data: { id: sectionId } };
}

/* ------------------------------------------------------------------ */
/* Lessons — additive CRUD with the dual-mode video URL                 */
/* ------------------------------------------------------------------ */

/** Accepts https(s) external links AND this app's /api/media/… proxy paths. */
function isValidMediaUrl(url: string): boolean {
  return /^https?:\/\/.+/i.test(url) || url.startsWith("/api/media/");
}

const lessonSchema = z
  .object({
    sectionId: z.string().trim().min(1),
    lessonId: z.string().trim().min(1).optional(),
    titleAr: z.string().trim().min(2).max(150),
    description: z.string().trim().max(500).optional(),
    type: z.enum(["TEXT", "VIDEO", "EXTERNAL_VIDEO"]),
    content: z.string().trim().max(20000).optional(),
    videoUrl: z.string().trim().max(1000).optional(),
    isPublished: z.boolean().optional(),
    /** Media length in seconds — captured from the instructor's browser
     * and used by the mandatory-playback completion threshold. */
    durationSeconds: z.coerce.number().int().min(1).max(43200).optional(),
  })
  .superRefine((value, refineCtx) => {
    if (value.type === "TEXT" && (!value.content || value.content.trim().length === 0)) {
      refineCtx.addIssue({
        code: "custom",
        path: ["content"],
        message: "محتوى الدرس النصي مطلوب",
      });
    }
    if (value.type === "VIDEO" && (!value.videoUrl || !isValidMediaUrl(value.videoUrl))) {
      refineCtx.addIssue({
        code: "custom",
        path: ["videoUrl"],
        message: "ارفع ملف فيديو أو أدخل رابطًا خارجيًا صحيحًا",
      });
    }
    if (
      value.type === "EXTERNAL_VIDEO" &&
      (!value.videoUrl || !/^https?:\/\/.+/i.test(value.videoUrl))
    ) {
      refineCtx.addIssue({
        code: "custom",
        path: ["videoUrl"],
        message: "أدخل رابط فيديو خارجيًا يبدأ بـ https://",
      });
    }
  });

export async function saveSupervisorLesson(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const parsed = lessonSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const { sectionId, lessonId, titleAr, description, type, content, videoUrl, isPublished, durationSeconds } =
    parsed.data;

  const section = await db.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, courseId: true },
  });
  if (!section) return fail("القسم غير موجود", "NOT_FOUND");
  const course = await courseInScope(ctx, section.courseId);
  if (!course) return fail("خارج نطاق مدرستك — العملية مرفوضة", "FORBIDDEN");

  if (lessonId) {
    const lesson = await db.courseLesson.findUnique({
      where: { id: lessonId },
      select: { id: true, sectionId: true },
    });
    if (!lesson || lesson.sectionId !== sectionId) {
      return fail("الدرس غير موجود داخل هذا القسم", "NOT_FOUND");
    }
    const updated = await db.courseLesson.update({
      where: { id: lessonId },
      data: {
        titleAr,
        description: description ?? null,
        type,
        content: type === "TEXT" ? (content ?? null) : null,
        videoUrl: type === "TEXT" ? null : (videoUrl ?? null),
        durationSeconds: type === "TEXT" ? null : (durationSeconds ?? null),
        ...(typeof isPublished === "boolean" ? { isPublished } : {}),
      },
      select: { id: true },
    });
    return { ok: true, data: updated };
  }

  const count = await db.courseLesson.count({ where: { sectionId } });
  const created = await db.courseLesson.create({
    data: {
      sectionId,
      titleAr,
      description: description ?? null,
      type,
      content: type === "TEXT" ? (content ?? null) : null,
      videoUrl: type === "TEXT" ? null : (videoUrl ?? null),
      durationSeconds: type === "TEXT" ? null : (durationSeconds ?? null),
      isPublished: isPublished ?? false,
      orderIndex: count,
    },
    select: { id: true },
  });
  return { ok: true, data: created };
}

export async function deleteSupervisorLesson(
  ctx: SupervisorTrainingContext,
  lessonId: string
): Promise<SupervisorResult<{ id: string }>> {
  const lesson = await db.courseLesson.findUnique({
    where: { id: lessonId },
    select: { id: true, sectionId: true },
  });
  if (!lesson) return fail("الدرس غير موجود", "NOT_FOUND");
  const section = await db.courseSection.findUnique({
    where: { id: lesson.sectionId },
    select: { courseId: true },
  });
  if (!section) return fail("القسم غير موجود", "NOT_FOUND");
  const course = await courseInScope(ctx, section.courseId);
  if (!course) return fail("خارج نطاق مدرستك — العملية مرفوضة", "FORBIDDEN");

  await db.courseLesson.delete({ where: { id: lessonId } });
  return { ok: true, data: { id: lessonId } };
}

export async function moveSupervisorLesson(
  ctx: SupervisorTrainingContext,
  lessonId: string,
  direction: "up" | "down"
): Promise<SupervisorResult<{ id: string }>> {
  const lesson = await db.courseLesson.findUnique({
    where: { id: lessonId },
    select: { id: true, sectionId: true, orderIndex: true },
  });
  if (!lesson) return fail("الدرس غير موجود", "NOT_FOUND");
  const section = await db.courseSection.findUnique({
    where: { id: lesson.sectionId },
    select: { courseId: true },
  });
  if (!section) return fail("القسم غير موجود", "NOT_FOUND");
  const course = await courseInScope(ctx, section.courseId);
  if (!course) return fail("خارج نطاق مدرستك — العملية مرفوضة", "FORBIDDEN");

  const siblings = await db.courseLesson.findMany({
    where: { sectionId: lesson.sectionId },
    orderBy: { orderIndex: "asc" },
    select: { id: true, orderIndex: true },
  });
  const index = siblings.findIndex((row) => row.id === lessonId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= siblings.length) {
    return fail("الدرس في أقصى الترتيب بالفعل", "VALIDATION_ERROR");
  }
  const neighbor = siblings[swapWith];
  await db.$transaction([
    db.courseLesson.update({
      where: { id: lesson.id },
      data: { orderIndex: neighbor.orderIndex },
    }),
    db.courseLesson.update({
      where: { id: neighbor.id },
      data: { orderIndex: lesson.orderIndex },
    }),
  ]);
  return { ok: true, data: { id: lessonId } };
}

export async function setSupervisorLessonPublished(
  ctx: SupervisorTrainingContext,
  lessonId: string,
  isPublished: boolean
): Promise<SupervisorResult<{ id: string }>> {
  const lesson = await db.courseLesson.findUnique({
    where: { id: lessonId },
    select: { id: true, sectionId: true },
  });
  if (!lesson) return fail("الدرس غير موجود", "NOT_FOUND");
  const section = await db.courseSection.findUnique({
    where: { id: lesson.sectionId },
    select: { courseId: true },
  });
  if (!section) return fail("القسم غير موجود", "NOT_FOUND");
  const course = await courseInScope(ctx, section.courseId);
  if (!course) return fail("خارج نطاق مدرستك — العملية مرفوضة", "FORBIDDEN");

  const updated = await db.courseLesson.update({
    where: { id: lessonId },
    data: { isPublished },
    select: { id: true },
  });
  return { ok: true, data: updated };
}

/* ------------------------------------------------------------------ */
/* Enrollment — assign courses to the supervisor's own teachers         */
/* ------------------------------------------------------------------ */

export interface SupervisorEnrollmentRow {
  userId: string;
  name: string;
  enrolledAt: Date;
  completedAt: Date | null;
}

export async function listSupervisorEnrollments(
  ctx: SupervisorTrainingContext,
  courseId: string
): Promise<SupervisorEnrollmentRow[]> {
  const course = await courseInScope(ctx, courseId);
  if (!course) return [];

  const teacherIds = (await listSupervisorTeachers(ctx)).map((row) => row.id);
  if (teacherIds.length === 0) return [];

  const [rows, completions] = await Promise.all([
    db.courseEnrollment.findMany({
      where: { courseId, userId: { in: teacherIds } },
      include: { user: { select: { name: true } } },
      orderBy: { enrolledAt: "desc" },
      take: 200,
    }),
    db.courseCompletion.findMany({
      where: { courseId },
      select: { userId: true, completedAt: true },
    }),
  ]);
  const completionByUser = new Map(
    completions.map((row) => [row.userId, row.completedAt])
  );

  return rows.map((row) => ({
    userId: row.userId,
    name: row.user.name,
    enrolledAt: row.enrolledAt,
    completedAt: completionByUser.get(row.userId) ?? null,
  }));
}

export async function enrollSupervisorTeachers(
  ctx: SupervisorTrainingContext,
  courseId: string,
  teacherIds: string[]
): Promise<SupervisorResult<{ enrolled: number }>> {
  const course = await courseInScope(ctx, courseId);
  if (!course) return fail("الدورة غير موجودة أو خارج نطاق مدرستك", "FORBIDDEN");
  if (course.status !== "PUBLISHED") {
    return fail("انشر الدورة أولًا قبل إسنادها للمعلمين", "VALIDATION_ERROR");
  }
  if (!Array.isArray(teacherIds) || teacherIds.length === 0) {
    return fail("اختر معلمًا واحدًا على الأقل", "VALIDATION_ERROR");
  }
  const scoped = new Set((await listSupervisorTeachers(ctx)).map((row) => row.id));
  const valid = teacherIds.filter((id) => scoped.has(id));
  if (valid.length === 0) {
    return fail("المعلمون المحددون خارج نطاقك — العملية مرفوضة", "FORBIDDEN");
  }

  const result = await db.courseEnrollment.createMany({
    data: valid.map((userId) => ({ courseId, userId, status: "ACTIVE" })),
    skipDuplicates: true,
  });
  return { ok: true, data: { enrolled: result.count } };
}

/* ------------------------------------------------------------------ */
/* Assessments — delegated wrappers (fences re-checked inside)          */
/* ------------------------------------------------------------------ */

export async function listSupervisorAssessments(
  ctx: SupervisorTrainingContext,
  filters: { q?: string; status?: string; page?: number }
) {
  return listAssessmentsForManage(asManageContext(ctx), filters);
}

const supervisorAssessmentSchema = z.object({
  titleAr: z.string().trim().min(3).max(150),
  titleEn: z.string().trim().max(150).optional(),
  instructionsAr: z.string().trim().min(3).max(2000),
  instructionsEn: z.string().trim().max(2000).optional(),
  courseId: z.string().trim().max(64).optional(),
  passingScore: z.coerce.number().int().min(1).max(1000),
  timeLimitMinutes: z.coerce.number().int().min(1).max(300).optional(),
  attemptLimit: z.coerce.number().int().min(1).max(10).optional(),
});

/** Failure-only result used by scope-assertion helpers. */
export type SupervisorFailure = {
  ok: false;
  message: string;
  code?: string;
  fieldErrors?: Record<string, string>;
};

async function assertAssessmentCourseScope(
  ctx: SupervisorTrainingContext,
  courseId: string | undefined
): Promise<SupervisorFailure | null> {
  if (!courseId) return null;
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { schoolId: true, status: true },
  });
  const allowed =
    course &&
    (course.schoolId === ctx.schoolId ||
      (course.schoolId === null && course.status === "PUBLISHED"));
  if (!allowed) {
    const failure: SupervisorFailure = {
      ok: false,
      message: "الدورة المحددة غير موجودة أو خارج نطاق مدرستك",
      code: "FORBIDDEN",
    };
    return failure;
  }
  return null;
}

export async function createSupervisorAssessment(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const parsed = supervisorAssessmentSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const input = parsed.data;

  const scopeError = await assertAssessmentCourseScope(ctx, input.courseId);
  if (scopeError) return scopeError;

  const result = await createAssessment(
    { ...input, scope: "school", schoolId: ctx.schoolId },
    asManageContext(ctx)
  );
  return result.ok
    ? result
    : { ok: false, message: result.message, code: result.code, fieldErrors: result.fieldErrors };
}

export async function updateSupervisorAssessment(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const parsed = supervisorAssessmentSchema
    .extend({ assessmentId: z.string().trim().min(1) })
    .safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const { assessmentId, ...input } = parsed.data;

  const scopeError = await assertAssessmentCourseScope(ctx, input.courseId);
  if (scopeError) return scopeError;

  const result = await updateAssessment({ ...input, assessmentId }, asManageContext(ctx));
  return result.ok
    ? result
    : { ok: false, message: result.message, code: result.code, fieldErrors: result.fieldErrors };
}

const assessmentStatusSchema = z.object({
  assessmentId: z.string().trim().min(1),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"]),
});

export async function setSupervisorAssessmentStatus(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const parsed = assessmentStatusSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const result = await setAssessmentStatus(parsed.data, asManageContext(ctx));
  return result.ok ? result : { ok: false, message: result.message, code: result.code };
}

export async function addSupervisorQuestion(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const result = await addQuestion(raw, asManageContext(ctx));
  return result.ok
    ? result
    : { ok: false, message: result.message, code: result.code, fieldErrors: result.fieldErrors };
}

export async function editSupervisorQuestion(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const result = await updateQuestion(raw, asManageContext(ctx));
  return result.ok
    ? result
    : { ok: false, message: result.message, code: result.code, fieldErrors: result.fieldErrors };
}

export async function deleteSupervisorQuestion(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const result = await deleteQuestion(raw, asManageContext(ctx));
  return result.ok ? result : { ok: false, message: result.message, code: result.code };
}

export async function moveSupervisorQuestion(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const result = await moveQuestion(raw, asManageContext(ctx));
  return result.ok ? result : { ok: false, message: result.message, code: result.code };
}

/* ------------------------------------------------------------------ */
/* Dashboard — one batch of real aggregates                             */
/* ------------------------------------------------------------------ */

export interface SupervisorDashboardData {
  teachers: Array<{
    id: string;
    name: string;
    email: string | null;
    growthLevel: string;
  }>;
  teachersCount: number;
  courses: { DRAFT: number; PUBLISHED: number; ARCHIVED: number; total: number };
  enrollmentsCount: number;
  completionsCount: number;
  assessments: { total: number; published: number };
  attempts: { total: number; passed: number; needsReview: number };
  impact: { surveysCount: number; responsesCount: number };
  pendingFollowUps: Array<{
    id: string;
    titleAr: string;
    teacherName: string;
    followUpDate: Date;
    status: string;
  }>;
  recentCompletions: Array<{
    id: string;
    teacherName: string;
    courseTitleAr: string;
    completedAt: Date;
  }>;
  latestNotifications: Array<{
    id: string;
    titleAr: string;
    bodyAr: string;
    destinationUrl: string | null;
    createdAt: Date;
  }>;
}

export async function getSupervisorDashboard(
  ctx: SupervisorTrainingContext
): Promise<SupervisorDashboardData> {
  const teachers = await listSupervisorTeachers(ctx);
  const teacherIds = teachers.map((row) => row.id);

  const [statusGroups, enrollmentsCount, completionsCount, assessmentsTotal, assessmentsPublished, attemptsTotal, attemptsPassed, attemptsReview, surveys, followUps, completions, latestNotifications] =
    await Promise.all([
      db.course.groupBy({
        by: ["status"],
        where: { schoolId: ctx.schoolId },
        _count: { _all: true },
      }),
      teacherIds.length
        ? db.courseEnrollment.count({ where: { userId: { in: teacherIds } } })
        : Promise.resolve(0),
      teacherIds.length
        ? db.courseCompletion.count({ where: { userId: { in: teacherIds } } })
        : Promise.resolve(0),
      db.assessment.count({ where: { schoolId: ctx.schoolId } }),
      db.assessment.count({ where: { schoolId: ctx.schoolId, status: "PUBLISHED" } }),
      teacherIds.length
        ? db.assessmentAttempt.count({
            where: { userId: { in: teacherIds }, status: { not: "IN_PROGRESS" } },
          })
        : Promise.resolve(0),
      teacherIds.length
        ? db.assessmentAttempt.count({
            where: { userId: { in: teacherIds }, status: "PASSED" },
          })
        : Promise.resolve(0),
      teacherIds.length
        ? db.assessmentAttempt.count({
            where: { userId: { in: teacherIds }, status: "NEEDS_REVIEW" },
          })
        : Promise.resolve(0),
      db.survey.findMany({
        where: {
          schoolId: ctx.schoolId,
          courseId: { not: null },
          status: "PUBLISHED",
        },
        select: {
          _count: { select: { responses: { where: { status: "SUBMITTED" } } } },
        },
      }),
      db.followUp.findMany({
        where: { supervisorId: ctx.id, status: { in: ["PLANNED", "IN_PROGRESS"] } },
        include: { teacher: { select: { name: true } } },
        orderBy: { followUpDate: "asc" },
        take: 6,
      }),
      teacherIds.length
        ? db.courseCompletion.findMany({
            where: { userId: { in: teacherIds } },
            include: {
              user: { select: { name: true } },
              course: { select: { titleAr: true } },
            },
            orderBy: { completedAt: "desc" },
            take: 5,
          })
        : Promise.resolve([]),
      db.notification.findMany({
        where: { userId: ctx.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          titleAr: true,
          bodyAr: true,
          destinationUrl: true,
          createdAt: true,
        },
      }),
    ]);

  const courseCounts: SupervisorDashboardData["courses"] = {
    DRAFT: 0,
    PUBLISHED: 0,
    ARCHIVED: 0,
    total: 0,
  };
  for (const group of statusGroups) {
    const count = (group._count as { _all: number })._all ?? 0;
    if (group.status === "DRAFT") courseCounts.DRAFT = count;
    if (group.status === "PUBLISHED") courseCounts.PUBLISHED = count;
    if (group.status === "ARCHIVED") courseCounts.ARCHIVED = count;
    courseCounts.total += count;
  }

  return {
    teachers: teachers.slice(0, 8).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      growthLevel: row.growthLevel,
    })),
    teachersCount: teachers.length,
    courses: courseCounts,
    enrollmentsCount,
    completionsCount,
    assessments: { total: assessmentsTotal, published: assessmentsPublished },
    attempts: { total: attemptsTotal, passed: attemptsPassed, needsReview: attemptsReview },
    impact: {
      surveysCount: surveys.length,
      responsesCount: surveys.reduce(
        (sum, survey) => sum + (survey._count.responses ?? 0),
        0
      ),
    },
    pendingFollowUps: followUps.map((row) => ({
      id: row.id,
      titleAr: row.titleAr,
      teacherName: row.teacher.name,
      followUpDate: row.followUpDate,
      status: row.status,
    })),
    recentCompletions: completions.map((row) => ({
      id: row.id,
      teacherName: row.user.name,
      courseTitleAr: row.course.titleAr,
      completedAt: row.completedAt,
    })),
    latestNotifications,
  };
}

/* ------------------------------------------------------------------ */
/* Impact surveys — additive authoring (the legacy layer had submission */
/* and results only; creation lived nowhere).                           */
/* ------------------------------------------------------------------ */

const IMPACT_QUESTION_TYPES = [
  "RATING",
  "YES_NO",
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "SHORT_TEXT",
  "LONG_TEXT",
] as const;

const impactSurveySchema = z.object({
  courseId: z.string().trim().min(1),
  titleAr: z.string().trim().min(3).max(150),
  purposeAr: z.string().trim().max(500).optional(),
  instructionsAr: z.string().trim().max(500).optional(),
  questions: z
    .array(
      z
        .object({
          textAr: z.string().trim().min(3).max(300),
          helpTextAr: z.string().trim().max(300).optional(),
          type: z.enum(IMPACT_QUESTION_TYPES),
          required: z.boolean(),
          options: z
            .array(z.string().trim().min(1).max(120))
            .max(10)
            .optional(),
          minScore: z.coerce.number().int().min(1).max(10).optional(),
          maxScore: z.coerce.number().int().min(1).max(10).optional(),
        })
        .superRefine((question, refineCtx) => {
          if (
            (question.type === "SINGLE_CHOICE" || question.type === "MULTI_CHOICE") &&
            (!question.options || question.options.length < 2)
          ) {
            refineCtx.addIssue({
              code: "custom",
              path: ["options"],
              message: "أضف خيارين على الأقل لسؤال الاختيار",
            });
          }
        })
    )
    .min(1, "أضف سؤالًا واحدًا على الأقل")
    .max(30),
});

export async function createSupervisorImpactSurvey(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const parsed = impactSurveySchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const input = parsed.data;

  const course = await db.course.findUnique({
    where: { id: input.courseId },
    select: { schoolId: true, status: true },
  });
  const allowed =
    course &&
    (course.schoolId === ctx.schoolId ||
      (course.schoolId === null && course.status === "PUBLISHED"));
  if (!allowed) {
    return fail("الدورة المحددة غير موجودة أو خارج نطاق مدرستك", "FORBIDDEN");
  }

  const duplicate = await db.survey.findFirst({
    where: {
      courseId: input.courseId,
      schoolId: ctx.schoolId,
      status: { not: "ARCHIVED" },
    },
    select: { id: true },
  });
  if (duplicate) {
    return fail(
      "توجد أداة قياس أثر لهذه الدورة بالفعل — أغلقها أو أرشفها قبل إنشاء أداة جديدة",
      "VALIDATION_ERROR"
    );
  }

  const created = await db.survey.create({
    data: {
      schoolId: ctx.schoolId,
      ownerUserId: ctx.id,
      titleAr: input.titleAr,
      descriptionAr: input.purposeAr ?? null,
      purposeAr: input.purposeAr ?? null,
      instructionsAr: input.instructionsAr ?? null,
      courseId: input.courseId,
      stage: "AFTER_TRAINING",
      audienceMode: "ALL_TEACHERS",
      anonymous: false,
      status: "DRAFT",
      questions: {
        create: input.questions.map((question, index) => ({
          orderIndex: index,
          textAr: question.textAr,
          helpTextAr: question.helpTextAr ?? null,
          type: question.type,
          required: question.required,
          optionsJson:
            question.options && question.options.length > 0
              ? JSON.stringify(question.options)
              : null,
          minScore: question.type === "RATING" ? (question.minScore ?? 1) : null,
          maxScore: question.type === "RATING" ? (question.maxScore ?? 5) : null,
        })),
      },
    },
    select: { id: true },
  });
  return { ok: true, data: created };
}

const surveyStatusSchema = z.object({
  surveyId: z.string().trim().min(1),
  action: z.enum(["PUBLISH", "CLOSE", "ARCHIVE"]),
});

export async function setSupervisorImpactSurveyStatus(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string; status: string }>> {
  const parsed = surveyStatusSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);

  const survey = await db.survey.findUnique({
    where: { id: parsed.data.surveyId },
    select: {
      id: true,
      schoolId: true,
      status: true,
      _count: { select: { questions: true } },
    },
  });
  if (!survey || survey.schoolId !== ctx.schoolId) {
    return fail("أداة القياس غير موجودة أو خارج نطاق مدرستك", "FORBIDDEN");
  }

  if (parsed.data.action === "PUBLISH") {
    if (survey._count.questions < 1) {
      return fail("لا يمكن النشر — أضف سؤالًا واحدًا على الأقل", "VALIDATION_ERROR");
    }
    if (survey.status !== "DRAFT") {
      return fail("لا يمكن نشر الأداة في حالتها الحالية", "VALIDATION_ERROR");
    }
    const updated = await db.survey.update({
      where: { id: survey.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
      select: { id: true, status: true },
    });
    return { ok: true, data: updated };
  }

  if (parsed.data.action === "CLOSE") {
    if (survey.status !== "PUBLISHED") {
      return fail("الأداة ليست منشورة", "VALIDATION_ERROR");
    }
    const updated = await db.survey.update({
      where: { id: survey.id },
      data: { status: "CLOSED", closedAt: new Date() },
      select: { id: true, status: true },
    });
    return { ok: true, data: updated };
  }

  // ARCHIVE — refuse when responses exist (preserve real data).
  const responsesCount = await db.surveyResponse.count({
    where: { surveyId: survey.id },
  });
  if (responsesCount > 0) {
    return fail(
      "لا يمكن أرشفة أداة عليها استجابات — الأرشفة ستحذف سجلات حقيقية",
      "FORBIDDEN"
    );
  }
  const updated = await db.survey.update({
    where: { id: survey.id },
    data: { status: "ARCHIVED", archivedAt: new Date() },
    select: { id: true, status: true },
  });
  return { ok: true, data: updated };
}

export interface SupervisorImpactSurveyRow {
  id: string;
  titleAr: string;
  status: string;
  courseId: string | null;
  courseTitleAr: string | null;
  questionsCount: number;
  responsesCount: number;
  publishedAt: Date | null;
}

export async function listSupervisorImpactSurveys(
  ctx: SupervisorTrainingContext
): Promise<SupervisorImpactSurveyRow[]> {
  const surveys = await db.survey.findMany({
    where: {
      schoolId: ctx.schoolId,
      courseId: { not: null },
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      titleAr: true,
      status: true,
      publishedAt: true,
      courseId: true,
      course: { select: { titleAr: true } },
      _count: {
        select: { questions: true, responses: { where: { status: "SUBMITTED" } } },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return surveys.map((row) => ({
    id: row.id,
    titleAr: row.titleAr,
    status: row.status,
    courseId: row.courseId,
    courseTitleAr: row.course?.titleAr ?? null,
    questionsCount: row._count.questions,
    responsesCount: row._count.responses,
    publishedAt: row.publishedAt,
  }));
}

/** Courses available for impact tools: own school + platform PUBLISHED. */
export async function listSupervisorImpactCourseOptions(
  ctx: SupervisorTrainingContext
): Promise<Array<{ id: string; titleAr: string }>> {
  const rows = await db.course.findMany({
    where: {
      status: { not: "ARCHIVED" },
      OR: [{ schoolId: ctx.schoolId }, { schoolId: null, status: "PUBLISHED" }],
    },
    select: { id: true, titleAr: true },
    orderBy: { titleAr: "asc" },
    take: 200,
  });
  return rows;
}

/* ------------------------------------------------------------------ */
/* Mandatory learning policy — per-course settings                      */
/* ------------------------------------------------------------------ */

const coursePolicySchema = z.object({
  courseId: z.string().trim().min(1),
  /** Sequential unlocking: every lesson opens only after the previous one. */
  requireSequentialLessons: z.boolean(),
  /** Watched percentage (50..100) that completes an uploaded-video lesson. */
  lessonCompletionThreshold: z.coerce.number().int().min(50).max(100),
});

/** Read the mandatory-learning policy of one in-scope course. */
export async function getSupervisorCoursePolicy(
  ctx: SupervisorTrainingContext,
  courseId: string
): Promise<SupervisorResult<{
  requireSequentialLessons: boolean;
  lessonCompletionThreshold: number;
}>> {
  const course = await courseInScope(ctx, courseId);
  if (!course) return fail("الدورة غير موجودة أو خارج نطاق مدرستك", "FORBIDDEN");
  const row = await db.course.findUnique({
    where: { id: courseId },
    select: {
      requireSequentialLessons: true,
      lessonCompletionThreshold: true,
    },
  });
  return {
    ok: true,
    data: {
      requireSequentialLessons: row?.requireSequentialLessons ?? true,
      lessonCompletionThreshold: row?.lessonCompletionThreshold ?? 95,
    },
  };
}

/** Save the mandatory-learning policy (tenant-fenced). */
export async function saveSupervisorCoursePolicy(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string }>> {
  const parsed = coursePolicySchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const { courseId, requireSequentialLessons, lessonCompletionThreshold } =
    parsed.data;

  const course = await courseInScope(ctx, courseId);
  if (!course) return fail("الدورة غير موجودة أو خارج نطاق مدرستك", "FORBIDDEN");

  const updated = await db.course.update({
    where: { id: courseId },
    data: { requireSequentialLessons, lessonCompletionThreshold },
    select: { id: true },
  });
  return { ok: true, data: updated };
}

/* ------------------------------------------------------------------ */
/* Unified training creation — ONE page for the complete professional   */
/* training (info + classification + schedule + links + videos +        */
/* attachments + assessment + impact) and ONE publish action.           */
/*                                                                      */
/* Reuses: courseInScope fence, the existing lesson/assessment/impact   */
/* actions, the R2 media pipeline (request → PUT → confirm) and the     */
/* survey/assessment models. NOTHING new is introduced as a parallel    */
/* system: videos stay CourseLesson(VIDEO), attachments stay Attachment */
/* (kind RESOURCE), the final assessment stays Assessment+questions,    */
/* impact stays Survey(stage AFTER_TRAINING)+SurveyQuestion.            */
/* ------------------------------------------------------------------ */

// Canonical option lists live in the shared (client-safe) config module
// and are re-exported here for server-side consumers.
export {
  TRAINING_TYPES,
  TRAINING_DOMAINS,
  TRAINING_SUBCATEGORIES,
  DEFAULT_PASSING_PERCENT,
  trainingTypeLabel,
  type TrainingTypeKey,
} from "@/config/training-domains";

import {
  DEFAULT_PASSING_PERCENT,
  TRAINING_DOMAINS,
  TRAINING_SUBCATEGORIES,
} from "@/config/training-domains";

const unifiedTrainingSchema = z
  .object({
    courseId: z.string().trim().min(1).optional(),
    titleAr: z.string().trim().min(3).max(150),
    titleEn: z.string().trim().max(150).optional(),
    descriptionAr: z.string().trim().min(5).max(4000),
    descriptionEn: z.string().trim().max(4000).optional(),
    category: z.string().trim().min(2).max(60),
    subcategory: z.string().trim().max(60).optional(),
    trainingType: z
      .enum(["VIRTUAL_LIVE", "RECORDED", "IN_PERSON", "OTHER"])
      .optional(),
    level: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).optional(),
    estimatedHours: z.coerce.number().int().min(1).max(200).optional(),
    programId: z.string().trim().max(64).optional(),
    /** ISO date (YYYY-MM-DD) or "" to clear. */
    scheduledAt: z.string().trim().max(40).optional(),
    meetingUrl: z.string().trim().max(500).optional(),
    youtubeUrl: z.string().trim().max(500).optional(),
    supervisorInstructionsAr: z.string().trim().max(4000).optional(),
  })
  .superRefine((value, refineCtx) => {
    if (
      value.meetingUrl &&
      value.meetingUrl.length > 0 &&
      !value.meetingUrl.startsWith("https://")
    ) {
      refineCtx.addIssue({
        code: "custom",
        path: ["meetingUrl"],
        message: "رابط الاجتماع يجب أن يبدأ بـ https:// (Zoom أو Google Meet)",
      });
    }
    if (value.youtubeUrl && value.youtubeUrl.length > 0) {
      let youtubeValid = false;
      try {
        const parsed = new URL(value.youtubeUrl);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
        youtubeValid =
          parsed.protocol === "https:" &&
          (host === "youtube.com" ||
            host === "m.youtube.com" ||
            host === "youtu.be");
      } catch {
        youtubeValid = false;
      }
      if (!youtubeValid) {
        refineCtx.addIssue({
          code: "custom",
          path: ["youtubeUrl"],
          message: "أدخل رابط يوتيوب صحيحًا يبدأ بـ https:// (youtube.com أو youtu.be)",
        });
      }
    }
    if (value.scheduledAt && value.scheduledAt.length > 0) {
      const parsed = new Date(value.scheduledAt);
      if (Number.isNaN(parsed.getTime())) {
        refineCtx.addIssue({
          code: "custom",
          path: ["scheduledAt"],
          message: "تاريخ التدريب غير صالح",
        });
      }
    }
  });

/** Program relation check shared by the unified create/update paths. */
async function assertProgramInScope(
  schoolId: string,
  programId: string | undefined
): Promise<SupervisorFailure | null> {
  if (!programId) return null;
  const program = await db.trainingProgram.findUnique({
    where: { id: programId },
    select: { schoolId: true },
  });
  if (!program || (program.schoolId !== null && program.schoolId !== schoolId)) {
    return {
      ok: false,
      message: "البرنامج التدريبي المحدد غير متاح لمدرستك",
      code: "VALIDATION_ERROR",
      fieldErrors: { programId: "البرنامج غير متاح لمدرستك" },
    };
  }
  return null;
}

function parseScheduledAt(raw: string | undefined): Date | null | "invalid" {
  if (!raw || raw.length === 0) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "invalid" : parsed;
}

/**
 * Save the unified training form — CREATE (new draft, school + trainer
 * hard-bound to the session) or UPDATE (tenant-fenced). Persists the
 * extended unified fields that the legacy createCourse/updateCourse
 * schemas do not carry; base-field validation mirrors the legacy rules.
 */
export async function saveSupervisorTraining(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string; created: boolean }>> {
  const parsed = unifiedTrainingSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const input = parsed.data;

  // Domain fence: the fixed Arabic domains — except a legacy course
  // keeping its own existing (free-key) category unchanged.
  if (!(TRAINING_DOMAINS as readonly string[]).includes(input.category)) {
    if (!input.courseId) {
      return {
        ok: false,
        message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
        code: "VALIDATION_ERROR",
        fieldErrors: { category: "اختر المجال الرئيسي من القائمة" },
      };
    }
    const existing = await db.course.findUnique({
      where: { id: input.courseId },
      select: { category: true },
    });
    if (!existing || existing.category !== input.category) {
      return {
        ok: false,
        message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
        code: "VALIDATION_ERROR",
        fieldErrors: { category: "اختر المجال الرئيسي من القائمة" },
      };
    }
  }

  if (input.subcategory && !(TRAINING_SUBCATEGORIES as readonly string[]).includes(input.subcategory)) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      code: "VALIDATION_ERROR",
      fieldErrors: { subcategory: "اختر التصنيف الفرعي من القائمة" },
    };
  }

  const scheduledAt = parseScheduledAt(input.scheduledAt);
  if (scheduledAt === "invalid") {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      code: "VALIDATION_ERROR",
      fieldErrors: { scheduledAt: "تاريخ التدريب غير صالح" },
    };
  }

  const data = {
    titleAr: input.titleAr,
    titleEn: input.titleEn ?? null,
    descriptionAr: input.descriptionAr,
    descriptionEn: input.descriptionEn ?? null,
    category: input.category,
    subcategory: input.subcategory || null,
    trainingType: input.trainingType ?? null,
    level: input.level ?? null,
    estimatedHours: input.estimatedHours ?? null,
    scheduledAt,
    meetingUrl: input.meetingUrl || null,
    youtubeUrl: input.youtubeUrl || null,
    supervisorInstructionsAr: input.supervisorInstructionsAr || null,
  };

  if (!input.courseId) {
    const programError = await assertProgramInScope(ctx.schoolId, input.programId);
    if (programError) return programError;
    const created = await db.course.create({
      data: {
        ...data,
        // Tenant + trainer hard-bound to the SESSION — never the client.
        schoolId: ctx.schoolId,
        createdById: ctx.id,
        instructorId: ctx.id,
        programId: input.programId || null,
        status: "DRAFT",
      },
      select: { id: true },
    });
    return { ok: true, data: { id: created.id, created: true } };
  }

  const course = await courseInScope(ctx, input.courseId);
  if (!course) return fail("التدريب غير موجود أو خارج نطاق مدرستك", "FORBIDDEN");

  const programError = await assertProgramInScope(ctx.schoolId, input.programId);
  if (programError) return programError;

  const updated = await db.course.update({
    where: { id: course.id },
    data: { ...data, programId: input.programId || null },
    select: { id: true },
  });
  return { ok: true, data: { id: updated.id, created: false } };
}

/* --------------------------- Attachments --------------------------- */

/**
 * Remove a course attachment (Attachment kind RESOURCE bound to the
 * course). Tenant-fenced; the R2 object is released best-effort.
 */
export async function deleteSupervisorTrainingAttachment(
  ctx: SupervisorTrainingContext,
  attachmentId: string
): Promise<SupervisorResult<{ id: string }>> {
  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, courseId: true, provider: true, storageKey: true },
  });
  if (!attachment || !attachment.courseId) {
    return fail("المرفق غير موجود", "NOT_FOUND");
  }
  const course = await courseInScope(ctx, attachment.courseId);
  if (!course) return fail("خارج نطاق مدرستك — العملية مرفوضة", "FORBIDDEN");

  await db.attachment.delete({ where: { id: attachment.id } });

  if (attachment.provider === "R2") {
    try {
      const { publicUrlFor } = await import("@/lib/media/r2");
      const { releaseMediaIfUnreferenced } = await import("@/lib/media/references");
      await releaseMediaIfUnreferenced(publicUrlFor(attachment.storageKey));
    } catch {
      // Orphan cleanup is retried by maintenance; never block the delete.
    }
  }
  return { ok: true, data: { id: attachmentId } };
}

/* ------------------------- Passing percent ------------------------- */

const passingPercentSchema = z.object({
  assessmentId: z.string().trim().min(1),
  passingPercent: z.coerce.number().int().min(20).max(100),
});

/**
 * Persist the supervisor-chosen pass PERCENTAGE of the final assessment
 * and recompute the stored passing points immediately, so the live
 * threshold stays consistent between question edits.
 */
export async function setSupervisorAssessmentPassingPercent(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<{ id: string; passingPercent: number; passingScore: number }>> {
  const parsed = passingPercentSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);

  const assessment = await db.assessment.findUnique({
    where: { id: parsed.data.assessmentId },
    select: { id: true, schoolId: true, status: true, maxScore: true },
  });
  if (!assessment || assessment.schoolId !== ctx.schoolId) {
    return fail("الاختبار غير موجود أو خارج نطاق مدرستك", "FORBIDDEN");
  }
  if (assessment.status === "ARCHIVED") {
    return fail("الاختبار مؤرشف — لا يمكن تعديله", "FORBIDDEN");
  }

  const pct = parsed.data.passingPercent;
  const maxScore = Math.max(assessment.maxScore, 0);
  const passingScore =
    maxScore > 0
      ? Math.min(maxScore, Math.max(1, Math.ceil((maxScore * pct) / 100)))
      : Math.max(1, Math.ceil(pct / 100));

  const updated = await db.assessment.update({
    where: { id: assessment.id },
    data: { passingPercent: pct, passingScore },
    select: { passingScore: true },
  });
  return {
    ok: true,
    data: {
      id: assessment.id,
      passingPercent: pct,
      passingScore: updated.passingScore,
    },
  };
}

/* --------------------------- Publishing ---------------------------- */

const publishTrainingSchema = z.object({
  courseId: z.string().trim().min(1),
  /** Pass percentage applied to the final assessment on publish
   * (defaults to the stored value, then 60%). */
  passingPercent: z.coerce.number().int().min(20).max(100).optional(),
});

export interface PublishTrainingSummary {
  courseId: string;
  lessonsPublished: number;
  assessmentPublished: boolean;
  surveyPublished: boolean;
}

/**
 * Publish the complete training — the ONE server-validated entry point
 * behind the «نشر التدريب» button:
 *   1. tenant + content guards (≥1 section and ≥1 lesson),
 *   2. all lessons become visible to teachers,
 *   3. the course-bound final assessment is published with the pass
 *      threshold recomputed from the chosen percentage,
 *   4. the course-bound impact tool is published,
 *   5. the course itself flips to PUBLISHED (publishedAt set once),
 * all inside ONE transaction so teachers never see a half-configured
 * training and no partial publish can linger.
 */
export async function publishSupervisorTraining(
  ctx: SupervisorTrainingContext,
  raw: unknown
): Promise<SupervisorResult<PublishTrainingSummary>> {
  const parsed = publishTrainingSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);

  const course = await courseInScope(ctx, parsed.data.courseId);
  if (!course) return fail("التدريب غير موجود أو خارج نطاق مدرستك", "FORBIDDEN");

  const [sectionCount, lessons] = await Promise.all([
    db.courseSection.count({ where: { courseId: course.id } }),
    db.courseLesson.findMany({
      where: { section: { courseId: course.id } },
      select: { id: true, isPublished: true },
    }),
  ]);
  if (sectionCount < 1 || lessons.length < 1) {
    return fail(
      "لا يمكن النشر — أضف فيديو تدريب واحدًا على الأقل (أو درسًا) قبل النشر",
      "PUBLISH_BLOCKED"
    );
  }

  // The course-bound final assessment (if configured) must be complete.
  const assessment = await db.assessment.findFirst({
    where: { courseId: course.id, schoolId: ctx.schoolId, status: { not: "ARCHIVED" } },
    select: { id: true, maxScore: true, passingPercent: true, status: true, _count: { select: { questions: true } } },
  });
  if (assessment && assessment._count.questions < 1) {
    return fail(
      "الاختبار النهائي مضبوط لكنه بلا أسئلة — أضف سؤالًا واحدًا على الأقل قبل النشر",
      "PUBLISH_BLOCKED"
    );
  }

  // The course-bound impact tool (if configured) must be complete.
  const survey = await db.survey.findFirst({
    where: { courseId: course.id, schoolId: ctx.schoolId, status: { not: "ARCHIVED" } },
    select: { id: true, status: true, _count: { select: { questions: true } } },
  });
  if (survey && survey._count.questions < 1) {
    return fail(
      "أداة قياس الأثر مضبوطة لكنها بلا أسئلة — أضف سؤالًا واحدًا على الأقل قبل النشر",
      "PUBLISH_BLOCKED"
    );
  }

  const pct =
    parsed.data.passingPercent ?? assessment?.passingPercent ?? DEFAULT_PASSING_PERCENT;
  const assessmentMax = Math.max(assessment?.maxScore ?? 0, 0);
  const passingScore =
    assessmentMax > 0
      ? Math.min(assessmentMax, Math.max(1, Math.ceil((assessmentMax * pct) / 100)))
      : 1;

  await db.$transaction(async (tx) => {
    await tx.courseLesson.updateMany({
      where: { section: { courseId: course.id }, isPublished: false },
      data: { isPublished: true },
    });

    if (assessment) {
      await tx.assessment.update({
        where: { id: assessment.id },
        data: {
          status: "PUBLISHED",
          passingScore,
          passingPercent: pct,
        },
      });
    }

    if (survey && survey.status !== "PUBLISHED") {
      await tx.survey.update({
        where: { id: survey.id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });
    }

    await tx.course.update({
      where: { id: course.id },
      data: {
        status: "PUBLISHED",
        // Set on the first successful publish; kept on re-publish.
        publishedAt: course.publishedAt ?? new Date(),
      },
    });
  });

  return {
    ok: true,
    data: {
      courseId: course.id,
      lessonsPublished: lessons.length,
      assessmentPublished: Boolean(assessment),
      surveyPublished: Boolean(survey),
    },
  };
}

/* ------------------------ Unified workspace ------------------------ */

export interface TrainingWorkspaceQuestion {
  id: string;
  type: string;
  textAr: string;
  points: number;
  isRequired: boolean;
  orderIndex: number;
  options: Array<{ id: string; textAr: string }>;
  /** Supervisor-only answer-key projection for editing (never sent to
   * teachers — the taking path strips keys server-side). */
  correctOptionIds: string[];
  correctBool: boolean | null;
  modelAnswer: string | null;
  explanation: string | null;
}

export interface TrainingWorkspace {
  course: {
    id: string;
    titleAr: string;
    titleEn: string | null;
    descriptionAr: string;
    descriptionEn: string | null;
    category: string;
    subcategory: string | null;
    trainingType: string | null;
    level: string | null;
    estimatedHours: number | null;
    programId: string | null;
    status: string;
    scheduledAt: string | null;
    meetingUrl: string | null;
    youtubeUrl: string | null;
    supervisorInstructionsAr: string | null;
    instructorName: string;
    schoolName: string;
  };
  coverUrl: string | null;
  sections: Array<{
    id: string;
    titleAr: string;
    description: string | null;
    orderIndex: number;
    lessons: Array<{
      id: string;
      titleAr: string;
      description: string | null;
      type: string;
      content: string | null;
      videoUrl: string | null;
      attachmentName: string | null;
      durationSeconds: number | null;
      isPublished: boolean;
      orderIndex: number;
    }>;
  }>;
  attachments: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
  }>;
  teachers: Array<{ id: string; name: string }>;
  enrollments: Array<{ userId: string; name: string; completedAt: string | null }>;
  programs: Array<{ id: string; nameAr: string; platformWide: boolean }>;
  assessment: {
    id: string;
    titleAr: string;
    instructionsAr: string;
    status: string;
    passingScore: number;
    maxScore: number;
    passingPercent: number | null;
    attemptLimit: number | null;
    timeLimitMinutes: number | null;
    questions: TrainingWorkspaceQuestion[];
  } | null;
  survey: {
    id: string;
    titleAr: string;
    purposeAr: string | null;
    status: string;
    questionsCount: number;
  } | null;
}

function parseQuestionOptions(raw: string | null): Array<{ id: string; textAr: string }> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { id: string; textAr: string } =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { textAr?: unknown }).textAr === "string"
    );
  } catch {
    return [];
  }
}

function parseQuestionAnswerKey(
  raw: string | null
): { optionIds: string[]; bool: boolean | null; modelAnswer: string | null } {
  if (!raw) return { optionIds: [], bool: null, modelAnswer: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { optionIds: [], bool: null, modelAnswer: null };
    }
    const record = parsed as Record<string, unknown>;
    const optionIds: string[] = [];
    if (typeof record.optionId === "string") optionIds.push(record.optionId);
    if (Array.isArray(record.optionIds)) {
      for (const value of record.optionIds) {
        if (typeof value === "string") optionIds.push(value);
      }
    }
    return {
      optionIds,
      bool: typeof record.value === "boolean" ? record.value : null,
      modelAnswer: typeof record.modelAnswer === "string" ? record.modelAnswer : null,
    };
  } catch {
    return { optionIds: [], bool: null, modelAnswer: null };
  }
}

/**
 * Everything the unified editor renders, loaded in one place with the
 * same tenant fence as every other supervisor read (courseInScope).
 */
export async function getSupervisorTrainingWorkspace(
  ctx: SupervisorTrainingContext,
  courseId: string
): Promise<SupervisorResult<TrainingWorkspace>> {
  const course = await courseInScope(ctx, courseId);
  if (!course) return fail("التدريب غير موجود أو خارج نطاق مدرستك", "FORBIDDEN");

  const [row, teachers, enrollments, programs, coverAttachment] = await Promise.all([
    db.course.findUnique({
      where: { id: courseId },
      include: {
        instructor: { select: { name: true } },
        school: { select: { nameAr: true } },
        sections: {
          orderBy: { orderIndex: "asc" },
          include: {
            lessons: {
              orderBy: { orderIndex: "asc" },
              include: { attachment: { select: { originalName: true } } },
            },
          },
        },
        attachments: {
          where: { kind: "RESOURCE", lessonId: null },
          orderBy: { createdAt: "asc" },
        },
        assessments: {
          where: { status: { not: "ARCHIVED" } },
          orderBy: { createdAt: "asc" },
          take: 1,
          include: {
            questions: { orderBy: { orderIndex: "asc" } },
          },
        },
        surveys: {
          where: { status: { not: "ARCHIVED" } },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            id: true,
            titleAr: true,
            purposeAr: true,
            status: true,
            _count: { select: { questions: true } },
          },
        },
      },
    }),
    listSupervisorTeachers(ctx),
    listSupervisorEnrollments(ctx, courseId),
    listSupervisorProgramOptions(ctx),
    course.coverAttachmentId
      ? db.attachment.findUnique({
          where: { id: course.coverAttachmentId },
          select: { storageKey: true },
        })
      : Promise.resolve(null),
  ]);

  if (!row) return fail("التدريب غير موجود أو خارج نطاق مدرستك", "FORBIDDEN");

  const { publicUrlFor } = await import("@/lib/media/r2");

  const assessmentRow = row.assessments[0] ?? null;
  const surveyRow = row.surveys[0] ?? null;

  return {
    ok: true,
    data: {
      course: {
        id: row.id,
        titleAr: row.titleAr,
        titleEn: row.titleEn,
        descriptionAr: row.descriptionAr,
        descriptionEn: row.descriptionEn,
        category: row.category,
        subcategory: row.subcategory,
        trainingType: row.trainingType,
        level: row.level,
        estimatedHours: row.estimatedHours,
        programId: row.programId,
        status: row.status,
        scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
        meetingUrl: row.meetingUrl,
        youtubeUrl: row.youtubeUrl,
        supervisorInstructionsAr: row.supervisorInstructionsAr,
        instructorName: row.instructor?.name ?? ctx.name,
        schoolName: row.school?.nameAr ?? "مدرستك",
      },
      coverUrl: coverAttachment ? publicUrlFor(coverAttachment.storageKey) : null,
      sections: row.sections.map((section) => ({
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
          attachmentName: lesson.attachment?.originalName ?? null,
          durationSeconds: lesson.durationSeconds,
          isPublished: lesson.isPublished,
          orderIndex: lesson.orderIndex,
        })),
      })),
      attachments: row.attachments.map((attachment) => ({
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        url: publicUrlFor(attachment.storageKey),
      })),
      teachers: teachers.map((teacher) => ({ id: teacher.id, name: teacher.name })),
      enrollments: enrollments.map((enrollment) => ({
        userId: enrollment.userId,
        name: enrollment.name,
        completedAt: enrollment.completedAt
          ? enrollment.completedAt.toISOString()
          : null,
      })),
      programs: programs.map((program) => ({
        id: program.id,
        nameAr: program.nameAr,
        platformWide: program.platformWide,
      })),
      assessment: assessmentRow
        ? {
            id: assessmentRow.id,
            titleAr: assessmentRow.titleAr,
            instructionsAr: assessmentRow.instructionsAr,
            status: assessmentRow.status,
            passingScore: assessmentRow.passingScore,
            maxScore: assessmentRow.maxScore,
            passingPercent: assessmentRow.passingPercent,
            attemptLimit: assessmentRow.attemptLimit,
            timeLimitMinutes: assessmentRow.timeLimitMinutes,
            questions: assessmentRow.questions.map((question) => {
              const key = parseQuestionAnswerKey(question.answerKeyJson);
              return {
                id: question.id,
                type: question.type,
                textAr: question.textAr,
                points: question.points,
                isRequired: question.isRequired,
                orderIndex: question.orderIndex,
                options: parseQuestionOptions(question.optionsJson),
                correctOptionIds: key.optionIds,
                correctBool: key.bool,
                modelAnswer: key.modelAnswer,
                explanation: question.explanation,
              };
            }),
          }
        : null,
      survey: surveyRow
        ? {
            id: surveyRow.id,
            titleAr: surveyRow.titleAr,
            purposeAr: surveyRow.purposeAr,
            status: surveyRow.status,
            questionsCount: surveyRow._count.questions,
          }
        : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Draft-first creation + Academy workspace + progress read models.     */
/*                                                                      */
/* Refactor contract:                                                   */
/*   • NO sequential save gates — a DRAFT course exists the moment the  */
/*     creation page opens, so every section (videos, attachments,      */
/*     exam, impact, publish) is editable immediately.                  */
/*   • The Academy lists the supervisor's OWN trainings (createdById)   */
/*     — read-only aggregation, no new write models.                    */
/*   • Each training workspace carries teacher participation, exam      */
/*     results, essay-review needs, certificates and impact responses   */
/*     — all read from the EXISTING models, nothing duplicated.         */
/* ------------------------------------------------------------------ */

/** Placeholder title of an auto-created untouched draft course. */
export const SUPERVISOR_DRAFT_TITLE = "تدريب بدون عنوان";
const SUPERVISOR_DRAFT_DESCRIPTION =
  "مسودة تدريب جديدة — أكمل بيانات التدريب ثم اضغط «حفظ بيانات التدريب» قبل النشر.";

export interface SupervisorDraftHandle {
  id: string;
  created: boolean;
}

/**
 * GET-OR-CREATE the supervisor's scratch DRAFT course backing the
 * one-page creation flow.
 *
 * Reuse rule: the LATEST untouched draft (placeholder title, no
 * sections, no attachments, no assessment, no impact tool) is reused so
 * repeatedly opening the creation page never spams empty rows. A draft
 * that already carries content is left alone and a fresh one is created
 * — nothing the supervisor uploaded is ever silently discarded.
 *
 * Tenant + author are hard-bound to the SESSION (never the client), the
 * same as saveSupervisorTraining's create path.
 */
export async function ensureSupervisorTrainingDraft(
  ctx: SupervisorTrainingContext
): Promise<SupervisorResult<SupervisorDraftHandle>> {
  const existing = await db.course.findFirst({
    where: {
      schoolId: ctx.schoolId,
      createdById: ctx.id,
      status: "DRAFT",
      titleAr: SUPERVISOR_DRAFT_TITLE,
      sections: { none: {} },
      attachments: { none: {} },
      assessments: { none: { status: { not: "ARCHIVED" } } },
      surveys: { none: { status: { not: "ARCHIVED" } } },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (existing) {
    return { ok: true, data: { id: existing.id, created: false } };
  }

  const created = await db.course.create({
    data: {
      // Tenant + trainer hard-bound to the SESSION — never the client.
      schoolId: ctx.schoolId,
      createdById: ctx.id,
      instructorId: ctx.id,
      status: "DRAFT",
      titleAr: SUPERVISOR_DRAFT_TITLE,
      descriptionAr: SUPERVISOR_DRAFT_DESCRIPTION,
      category: TRAINING_DOMAINS[0],
      trainingType: "VIRTUAL_LIVE",
    },
    select: { id: true },
  });
  return { ok: true, data: { id: created.id, created: true } };
}

/* ---------------------- Academy: my trainings ---------------------- */

export interface SupervisorAcademyTrainingRow {
  id: string;
  titleAr: string;
  status: string;
  category: string;
  estimatedHours: number | null;
  sectionsCount: number;
  lessonsCount: number;
  enrollmentsCount: number;
  hasAssessment: boolean;
  hasSurvey: boolean;
  updatedAt: string;
  publishedAt: string | null;
}

/**
 * The trainings the CURRENT supervisor created (createdById), any
 * status — the Academy workspace list. School-fenced; archived rows
 * included with their own pill so nothing the supervisor built ever
 * disappears from their view.
 */
export async function listSupervisorAcademyTrainings(
  ctx: SupervisorTrainingContext
): Promise<SupervisorAcademyTrainingRow[]> {
  const rows = await db.course.findMany({
    where: { schoolId: ctx.schoolId, createdById: ctx.id },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: {
      id: true,
      titleAr: true,
      status: true,
      category: true,
      estimatedHours: true,
      updatedAt: true,
      publishedAt: true,
      _count: { select: { sections: true, enrollments: true } },
    },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [sections, assessments, surveys] = await Promise.all([
    db.courseSection.findMany({
      where: { courseId: { in: ids } },
      select: { courseId: true, _count: { select: { lessons: true } } },
    }),
    db.assessment.findMany({
      where: { courseId: { in: ids }, status: { not: "ARCHIVED" } },
      select: { courseId: true },
    }),
    db.survey.findMany({
      where: { courseId: { in: ids }, status: { not: "ARCHIVED" } },
      select: { courseId: true },
    }),
  ]);

  const lessonsByCourse = new Map<string, number>();
  for (const section of sections) {
    lessonsByCourse.set(
      section.courseId,
      (lessonsByCourse.get(section.courseId) ?? 0) + section._count.lessons
    );
  }
  const assessmentCourses = new Set(assessments.map((row) => row.courseId));
  const surveyCourses = new Set(surveys.map((row) => row.courseId));

  return rows.map((row) => ({
    id: row.id,
    titleAr: row.titleAr,
    status: row.status,
    category: row.category,
    estimatedHours: row.estimatedHours,
    sectionsCount: row._count.sections,
    lessonsCount: lessonsByCourse.get(row.id) ?? 0,
    enrollmentsCount: row._count.enrollments,
    hasAssessment: assessmentCourses.has(row.id),
    hasSurvey: surveyCourses.has(row.id),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  }));
}

/* ------------------- Training workspace: progress ------------------- */

export interface SupervisorTrainingProgressRow {
  userId: string;
  name: string;
  enrolledAt: string;
  completedAt: string | null;
  lessonsDone: number;
  /** null = the training has no (non-archived) final exam. */
  exam: {
    attemptsCount: number;
    needsReviewCount: number;
    bestPercentage: number | null;
    bestPassed: boolean | null;
  } | null;
  certificate: {
    id: string;
    certificateNumber: string;
    status: string;
  } | null;
  /** Identifiable impact response only — anonymous surveys cannot be
   * matched per teacher (aggregate count + results page instead). */
  impactSubmittedAt: string | null;
}

export interface SupervisorTrainingProgress {
  assessmentId: string | null;
  assessmentTitleAr: string | null;
  surveyId: string | null;
  surveyTitleAr: string | null;
  surveyAnonymous: boolean;
  surveyResponsesCount: number;
  lessonsTotal: number;
  rows: SupervisorTrainingProgressRow[];
}

/**
 * Per-teacher participation & results for ONE training — the read model
 * behind the unified workspace's progress section. Reads ONLY existing
 * models: CourseEnrollment, CourseLessonProgress, AssessmentAttempt,
 * Certificate, SurveyResponse. Every query is school/course fenced.
 */
export async function getSupervisorTrainingProgress(
  ctx: SupervisorTrainingContext,
  courseId: string
): Promise<SupervisorResult<SupervisorTrainingProgress>> {
  const course = await courseInScope(ctx, courseId);
  if (!course) {
    return fail("التدريب غير موجود أو خارج نطاق مدرستك", "FORBIDDEN");
  }

  const [enrollments, lessonsTotal, assessment, survey] = await Promise.all([
    listSupervisorEnrollments(ctx, courseId),
    db.courseLesson.count({ where: { section: { courseId } } }),
    db.assessment.findFirst({
      where: { courseId, schoolId: ctx.schoolId, status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, titleAr: true },
    }),
    db.survey.findFirst({
      where: { courseId, schoolId: ctx.schoolId, status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, titleAr: true, anonymous: true },
    }),
  ]);

  const base: SupervisorTrainingProgress = {
    assessmentId: assessment?.id ?? null,
    assessmentTitleAr: assessment?.titleAr ?? null,
    surveyId: survey?.id ?? null,
    surveyTitleAr: survey?.titleAr ?? null,
    surveyAnonymous: survey?.anonymous ?? false,
    surveyResponsesCount: 0,
    lessonsTotal,
    rows: [],
  };

  const userIds = enrollments.map((row) => row.userId);
  if (userIds.length === 0) return { ok: true, data: base };

  const [lessonProgress, attempts, certificates, surveyResponses] =
    await Promise.all([
      db.courseLessonProgress.findMany({
        where: { courseId, userId: { in: userIds } },
        select: { userId: true, lessonId: true },
      }),
      assessment
        ? db.assessmentAttempt.findMany({
            where: {
              assessmentId: assessment.id,
              userId: { in: userIds },
              status: { in: ["NEEDS_REVIEW", "PASSED", "FAILED"] },
            },
            select: {
              userId: true,
              status: true,
              percentage: true,
              passed: true,
            },
          })
        : Promise.resolve(
            [] as Array<{
              userId: string;
              status: string;
              percentage: number | null;
              passed: boolean | null;
            }>
          ),
      db.certificate.findMany({
        where: { courseId, teacherId: { in: userIds } },
        orderBy: { issuedAt: "desc" },
        select: {
          id: true,
          certificateNumber: true,
          status: true,
          teacherId: true,
        },
      }),
      survey
        ? db.surveyResponse.findMany({
            where: {
              surveyId: survey.id,
              status: "SUBMITTED",
              ...(survey.anonymous
                ? {}
                : { respondentId: { in: userIds } }),
            },
            select: { respondentId: true, submittedAt: true },
          })
        : Promise.resolve(
            [] as Array<{ respondentId: string | null; submittedAt: Date | null }>
          ),
    ]);

  const lessonsDoneByUser = new Map<string, number>();
  for (const row of lessonProgress) {
    lessonsDoneByUser.set(row.userId, (lessonsDoneByUser.get(row.userId) ?? 0) + 1);
  }

  const examByUser = new Map<
    string,
    { attemptsCount: number; needsReviewCount: number; bestPercentage: number | null; bestPassed: boolean | null }
  >();
  for (const attempt of attempts) {
    const current = examByUser.get(attempt.userId) ?? {
      attemptsCount: 0,
      needsReviewCount: 0,
      bestPercentage: null,
      bestPassed: null,
    };
    current.attemptsCount += 1;
    if (attempt.status === "NEEDS_REVIEW") current.needsReviewCount += 1;
    if (
      (attempt.status === "PASSED" || attempt.status === "FAILED") &&
      typeof attempt.percentage === "number"
    ) {
      if (
        current.bestPercentage === null ||
        attempt.percentage > current.bestPercentage
      ) {
        current.bestPercentage = attempt.percentage;
        current.bestPassed = attempt.status === "PASSED";
      }
    }
    examByUser.set(attempt.userId, current);
  }

  const certificateByUser = new Map(
    certificates.map((row) => [row.teacherId, row])
  );

  const impactByUser = new Map<string, string>();
  let impactCount = 0;
  for (const response of surveyResponses) {
    impactCount += 1;
    if (response.respondentId && response.submittedAt) {
      impactByUser.set(response.respondentId, response.submittedAt.toISOString());
    }
  }

  return {
    ok: true,
    data: {
      ...base,
      surveyResponsesCount: impactCount,
      rows: enrollments.map((enrollment) => {
        const exam = examByUser.get(enrollment.userId) ?? null;
        const certificate = certificateByUser.get(enrollment.userId) ?? null;
        return {
          userId: enrollment.userId,
          name: enrollment.name,
          enrolledAt: enrollment.enrolledAt.toISOString(),
          completedAt: enrollment.completedAt
            ? enrollment.completedAt.toISOString()
            : null,
          lessonsDone: lessonsDoneByUser.get(enrollment.userId) ?? 0,
          exam: exam
            ? {
                attemptsCount: exam.attemptsCount,
                needsReviewCount: exam.needsReviewCount,
                bestPercentage: exam.bestPercentage,
                bestPassed: exam.bestPassed,
              }
            : null,
          certificate: certificate
            ? {
                id: certificate.id,
                certificateNumber: certificate.certificateNumber,
                status: certificate.status,
              }
            : null,
          impactSubmittedAt: impactByUser.get(enrollment.userId) ?? null,
        };
      }),
    },
  };
}
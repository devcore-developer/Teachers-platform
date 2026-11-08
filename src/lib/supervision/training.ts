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
): Promise<{ id: string; schoolId: string | null; status: string } | null> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, schoolId: true, status: true },
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
import { Prisma } from "@prisma/client";

import type { AdminContext } from "@/lib/auth/dev-admin";
import { trainingScopeError } from "@/lib/training/access";
import { getStorage, buildStorageKey } from "@/lib/storage";
import { db } from "@/lib/db";
import {
  createLessonSchema,
  createSectionSchema,
  moveLessonSchema,
  moveSectionSchema,
  updateLessonSchema,
  updateSectionSchema,
  validateUpload,
  zodFieldErrors,
  type TrainingErrorCode,
  type TrainingResult,
} from "@/lib/validation/training";

/* ------------------------------------------------------------------ */
/* Phase 5 — course content: sections, lessons, attachments.            */
/*                                                                      */
/* Every mutation resolves the actor from the session-backed context    */
/* and re-validates: section ∈ course, lesson ∈ section, attachment     */
/* ∈ course. Uploads go through validateUpload() and the storage        */
/* adapter — bytes are never stored in the database.                    */
/* ------------------------------------------------------------------ */

function fail<T>(
  message: string,
  code?: TrainingErrorCode,
  fieldErrors?: Record<string, string>
): TrainingResult<T> {
  return { ok: false, message, code, fieldErrors };
}

function validationFail<T>(error: { issues: unknown[] }): TrainingResult<T> {
  const fieldErrors = zodFieldErrors(error as never);
  return {
    ok: false,
    message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
    fieldErrors,
    code: "VALIDATION_ERROR",
  };
}

/** Defense-in-depth guard shared with the service file. */
function managerGuard(ctx: AdminContext): TrainingResult<never> | null {
  if (ctx.role !== "SUPER_ADMIN" && ctx.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return {
      ok: false,
      message: "إدارة المحتوى التدريبي متاحة لمدير المنصة ومديري مكاتب التطوير فقط",
      code: "FORBIDDEN",
    };
  }
  return null;
}

/** Load a course and enforce the actor's manage scope over it. */
async function scopedCourse(
  ctx: AdminContext,
  courseId: string
): Promise<TrainingResult<{ id: string; schoolId: string | null }>> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, schoolId: true },
  });
  if (!course) return fail("الدورة غير موجودة", "NOT_FOUND");
  const scopeCheck = trainingScopeError(ctx, course.schoolId);
  if (scopeCheck) return scopeCheck;
  return { ok: true, data: course };
}

/* ------------------------------------------------------------------ */
/* Sections                                                             */
/* ------------------------------------------------------------------ */

export async function createSection(
  raw: unknown,
  ctx: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = createSectionSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const course = await scopedCourse(ctx, input.courseId);
  if (!course.ok) return course;

  const count = await db.courseSection.count({ where: { courseId: course.data.id } });
  const section = await db.courseSection.create({
    data: {
      courseId: course.data.id,
      titleAr: input.titleAr,
      description: input.description ?? null,
      orderIndex: count,
    },
    select: { id: true },
  });
  return { ok: true, data: section };
}

export async function updateSection(
  raw: unknown,
  ctx: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = updateSectionSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const course = await scopedCourse(ctx, input.courseId);
  if (!course.ok) return course;

  const section = await db.courseSection.findUnique({
    where: { id: input.sectionId },
  });
  if (!section || section.courseId !== course.data.id) {
    return fail("القسم غير موجود أو لا ينتمي إلى هذه الدورة", "NOT_FOUND");
  }

  const updated = await db.courseSection.update({
    where: { id: section.id },
    data: { titleAr: input.titleAr, description: input.description ?? null },
    select: { id: true },
  });
  return { ok: true, data: updated };
}

export async function deleteSection(
  courseId: string,
  sectionId: string,
  ctx: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const course = await scopedCourse(ctx, courseId);
  if (!course.ok) return course;

  const section = await db.courseSection.findUnique({
    where: { id: sectionId },
  });
  if (!section || section.courseId !== course.data.id) {
    return fail("القسم غير موجود أو لا ينتمي إلى هذه الدورة", "NOT_FOUND");
  }

  // Collect attachment storage keys BEFORE deletion so the files can be
  // removed from the storage backend as well.
  const lessons = await db.courseLesson.findMany({
    where: { sectionId: section.id },
    select: { id: true, attachmentId: true },
  });
  const lessonIds = lessons.map((lesson) => lesson.id);
  const attachmentRows = await db.attachment.findMany({
    where: {
      OR: [
        { lessonId: { in: lessonIds } },
        { id: { in: lessons.map((l) => l.attachmentId).filter((v): v is string => Boolean(v)) } },
      ],
    },
    select: { id: true, storageKey: true },
  });

  await db.attachment.deleteMany({
    where: { id: { in: attachmentRows.map((row) => row.id) } },
  });
  await db.courseSection.delete({ where: { id: section.id } });

  const storage = getStorage();
  await Promise.all(attachmentRows.map((row) => storage.delete(row.storageKey)));

  return { ok: true, data: { id: section.id } };
}

export async function moveSection(
  raw: unknown,
  ctx: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = moveSectionSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const course = await scopedCourse(ctx, input.courseId);
  if (!course.ok) return course;

  const sections = await db.courseSection.findMany({
    where: { courseId: course.data.id },
    orderBy: { orderIndex: "asc" },
    select: { id: true },
  });
  const index = sections.findIndex((section) => section.id === input.sectionId);
  if (index === -1) {
    return fail("القسم غير موجود أو لا ينتمي إلى هذه الدورة", "NOT_FOUND");
  }
  const targetIndex = input.direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= sections.length) {
    return { ok: true, data: { id: input.sectionId } }; // already at the edge
  }

  const current = sections[index];
  const neighbor = sections[targetIndex];
  await db.$transaction([
    db.courseSection.update({
      where: { id: current.id },
      data: { orderIndex: targetIndex },
    }),
    db.courseSection.update({
      where: { id: neighbor.id },
      data: { orderIndex: index },
    }),
  ]);
  return { ok: true, data: { id: current.id } };
}

/* ------------------------------------------------------------------ */
/* Lessons                                                              */
/* ------------------------------------------------------------------ */

/** Shared attachment validation for VIDEO / RESOURCE lessons. */
async function validateLessonAttachment(
  courseId: string,
  attachmentId: string | undefined
): Promise<TrainingResult<never> | null> {
  if (!attachmentId) return null;
  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    select: { courseId: true },
  });
  if (!attachment || attachment.courseId !== courseId) {
    return fail(
      "الملف المرفق غير موجود أو لا ينتمي إلى هذه الدورة",
      "RELATION_ERROR"
    );
  }
  return null;
}

export async function createLesson(
  raw: unknown,
  ctx: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = createLessonSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const course = await scopedCourse(ctx, input.courseId);
  if (!course.ok) return course;

  const section = await db.courseSection.findUnique({
    where: { id: input.sectionId },
  });
  if (!section || section.courseId !== course.data.id) {
    return fail("القسم غير موجود أو لا ينتمي إلى هذه الدورة", "RELATION_ERROR");
  }

  const relationError = await validateLessonAttachment(
    course.data.id,
    input.attachmentId
  );
  if (relationError) return relationError;

  const count = await db.courseLesson.count({ where: { sectionId: section.id } });
  try {
    const lesson = await db.courseLesson.create({
      data: {
        sectionId: section.id,
        titleAr: input.titleAr,
        description: input.description ?? null,
        type: input.type,
        content: input.type === "TEXT" ? (input.content ?? null) : null,
        videoUrl:
          input.type === "EXTERNAL_VIDEO" ? (input.videoUrl ?? null) : null,
        attachmentId:
          input.type === "VIDEO" || input.type === "RESOURCE"
            ? (input.attachmentId ?? null)
            : null,
        orderIndex: count,
        isPublished: input.isPublished,
      },
      select: { id: true },
    });
    return { ok: true, data: lesson };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return fail("الملف المرفق مرتبط بدرس آخر بالفعل", "RELATION_ERROR");
    }
    return fail("تعذر إنشاء الدرس — حدث خطأ غير متوقع");
  }
}

export async function updateLesson(
  raw: unknown,
  ctx: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = updateLessonSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const course = await scopedCourse(ctx, input.courseId);
  if (!course.ok) return course;

  const lesson = await db.courseLesson.findUnique({
    where: { id: input.lessonId },
    include: { section: { select: { id: true, courseId: true } } },
  });
  if (!lesson || lesson.section.courseId !== course.data.id) {
    return fail("الدرس غير موجود أو لا ينتمي إلى هذه الدورة", "NOT_FOUND");
  }

  const relationError = await validateLessonAttachment(
    course.data.id,
    input.attachmentId
  );
  if (relationError) return relationError;

  try {
    const updated = await db.courseLesson.update({
      where: { id: lesson.id },
      data: {
        titleAr: input.titleAr,
        description: input.description ?? null,
        type: input.type,
        content: input.type === "TEXT" ? (input.content ?? null) : null,
        videoUrl:
          input.type === "EXTERNAL_VIDEO" ? (input.videoUrl ?? null) : null,
        attachmentId:
          input.type === "VIDEO" || input.type === "RESOURCE"
            ? (input.attachmentId ?? null)
            : null,
        isPublished: input.isPublished,
      },
      select: { id: true },
    });
    return { ok: true, data: updated };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return fail("الملف المرفق مرتبط بدرس آخر بالفعل", "RELATION_ERROR");
    }
    return fail("تعذر تحديث الدرس — حدث خطأ غير متوقع");
  }
}

export async function deleteLesson(
  courseId: string,
  lessonId: string,
  ctx: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const course = await scopedCourse(ctx, courseId);
  if (!course.ok) return course;

  const lesson = await db.courseLesson.findUnique({
    where: { id: lessonId },
    include: { section: { select: { courseId: true } } },
  });
  if (!lesson || lesson.section.courseId !== course.data.id) {
    return fail("الدرس غير موجود أو لا ينتمي إلى هذه الدورة", "NOT_FOUND");
  }

  const attachmentRows = await db.attachment.findMany({
    where: {
      OR: [
        { lessonId: lesson.id },
        ...(lesson.attachmentId ? [{ id: lesson.attachmentId }] : []),
      ],
    },
    select: { id: true, storageKey: true },
  });

  await db.attachment.deleteMany({
    where: { id: { in: attachmentRows.map((row) => row.id) } },
  });
  await db.courseLesson.delete({ where: { id: lesson.id } });

  const storage = getStorage();
  await Promise.all(attachmentRows.map((row) => storage.delete(row.storageKey)));

  return { ok: true, data: { id: lesson.id } };
}

export async function moveLesson(
  raw: unknown,
  ctx: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = moveLessonSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const course = await scopedCourse(ctx, input.courseId);
  if (!course.ok) return course;

  const lesson = await db.courseLesson.findUnique({
    where: { id: input.lessonId },
    include: { section: { select: { id: true, courseId: true } } },
  });
  if (!lesson || lesson.section.courseId !== course.data.id) {
    return fail("الدرس غير موجود أو لا ينتمي إلى هذه الدورة", "NOT_FOUND");
  }

  const siblings = await db.courseLesson.findMany({
    where: { sectionId: lesson.sectionId },
    orderBy: { orderIndex: "asc" },
    select: { id: true },
  });
  const index = siblings.findIndex((item) => item.id === lesson.id);
  const targetIndex = input.direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) {
    return { ok: true, data: { id: lesson.id } };
  }

  const neighbor = siblings[targetIndex];
  await db.$transaction([
    db.courseLesson.update({
      where: { id: lesson.id },
      data: { orderIndex: targetIndex },
    }),
    db.courseLesson.update({
      where: { id: neighbor.id },
      data: { orderIndex: index },
    }),
  ]);
  return { ok: true, data: { id: lesson.id } };
}

/* ------------------------------------------------------------------ */
/* Attachments (covers, lesson resources, uploaded videos)              */
/* ------------------------------------------------------------------ */

export interface UploadAttachmentInput {
  /** COVER for course/program covers; RESOURCE for lesson files; VIDEO for uploaded lesson videos. */
  kind: "COVER" | "RESOURCE" | "VIDEO";
  courseId?: string;
  programId?: string;
  lessonId?: string;
  file: File;
}

export async function uploadAttachment(
  input: UploadAttachmentInput,
  ctx: AdminContext
): Promise<
  TrainingResult<{ id: string; originalName: string; mimeType: string; sizeBytes: number }>
> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  // 1) Server-side type & size enforcement.
  const check = validateUpload({
    kind: input.kind,
    fileName: input.file.name,
    mimeType: input.file.type || "application/octet-stream",
    sizeBytes: input.file.size,
  });
  if (!check.ok) return fail(check.message, "INVALID_FILE");

  let courseId: string | null = null;
  let programId: string | null = null;
  let lessonId: string | null = null;

  if (input.kind === "COVER" && input.programId) {
    const program = await db.trainingProgram.findUnique({
      where: { id: input.programId },
      select: { id: true, schoolId: true, coverAttachmentId: true },
    });
    if (!program) return fail("البرنامج غير موجود", "NOT_FOUND");
    const scopeCheck = trainingScopeError(ctx, program.schoolId);
    if (scopeCheck) return scopeCheck;
    programId = program.id;

    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const stored = await getStorage().put(
      buildStorageKey("programs", input.file.name),
      bytes
    );
    const oldCoverId = program.coverAttachmentId;
    const attachment = await db.attachment.create({
      data: {
        originalName: input.file.name,
        storageKey: stored.storageKey,
        mimeType: input.file.type,
        sizeBytes: stored.sizeBytes,
        kind: "COVER",
        programId,
        uploadedById: ctx.id,
      },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true },
    });
    await db.trainingProgram.update({
      where: { id: program.id },
      data: { coverAttachmentId: attachment.id },
    });
    if (oldCoverId) await removeAttachmentRows([oldCoverId]);
    return { ok: true, data: attachment };
  }

  if (!input.courseId) {
    return fail("معرّف الدورة أو البرنامج مطلوب", "VALIDATION_ERROR");
  }

  const course = await scopedCourse(ctx, input.courseId);
  if (!course.ok) return course;
  courseId = course.data.id;

  if (input.lessonId) {
    const lesson = await db.courseLesson.findUnique({
      where: { id: input.lessonId },
      include: { section: { select: { courseId: true } } },
    });
    if (!lesson || lesson.section.courseId !== courseId) {
      return fail("الدرس غير موجود أو لا ينتمي إلى هذه الدورة", "RELATION_ERROR");
    }
    lessonId = lesson.id;
  }

  // 2) Real storage write — server-generated safe key.
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const stored = await getStorage().put(
    buildStorageKey("courses", input.file.name),
    bytes
  );

  // 3) Metadata row. Uploaded lesson videos are stored as RESOURCE kind
  //    attachments bound to the lesson; the lesson references them via
  //    attachmentId (set when the lesson is saved).
  const attachment = await db.attachment.create({
    data: {
      originalName: input.file.name,
      storageKey: stored.storageKey,
      mimeType: input.file.type,
      sizeBytes: stored.sizeBytes,
      kind: input.kind === "COVER" ? "COVER" : "RESOURCE",
      courseId,
      lessonId,
      uploadedById: ctx.id,
    },
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true },
  });

  if (input.kind === "COVER") {
    const old = await db.course.findUnique({
      where: { id: courseId },
      select: { coverAttachmentId: true },
    });
    await db.course.update({
      where: { id: courseId },
      data: { coverAttachmentId: attachment.id },
    });
    if (old?.coverAttachmentId) {
      await removeAttachmentRows([old.coverAttachmentId]);
    }
  }

  return { ok: true, data: attachment };
}

export async function deleteAttachment(
  attachmentId: string,
  ctx: AdminContext
): Promise<TrainingResult<{ id: string }>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, courseId: true, programId: true },
  });
  if (!attachment) return fail("المرفق غير موجود", "NOT_FOUND");

  if (attachment.courseId) {
    const course = await scopedCourse(ctx, attachment.courseId);
    if (!course.ok) return course;
  } else if (attachment.programId) {
    const program = await db.trainingProgram.findUnique({
      where: { id: attachment.programId },
      select: { schoolId: true },
    });
    if (!program) return fail("البرنامج غير موجود", "NOT_FOUND");
    const scopeCheck = trainingScopeError(ctx, program.schoolId);
    if (scopeCheck) return scopeCheck;
  } else {
    return fail("المرفق غير مرتبط بمحتوى معروف", "NOT_FOUND");
  }

  await removeAttachmentRows([attachment.id]);
  return { ok: true, data: { id: attachment.id } };
}

/** Delete attachment rows then their files from the storage backend. */
async function removeAttachmentRows(attachmentIds: string[]): Promise<void> {
  if (attachmentIds.length === 0) return;
  const rows = await db.attachment.findMany({
    where: { id: { in: attachmentIds } },
    select: { id: true, storageKey: true },
  });
  if (rows.length === 0) return;
  await db.attachment.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  const storage = getStorage();
  await Promise.all(rows.map((row) => storage.delete(row.storageKey)));
}

/** Route-handler helper: attachment + owning record for access checks. */
export async function getAttachmentForAccess(attachmentId: string): Promise<{
  id: string;
  originalName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  courseId: string | null;
  programId: string | null;
  course: { status: string; schoolId: string | null } | null;
  program: { status: string; schoolId: string | null } | null;
} | null> {
  return db.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      originalName: true,
      storageKey: true,
      mimeType: true,
      sizeBytes: true,
      courseId: true,
      programId: true,
      course: { select: { status: true, schoolId: true } },
      program: { select: { status: true, schoolId: true } },
    },
  });
}
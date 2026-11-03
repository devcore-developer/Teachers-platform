"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminContext } from "@/lib/auth/dev-admin";
import { requireUser } from "@/lib/auth/session";
import {
  createLesson,
  createSection,
  deleteAttachment,
  deleteLesson,
  deleteSection,
  moveLesson,
  moveSection,
  updateLesson,
  updateSection,
  uploadAttachment,
} from "@/lib/training/content";
import {
  createCourse,
  createProgram,
  enrollTeacher,
  setCourseStatus,
  setProgramStatus,
  updateCourse,
  updateProgram,
} from "@/lib/training/service";

/* ------------------------------------------------------------------ */
/* Phase 5 server actions — thin wrappers. Authorization lives in the   */
/* service layer (access.ts + service.ts + content.ts); these extract   */
/* input, call the service and refresh affected pages. Nothing          */
/* security-relevant happens on the client.                             */
/* ------------------------------------------------------------------ */

export interface TrainingFormState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Returned by upload actions so the client can link the attachment. */
  attachmentId?: string;
  attachmentName?: string;
  courseId?: string;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

/** Select placeholders submit the sentinel "none" — map it to empty. */
function formValue(formData: FormData, key: string): string {
  const raw = str(formData, key);
  return raw === "none" ? "" : raw;
}

function checkbox(formData: FormData, key: string): boolean {
  const raw = formData.get(key);
  return raw === "on" || raw === "true" || raw === "1";
}

/** Extract a File entry (uploads) or null. */
function fileEntry(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function refreshTraining(courseId?: string) {
  revalidatePath("/");
  revalidatePath("/academy");
  revalidatePath("/academy/manage");
  revalidatePath("/academy/programs");
  if (courseId) {
    revalidatePath(`/academy/manage/${courseId}`);
    revalidatePath(`/academy/courses/${courseId}`);
  }
}

/* ------------------------------ Programs --------------------------- */

export async function createProgramAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const result = await createProgram(
    {
      nameAr: str(formData, "nameAr"),
      nameEn: formValue(formData, "nameEn"),
      descriptionAr: str(formData, "descriptionAr"),
      descriptionEn: formValue(formData, "descriptionEn"),
      category: formValue(formData, "category"),
      scope: formValue(formData, "scope") || "school",
      schoolId: formValue(formData, "schoolId"),
    },
    ctx
  );
  if (result.ok) {
    refreshTraining();
    return { ok: true, message: "تم إنشاء البرنامج بنجاح — يبدأ كمسودة" };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function updateProgramAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const result = await updateProgram(
    {
      programId: str(formData, "programId"),
      nameAr: str(formData, "nameAr"),
      nameEn: formValue(formData, "nameEn"),
      descriptionAr: str(formData, "descriptionAr"),
      descriptionEn: formValue(formData, "descriptionEn"),
      category: formValue(formData, "category"),
      scope: formValue(formData, "scope") || "school",
      schoolId: formValue(formData, "schoolId"),
    },
    ctx
  );
  if (result.ok) {
    refreshTraining();
    return { ok: true, message: "تم حفظ تعديلات البرنامج" };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function setProgramStatusAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminContext();
  await setProgramStatus(
    { programId: str(formData, "programId"), status: str(formData, "status") },
    ctx
  );
  refreshTraining();
}

/* ------------------------------ Courses ---------------------------- */

export async function createCourseAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const result = await createCourse(
    {
      titleAr: str(formData, "titleAr"),
      titleEn: formValue(formData, "titleEn"),
      descriptionAr: str(formData, "descriptionAr"),
      descriptionEn: formValue(formData, "descriptionEn"),
      category: formValue(formData, "category"),
      programId: formValue(formData, "programId"),
      level: formValue(formData, "level") || undefined,
      estimatedHours: formValue(formData, "estimatedHours"),
      instructorId: formValue(formData, "instructorId"),
      scope: formValue(formData, "scope") || "school",
      schoolId: formValue(formData, "schoolId"),
    },
    ctx
  );
  if (result.ok) {
    refreshTraining(result.data.id);
    // Redirect to the content builder — cover upload happens there.
    redirect(`/academy/manage/${result.data.id}`);
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function updateCourseAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const result = await updateCourse(
    {
      courseId: str(formData, "courseId"),
      titleAr: str(formData, "titleAr"),
      titleEn: formValue(formData, "titleEn"),
      descriptionAr: str(formData, "descriptionAr"),
      descriptionEn: formValue(formData, "descriptionEn"),
      category: formValue(formData, "category"),
      programId: formValue(formData, "programId"),
      level: formValue(formData, "level") || undefined,
      estimatedHours: formValue(formData, "estimatedHours"),
      instructorId: formValue(formData, "instructorId"),
      scope: formValue(formData, "scope") || "school",
      schoolId: formValue(formData, "schoolId"),
    },
    ctx
  );
  if (result.ok) {
    refreshTraining(result.data.id);
    return { ok: true, message: "تم حفظ بيانات الدورة" };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function setCourseStatusAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const courseId = str(formData, "courseId");
  const result = await setCourseStatus(
    { courseId, status: str(formData, "status") },
    ctx
  );
  if (result.ok) {
    refreshTraining(courseId);
    const status = result.data.status;
    return {
      ok: true,
      message:
        status === "PUBLISHED"
          ? "تم نشر الدورة — أصبحت متاحة لجمهورها المصرح له"
          : status === "ARCHIVED"
            ? "تمت أرشفة الدورة — لم تعد ضمن التدريب المتاح"
            : "تم تحويل الدورة إلى مسودة",
    };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

/* ------------------------------ Uploads ---------------------------- */

export async function uploadCourseCoverAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const file = fileEntry(formData, "file");
  if (!file) {
    return { ok: false, message: "اختر ملف صورة الغلاف أولًا" };
  }
  const ownerType = str(formData, "ownerType");
  const result = await uploadAttachment(
    ownerType === "program"
      ? { kind: "COVER", programId: str(formData, "ownerId"), file }
      : { kind: "COVER", courseId: str(formData, "ownerId"), file },
    ctx
  );
  if (result.ok) {
    refreshTraining(ownerType === "course" ? str(formData, "ownerId") : undefined);
    revalidatePath("/academy/programs");
    return { ok: true, message: "تم رفع صورة الغلاف", attachmentId: result.data.id };
  }
  return { ok: false, message: result.message };
}

export async function uploadLessonFileAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const file = fileEntry(formData, "file");
  if (!file) {
    return { ok: false, message: "اختر الملف أولًا" };
  }
  const kind = str(formData, "kind") === "VIDEO" ? "VIDEO" : "RESOURCE";
  const result = await uploadAttachment(
    {
      kind,
      courseId: str(formData, "courseId"),
      lessonId: formValue(formData, "lessonId") || undefined,
      file,
    },
    ctx
  );
  if (result.ok) {
    refreshTraining(str(formData, "courseId"));
    return {
      ok: true,
      message: "تم رفع الملف بنجاح",
      attachmentId: result.data.id,
      attachmentName: result.data.originalName,
    };
  }
  return { ok: false, message: result.message };
}

export async function deleteAttachmentAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const result = await deleteAttachment(str(formData, "attachmentId"), ctx);
  if (result.ok) {
    refreshTraining(formValue(formData, "courseId") || undefined);
    return { ok: true, message: "تم حذف الملف" };
  }
  return { ok: false, message: result.message };
}

/* ------------------------------ Sections --------------------------- */

export async function createSectionAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const courseId = str(formData, "courseId");
  const result = await createSection(
    {
      courseId,
      titleAr: str(formData, "titleAr"),
      description: formValue(formData, "description"),
    },
    ctx
  );
  if (result.ok) {
    refreshTraining(courseId);
    return { ok: true, message: "تم إضافة القسم" };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function updateSectionAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const courseId = str(formData, "courseId");
  const result = await updateSection(
    {
      courseId,
      sectionId: str(formData, "sectionId"),
      titleAr: str(formData, "titleAr"),
      description: formValue(formData, "description"),
    },
    ctx
  );
  if (result.ok) {
    refreshTraining(courseId);
    return { ok: true, message: "تم حفظ القسم" };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function deleteSectionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminContext();
  const courseId = str(formData, "courseId");
  await deleteSection(courseId, str(formData, "sectionId"), ctx);
  refreshTraining(courseId);
}

export async function moveSectionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminContext();
  const courseId = str(formData, "courseId");
  await moveSection(
    {
      courseId,
      sectionId: str(formData, "sectionId"),
      direction: str(formData, "direction") === "up" ? "up" : "down",
    },
    ctx
  );
  refreshTraining(courseId);
}

/* ------------------------------ Lessons ---------------------------- */

export async function createLessonAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const courseId = str(formData, "courseId");
  const result = await createLesson(
    {
      courseId,
      sectionId: str(formData, "sectionId"),
      titleAr: str(formData, "titleAr"),
      description: formValue(formData, "description"),
      type: str(formData, "type"),
      content: formData.get("content") === null ? undefined : str(formData, "content"),
      videoUrl: formValue(formData, "videoUrl") || undefined,
      attachmentId: formValue(formData, "attachmentId") || undefined,
      isPublished: checkbox(formData, "isPublished"),
    },
    ctx
  );
  if (result.ok) {
    refreshTraining(courseId);
    return { ok: true, message: "تم إضافة الدرس" };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function updateLessonAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const ctx = await requireAdminContext();
  const courseId = str(formData, "courseId");
  const result = await updateLesson(
    {
      courseId,
      lessonId: str(formData, "lessonId"),
      sectionId: str(formData, "sectionId"),
      titleAr: str(formData, "titleAr"),
      description: formValue(formData, "description"),
      type: str(formData, "type"),
      content: formData.get("content") === null ? undefined : str(formData, "content"),
      videoUrl: formValue(formData, "videoUrl") || undefined,
      attachmentId: formValue(formData, "attachmentId") || undefined,
      isPublished: checkbox(formData, "isPublished"),
    },
    ctx
  );
  if (result.ok) {
    refreshTraining(courseId);
    return { ok: true, message: "تم حفظ الدرس" };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function deleteLessonAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminContext();
  const courseId = str(formData, "courseId");
  await deleteLesson(courseId, str(formData, "lessonId"), ctx);
  refreshTraining(courseId);
}

export async function moveLessonAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminContext();
  const courseId = str(formData, "courseId");
  await moveLesson(
    {
      courseId,
      lessonId: str(formData, "lessonId"),
      direction: str(formData, "direction") === "up" ? "up" : "down",
    },
    ctx
  );
  refreshTraining(courseId);
}

/* ---------------------------- Enrollment --------------------------- */

export async function enrollAction(
  _prev: TrainingFormState | null,
  formData: FormData
): Promise<TrainingFormState> {
  const user = await requireUser();
  const result = await enrollTeacher(
    { id: user.id, role: user.role, schoolId: user.schoolId },
    { courseId: str(formData, "courseId") }
  );
  if (result.ok) {
    revalidatePath("/academy");
    revalidatePath(`/academy/courses/${str(formData, "courseId")}`);
    return {
      ok: true,
      message: result.data.alreadyEnrolled
        ? "أنت مسجّل في هذه الدورة بالفعل"
        : "تم تسجيلك في الدورة — يمكنك البدء الآن",
    };
  }
  return { ok: false, message: result.message };
}
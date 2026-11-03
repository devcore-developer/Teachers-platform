"use server";

/**
 * Phase 7 — thin "use server" wrappers around the assignment service.
 *
 * Every wrapper resolves the actor from the SESSION (never from the
 * payload): the current user is narrowed to an explicit role literal
 * before it is passed on as an AssignmentActor. The service
 * re-validates role/tenant/scope again on its own — these wrappers
 * only adapt FormData payloads and trigger revalidation.
 */
import { revalidatePath } from "next/cache";

import type { AssignmentActor, ViewerIdentity } from "@/lib/assignments/access";
import {
  createAssignment,
  deleteSubmissionFile,
  gradeSubmission,
  markUnderReview,
  returnSubmission,
  saveRubric,
  saveSubmissionDraft,
  setAssignmentStatus,
  submitSubmission,
  updateAssignment,
  uploadSubmissionFile,
} from "@/lib/assignments/service";
import { getCurrentUser } from "@/lib/auth/session";

/* ------------------------------------------------------------------ */
/* Serializable action state (no Dates crosses the RSC boundary)        */
/* ------------------------------------------------------------------ */

export interface FormActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  code?: string;
  data?: {
    id?: string;
    status?: string;
    isLate?: boolean;
    scoreTotal?: number;
    fileId?: string;
    totalPoints?: number;
  };
}

function failure(
  message: string,
  code: string,
  fieldErrors?: Record<string, string>
): FormActionState {
  return { ok: false, message, code, fieldErrors };
}

/* ------------------------------------------------------------------ */
/* FormData helpers                                                     */
/* ------------------------------------------------------------------ */

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function strArray(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === "string")
    .filter((value) => value.trim() !== "");
}

function parseJsonField<T>(raw: string): { ok: true; value: T } | { ok: false } {
  if (!raw.trim()) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false };
  }
}

async function teacherViewer(): Promise<ViewerIdentity | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, role: user.role, schoolId: user.schoolId };
}

/**
 * Office-manager actor for assignment management actions. Built ONLY
 * from the session user after an explicit role check — client payloads
 * can never widen it.
 */
async function managerActor(): Promise<AssignmentActor | null> {
  const user = await getCurrentUser();
  if (!user || user.role !== "DEVELOPMENT_OFFICE_MANAGER" || !user.schoolId) {
    return null;
  }
  return { id: user.id, role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: user.schoolId };
}

/**
 * Review actor (office manager = whole school, supervisor = own
 * assigned teachers — the narrowing itself happens in the service).
 */
async function reviewActor(): Promise<AssignmentActor | null> {
  const user = await getCurrentUser();
  if (!user || !user.schoolId) return null;
  if (user.role === "DEVELOPMENT_OFFICE_MANAGER") {
    return { id: user.id, role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: user.schoolId };
  }
  if (user.role === "EDUCATIONAL_SUPERVISOR") {
    return { id: user.id, role: "EDUCATIONAL_SUPERVISOR", schoolId: user.schoolId };
  }
  return null;
}

function revalidateAssignment(assignmentId: string): void {
  revalidatePath("/assignments");
  revalidatePath(`/assignments/${assignmentId}`);
  revalidatePath("/assignments/overview");
  revalidatePath("/my-assignments");
  revalidatePath(`/my-assignments/${assignmentId}`);
}

/* ------------------------------------------------------------------ */
/* Office — assignment management                                       */
/* ------------------------------------------------------------------ */

export async function createAssignmentAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const ctx = await managerActor();
    if (!ctx) {
      return failure("إدارة التكليفات متاحة لمديري مكاتب التطوير فقط", "FORBIDDEN");
    }
    const result = await createAssignment(
      {
        titleAr: str(formData, "titleAr"),
        titleEn: str(formData, "titleEn"),
        descriptionAr: str(formData, "descriptionAr"),
        descriptionEn: str(formData, "descriptionEn"),
        programId: str(formData, "programId"),
        courseId: str(formData, "courseId"),
        sectionId: str(formData, "sectionId"),
        lessonId: str(formData, "lessonId"),
        audienceMode: str(formData, "audienceMode") || "ALL_TEACHERS",
        teacherIds: strArray(formData, "teacherIds"),
        branchIds: strArray(formData, "branchIds"),
        dueAt: str(formData, "dueAt"),
        allowLate: str(formData, "allowLate"),
        lateUntil: str(formData, "lateUntil"),
      },
      ctx
    );
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidatePath("/assignments");
    return { ok: true, data: { id: result.data.id } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function updateAssignmentAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const assignmentId = str(formData, "assignmentId");
    const ctx = await managerActor();
    if (!ctx) {
      return failure("إدارة التكليفات متاحة لمديري مكاتب التطوير فقط", "FORBIDDEN");
    }
    const result = await updateAssignment(
      {
        assignmentId,
        titleAr: str(formData, "titleAr"),
        titleEn: str(formData, "titleEn"),
        descriptionAr: str(formData, "descriptionAr"),
        descriptionEn: str(formData, "descriptionEn"),
        programId: str(formData, "programId"),
        courseId: str(formData, "courseId"),
        sectionId: str(formData, "sectionId"),
        lessonId: str(formData, "lessonId"),
        audienceMode: str(formData, "audienceMode") || "ALL_TEACHERS",
        teacherIds: strArray(formData, "teacherIds"),
        branchIds: strArray(formData, "branchIds"),
        dueAt: str(formData, "dueAt"),
        allowLate: str(formData, "allowLate"),
        lateUntil: str(formData, "lateUntil"),
      },
      ctx
    );
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateAssignment(assignmentId);
    return { ok: true, data: { id: result.data.id } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function setAssignmentStatusAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const ctx = await managerActor();
    if (!ctx) {
      return failure("إدارة التكليفات متاحة لمديري مكاتب التطوير فقط", "FORBIDDEN");
    }
    const result = await setAssignmentStatus(
      {
        assignmentId: str(formData, "assignmentId"),
        status: str(formData, "status"),
      },
      ctx
    );
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateAssignment(str(formData, "assignmentId"));
    return { ok: true, data: { id: result.data.id, status: result.data.status } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

interface RubricCriterionPayload {
  titleAr?: unknown;
  maxPoints?: unknown;
}

export async function saveRubricAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const parsed = parseJsonField<RubricCriterionPayload[]>(
      str(formData, "criteriaJson")
    );
    if (!parsed.ok) {
      return failure("بيانات سلّم التقييم غير صالحة", "VALIDATION_ERROR");
    }
    const criteria = parsed.value
      .filter(
        (item): item is { titleAr: string; maxPoints: number } =>
          typeof item?.titleAr === "string" && typeof item?.maxPoints === "number"
      )
      .map((item) => ({ titleAr: item.titleAr, maxPoints: item.maxPoints }));

    const ctx = await managerActor();
    if (!ctx) {
      return failure("إدارة التكليفات متاحة لمديري مكاتب التطوير فقط", "FORBIDDEN");
    }
    const result = await saveRubric(
      {
        assignmentId: str(formData, "assignmentId"),
        criteria,
      },
      ctx
    );
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateAssignment(str(formData, "assignmentId"));
    return {
      ok: true,
      data: { id: result.data.id, totalPoints: result.data.totalPoints },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/* ------------------------------------------------------------------ */
/* Teacher — submission lifecycle                                       */
/* ------------------------------------------------------------------ */

export async function saveSubmissionDraftAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const viewer = await teacherViewer();
    if (!viewer) return failure("الجلسة منتهية — سجّل الدخول من جديد", "FORBIDDEN");
    const assignmentId = str(formData, "assignmentId");
    const result = await saveSubmissionDraft(viewer, {
      assignmentId,
      responseText: str(formData, "responseText"),
    });
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateAssignment(assignmentId);
    return { ok: true, data: { id: result.data.id } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function submitSubmissionAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const viewer = await teacherViewer();
    if (!viewer) return failure("الجلسة منتهية — سجّل الدخول من جديد", "FORBIDDEN");
    const assignmentId = str(formData, "assignmentId");
    const result = await submitSubmission(viewer, {
      assignmentId,
      responseText: str(formData, "responseText"),
    });
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateAssignment(assignmentId);
    return {
      ok: true,
      data: { id: result.data.id, status: result.data.status, isLate: result.data.isLate },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function uploadSubmissionFileAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const viewer = await teacherViewer();
    if (!viewer) return failure("الجلسة منتهية — سجّل الدخول من جديد", "FORBIDDEN");
    const file = formData.get("file");
    const result = await uploadSubmissionFile(viewer, {
      assignmentId: str(formData, "assignmentId"),
      file,
    });
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateAssignment(str(formData, "assignmentId"));
    return { ok: true, data: { fileId: result.data.fileId } };
  } catch {
    return failure("تعذر رفع الملف — أعد المحاولة", "UNKNOWN");
  }
}

export async function deleteSubmissionFileAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const viewer = await teacherViewer();
    if (!viewer) return failure("الجلسة منتهية — سجّل الدخول من جديد", "FORBIDDEN");
    const result = await deleteSubmissionFile(viewer, {
      fileId: str(formData, "fileId"),
    });
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidatePath("/my-assignments");
    return { ok: true, data: { id: result.data.id } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/* ------------------------------------------------------------------ */
/* Review — claim / return / grade                                      */
/* ------------------------------------------------------------------ */

interface ScorePayload {
  criterionId?: unknown;
  points?: unknown;
}

export async function markUnderReviewAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const ctx = await reviewActor();
    if (!ctx) {
      return failure(
        "مراجعة التسليمات متاحة للمشرفين التربويين ومديري مكاتب التطوير فقط",
        "FORBIDDEN"
      );
    }
    const result = await markUnderReview({
      submissionId: str(formData, "submissionId"),
    }, ctx);
    if (!result.ok) return failure(result.message, result.code);
    revalidatePath("/assignments");
    revalidatePath(`/assignments/${str(formData, "assignmentId")}/submissions`);
    return { ok: true, data: { id: result.data.id, status: result.data.status } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function returnSubmissionAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const ctx = await reviewActor();
    if (!ctx) {
      return failure(
        "مراجعة التسليمات متاحة للمشرفين التربويين ومديري مكاتب التطوير فقط",
        "FORBIDDEN"
      );
    }
    const result = await returnSubmission({
      submissionId: str(formData, "submissionId"),
      feedbackText: str(formData, "feedbackText"),
    }, ctx);
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidatePath("/assignments");
    revalidatePath(`/assignments/${str(formData, "assignmentId")}/submissions`);
    revalidatePath("/my-assignments");
    return { ok: true, data: { id: result.data.id, status: result.data.status } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function gradeSubmissionAction(
  _prev: FormActionState,
  formData: FormData
): Promise<FormActionState> {
  try {
    const ctx = await reviewActor();
    if (!ctx) {
      return failure(
        "مراجعة التسليمات متاحة للمشرفين التربويين ومديري مكاتب التطوير فقط",
        "FORBIDDEN"
      );
    }
    const parsed = parseJsonField<ScorePayload[]>(str(formData, "scoresJson"));
    const scores = parsed.ok
      ? parsed.value
          .filter(
            (item): item is { criterionId: string; points: number } =>
              typeof item?.criterionId === "string" && typeof item?.points === "number"
          )
          .map((item) => ({ criterionId: item.criterionId, points: item.points }))
      : [];
    const result = await gradeSubmission({
      submissionId: str(formData, "submissionId"),
      feedbackText: str(formData, "feedbackText"),
      scores,
      directScore: str(formData, "directScore") || undefined,
    }, ctx);
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidatePath("/assignments");
    revalidatePath(`/assignments/${str(formData, "assignmentId")}/submissions`);
    revalidatePath("/my-assignments");
    return {
      ok: true,
      data: {
        id: result.data.id,
        status: result.data.status,
        scoreTotal: result.data.scoreTotal,
      },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}
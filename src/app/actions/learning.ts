"use server";

/**
 * Batch 1 — thin "use server" wrappers for the learning loop:
 * lesson progress, course completion, impact measurement and course
 * comments. Every wrapper resolves the actor from the SESSION (never
 * from the payload) and revalidates the course learning page after
 * each mutation, mirroring the certificates actions convention.
 */
import { revalidatePath } from "next/cache";

import type { ViewerIdentity } from "@/lib/training/access";
import { getCurrentUser } from "@/lib/auth/session";
import {
  markLessonComplete,
  maybeCompleteCourse,
} from "@/lib/training/progress";
import { submitImpactResponse } from "@/lib/surveys/impact";
import { addCourseComment } from "@/lib/comments/service";

/* ------------------------------------------------------------------ */
/* Serializable action state (no Dates cross the RSC boundary)          */
/* ------------------------------------------------------------------ */

export interface LearningActionState {
  ok: boolean;
  message?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: {
    lessonsPercent?: number;
    alreadyCompleted?: boolean;
    courseCompleted?: boolean;
    certificateId?: string | null;
    certificateBlockedReason?: string | null;
    replaced?: boolean;
    commentId?: string;
  };
}

function failure(
  message: string,
  code: string,
  fieldErrors?: Record<string, string>
): LearningActionState {
  return { ok: false, message, code, fieldErrors };
}

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Session-safe viewer identity for the learning services. */
async function viewer(): Promise<ViewerIdentity | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, role: user.role, schoolId: user.schoolId };
}

function revalidateLearning(courseId: string): void {
  revalidatePath(`/academy/learn/${courseId}`);
  revalidatePath("/academy");
  revalidatePath("/academy/impact");
  revalidatePath("/notifications");
}

/* ------------------------------------------------------------------ */
/* Lesson progress                                                     */
/* ------------------------------------------------------------------ */

export async function markLessonCompleteAction(
  _prev: LearningActionState,
  formData: FormData
): Promise<LearningActionState> {
  try {
    const identity = await viewer();
    if (!identity) {
      return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    }
    const courseId = str(formData, "courseId");
    const lessonId = str(formData, "lessonId");
    if (!courseId || !lessonId) {
      return failure("بيانات ناقصة — حدّث الصفحة وأعد المحاولة", "VALIDATION");
    }
    const result = await markLessonComplete(identity, courseId, lessonId);
    if (!result.ok) {
      return failure(result.message, result.code ?? "UNKNOWN");
    }
    revalidateLearning(courseId);

    // Journey transition indicator — the exact moment the teacher
    // finishes the last required lesson, the checklist strip points
    // at the next stage. The journey card above refreshes through
    // the revalidation and flips المرحلة الثانية to متاحة الآن.
    const successMessage = result.data.alreadyCompleted
      ? undefined
      : result.data.courseCompleted?.created === true
        ? "أكملت جميع متطلبات الدورة — راجع بطاقة رحلة التعلّم للمراحل التالية"
        : result.data.lessonsPercent >= 100
          ? "أكملت جميع دروس الدورة — راجع بطاقة رحلة التعلّم للمرحلة التالية"
          : undefined;

    return {
      ok: true,
      message: successMessage,
      data: {
        lessonsPercent: result.data.lessonsPercent,
        alreadyCompleted: result.data.alreadyCompleted,
        courseCompleted: result.data.courseCompleted?.created === true,
        certificateId:
          result.data.courseCompleted?.certificate?.certificateId ?? null,
        certificateBlockedReason:
          result.data.courseCompleted?.certificateBlockedReason ?? null,
      },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/* ------------------------------------------------------------------ */
/* Course completion (manual re-check button on the learning page)     */
/* ------------------------------------------------------------------ */

export async function completeCourseAction(
  _prev: LearningActionState,
  formData: FormData
): Promise<LearningActionState> {
  try {
    const identity = await viewer();
    if (!identity) {
      return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    }
    const courseId = str(formData, "courseId");
    if (!courseId) {
      return failure("بيانات ناقصة — حدّث الصفحة وأعد المحاولة", "VALIDATION");
    }
    if (identity.role !== "TEACHER") {
      return failure("إتمام الدورات متاح للمعلمين فقط", "FORBIDDEN");
    }
    const outcome = await maybeCompleteCourse(identity.id, courseId);
    if (!outcome) {
      return failure(
        "لم تكتمل متطلبات الدورة بعد — أكمل الدروس والتقييمات أولًا",
        "REQUIREMENTS_NOT_MET"
      );
    }
    revalidateLearning(courseId);
    return {
      ok: true,
      data: {
        courseCompleted: outcome.created,
        certificateId: outcome.certificate?.certificateId ?? null,
        certificateBlockedReason: outcome.certificateBlockedReason,
      },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/* ------------------------------------------------------------------ */
/* Impact measurement                                                  */
/* ------------------------------------------------------------------ */

export async function submitImpactAction(
  _prev: LearningActionState,
  formData: FormData
): Promise<LearningActionState> {
  try {
    const identity = await viewer();
    if (!identity) {
      return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    }
    const courseId = str(formData, "courseId");
    if (!courseId) {
      return failure("بيانات ناقصة — حدّث الصفحة وأعد المحاولة", "VALIDATION");
    }

    // Each impact tool renders one named field group (impact_<questionId>)
    // whose value depends on the tool type — normalize into the
    // service's answer objects.
    const answers: Array<{
      questionId: string;
      valueNumber?: number;
      valueText?: string;
      selectedOption?: string;
    }> = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("impact_") || typeof value !== "string") continue;
      const questionId = key.slice("impact_".length);
      const text = value.trim();
      if (!text) continue;
      if (/^-?\d+$/.test(text)) {
        answers.push({ questionId, valueNumber: Number(text) });
      } else {
        answers.push({ questionId, valueText: text, selectedOption: text });
      }
    }
    if (answers.length === 0) {
      return failure("أجب عن أداة قياس واحدة على الأقل", "VALIDATION");
    }

    const result = await submitImpactResponse(identity, courseId, { answers });
    if (!result.ok) {
      return failure(
        result.message,
        result.code ?? "UNKNOWN",
        result.fieldErrors
      );
    }
    revalidateLearning(courseId);
    return {
      ok: true,
      message: "تم إرسال قياس الأثر بنجاح — شكرًا لمساهمتك",
      data: { replaced: result.data.replaced },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/* ------------------------------------------------------------------ */
/* Course comments                                                     */
/* ------------------------------------------------------------------ */

export async function addCourseCommentAction(
  _prev: LearningActionState,
  formData: FormData
): Promise<LearningActionState> {
  try {
    const identity = await viewer();
    if (!identity) {
      return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    }
    const courseId = str(formData, "courseId");
    const body = str(formData, "body");
    if (!courseId) {
      return failure("بيانات ناقصة — حدّث الصفحة وأعد المحاولة", "VALIDATION");
    }
    const result = await addCourseComment(identity, courseId, body);
    if (!result.ok) {
      return failure(
        result.message,
        result.code ?? "UNKNOWN",
        result.fieldErrors
      );
    }
    revalidateLearning(courseId);
    return {
      ok: true,
      data: { commentId: result.data.id },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}
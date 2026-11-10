"use server";

/**
 * Mandatory journey — exam server actions.
 *
 * The ONLY entry points for starting/submitting course exams from the
 * learning page journey (stage 2). Every wrapper:
 *   - resolves the actor from the SESSION (never from the payload),
 *   - verifies the exam really belongs to THIS course,
 *   - re-checks the mandatory lessons gate (defense in depth on top of
 *     the assessment service's own gate inside startAttempt),
 *   - delegates ALL attempt rules (availability window, enrollment,
 *     attempt limit, deadline, server-side scoring) to the existing
 *     assessment service — nothing is reimplemented here.
 */

import { revalidatePath } from "next/cache";

import {
  canViewPublishedAssessment,
} from "@/lib/assessment/access";
import {
  saveAttemptDraft,
  startAttempt,
  submitAttempt,
} from "@/lib/assessment/service";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { lessonGateMessage, lessonGateStatus } from "@/lib/training/progress";
import type { ViewerIdentity } from "@/lib/training/access";

/* ------------------------------------------------------------------ */
/* Serializable action state (no Dates cross the RSC boundary)          */
/* ------------------------------------------------------------------ */

export interface JourneyExamActionState {
  ok: boolean;
  message?: string;
  code?: string;
  data?: {
    attemptId?: string;
    resumed?: boolean;
    status?: string;
  };
}

function failure(
  message: string,
  code: string
): JourneyExamActionState {
  return { ok: false, message, code };
}

/** Session-safe viewer identity — TEACHER only for the journey exam. */
async function teacherViewer(): Promise<
  { ok: true; viewer: ViewerIdentity } | { ok: false; state: JourneyExamActionState }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      state: failure("يجب تسجيل الدخول أولًا", "FORBIDDEN"),
    };
  }
  if (user.role !== "TEACHER") {
    return {
      ok: false,
      state: failure("الاختبار النهائي متاح للمعلمين فقط", "FORBIDDEN"),
    };
  }
  return { ok: true, viewer: { id: user.id, role: user.role, schoolId: user.schoolId } };
}

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function revalidateJourney(courseId: string): void {
  revalidatePath(`/academy/learn/${courseId}`);
  revalidatePath("/academy");
}

/**
 * One exam answer as the assessment service schema expects: exactly the
 * field matching the question type — choice (ids) / bool / text.
 */
interface JourneyExamAnswer {
  questionId: string;
  choice?: string[];
  bool?: boolean;
  text?: string;
}

/**
 * Collect the exam answers from the form fields (q_<questionId>) using
 * the REAL question types of THIS assessment from the database — so a
 * tampered payload can never smuggle a foreign question or a mismatched
 * answer shape (the service validates this again anyway).
 */
async function collectExamAnswers(
  assessmentId: string,
  formData: FormData
): Promise<JourneyExamAnswer[]> {
  const questions = await db.assessmentQuestion.findMany({
    where: { assessmentId },
    select: { id: true, type: true },
  });
  const answers: JourneyExamAnswer[] = [];
  for (const question of questions) {
    const values = formData
      .getAll(`q_${question.id}`)
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (values.length === 0) continue;
    if (question.type === "SINGLE_CHOICE") {
      answers.push({ questionId: question.id, choice: [values[0]] });
    } else if (question.type === "MULTIPLE_CHOICE") {
      answers.push({ questionId: question.id, choice: values });
    } else if (question.type === "TRUE_FALSE") {
      answers.push({ questionId: question.id, bool: values[0] === "true" });
    } else if (question.type === "SHORT_ANSWER") {
      answers.push({
        questionId: question.id,
        text: values[0].slice(0, 2000),
      });
    }
  }
  return answers;
}

/* ------------------------------------------------------------------ */
/* Start (or resume) the exam attempt                                   */
/* ------------------------------------------------------------------ */

export async function startExamAttemptAction(
  _prev: JourneyExamActionState,
  formData: FormData
): Promise<JourneyExamActionState> {
  try {
    const viewerResult = await teacherViewer();
    if (!viewerResult.ok) return viewerResult.state;
    const viewer = viewerResult.viewer;

    const courseId = str(formData, "courseId");
    const assessmentId = str(formData, "assessmentId");
    if (!courseId || !assessmentId) {
      return failure("بيانات ناقصة — حدّث الصفحة وأعد المحاولة", "VALIDATION");
    }

    // The exam must be a PUBLISHED assessment bound to THIS course.
    const assessment = await db.assessment.findUnique({
      where: { id: assessmentId },
      select: { id: true, courseId: true, status: true, schoolId: true },
    });
    if (!assessment || assessment.courseId !== courseId) {
      return failure(
        "هذا الاختبار لا يخص هذه الدورة — حدّث الصفحة وأعد المحاولة",
        "NOT_FOUND"
      );
    }
    if (!canViewPublishedAssessment(viewer, assessment)) {
      return failure("هذا الاختبار غير متاح لك", "FORBIDDEN");
    }

    // Defense in depth — the mandatory lessons gate, re-checked HERE on
    // top of the service's own gate inside startAttempt.
    const gate = await lessonGateStatus(viewer, courseId);
    if (!gate.unlocked) {
      return failure(lessonGateMessage(gate), "LESSON_GATE");
    }

    const result = await startAttempt(viewer, assessmentId);
    if (!result.ok) {
      return failure(result.message, result.code ?? "UNKNOWN");
    }

    revalidateJourney(courseId);
    return {
      ok: true,
      data: {
        attemptId: result.data.attemptId,
        resumed: result.data.resumed,
      },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/* ------------------------------------------------------------------ */
/* Submit + grade (server-side scoring inside the service transaction)  */
/* ------------------------------------------------------------------ */

export async function submitExamAttemptAction(
  _prev: JourneyExamActionState,
  formData: FormData
): Promise<JourneyExamActionState> {
  try {
    const viewerResult = await teacherViewer();
    if (!viewerResult.ok) return viewerResult.state;
    const viewer = viewerResult.viewer;

    const courseId = str(formData, "courseId");
    const attemptId = str(formData, "attemptId");
    if (!courseId || !attemptId) {
      return failure("بيانات ناقصة — حدّث الصفحة وأعد المحاولة", "VALIDATION");
    }

    // Ownership + course binding — the attempt must belong to the caller
    // AND to this course's exam.
    const attempt = await db.assessmentAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        userId: true,
        status: true,
        assessment: {
          select: { id: true, courseId: true, status: true },
        },
      },
    });
    if (!attempt || attempt.assessment.courseId !== courseId) {
      return failure(
        "هذه المحاولة لا تخص هذه الدورة — حدّث الصفحة وأعد المحاولة",
        "NOT_FOUND"
      );
    }
    if (attempt.userId !== viewer.id) {
      return failure("لا يمكن تسليم محاولة معلم آخر", "FORBIDDEN");
    }
    if (attempt.status !== "IN_PROGRESS") {
      return failure(
        "تم تسليم هذه المحاولة من قبل — حدّث الصفحة لعرض النتيجة",
        "ALREADY_SUBMITTED"
      );
    }

    // Defense in depth — the mandatory lessons gate must STILL be open
    // at submission time (a newly published lesson re-locks the exam).
    const gate = await lessonGateStatus(viewer, courseId);
    if (!gate.unlocked) {
      return failure(lessonGateMessage(gate), "LESSON_GATE");
    }

    const answers = await collectExamAnswers(attempt.assessment.id, formData);
    const result = await submitAttempt(viewer, { attemptId, answers });
    if (!result.ok) {
      return failure(result.message, result.code ?? "UNKNOWN");
    }

    // A PASSED attempt triggers maybeCompleteCourse inside the service
    // (post-commit) — the journey page re-render picks up stages 3/4.
    revalidateJourney(courseId);
    return {
      ok: true,
      data: { attemptId: result.data.attemptId, status: result.data.status },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/* ------------------------------------------------------------------ */
/* Draft autosave — silent best-effort (no revalidation, no UI noise)   */
/* ------------------------------------------------------------------ */

export async function saveExamDraftAction(
  _prev: JourneyExamActionState,
  formData: FormData
): Promise<JourneyExamActionState> {
  try {
    const viewerResult = await teacherViewer();
    if (!viewerResult.ok) return viewerResult.state;
    const viewer = viewerResult.viewer;

    const courseId = str(formData, "courseId");
    const attemptId = str(formData, "attemptId");
    if (!courseId || !attemptId) {
      return { ok: false };
    }

    const attempt = await db.assessmentAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        userId: true,
        assessmentId: true,
        assessment: { select: { courseId: true } },
      },
    });
    if (
      !attempt ||
      attempt.userId !== viewer.id ||
      attempt.assessment.courseId !== courseId
    ) {
      return { ok: false };
    }

    const answers = await collectExamAnswers(attempt.assessmentId, formData);
    await saveAttemptDraft(viewer, { attemptId, answers });
    // Intentionally NO revalidatePath — a rerender would wipe the
    // unsaved inputs; the draft is restored on the next full load.
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
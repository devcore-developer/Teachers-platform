"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminContext } from "@/lib/auth/dev-admin";
import { requireUser } from "@/lib/auth/session";
import {
  addQuestion,
  createAssessment,
  deleteQuestion,
  getAssessmentForManage,
  moveQuestion,
  reviewAttempt,
  saveAttemptDraft,
  setAssessmentStatus,
  startAttempt,
  submitAttempt,
  updateAssessment,
  updateQuestion,
} from "@/lib/assessment/service";
import { sanitizeNextPath } from "@/lib/auth/session";

/* ------------------------------------------------------------------ */
/* Phase 6 server actions — thin wrappers. Authorization and scoring    */
/* live in the service layer; these extract input (including JSON       */
/* payloads for questions/answers), call the service and refresh pages. */
/* Nothing security-relevant happens on the client.                     */
/* ------------------------------------------------------------------ */

export interface AssessmentFormState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Set by attempt actions so the client can route/confirm. */
  attemptId?: string;
  assessmentId?: string;
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

/** Parse a JSON list payload submitted by a client component. */
function jsonPayload(formData: FormData, key: string): unknown {
  const raw = str(formData, key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function refreshAssessments(assessmentId?: string, attemptId?: string) {
  revalidatePath("/");
  revalidatePath("/assessments");
  revalidatePath("/assessments/manage");
  if (assessmentId) {
    revalidatePath(`/assessments/manage/${assessmentId}`);
    revalidatePath(`/assessments/${assessmentId}`);
  }
  if (attemptId) {
    revalidatePath(`/assessments/attempts/${attemptId}`);
  }
}

/* --------------------------- Management ---------------------------- */

export async function createAssessmentAction(
  _prev: AssessmentFormState | null,
  formData: FormData
): Promise<AssessmentFormState> {
  const ctx = await requireAdminContext();
  const result = await createAssessment(
    {
      titleAr: str(formData, "titleAr"),
      titleEn: formValue(formData, "titleEn"),
      instructionsAr: str(formData, "instructionsAr"),
      instructionsEn: formValue(formData, "instructionsEn"),
      courseId: formValue(formData, "courseId"),
      scope: formValue(formData, "scope") || "school",
      schoolId: formValue(formData, "schoolId"),
      passingScore: formValue(formData, "passingScore"),
      timeLimitMinutes: formValue(formData, "timeLimitMinutes"),
      attemptLimit: formValue(formData, "attemptLimit"),
      availableFrom: formValue(formData, "availableFrom"),
      availableUntil: formValue(formData, "availableUntil"),
    },
    ctx
  );
  if (result.ok) {
    refreshAssessments(result.data.id);
    // Creation lands on the editor so the manager can add questions.
    redirect(`/assessments/manage/${result.data.id}`);
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function updateAssessmentAction(
  _prev: AssessmentFormState | null,
  formData: FormData
): Promise<AssessmentFormState> {
  const ctx = await requireAdminContext();
  const result = await updateAssessment(
    {
      assessmentId: str(formData, "assessmentId"),
      titleAr: str(formData, "titleAr"),
      titleEn: formValue(formData, "titleEn"),
      instructionsAr: str(formData, "instructionsAr"),
      instructionsEn: formValue(formData, "instructionsEn"),
      courseId: formValue(formData, "courseId"),
      scope: "school", // ignored on update (tenancy immutable) — see service
      schoolId: "",
      passingScore: formValue(formData, "passingScore"),
      timeLimitMinutes: formValue(formData, "timeLimitMinutes"),
      attemptLimit: formValue(formData, "attemptLimit"),
      availableFrom: formValue(formData, "availableFrom"),
      availableUntil: formValue(formData, "availableUntil"),
    },
    ctx
  );
  if (result.ok) {
    refreshAssessments(result.data.id);
    return { ok: true, message: "تم حفظ إعدادات الاختبار" };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function setAssessmentStatusAction(
  formData: FormData
): Promise<void> {
  const ctx = await requireAdminContext();
  const assessmentId = str(formData, "assessmentId");
  await setAssessmentStatus(
    { assessmentId, status: str(formData, "status") },
    ctx
  );
  refreshAssessments(assessmentId);
}

/* ---------------------------- Questions ---------------------------- */

export async function addQuestionAction(
  _prev: AssessmentFormState | null,
  formData: FormData
): Promise<AssessmentFormState> {
  const ctx = await requireAdminContext();
  const result = await addQuestion(
    {
      assessmentId: str(formData, "assessmentId"),
      type: str(formData, "type"),
      textAr: str(formData, "textAr"),
      textEn: formValue(formData, "textEn"),
      points: formValue(formData, "points"),
      isRequired: checkbox(formData, "isRequired"),
      explanation: formValue(formData, "explanation"),
      options: (jsonPayload(formData, "optionsJson") as
        | { textAr: string }[]
        | undefined) ?? [],
      correctOptionIndexes:
        (jsonPayload(formData, "correctOptionIndexesJson") as number[] | undefined) ?? [],
      correctValue: str(formData, "correctValue")
        ? str(formData, "correctValue") === "true"
        : undefined,
      modelAnswer: formValue(formData, "modelAnswer"),
    },
    ctx
  );
  if (result.ok) {
    refreshAssessments(str(formData, "assessmentId"));
    return { ok: true, message: "تمت إضافة السؤال" };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function updateQuestionAction(
  _prev: AssessmentFormState | null,
  formData: FormData
): Promise<AssessmentFormState> {
  const ctx = await requireAdminContext();
  const result = await updateQuestion(
    {
      assessmentId: str(formData, "assessmentId"),
      questionId: str(formData, "questionId"),
      type: str(formData, "type"),
      textAr: str(formData, "textAr"),
      textEn: formValue(formData, "textEn"),
      points: formValue(formData, "points"),
      isRequired: checkbox(formData, "isRequired"),
      explanation: formValue(formData, "explanation"),
      options: (jsonPayload(formData, "optionsJson") as
        | { textAr: string }[]
        | undefined) ?? [],
      correctOptionIndexes:
        (jsonPayload(formData, "correctOptionIndexesJson") as number[] | undefined) ?? [],
      correctValue: str(formData, "correctValue")
        ? str(formData, "correctValue") === "true"
        : undefined,
      modelAnswer: formValue(formData, "modelAnswer"),
    },
    ctx
  );
  if (result.ok) {
    refreshAssessments(str(formData, "assessmentId"));
    return { ok: true, message: "تم حفظ تعديلات السؤال" };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

export async function deleteQuestionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminContext();
  await deleteQuestion({ questionId: str(formData, "questionId") }, ctx);
  refreshAssessments(str(formData, "assessmentId"));
}

export async function moveQuestionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminContext();
  await moveQuestion(
    {
      assessmentId: str(formData, "assessmentId"),
      questionId: str(formData, "questionId"),
      direction: str(formData, "direction") === "up" ? "up" : "down",
    },
    ctx
  );
  refreshAssessments(str(formData, "assessmentId"));
}

/* ----------------------------- Review ------------------------------ */

export async function reviewAttemptAction(
  _prev: AssessmentFormState | null,
  formData: FormData
): Promise<AssessmentFormState> {
  const ctx = await requireAdminContext();
  const attemptId = str(formData, "attemptId");
  const result = await reviewAttempt(
    {
      attemptId,
      scores:
        (jsonPayload(formData, "scoresJson") as
          | { questionId: string; points: string | number }[]
          | undefined) ?? [],
    },
    ctx
  );
  if (result.ok) {
    refreshAssessments(undefined, attemptId);
    revalidatePath(`/assessments/manage/${result.data.id}`);
    return {
      ok: true,
      message: `تم اعتماد المراجعة — النتيجة النهائية ${result.data.percentage}%`,
    };
  }
  return { ok: false, message: result.message, fieldErrors: result.fieldErrors };
}

/* --------------------------- Teacher side -------------------------- */

export async function startAttemptAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const assessmentId = str(formData, "assessmentId");
  const result = await startAttempt(
    { id: user.id, role: user.role, schoolId: user.schoolId },
    assessmentId
  );
  if (!result.ok) {
    // Eligibility failures surface on the detail page as explicit states.
    const params = new URLSearchParams({ error: result.message });
    redirect(`/assessments/${assessmentId}?${params.toString()}`);
  }
  refreshAssessments(assessmentId, result.data.attemptId);
  redirect(`/assessments/${assessmentId}/take`);
}

export async function saveDraftAction(
  _prev: AssessmentFormState | null,
  formData: FormData
): Promise<AssessmentFormState> {
  const user = await requireUser();
  const result = await saveAttemptDraft(
    { id: user.id, role: user.role, schoolId: user.schoolId },
    {
      attemptId: str(formData, "attemptId"),
      answers: (jsonPayload(formData, "answersJson") as never) ?? [],
    }
  );
  if (result.ok) return { ok: true, attemptId: result.data.id };
  return { ok: false, message: result.message };
}

export async function submitAttemptAction(
  _prev: AssessmentFormState | null,
  formData: FormData
): Promise<AssessmentFormState> {
  const user = await requireUser();
  const attemptId = str(formData, "attemptId");
  const result = await submitAttempt(
    { id: user.id, role: user.role, schoolId: user.schoolId },
    {
      attemptId,
      answers: (jsonPayload(formData, "answersJson") as never) ?? [],
    }
  );
  if (result.ok) {
    refreshAssessments(undefined, attemptId);
    redirect(`/assessments/attempts/${attemptId}`);
  }
  return { ok: false, message: result.message };
}

/** Guard helper re-exported for pages (keeps imports uniform). */
export { sanitizeNextPath };
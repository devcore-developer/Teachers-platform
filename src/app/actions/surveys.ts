"use server";

/**
 * Phase 9 — thin "use server" wrappers around the survey/follow-up
 * services.
 *
 * Every wrapper resolves the actor from the SESSION (never from the
 * payload): the current user is narrowed to an explicit role literal
 * before being passed on as a SurveyActor. The service re-validates
 * role/tenant/data on its own — these wrappers only adapt FormData
 * payloads and trigger revalidation.
 */
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor, SurveyViewer } from "@/lib/surveys/access";
import {
  createSurvey,
  saveResponseDraft,
  submitResponse,
  transitionSurvey,
  updateSurvey,
  type SurveyTransitionAction,
} from "@/lib/surveys/service";
import {
  changeFollowUpStatus,
  createFollowUp,
  setFollowUpSharing,
  updateFollowUp,
} from "@/lib/followups/service";

/* ------------------------------------------------------------------ */
/* Serializable action state (no Dates cross the RSC boundary)          */
/* ------------------------------------------------------------------ */

export interface SurveyActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  code?: string;
  data?: {
    id?: string;
    status?: string;
    surveyTitle?: string;
    submittedAt?: string;
  };
}

function failure(
  message: string,
  code: string,
  fieldErrors?: Record<string, string>
): SurveyActionState {
  return { ok: false, message, code, fieldErrors };
}

/* ------------------------------------------------------------------ */
/* FormData helpers                                                     */
/* ------------------------------------------------------------------ */

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function json(formData: FormData, key: string): unknown {
  const raw = str(formData, key);
  if (raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * General back-office actor for survey management. Built ONLY from the
 * session user after an explicit role check — client payloads can never
 * widen it. SUPER_ADMIN passes the role literal but every operational
 * service path rejects it via surveyScopeError.
 */
export async function surveyActor(): Promise<SurveyActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (
    user.role !== "DEVELOPMENT_OFFICE_MANAGER" &&
    user.role !== "EDUCATIONAL_SUPERVISOR" &&
    user.role !== "EDUCATIONAL_DEPUTY" &&
    user.role !== "SUPER_ADMIN"
  ) {
    return null;
  }
  return {
    id: user.id,
    role: user.role,
    schoolId: user.schoolId,
  };
}

/** Any authenticated viewer (teachers included) for response paths. */
export async function surveyViewer(): Promise<SurveyViewer | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, role: user.role, schoolId: user.schoolId };
}

function revalidateSurveys(surveyId?: string): void {
  revalidatePath("/surveys");
  revalidatePath("/my-surveys");
  revalidatePath("/impact");
  if (surveyId) {
    revalidatePath(`/surveys/${surveyId}`);
    revalidatePath(`/surveys/${surveyId}/results`);
    revalidatePath(`/my-surveys/${surveyId}`);
  }
}

function revalidateFollowUps(followUpId?: string): void {
  revalidatePath("/follow-ups");
  revalidatePath("/my-follow-ups");
  revalidatePath("/impact");
  if (followUpId) revalidatePath(`/follow-ups/${followUpId}`);
}

/* ------------------------------------------------------------------ */
/* Survey lifecycle actions                                             */
/* ------------------------------------------------------------------ */

export async function createSurveyAction(
  _prev: SurveyActionState,
  formData: FormData
): Promise<SurveyActionState> {
  try {
    const ctx = await surveyActor();
    if (!ctx) {
      return failure("إنشاء الاستبيانات متاح للأدوار الإدارية المعتمدة فقط", "FORBIDDEN");
    }
    const result = await createSurvey(ctx, json(formData, "definitionJson"));
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateSurveys(result.data.id);
    return { ok: true, data: { id: result.data.id } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function updateSurveyAction(
  _prev: SurveyActionState,
  formData: FormData
): Promise<SurveyActionState> {
  try {
    const ctx = await surveyActor();
    if (!ctx) {
      return failure("تعديل الاستبيانات متاح للأدوار الإدارية المعتمدة فقط", "FORBIDDEN");
    }
    const surveyId = str(formData, "surveyId");
    const result = await updateSurvey(ctx, surveyId, json(formData, "definitionJson"));
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateSurveys(result.data.id);
    return { ok: true, data: { id: result.data.id } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function transitionSurveyAction(
  _prev: SurveyActionState,
  formData: FormData
): Promise<SurveyActionState> {
  try {
    const ctx = await surveyActor();
    if (!ctx) {
      return failure("إدارة دورة حياة الاستبيان متاحة للأدوار الإدارية المعتمدة فقط", "FORBIDDEN");
    }
    const surveyId = str(formData, "surveyId");
    const rawAction = str(formData, "action");
    if (rawAction !== "PUBLISH" && rawAction !== "CLOSE" && rawAction !== "ARCHIVE") {
      return failure("إجراء غير معروف", "VALIDATION_ERROR");
    }
    const action = rawAction as SurveyTransitionAction;
    const result = await transitionSurvey(ctx, surveyId, action);
    if (!result.ok) {
      return failure(result.message, result.code);
    }
    revalidateSurveys(result.data.id);
    return { ok: true, data: { id: result.data.id, status: result.data.status } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/* ------------------------------------------------------------------ */
/* Response actions (teacher side)                                      */
/* ------------------------------------------------------------------ */

export async function saveResponseDraftAction(
  _prev: SurveyActionState,
  formData: FormData
): Promise<SurveyActionState> {
  try {
    const viewer = await surveyViewer();
    if (!viewer) {
      return failure("الجلسة منتهية — سجّل الدخول من جديد", "FORBIDDEN");
    }
    const surveyId = str(formData, "surveyId");
    const result = await saveResponseDraft(viewer, surveyId, json(formData, "payloadJson"));
    if (!result.ok) {
      return failure(result.message, result.code);
    }
    revalidateSurveys(surveyId);
    return { ok: true, data: { id: result.data.id } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function submitResponseAction(
  _prev: SurveyActionState,
  formData: FormData
): Promise<SurveyActionState> {
  try {
    const viewer = await surveyViewer();
    if (!viewer) {
      return failure("الجلسة منتهية — سجّل الدخول من جديد", "FORBIDDEN");
    }
    const surveyId = str(formData, "surveyId");
    const result = await submitResponse(viewer, surveyId, json(formData, "payloadJson"));
    if (!result.ok) {
      return failure(result.message, result.code);
    }
    revalidateSurveys(surveyId);
    return {
      ok: true,
      data: {
        id: result.data.id,
        surveyTitle: result.data.surveyTitle,
        submittedAt: result.data.submittedAt.toISOString(),
      },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/* ------------------------------------------------------------------ */
/* Follow-up actions                                                    */
/* ------------------------------------------------------------------ */

export async function createFollowUpAction(
  _prev: SurveyActionState,
  formData: FormData
): Promise<SurveyActionState> {
  try {
    const ctx = await surveyActor();
    if (!ctx) {
      return failure("إدارة سجلات المتابعة متاحة للأدوار الإدارية المعتمدة فقط", "FORBIDDEN");
    }
    const result = await createFollowUp(ctx, json(formData, "definitionJson"));
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateFollowUps(result.data.id);
    return { ok: true, data: { id: result.data.id } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function updateFollowUpAction(
  _prev: SurveyActionState,
  formData: FormData
): Promise<SurveyActionState> {
  try {
    const ctx = await surveyActor();
    if (!ctx) {
      return failure("تعديل سجلات المتابعة متاحة للأدوار الإدارية المعتمدة فقط", "FORBIDDEN");
    }
    const followUpId = str(formData, "followUpId");
    const result = await updateFollowUp(ctx, followUpId, json(formData, "definitionJson"));
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateFollowUps(result.data.id);
    return { ok: true, data: { id: result.data.id } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function changeFollowUpStatusAction(
  _prev: SurveyActionState,
  formData: FormData
): Promise<SurveyActionState> {
  try {
    const ctx = await surveyActor();
    if (!ctx) {
      return failure("تغيير حالة المتابعة متاح للأدوار الإدارية المعتمدة فقط", "FORBIDDEN");
    }
    const result = await changeFollowUpStatus(ctx, {
      followUpId: str(formData, "followUpId"),
      status: str(formData, "status"),
      note: str(formData, "note"),
    });
    if (!result.ok) {
      return failure(result.message, result.code);
    }
    revalidateFollowUps(result.data.id);
    return { ok: true, data: { id: result.data.id, status: result.data.status } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function setFollowUpSharingAction(
  _prev: SurveyActionState,
  formData: FormData
): Promise<SurveyActionState> {
  try {
    const ctx = await surveyActor();
    if (!ctx) {
      return failure("تغيير المشاركة متاح للأدوار الإدارية المعتمدة فقط", "FORBIDDEN");
    }
    const result = await setFollowUpSharing(ctx, {
      followUpId: str(formData, "followUpId"),
      sharedWithTeacher: str(formData, "shared") === "true",
    });
    if (!result.ok) {
      return failure(result.message, result.code);
    }
    revalidateFollowUps(result.data.id);
    return { ok: true, data: { id: result.data.id, status: result.data.sharedWithTeacher ? "SHARED" : "HIDDEN" } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}
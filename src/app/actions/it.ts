"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireItCoordinatorContext } from "@/lib/auth/dev-admin";
import {
  assignTeacherSupervisorByIt,
  removeTeacherSupervisorByIt,
  requestTeacherRecoveryByIt,
} from "@/lib/users/directory";

/* ------------------------------------------------------------------ */
/* IT coordinator server actions — thin wrappers. The context comes     */
/* from the session through requireItCoordinatorContext(); every rule   */
/* (same-school, role, rate limit) is enforced in the service layer.    */
/* ------------------------------------------------------------------ */

export interface ItActionState {
  ok: boolean;
  message?: string;
}

/** Derive the absolute app base URL from request headers. */
async function appBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function assignTeacherSupervisorItAction(
  _prev: ItActionState | null,
  formData: FormData
): Promise<ItActionState> {
  const ctx = await requireItCoordinatorContext();

  const result = await assignTeacherSupervisorByIt(
    {
      teacherId: String(formData.get("teacherId") ?? ""),
      supervisorId: String(formData.get("supervisorId") ?? ""),
    },
    ctx
  );

  if (result.ok) {
    revalidatePath("/it");
    revalidatePath("/");
  }
  return {
    ok: result.ok,
    message: result.ok ? "تم إسناد المعلم إلى المشرف" : result.message,
  };
}

export async function removeTeacherSupervisorItAction(
  teacherId: string
): Promise<ItActionState> {
  const ctx = await requireItCoordinatorContext();

  const result = await removeTeacherSupervisorByIt({ teacherId }, ctx);
  if (result.ok) {
    revalidatePath("/it");
    revalidatePath("/");
  }
  return {
    ok: result.ok,
    message: result.ok ? "تم إلغاء إسناد المشرف" : result.message,
  };
}

export async function requestTeacherRecoveryItAction(
  _prev: ItActionState | null,
  formData: FormData
): Promise<ItActionState> {
  const ctx = await requireItCoordinatorContext();

  const result = await requestTeacherRecoveryByIt(
    { teacherEmail: String(formData.get("teacherEmail") ?? "") },
    ctx,
    { appBaseUrl: await appBaseUrl() }
  );

  return {
    ok: result.ok,
    message: result.ok
      ? result.data.emailSent
        ? `تم إرسال رابط استعادة كلمة المرور إلى بريد المعلم ${result.data.teacherName}`
        : `تم إنشاء رابط الاستعادة، لكن تعذر إرسال البريد الآن — أعد المحاولة عند توفر مزود البريد`
      : result.message,
  };
}
"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  requireItCoordinatorContext,
  type ItCoordinatorContext,
} from "@/lib/auth/dev-admin";
import {
  assignItTeacher,
  issueItRecoveryLink,
  removeItTeacherSupervisor,
} from "@/lib/it/service";

/* ------------------------------------------------------------------ */
/* IT_COORDINATOR server actions — thin session-backed wrappers around  */
/* src/lib/it/service.ts. The context (identity + own school) comes     */
/* exclusively from the session; every tenant check happens in the      */
/* service layer on top of it.                                          */
/* ------------------------------------------------------------------ */

export interface ItActionState {
  ok: boolean;
  message?: string;
  code?: string;
  /** Recovery only — honest delivery flag + masked address. */
  emailSent?: boolean;
  maskedEmail?: string;
  /** Assignment only — ids of the affected pair. */
  teacherId?: string;
  supervisorId?: string;
}

async function actor(): Promise<ItCoordinatorContext> {
  return requireItCoordinatorContext();
}

async function appBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function assignItTeacherAction(
  _prevState: ItActionState | null,
  formData: FormData
): Promise<ItActionState> {
  const ctx = await actor();

  const result = await assignItTeacher(ctx, {
    teacherId: String(formData.get("teacherId") ?? ""),
    supervisorId: String(formData.get("supervisorId") ?? ""),
  });

  if (!result.ok) {
    return { ok: false, message: result.message, code: result.code };
  }

  revalidatePath("/it/assignments");

  return {
    ok: true,
    message: "تم إسناد المعلم إلى المشرف التربوي بنجاح",
    teacherId: result.data.teacherId,
    supervisorId: result.data.supervisorId,
  };
}

export async function removeItTeacherSupervisorAction(
  _prevState: ItActionState | null,
  formData: FormData
): Promise<ItActionState> {
  const ctx = await actor();

  const result = await removeItTeacherSupervisor(ctx, {
    teacherId: String(formData.get("teacherId") ?? ""),
  });

  if (!result.ok) {
    return { ok: false, message: result.message, code: result.code };
  }

  revalidatePath("/it/assignments");

  return {
    ok: true,
    message: "تمت إزالة الإسناد — المعلم الآن ضمن قائمة غير المُسنَدين",
    teacherId: result.data.teacherId,
  };
}

export async function issueRecoveryLinkAction(
  _prevState: ItActionState | null,
  formData: FormData
): Promise<ItActionState> {
  const ctx = await actor();

  const result = await issueItRecoveryLink(
    ctx,
    { teacherId: String(formData.get("teacherId") ?? "") },
    { appBaseUrl: await appBaseUrl() }
  );

  if (!result.ok) {
    return { ok: false, message: result.message, code: result.code };
  }

  return {
    ok: true,
    message: result.data.emailSent
      ? "أُرسل رابط إعادة تعيين كلمة المرور إلى بريد المعلم (يُستخدم مرة واحدة وينتهي بعد ساعة)"
      : "تعذر الإرسال عبر مزوّد البريد حاليًا — لم يُصدر الرابط. حاول مجددًا لاحقًا",
    emailSent: result.data.emailSent,
    maskedEmail: result.data.maskedEmail,
  };
}
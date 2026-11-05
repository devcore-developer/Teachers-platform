"use server";

/**
 * Batch 2 — self-service account security actions (HTML v27 parity,
 * hardened): password change and email change, both behind current-
 * password re-authentication. After a password change every OTHER
 * session dies (tokenVersion) and the CURRENT session is re-issued
 * transparently.
 */
import { revalidatePath } from "next/cache";

import {
  changeOwnEmail,
  changeOwnPassword,
} from "@/lib/account-security/service";
import {
  createSessionCookie,
  getCurrentUser,
} from "@/lib/auth/session";

export interface AccountSecurityActionState {
  ok: boolean;
  message?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: {
    newEmail?: string;
    verificationEmailSent?: boolean;
  };
}

function failure(
  message: string,
  code?: string,
  fieldErrors?: Record<string, string>
): AccountSecurityActionState {
  return { ok: false, message, code, fieldErrors };
}

export async function changeOwnPasswordAction(
  _prev: AccountSecurityActionState,
  formData: FormData
): Promise<AccountSecurityActionState> {
  try {
    const user = await getCurrentUser();
    if (!user) return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) {
      return failure("كلمتا المرور الجديدتان غير متطابقتين", "VALIDATION_ERROR", {
        confirmPassword: "غير متطابقة",
      });
    }
    const result = await changeOwnPassword(user.id, currentPassword, newPassword);
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    // Re-issue the CURRENT session against the new tokenVersion —
    // every other device/session stays revoked.
    await createSessionCookie(user.id, result.data.tokenVersion);
    revalidatePath("/account-security");
    return { ok: true, message: "تم تغيير كلمة المرور بنجاح — تم إنهاء الجلسات الأخرى" };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function changeOwnEmailAction(
  _prev: AccountSecurityActionState,
  formData: FormData
): Promise<AccountSecurityActionState> {
  try {
    const user = await getCurrentUser();
    if (!user) return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newEmail = String(formData.get("newEmail") ?? "");
    const result = await changeOwnEmail(user.id, currentPassword, newEmail);
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidatePath("/account-security");
    revalidatePath("/my-profile");
    return {
      ok: true,
      message: result.data.verificationEmailSent
        ? `تم تحديث بريدك إلى ${result.data.email} — أُرسلت رسالة توثيق للبريد الجديد، وثّقه لتفعيل الدخول.`
        : `تم تحديث بريدك إلى ${result.data.email} — تعذر إرسال رسالة التوثيق الآن، تواصل مع مكتب التطوير.`,
      data: {
        newEmail: result.data.email,
        verificationEmailSent: result.data.verificationEmailSent,
      },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}
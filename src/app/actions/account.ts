"use server";

/**
 * Phase 11 — account security server actions (forgot/reset password).
 *
 * Anti-enumeration: the forgot-password response is IDENTICAL whether or
 * not the email exists. Honesty: when the email provider is not configured
 * the response says so explicitly instead of claiming a message was sent.
 *
 * Phase 12 — abuse controls:
 *   - per-email flood control lives in lib/auth/tokens.ts (3 / 15 min);
 *     a rate-limited request returns the same neutral message so the
 *     response never becomes an account-existence oracle;
 *   - per-IP limits (10 / 15 min) additionally bound request floods from
 *     a single source across many candidate addresses.
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  consumePasswordResetToken,
  requestPasswordReset,
} from "@/lib/auth/tokens";
import { checkRateLimit, clientKeyFromHeaders } from "@/lib/security/rate-limit";

export interface AccountActionState {
  ok: boolean;
  message?: string;
  /** Global deployment fact — safe to render (no secret values). */
  emailConfigured?: boolean;
  /** Token-consumption failure reason for inline field errors. */
  reason?: string;
}

const NEUTRAL_SUCCESS =
  "إذا كان هذا البريد مسجلًا لدينا فستصلك رسالة تحتوي رابط إعادة التعيين خلال دقائق. تحقق أيضًا من مجلد الرسائل غير المرغوبة.";

const IP_REQUEST_LIMIT = 10;
const IP_WINDOW_MS = 15 * 60 * 1000;

export async function requestPasswordResetAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || !email.includes("@")) {
    return { ok: false, message: "أدخل بريدًا إلكترونيًا صحيحًا" };
  }

  // Per-IP flood control (defense in depth on top of the per-email limit).
  const headerList = await headers();
  const ipKey = clientKeyFromHeaders(headerList);
  const ipLimit = checkRateLimit("password-reset-ip", ipKey, IP_REQUEST_LIMIT, IP_WINDOW_MS);
  if (!ipLimit.allowed) {
    console.warn(
      `[security] password-reset IP rate-limited (retry in ${ipLimit.retryAfterSeconds}s)`
    );
    // Identical neutral message — no existence or throttling oracle.
    return { ok: true, message: NEUTRAL_SUCCESS };
  }

  const outcome = await requestPasswordReset(email);
  if (outcome.note === "INVALID_INPUT") {
    return { ok: false, message: "أدخل بريدًا إلكترونيًا صحيحًا" };
  }

  // Per-email limiter suppressed this request: keep the exact neutral
  // message (no "email sent" claim, no configuration warning either).
  if (outcome.rateLimited) {
    return { ok: true, message: NEUTRAL_SUCCESS };
  }

  if (outcome.emailSent) {
    return { ok: true, emailConfigured: true, message: NEUTRAL_SUCCESS };
  }
  if (!outcome.emailConfigured) {
    return {
      ok: true,
      emailConfigured: false,
      message: `${NEUTRAL_SUCCESS}\nملاحظة مهمة: خدمة إرسال البريد غير مُهيأة حاليًا في هذا النشر، لذا لن تصل رسالة فعلية — تواصل مع إدارة المدرسة لإعادة تعيين كلمة المرور يدويًا.`,
    };
  }
  // Provider configured but the send failed — say it honestly (global
  // delivery state, still nothing about the specific account).
  return {
    ok: true,
    emailConfigured: true,
    message: `${NEUTRAL_SUCCESS}\nتنبيه: تعذّر إرسال الرسالة حاليًا بسبب خلل لدى مزوّد البريد (${outcome.note ?? "UNKNOWN"}) — أعد المحاولة بعد قليل.`,
  };
}

export async function resetPasswordAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!token) return { ok: false, reason: "INVALID", message: "رابط إعادة التعيين غير صالح" };
  if (password.length < 8) {
    return { ok: false, reason: "WEAK_PASSWORD", message: "كلمة المرور يجب ألا تقل عن 8 أحرف" };
  }
  if (password !== confirm) {
    return { ok: false, reason: "WEAK_PASSWORD", message: "كلمتا المرور غير متطابقتين" };
  }

  // Per-IP bound on reset attempts (the 256-bit single-use token is the
  // real gate; this only stops senseless hammering).
  const headerList = await headers();
  const ipKey = clientKeyFromHeaders(headerList);
  const ipLimit = checkRateLimit("password-reset-consume-ip", ipKey, IP_REQUEST_LIMIT, IP_WINDOW_MS);
  if (!ipLimit.allowed) {
    return {
      ok: false,
      reason: "INVALID",
      message: "محاولات كثيرة من هذا الجهاز — أعد المحاولة بعد قليل",
    };
  }

  const result = await consumePasswordResetToken(token, password);
  if (!result.ok) {
    const messages: Record<string, string> = {
      INVALID: "رابط إعادة التعيين غير صالح",
      EXPIRED: "انتهت صلاحية رابط إعادة التعيين — اطلب رابطًا جديدًا",
      USED: "تم استخدام هذا الرابط مسبقًا — روابط إعادة التعيين تُستخدم مرة واحدة فقط",
      WEAK_PASSWORD: "كلمة المرور يجب ألا تقل عن 8 أحرف",
    };
    return { ok: false, reason: result.reason, message: messages[result.reason] ?? "تعذّر إعادة التعيين" };
  }

  revalidatePath("/dashboard");
  return {
    ok: true,
    message: "تم تحديث كلمة مرورك بنجاح وإنهاء جميع الجلسات النشطة — يمكنك تسجيل الدخول بكلمة المرور الجديدة.",
  };
}

/* ------------------------------------------------------------------ */
/* Phase 12 — email verification consumed via POST, never GET          */
/* ------------------------------------------------------------------ */

export interface VerifyEmailActionState {
  ok: boolean;
  /** undefined = form not submitted yet. */
  status?: "ACTIVATED" | "ALREADY_VERIFIED" | "INVALID" | "EXPIRED" | "USED";
}

/**
 * Consumes an email-verification token. Runs ONLY from the explicit
 * confirmation form (POST) so mail-client prefetchers and link scanners
 * can no longer burn the single-use token before the user clicks it.
 */
export async function verifyEmailAction(
  _prev: VerifyEmailActionState,
  formData: FormData,
): Promise<VerifyEmailActionState> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { ok: false, status: "INVALID" };

  const result = await import("@/lib/auth/tokens").then((m) =>
    m.consumeEmailVerificationToken(token)
  );
  if (!result.ok) return { ok: false, status: result.reason };
  return {
    ok: true,
    status: result.alreadyVerified ? "ALREADY_VERIFIED" : "ACTIVATED",
  };
}
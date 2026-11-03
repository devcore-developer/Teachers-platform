"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isRateLimited, recordLoginFailure, recordLoginSuccess, retryAfterSeconds } from "@/lib/auth/rate-limit";
import {
  createSessionCookie,
  destroySessionCookie,
  sanitizeNextPath,
} from "@/lib/auth/session";
import {
  authenticateCredentials,
  registerTeacher,
  requestPasswordReset,
  resetPassword,
  resendVerificationEmail,
} from "@/lib/users/service";
import {
  forgotPasswordSchema,
  loginSchema,
  zodAuthFieldErrors,
} from "@/lib/validation/auth";

/* ------------------------------------------------------------------ */
/* Auth server actions — thin, non-testable wrappers around             */
/* src/lib/users/service.ts (all rules live in the service layer).      */
/* Client components get typed state objects; security decisions are    */
/* never delegated to the client.                                       */
/* ------------------------------------------------------------------ */

export interface AuthFormState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Extra flag for the pending-verification screen (email not sent). */
  emailSent?: boolean;
  email?: string;
}

/** Derive the absolute app base URL from request headers (no env needed). */
async function appBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function clientIp(h: Awaited<ReturnType<typeof headers>>): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

/* ------------------------------- Login ---------------------------- */

export async function loginAction(
  _prevState: AuthFormState | null,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodAuthFieldErrors(parsed.error),
    };
  }

  const h = await headers();
  const ip = clientIp(h);
  if (isRateLimited(parsed.data.email, ip)) {
    const wait = retryAfterSeconds(parsed.data.email, ip);
    return {
      ok: false,
      message: `محاولات كثيرة خاطئة — حاول مجددًا بعد ${Math.ceil(wait / 60)} دقيقة تقريبًا`,
    };
  }

  const result = await authenticateCredentials(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    if (result.code === "INVALID_CREDENTIALS") {
      recordLoginFailure(parsed.data.email, ip);
    }
    return { ok: false, message: result.message };
  }

  recordLoginSuccess(parsed.data.email, ip);
  await createSessionCookie(result.userId, result.tokenVersion);

  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  redirect(next);
}

/* ------------------------------- Logout --------------------------- */

export async function logoutAction(): Promise<void> {
  await destroySessionCookie();
  redirect("/login");
}

/* ------------------------ Teacher registration -------------------- */

export async function registerAction(
  _prevState: AuthFormState | null,
  formData: FormData
): Promise<AuthFormState> {
  const result = await registerTeacher(
    {
      slug: String(formData.get("slug") ?? ""),
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
      branchId: String(formData.get("branchId") ?? ""),
    },
    { appBaseUrl: await appBaseUrl() }
  );

  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }

  // Both "created" and "duplicate_suppressed" lead to the SAME generic
  // pending screen — no account-existence disclosure.
  const email = String(formData.get("email") ?? "").trim();
  redirect(
    `/verify-email/pending?email=${encodeURIComponent(email)}&sent=${result.emailSent ? "1" : "0"}`
  );
}

/* ------------------------ Resend verification --------------------- */

export async function resendVerificationAction(
  _prevState: AuthFormState | null,
  formData: FormData
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { ok: false, message: "أدخل بريدك الإلكتروني أولًا" };
  }
  await resendVerificationEmail(email, await appBaseUrl());
  // Always generic — never reveal whether the address has an account.
  return {
    ok: true,
    message: "إذا كان البريد مسجلًا وغير مُوثّق فستصلك رسالة تأكيد جديدة خلال دقائق",
  };
}

/* --------------------------- Forgot password ---------------------- */

export async function forgotPasswordAction(
  _prevState: AuthFormState | null,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: String(formData.get("email") ?? ""),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "أدخل بريدًا إلكترونيًا صحيحًا",
      fieldErrors: zodAuthFieldErrors(parsed.error),
    };
  }

  await requestPasswordReset(parsed.data.email, await appBaseUrl());
  // Generic response — no account-existence disclosure.
  return {
    ok: true,
    message: "إذا كان هذا البريد مسجلًا في المنصة فستصلك رسالة لإعادة تعيين كلمة المرور خلال دقائق",
  };
}

/* --------------------------- Reset password ----------------------- */

export async function resetPasswordAction(
  _prevState: AuthFormState | null,
  formData: FormData
): Promise<AuthFormState> {
  const result = await resetPassword({
    token: String(formData.get("token") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }

  redirect("/login?reset=1");
}
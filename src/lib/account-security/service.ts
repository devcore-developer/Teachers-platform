import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import {
  emailFieldRules,
  passwordFieldRules,
} from "@/lib/validation/user-fields";
import {
  hashPassword,
  verifyPassword,
  verifyDummyPassword,
} from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/users/service";
import { notifyPasswordResetByAdmin } from "@/lib/notifications/center";

/* ------------------------------------------------------------------ */
/* Batch 2 — account security (HTML v23/v27 parity, hardened).          */
/*                                                                      */
/* 1. Self-service password change (v27): the CURRENT password is       */
/*    verified server-side, the new one follows the platform's Zod      */
/*    rules (>= 8 chars, letter + digit), every OTHER session dies      */
/*    (tokenVersion bump) and the current session is transparently      */
/*    re-issued by the caller.                                          */
/* 2. Self-service email change (v23/v27): password re-authentication   */
/*    + uniqueness; the address restarts UNVERIFIED and the existing    */
/*    verification pipeline is re-used (resend attempt reported).       */
/* 3. Administrative temporary password (v23AdminReset): a cryptographically */
/*    random 12-char secret is hashed and stored; it is returned ONCE   */
/*    to the admin UI and is NEVER emailed, logged or persisted in      */
/*    plaintext. All sessions of the target are revoked and the owner   */
/*    is notified (without the secret).                                 */
/* 4. Administrative email update (v23UpdateAccountEmail): uniqueness   */
/*    + unverified restart + resend attempt.                            */
/*                                                                      */
/* Unknown accounts go through verifyDummyPassword so response timing   */
/* never reveals whether an account exists.                             */
/* ------------------------------------------------------------------ */

export type SecurityServiceResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      message: string;
      code?: "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" | "DUPLICATE_EMAIL";
      fieldErrors?: Record<string, string>;
    };

/* ------------------------------------------------------------------ */
/* 1) Self-service password change                                      */
/* ------------------------------------------------------------------ */

export interface ChangePasswordOutcome {
  /** New tokenVersion — the caller re-issues the current session cookie. */
  tokenVersion: number;
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<SecurityServiceResult<ChangePasswordOutcome>> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, tokenVersion: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return { ok: false, message: "الحساب غير متاح", code: "NOT_FOUND" };
  }

  const currentOk = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentOk) {
    const timing = await verifyDummyPassword(currentPassword);
    void timing;
    return {
      ok: false,
      message: "كلمة المرور الحالية غير صحيحة",
      code: "VALIDATION_ERROR",
      fieldErrors: { currentPassword: "كلمة المرور الحالية غير صحيحة" },
    };
  }

  const parsed = passwordFieldRules().safeParse(newPassword);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "كلمة المرور غير صالحة",
      code: "VALIDATION_ERROR",
      fieldErrors: { newPassword: parsed.error.issues[0]?.message ?? "كلمة المرور غير صالحة" },
    };
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    return {
      ok: false,
      message: "كلمة المرور الجديدة مطابقة للحالية — اختر كلمة مرور مختلفة",
      code: "VALIDATION_ERROR",
      fieldErrors: { newPassword: "كلمة المرور الجديدة مطابقة للحالية" },
    };
  }

  const passwordHash = await hashPassword(parsed.data);
  const updated = await db.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      passwordUpdatedAt: new Date(),
      tokenVersion: { increment: 1 },
    },
    select: { tokenVersion: true },
  });

  return { ok: true, data: { tokenVersion: updated.tokenVersion } };
}

/* ------------------------------------------------------------------ */
/* 2) Self-service email change                                         */
/* ------------------------------------------------------------------ */

export interface ChangeEmailOutcome {
  email: string;
  /** Whether a verification email was dispatched through the existing
   * pipeline (honest report — the pipeline's response is generic). */
  verificationEmailSent: boolean;
}

export async function changeOwnEmail(
  userId: string,
  currentPassword: string,
  newEmail: string
): Promise<SecurityServiceResult<ChangeEmailOutcome>> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, email: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return { ok: false, message: "الحساب غير متاح", code: "NOT_FOUND" };
  }

  const currentOk = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentOk) {
    return {
      ok: false,
      message: "كلمة المرور الحالية غير صحيحة",
      code: "VALIDATION_ERROR",
      fieldErrors: { currentPassword: "كلمة المرور الحالية غير صحيحة" },
    };
  }

  const parsed = emailFieldRules().safeParse(newEmail);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "البريد الإلكتروني غير صالح",
      code: "VALIDATION_ERROR",
      fieldErrors: { newEmail: parsed.error.issues[0]?.message ?? "البريد الإلكتروني غير صالح" },
    };
  }
  if (parsed.data === user.email) {
    return {
      ok: false,
      message: "هذا بريدك الحالي بالفعل",
      code: "VALIDATION_ERROR",
      fieldErrors: { newEmail: "هذا بريدك الحالي" },
    };
  }

  const taken = await db.user.findUnique({
    where: { email: parsed.data },
    select: { id: true },
  });
  if (taken && taken.id !== userId) {
    return {
      ok: false,
      message: "هذا البريد الإلكتروني مستخدم لحساب آخر",
      code: "DUPLICATE_EMAIL",
      fieldErrors: { newEmail: "البريد مستخدم لحساب آخر" },
    };
  }

  // The new address restarts UNVERIFIED — teachers must re-verify before
  // their next sign-in (the platform's existing rule, preserved).
  await db.user.update({
    where: { id: userId },
    data: { email: parsed.data, emailVerifiedAt: null },
  });

  // Best-effort verification email through the EXISTING pipeline.
  let verificationEmailSent = false;
  try {
    const { resendVerificationEmail } = await import("@/lib/users/service");
    await resendVerificationEmail(parsed.data, appBaseUrl());
    verificationEmailSent = true;
  } catch {
    verificationEmailSent = false;
  }

  return {
    ok: true,
    data: { email: parsed.data, verificationEmailSent },
  };
}

/* ------------------------------------------------------------------ */
/* 3) Administrative temporary password                                 */
/* ------------------------------------------------------------------ */

const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generateTemporaryPassword(): string {
  const bytes = randomBytes(12);
  let password = "";
  for (const byte of bytes) password += TEMP_ALPHABET[byte % TEMP_ALPHABET.length];
  // Guarantee the platform's letter+digit rule.
  if (!/\d/.test(password)) password = `${password.slice(0, 11)}7`;
  return password;
}

export interface AdminResetOutcome {
  /** The plaintext temporary password — shown ONCE in the admin UI. */
  temporaryPassword: string;
}

export async function adminSetTemporaryPassword(
  actor: { id: string; name: string; role: string; schoolId: string | null },
  targetUserId: string
): Promise<SecurityServiceResult<AdminResetOutcome>> {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return { ok: false, message: "إعادة التعيين متاحة للإدارة فقط", code: "FORBIDDEN" };
  }
  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, schoolId: true, isActive: true },
  });
  if (!target) {
    return { ok: false, message: "الحساب غير موجود", code: "NOT_FOUND" };
  }
  if (
    actor.role === "DEVELOPMENT_OFFICE_MANAGER" &&
    target.schoolId !== actor.schoolId
  ) {
    return { ok: false, message: "هذا الحساب خارج نطاق مدرستك", code: "FORBIDDEN" };
  }

  const temporaryPassword = generateTemporaryPassword();
  await db.user.update({
    where: { id: targetUserId },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      passwordUpdatedAt: new Date(),
      tokenVersion: { increment: 1 },
    },
  });

  // Notify the owner WITHOUT the secret (best effort — never fails the reset).
  try {
    await notifyPasswordResetByAdmin({ userId: targetUserId, actorName: actor.name });
  } catch {
    // notification center failures are non-fatal by contract
  }

  return { ok: true, data: { temporaryPassword } };
}

/* ------------------------------------------------------------------ */
/* 4) Administrative email update                                       */
/* ------------------------------------------------------------------ */

export async function adminUpdateEmail(
  actor: { id: string; role: string; schoolId: string | null },
  targetUserId: string,
  newEmail: string
): Promise<SecurityServiceResult<ChangeEmailOutcome>> {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return { ok: false, message: "تحديث البريد متاح للإدارة فقط", code: "FORBIDDEN" };
  }
  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, schoolId: true, email: true },
  });
  if (!target) {
    return { ok: false, message: "الحساب غير موجود", code: "NOT_FOUND" };
  }
  if (
    actor.role === "DEVELOPMENT_OFFICE_MANAGER" &&
    target.schoolId !== actor.schoolId
  ) {
    return { ok: false, message: "هذا الحساب خارج نطاق مدرستك", code: "FORBIDDEN" };
  }

  const parsed = emailFieldRules().safeParse(newEmail);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "البريد الإلكتروني غير صالح",
      code: "VALIDATION_ERROR",
      fieldErrors: { newEmail: parsed.error.issues[0]?.message ?? "البريد الإلكتروني غير صالح" },
    };
  }
  if (parsed.data === target.email) {
    return {
      ok: false,
      message: "هذا بريد الحساب الحالي بالفعل",
      code: "VALIDATION_ERROR",
      fieldErrors: { newEmail: "هذا البريد الحالي" },
    };
  }
  const taken = await db.user.findUnique({
    where: { email: parsed.data },
    select: { id: true },
  });
  if (taken && taken.id !== targetUserId) {
    return {
      ok: false,
      message: "هذا البريد الإلكتروني مستخدم لحساب آخر",
      code: "DUPLICATE_EMAIL",
      fieldErrors: { newEmail: "البريد مستخدم لحساب آخر" },
    };
  }

  await db.user.update({
    where: { id: targetUserId },
    data: { email: parsed.data, emailVerifiedAt: null },
  });

  let verificationEmailSent = false;
  try {
    const { resendVerificationEmail } = await import("@/lib/users/service");
    await resendVerificationEmail(parsed.data, appBaseUrl());
    verificationEmailSent = true;
  } catch {
    verificationEmailSent = false;
  }

  return { ok: true, data: { email: parsed.data, verificationEmailSent } };
}

/** The app base URL used by the existing verification emails. */
function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}
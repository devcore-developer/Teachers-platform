/**
 * Phase 11 — account-security token flows.
 *
 * Contract (matches the schema comments, prisma/schema.prisma):
 *  - Raw tokens live ONLY inside the emailed URL. The database stores a
 *    SHA-256 hash (hash-at-rest), so a database leak cannot be replayed
 *    against the public endpoints.
 *  - Tokens are single-use (usedAt) and expiring (verification 24h,
 *    reset 1h).
 *  - Consuming a reset token bumps tokenVersion → every existing session
 *    JWT becomes invalid immediately.
 *  - Security emails are attempted IMMEDIATELY and never persisted with
 *    their token payload (see lib/notifications/emails.ts).
 *  - Password-reset requests NEVER reveal whether the email exists.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { appPublicOrigin } from "@/config/notifications";
import { sendSecurityEmailNow } from "@/lib/notifications/emails";
import { formatEmailDate } from "@/lib/integrations/email/templates";
import { notify } from "@/lib/notifications/service";
import { checkRateLimit } from "@/lib/security/rate-limit";

const VERIFICATION_TOKEN_HOURS = 24;
const RESET_TOKEN_HOURS = 1;
const RAW_TOKEN_BYTES = 32;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(RAW_TOKEN_BYTES).toString("base64url");
}

/** Builds an absolute action URL or null when the deployment has no origin. */
export function absoluteActionUrl(path: string): string | null {
  const origin = appPublicOrigin();
  if (!origin) return null;
  if (!path.startsWith("/")) return null;
  return `${origin}${path}`;
}

/* ------------------------------------------------------------------ */
/* Email verification → account activation                             */
/* ------------------------------------------------------------------ */

export interface CreatedTokenResult {
  ok: boolean;
  /** Raw token (return value ONLY — never logged, never stored). */
  token?: string;
  expiresAt?: Date;
  /** null when APP_PUBLIC_ORIGIN is unset — callers must report honestly. */
  actionUrl?: string | null;
}

export async function createEmailVerificationToken(userId: string): Promise<CreatedTokenResult> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false };

  // Keep at most one live token per purpose — replacing the old one
  // prevents token pile-up and makes "the newest email wins".
  await db.emailVerificationToken.deleteMany({
    where: { userId, usedAt: null },
  });

  const token = generateRawToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_HOURS * 60 * 60 * 1000);
  await db.emailVerificationToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  return { ok: true, token, expiresAt, actionUrl: absoluteActionUrl(`/account/verify-email?token=${token}`) };
}

export type ConsumeTokenFailure = "INVALID" | "EXPIRED" | "USED";

export async function consumeEmailVerificationToken(
  rawToken: string,
): Promise<
  | { ok: true; user: { id: string; name: string; email: string; schoolId: string | null; role: string }; alreadyVerified: boolean }
  | { ok: false; reason: ConsumeTokenFailure }
> {
  if (!rawToken || rawToken.length < 20 || rawToken.length > 200) {
    return { ok: false, reason: "INVALID" };
  }
  const record = await db.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!record) return { ok: false, reason: "INVALID" };
  if (record.usedAt) return { ok: false, reason: "USED" };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "EXPIRED" };

  const user = await db.user.findUnique({
    where: { id: record.userId },
    select: { id: true, name: true, email: true, schoolId: true, role: true, isActive: true, emailVerifiedAt: true },
  });
  if (!user || !user.isActive) return { ok: false, reason: "INVALID" };

  const alreadyVerified = user.emailVerifiedAt !== null;

  // Mark used + set verification timestamp atomically.
  await db.$transaction([
    db.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    ...(alreadyVerified
      ? []
      : [db.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: new Date() },
        })]),
  ]);

  // Activation event → in-app notification (+ queued welcome email for
  // the ACCOUNT category, which is never preference-gated).
  if (!alreadyVerified) {
    await notify({
      userId: user.id,
      type: "ACCOUNT_ACTIVATED",
      titleAr: "تم تفعيل حسابك بنجاح",
      bodyAr: "تم تأكيد بريدك الإلكتروني وتفعيل حسابك داخل المنصة. يمكنك الآن متابعة لوحتك التدريبية.",
      resourceType: "User",
      resourceId: user.id,
      destinationUrl: "/dashboard",
      eventId: `account-activated:${user.id}`,
      email: true,
    });
  }

  return {
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, schoolId: user.schoolId, role: user.role },
    alreadyVerified,
  };
}

/* ------------------------------------------------------------------ */
/* Password reset                                                      */
/* ------------------------------------------------------------------ */

export async function createPasswordResetToken(userId: string): Promise<CreatedTokenResult> {
  await db.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
  const token = generateRawToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);
  await db.passwordResetToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  return { ok: true, token, expiresAt, actionUrl: absoluteActionUrl(`/account/reset-password?token=${token}`) };
}

export interface PasswordResetRequestOutcome {
  /** Always true from the caller's perspective (anti-enumeration). */
  accepted: true;
  /** Global, non-sensitive deployment fact — safe to display. */
  emailConfigured: boolean;
  emailSent: boolean;
  /** True when this request was suppressed by the per-email limiter. */
  rateLimited?: boolean;
  note?: string;
}

/**
 * Phase 12 — per-email flood control for "forgot password".
 * An attacker must not be able to mail-bomb arbitrary addresses through
 * this public flow. Limits are deliberately low (3 / 15 min per email);
 * a blocked request returns the SAME anti-enumeration shape so the
 * response never becomes an account-existence oracle.
 */
const RESET_REQUEST_LIMIT = 3;
const RESET_REQUEST_WINDOW_MS = 15 * 60 * 1000;

/**
 * Handles a "forgot password" request. The outcome is IDENTICAL for
 * existing and non-existing emails — no account enumeration.
 */
export async function requestPasswordReset(rawEmail: string): Promise<PasswordResetRequestOutcome> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { accepted: true, emailConfigured: false, emailSent: false, note: "INVALID_INPUT" };
  }

  // Rate limit BEFORE any DB lookup so the limiter applies uniformly and
  // cannot be used to probe which emails exist (identical outcome either way).
  const limiter = checkRateLimit(
    "password-reset-request",
    email,
    RESET_REQUEST_LIMIT,
    RESET_REQUEST_WINDOW_MS
  );
  if (!limiter.allowed) {
    console.warn(
      `[security] password-reset request rate-limited for an address (retry in ${limiter.retryAfterSeconds}s)`
    );
    return {
      accepted: true,
      emailConfigured: false,
      emailSent: false,
      rateLimited: true,
      note: "RATE_LIMITED",
    };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, isActive: true, schoolId: true },
  });

  if (!user || !user.isActive) {
    return { accepted: true, emailConfigured: false, emailSent: false };
  }

  const created = await createPasswordResetToken(user.id);
  if (!created.ok || !created.token) {
    return { accepted: true, emailConfigured: false, emailSent: false };
  }
  if (!created.actionUrl) {
    // Deployment without APP_PUBLIC_ORIGIN — an absolute reset link cannot
    // be built, so no misleading email is sent. Recorded as NOT_CONFIGURED.
    return {
      accepted: true,
      emailConfigured: false,
      emailSent: false,
      note: "APP_PUBLIC_ORIGIN_MISSING",
    };
  }

  const outcome = await sendSecurityEmailNow({
    toEmail: email,
    userId: user.id,
    schoolId: user.schoolId,
    templateKey: "password-reset",
    params: {
      recipientName: user.name,
      resetUrl: created.actionUrl,
    },
  });

  if (outcome.ok) return { accepted: true, emailConfigured: true, emailSent: true };
  if ("configured" in outcome) {
    return { accepted: true, emailConfigured: false, emailSent: false, note: "EMAIL_NOT_CONFIGURED" };
  }
  return {
    accepted: true,
    emailConfigured: true,
    emailSent: false,
    note: `EMAIL_ERROR:${outcome.errorCategory}`,
  };
}

export type ResetPasswordResult =
  | { ok: true; userId: string }
  | { ok: false; reason: ConsumeTokenFailure | "WEAK_PASSWORD" };

/** Minimum password policy (kept simple and identical everywhere). */
export function validateNewPassword(password: string): boolean {
  return typeof password === "string" && password.length >= 8 && password.length <= 72;
}

export async function consumePasswordResetToken(
  rawToken: string,
  newPassword: string,
): Promise<ResetPasswordResult> {
  if (!validateNewPassword(newPassword)) return { ok: false, reason: "WEAK_PASSWORD" };

  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!record) return { ok: false, reason: "INVALID" };
  if (record.usedAt) return { ok: false, reason: "USED" };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "EXPIRED" };

  const user = await db.user.findUnique({
    where: { id: record.userId },
    select: { id: true, name: true, email: true, isActive: true, schoolId: true },
  });
  if (!user || !user.isActive) return { ok: false, reason: "INVALID" };

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  // Atomic: consume token + rotate password + invalidate all sessions.
  await db.$transaction([
    db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    db.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    }),
  ]);

  // Security notice — in-app (always) + immediate email (never gated).
  await notify({
    userId: user.id,
    type: "PASSWORD_CHANGED",
    titleAr: "تم تغيير كلمة مرور حسابك",
    bodyAr: `تم تغيير كلمة مرور حسابك بتاريخ ${formatEmailDate(now)}، وتم إنهاء جميع الجلسات النشطة حفاظًا على الأمان. إن لم تقم أنت بهذا التغيير فتواصل مع إدارة المدرسة فورًا.`,
    resourceType: "User",
    resourceId: user.id,
    destinationUrl: "/notifications/preferences",
    eventId: `password-changed:${record.id}`,
    email: false, // email part is sent immediately below (token-free).
  }).catch(() => null);
  await sendSecurityEmailNow({
    toEmail: user.email,
    userId: user.id,
    schoolId: user.schoolId,
    templateKey: "password-changed",
    params: { recipientName: user.name, dateText: formatEmailDate(now) },
  }).catch(() => null);

  return { ok: true, userId: user.id };
}

/** Constant-time comparison helper (used by the cron endpoint). */
export function safeSecretEquals(a: string, b: string): boolean {
  const bufA = createHash("sha256").update(a).digest();
  const bufB = createHash("sha256").update(b).digest();
  return timingSafeEqual(bufA, bufB);
}
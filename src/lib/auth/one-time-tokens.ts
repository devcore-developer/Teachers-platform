import { createHash, randomBytes } from "node:crypto";

import { db } from "@/lib/db";

/* ------------------------------------------------------------------ */
/* Single-use, expiring one-time tokens (email verification + password  */
/* reset).                                                              */
/*                                                                      */
/* Security properties:                                                 */
/*   - 256 bits of CSPRNG entropy, base64url — unguessable.             */
/*   - The database stores only the SHA-256 hash: a database leak       */
/*     cannot be replayed against the public endpoints.                 */
/*   - Expiry is enforced on consume (24h verification, 1h reset).      */
/*   - Single use is enforced atomically (conditional updateMany on     */
/*     usedAt: null) — concurrent replays cannot double-consume.        */
/*   - Tokens are NEVER logged and never embedded with other secrets.   */
/* ------------------------------------------------------------------ */

export type OneTimeTokenStatus =
  | "ok"
  | "invalid" // unknown token
  | "used" // already consumed
  | "expired";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/* ----------------------- Email verification ----------------------- */

/** Issue a fresh verification token; previous unused tokens are voided. */
export async function issueEmailVerificationToken(
  userId: string
): Promise<string> {
  const raw = generateRawToken();
  await db.emailVerificationToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  await db.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    },
  });
  return raw;
}

export interface ConsumeResult {
  status: Exclude<OneTimeTokenStatus, "ok"> | "ok";
  userId?: string;
}

/** Atomically consume a verification token if it is valid. */
export async function consumeEmailVerificationToken(
  raw: string
): Promise<ConsumeResult> {
  return db.$transaction(async (tx) => {
    const record = await tx.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(raw) },
    });
    if (!record) return { status: "invalid" as const };
    if (record.usedAt) return { status: "used" as const };
    if (record.expiresAt.getTime() <= Date.now()) {
      return { status: "expired" as const };
    }

    const consumed = await tx.emailVerificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) return { status: "used" as const };

    await tx.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });

    return { status: "ok" as const, userId: record.userId };
  });
}

/* ------------------------- Password reset -------------------------- */

/** Issue a fresh reset token; previous unused tokens are voided. */
export async function issuePasswordResetToken(userId: string): Promise<string> {
  const raw = generateRawToken();
  await db.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  await db.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  });
  return raw;
}

/**
 * Peek at a reset token WITHOUT consuming it — used by the reset page to
 * render the form or an invalid-link screen before the user types.
 */
export async function peekPasswordResetToken(
  raw: string
): Promise<OneTimeTokenStatus> {
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(raw) },
  });
  if (!record) return "invalid";
  if (record.usedAt) return "used";
  if (record.expiresAt.getTime() <= Date.now()) return "expired";
  return "ok";
}

/**
 * Atomically consume a reset token. On success the caller must set the
 * new password AND bump tokenVersion (this function bumps it inside the
 * same transaction so every existing session dies immediately).
 */
export async function consumePasswordResetToken(
  raw: string,
  newPasswordHash: string
): Promise<ConsumeResult> {
  return db.$transaction(async (tx) => {
    const record = await tx.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(raw) },
    });
    if (!record) return { status: "invalid" as const };
    if (record.usedAt) return { status: "used" as const };
    if (record.expiresAt.getTime() <= Date.now()) {
      return { status: "expired" as const };
    }

    const consumed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) return { status: "used" as const };

    const user = await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: newPasswordHash,
        tokenVersion: { increment: 1 },
      },
    });

    return { status: "ok" as const, userId: user.id };
  });
}
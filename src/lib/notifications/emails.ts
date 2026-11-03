/**
 * Phase 11 — email queueing & sending orchestration.
 *
 * Two distinct flows (kept separate on purpose):
 *
 *  1. NOTIFICATION emails (optional, preference-gated) → persisted as a
 *     QUEUED EmailDelivery row and sent later by the dispatcher. Message
 *     bodies are never stored — the dispatcher re-renders them from the
 *     linked notification at send time (dedupeKey `notif:<id>`).
 *
 *  2. ACCOUNT-SECURITY emails (verification / reset / password changed)
 *     are attempted IMMEDIATELY. Security payloads contain single-use
 *     token URLs, so they are never persisted or queued — the raw token
 *     exists only inside the rendered message. Failures are recorded with
 *     sanitized categories only.
 *
 * Honesty: nothing in this module reports success without the provider
 * confirming it (messageId present).
 */

import { db } from "@/lib/db";
import {
  appPublicOrigin,
  EMAIL_MAX_ATTEMPTS_DEFAULT,
} from "@/config/notifications";
import {
  EmailProviderError,
  resolveEmailProvider,
} from "@/lib/integrations/email/provider";
import {
  renderEmailTemplate,
  type EmailTemplateKey,
  type EmailTemplateParams,
} from "@/lib/integrations/email/templates";

export type QueueOutcome =
  | { ok: true; deliveryId: string }
  | { ok: false; reason: "DUPLICATE" | "NO_EMAIL" };

export type SecurityEmailOutcome =
  | { ok: true; messageId: string }
  | { ok: false; configured: false }
  | { ok: false; errorCategory: string };

/* ------------------------------------------------------------------ */
/* 1. Notification emails → durable queue                              */
/* ------------------------------------------------------------------ */

/**
 * Queues the email counterpart of an in-app notification. Idempotent via
 * dedupeKey (unique): retrying the same notification never double-queues.
 */
export async function queueNotificationEmail(input: {
  notificationId: string;
  userId: string;
  toEmail: string;
  category: string;
  schoolId: string | null;
  subject: string;
}): Promise<QueueOutcome> {
  if (!input.toEmail) return { ok: false, reason: "NO_EMAIL" };
  const existing = await db.emailDelivery.findUnique({
    where: { dedupeKey: `notif:${input.notificationId}` },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "DUPLICATE" };

  const row = await db.emailDelivery.create({
    data: {
      toEmail: input.toEmail,
      toUserId: input.userId,
      subject: input.subject,
      template: "generic-notification",
      category: input.category,
      schoolId: input.schoolId,
      notificationId: input.notificationId,
      status: "QUEUED",
      maxAttempts: EMAIL_MAX_ATTEMPTS_DEFAULT,
      dedupeKey: `notif:${input.notificationId}`,
    },
    select: { id: true },
  });
  return { ok: true, deliveryId: row.id };
}

/* ------------------------------------------------------------------ */
/* 2. Account-security emails → immediate, never persisted with token  */
/* ------------------------------------------------------------------ */

/**
 * Attempts a security email right now. Returns an honest outcome:
 *  - ok + messageId  → provider confirmed delivery acceptance.
 *  - configured:false → no provider is configured; the caller must tell
 *    the user the truth (the attempt is still recorded as NOT_CONFIGURED
 *    so the integrations status page reflects reality).
 *  - errorCategory → sanitized provider/network failure classification.
 */
export async function sendSecurityEmailNow(input: {
  toEmail: string;
  userId?: string | null;
  schoolId?: string | null;
  templateKey: EmailTemplateKey;
  params: EmailTemplateParams;
}): Promise<SecurityEmailOutcome> {
  const rendered = renderEmailTemplate(input.templateKey, input.params);
  if (!rendered) {
    await recordSecurityAttempt(input, null, "VALIDATION", "template rendering failed");
    return { ok: false, errorCategory: "VALIDATION" };
  }

  const resolved = resolveEmailProvider();
  if (!resolved.configured) {
    await recordSecurityAttempt(input, rendered.subject, "NOT_CONFIGURED", resolved.reason);
    return { ok: false, configured: false };
  }

  try {
    const result = await resolved.provider.send({
      to: input.toEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    await recordSecurityAttempt(
      input,
      rendered.subject,
      null,
      null,
      resolved.provider.kind,
      result.messageId,
    );
    return { ok: true, messageId: result.messageId };
  } catch (error) {
    const category =
      error instanceof EmailProviderError ? error.category : "PROVIDER";
    const detail =
      error instanceof EmailProviderError ? error.detail : "unknown provider failure";
    await recordSecurityAttempt(input, rendered.subject, category, detail, resolved.provider.kind);
    return { ok: false, errorCategory: category };
  }
}

/** Records a security-email attempt WITHOUT storing any rendered body. */
async function recordSecurityAttempt(
  input: { toEmail: string; userId?: string | null; schoolId?: string | null },
  subject: string | null,
  errorCategory: string | null,
  errorMessage: string | null,
  provider?: string,
  providerMessageId?: string,
): Promise<void> {
  const now = new Date();
  await db.emailDelivery
    .create({
      data: {
        toEmail: input.toEmail,
        ...(input.userId ? { toUserId: input.userId } : {}),
        subject: subject ?? "(security email)",
        template: "security",
        category: "ACCOUNT",
        ...(input.schoolId ? { schoolId: input.schoolId } : {}),
        status: errorCategory === null ? "SENT" : "FAILED",
        ...(provider ? { provider } : {}),
        ...(providerMessageId ? { providerMessageId } : {}),
        lastErrorCategory: errorCategory ?? undefined,
        lastErrorMessage: errorCategory === "NOT_CONFIGURED"
          ? "email provider is not configured on this deployment"
          : errorMessage ?? undefined,
        lastAttemptAt: now,
        ...(errorCategory === null ? { sentAt: now } : {}),
      },
      select: { id: true },
    })
    .catch(() => null);
}

/* ------------------------------------------------------------------ */
/* 3. Dispatcher-side rendering (no bodies stored)                     */
/* ------------------------------------------------------------------ */

/**
 * Re-renders a queued notification email at SEND time from the linked
 * notification + recipient + school. Returns null when the source rows
 * disappeared (deleted user/notification) — the row is then abandoned
 * as VALIDATION-failed rather than sent broken.
 */
export async function renderQueuedNotificationEmail(emailDeliveryId: string): Promise<
  | {
      ok: true;
      to: string;
      subject: string;
      html: string;
      text: string;
      providerKind: string;
    }
  | { ok: false; errorCategory: "VALIDATION" }
> {
  const row = await db.emailDelivery.findUnique({
    where: { id: emailDeliveryId },
    select: { toEmail: true, subject: true, notificationId: true },
  });
  if (!row || !row.notificationId) return { ok: false, errorCategory: "VALIDATION" };

  const notification = await db.notification.findUnique({
    where: { id: row.notificationId },
    select: {
      titleAr: true,
      bodyAr: true,
      destinationUrl: true,
      user: { select: { name: true, email: true, school: { select: { nameAr: true } } } },
    },
  });
  if (!notification) return { ok: false, errorCategory: "VALIDATION" };

  const origin = appPublicOrigin();
  const actionUrl = origin && notification.destinationUrl
    ? `${origin}${notification.destinationUrl}`
    : null;

  const rendered = renderEmailTemplate("generic-notification", {
    recipientName: notification.user?.name ?? null,
    schoolName: notification.user?.school?.nameAr ?? null,
    titleAr: notification.titleAr,
    bodyAr: notification.bodyAr,
    actionUrl,
  });
  if (!rendered) return { ok: false, errorCategory: "VALIDATION" };

  return {
    ok: true,
    to: row.toEmail || notification.user?.email || "",
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    providerKind: "RESEND",
  };
}
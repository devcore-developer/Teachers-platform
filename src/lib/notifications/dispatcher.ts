/**
 * Phase 11 — email outbox dispatcher (bounded, idempotent, multi-worker safe).
 *
 * Processing model:
 *  - Rows live in EmailDelivery with status QUEUED → PROCESSING → SENT/FAILED.
 *  - Claiming is a conditional updateMany(status = QUEUED → PROCESSING), so
 *    two concurrent workers can never claim/send the same row twice.
 *  - Temporary failures retry with bounded backoff (EMAIL_RETRY_BACKOFF_MINUTES)
 *    up to maxAttempts; then the row is FAILED permanently with a sanitized
 *    error category for authorized troubleshooting.
 *  - Stale QUEUED rows older than EMAIL_QUEUE_MAX_AGE_HOURS are abandoned as
 *    EXPIRED so the queue cannot grow unbounded while a provider is down.
 *  - When no provider is configured, NOTHING is claimed and the run reports
 *    configured:false — the honest state (rows stay queued, status pages
 *    explain, no fake success).
 *
 * Triggered by the secured POST /api/cron/dispatch endpoint (external
 * scheduler) — never by an assumed always-on dev server.
 */

import { db } from "@/lib/db";
import {
  EMAIL_DISPATCH_BATCH_LIMIT,
  EMAIL_QUEUE_MAX_AGE_HOURS,
  EMAIL_RETRY_BACKOFF_MINUTES,
} from "@/config/notifications";
import {
  resolveEmailProvider,
  EmailProviderError,
  type EmailProvider,
} from "@/lib/integrations/email/provider";
import { renderQueuedNotificationEmail } from "@/lib/notifications/emails";

export interface DispatchSummary {
  configured: boolean;
  note?: string;
  claimed: number;
  sent: number;
  retried: number;
  failedPermanent: number;
  expired: number;
}

function backoffMinutes(attemptNumber: number): number {
  const index = Math.min(attemptNumber - 1, EMAIL_RETRY_BACKOFF_MINUTES.length - 1);
  return EMAIL_RETRY_BACKOFF_MINUTES[Math.max(0, index)];
}

/** Mirrors the delivery outcome onto the owner's Notification row. */
async function mirrorNotificationEmailStatus(
  notificationId: string | null,
  emailStatus: string,
): Promise<void> {
  if (!notificationId) return;
  await db.notification
    .updateMany({ where: { id: notificationId }, data: { emailStatus } })
    .catch(() => null);
}

/**
 * Abandons ancient QUEUED rows (bounded sweep) as EXPIRED. Queued while
 * the provider was unconfigured must not sit forever.
 */
async function expireStaleRows(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - EMAIL_QUEUE_MAX_AGE_HOURS * 60 * 60 * 1000);
  const stale = await db.emailDelivery.findMany({
    where: { status: "QUEUED", createdAt: { lt: cutoff } },
    select: { id: true, notificationId: true },
    take: 200,
    orderBy: { createdAt: "asc" },
  });
  for (const row of stale) {
    const updated = await db.emailDelivery.updateMany({
      where: { id: row.id, status: "QUEUED" },
      data: {
        status: "FAILED",
        lastErrorCategory: "EXPIRED",
        lastErrorMessage: "queue age exceeded the configured maximum",
        lastAttemptAt: now,
      },
    });
    if (updated.count > 0) await mirrorNotificationEmailStatus(row.notificationId, "FAILED");
  }
  return stale.length;
}

/**
 * Processes up to `limit` queued emails. Pass `provider` ONLY in tests
 * (mock provider); production resolves from environment variables.
 */
export async function processEmailOutbox(options?: {
  provider?: EmailProvider;
  now?: Date;
  limit?: number;
  workerId?: string;
}): Promise<DispatchSummary> {
  const now = options?.now ?? new Date();
  const workerId = options?.workerId ?? `worker-${process.pid}`;
  const limit = Math.min(Math.max(1, options?.limit ?? EMAIL_DISPATCH_BATCH_LIMIT), 100);

  const resolved =
    options?.provider !== undefined
      ? { configured: true, provider: options.provider }
      : resolveEmailProvider();
  if (!resolved.configured) {
    // Honest no-op: nothing is claimed, nothing is reported as sent.
    await expireStaleRows(now);
    return {
      configured: false,
      note: "EMAIL_NOT_CONFIGURED — queued messages are preserved and will be attempted once a provider is configured",
      claimed: 0,
      sent: 0,
      retried: 0,
      failedPermanent: 0,
      expired: 0,
    };
  }

  await expireStaleRows(now);

  const candidates = await db.emailDelivery.findMany({
    where: { status: "QUEUED", nextAttemptAt: { lte: now } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const summary: DispatchSummary = {
    configured: true,
    claimed: 0,
    sent: 0,
    retried: 0,
    failedPermanent: 0,
    expired: 0,
  };

  for (const candidate of candidates) {
    // Optimistic claim — conditional on status so concurrent workers skip.
    const claimed = await db.emailDelivery.updateMany({
      where: { id: candidate.id, status: "QUEUED" },
      data: { status: "PROCESSING", lockedAt: now, lockedBy: workerId },
    });
    if (claimed.count !== 1) continue;
    summary.claimed += 1;

    const row = await db.emailDelivery.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        notificationId: true,
        attemptCount: true,
        maxAttempts: true,
        subject: true,
      },
    });
    if (!row) continue;

    // Render at send time (bodies are never stored).
    const rendered = await renderQueuedNotificationEmail(row.id);
    if (!rendered.ok) {
      await db.emailDelivery.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          lastErrorCategory: "VALIDATION",
          lastErrorMessage: "source notification no longer renderable",
          lastAttemptAt: now,
        },
      });
      await mirrorNotificationEmailStatus(row.notificationId, "FAILED");
      summary.failedPermanent += 1;
      continue;
    }
    if (!rendered.to) {
      await db.emailDelivery.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          lastErrorCategory: "VALIDATION",
          lastErrorMessage: "recipient address unavailable",
          lastAttemptAt: now,
        },
      });
      await mirrorNotificationEmailStatus(row.notificationId, "FAILED");
      summary.failedPermanent += 1;
      continue;
    }

    try {
      const result = await resolved.provider.send({
        to: rendered.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await db.emailDelivery.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          provider: resolved.provider.kind,
          providerMessageId: result.messageId,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          sentAt: new Date(),
          lastErrorCategory: null,
          lastErrorMessage: null,
        },
      });
      await mirrorNotificationEmailStatus(row.notificationId, "SENT");
      summary.sent += 1;
    } catch (error) {
      const category = error instanceof EmailProviderError ? error.category : "PROVIDER";
      const detail =
        error instanceof EmailProviderError ? error.detail : "unknown provider failure";
      const attemptNumber = row.attemptCount + 1;
      const permanent = attemptNumber >= row.maxAttempts;
      await db.emailDelivery.update({
        where: { id: row.id },
        data: {
          status: permanent ? "FAILED" : "QUEUED",
          attemptCount: attemptNumber,
          lastAttemptAt: new Date(),
          lastErrorCategory: category,
          lastErrorMessage: detail,
          ...(permanent
            ? {}
            : {
                nextAttemptAt: new Date(now.getTime() + backoffMinutes(attemptNumber) * 60_000),
              }),
          lockedAt: null,
          lockedBy: null,
        },
      });
      if (permanent) {
        await mirrorNotificationEmailStatus(row.notificationId, "FAILED");
        summary.failedPermanent += 1;
      } else {
        summary.retried += 1;
      }
    }
  }

  return summary;
}

/**
 * Full scheduled tick: expirations + queue processing. Reminder scans run
 * through runScheduledScans() (reminders.ts) and are invoked by the cron
 * route separately so each scan can be tested in isolation.
 */
export async function runDispatcherTick(options?: {
  provider?: EmailProvider;
  now?: Date;
  limit?: number;
}): Promise<DispatchSummary> {
  return processEmailOutbox(options);
}
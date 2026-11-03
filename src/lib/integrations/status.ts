/**
 * Phase 11 — integrations status & delivery health (role-scoped, secret-free).
 *
 * What each role sees (server-enforced):
 *  - SUPER_ADMIN: platform-wide provider configuration state (booleans +
 *    the non-secret from-address) and platform-wide delivery aggregates.
 *  - DEVELOPMENT_OFFICE_MANAGER: delivery aggregates for THEIR school only.
 *  - EDUCATIONAL_DEPUTY: read-only aggregates for granted schools.
 *  - EDUCATIONAL_SUPERVISOR / TEACHER: forbidden (they manage their own
 *    notifications & preferences instead).
 *
 * Secrets policy: API keys, CRON_SECRET and provider credentials are NEVER
 * returned — only configured/not-configured booleans. Recipient emails are
 * masked (a***@domain.tld) and no message bodies exist on delivery rows.
 */

import { db } from "@/lib/db";
import {
  EMAIL_DELIVERY_STATUSES,
  EMAIL_ERROR_CATEGORY_LABELS,
  appPublicOrigin,
} from "@/config/notifications";
import { resolveEmailProvider, maskEmail } from "@/lib/integrations/email/provider";
import type { AnalyticsActor, AnalyticsResult } from "@/lib/analytics/access";

export interface PlatformIntegrationStatus {
  email: {
    configured: boolean;
    providerKind: "RESEND" | "NONE";
    fromAddress: string | null;
    reason: string | null;
  };
  scheduler: {
    cronSecretConfigured: boolean;
    internalSchedulerEnabled: boolean;
    appOriginConfigured: boolean;
  };
}

/** Environment-derived status. Contains zero secret values by construction. */
export function getPlatformIntegrationStatus(): PlatformIntegrationStatus {
  const resolved = resolveEmailProvider();
  return {
    email: resolved.configured
      ? { configured: true, providerKind: "RESEND", fromAddress: resolved.fromAddress, reason: null }
      : { configured: false, providerKind: "NONE", fromAddress: null, reason: resolved.reason },
    scheduler: {
      cronSecretConfigured: Boolean((process.env.CRON_SECRET ?? "").trim()),
      internalSchedulerEnabled: (process.env.ENABLE_INTERNAL_SCHEDULER ?? "").trim() === "true",
      appOriginConfigured: Boolean(appPublicOrigin()),
    },
  };
}

export interface DeliveryFailureRow {
  id: string;
  subject: string;
  template: string;
  status: string;
  errorCategory: string | null;
  errorCategoryLabel: string | null;
  toEmailMasked: string;
  attemptCount: number;
  maxAttempts: number;
  provider: string | null;
  providerMessageId: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
}

export interface DeliveryHealth {
  totals: Record<string, number>;
  queueDepth: number;
  recentFailures: DeliveryFailureRow[];
  scope: "PLATFORM" | "SCHOOL";
}

/**
 * Role-scoped delivery health. Failures carry sanitized categories only —
 * the raw provider detail lives on the row for authorized operators but is
 * intentionally not surfaced through this read model either.
 */
export async function getDeliveryHealth(
  actor: AnalyticsActor,
): Promise<AnalyticsResult<DeliveryHealth>> {
  if (actor.role === "EDUCATIONAL_SUPERVISOR" || actor.role === "TEACHER") {
    return { ok: false, message: "حالة التكاملات متاحة لإدارة المنصة والمدارس فقط", code: "FORBIDDEN" };
  }

  const scope =
    actor.role === "SUPER_ADMIN"
      ? { where: {} as Record<string, unknown> }
      : await resolveScopeWhere(actor);

  if (scope === null) {
    return { ok: false, message: "لا توجد مدارس مصرّح لك بالاطلاع عليها", code: "FORBIDDEN" };
  }

  const where = scope.where;
  const scopeKind: "PLATFORM" | "SCHOOL" = "schoolId" in where ? "SCHOOL" : "PLATFORM";

  const [statusCounts, failures] = await Promise.all([
    db.emailDelivery.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    db.emailDelivery.findMany({
      where: { ...where, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        subject: true,
        template: true,
        status: true,
        toEmail: true,
        attemptCount: true,
        maxAttempts: true,
        provider: true,
        providerMessageId: true,
        lastErrorCategory: true,
        lastAttemptAt: true,
        createdAt: true,
      },
    }),
  ]);

  const totals: Record<string, number> = {};
  for (const status of EMAIL_DELIVERY_STATUSES) totals[status] = 0;
  for (const group of statusCounts) totals[group.status] = group._count._all;

  return {
    ok: true,
    data: {
      totals,
      queueDepth: totals.QUEUED ?? 0,
      scope: scopeKind,
      recentFailures: failures.map((row) => ({
        id: row.id,
        subject: row.subject,
        template: row.template,
        status: row.status,
        errorCategory: row.lastErrorCategory,
        errorCategoryLabel:
          row.lastErrorCategory &&
          row.lastErrorCategory in EMAIL_ERROR_CATEGORY_LABELS
            ? EMAIL_ERROR_CATEGORY_LABELS[
                row.lastErrorCategory as keyof typeof EMAIL_ERROR_CATEGORY_LABELS
              ]
            : null,
        toEmailMasked: maskEmail(row.toEmail),
        attemptCount: row.attemptCount,
        maxAttempts: row.maxAttempts,
        provider: row.provider,
        providerMessageId: row.providerMessageId,
        lastAttemptAt: row.lastAttemptAt ? row.lastAttemptAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      })),
    },
  };
}

/** Resolves the tenant WHERE fragment for school-level actors; null = forbidden. */
async function resolveScopeWhere(
  actor: AnalyticsActor,
): Promise<{ where: Record<string, unknown> } | null> {
  if (actor.role === "DEVELOPMENT_OFFICE_MANAGER" && actor.schoolId) {
    return { where: { schoolId: actor.schoolId } };
  }
  if (actor.role === "EDUCATIONAL_DEPUTY") {
    const { resolveReadableSchoolIds } = await import("@/lib/analytics/access");
    const readable = await resolveReadableSchoolIds(actor);
    if (!readable.ok || readable.data.length === 0) return null;
    // Aggregate across granted schools (one → exact filter, many → IN).
    return {
      where:
        readable.data.length === 1
          ? { schoolId: readable.data[0] }
          : { schoolId: { in: readable.data } },
    };
  }
  return null;
}
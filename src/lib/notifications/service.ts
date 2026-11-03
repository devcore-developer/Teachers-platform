/**
 * Phase 11 — core in-app notification service.
 *
 * Guarantees:
 *  - OWNERSHIP: every read/mutation path filters on userId server-side.
 *  - IDEMPOTENCY: event-driven notifications carry a stable eventId and
 *    the DB unique (userId, eventId) makes retries harmless — a replayed
 *    event resolves to the original row, never a duplicate.
 *  - PREFERENCES: enforced HERE, server-side, for every category except
 *    ACCOUNT (security/account messages are never gated — they are
 *    required for secure operation). Users cannot opt out of those.
 *  - SAFETY: destinationUrl passes safeInternalUrl() before storage;
 *    external URLs are dropped, not stored.
 *  - RESILIENCE: notify() never throws into the caller's business flow —
 *    a notification failure must not fail a publish/grade/issue action.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  CATEGORY_PREFERENCE_FIELD,
  NOTIFICATION_CATEGORY_BY_TYPE,
  NOTIFICATIONS_BELL_LIMIT,
  NOTIFICATIONS_MAX_SCAN,
  NOTIFICATIONS_PAGE_SIZE,
  NOTIFICATION_TYPES,
  type NotificationCategory,
  type NotificationType,
} from "@/config/notifications";
import { safeInternalUrl } from "@/lib/notifications/urls";
import { queueNotificationEmail } from "@/lib/notifications/emails";

export type NotifyOutcome =
  | { ok: true; created: boolean; notificationId: string | null }
  | { ok: false; reason: "INVALID_TYPE" | "USER_NOT_FOUND" | "USER_INACTIVE" | "ERROR" };

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  titleAr: string;
  bodyAr: string;
  titleEn?: string | null;
  bodyEn?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  destinationUrl?: string | null;
  /**
   * Stable idempotency key (unique per recipient). REQUIRED for events
   * that can be retried (fan-outs, scans); one-shot writes may omit it.
   */
  eventId?: string | null;
  /** Queue the email counterpart (respects preferences + provider state). */
  email?: boolean;
}

/* ------------------------------------------------------------------ */
/* Preferences (persisted, enforced server-side)                       */
/* ------------------------------------------------------------------ */

export interface NotificationPreferenceView {
  userId: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  assignments: boolean;
  assessments: boolean;
  courses: boolean;
  surveys: boolean;
  followups: boolean;
  certificates: boolean;
  platform: boolean;
}

/** Loads the user's preferences, creating the row with defaults on first touch. */
export async function getOrCreatePreferences(userId: string): Promise<NotificationPreferenceView> {
  const existing = await db.notificationPreference.findUnique({ where: { userId } });
  if (existing) return existing;
  try {
    return await db.notificationPreference.create({ data: { userId } });
  } catch {
    // Concurrent first-touch — re-read.
    const row = await db.notificationPreference.findUnique({ where: { userId } });
    if (!row) throw new Error("notification preference unavailable");
    return row;
  }
}

const PREFERENCE_BOOLEAN_KEYS = [
  "inAppEnabled",
  "emailEnabled",
  "assignments",
  "assessments",
  "courses",
  "surveys",
  "followups",
  "certificates",
  "platform",
] as const;

export type PreferencePatch = Partial<Record<(typeof PREFERENCE_BOOLEAN_KEYS)[number], boolean>>;

/**
 * Applies a validated boolean patch. Account-security mail is NOT part of
 * this model by design — there is no flag that can disable it anywhere.
 */
export async function updatePreferences(
  userId: string,
  patch: PreferencePatch,
): Promise<NotificationPreferenceView> {
  const data: Record<string, boolean> = {};
  for (const key of PREFERENCE_BOOLEAN_KEYS) {
    if (typeof patch[key] === "boolean") data[key] = patch[key] as boolean;
  }
  await getOrCreatePreferences(userId);
  return db.notificationPreference.update({ where: { userId }, data });
}

function categoryPrefers(pref: NotificationPreferenceView, category: NotificationCategory): boolean {
  if (category === "ACCOUNT") return true; // never gated
  const field = CATEGORY_PREFERENCE_FIELD[category];
  const value = (pref as unknown as Record<string, boolean>)[field];
  return value !== false;
}

/* ------------------------------------------------------------------ */
/* Core creation                                                       */
/* ------------------------------------------------------------------ */

async function categoryEnabledForUser(
  userId: string,
  category: NotificationCategory,
): Promise<{ pref: NotificationPreferenceView; inApp: boolean; email: boolean }> {
  const pref = await getOrCreatePreferences(userId);
  const categoryOn = categoryPrefers(pref, category);
  return {
    pref,
    // ACCOUNT (security) is always delivered in-app and by email.
    inApp: category === "ACCOUNT" ? true : pref.inAppEnabled && categoryOn,
    email: category === "ACCOUNT" ? true : pref.emailEnabled && categoryOn,
  };
}

/**
 * Creates one notification for one recipient. Safe to call from any
 * business flow; failures are reported, never thrown.
 */
export async function notify(input: NotifyInput): Promise<NotifyOutcome> {
  try {
    if (!NOTIFICATION_TYPES.includes(input.type)) {
      return { ok: false, reason: "INVALID_TYPE" };
    }
    const category = NOTIFICATION_CATEGORY_BY_TYPE[input.type];

    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        email: true,
        isActive: true,
        schoolId: true,
        notificationPreference: true,
      },
    });
    if (!user) return { ok: false, reason: "USER_NOT_FOUND" };
    if (!user.isActive) return { ok: false, reason: "USER_INACTIVE" };

    const destination = input.destinationUrl ? safeInternalUrl(input.destinationUrl) : null;
    const flags = await categoryEnabledForUser(user.id, category);

    // In-app off for this category → the event is not delivered at all:
    // the email channel is the counterpart of the same event, not an
    // independent copy. ACCOUNT (security/account) is NEVER gated.
    if (!flags.inApp) {
      return { ok: true, created: false, notificationId: null };
    }

    const created = await db.notification
      .create({
        data: {
          userId: user.id,
          type: input.type,
          category,
          titleAr: input.titleAr,
          bodyAr: input.bodyAr,
          ...(input.titleEn ? { titleEn: input.titleEn } : {}),
          ...(input.bodyEn ? { bodyEn: input.bodyEn } : {}),
          ...(input.resourceType ? { resourceType: input.resourceType } : {}),
          ...(input.resourceId ? { resourceId: input.resourceId } : {}),
          ...(destination ? { destinationUrl: destination } : {}),
          ...(input.eventId ? { eventId: input.eventId } : {}),
          emailStatus: null,
        },
        select: { id: true },
      })
      .catch((error) => {
        // Unique (userId, eventId) violation → the event was already
        // processed; idempotent replay resolves to "already created".
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          return null;
        }
        throw error;
      });

    if (!created) {
      // Replayed event: also make sure the email counterpart exists once.
      if (input.email && flags.email && input.eventId) {
        const existingNotification = await db.notification.findFirst({
          where: { userId: user.id, eventId: input.eventId ?? undefined },
          select: { id: true },
        });
        if (existingNotification) {
          await queueNotificationEmail({
            notificationId: existingNotification.id,
            userId: user.id,
            toEmail: user.email,
            category,
            schoolId: user.schoolId,
            subject: input.titleAr,
          }).catch(() => null);
        }
      }
      return { ok: true, created: false, notificationId: null };
    }

    // Email counterpart (queued — dispatcher sends it honestly).
    if (input.email && flags.email) {
      const queued = await queueNotificationEmail({
        notificationId: created.id,
        userId: user.id,
        toEmail: user.email,
        category,
        schoolId: user.schoolId,
        subject: input.titleAr,
      }).catch(() => null);
      await db.notification
        .update({
          where: { id: created.id },
          data: { emailStatus: queued && queued.ok ? "QUEUED" : "DISABLED" },
          select: { id: true },
        })
        .catch(() => null);
    } else {
      await db.notification
        .update({
          where: { id: created.id },
          data: { emailStatus: "DISABLED" },
          select: { id: true },
        })
        .catch(() => null);
    }

    return { ok: true, created: true, notificationId: created.id };
  } catch {
    return { ok: false, reason: "ERROR" };
  }
}

/**
 * Fan-out to many recipients (assignment/survey publish, reminders).
 * Duplicate ids are collapsed; the whole batch is bounded. Every
 * recipient goes through the same preference + idempotency machinery.
 */
export async function notifyMany(
  userIds: readonly string[],
  input: Omit<NotifyInput, "userId">,
): Promise<{ created: number; skipped: number; failed: number }> {
  const uniqueIds = Array.from(new Set(userIds.filter((id) => typeof id === "string" && id)));
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const CONCURRENCY = 25;
  for (let index = 0; index < uniqueIds.length; index += CONCURRENCY) {
    const slice = uniqueIds.slice(index, index + CONCURRENCY);
    const outcomes = await Promise.all(slice.map((userId) => notify({ ...input, userId })));
    for (const outcome of outcomes) {
      if (outcome.ok) {
        if (outcome.created) created += 1;
        else skipped += 1;
      } else if (outcome.reason === "USER_INACTIVE" || outcome.reason === "USER_NOT_FOUND") {
        skipped += 1;
      } else {
        failed += 1;
      }
    }
  }
  return { created, skipped, failed };
}

/* ------------------------------------------------------------------ */
/* Reads & read-state (ownership enforced on every path)               */
/* ------------------------------------------------------------------ */

export interface NotificationListItem {
  id: string;
  type: string;
  category: string;
  titleAr: string;
  bodyAr: string;
  destinationUrl: string | null;
  emailStatus: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListPage {
  items: NotificationListItem[];
  unreadCount: number;
  page: number;
  pageSize: number;
  total: number;
}

const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

export async function listNotifications(options: {
  userId: string;
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<NotificationListPage> {
  const pageSize = Math.min(
    Math.max(1, Math.floor(options.pageSize ?? NOTIFICATIONS_PAGE_SIZE)),
    50,
  );
  // Phase 12: bound the page index — an unbounded ?page= produces huge
  // OFFSET scans on the DB for no benefit (history is capped by design).
  const requestedPage = Math.min(Math.max(1, Math.floor(options.page ?? 1)), 500);
  const where = {
    userId: options.userId,
    ...(options.unreadOnly ? { readAt: null } : {}),
  };

  const [rows, total, unreadCount] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize,
      skip: (requestedPage - 1) * pageSize,
      select: {
        id: true,
        type: true,
        category: true,
        titleAr: true,
        bodyAr: true,
        destinationUrl: true,
        emailStatus: true,
        readAt: true,
        createdAt: true,
      },
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId: options.userId, readAt: null } }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      category: row.category,
      titleAr: row.titleAr,
      bodyAr: row.bodyAr,
      destinationUrl: row.destinationUrl,
      emailStatus: row.emailStatus,
      readAt: isoOrNull(row.readAt),
      createdAt: row.createdAt.toISOString(),
    })),
    unreadCount,
    page: requestedPage,
    pageSize,
    total,
  };
}

/** Latest notifications for the bell dropdown (bounded). */
export async function listRecentNotifications(
  userId: string,
  limit = NOTIFICATIONS_BELL_LIMIT,
): Promise<{ items: NotificationListItem[]; unreadCount: number }> {
  const page = await listNotifications({
    userId,
    pageSize: Math.min(Math.max(1, limit), NOTIFICATIONS_BELL_LIMIT),
    page: 1,
  });
  return { items: page.items, unreadCount: page.unreadCount };
}

export async function getUnreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

/** Marks ONE notification read — only its owner can succeed. */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<{ ok: boolean; changed: boolean }> {
  const result = await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true, changed: result.count > 0 };
}

/** Marks ALL of the user's unread notifications read — never anyone else's. */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

/** Owner-visible single notification (for navigation target checks). */
export async function getOwnNotification(userId: string, notificationId: string) {
  return db.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true, destinationUrl: true, readAt: true },
  });
}

/** Guard against unbounded scans in list surfaces. */
export const NOTIFICATIONS_SCAN_LIMIT = NOTIFICATIONS_MAX_SCAN;
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadCount,
} from "@/lib/notifications/center";

/**
 * Batch 1 — notifications API for the topbar bell.
 *
 * GET  -> the owner's latest notifications + unread count (session-scoped).
 * POST -> { action: "markAll" } or { action: "markRead", id } — the owner
 *         column is enforced server-side on every write.
 */

export const dynamic = "force-dynamic";

function relativeTime(date: Date): string {
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "الآن";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return date.toLocaleDateString("ar-SA");
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const [items, unread] = await Promise.all([
    listNotifications(user.id),
    unreadCount(user.id),
  ]);

  return NextResponse.json({
    unread,
    items: items.map((notification) => ({
      id: notification.id,
      title: notification.titleAr,
      description: notification.bodyAr,
      time: relativeTime(notification.createdAt),
      read: notification.readAt !== null,
      url: notification.destinationUrl,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  let payload: { action?: string; id?: string };
  try {
    payload = (await request.json()) as { action?: string; id?: string };
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  if (payload.action === "markAll") {
    const updated = await markAllNotificationsRead(user.id);
    return NextResponse.json({ ok: true, updated });
  }

  if (payload.action === "markRead" && payload.id) {
    const ok = await markNotificationRead(user.id, payload.id);
    return NextResponse.json({ ok });
  }

  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
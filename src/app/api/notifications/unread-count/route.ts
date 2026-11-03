/**
 * Phase 11 — GET /api/notifications/unread-count
 * Lightweight poll endpoint for the notification bell.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getUnreadCount } from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" },
      { status: 401 },
    );
  }
  const count = await getUnreadCount(user.id);
  return NextResponse.json({ ok: true, data: { count } });
}
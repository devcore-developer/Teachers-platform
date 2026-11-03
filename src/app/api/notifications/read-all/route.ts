/**
 * Phase 11 — POST /api/notifications/read-all
 * Marks ALL of the current user's unread notifications read.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { markAllNotificationsRead } from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" },
      { status: 401 },
    );
  }
  const changed = await markAllNotificationsRead(user.id);
  return NextResponse.json({ ok: true, data: { changed } });
}
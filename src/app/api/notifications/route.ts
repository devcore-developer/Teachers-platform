/**
 * Phase 11 — GET /api/notifications
 * Lists the CURRENT USER's notifications (never anyone else's).
 * Query: ?unread=1&page=2&limit=20
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { listNotifications } from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

  const result = await listNotifications({
    userId: user.id,
    unreadOnly,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(limitRaw) ? limitRaw : undefined,
  });

  return NextResponse.json({ ok: true, data: result });
}
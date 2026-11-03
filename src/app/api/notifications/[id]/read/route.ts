/**
 * Phase 11 — POST /api/notifications/[id]/read
 * Marks ONE notification read. Ownership enforced server-side: another
 * user's id (or a non-existent one) simply does not match.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { markNotificationRead } from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" },
      { status: 401 },
    );
  }
  const { id } = await context.params;
  if (!id || typeof id !== "string" || id.length > 64) {
    return NextResponse.json({ ok: false, message: "معرّف غير صالح" }, { status: 400 });
  }
  const result = await markNotificationRead(user.id, id);
  return NextResponse.json({ ok: true, data: { changed: result.changed } });
}
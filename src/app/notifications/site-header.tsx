/**
 * Phase 11 — site header (server component) with the notification bell.
 *
 * Rendered from the root layout for every route. Fail-soft: when no
 * session exists (public pages like certificate verification) the header
 * degrades to the brand bar only — it never blocks rendering.
 */

import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getUnreadCount } from "@/lib/notifications/service";
import { NotificationBell } from "@/app/notifications/bell";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "مدير المنصة",
  DEVELOPMENT_OFFICE_MANAGER: "مدير مكتب التطوير",
  EDUCATIONAL_DEPUTY: "الوكيل التعليمي",
  EDUCATIONAL_SUPERVISOR: "المشرف التربوي",
  TEACHER: "معلم",
};

export async function SiteHeader() {
  let user: { id: string; name: string; role: string } | null = null;
  let unread = 0;
  try {
    const sessionUser = await getCurrentUser();
    if (sessionUser) {
      user = { id: sessionUser.id, name: sessionUser.name, role: sessionUser.role };
      unread = await getUnreadCount(sessionUser.id);
    }
  } catch {
    user = null;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-3">
          <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1D5BD6] text-sm font-bold text-white"
            >
              م
            </span>
            <span className="text-sm font-bold text-slate-800">
              منارة قرطبة
              <span className="mr-1 text-[11px] font-medium text-slate-400">— تطوير المعلمين</span>
            </span>
          </Link>
        </div>

        {user && (
          <div className="flex items-center gap-2 sm:gap-3">
            <NotificationBell initialUnread={unread} />
            <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 sm:flex">
              <span className="max-w-40 truncate text-xs font-semibold text-slate-700">{user.name}</span>
              <span className="rounded-full bg-[#1D5BD6]/10 px-2 py-0.5 text-[10px] font-bold text-[#1D5BD6]">
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import {
  listNotifications,
  markAllNotificationsRead,
  unreadCount,
} from "@/lib/notifications/center";
import { NotificationsActions } from "./notifications-actions";

/**
 * Batch 1 — صفحة الإشعارات (all in-app notifications).
 * Server-rendered from the owner's rows — survives refreshes and
 * sessions. Each row deep-links to its real resource (course links
 * carry the actual courseId).
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

export default async function NotificationsPage() {
  const user = await requireUser();

  const [items, unread] = await Promise.all([
    listNotifications(user.id, 100),
    unreadCount(user.id),
  ]);

  async function markAll() {
    "use server";
    const current = await requireUser();
    await markAllNotificationsRead(current.id);
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">الإشعارات</h1>
          <p className="mt-1 text-sm text-slate-500">
            {unread > 0
              ? `لديك ${unread} إشعارًا غير مقروء`
              : "كل الإشعارات مقروءة"}
          </p>
        </div>
        {unread > 0 && <NotificationsActions markAllAction={markAll} />}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-slate-700">لا توجد إشعارات بعد</p>
          <p className="mt-1 text-xs text-muted-foreground">
            ستظهر هنا تنبيهات الدورات المنشورة وإتمام المتطلبات والشهادات وقياس الأثر.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {items.map((notification) => {
            const content = (
              <div className="flex items-start gap-3 px-4 py-3.5">
                <span
                  className={
                    notification.readAt
                      ? "mt-1.5 size-2 shrink-0 rounded-full bg-slate-300"
                      : "mt-1.5 size-2 shrink-0 rounded-full bg-[#1D5BD6]"
                  }
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-snug text-slate-900">
                    {notification.titleAr}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    {notification.bodyAr}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {relativeTime(notification.createdAt)}
                  </p>
                </div>
              </div>
            );
            return (
              <li key={notification.id} className="border-b border-slate-100 last:border-b-0">
                {notification.destinationUrl ? (
                  <Link
                    href={notification.destinationUrl}
                    className="block transition-colors hover:bg-slate-50"
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
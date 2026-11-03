/**
 * Phase 11 — /notifications — the complete notification history.
 *
 * Server-rendered, owner-scoped (listNotifications filters on the session
 * user id), paginated, with الكل / غير المقروءة filters, mark-as-read /
 * mark-all actions and honest empty states.
 */

import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { listNotifications } from "@/lib/notifications/service";
import { AccessDenied, Card, EmptyState, PageHeader } from "@/app/assignments/ui";
import { CategoryChip, EmailStatusChip, formatNotificationDate } from "@/app/notifications/ui";
import { MarkAllReadButton, RowMarkReadButton } from "@/app/notifications/notification-actions";
import { NOTIFICATIONS_PAGE_SIZE } from "@/config/notifications";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ unread?: string; page?: string }>;
}

export default async function NotificationsPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد للوصول إلى إشعاراتك" />;
  }

  const params = await searchParams;
  const unreadOnly = params.unread === "1";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const result = await listNotifications({
    userId: user.id,
    unreadOnly,
    page,
    pageSize: NOTIFICATIONS_PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const filterLink = (nextUnread: "0" | "1", label: string, active: boolean) => (
    <Link
      href={nextUnread === "1" ? "/notifications?unread=1" : "/notifications"}
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "border-[#1D5BD6] bg-[#1D5BD6] text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-[#1D5BD6] hover:text-[#1D5BD6]"
      }`}
    >
      {label}
    </Link>
  );

  const pageLink = (targetPage: number, label: string, enabled: boolean) =>
    enabled ? (
      <Link
        href={`/notifications?${unreadOnly ? "unread=1&" : ""}page=${targetPage}`}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#1D5BD6] hover:text-[#1D5BD6]"
      >
        {label}
      </Link>
    ) : (
      <span className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-300">
        {label}
      </span>
    );

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <PageHeader
        title="الإشعارات"
        subtitle={`سجلك الكامل — ${result.unreadCount} إشعارًا غير مقروء من إجمالي ${result.total}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {filterLink("0", "الكل", !unreadOnly)}
            {filterLink("1", "غير المقروءة", unreadOnly)}
            <MarkAllReadButton disabled={result.unreadCount === 0} />
            <Link
              href="/notifications/preferences"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#1D5BD6] hover:text-[#1D5BD6]"
            >
              تفضيلات الإشعارات
            </Link>
          </div>
        }
      />

      <Card>
        {result.items.length === 0 ? (
          <EmptyState
            title={unreadOnly ? "لا توجد إشعارات غير مقروءة" : "لا توجد إشعارات بعد"}
            hint={
              unreadOnly
                ? "أحسنت — كل شيء مقروء. عد إلى علامة «الكل» لاستعراض السجل الكامل."
                : "ستظهر هنا تحديثات الواجبات والاختبارات والمقررات والشهادات والاستبيانات والمتابعات فور صدورها."
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {result.items.map((item) => {
              const content = (
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-slate-200" : "bg-[#1D5BD6]"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm ${item.readAt ? "font-semibold text-slate-700" : "font-bold text-slate-900"}`}>
                        {item.titleAr}
                      </span>
                      <CategoryChip category={item.category} />
                      <EmailStatusChip status={item.emailStatus} />
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{item.bodyAr}</p>
                    <p className="mt-1 text-[10px] text-slate-400" dir="ltr">
                      {formatNotificationDate(item.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {!item.readAt && <RowMarkReadButton notificationId={item.id} />}
                    {item.destinationUrl && (
                      <Link
                        href={item.destinationUrl}
                        className="rounded-lg bg-[#1D5BD6] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-[#174aa8]"
                      >
                        فتح الوجهة
                      </Link>
                    )}
                  </div>
                </div>
              );
              return (
                <li key={item.id} className={`px-4 py-4 ${item.readAt ? "" : "bg-blue-50/30"}`}>
                  {content}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="mt-4 flex items-center justify-between">
        {pageLink(page - 1, "السابق", page > 1)}
        <span className="text-xs text-slate-500" dir="ltr">
          {page} / {totalPages}
        </span>
        {pageLink(page + 1, "التالي", page < totalPages)}
      </div>
    </div>
  );
}
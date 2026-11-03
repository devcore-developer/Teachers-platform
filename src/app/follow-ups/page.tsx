/**
 * Phase 9 — "متابعة التطبيق" list: follow-up records within the
 * actor's real scope (manager = school, supervisor = responsible-or-
 * covered, deputy = read-only within grants), with status/upcoming
 * filters and summary tiles.
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { getFollowUpMetrics, listFollowUps } from "@/lib/followups/service";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  formatDate,
} from "@/app/assignments/ui";
import { FollowUpStatusBadge, SharedBadge } from "@/app/follow-ups/ui";

export const dynamic = "force-dynamic";

function actorFrom(user: { id: string; role: string; schoolId: string | null }): SurveyActor | null {
  if (
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    user.role === "EDUCATIONAL_SUPERVISOR" ||
    user.role === "EDUCATIONAL_DEPUTY"
  ) {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; teacherId?: string; upcoming?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="سجلات المتابعة متاحة للأدوار الإدارية المدرسية فقط — للمعلّم: السجلات المشتركة معك في «سجلات المتابعة»." />;
  }

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const [listResult, metricsResult] = await Promise.all([
    listFollowUps(ctx, {
      status: params.status,
      teacherId: params.teacherId,
      upcoming: params.upcoming,
      page,
    }),
    getFollowUpMetrics(ctx),
  ]);
  if (!listResult.ok) return <AccessDenied hint={listResult.message} />;
  const { rows, total, pageCount, page: currentPage } = listResult.data;
  const metrics = metricsResult.ok ? metricsResult.data : null;
  const isDeputy = ctx.role === "EDUCATIONAL_DEPUTY";

  return (
    <div>
      <PageHeader
        title="متابعة التطبيق"
        subtitle={
          isDeputy
            ? "عرض للقراءة فقط — تقدم المتابعة ضمن نطاق التفويض"
            : ctx.role === "EDUCATIONAL_SUPERVISOR"
              ? "سجلات متابعة التطبيق الصفي ضمن نطاق إشرافك"
              : "سجلات متابعة التطبيق الصفي لمعلمي المدرسة"
        }
        actions={
          isDeputy ? null : (
            <Link
              href="/follow-ups/new"
              className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
            >
              + سجل متابعة
            </Link>
          )
        }
      />

      {metrics ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="إجمالي السجلات" value={metrics.total} tone="brand" />
          <StatTile label="مجدولة / قيد التنفيذ" value={`${metrics.planned} / ${metrics.inProgress}`} />
          <StatTile
            label="نسبة الإنجاز (المقام: الكلي − الملغاة)"
            value={metrics.completionRatePercent === null ? "—" : `${metrics.completionRatePercent}%`}
            tone="success"
          />
          <StatTile label="مواعيد قادمة" value={metrics.upcomingCount} tone="warning" />
        </div>
      ) : null}

      <Card>
        <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">الحالة</label>
            <select
              id="status"
              name="status"
              defaultValue={params.status ?? ""}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6]"
            >
              <option value="">الكل</option>
              <option value="PLANNED">مجدولة</option>
              <option value="IN_PROGRESS">قيد التنفيذ</option>
              <option value="COMPLETED">مكتملة</option>
              <option value="CANCELLED">ملغاة</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="upcoming">المواعيد</label>
            <select
              id="upcoming"
              name="upcoming"
              defaultValue={params.upcoming ?? ""}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6]"
            >
              <option value="">الكل</option>
              <option value="1">مواعيد قادمة فقط</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            تصفية
          </button>
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title="لا توجد سجلات متابعة مطابقة"
            hint="أنشئ سجل متابعة لمعلم بعد برنامج تدريبي لتوثيق التطبيق الصفي والدعم المطلوب."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">العنوان</th>
                  <th className="px-3 py-2 font-medium">المعلم</th>
                  <th className="px-3 py-2 font-medium">المشرف المسؤول</th>
                  <th className="px-3 py-2 font-medium">التاريخ</th>
                  <th className="px-3 py-2 font-medium">المتابعة القادمة</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium">المشاركة</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3">
                      <p className="max-w-56 font-medium text-slate-800">{row.titleAr}</p>
                      {row.contentTitle || row.surveyTitle ? (
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">
                          {row.contentTitle ?? row.surveyTitle}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{row.teacherName}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{row.supervisorName}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatDate(row.followUpDate)}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatDate(row.nextFollowUpAt)}</td>
                    <td className="px-3 py-3"><FollowUpStatusBadge status={row.status} /></td>
                    <td className="px-3 py-3"><SharedBadge shared={row.sharedWithTeacher} /></td>
                    <td className="px-3 py-3">
                      <Link href={`/follow-ups/${row.id}`} className="text-xs font-medium text-[#1D5BD6] hover:underline">
                        التفاصيل
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 ? (
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>الصفحة {currentPage} من {pageCount} — {total} سجل</span>
            <div className="flex gap-2">
              {currentPage > 1 ? (
                <Link href={`/follow-ups?page=${currentPage - 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">السابق</Link>
              ) : null}
              {currentPage < pageCount ? (
                <Link href={`/follow-ups?page=${currentPage + 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">التالي</Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
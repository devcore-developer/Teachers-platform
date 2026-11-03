/**
 * Phase 9 — "إدارة الاستبيانات": filterable list with real metrics.
 * Server component; every row is tenant-scoped by the service (managers
 * see their school, supervisors see their OWN surveys, deputies get a
 * read-only view of their granted school).
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { getSurveyMetrics, listSurveysForManage } from "@/lib/surveys/service";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  formatDate,
} from "@/app/assignments/ui";
import { AnonymousBadge, SurveyStageBadge, SurveyStatusBadge } from "@/app/surveys/ui";

export const dynamic = "force-dynamic";

function actorFrom(user: {
  id: string;
  role: string;
  schoolId: string | null;
}): SurveyActor | null {
  if (
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    user.role === "EDUCATIONAL_SUPERVISOR" ||
    user.role === "EDUCATIONAL_DEPUTY" ||
    user.role === "SUPER_ADMIN"
  ) {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

export default async function SurveysManagePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx || ctx.role === "SUPER_ADMIN") {
    return (
      <AccessDenied hint="إدارة الاستبيانات متاحة للأدوار المدرسية — حساب المنصة يطلع على الإحصاءات العامة من لوحة قياس الأثر." />
    );
  }

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const [listResult, metricsResult] = await Promise.all([
    listSurveysForManage(ctx, { q: params.q, status: params.status, page }),
    getSurveyMetrics(ctx),
  ]);
  if (!listResult.ok) return <AccessDenied hint={listResult.message} />;
  const { rows, total, pageCount, page: currentPage } = listResult.data;
  const metrics = metricsResult.ok ? metricsResult.data : null;

  const isDeputy = ctx.role === "EDUCATIONAL_DEPUTY";

  return (
    <div>
      <PageHeader
        title="إدارة الاستبيانات"
        subtitle={
          isDeputy
            ? "عرض للقراءة فقط — استبيانات المدرسة ضمن نطاق التفويض"
            : ctx.role === "EDUCATIONAL_SUPERVISOR"
              ? "استبياناتك الخاصة ضمن نطاق إشرافك"
              : "إنشاء استبيانات الأثر ومتابعة التطبيق وإدارة دورة حياتها"
        }
        actions={
          isDeputy ? null : (
            <Link
              href="/surveys/new"
              className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
            >
              + استبيان جديد
            </Link>
          )
        }
      />

      {metrics ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="إجمالي الاستبيانات" value={metrics.totalSurveys} tone="brand" />
          <StatTile label="منشورة حاليًا" value={metrics.openSurveys} tone="success" />
          <StatTile label="ردود مستلمة" value={metrics.submittedResponses} />
          <StatTile
            label="متوسط نسبة الاستجابة"
            value={metrics.averageResponseRatePercent === null ? "—" : `${metrics.averageResponseRatePercent}%`}
            tone="warning"
          />
        </div>
      ) : null}

      <Card>
        <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">بحث</label>
            <input
              id="q"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="عنوان الاستبيان…"
              className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">الحالة</label>
            <select
              id="status"
              name="status"
              defaultValue={params.status ?? ""}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6]"
            >
              <option value="">الكل</option>
              <option value="DRAFT">مسودة</option>
              <option value="PUBLISHED">منشور</option>
              <option value="CLOSED">مغلق</option>
              <option value="ARCHIVED">مؤرشف</option>
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
            title="لا توجد استبيانات مطابقة"
            hint="ابدأ بإنشاء استبيان جديد لقياس أثر البرامج التدريبية أو متابعة التطبيق الصفي."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">العنوان</th>
                  <th className="px-3 py-2 font-medium">المرحلة</th>
                  <th className="px-3 py-2 font-medium">الجمهور</th>
                  <th className="px-3 py-2 font-medium">الأسئلة</th>
                  <th className="px-3 py-2 font-medium">الردود</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium">المؤلف</th>
                  <th className="px-3 py-2 font-medium">النشر</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3">
                      <p className="max-w-64 font-medium text-slate-800">{row.titleAr}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <AnonymousBadge anonymous={row.anonymous} />
                      </div>
                    </td>
                    <td className="px-3 py-3"><SurveyStageBadge stage={row.stage} /></td>
                    <td className="px-3 py-3 text-xs text-slate-600">{row.audienceLabel}</td>
                    <td className="px-3 py-3 text-slate-600">{row.questionsCount}</td>
                    <td className="px-3 py-3 text-slate-600">{row.submittedCount}</td>
                    <td className="px-3 py-3"><SurveyStatusBadge status={row.status} /></td>
                    <td className="px-3 py-3 text-xs text-slate-500">{row.ownerName}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatDate(row.publishedAt)}</td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/surveys/${row.id}`}
                        className="text-xs font-medium text-[#1D5BD6] hover:underline"
                      >
                        {isDeputy ? "النتائج" : "التفاصيل"}
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
            <span>الصفحة {currentPage} من {pageCount} — {total} استبيان</span>
            <div className="flex gap-2">
              {currentPage > 1 ? (
                <Link href={`/surveys?page=${currentPage - 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">السابق</Link>
              ) : null}
              {currentPage < pageCount ? (
                <Link href={`/surveys?page=${currentPage + 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">التالي</Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
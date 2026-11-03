/**
 * Phase 7 — "إدارة التكليفات" (office manager): filterable list with
 * completion signals. Server component; every row is tenant-scoped by
 * the service (schoolId comes from the session, not the URL).
 */
import Link from "next/link";

import { requireAdminContext } from "@/lib/auth/dev-admin";
import { listAssignmentsForManage } from "@/lib/assignments/service";
import { AUDIENCE_MODE_LABELS, type AudienceMode } from "@/config/assignments";
import {
  AccessDenied,
  AssignmentStatusBadge,
  Card,
  EmptyState,
  PageHeader,
  formatDate,
} from "@/app/assignments/ui";

export const dynamic = "force-dynamic";

export default async function AssignmentsManagePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const ctx = await requireAdminContext();
  if (ctx.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return <AccessDenied hint="إدارة التكليفات متاحة لمديري مكاتب التطوير فقط." />;
  }

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const result = await listAssignmentsForManage(ctx, {
    q: params.q,
    status: params.status,
    page,
  });
  if (!result.ok) {
    return <AccessDenied hint={result.message} />;
  }
  const { rows, total, pageCount, page: currentPage } = result.data;

  return (
    <div>
      <PageHeader
        title="إدارة التكليفات"
        subtitle="إنشاء التكليفات الموجهة للمعلمين ومتابعة حالتها ونسب الإنجاز"
        actions={
          <Link
            href="/assignments/new"
            className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
          >
            + تكليف جديد
          </Link>
        }
      />

      <Card>
        <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">بحث بالعنوان</label>
            <input
              id="q"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="اكتب جزءًا من العنوان…"
              className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
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
          <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            تصفية
          </button>
        </form>

        {rows.length === 0 ? (
          <EmptyState title="لا توجد تكليفات مطابقة" hint="ابدأ بإنشاء تكليف جديد من الزر أعلاه." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">العنوان</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium">الفئة المستهدفة</th>
                  <th className="px-3 py-2 font-medium">الاستحقاق</th>
                  <th className="px-3 py-2 font-medium">الدرجات</th>
                  <th className="px-3 py-2 font-medium">التسليمات</th>
                  <th className="px-3 py-2 font-medium">قيد المراجعة</th>
                  <th className="px-3 py-2 font-medium">مُقيَّمة</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-800">{row.titleAr}</p>
                      {row.titleEn ? <p className="text-xs text-slate-400" dir="ltr">{row.titleEn}</p> : null}
                    </td>
                    <td className="px-3 py-3"><AssignmentStatusBadge status={row.status} /></td>
                    <td className="px-3 py-3 text-slate-600">
                      {AUDIENCE_MODE_LABELS[row.audienceMode as AudienceMode] ?? row.audienceMode}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{formatDate(row.dueAt)}</td>
                    <td className="px-3 py-3 text-slate-600">{row.totalPoints}</td>
                    <td className="px-3 py-3 text-slate-600">{row.submissionsTotal}</td>
                    <td className="px-3 py-3">
                      {row.pendingCount > 0 ? (
                        <span className="font-semibold text-amber-600">{row.pendingCount}</span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {row.gradedCount > 0 ? (
                        <span className="font-semibold text-emerald-600">{row.gradedCount}</span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/assignments/${row.id}`} className="text-xs font-medium text-[#1D5BD6] hover:underline">
                          التفاصيل
                        </Link>
                        {row.status !== "ARCHIVED" ? (
                          <Link href={`/assignments/${row.id}/edit`} className="text-xs font-medium text-slate-500 hover:underline">
                            تعديل
                          </Link>
                        ) : null}
                        <Link href={`/assignments/${row.id}/submissions`} className="text-xs font-medium text-slate-500 hover:underline">
                          التسليمات
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 ? (
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>الصفحة {currentPage} من {pageCount} — {total} تكليفًا</span>
            <div className="flex gap-2">
              {currentPage > 1 ? (
                <Link href={`/assignments?page=${currentPage - 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">السابق</Link>
              ) : null}
              {currentPage < pageCount ? (
                <Link href={`/assignments?page=${currentPage + 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">التالي</Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
/**
 * Phase 7 — "تسليمات المعلمين" review workspace (office manager +
 * educational supervisor). Supervisors are narrowed to their persisted
 * teacher set inside the service; URL manipulation cannot widen it.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { listSubmissionsForReview } from "@/lib/assignments/service";
import { canReviewSubmissions, type AssignmentActor } from "@/lib/assignments/access";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
  SubmissionStatusBadge,
  formatDate,
} from "@/app/assignments/ui";

export const dynamic = "force-dynamic";

export default async function AssignmentSubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const { status } = await searchParams;
  const user = await getCurrentUser();
  if (!user || !canReviewSubmissions(user.role) || !user.schoolId) {
    return <AccessDenied hint="مراجعة التسليمات متاحة للمشرفين التربويين ومديري مكاتب التطوير فقط." />;
  }
  // canReviewSubmissions narrows the runtime set to exactly these two
  // roles — the literal below keeps the union type intact for callers.
  const ctx: AssignmentActor =
    user.role === "DEVELOPMENT_OFFICE_MANAGER"
      ? { id: user.id, role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: user.schoolId }
      : { id: user.id, role: "EDUCATIONAL_SUPERVISOR", schoolId: user.schoolId };

  const rows = await listSubmissionsForReview(ctx, id, { status });
  if (!rows.ok) {
    if (rows.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={rows.message} />;
  }

  return (
    <div>
      <PageHeader
        title="تسليمات المعلمين"
        subtitle="مراجعة محتوى التسليمات والمرفقات ثم التقييم أو الإعادة للتعديل"
        actions={
          <Link
            href={`/assignments/${id}`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            بيانات التكليف
          </Link>
        }
      />

      <Card>
        <form className="mb-4 flex items-end gap-3" method="get">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">الحالة</label>
            <select
              id="status"
              name="status"
              defaultValue={status ?? ""}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6]"
            >
              <option value="">الكل</option>
              <option value="SUBMITTED">مُسلَّم</option>
              <option value="UNDER_REVIEW">قيد المراجعة</option>
              <option value="RETURNED">أُعيد للتعديل</option>
              <option value="GRADED">مُقيَّم</option>
            </select>
          </div>
          <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            تصفية
          </button>
        </form>

        {rows.data.length === 0 ? (
          <EmptyState
            title="لا توجد تسليمات مطابقة"
            hint="ستظهر هنا تسليمات المعلمين المستهدفين بعد تقديمها."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">المعلم</th>
                  <th className="px-3 py-2 font-medium">الفرع</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium">التسليم</th>
                  <th className="px-3 py-2 font-medium">تعديلات</th>
                  <th className="px-3 py-2 font-medium">متأخر</th>
                  <th className="px-3 py-2 font-medium">الدرجة</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.data.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3 font-medium text-slate-800">{row.teacherName}</td>
                    <td className="px-3 py-3 text-slate-500">{row.branchName ?? "—"}</td>
                    <td className="px-3 py-3"><SubmissionStatusBadge status={row.status} /></td>
                    <td className="px-3 py-3 text-slate-600">{formatDate(row.lastSubmittedAt)}</td>
                    <td className="px-3 py-3 text-slate-600">{row.resubmitCount}</td>
                    <td className="px-3 py-3">
                      {row.isLate ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">متأخر</span>
                      ) : (
                        <span className="text-xs text-slate-400">في الموعد</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {row.scoreTotal !== null ? (
                        <span className="font-semibold text-emerald-600">{row.scoreTotal}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/assignments/${id}/submissions/${row.id}`}
                        className="text-xs font-medium text-[#1D5BD6] hover:underline"
                      >
                        مراجعة وتقييم
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
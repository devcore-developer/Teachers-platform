/**
 * Phase 7 — "مراجعة التسليمات" cross-assignment review queue
 * (educational supervisor + office manager). Supervisors see ONLY their
 * persisted assigned teachers — the narrowing happens inside the
 * service from TeacherSupervisorAssignment rows, never from the URL.
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { canReviewSubmissions, type AssignmentActor } from "@/lib/assignments/access";
import { listReviewQueue } from "@/lib/assignments/service";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
  SubmissionStatusBadge,
  formatDate,
} from "@/app/assignments/ui";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
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

  const { status } = await searchParams;
  const result = await listReviewQueue(ctx, { status });
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const rows = result.data;

  return (
    <div>
      <PageHeader
        title="مراجعة التسليمات"
        subtitle={
          ctx.role === "EDUCATIONAL_SUPERVISOR"
            ? "تسليمات المعلمين المشرف عليهم عبر كل التكليفات"
            : "تسليمات معلمي مدرستك عبر كل التكليفات"
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

        {rows.length === 0 ? (
          <EmptyState
            title="لا توجد تسليمات مطابقة"
            hint="ستظهر هنا تسليمات المعلمين فور تقديمها ضمن نطاقك."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">التكليف</th>
                  <th className="px-3 py-2 font-medium">المعلم</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium">آخر تسليم</th>
                  <th className="px-3 py-2 font-medium">متأخر</th>
                  <th className="px-3 py-2 font-medium">الدرجة</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.submissionId} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3">
                      <Link
                        href={`/assignments/${row.assignmentId}/submissions`}
                        className="font-medium text-slate-800 hover:text-[#1D5BD6] hover:underline"
                      >
                        {row.assignmentTitle}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{row.teacherName}</td>
                    <td className="px-3 py-3"><SubmissionStatusBadge status={row.status} /></td>
                    <td className="px-3 py-3 text-slate-600">{formatDate(row.lastSubmittedAt)}</td>
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
                        href={`/assignments/${row.assignmentId}/submissions/${row.submissionId}`}
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
/**
 * Phase 7 — "التكليفات" teacher workspace list. Rows are filtered by
 * server-side targeting (school + audience) — a teacher can never see
 * another school's or a non-targeted assignment.
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { listTeacherAssignments } from "@/lib/assignments/service";
import {
  AccessDenied,
  AssignmentStatusBadge,
  Card,
  EmptyState,
  PageHeader,
  SubmissionStatusBadge,
  formatDate,
} from "@/app/assignments/ui";

export const dynamic = "force-dynamic";

const WINDOW_LABELS: Record<string, string> = {
  open: "التسليم مفتوح",
  late: "التسليم متاح متأخرًا",
  closed: "انتهى موعد التسليم",
};

export default async function MyAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || user.role !== "TEACHER") {
    return <AccessDenied hint="قائمة التكليفات متاحة للمعلمين فقط." />;
  }

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const result = await listTeacherAssignments(user, {
    q: params.q,
    status: params.status,
    page,
  });
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const { rows, total, pageCount, page: currentPage } = result.data;

  return (
    <div>
      <PageHeader
        title="التكليفات"
        subtitle="التكليفات الموجهة إليك من مكتب التطوير بمدرستك"
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
              <option value="PUBLISHED">منشور</option>
              <option value="CLOSED">مغلق</option>
            </select>
          </div>
          <button type="submit" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            تصفية
          </button>
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title="لا توجد تكليفات موجَّهة إليك حاليًا"
            hint="ستظهر هنا التكليفات فور نشرها وتوجيهها لك."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/my-assignments/${row.id}`}
                      className="text-sm font-semibold text-slate-800 hover:text-[#1D5BD6] hover:underline"
                    >
                      {row.titleAr}
                    </Link>
                    <AssignmentStatusBadge status={row.status} />
                    {row.myStatus ? <SubmissionStatusBadge status={row.myStatus} /> : null}
                    {row.myIsLate ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        سُلِّم متأخرًا
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    الاستحقاق: {formatDate(row.dueAt)} — {WINDOW_LABELS[row.windowState] ?? ""}
                    {row.courseTitle ? ` — ${row.courseTitle}` : ""}
                    {row.myScoreTotal !== null ? ` — الدرجة: ${row.myScoreTotal}/${row.totalPoints}` : ""}
                  </p>
                </div>
                <Link
                  href={`/my-assignments/${row.id}`}
                  className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
                >
                  {row.myStatus ? "عرض التسليم" : "فتح التكليف"}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {pageCount > 1 ? (
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>الصفحة {currentPage} من {pageCount} — {total} تكليفًا</span>
            <div className="flex gap-2">
              {currentPage > 1 ? (
                <Link href={`/my-assignments?page=${currentPage - 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">السابق</Link>
              ) : null}
              {currentPage < pageCount ? (
                <Link href={`/my-assignments?page=${currentPage + 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">التالي</Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
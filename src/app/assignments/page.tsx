/**
 * Phase 7 (Batch 3 revision) — "التكليفات والمتابعة" — role-aware root:
 *
 *   DEVELOPMENT_OFFICE_MANAGER / SCHOOL_MANAGER → the full management
 *     workspace exactly as before (create, publish, submissions, grading).
 *   EDUCATIONAL_SUPERVISOR → READ-ONLY register of assignments that
 *     target their assigned teachers, with a jump into submissions
 *     review (their existing review capability, unchanged).
 *   SUPER_ADMIN → READ-ONLY platform-wide register, school-labelled.
 *
 * The branch decision happens on the session user BEFORE any admin
 * context is required — supervisors and the platform owner are no
 * longer bounced to /forbidden by the old office-manager-only guard.
 */
import Link from "next/link";

import { requireAdminContext } from "@/lib/auth/dev-admin";
import { requireUser } from "@/lib/auth/session";
import { listAssignmentsForManage } from "@/lib/assignments/service";
import {
  listAssignmentsForSupervisor,
  listAssignmentsPlatform,
} from "@/lib/assignments/read-scope";
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

type SearchParams = Promise<{ q?: string; status?: string; page?: string }>;

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();

  /* ---------------------------------------------------------------- */
  /* School managers — the unchanged management workspace              */
  /* ---------------------------------------------------------------- */
  if (
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    user.role === "SCHOOL_MANAGER"
  ) {
    const ctx = await requireAdminContext();
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

  /* ---------------------------------------------------------------- */
  /* Supervisor — read-only register for assigned teachers             */
  /* ---------------------------------------------------------------- */
  if (user.role === "EDUCATIONAL_SUPERVISOR") {
    const result = await listAssignmentsForSupervisor({
      id: user.id,
      role: user.role,
      schoolId: user.schoolId,
    });
    if (!result.ok) {
      return <AccessDenied hint={result.message ?? "غير مصرح"} />;
    }

    return (
      <div>
        <PageHeader
          title="التكليفات والمتابعة"
          subtitle="قراءة فقط — التكليفات المنشورة التي تشمل معلميك المسندين، مع مراجعة التسليمات"
        />
        <Card>
          {result.rows.length === 0 ? (
            <EmptyState
              title="لا توجد تكليفات تشمل معلميك حاليًا"
              hint="ستظهر هنا كل تكليفات مدرستك الموجهة لمعلميك المسندين فور نشرها."
            />
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
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
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
                        <Link
                          href={`/assignments/${row.id}/submissions`}
                          className="text-xs font-medium text-[#1D5BD6] hover:underline"
                        >
                          مراجعة التسليمات
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

  /* ---------------------------------------------------------------- */
  /* Platform owner — read-only cross-school register                  */
  /* ---------------------------------------------------------------- */
  if (user.role === "SUPER_ADMIN") {
    const params = await searchParams;
    const result = await listAssignmentsPlatform({
      q: params.q,
      status: params.status,
      page: Number(params.page ?? "1") || 1,
    });

    return (
      <div>
        <PageHeader
          title="التكليفات — سجل المنصة"
          subtitle="قراءة فقط — جميع التكليفات عبر المدارس. الإدارة الفعلية تتم داخل مساحة كل مدرسة."
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

          {result.rows.length === 0 ? (
            <EmptyState title="لا توجد تكليفات مطابقة" hint="ستظهر هنا تكليفات جميع المدارس المسجلة." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">العنوان</th>
                    <th className="px-3 py-2 font-medium">المدرسة</th>
                    <th className="px-3 py-2 font-medium">الحالة</th>
                    <th className="px-3 py-2 font-medium">الاستحقاق</th>
                    <th className="px-3 py-2 font-medium">التسليمات</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-3 font-medium text-slate-800">{row.titleAr}</td>
                      <td className="px-3 py-3 text-slate-600">{row.schoolName ?? "—"}</td>
                      <td className="px-3 py-3"><AssignmentStatusBadge status={row.status} /></td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.dueAt)}</td>
                      <td className="px-3 py-3 text-slate-600">{row.submissionsTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.pageCount > 1 ? (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>الصفحة {result.page} من {result.pageCount} — {result.total} تكليفًا</span>
              <div className="flex gap-2">
                {result.page > 1 ? (
                  <Link href={`/assignments?page=${result.page - 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">السابق</Link>
                ) : null}
                {result.page < result.pageCount ? (
                  <Link href={`/assignments?page=${result.page + 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">التالي</Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <AccessDenied hint="هذه الوحدة متاحة لإدارة المكتب والمدارس والمشرفين التربويين." />
  );
}
/**
 * Phase 8 (Batch 3 revision) — "الشهادات" — role-aware root:
 *
 *   DEVELOPMENT_OFFICE_MANAGER / SCHOOL_MANAGER → the full management
 *     workspace exactly as before (metrics, eligibility, issue, revoke).
 *   EDUCATIONAL_SUPERVISOR → READ-ONLY list of certificates belonging to
 *     their assigned teachers, each opening the standard certificate view.
 *   SUPER_ADMIN → READ-ONLY platform-wide register, school-labelled.
 *     Issuance stays manager-only (enforced again by the service layer).
 */
import Link from "next/link";

import { requireAdminContext } from "@/lib/auth/dev-admin";
import { requireUser } from "@/lib/auth/session";
import {
  getCertificateMetrics,
  listCertificatesForManage,
} from "@/lib/certificates/service";
import {
  listCertificatesForSupervisor,
  listCertificatesPlatform,
} from "@/lib/certificates/read-scope";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  formatDate,
} from "@/app/assignments/ui";
import {
  CertificateStatusBadge,
  EffectiveStatusBadge,
} from "@/app/certificates/ui";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; status?: string; page?: string }>;

export default async function CertificatesPage({
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
    const [listResult, metricsResult] = await Promise.all([
      listCertificatesForManage(ctx, { q: params.q, status: params.status, page }),
      getCertificateMetrics(ctx),
    ]);
    if (!listResult.ok) return <AccessDenied hint={listResult.message} />;
    const { rows, total, pageCount, page: currentPage } = listResult.data;
    const metrics = metricsResult.ok ? metricsResult.data : null;

    return (
      <div>
        <PageHeader
          title="إدارة الشهادات"
          subtitle="مراجعة المعلمين المستوفين لإصدار شهادات إتمام البرامج والدورات وإدارتها"
          actions={
            <Link
              href="/certificates/issue"
              className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
            >
              + إصدار شهادة
            </Link>
          }
        />

        {metrics ? (
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="إجمالي الشهادات" value={metrics.total} tone="brand" />
            <StatTile label="صادرة وسارية" value={metrics.active} tone="success" />
            <StatTile label="بانتظار الإصدار (أزواج مستوفية)" value={metrics.eligibleAwaiting ?? 0} tone="warning" />
            <StatTile label="مُلغاة" value={metrics.revoked} />
          </div>
        ) : null}

        <Card>
          <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">
                بحث
              </label>
              <input
                id="q"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="رقم الشهادة أو العنوان أو اسم المعلم…"
                className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">
                الحالة
              </label>
              <select
                id="status"
                name="status"
                defaultValue={params.status ?? ""}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6]"
              >
                <option value="">الكل</option>
                <option value="ISSUED">صادرة</option>
                <option value="REVOKED">مُلغاة</option>
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
              title="لا توجد شهادات مطابقة"
              hint="ابدأ بمراجعة المعلمين المستوفين وإصدار الشهادات من زر «إصدار شهادة»."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">رقم الشهادة</th>
                    <th className="px-3 py-2 font-medium">العنوان</th>
                    <th className="px-3 py-2 font-medium">المعلم</th>
                    <th className="px-3 py-2 font-medium">المحتوى</th>
                    <th className="px-3 py-2 font-medium">تاريخ الإصدار</th>
                    <th className="px-3 py-2 font-medium">الحالة</th>
                    <th className="px-3 py-2 font-medium">المُصدر</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-3">
                        <span dir="ltr" className="font-mono text-xs font-semibold text-slate-700">
                          {row.certificateNumber}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <p className="max-w-56 font-medium text-slate-800">{row.titleAr}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.teacherName}</td>
                      <td className="px-3 py-3 text-slate-600">{row.contentTitle ?? "—"}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.issuedAt)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <CertificateStatusBadge status={row.status} />
                          {row.effectiveStatus === "EXPIRED" ? (
                            <EffectiveStatusBadge status={row.effectiveStatus} />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">{row.issuerName ?? "—"}</td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/certificates/${row.id}`}
                          className="text-xs font-medium text-[#1D5BD6] hover:underline"
                        >
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
              <span>
                الصفحة {currentPage} من {pageCount} — {total} شهادة
              </span>
              <div className="flex gap-2">
                {currentPage > 1 ? (
                  <Link href={`/certificates?page=${currentPage - 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                    السابق
                  </Link>
                ) : null}
                {currentPage < pageCount ? (
                  <Link href={`/certificates?page=${currentPage + 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                    التالي
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Supervisor — read-only certificates of assigned teachers          */
  /* ---------------------------------------------------------------- */
  if (user.role === "EDUCATIONAL_SUPERVISOR") {
    const params = await searchParams;
    const result = await listCertificatesForSupervisor(
      { id: user.id, role: user.role, schoolId: user.schoolId },
      { q: params.q, status: params.status, page: Number(params.page ?? "1") || 1 }
    );
    if (!result.ok) {
      return <AccessDenied hint={result.message ?? "غير مصرح"} />;
    }

    return (
      <div>
        <PageHeader
          title="شهادات معلميّ"
          subtitle="قراءة فقط — شهادات معلميك المسندين. الإصدار والإلغاء من صلاحيات إدارة المدرسة."
        />
        <Card>
          <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">
                بحث
              </label>
              <input
                id="q"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="رقم الشهادة أو العنوان أو اسم المعلم…"
                className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">
                الحالة
              </label>
              <select
                id="status"
                name="status"
                defaultValue={params.status ?? ""}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6]"
              >
                <option value="">الكل</option>
                <option value="ISSUED">صادرة</option>
                <option value="REVOKED">مُلغاة</option>
              </select>
            </div>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              تصفية
            </button>
          </form>

          {result.rows.length === 0 ? (
            <EmptyState
              title="لا توجد شهادات لمعلميك بعد"
              hint="ستظهر هنا شهادات معلميك المسندين فور إصدارها من إدارة المدرسة."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">رقم الشهادة</th>
                    <th className="px-3 py-2 font-medium">العنوان</th>
                    <th className="px-3 py-2 font-medium">المعلم</th>
                    <th className="px-3 py-2 font-medium">المحتوى</th>
                    <th className="px-3 py-2 font-medium">تاريخ الإصدار</th>
                    <th className="px-3 py-2 font-medium">الحالة</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-3">
                        <span dir="ltr" className="font-mono text-xs font-semibold text-slate-700">
                          {row.certificateNumber}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <p className="max-w-56 font-medium text-slate-800">{row.titleAr}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.teacherName}</td>
                      <td className="px-3 py-3 text-slate-600">{row.contentTitle ?? "—"}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.issuedAt)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <CertificateStatusBadge status={row.status} />
                          {row.effectiveStatus === "EXPIRED" ? (
                            <EffectiveStatusBadge status={row.effectiveStatus} />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/certificates/${row.id}`}
                          className="text-xs font-medium text-[#1D5BD6] hover:underline"
                        >
                          التفاصيل
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.pageCount > 1 ? (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>
                الصفحة {result.page} من {result.pageCount} — {result.total} شهادة
              </span>
              <div className="flex gap-2">
                {result.page > 1 ? (
                  <Link href={`/certificates?page=${result.page - 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                    السابق
                  </Link>
                ) : null}
                {result.page < result.pageCount ? (
                  <Link href={`/certificates?page=${result.page + 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                    التالي
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Platform owner — read-only cross-school register                  */
  /* ---------------------------------------------------------------- */
  if (user.role === "SUPER_ADMIN") {
    const params = await searchParams;
    const result = await listCertificatesPlatform({
      q: params.q,
      status: params.status,
      page: Number(params.page ?? "1") || 1,
    });

    return (
      <div>
        <PageHeader
          title="الشهادات — سجل المنصة"
          subtitle="قراءة فقط — جميع شهادات المدارس. الإصدار والإلغاء يتم داخل مساحة كل مدرسة."
        />
        <Card>
          <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">
                بحث
              </label>
              <input
                id="q"
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="رقم الشهادة أو العنوان أو اسم المعلم…"
                className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">
                الحالة
              </label>
              <select
                id="status"
                name="status"
                defaultValue={params.status ?? ""}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6]"
              >
                <option value="">الكل</option>
                <option value="ISSUED">صادرة</option>
                <option value="REVOKED">مُلغاة</option>
              </select>
            </div>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              تصفية
            </button>
          </form>

          {result.rows.length === 0 ? (
            <EmptyState
              title="لا توجد شهادات مطابقة"
              hint="ستظهر هنا شهادات جميع المدارس المسجلة."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">رقم الشهادة</th>
                    <th className="px-3 py-2 font-medium">المدرسة</th>
                    <th className="px-3 py-2 font-medium">العنوان</th>
                    <th className="px-3 py-2 font-medium">المعلم</th>
                    <th className="px-3 py-2 font-medium">تاريخ الإصدار</th>
                    <th className="px-3 py-2 font-medium">الحالة</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-3">
                        <span dir="ltr" className="font-mono text-xs font-semibold text-slate-700">
                          {row.certificateNumber}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.schoolName ?? "—"}</td>
                      <td className="px-3 py-3">
                        <p className="max-w-56 font-medium text-slate-800">{row.titleAr}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-600">{row.teacherName}</td>
                      <td className="px-3 py-3 text-slate-600">{formatDate(row.issuedAt)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <CertificateStatusBadge status={row.status} />
                          {row.effectiveStatus === "EXPIRED" ? (
                            <EffectiveStatusBadge status={row.effectiveStatus} />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/certificates/${row.id}`}
                          className="text-xs font-medium text-[#1D5BD6] hover:underline"
                        >
                          التفاصيل
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.pageCount > 1 ? (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>
                الصفحة {result.page} من {result.pageCount} — {result.total} شهادة
              </span>
              <div className="flex gap-2">
                {result.page > 1 ? (
                  <Link href={`/certificates?page=${result.page - 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                    السابق
                  </Link>
                ) : null}
                {result.page < result.pageCount ? (
                  <Link href={`/certificates?page=${result.page + 1}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                    التالي
                  </Link>
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
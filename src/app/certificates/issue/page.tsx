/**
 * Phase 8 — issuance flow (office manager):
 *   1. Pick qualifying content (course or program) from a server-
 *      computed, tenant-scoped list.
 *   2. Review the per-teacher eligibility table — every rule is
 *      computed SERVER-SIDE from real enrollment/assessment data; the
 *      UI never asserts eligibility.
 *   3. Issue per eligible teacher (service re-validates everything at
 *      submit time and blocks duplicates).
 */
import Link from "next/link";

import { requireAdminContext } from "@/lib/auth/dev-admin";
import {
  getIssueEligibility,
  listIssueContentOptions,
} from "@/lib/certificates/service";
import { CERT_CONTENT_TYPE_LABELS, type CertContentType } from "@/config/certificates";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
} from "@/app/assignments/ui";
import { EffectiveStatusBadge } from "@/app/certificates/ui";
import { IssueCertificateButton } from "@/app/certificates/issue-button";

export const dynamic = "force-dynamic";

export default async function IssueCertificatePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string }>;
}) {
  const ctx = await requireAdminContext();
  if (ctx.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return (
      <AccessDenied hint="إصدار الشهادات متاح لمديري مكاتب التطوير فقط." />
    );
  }

  const params = await searchParams;
  const optionsResult = await listIssueContentOptions(ctx);
  if (!optionsResult.ok) return <AccessDenied hint={optionsResult.message} />;
  const options = optionsResult.data;

  const selectedType =
    params.type === "COURSE" || params.type === "PROGRAM"
      ? (params.type as CertContentType)
      : null;
  const selectedId = params.id?.trim() || null;

  // ---- step 1: content selector ------------------------------------
  if (!selectedType || !selectedId) {
    return (
      <div>
        <PageHeader
          title="إصدار شهادة"
          subtitle="اختر الدورة أو البرنامج التدريبي لعرض المعلمين المستوفين لمتطلبات الإتمام"
          actions={
            <Link
              href="/certificates"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              رجوع إلى القائمة
            </Link>
          }
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="دورات تدريبية">
            {options.courses.length === 0 ? (
              <EmptyState title="لا توجد دورات منشورة في نطاق مدرستك بعد" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {options.courses.map((course) => (
                  <li key={course.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{course.titleAr}</p>
                      <p className="text-xs text-slate-400">
                        {CERT_CONTENT_TYPE_LABELS.COURSE}
                        {course.scope === "platform" ? " — منصة (مشتركة)" : " — مدرسة"}
                      </p>
                    </div>
                    <Link
                      href={`/certificates/issue?type=COURSE&id=${course.id}`}
                      className="shrink-0 rounded-lg bg-[#1D5BD6] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
                    >
                      عرض المستوفين
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="برامج تدريبية">
            {options.programs.length === 0 ? (
              <EmptyState title="لا توجد برامج منشورة في نطاق مدرستك بعد" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {options.programs.map((program) => (
                  <li key={program.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{program.nameAr}</p>
                      <p className="text-xs text-slate-400">
                        {CERT_CONTENT_TYPE_LABELS.PROGRAM}
                        {program.scope === "platform" ? " — منصة (مشتركة)" : " — مدرسة"}
                      </p>
                    </div>
                    <Link
                      href={`/certificates/issue?type=PROGRAM&id=${program.id}`}
                      className="shrink-0 rounded-lg bg-[#1D5BD6] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
                    >
                      عرض المستوفين
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    );
  }

  // ---- step 2: eligibility table ------------------------------------
  const eligibilityResult = await getIssueEligibility(ctx, selectedType, selectedId);
  if (!eligibilityResult.ok) return <AccessDenied hint={eligibilityResult.message} />;
  const { content, rows, teachersTotal } = eligibilityResult.data;
  const eligibleCount = rows.filter((row) => row.eligible).length;
  const issuedCount = rows.filter((row) => row.alreadyIssued).length;

  return (
    <div>
      <PageHeader
        title={`إصدار شهادة — ${content.titleAr}`}
        subtitle={`${CERT_CONTENT_TYPE_LABELS[content.type]} — قائمة المعلمين ومتطلبات الإتمام محسوبة من سجلات التدريب الفعلية`}
        actions={
          <Link
            href="/certificates/issue"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            تغيير المحتوى
          </Link>
        }
      />

      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-6 text-slate-600">
        <p className="font-semibold text-slate-700">قواعد الاستحقاق المعتمدة</p>
        <p>
          1) الالتحاق: سجلّ التحاق نشط في {content.type === "COURSE" ? "الدورة" : "أحد دورات البرنامج"}.
        </p>
        <p>
          2) التقييمات: اجتياز كل تقييم منشور مرتبط بالمحتوى وفق درجة النجاح المحددة لكل تقييم
          (دون تقييمات منشورة، يُستوفى الشرط تلقائيًا ولا يُطلب أي معيار بديل).
        </p>
        <p>3) لا تُصدر شهادة مكررة لنفس المعلم عن نفس المحتوى.</p>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span>إجمالي المعلمين: <strong className="text-slate-700">{teachersTotal}</strong></span>
          <span>مستوفون للإصدار: <strong className="text-emerald-600">{eligibleCount}</strong></span>
          <span>صدرت لهم شهادات: <strong className="text-slate-700">{issuedCount}</strong></span>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="لا يوجد معلمون نشطون في مدرستك بعد" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">المعلم</th>
                  <th className="px-3 py-2 font-medium">الفرع</th>
                  <th className="px-3 py-2 font-medium">المتطلبات</th>
                  <th className="px-3 py-2 font-medium">الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.teacherId} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
                    <td className="px-3 py-3 font-medium text-slate-800">{row.teacherName}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{row.branchName ?? "—"}</td>
                    <td className="px-3 py-3">
                      <ul className="space-y-1 text-xs">
                        {row.requirements.map((requirement) => (
                          <li key={requirement.key} className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                                requirement.met ? "bg-emerald-500" : "bg-red-400"
                              }`}
                              aria-hidden
                            >
                              {requirement.met ? "✓" : "✕"}
                            </span>
                            <span className={requirement.met ? "text-slate-600" : "text-red-600"}>
                              <span className="font-medium">{requirement.label}:</span>{" "}
                              {requirement.detail}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-3 py-3">
                      {row.alreadyIssued ? (
                        <div className="flex flex-col items-start gap-1">
                          <EffectiveStatusBadge status={row.alreadyIssued.status === "ISSUED" ? "ISSUED" : "REVOKED"} />
                          <Link
                            href={`/certificates/${row.alreadyIssued.certificateId}`}
                            className="text-xs font-medium text-[#1D5BD6] hover:underline"
                          >
                            عرض الشهادة ({row.alreadyIssued.certificateNumber})
                          </Link>
                        </div>
                      ) : row.eligible ? (
                        <IssueCertificateButton
                          teacherId={row.teacherId}
                          contentType={content.type}
                          contentId={content.id}
                        />
                      ) : (
                        <span className="text-xs text-slate-400">غير مستوفٍ بعد</span>
                      )}
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
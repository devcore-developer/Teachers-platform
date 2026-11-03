/**
 * Phase 10 — print-friendly report view. Minimal chrome, @page A4 with
 * Arabic RTL, and a print trigger. The printed/PDF artifact carries the
 * school name, date range, generation timestamp and the SAME filtered
 * dataset as the on-screen report.
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { toAnalyticsActor } from "@/lib/analytics/access";
import { buildReport, isReportId, parseReportFilters } from "@/lib/reports/service";
import { AccessDenied } from "@/app/assignments/ui";
import { ReportDocument } from "@/app/reports/report-table";
import { PrintButton } from "@/app/reports/print-button";

export const dynamic = "force-dynamic";

export default async function ReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reportId } = await params;
  const rawQuery = await searchParams;
  const flatQuery: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawQuery)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") flatQuery[key] = first;
  }

  const user = await getCurrentUser();
  if (!user) return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  const actor = toAnalyticsActor(user);
  if (!actor || !isReportId(reportId)) {
    return <AccessDenied hint="التقرير المطلوب غير موجود." />;
  }

  const filtersResult = await parseReportFilters(actor, flatQuery);
  if (!filtersResult.ok) {
    return <AccessDenied hint={filtersResult.message} />;
  }
  const report = await buildReport(actor, reportId, filtersResult.data);
  if (!report.ok) {
    return <AccessDenied hint={report.message} />;
  }

  return (
    <div className="mx-auto max-w-5xl p-6 print:p-0">
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/reports/${reportId}`} className="text-xs font-semibold text-[#1D5BD6]">
          ← رجوع إلى عرض التقرير
        </Link>
        <PrintButton />
      </div>

      <ReportDocument report={report.data} rows={report.data.rows} />

      <p className="mt-6 border-t border-slate-200 pt-3 text-center text-[10px] text-slate-400">
        منارة قرطبة — منصة التطوير المهني للمعلمين — تقرير مولّد آليًا من بيانات المنصة
      </p>
    </div>
  );
}
/**
 * Phase 10 — authenticated report export endpoint.
 *
 * GET /api/reports/[reportId]/export?format=csv|xls&schoolId=...&dateFrom=...
 *
 * Security:
 *   • Session-resolved actor only; anonymous requests get 401.
 *   • The SAME filter validation and report builder as the preview page
 *     run here — exports can never widen a user's data scope.
 *   • Failures return explicit error responses; a broken export NEVER
 *     silently degrades to an empty file.
 */
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { canExportReports, toAnalyticsActor } from "@/lib/analytics/access";
import { buildReport, parseReportFilters } from "@/lib/reports/service";
import { buildReportCsv, buildReportExcelXml, contentDispositionFor } from "@/lib/reports/export";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> }
): Promise<Response> {
  const { reportId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "غير مصرّح — سجّل الدخول من جديد" }, { status: 401 });
  }
  const actor = toAnalyticsActor(user);
  if (!actor || !canExportReports(actor.role)) {
    return NextResponse.json(
      { error: "تصدير التقارير متاح للأدوار الإدارية المدرسية والإدارة العامة فقط" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "xls") {
    return NextResponse.json(
      { error: "صيغة التصدير غير مدعومة — الصيغ المتاحة: csv و xls" },
      { status: 400 }
    );
  }

  const filtersResult = await parseReportFilters(actor, Object.fromEntries(url.searchParams.entries()));
  if (!filtersResult.ok) {
    const status = filtersResult.code === "VALIDATION_ERROR" ? 400 : filtersResult.code === "NOT_FOUND" ? 404 : 403;
    return NextResponse.json({ error: filtersResult.message }, { status });
  }

  const report = await buildReport(actor, reportId, filtersResult.data);
  if (!report.ok) {
    const status = report.code === "VALIDATION_ERROR" ? 400 : report.code === "NOT_FOUND" ? 404 : 403;
    return NextResponse.json({ error: report.message }, { status });
  }

  try {
    if (format === "csv") {
      const body = buildReportCsv(report.data);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": contentDispositionFor(report.data.meta.titleAr, "csv"),
          "Cache-Control": "no-store",
        },
      });
    }
    const body = buildReportExcelXml(report.data);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.ms-excel; charset=utf-8",
        "Content-Disposition": contentDispositionFor(report.data.meta.titleAr, "xls"),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // Explicit failure — never an empty/fake download.
    console.error("[reports/export] generation failed", error);
    return NextResponse.json(
      { error: "فشل توليد ملف التصدير — حاول مرة أخرى أو راجع سجل الخادم" },
      { status: 500 }
    );
  }
}
/**
 * Phase 10 — report preview page: server-validated filters, the same
 * dataset used by exports, pagination, export links (CSV / Excel) and
 * the print view. Any out-of-scope filter value is rejected here —
 * never silently clamped — so the user always knows what was applied.
 */
import Link from "next/link";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { toAnalyticsActor, visibleTeacherIds } from "@/lib/analytics/access";
import { REPORT_CATALOG, buildReport, isReportId, parseReportFilters } from "@/lib/reports/service";
import { REPORTS_PAGE_SIZE } from "@/config/analytics";
import { AccessDenied, Card, PageHeader } from "@/app/assignments/ui";
import { ReportDocument } from "@/app/reports/report-table";
import { ReportFilterForm, type FilterField, type FilterOption } from "@/app/reports/filter-form";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS: Record<string, FilterOption[]> = {
  "assignment-status": [
    { value: "PUBLISHED", label: "منشور" },
    { value: "CLOSED", label: "مغلق" },
    { value: "ARCHIVED", label: "مؤرشف" },
  ],
  "certificates-growth": [
    { value: "ISSUED", label: "صادرة" },
    { value: "REVOKED", label: "ملغاة" },
  ],
  "survey-results": [
    { value: "DRAFT", label: "مسودة" },
    { value: "PUBLISHED", label: "منشور" },
    { value: "CLOSED", label: "مغلق" },
    { value: "ARCHIVED", label: "مؤرشف" },
  ],
  "followup-activity": [
    { value: "PLANNED", label: "مجدولة" },
    { value: "IN_PROGRESS", label: "قيد التنفيذ" },
    { value: "COMPLETED", label: "مكتملة" },
    { value: "CANCELLED", label: "ملغاة" },
  ],
};

function optionLabel(name: string | null | undefined, fallbackTitle: string): string {
  return name ?? fallbackTitle;
}

export default async function ReportPreviewPage({
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
  const page = Math.max(1, Number.parseInt(flatQuery.page ?? "1", 10) || 1);

  const user = await getCurrentUser();
  if (!user) return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  const actor = toAnalyticsActor(user);
  if (!actor) return <AccessDenied hint="دور الحساب غير معروف — راجع مدير المنصة." />;
  if (!isReportId(reportId)) {
    return <AccessDenied hint="التقرير المطلوب غير موجود." />;
  }
  const definition = REPORT_CATALOG.find((report) => report.id === reportId);
  if (!definition) return <AccessDenied hint="التقرير المطلوب غير موجود." />;

  const filtersResult = await parseReportFilters(actor, flatQuery);
  if (!filtersResult.ok) {
    return (
      <div>
        <PageHeader title={definition.titleAr} subtitle="تعذر توليد التقرير" />
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          {filtersResult.message}
        </div>
        <Link href="/reports" className="mt-4 inline-block text-xs font-semibold text-[#1D5BD6]">
          ← رجوع إلى مركز التقارير
        </Link>
      </div>
    );
  }
  const filters = filtersResult.data;

  /* ----------------------- Filter options (scope-aware, capped) ------ */
  const schoolId = filters.schoolId;
  const [branches, programs, courses, teachers] = await Promise.all([
    dbBranches(schoolId),
    dbProgramOptions(schoolId),
    dbCourseOptions(schoolId),
    dbTeacherOptions(actor, schoolId),
  ]);
  const supervisors =
    actor.role === "EDUCATIONAL_SUPERVISOR"
      ? []
      : await dbSupervisorOptions(schoolId);
  const schools = actor.role === "SUPER_ADMIN" ? await dbSchoolOptions() : [];

  const fields: FilterField[] = [];
  if (actor.role === "SUPER_ADMIN") {
    fields.push({
      key: "schoolId",
      label: "المدرسة",
      type: "select",
      options: schools,
      placeholder: "اختر مدرسة",
    });
  }
  if (branches.length > 0) {
    fields.push({ key: "branchId", label: "الفرع", type: "select", options: branches });
  }
  fields.push(
    { key: "dateFrom", label: "من تاريخ", type: "date" },
    { key: "dateTo", label: "إلى تاريخ", type: "date" }
  );
  if (programs.length > 0 && (reportId === "training-completion" || reportId === "development-summary")) {
    fields.push({ key: "programId", label: "البرنامج", type: "select", options: programs });
  }
  if (courses.length > 0 && ["training-completion", "assessment-performance"].includes(reportId)) {
    fields.push({ key: "courseId", label: "الدورة", type: "select", options: courses });
  }
  if (teachers.length > 0 && ["teacher-directory", "certificates-growth", "followup-activity", "assignment-status"].includes(reportId)) {
    fields.push({ key: "teacherId", label: "المعلم", type: "select", options: teachers });
  }
  if (supervisors.length > 0 && reportId === "followup-activity") {
    fields.push({ key: "supervisorId", label: "المشرف", type: "select", options: supervisors });
  }
  const statusOptions = STATUS_OPTIONS[reportId];
  if (statusOptions) {
    fields.push({ key: "status", label: "الحالة", type: "select", options: statusOptions });
  }

  /* --------------------------------------- Build + paginate dataset -- */
  const report = await buildReport(actor, reportId, filters);
  if (!report.ok) {
    return (
      <div>
        <PageHeader title={definition.titleAr} subtitle="تعذر توليد التقرير" />
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          {report.message}
        </div>
      </div>
    );
  }
  const data = report.data;
  const totalRows = data.rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / REPORTS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = data.rows.slice((safePage - 1) * REPORTS_PAGE_SIZE, safePage * REPORTS_PAGE_SIZE);

  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(flatQuery)) {
    if (key !== "page" && value && value.trim() !== "") exportParams.set(key, value.trim());
  }
  const exportQs = exportParams.toString();
  const printHref = `/reports/${reportId}/print${exportQs ? `?${exportQs}` : ""}`;
  const csvHref = `/api/reports/${reportId}/export?format=csv${exportQs ? `&${exportQs}` : ""}`;
  const xlsHref = `/api/reports/${reportId}/export?format=xls${exportQs ? `&${exportQs}` : ""}`;

  function pageLink(targetPage: number): string {
    const params = new URLSearchParams(exportParams);
    params.set("page", String(targetPage));
    return `/reports/${reportId}?${params.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title={definition.titleAr}
        subtitle={definition.dateColumnHintAr ? `فترة الزمن تنطبق على: ${definition.dateColumnHintAr}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/reports" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              ← مركز التقارير
            </Link>
            <Link href={printHref} className="rounded-lg border border-[#1D5BD6] px-3 py-1.5 text-xs font-semibold text-[#1D5BD6] hover:bg-blue-50">
              عرض الطباعة / PDF
            </Link>
            <a href={csvHref} className="rounded-lg border border-[#1D5BD6] px-3 py-1.5 text-xs font-semibold text-[#1D5BD6] hover:bg-blue-50">
              تصدير CSV
            </a>
            <a href={xlsHref} className="rounded-lg bg-[#1D5BD6] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#174bb3]">
              تصدير Excel
            </a>
          </div>
        }
      />

      <ReportFilterForm
        reportId={reportId}
        fields={fields}
        current={Object.fromEntries(Object.entries(flatQuery).filter(([key]) => key !== "page"))}
      />

      <div className="mt-4">
        <ReportDocument report={data} rows={pageRows} />
      </div>

      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-500" dir="ltr">
            {totalRows} صفًا — صفحة {safePage} / {pageCount}
          </p>
          <div className="flex gap-2">
            {safePage > 1 ? (
              <Link href={pageLink(safePage - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                السابق
              </Link>
            ) : null}
            {safePage < pageCount ? (
              <Link href={pageLink(safePage + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                التالي
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <Card>
        <p className="text-[11px] leading-5 text-slate-500">
          يعمل التصدير على نفس المرشحات المعروضة ويخضع لنفس التحقق المدرسي — لا يمكن لرابط معدّل أن يوسّع البيانات.
          ملف CSV يُفتح في Excel بترميز عربي سليم، وملف Excel (xls) يدعم الاتجاه من اليمين لليسار، وعرض الطباعة يستخدم
          محرك المتصفح لإنتاج PDF بخط عربي متصل.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------- Option loaders (server-side scope) -- */

async function dbBranches(schoolId: string): Promise<FilterOption[]> {
  const rows = await db.branch.findMany({
    where: { schoolId, isActive: true },
    select: { id: true, nameAr: true },
    orderBy: { nameAr: "asc" },
  });
  return rows.map((row) => ({ value: row.id, label: row.nameAr }));
}

async function dbSchoolOptions(): Promise<FilterOption[]> {
  const rows = await db.school.findMany({
    select: { id: true, nameAr: true },
    orderBy: { nameAr: "asc" },
    take: 200,
  });
  return rows.map((row) => ({ value: row.id, label: optionLabel(row.nameAr, "مدرسة") }));
}

async function dbProgramOptions(schoolId: string): Promise<FilterOption[]> {
  const rows = await db.trainingProgram.findMany({
    where: { OR: [{ schoolId }, { schoolId: null }], status: { not: "DRAFT" } },
    select: { id: true, nameAr: true, schoolId: true },
    orderBy: { nameAr: "asc" },
    take: 200,
  });
  return rows.map((row) => ({
    value: row.id,
    label: `${row.nameAr}${row.schoolId === null ? " (عام)" : ""}`,
  }));
}

async function dbCourseOptions(schoolId: string): Promise<FilterOption[]> {
  const rows = await db.course.findMany({
    where: { OR: [{ schoolId }, { schoolId: null }], status: { not: "DRAFT" } },
    select: { id: true, titleAr: true, schoolId: true },
    orderBy: { titleAr: "asc" },
    take: 300,
  });
  return rows.map((row) => ({
    value: row.id,
    label: `${row.titleAr}${row.schoolId === null ? " (عامة)" : ""}`,
  }));
}

async function dbTeacherOptions(
  actor: ReturnType<typeof toAnalyticsActor>,
  schoolId: string
): Promise<FilterOption[]> {
  if (!actor) return [];
  const visible = await visibleTeacherIds(actor, schoolId);
  if (!visible.ok || visible.data.length === 0) return [];
  const rows = await db.user.findMany({
    where: { id: { in: visible.data.slice(0, 300) } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({ value: row.id, label: row.name }));
}

async function dbSupervisorOptions(schoolId: string): Promise<FilterOption[]> {
  const rows = await db.user.findMany({
    where: { schoolId, role: "EDUCATIONAL_SUPERVISOR", isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({ value: row.id, label: row.name }));
}
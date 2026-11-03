/**
 * Phase 10 — shared server-safe report renderer: meta block, summary
 * tiles, the data table, and (for the development summary) the labeled
 * sections. Used by BOTH the preview page and the print view so the
 * screen and the printed/exported artifact are structurally identical.
 */
import type { ReportData } from "@/lib/reports/service";

function formatMetaDate(date: Date): string {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    numberingSystem: "latn",
  }).format(date);
}

export function ReportMetaBlock({ report }: { report: ReportData }) {
  const meta = report.meta;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">{meta.titleAr}</h1>
          <p className="mt-1 text-xs text-slate-500">{meta.descriptionAr}</p>
        </div>
        <div className="text-left text-[11px] leading-5 text-slate-400" dir="rtl">
          {meta.schoolName ? <p>المدرسة: {meta.schoolName}</p> : null}
          {meta.branchName ? <p>الفرع: {meta.branchName}</p> : null}
          {meta.dateRangeLabel ? <p>الفترة: {meta.dateRangeLabel}</p> : null}
          <p>وُلِّد في: {formatMetaDate(meta.generatedAt)}</p>
          <p>{meta.scopeNote}</p>
        </div>
      </div>
    </div>
  );
}

export function ReportSummaryTiles({ report }: { report: ReportData }) {
  if (report.summary.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {report.summary.map((item) => (
        <div
          key={item.label}
          className={`rounded-xl border p-4 shadow-sm ${
            item.kind === "metric" ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"
          }`}
        >
          <p className="text-[11px] font-medium text-slate-500">{item.label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900" dir="ltr">
            {item.value}
          </p>
          {item.note ? <p className="mt-1 text-[10px] leading-4 text-slate-400">{item.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function ReportTable({ report, rows }: { report: ReportData; rows: ReportData["rows"] }) {
  if (report.columns.length === 0) return null;
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="text-sm font-medium text-slate-600">لا توجد سجلات مطابقة للمرشحات الحالية</p>
        <p className="mt-1 text-xs text-slate-400">
          جرّب توسيع الفترة الزمنية أو إزالة بعض المرشحات — التقرير يعرض البيانات الفعلية فقط ولا يملأ الفراغ ببيانات وهمية.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-right text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            {report.columns.map((column) => (
              <th key={column.key} className="px-3 py-2.5 font-semibold">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-slate-100 last:border-0">
              {report.columns.map((column) => {
                const value = row.values[column.key] ?? null;
                return (
                  <td key={column.key} className="px-3 py-2 text-slate-600" dir={column.type === "text" ? undefined : "ltr"}>
                    {value === null ? "—" : String(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportSections({ report }: { report: ReportData }) {
  if (!report.sections) return null;
  return (
    <div className="space-y-5">
      {report.sections.map((section) => (
        <section key={section.titleAr} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">{section.titleAr}</h2>
          <dl className="mt-4 grid gap-3 md:grid-cols-2">
            {section.items.map((item) => (
              <div
                key={item.label}
                className={`rounded-lg border p-3 ${
                  item.kind === "fact"
                    ? "border-slate-200 bg-slate-50/60"
                    : item.kind === "metric"
                      ? "border-blue-200 bg-blue-50"
                      : "border-amber-200 bg-amber-50"
                }`}
              >
                <dt className="text-xs font-medium text-slate-600">{item.label}</dt>
                <dd className="mt-1 text-lg font-bold text-slate-900">{item.value}</dd>
                {item.note ? <p className="mt-1 text-[10px] leading-4 text-slate-500">{item.note}</p> : null}
              </div>
            ))}
          </dl>
          {section.note ? (
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">{section.note}</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** Complete report document (meta + summary + table + sections). */
export function ReportDocument({ report, rows }: { report: ReportData; rows: ReportData["rows"] }) {
  return (
    <div className="space-y-4">
      <ReportMetaBlock report={report} />
      <ReportSummaryTiles report={report} />
      <ReportTable report={report} rows={rows} />
      <ReportSections report={report} />
      {report.truncated ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          تم اقتصار التقرير على الحد الأقصى للصفوف ({report.rows.length} صفًا) — قلّص نطاق المرشحات لرؤية الباقي.
        </p>
      ) : null}
    </div>
  );
}
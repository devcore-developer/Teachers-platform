import { redirect } from "next/navigation";

import { PLATFORM_NAME_AR, PLATFORM_SUBTITLE_AR } from "@/config/certificates";
import { requireUser } from "@/lib/auth/session";
import { buildSupervisorAnalytics } from "@/lib/reports/datasets";
import { PrintTrigger } from "@/app/reports/supervisor/print/print-trigger";

export const metadata = {
  title: "تقرير متابعة المعلمين — نسخة للطباعة | منارة",
};

/**
 * Batch 2 — the printable supervisor report (HTML v13PrintSupervisorTeachers
 * parity): same Arabic header, same KPI chips, same table columns —
 * rendered server-side from real rows and printed with one tap.
 */
export default async function SupervisorPrintPage() {
  const user = await requireUser();
  if (user.role !== "EDUCATIONAL_SUPERVISOR") redirect("/forbidden");

  const report = await buildSupervisorAnalytics({
    role: "EDUCATIONAL_SUPERVISOR",
    id: user.id,
    schoolId: user.schoolId,
  });

  return (
    <div className="mx-auto max-w-4xl bg-white p-8 print:p-0">
      <PrintTrigger />

      <h1 className="text-2xl font-black text-brand-900">
        {PLATFORM_NAME_AR} — تقرير متابعة المعلمين
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        المشرف: {user.name} | {PLATFORM_SUBTITLE_AR}
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <span className="rounded-xl border px-3 py-2">
          المعلمون: <b className="tabular-nums">{report.kpis.teachers}</b>
        </span>
        <span className="rounded-xl border px-3 py-2">
          الدورات: <b className="tabular-nums">{report.kpis.courses}</b>
        </span>
        <span className="rounded-xl border px-3 py-2">
          الإنجاز: <b className="tabular-nums">{report.kpis.rate}%</b>
        </span>
        <span className="rounded-xl border px-3 py-2">
          الساعات: <b className="tabular-nums">{report.kpis.totalHours}</b>
        </span>
      </div>

      <table className="mt-6 w-full border-collapse text-xs">
        <thead>
          <tr>
            {["المعلم", "المدرسة", "مسندة", "مكتملة", "الإنجاز", "الساعات", "متوسط الاختبار", "الشهادات", "المستوى"].map(
              (header) => (
                <th
                  key={header}
                  className="border border-brand-100 bg-brand-50 px-2 py-2 text-start font-bold"
                >
                  {header}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.teacherId}>
              <td className="border border-brand-100 px-2 py-2 font-semibold">
                {row.teacherName}
              </td>
              <td className="border border-brand-100 px-2 py-2">{row.schoolName}</td>
              <td className="border border-brand-100 px-2 py-2 tabular-nums">{row.assigned}</td>
              <td className="border border-brand-100 px-2 py-2 tabular-nums">{row.completed}</td>
              <td className="border border-brand-100 px-2 py-2 tabular-nums">{row.percent}%</td>
              <td className="border border-brand-100 px-2 py-2 tabular-nums">{row.hours}</td>
              <td className="border border-brand-100 px-2 py-2 tabular-nums">
                {row.avgPercentage}%
              </td>
              <td className="border border-brand-100 px-2 py-2 tabular-nums">
                {row.certificates}
              </td>
              <td className="border border-brand-100 px-2 py-2">{row.level}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-6 text-[11px] text-muted-foreground">
        صدر من منصة {PLATFORM_NAME_AR} بتاريخ {new Date().toLocaleDateString("ar-EG")} — بيانات حقيقية من
        قاعدة البيانات.
      </p>
    </div>
  );
}

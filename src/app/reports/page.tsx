/**
 * Phase 10 — مركز التقارير: report catalog. Only back-office roles see
 * the center; each role gets the same nine report definitions but the
 * builders scope every row server-side (supervisor → coverage,
 * deputy → grants, super → must pick a school explicitly).
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { toAnalyticsActor } from "@/lib/analytics/access";
import { canViewSchoolDashboard } from "@/lib/analytics/access";
import { REPORT_CATALOG } from "@/lib/reports/service";
import { AccessDenied, PageHeader } from "@/app/assignments/ui";

export const dynamic = "force-dynamic";

export default async function ReportsCenterPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const actor = toAnalyticsActor(user);
  if (!actor || (!canViewSchoolDashboard(actor.role) && actor.role !== "SUPER_ADMIN")) {
    return (
      <AccessDenied hint="مركز التقارير متاح للأدوار الإدارية المدرسية والإدارة العامة فقط." />
    );
  }

  const scopeHint =
    actor.role === "SUPER_ADMIN"
      ? "اختر المدرسة من مرشحات كل تقرير — عرض للقراءة فقط"
      : actor.role === "EDUCATIONAL_SUPERVISOR"
        ? "كل التقرير محصور بمعلمي نطاق إشرافك تلقائيًا"
        : actor.role === "EDUCATIONAL_DEPUTY"
          ? "عرض للقراءة فقط ضمن نطاق التفويض"
          : "تقارير مدرستك — قابلة للتصدير والطباعة";

  return (
    <div>
      <PageHeader
        title="مركز التقارير"
        subtitle={`تسعة تقارير محسوبة من البيانات الحقيقية — كل نسبة بمقام معلن. ${scopeHint}`}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORT_CATALOG.map((report) => (
          <Link
            key={report.id}
            href={`/reports/${report.id}`}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-[#1D5BD6]"
          >
            <h2 className="text-sm font-bold text-slate-800 group-hover:text-[#1D5BD6]">
              {report.titleAr}
            </h2>
            <p className="mt-2 text-xs leading-5 text-slate-500">{report.descriptionAr}</p>
            <p className="mt-3 text-[11px] font-semibold text-[#1D5BD6]">فتح التقرير ←</p>
          </Link>
        ))}
      </div>
      <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs leading-5 text-slate-600">
        <p className="font-bold text-slate-700">ملاحظات على التقارير والتصدير</p>
        <ul className="mt-2 list-disc space-y-1 pr-5">
          <li>التصدير يقرأ نفس مجموعة البيانات المعروضة على الشاشة — لا يمكن للمرشحات أن توسّع نطاق بياناتك.</li>
          <li>صيغ التصدير: CSV (يفتح في Excel بترميز عربي سليم) وملف Excel (xls) — وكل تقرير له عرض طباعة/PDF جاهز.</li>
          <li>الاستبيانات تُعرض تجميعيًا فقط حفاظًا على خصوصية المستجيبين — الردود الفردية تبقى في وحدة الاستبيانات بقواعدها.</li>
          <li>ملخص تنمية المدرسة يفصل بوضوح بين حقائق مسجلة ومؤشرات محسوبة وقراءة وصفية غير سببية.</li>
        </ul>
      </div>
    </div>
  );
}
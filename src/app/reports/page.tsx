import Link from "next/link";
import { redirect } from "next/navigation";
import { Award, BarChart3, Download, FileJson, Printer, TrendingUp } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { EmptyState } from "@/components/platform/empty-state";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  ANNUAL_HOURS_TARGET,
  GROWTH_LEVELS,
  annualHoursPercent,
  growthLevelLabel,
} from "@/config/growth";
import { teacherGrowthSummary } from "@/lib/growth/service";
import { annualSummary, teacherHoursSummary } from "@/lib/training/hours";
import {
  buildSupervisorAnalytics,
} from "@/lib/reports/datasets";
import { ReportsExportButtons } from "@/app/reports/reports-client";

export const metadata = {
  title: "التقارير | منارة قرطبة",
};

/**
 * Batch 2 — the reports hub, role-aware, built from REAL database rows:
 *   - TEACHER: annual hours vs the 35-hour target, growth journey
 *     (T0..T5 + suggestion), per-year history, certificates.
 *   - EDUCATIONAL_SUPERVISOR: the assigned-teachers analytics (v13) with
 *     CSV export and the printable report.
 *   - SUPER_ADMIN / DEVELOPMENT_OFFICE_MANAGER: the school/platform
 *     annual summary and the full export center (CSV/JSON).
 */

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <div className="rounded-xl border bg-background/60 p-4">
      <p className="text-2xl font-black tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
      {tone !== "neutral" && (
        <div className="mt-2">
          <StatusBadge tone={tone} withDot={false}>
            {tone === "success" ? "مستهدف محقق" : "قيد التقدم"}
          </StatusBadge>
        </div>
      )}
    </div>
  );
}

export default async function ReportsPage() {
  const user = await requireUser();

  /* ------------------------------ TEACHER ------------------------------ */
  if (user.role === "TEACHER") {
    const [hours, growth, certificates] = await Promise.all([
      teacherHoursSummary(user.id),
      teacherGrowthSummary(user.id),
      db.certificate.findMany({
        where: { teacherId: user.id },
        orderBy: { issuedAt: "desc" },
        select: {
          id: true,
          certificateNumber: true,
          titleAr: true,
          status: true,
          issuedAt: true,
        },
        take: 50,
      }),
    ]);

    const currentIndex = GROWTH_LEVELS.findIndex(
      (level) => level.id === growth?.currentLevel
    );

    return (
      <div>
        <PageHeader
          title="تقاريري المهنية"
          description="ساعاتك التدريبية السنوية وهدف 35 ساعة ورحلة نموك المهني وشهاداتك — من بياناتك الحقيقية."
          breadcrumbs={[{ label: "الرئيسية" }, { label: "التقارير" }]}
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="ساعات هذا العام" value={hours.hours} />
          <Stat label={`الهدف السنوي (${hours.academicYear})`} value={ANNUAL_HOURS_TARGET} />
          <Stat
            label="نسبة الإنجاز من الهدف"
            value={`${hours.percent}%`}
            tone={hours.percent >= 100 ? "success" : "warning"}
          />
          <Stat label="الشهادات" value={certificates.length} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <SectionCard
            title="رحلة النمو المهني"
            description={`تصنيفك الحالي: ${growthLevelLabel(growth?.currentLevel ?? "T0")} — المستوى المقترح من بياناتك: ${growthLevelLabel(growth?.suggestedLevel ?? "T0")}`}
          >
            <ol className="space-y-2">
              {GROWTH_LEVELS.map((level, index) => {
                const state =
                  index < currentIndex
                    ? "bg-brand-600 text-white"
                    : index === currentIndex
                      ? "bg-brand-100 text-brand-800 ring-2 ring-brand-600"
                      : "bg-muted text-muted-foreground";
                return (
                  <li
                    key={level.id}
                    className="flex items-center gap-3 rounded-xl border bg-background/60 p-3"
                  >
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-black ${state}`}
                    >
                      {level.id}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">
                        {level.id} — {level.nameAr}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {level.descriptionAr}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </SectionCard>

          <div className="space-y-6">
            <SectionCard
              title="ساعاتك عبر الأعوام"
              description="كل عام دراسي مع ساعاته المكتملة — السجل يبقى بعد الأرشفة."
            >
              {hours.byYear.length === 0 ? (
                <EmptyState
                  icon={BarChart3}
                  title="لا توجد ساعات مسجلة بعد"
                  description="أكمل دورة تدريبية وستظهر ساعاتك هنا تلقائيًا."
                />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-xs text-muted-foreground">
                      <th className="py-2 text-start font-semibold">العام الدراسي</th>
                      <th className="py-2 text-start font-semibold">الدورات</th>
                      <th className="py-2 text-start font-semibold">الساعات</th>
                      <th className="py-2 text-start font-semibold">من الهدف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hours.byYear.map((row) => (
                      <tr key={row.academicYear} className="border-b last:border-b-0">
                        <td className="py-2.5 font-semibold">{row.academicYear}</td>
                        <td className="py-2.5 tabular-nums">{row.completions}</td>
                        <td className="py-2.5 tabular-nums">{row.hours}</td>
                        <td className="py-2.5 tabular-nums">
                          {annualHoursPercent(row.hours)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SectionCard>

            <SectionCard
              title="شهاداتي"
              description="شهادات الإتمام الصادرة لحسابك — قابلة للعرض والتحقق العام."
            >
              {certificates.length === 0 ? (
                <EmptyState
                  icon={Award}
                  title="لم تصدر شهادات بعد"
                  description="أكمل متطلبات الدورة وستصدر شهادتك آليًا."
                />
              ) : (
                <ul className="divide-y rounded-xl border" role="list">
                  {certificates.map((certificate) => (
                    <li
                      key={certificate.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{certificate.titleAr}</p>
                        <p className="truncate text-xs text-muted-foreground" dir="ltr">
                          {certificate.certificateNumber}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge
                          tone={certificate.status === "ISSUED" ? "success" : "warning"}
                          withDot={false}
                        >
                          {certificate.status === "ISSUED" ? "صادرة" : certificate.status}
                        </StatusBadge>
                        <Link
                          href={`/certificates/${certificate.id}`}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                        >
                          عرض
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------- SUPERVISOR ------------------------------ */
  if (user.role === "EDUCATIONAL_SUPERVISOR") {
    const report = await buildSupervisorAnalytics({
      role: "EDUCATIONAL_SUPERVISOR",
      id: user.id,
      schoolId: user.schoolId,
    });

    return (
      <div>
        <PageHeader
          title="تقرير متابعة المعلمين"
          description="تحليل معلميك المسندون: الإنجاز والساعات ومتوسط الاختبار والشهادات والمستوى."
          breadcrumbs={[{ label: "الرئيسية" }, { label: "التقارير" }]}
          meta={
            <ReportsExportButtons
              supervisorMode
              printHref="/reports/supervisor/print"
            />
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="المعلمون المسندون" value={report.kpis.teachers} />
          <Stat label="الدورات المنشورة" value={report.kpis.courses} />
          <Stat label="نسبة الإنجاز" value={`${report.kpis.rate}%`} />
          <Stat label="إجمالي الساعات" value={report.kpis.totalHours} />
        </div>

        <div className="mt-6">
          <SectionCard
            title="تفاصيل المعلمين"
            description="نفس أعمدة تقرير Qurtuba_Supervisor_Teachers_Analytics.csv — من بيانات حقيقية."
          >
            {report.rows.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="لا يوجد معلمون مسندون"
                description="سيظهر هنا تحليل معلميك بعد إسنادهم إليك من صفحة النمو المهني أو إدارة المعلمين."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-2 text-start font-semibold">المعلم</th>
                      <th className="py-2 text-start font-semibold">المدرسة</th>
                      <th className="py-2 text-start font-semibold">مسندة</th>
                      <th className="py-2 text-start font-semibold">مكتملة</th>
                      <th className="py-2 text-start font-semibold">الإنجاز</th>
                      <th className="py-2 text-start font-semibold">الساعات</th>
                      <th className="py-2 text-start font-semibold">متوسط الاختبار</th>
                      <th className="py-2 text-start font-semibold">الشهادات</th>
                      <th className="py-2 text-start font-semibold">المستوى</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.teacherId} className="border-b last:border-b-0">
                        <td className="py-2.5 font-semibold">{row.teacherName}</td>
                        <td className="py-2.5">{row.schoolName}</td>
                        <td className="py-2.5 tabular-nums">{row.assigned}</td>
                        <td className="py-2.5 tabular-nums">{row.completed}</td>
                        <td className="py-2.5 tabular-nums">{row.percent}%</td>
                        <td className="py-2.5 tabular-nums">{row.hours}</td>
                        <td className="py-2.5 tabular-nums">{row.avgPercentage}%</td>
                        <td className="py-2.5 tabular-nums">{row.certificates}</td>
                        <td className="py-2.5">{row.level}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    );
  }

  /* --------------------- OFFICE / SUPER_ADMIN -------------------------- */
  if (user.role !== "SUPER_ADMIN" && user.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    redirect("/forbidden");
  }

  const summary = await annualSummary(
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ? user.schoolId : null
  );

  return (
    <div>
      <PageHeader
        title="مركز التقارير"
        description={`تقارير حقيقية من قاعدة البيانات للعام الدراسي ${summary.academicYear} — بتصدير CSV/JSON بأسماء الملفات الأصلية.`}
        breadcrumbs={[{ label: "الرئيسية" }, { label: "التقارير" }]}
        meta={
          <StatusBadge tone="info" withDot={false}>
            العام الحالي: {summary.academicYear}
          </StatusBadge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="معلمون لديهم ساعات هذا العام" value={summary.teachersWithHours} />
        <Stat label="إجمالي الساعات" value={summary.totalHours} />
        <Stat label="أكملوا هدف 35 ساعة" value={summary.reachedTarget} />
        <Stat label="متوسط الإنجاز من الهدف" value={`${summary.averagePercent}%`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="مركز التصدير"
          description="نفس أسماء الملفات والأعمدة العربية من المنصة الأصلية — UTF-8 BOM يفتح مباشرة في Excel."
        >
          <ul className="space-y-2" role="list">
            <li>
              <a
                className="flex items-center gap-3 rounded-xl border bg-background/60 p-3 transition-colors hover:bg-accent"
                href="/api/reports/export?type=training"
              >
                <Download className="size-4 text-brand-600" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">تقرير التدريب التفصيلي</span>
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    Qurtuba_Training_Report.csv
                  </span>
                </span>
              </a>
            </li>
            <li>
              <a
                className="flex items-center gap-3 rounded-xl border bg-background/60 p-3 transition-colors hover:bg-accent"
                href="/api/reports/export?type=teachers"
              >
                <Download className="size-4 text-brand-600" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">تقرير المعلمين</span>
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    Qurtuba_Teachers.csv
                  </span>
                </span>
              </a>
            </li>
            <li>
              <a
                className="flex items-center gap-3 rounded-xl border bg-background/60 p-3 transition-colors hover:bg-accent"
                href="/api/reports/export?type=courses"
              >
                <Download className="size-4 text-brand-600" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">تقرير الدورات</span>
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    Qurtuba_Courses.csv
                  </span>
                </span>
              </a>
            </li>
            <li>
              <a
                className="flex items-center gap-3 rounded-xl border bg-background/60 p-3 transition-colors hover:bg-accent"
                href="/api/reports/export?type=accounts"
              >
                <Download className="size-4 text-brand-600" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">تقرير الحسابات (بدون كلمات المرور)</span>
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    Qurtuba_User_Accounts.csv
                  </span>
                </span>
              </a>
            </li>
            <li>
              <a
                className="flex items-center gap-3 rounded-xl border bg-background/60 p-3 transition-colors hover:bg-accent"
                href="/api/reports/export?type=bundle"
              >
                <FileJson className="size-4 text-brand-600" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">الحزمة الشاملة JSON</span>
                  <span className="block text-xs text-muted-foreground" dir="ltr">
                    Qurtuba_Manara_Report.json
                  </span>
                </span>
              </a>
            </li>
          </ul>
        </SectionCard>

        <SectionCard
          title="السجل التدريبي السنوي"
          description="جدول الساعات لكل معلم للعام الحالي، مع الأرشفة السنوية وعام دراسي جديد — دون فقد البيانات."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/training-archive"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700"
            >
              <Printer className="size-4" aria-hidden="true" />
              فتح السجل التدريبي السنوي
            </Link>
            <p className="text-xs text-muted-foreground">
              يشمل أرشفة {summary.academicYear} واعتماد عام دراسي جديد وعرض الأعوام المؤرشفة.
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
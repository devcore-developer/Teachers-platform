/**
 * Phase 10 — school dashboard for DEVELOPMENT_OFFICE_MANAGER (full
 * operational view of their school) and EDUCATIONAL_DEPUTY (same
 * numbers, read-only framing per the existing authorization model).
 * All figures come from computeSchoolStats — explicit denominators,
 * honest zeros, no invented baselines.
 */
import Link from "next/link";

import type { AnalyticsActor } from "@/lib/analytics/access";
import { getSchoolDashboard } from "@/lib/analytics/service";
import { AccessDenied, Card, EmptyState, PageHeader, StatTile } from "@/app/assignments/ui";
import { ActivityTrendChart, DashboardLinks, DataTable, RateChip, SectionTitle } from "@/app/dashboard/ui";

export async function SchoolDashboardView({ actor }: { actor: AnalyticsActor }) {
  const result = await getSchoolDashboard(actor);
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const stats = result.data;
  const isManager = actor.role === "DEVELOPMENT_OFFICE_MANAGER";

  const links = [
    { href: "/analytics", label: "التحليلات والمؤشرات" },
    { href: "/reports", label: "مركز التقارير" },
    { href: "/archive", label: "الأرشيف" },
    ...(isManager
      ? [
          { href: "/certificates/issue", label: "إصدار شهادة" },
          { href: "/surveys/new", label: "استبيان جديد" },
          { href: "/follow-ups/new", label: "متابعة جديدة" },
        ]
      : []),
    { href: "/impact", label: "قياس الأثر" },
    { href: "/growth", label: "النمو المهني" },
  ];

  return (
    <div>
      <PageHeader
        title={isManager ? "لوحة التحكم — مدير مكتب التطوير" : "لوحة التحكم — الوكيل التعليمي"}
        subtitle={`${stats.schoolName} — ${isManager ? "بيانات مدرستك بمقامات معلنة" : "عرض للقراءة فقط ضمن نطاق التفويض"}`}
      />

      <DashboardLinks links={links} />

      <SectionTitle>المعلمون والتدريب</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="المعلمون النشطون" value={stats.teachersActive} tone="brand" />
        <StatTile label="الفروع النشطة" value={stats.branchesCount} />
        <StatTile label="الالتحاقات النشطة" value={stats.enrollmentsTotal} />
        <StatTile
          label="نسبة الالتحاق"
          value={stats.enrollmentRatePercent === null ? "—" : `${stats.enrollmentRatePercent}%`}
          tone="success"
          hint="معلمون بالتحاق واحد على الأقل ÷ المعلمون النشطون"
        />
        <StatTile
          label="استيفاء متطلبات الدورات"
          value={stats.coursesCompletedPairs}
          hint="نفس قاعدة أهلية الشهادات"
        />
        <StatTile label="برامج منشورة" value={stats.programsPublished} />
        <StatTile label="دورات منشورة" value={stats.coursesPublished} />
      </div>

      <SectionTitle>التقييمات</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="تقييمات منشورة" value={stats.assessmentsPublished} />
        <StatTile label="محاولات نهائية" value={stats.attemptsFinalized} />
        <StatTile label="محاولات ناجحة" value={stats.attemptsPassed} tone="success" />
        <StatTile
          label="معدل النجاح"
          value={stats.passRatePercent === null ? "—" : `${stats.passRatePercent}%`}
          tone="brand"
          hint="الناجحة ÷ النهائية (تُستبعد قيد المراجعة)"
        />
        <StatTile
          label="متوسط النسبة"
          value={stats.avgPercentage === null ? "—" : `${stats.avgPercentage}%`}
          hint="محاولات نهائية فقط"
        />
        <StatTile label="بانتظار مراجعة يدوية" value={stats.attemptsNeedingReview} tone="warning" />
      </div>

      <SectionTitle>التكليفات والتسليمات</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="تكليفات منشورة" value={stats.assignmentsPublished} />
        <StatTile label="تكليفات مؤرشفة" value={stats.assignmentsArchived} />
        <StatTile label="تسليمات نشطة" value={stats.submissionsActive} />
        <StatTile label="بانتظار التصحيح" value={stats.submissionsPendingReview} tone="warning" />
        <StatTile label="تسليمات مصححة" value={stats.submissionsGraded} tone="success" />
        <StatTile label="تسليمات متأخرة" value={stats.submissionsLate} />
      </div>

      <SectionTitle>الشهادات والاستبيانات والمتابعة</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatTile label="شهادات صادرة" value={stats.certificatesIssued} tone="success" />
        <StatTile label="شهادات ملغاة" value={stats.certificatesRevoked} tone="warning" />
        <StatTile label="شهادات منتهية" value={stats.certificatesExpired} />
        <StatTile label="استبيانات منشورة" value={stats.surveys.openSurveys} tone="brand" />
        <StatTile label="ردود مرسلة" value={stats.surveys.submittedResponses} />
        <StatTile
          label="متوسط الاستجابة"
          value={stats.surveys.averageResponseRatePercent === null ? "—" : `${stats.surveys.averageResponseRatePercent}%`}
        />
        <StatTile label="متابعات نشطة" value={stats.followUps.total} />
        <StatTile
          label="نسبة الإنجاز"
          value={stats.followUps.completionRatePercent === null ? "—" : `${stats.followUps.completionRatePercent}%`}
          tone="success"
        />
        <StatTile label="متابعات متأخرة" value={stats.followUpsOverdue} tone="warning" hint="تجاوزت تاريخ الجلسة دون إتمام" />
      </div>

      <SectionTitle>اتجاهات المدرسة — ستة أشهر</SectionTitle>
      <Card>
        <ActivityTrendChart trends={stats.trends} />
      </Card>

      <SectionTitle>تفصيل الفروع</SectionTitle>
      <Card>
        {stats.teachersByBranch.length === 0 ? (
          <EmptyState title="لا توجد فروع نشطة بعد" hint="أضف فروع المدرسة من إدارة الفروع." />
        ) : (
          <DataTable headers={["الفرع", "المعلمون النشطون", "الالتحاقات النشطة"]}>
            {stats.teachersByBranch.map((branch) => (
              <tr key={branch.branchId} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-700">{branch.branchName}</td>
                <td className="px-3 py-2 text-slate-600">{branch.teachers}</td>
                <td className="px-3 py-2 text-slate-600">{branch.enrollments}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <SectionTitle>مؤشرات سريعة</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        <RateChip label="الالتحاق" percent={stats.enrollmentRatePercent} note="معلمون ملتحقون ÷ المعلمون النشطون" />
        <RateChip label="الاستجابة للاستبيانات" percent={stats.surveys.averageResponseRatePercent} note="متوسط عبر الاستبيانات ذات جمهور فعلي" />
        <RateChip label="إنجاز المتابعات" percent={stats.followUps.completionRatePercent} note="المكتملة ÷ (الإجمالي − الملغاة)" />
      </div>

      <p className="mt-6 text-xs text-slate-400">
        تُحسب هذه اللوحة لحظة فتح الصفحة من قاعدة البيانات مباشرة — التفاصيل القابلة للتنزيل في{" "}
        <Link href="/reports" className="font-semibold text-[#1D5BD6]">
          مركز التقارير
        </Link>
        .
      </p>
    </div>
  );
}
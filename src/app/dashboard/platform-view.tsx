/**
 * Phase 10 — SUPER_ADMIN platform dashboard: read-only platform-wide
 * aggregates. No operational controls over school-owned records —
 * school evaluations, grades, submissions and school data remain with
 * school roles (the same boundary the impact/growth modules enforce).
 */
import { getPlatformDashboard } from "@/lib/analytics/service";
import { ROLE_LABELS } from "@/config/analytics";
import { AccessDenied, Card, PageHeader, StatTile } from "@/app/assignments/ui";
import { ActivityTrendChart, BarList, DashboardLinks, DataTable, RateChip, SectionTitle } from "@/app/dashboard/ui";

export async function PlatformDashboardView({ actor }: { actor: { id: string; role: string } }) {
  const result = await getPlatformDashboard({
    id: actor.id,
    role: "SUPER_ADMIN",
    schoolId: null,
    branchId: null,
  });
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const stats = result.data;

  return (
    <div>
      <PageHeader
        title="لوحة التحكم — مدير النظام"
        subtitle={`رؤية عامة على مستوى المنصة محسوبة من البيانات المحفوظة — آخر تحديث: ${new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" }).format(stats.generatedAt)}`}
      />

      <DashboardLinks
        links={[
          { href: "/analytics", label: "التحليلات والمؤشرات" },
          { href: "/reports", label: "مركز التقارير" },
          { href: "/archive", label: "الأرشيف" },
          { href: "/impact", label: "قياس الأثر" },
          { href: "/growth", label: "النمو المهني" },
        ]}
      />

      <SectionTitle>المدارس والحسابات</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="المدارس المسجلة" value={stats.schoolsTotal} tone="brand" />
        <StatTile label="مدارس نشطة" value={stats.schoolsActive} tone="success" />
        <StatTile label="مدارس موقوفة" value={stats.schoolsInactive} tone="warning" />
        <StatTile label="الفروع" value={stats.branchesTotal} />
        <StatTile label="المعلمون النشطون" value={stats.teachersActive} tone="brand" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="المستخدمون حسب الدور">
          <BarList items={stats.usersByRole.map((row) => ({ label: ROLE_LABELS[row.role] ?? row.role, value: row.count }))} />
        </Card>
        <Card title="مؤشرات عامة">
          <div className="grid grid-cols-2 gap-3">
            <RateChip label="معدل نجاح التقييمات" percent={stats.passRatePercent} note="المحاولات الناجحة ÷ المحاولات النهائية" />
            <RateChip label="نسبة التصحيح" percent={null} note={`مصححة ${stats.submissionsGraded} من ${stats.submissionsActive} تسليمًا`} />
          </div>
        </Card>
      </div>

      <SectionTitle>التدريب والتقييم والتسليمات</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="برامج منشورة" value={stats.programsPublished} />
        <StatTile label="دورات منشورة" value={stats.coursesPublished} />
        <StatTile label="التحاقات نشطة" value={stats.enrollmentsTotal} tone="brand" />
        <StatTile label="تقييمات منشورة" value={stats.assessmentsPublished} />
        <StatTile label="تكليفات منشورة" value={stats.assignmentsPublished} />
        <StatTile label="تسليمات نشطة" value={stats.submissionsActive} />
        <StatTile label="تسليمات مصححة" value={stats.submissionsGraded} tone="success" />
        <StatTile label="محاولات نهائية" value={stats.attemptsFinalized} />
        <StatTile label="محاولات ناجحة" value={stats.attemptsPassed} tone="success" />
        <StatTile label="بانتظار مراجعة يدوية" value={stats.attemptsFinalized === 0 ? 0 : "—"} hint="تفصيل المراجعة داخل صفحة كل تقييم" />
      </div>

      <SectionTitle>الشهادات والاستبيانات والمتابعة</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatTile label="شهادات صادرة" value={stats.certificatesIssued} tone="success" />
        <StatTile label="شهادات ملغاة" value={stats.certificatesRevoked} tone="warning" />
        <StatTile label="استبيانات" value={stats.surveysTotal} />
        <StatTile label="ردود مرسلة" value={stats.surveyResponsesSubmitted} />
        <StatTile label="سجلات متابعة نشطة" value={stats.followUpsTotal} />
        <StatTile label="متابعات مكتملة" value={stats.followUpsCompleted} tone="brand" />
      </div>

      <SectionTitle>اتجاهات المنصة — ستة أشهر</SectionTitle>
      <Card>
        <ActivityTrendChart trends={stats.trends} />
      </Card>

      <SectionTitle>تفصيل المدارس</SectionTitle>
      <Card>
        {stats.perSchool.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد مدارس مسجلة بعد.</p>
        ) : (
          <DataTable headers={["المدرسة", "الحالة", "المعلمون", "الالتحاقات", "التسليمات", "الشهادات", "الاستبيانات", "متابعات مكتملة"]}>
            {stats.perSchool.map((school) => (
              <tr key={school.schoolId} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-700">{school.schoolName}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${school.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                    {school.isActive ? "نشطة" : "موقوفة"}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{school.teachers}</td>
                <td className="px-3 py-2 text-slate-600">{school.enrollments}</td>
                <td className="px-3 py-2 text-slate-600">{school.submissions}</td>
                <td className="px-3 py-2 text-slate-600">{school.certificates}</td>
                <td className="px-3 py-2 text-slate-600">{school.surveys}</td>
                <td className="px-3 py-2 text-slate-600">{school.followUpsCompleted}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
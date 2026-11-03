/**
 * Phase 10 — التحليلات والمؤشرات: the chart-heavy analytics view.
 *   SUPER_ADMIN → platform trends + per-school comparison table.
 *   MANAGER / DEPUTY → school trends, branch comparison, status
 *   distributions (enrollment completion, submission statuses).
 *   SUPERVISOR → coverage-scoped view over the same primitives.
 *   TEACHER → denied (personal analytics live on their dashboard).
 *
 * Reuses the SAME dashboard data services — one source of numbers.
 */
import { getCurrentUser } from "@/lib/auth/session";
import { toAnalyticsActor } from "@/lib/analytics/access";
import {
  getPlatformDashboard,
  getSchoolDashboard,
  getSupervisorDashboard,
} from "@/lib/analytics/service";
import { ROLE_LABELS } from "@/config/analytics";
import { AccessDenied, Card, EmptyState, PageHeader, StatTile } from "@/app/assignments/ui";
import { ActivityTrendChart, BarList, DataTable, RateChip, SectionTitle } from "@/app/dashboard/ui";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const actor = toAnalyticsActor(user);
  if (!actor) {
    return <AccessDenied hint="دور الحساب غير معروف — راجع مدير المنصة." />;
  }
  if (actor.role === "TEACHER") {
    return (
      <AccessDenied hint="التحليلات المؤسسية للأدوار الإدارية — مؤشراتك الشخصية في لوحتك." />
    );
  }

  /* ------------------------------------------ SUPER_ADMIN: platform */
  if (actor.role === "SUPER_ADMIN") {
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
          title="التحليلات والمؤشرات — على مستوى المنصة"
          subtitle="اتجاهات ومقارنات محسوبة من السجلات المحفوظة — عرض للقراءة فقط"
        />
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="التحاقات نشطة" value={stats.enrollmentsTotal} tone="brand" />
          <StatTile label="تسليمات نشطة" value={stats.submissionsActive} />
          <StatTile label="شهادات صادرة" value={stats.certificatesIssued} tone="success" />
          <StatTile label="ردود استبيانات" value={stats.surveyResponsesSubmitted} />
        </div>

        <SectionTitle>اتجاهات المنصة</SectionTitle>
        <Card>
          <ActivityTrendChart trends={stats.trends} />
        </Card>

        <SectionTitle>مقارنة المدارس</SectionTitle>
        <Card>
          {stats.perSchool.length === 0 ? (
            <EmptyState title="لا توجد مدارس بعد" />
          ) : (
            <DataTable headers={["المدرسة", "المعلمون", "الالتحاقات", "التسليمات", "الشهادات", "الاستبيانات", "متابعات مكتملة"]}>
              {stats.perSchool.map((school) => (
                <tr key={school.schoolId} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-700">
                    {school.schoolName}
                    {!school.isActive ? <span className="mr-2 text-[10px] text-slate-400">(موقوفة)</span> : null}
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

        <SectionTitle>توزيع المستخدمين</SectionTitle>
        <Card>
          <BarList items={stats.usersByRole.map((row) => ({ label: ROLE_LABELS[row.role] ?? row.role, value: row.count }))} />
        </Card>
      </div>
    );
  }

  /* ------------------------------------- SUPERVISOR: scoped charts */
  if (actor.role === "EDUCATIONAL_SUPERVISOR") {
    const result = await getSupervisorDashboard(actor);
    if (!result.ok) return <AccessDenied hint={result.message} />;
    const stats = result.data;
    const rosterItems = stats.roster.map((row) => ({
      label: row.teacherName,
      value: row.coursesCompleted,
      hint: `من ${row.coursesEnrolled} التحقق`,
    }));
    return (
      <div>
        <PageHeader
          title="التحليلات والمؤشرات — نطاق إشرافك"
          subtitle={`${stats.scopeLabel} — كل الأرقام من سجلات معلميك المحفوظة`}
        />
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="معلمو النطاق" value={stats.coverageTeacherCount} tone="brand" />
          <StatTile label="تسليمات بانتظار مراجعتك" value={stats.submissionsPendingReview} tone="warning" />
          <StatTile label="محاولات بانتظار تصحيح يدوي" value={stats.attemptsNeedingReview} tone="warning" />
          <StatTile
            label="متوسط نتائج معلميك"
            value={stats.avgPercentage === null ? "—" : `${stats.avgPercentage}%`}
          />
        </div>

        <SectionTitle>الدورات المستوفاة لكل معلم (نفس قاعدة أهلية الشهادة)</SectionTitle>
        <Card>
          <BarList items={rosterItems} emptyMessage="لا يوجد معلمون ضمن نطاقك بعد" />
        </Card>

        <SectionTitle>إنجاز المتابعات في نطاقك</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <RateChip
            label="نسبة الإنجاز"
            percent={stats.followUps.completionRatePercent}
            note="المكتملة ÷ (الإجمالي − الملغاة)"
          />
          <RateChip label="متابعات متأخرة" percent={null} note={`عددها: ${stats.followUpsOverdue}`} />
          <RateChip
            label="متابعات قادمة"
            percent={null}
            note={`خلال أسبوعين: ${stats.upcomingFollowUps.length}`}
          />
        </div>
      </div>
    );
  }

  /* -------------------------- MANAGER / DEPUTY: school analytics */
  const result = await getSchoolDashboard(actor);
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const stats = result.data;

  return (
    <div>
      <PageHeader
        title="التحليلات والمؤشرات"
        subtitle={`${stats.schoolName} — كل المؤشرات محسوبة من البيانات المحفوظة بمقامات معلنة`}
      />

      <SectionTitle>اتجاهات المدرسة</SectionTitle>
      <Card>
        <ActivityTrendChart trends={stats.trends} />
      </Card>

      <SectionTitle>مقارنة الفروع</SectionTitle>
      <Card>
        {stats.teachersByBranch.length === 0 ? (
          <EmptyState title="لا توجد فروع نشطة بعد" />
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

      <SectionTitle>مؤشرات التدريب والتقييم</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RateChip label="نسبة الالتحاق" percent={stats.enrollmentRatePercent} note="ملتحقون ÷ المعلمون النشطون" />
        <RateChip label="معدل نجاح التقييمات" percent={stats.passRatePercent} note="الناجحة ÷ النهائية" />
        <RateChip label="نسبة تصحيح التسليمات" percent={stats.submissionCompletionPercent} note="المصححة ÷ غير المسودة" />
        <RateChip label="متوسط الاستجابة للاستبيانات" percent={stats.surveys.averageResponseRatePercent} note="عبر الاستبيانات ذات جمهور فعلي" />
      </div>

      <SectionTitle>حصيلة الشهادات</SectionTitle>
      <Card>
        <BarList
          items={[
            { label: "صادرة وسارية", value: stats.certificatesIssued },
            { label: "ملغاة", value: stats.certificatesRevoked },
            { label: "منتهية صلاحية (مشتقة من تاريخ الانتهاء)", value: stats.certificatesExpired },
          ]}
          emptyMessage="لا توجد شهادات بعد"
        />
      </Card>
    </div>
  );
}
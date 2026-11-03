/**
 * Phase 9 — "قياس الأثر" role-adaptive outcome dashboard:
 *   SUPER_ADMIN → platform-wide aggregates per school (read-only).
 *   MANAGER / SUPERVISOR / DEPUTY → school/scope overview combining
 *   survey response metrics, follow-up completion and stage-pair
 *   candidates for pre/post analysis.
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import {
  getPlatformImpactStats,
  getSchoolImpactOverview,
  listStagePairCandidates,
} from "@/lib/impact/service";
import { SURVEY_STAGE_LABELS, type SurveyStage } from "@/config/surveys";
import { AccessDenied, Card, EmptyState, PageHeader, StatTile } from "@/app/assignments/ui";
import { SurveyStageBadge } from "@/app/surveys/ui";

export const dynamic = "force-dynamic";

function actorFrom(user: { id: string; role: string; schoolId: string | null }): SurveyActor | null {
  if (
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    user.role === "EDUCATIONAL_SUPERVISOR" ||
    user.role === "EDUCATIONAL_DEPUTY" ||
    user.role === "SUPER_ADMIN"
  ) {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

export default async function ImpactDashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return (
      <AccessDenied hint="لوحة قياس الأثر متاحة للأدوار الإدارية — للمعلّم: مؤشراتك المهنية في صفحة النمو المهني." />
    );
  }

  /* ------------------------------------------- Super Admin: platform */
  if (ctx.role === "SUPER_ADMIN") {
    const stats = await getPlatformImpactStats(ctx);
    if (!stats.ok) return <AccessDenied hint={stats.message} />;
    const { totals, schools } = stats.data;
    return (
      <div>
        <PageHeader
          title="مؤشرات التنمية المهنية — على مستوى المنصة"
          subtitle="إحصاءات مجمعة من بيانات المدارس الحقيقية — بدون صلاحيات تشغيلية على بيانات أي مدرسة"
        />
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatTile label="المدارس" value={totals.schools} tone="brand" />
          <StatTile label="الاستبيانات" value={totals.surveys} />
          <StatTile label="الردود المرسلة" value={totals.submittedResponses} tone="success" />
          <StatTile label="سجلات المتابعة" value={totals.followUps} />
          <StatTile label="متابعات مكتملة" value={totals.completedFollowUps} tone="warning" />
        </div>
        <Card>
          <h2 className="mb-4 text-sm font-bold text-slate-800">تفصيل المدارس</h2>
          {schools.length === 0 ? (
            <EmptyState title="لا توجد مدارس" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">المدرسة</th>
                    <th className="px-3 py-2 font-medium">الاستبيانات</th>
                    <th className="px-3 py-2 font-medium">الردود</th>
                    <th className="px-3 py-2 font-medium">المتابعات</th>
                    <th className="px-3 py-2 font-medium">مكتملة</th>
                  </tr>
                </thead>
                <tbody>
                  {schools.map((school) => (
                    <tr key={school.schoolId} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-700">{school.schoolName}</td>
                      <td className="px-3 py-2 text-slate-600">{school.surveysCount}</td>
                      <td className="px-3 py-2 text-slate-600">{school.submittedResponses}</td>
                      <td className="px-3 py-2 text-slate-600">{school.followUpsCount}</td>
                      <td className="px-3 py-2 text-slate-600">{school.completedFollowUps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  }

  /* --------------------------------- School-scoped impact overview */
  const [overview, candidates] = await Promise.all([
    getSchoolImpactOverview(ctx),
    listStagePairCandidates(ctx),
  ]);
  if (!overview.ok) return <AccessDenied hint={overview.message} />;
  const { surveys, followUps, stageSurveyCount } = overview.data;
  const stagePairs = candidates.ok ? candidates.data.filter((row) => row.hasComparisonData) : [];

  return (
    <div>
      <PageHeader
        title="قياس الأثر"
        subtitle="مؤشرات الاستجابة والإنجاز المحسوبة من بيانات حقيقية — كل مؤشر بمقام معلن"
      />

      <h2 className="mb-3 text-sm font-bold text-slate-700">الاستبيانات والاستجابة</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="إجمالي الاستبيانات" value={surveys.totalSurveys} tone="brand" />
        <StatTile label="منشورة" value={surveys.openSurveys} tone="success" />
        <StatTile label="ردود مستلمة" value={surveys.submittedResponses} />
        <StatTile
          label="متوسط نسبة الاستجابة"
          value={surveys.averageResponseRatePercent === null ? "—" : `${surveys.averageResponseRatePercent}%`}
          tone="warning"
        />
        <StatTile label="استبيانات مراحل (قبل/بعد)" value={stageSurveyCount} />
      </div>

      <h2 className="mb-3 text-sm font-bold text-slate-700">متابعة التطبيق</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="إجمالي السجلات" value={followUps.total} tone="brand" />
        <StatTile label="مجدولة / قيد التنفيذ" value={`${followUps.planned} / ${followUps.inProgress}`} />
        <StatTile
          label="نسبة الإنجاز"
          value={followUps.completionRatePercent === null ? "—" : `${followUps.completionRatePercent}%`}
          tone="success"
        />
        <StatTile label="سجلات بتحدّيات مسجّلة" value={followUps.withChallenges} tone="warning" />
        <StatTile label="سجلات باحتياجات دعم" value={followUps.withSupportNeeds} tone="warning" />
      </div>

      <Card>
        <h2 className="mb-1 text-sm font-bold text-slate-800">استبيانات مراحل قابلة للمقارنة</h2>
        <p className="mb-4 text-xs text-slate-500">
          استبيانات مرحلة (قبل/بعد) برمز ربط وردود فعلية — تُحسب المقارنة من الأزواج الحقيقية فقط، والتغير المُلاحظ فرق متوسطات لا علاقة سببية.
        </p>
        {stagePairs.length === 0 ? (
          <EmptyState
            title="لا توجد بيانات مقارنة بعد"
            hint="أنشئ استبيانين برمز ربط مشترك (قبل التدريب وبعده) واربطهما ببرنامج أو دورة، وستظهر المقارنة هنا بعد وصول الردود."
          />
        ) : (
          <div className="space-y-3">
            {stagePairs.map((row) => (
              <div key={row.surveyId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700">{row.surveyTitle}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <SurveyStageBadge stage={row.stage} />
                    <span className="text-xs text-slate-500">{row.submittedCount} ردًا</span>
                  </div>
                </div>
                <Link
                  href={`/surveys/${row.surveyId}/results`}
                  className="rounded-lg border border-[#1D5BD6] px-3 py-1.5 text-xs font-semibold text-[#1D5BD6] hover:bg-blue-50"
                >
                  {SURVEY_STAGE_LABELS[row.stage as SurveyStage] ?? "عرض التحليل"}
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
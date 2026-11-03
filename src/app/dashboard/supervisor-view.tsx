/**
 * Phase 10 — EDUCATIONAL_SUPERVISOR dashboard: restricted to assigned
 * teachers + granted branches. Surfaces exactly what requires
 * supervisory action: submissions awaiting review, manual-review
 * attempts, overdue/upcoming follow-ups, and covered teachers'
 * progress (reusing the growth roster rules — one source of truth).
 */
import Link from "next/link";

import type { AnalyticsActor } from "@/lib/analytics/access";
import { getSupervisorDashboard } from "@/lib/analytics/service";
import { FOLLOW_UP_STATUS_LABELS, type FollowUpStatus } from "@/config/surveys";
import { AccessDenied, Card, EmptyState, PageHeader, StatTile } from "@/app/assignments/ui";
import { DashboardLinks, DataTable, SectionTitle } from "@/app/dashboard/ui";

function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    numberingSystem: "latn",
  }).format(date);
}

export async function SupervisorDashboardView({ actor }: { actor: AnalyticsActor }) {
  const result = await getSupervisorDashboard(actor);
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const stats = result.data;

  return (
    <div>
      <PageHeader
        title="لوحة التحكم — المشرف التربوي"
        subtitle={`${stats.scopeLabel} — ${stats.coverageTeacherCount} معلمًا عبر ${stats.coverageBranchCount} فرعًا ممنوحًا`}
      />

      <DashboardLinks
        links={[
          { href: "/analytics", label: "التحليلات والمؤشرات" },
          { href: "/reports", label: "مركز التقارير" },
          { href: "/archive", label: "الأرشيف" },
          { href: "/assignments/review", label: "مراجعة التسليمات" },
          { href: "/surveys/new", label: "استبيان جديد" },
          { href: "/follow-ups/new", label: "متابعة جديدة" },
        ]}
      />

      <SectionTitle>مهام تنتظر إجراءك</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="تسليمات بانتظار المراجعة" value={stats.submissionsPendingReview} tone="warning" />
        <StatTile label="محاولات بانتظار التصحيح اليدوي" value={stats.attemptsNeedingReview} tone="warning" />
        <StatTile label="متابعات متأخرة" value={stats.followUpsOverdue} tone="warning" />
        <StatTile label="متابعات قادمة (14 يومًا)" value={stats.upcomingFollowUps.length} tone="brand" />
        <StatTile
          label="متوسط نتائج معلميك"
          value={stats.avgPercentage === null ? "—" : `${stats.avgPercentage}%`}
          hint="المحاولات النهائية لمعلمي النطاق"
        />
      </div>

      <SectionTitle>قائمة المراجعة — أحدث التسليمات</SectionTitle>
      <Card>
        {stats.pendingReviewSample.length === 0 ? (
          <EmptyState title="لا توجد تسليمات بانتظار المراجعة" hint="عندما يرسل معلموك تسليمات ستظهر هنا." />
        ) : (
          <DataTable headers={["التكليف", "المعلم", "آخر إرسال", "إجراء"]}>
            {stats.pendingReviewSample.map((row) => (
              <tr key={row.submissionId} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-700">{row.assignmentTitle}</td>
                <td className="px-3 py-2 text-slate-600">{row.teacherName}</td>
                <td className="px-3 py-2 text-slate-500">{formatDate(row.lastSubmittedAt)}</td>
                <td className="px-3 py-2">
                  <Link href="/assignments/review" className="text-xs font-semibold text-[#1D5BD6]">
                    فتح قائمة المراجعة
                  </Link>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <SectionTitle>متابعات قادمة</SectionTitle>
      <Card>
        {stats.upcomingFollowUps.length === 0 ? (
          <EmptyState title="لا توجد متابعات مجدولة خلال أسبوعين" />
        ) : (
          <DataTable headers={["السجل", "المعلم", "تاريخ الجلسة", "الحالة"]}>
            {stats.upcomingFollowUps.map((row) => (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-700">{row.titleAr}</td>
                <td className="px-3 py-2 text-slate-600">{row.teacherName}</td>
                <td className="px-3 py-2 text-slate-500">{formatDate(row.followUpDate)}</td>
                <td className="px-3 py-2 text-slate-600">
                  {FOLLOW_UP_STATUS_LABELS[row.status as FollowUpStatus] ?? row.status}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <SectionTitle>نطاق الإشراف بالأرقام</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="استبياناتي المنشورة" value={stats.surveysOpen} tone="brand" />
        <StatTile label="ردود على استبياناتي" value={stats.surveysResponsesSubmitted} />
        <StatTile
          label="نسبة إنجاز المتابعات"
          value={stats.followUps.completionRatePercent === null ? "—" : `${stats.followUps.completionRatePercent}%`}
          tone="success"
          hint="المكتملة ÷ (الإجمالي − الملغاة) في نطاقك"
        />
        <StatTile label="متابعات مجدولة / قيد التنفيذ" value={`${stats.followUps.planned} / ${stats.followUps.inProgress}`} />
        <StatTile label="شهادات سارية لمعلميك" value={stats.certificatesActive} />
      </div>

      <SectionTitle>تقدم معلمي النطاق (نفس قواعد النمو المهني)</SectionTitle>
      <Card>
        {stats.roster.length === 0 ? (
          <EmptyState
            title="لا يوجد معلمون ضمن نطاق إشرافك بعد"
            hint="يحدد النطاق بتعيينات المعلمين أو منح الفروع المخزنة في النظام."
          />
        ) : (
          <DataTable headers={["المعلم", "الفرع", "التحاقات", "دورات مستوفاة", "شهادات سارية", "متوسط النتائج"]}>
            {stats.roster.map((row) => (
              <tr key={row.teacherId} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-700">{row.teacherName}</td>
                <td className="px-3 py-2 text-slate-600">{row.branchName ?? "بدون فرع"}</td>
                <td className="px-3 py-2 text-slate-600">{row.coursesEnrolled}</td>
                <td className="px-3 py-2 text-slate-600">{row.coursesCompleted}</td>
                <td className="px-3 py-2 text-slate-600">{row.certificatesActive}</td>
                <td className="px-3 py-2 text-slate-600" dir="ltr">
                  {row.avgBestPercentage === null ? "—" : `${row.avgBestPercentage}%`}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
/**
 * Phase 10 — TEACHER personal dashboard. Every query is bound to the
 * signed-in user id; other teachers' records and school-wide data are
 * structurally out of reach (the data functions filter by userId —
 * there is no scope flag a payload could widen).
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { getTeacherDashboard } from "@/lib/analytics/service";
import { AccessDenied, Card, EmptyState, PageHeader, StatTile } from "@/app/assignments/ui";
import { DashboardLinks, DataTable, SectionTitle } from "@/app/dashboard/ui";

function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    numberingSystem: "latn",
  }).format(date);
}

export async function TeacherDashboardView() {
  const user = await getCurrentUser();
  if (!user || user.role !== "TEACHER") {
    return <AccessDenied hint="لوحة المعلم متاحة لحسابات المعلمين فقط." />;
  }
  const result = await getTeacherDashboard({ id: user.id, role: user.role, schoolId: user.schoolId });
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const stats = result.data;

  return (
    <div>
      <PageHeader
        title="لوحتي"
        subtitle="مؤشراتك الشخصية من بياناتك أنت فقط — لا تظهر هنا بيانات زملائك أو أرقام عامة للمدرسة"
      />

      <DashboardLinks
        links={[
          { href: "/my-assignments", label: "تكليفاتي" },
          { href: "/my-surveys", label: "استبياناتي" },
          { href: "/my-certificates", label: "شهاداتي" },
          { href: "/my-growth", label: "نموي المهني" },
          { href: "/my-follow-ups", label: "متابعاتي المشتركة" },
        ]}
      />

      <SectionTitle>دوراتي وتقدمي</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="دوراتي النشطة" value={stats.courses.length} tone="brand" />
        <StatTile label="دورات استوفت متطلباتها" value={stats.coursesCompleted} tone="success" />
        <StatTile label="تقييمات متاحة قبل أن أجرّبها" value={stats.availableAssessments} tone="warning" />
        <StatTile label="محاولاتي النهائية" value={stats.attemptsFinalized} />
        <StatTile label="محاولات ناجحة" value={stats.attemptsPassed} tone="success" />
        <StatTile
          label="متوسط نتائجي"
          value={stats.avgPercentage === null ? "—" : `${stats.avgPercentage}%`}
          hint="محاولاتي النهائية فقط"
        />
      </div>

      <SectionTitle>دوراتي</SectionTitle>
      <Card>
        {stats.courses.length === 0 ? (
          <EmptyState title="لست ملتحقًا بدورات بعد" hint="ستظهر دوراتك هنا بمجرد التحاقك من أكاديمية التدريب." />
        ) : (
          <DataTable headers={["الدورة", "البرنامج", "المدرب", "الحالة"]}>
            {stats.courses.map((course) => (
              <tr key={course.courseId} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-700">{course.titleAr}</td>
                <td className="px-3 py-2 text-slate-600">{course.programName ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{course.instructorName ?? "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      course.completed
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-blue-200 bg-blue-50 text-[#1D5BD6]"
                    }`}
                  >
                    {course.completed ? "استوفيت المتطلبات" : "قيد التقدم"}
                  </span>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <SectionTitle>تكليفاتي</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="بانتظار إنجازي / مُعادة" value={stats.assignmentsPending} tone="warning" />
        <StatTile label="مرسلة بانتظار التصحيح" value={stats.assignmentsAwaitingReview} />
        <StatTile label="مصححة" value={stats.assignmentsGraded} tone="success" />
        <StatTile label="استبيانات تنتظر ردي" value={stats.surveysAwaiting} tone="brand" />
      </div>

      <SectionTitle>أحدث ملاحظات المصححين</SectionTitle>
      <Card>
        {stats.recentFeedback.length === 0 ? (
          <EmptyState title="لا توجد ملاحظات تصحيح بعد" hint="ستظهر ملاحظات المصحح على تسليماتك هنا بعد التصحيح." />
        ) : (
          <div className="space-y-3">
            {stats.recentFeedback.map((feedback, index) => (
              <div
                key={`${feedback.assignmentTitle}-${index}`}
                className="rounded-lg border border-slate-100 bg-slate-50/60 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-700">{feedback.assignmentTitle}</p>
                  <span className="text-xs font-bold text-[#1D5BD6]" dir="ltr">
                    {feedback.scoreTotal ?? "—"}/{feedback.totalPoints}
                  </span>
                </div>
                {feedback.feedbackText ? (
                  <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{feedback.feedbackText}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-slate-400">صُحح في {formatDate(feedback.reviewedAt)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <SectionTitle>أحدث نتائجي في التقييمات</SectionTitle>
      <Card>
        {stats.recentAttempts.length === 0 ? (
          <EmptyState title="لا توجد محاولات تقييم منتهية بعد" />
        ) : (
          <DataTable headers={["التقييم", "النسبة", "النتيجة", "التاريخ"]}>
            {stats.recentAttempts.map((attempt, index) => (
              <tr key={`${attempt.assessmentTitle}-${index}`} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-700">{attempt.assessmentTitle}</td>
                <td className="px-3 py-2 text-slate-600" dir="ltr">
                  {attempt.percentage === null ? "—" : `${attempt.percentage}%`}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      attempt.passed
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-red-200 bg-red-50 text-red-600"
                    }`}
                  >
                    {attempt.passed ? "ناجحة" : "غير ناجحة"}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500">{formatDate(attempt.submittedAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <SectionTitle>شهاداتي ومتابعاتي المشتركة</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="شهاداتي">
          <p className="text-3xl font-bold text-[#1D5BD6]">{stats.certificatesActive}</p>
          <p className="mt-1 text-xs text-slate-500">شهادات سارية</p>
          <Link href="/my-certificates" className="mt-3 inline-block text-xs font-semibold text-[#1D5BD6]">
            عرض شهاداتي وطباعتها
          </Link>
        </Card>
        <Card title="متابعات مشتركة من مشرفي">
          {stats.sharedFollowUpsCount === 0 ? (
            <EmptyState title="لا توجد متابعات مشتركة حاليًا" hint="المشرف يشارك ما يختاره صراحةً فقط." />
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-3xl font-bold text-[#1D5BD6]">{stats.sharedFollowUpsCount}</p>
              <Link href="/my-follow-ups" className="text-xs font-semibold text-[#1D5BD6]">
                عرض التفاصيل المشتركة
              </Link>
            </div>
          )}
        </Card>
      </div>

      <SectionTitle>نشاطي — ستة أشهر</SectionTitle>
      <Card>
        <p className="mb-3 text-xs text-slate-500">
          التحاقاتي، تسليماتي، وشهاداتي خلال الأشهر الستة الأخيرة (المصدر: سجلاتك المحفوظة).
        </p>
        <div className="grid grid-cols-3 gap-3">
          {stats.trends.labels.map((label, index) => (
            <div key={`${label}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-center">
              <p className="text-[11px] font-semibold text-slate-500">{label}</p>
              <p className="mt-1 text-xs text-slate-600">
                التحاق: <span dir="ltr" className="font-bold">{stats.trends.enrollments[index]}</span>
              </p>
              <p className="text-xs text-slate-600">
                تسليم: <span dir="ltr" className="font-bold">{stats.trends.submissions[index]}</span>
              </p>
              <p className="text-xs text-slate-600">
                شهادات: <span dir="ltr" className="font-bold">{stats.trends.certificates[index]}</span>
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
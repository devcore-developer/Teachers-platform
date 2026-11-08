import Link from "next/link";
import {
  Bell,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  MonitorPlay,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";

import {
  EmptyHint,
  Panel,
  Pill,
  StatCard,
  formatDate,
  statusLabel,
  statusTone,
} from "@/app/supervision/supervisor-ui";
import {
  getSupervisorDashboard,
  requireSupervisorContext,
} from "@/lib/supervision/training";

export const metadata = { title: "لوحة المشرف التربوي" };

/**
 * Supervisor dashboard — every number comes from live PostgreSQL
 * aggregates (assigned teachers ∪ branch coverage, school-scoped
 * courses, real attempts/completions/surveys/follow-ups).
 */
export default async function SupervisorDashboardPage() {
  const ctx = await requireSupervisorContext();
  const data = await getSupervisorDashboard(ctx);

  const passRate =
    data.attempts.total > 0
      ? Math.round((data.attempts.passed / data.attempts.total) * 100)
      : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-foreground">
            لوحة المشرف التربوي
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            مرحبًا {ctx.name} — مؤشرات مدرستك ومعلميك المسندَين إليك، محدثة لحظيًا
            من قاعدة البيانات.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/supervision/training"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-700"
          >
            <MonitorPlay className="size-4" aria-hidden="true" />
            إدارة الدورات
          </Link>
          <Link
            href="/supervision/assessments"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent"
          >
            <ClipboardCheck className="size-4" aria-hidden="true" />
            الأسئلة والاختبارات
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Users} label="معلموك المسندون" value={data.teachersCount} hint="إسناد مباشر + تغطية الفروع" />
        <StatCard
          icon={BookOpen}
          label="دورات المدرسة"
          value={data.courses.total}
          hint={`${data.courses.PUBLISHED} منشورة · ${data.courses.DRAFT} مسودة`}
          tone="info"
        />
        <StatCard
          icon={GraduationCap}
          label="إتمامات معلميك"
          value={data.completionsCount}
          hint={`${data.enrollmentsCount} تسجيلًا في الدورات`}
          tone="success"
        />
        <StatCard
          icon={TrendingUp}
          label="أدوات قياس الأثر"
          value={data.impact.surveysCount}
          hint={`${data.impact.responsesCount} استجابة مسجلة`}
          tone="warning"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={ClipboardCheck} label="اختبارات المدرسة" value={data.assessments.total} hint={`${data.assessments.published} منشور`} tone="info" />
        <StatCard icon={ClipboardCheck} label="محاولات معلميك" value={data.attempts.total} tone="neutral" />
        <StatCard icon={UserCheck} label="محاولات ناجحة" value={data.attempts.passed} hint={passRate !== null ? `نسبة النجاح ${passRate}%` : undefined} tone="success" />
        <StatCard icon={ClipboardCheck} label="بحاجة تصحيح يدوي" value={data.attempts.needsReview} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="معلموك المسندون"
          description="أول 8 معلمين — الإسناد المباشر وتغطية الفروع داخل مدرستك."
          action={
            <Link
              href="/supervision/growth"
              className="text-xs font-bold text-brand-600 hover:underline"
            >
              لوحة النمو المهني
            </Link>
          }
        >
          {data.teachers.length === 0 ? (
            <EmptyHint
              title="لا يوجد معلمون مسندون بعد"
              description="يُدار الإسناد من إدارة مدرستك (إدارة المعلمين)."
            />
          ) : (
            <ul className="divide-y">
              {data.teachers.map((teacher) => (
                <li key={teacher.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{teacher.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground" dir="ltr">
                      {teacher.email ?? "—"}
                    </p>
                  </div>
                  <Pill tone="info">{teacher.growthLevel}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="متابعات معلّقة" description="جلسات المتابعة التي تنتظر إنجازك.">
          {data.pendingFollowUps.length === 0 ? (
            <EmptyHint title="لا متابعات معلّقة" description="كل جلسات المتابعة مكتملة أو ملغاة." />
          ) : (
            <ul className="divide-y">
              {data.pendingFollowUps.map((followUp) => (
                <li key={followUp.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{followUp.titleAr}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {followUp.teacherName} — {formatDate(followUp.followUpDate)}
                    </p>
                  </div>
                  <Pill tone={statusTone(followUp.status)}>{statusLabel(followUp.status)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="أحدث إتمامات معلميك" description="آخر 5 إتمامات دورات مسجلة.">
          {data.recentCompletions.length === 0 ? (
            <EmptyHint title="لا إتمامات بعد" description="ستظهر هنا فور إتمام معلميك لدوراتهم." />
          ) : (
            <ul className="divide-y">
              {data.recentCompletions.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{row.teacherName}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{row.courseTitleAr}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatDate(row.completedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="آخر الإشعارات" description="أحدث 5 إشعارات وصلتك داخل المنصة.">
          {data.latestNotifications.length === 0 ? (
            <EmptyHint title="لا إشعارات" />
          ) : (
            <ul className="divide-y">
              {data.latestNotifications.map((notification) => (
                <li key={notification.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-bold text-foreground">
                      {notification.titleAr}
                    </p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatDate(notification.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {notification.bodyAr}
                  </p>
                  {notification.destinationUrl && (
                    <Link
                      href={notification.destinationUrl}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:underline"
                    >
                      <Bell className="size-3" aria-hidden="true" />
                      فتح
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

import { SchoolsMetricsSection } from "@/components/dashboard/schools-metrics";
import { UsersMetricsSection } from "@/components/dashboard/users-metrics";
import { RegistrationMetricsSection } from "@/components/dashboard/registration-metrics";
import { AcademyMetricsSection } from "@/components/dashboard/academy-metrics";
import { AssessmentMetricsSection } from "@/components/dashboard/assessment-metrics";
import { RoleDashboard } from "@/components/dashboard/role-dashboard";
import { ItCoordinatorDashboard } from "@/components/dashboard/it-coordinator-dashboard";
import { SupervisorDashboardSection } from "@/app/supervision/dashboard/section";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAcademyMetrics } from "@/lib/training/service";
import { getAssessmentMetrics } from "@/lib/assessment/service";
import {
  getPlatformUsersMetrics,
  getSchoolUsersMetrics,
} from "@/lib/users/directory";

export const metadata = {
  title: "لوحة المعلومات",
};

/**
 * The formatter is created once at module scope, so the rendered date
 * string is deterministic per request (server-rendered, no hydration
 * mismatch — server components render once on the server only).
 */
const todayFormatter = new Intl.DateTimeFormat("ar-EG", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Inline server-rendered page header. We deliberately do NOT use the
 * shared PageHeader here: it is a client component and its `module` prop
 * is a NavItem whose `icon` holds a component reference — such objects
 * cannot cross the server→client boundary (Next.js "Only plain objects
 * can be passed to Client Components"). Plain JSX keeps this whole page
 * server-rendered; lucide icons rendered INSIDE server components are
 * fine — only component references passed as PROPS are not.
 */
function DashboardHeader({ description }: { description: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">لوحة المعلومات</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">
        <CalendarDays className="size-3.5 text-brand-600" aria-hidden="true" />
        {todayFormatter.format(new Date())}
      </span>
    </div>
  );
}

/**
 * Hero KPI card — the visual anchor of the dashboard. Server-rendered
 * and fully serializable: the lucide icon component reference is
 * consumed INSIDE this server component, never sent to the client.
 * Every value comes from a real DB query (no mocks).
 */
function HeroStat({
  href,
  label,
  value,
  sub,
  icon: Icon,
  tileClass,
}: {
  href: string;
  label: string;
  value: number;
  sub?: string;
  icon: LucideIcon;
  tileClass: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <span
        className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${tileClass}`}
        aria-hidden="true"
      >
        <Icon className="size-6" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-3xl font-extrabold tabular-nums text-foreground">
          {value}
        </span>
        <span className="mt-1 block truncate text-sm font-bold text-foreground/80">
          {label}
        </span>
        {sub ? (
          <span className="mt-0.5 block truncate text-xs font-medium text-muted-foreground">
            {sub}
          </span>
        ) : null}
      </span>
      <ArrowLeft
        className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-brand-600"
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * Role-aware dashboard (server component) — 100% real data. The Phase-1
 * mock shell (DashboardView: mockOverviewStats cards, mock charts,
 * mock activities/events) is NOT rendered anywhere anymore.
 *
 * Layout: a hero KPI strip (four big DB-backed cards) followed by the
 * detailed metric sections. Every role sees only its real scope:
 *   SUPER_ADMIN                -> platform hero + platform metrics
 *   DEVELOPMENT_OFFICE_MANAGER -> same sections scoped to THEIR school
 *                                 (schoolId from the session only)
 *   SCHOOL_MANAGER             -> office-manager-equivalent dashboard,
 *                                 pinned to THEIR school's metrics
 *   EDUCATIONAL_SUPERVISOR     -> the merged supervisor dashboard
 *                                 (SupervisorDashboardSection)
 *   IT_COORDINATOR             -> the coordinator dashboard (real
 *                                 school-scoped counters + the two
 *                                 server-enforced capabilities)
 *   every other role           -> scoped role dashboard (RoleDashboard)
 */
export default async function HomePage() {
  const user = await requireUser();

  if (user.role === "SUPER_ADMIN") {
    const [users, academy, assessment, openFollowUps] = await Promise.all([
      getPlatformUsersMetrics(),
      getAcademyMetrics(null),
      getAssessmentMetrics(null),
      db.followUp.count({
        where: { archivedAt: null, status: { not: "COMPLETED" } },
      }),
    ]);

    return (
      <div>
        <DashboardHeader description="نظرة شاملة على المنصة: المدارس، المعلمون، الأكاديمية، والمتابعات — كل الأرقام محسوبة من قاعدة البيانات مباشرة." />
        <div
          className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          role="list"
          aria-label="المؤشرات الرئيسية"
        >
          <HeroStat
            href="/users"
            label="إجمالي المعلمين"
            value={users.teachersCount}
            sub={`${users.activeUsers} حساب نشط على المنصة`}
            icon={UserCheck}
            tileClass="bg-brand-100 text-brand-700"
          />
          <HeroStat
            href="/academy"
            label="البرامج التدريبية"
            value={academy.programsTotal}
            sub={`${academy.enrollmentsCount} تسجيل معلمين في الدورات`}
            icon={GraduationCap}
            tileClass="bg-info-soft text-info"
          />
          <HeroStat
            href="/assessments"
            label="محاولات مُقيَّمة"
            value={assessment.attemptsFinalized}
            sub={
              assessment.avgPercentage === null
                ? "لا نتائج مقيَّمة بعد"
                : `متوسط النتائج ${assessment.avgPercentage}%`
            }
            icon={ClipboardCheck}
            tileClass="bg-success-soft text-success"
          />
          <HeroStat
            href="/follow-ups"
            label="متابعات مفتوحة"
            value={openFollowUps}
            sub={
              openFollowUps > 0
                ? "متابعات تربوية لم تُكتمل بعد"
                : "لا يوجد — كل المتابعات مكتملة"
            }
            icon={ClipboardList}
            tileClass="bg-warning-soft text-warning"
          />
        </div>
        <div className="mt-6 space-y-6">
          <SchoolsMetricsSection />
          <RegistrationMetricsSection />
          <UsersMetricsSection />
          <AcademyMetricsSection />
          <AssessmentMetricsSection />
        </div>
      </div>
    );
  }

  if (
    (user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
      user.role === "SCHOOL_MANAGER") &&
    user.schoolId
  ) {
    const [users, academy, assessment, openFollowUps] = await Promise.all([
      getSchoolUsersMetrics(user.schoolId),
      getAcademyMetrics(user.schoolId),
      getAssessmentMetrics(user.schoolId),
      db.followUp.count({
        where: {
          schoolId: user.schoolId,
          archivedAt: null,
          status: { not: "COMPLETED" },
        },
      }),
    ]);

    return (
      <div>
        <DashboardHeader description="تابع حالة التنمية المهنية في مدرستك: المعلمون، البرامج، المحاولات، والمتابعات — كل الأرقام من قاعدة البيانات مباشرة." />
        <div
          className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          role="list"
          aria-label="المؤشرات الرئيسية"
        >
          <HeroStat
            href="/users"
            label="إجمالي المعلمين"
            value={users.teachersCount}
            sub={`${users.activeUsers} حساب نشط في مدرستك`}
            icon={UserCheck}
            tileClass="bg-brand-100 text-brand-700"
          />
          <HeroStat
            href="/academy"
            label="البرامج التدريبية"
            value={academy.programsTotal}
            sub={`${academy.enrollmentsCount} تسجيل معلمين في الدورات`}
            icon={GraduationCap}
            tileClass="bg-info-soft text-info"
          />
          <HeroStat
            href="/assessments"
            label="محاولات مُقيَّمة"
            value={assessment.attemptsFinalized}
            sub={
              assessment.avgPercentage === null
                ? "لا نتائج مقيَّمة بعد"
                : `متوسط النتائج ${assessment.avgPercentage}%`
            }
            icon={ClipboardCheck}
            tileClass="bg-success-soft text-success"
          />
          <HeroStat
            href="/follow-ups"
            label="متابعات مفتوحة"
            value={openFollowUps}
            sub={
              openFollowUps > 0
                ? "متابعات تربوية لم تُكتمل بعد"
                : "لا يوجد — كل المتابعات مكتملة"
            }
            icon={ClipboardList}
            tileClass="bg-warning-soft text-warning"
          />
        </div>
        <div className="mt-6 space-y-6">
          <RegistrationMetricsSection schoolId={user.schoolId} />
          <SchoolsMetricsSection schoolId={user.schoolId} />
          <UsersMetricsSection schoolId={user.schoolId} />
          <AcademyMetricsSection schoolId={user.schoolId} />
          <AssessmentMetricsSection schoolId={user.schoolId} />
        </div>
      </div>
    );
  }

  if (user.role === "EDUCATIONAL_SUPERVISOR") {
    return <SupervisorDashboardSection />;
  }

  // IT coordinator — the coordinator's own dashboard (previously this
  // role fell through to the teacher-style RoleDashboard and the only
  // way to reach /it/* was typing the URL manually).
  if (user.role === "IT_COORDINATOR" && user.schoolId) {
    return <ItCoordinatorDashboard name={user.name} schoolId={user.schoolId} />;
  }

  return <RoleDashboard user={user} />;
}
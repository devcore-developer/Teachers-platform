import { SchoolsMetricsSection } from "@/components/dashboard/schools-metrics";
import { UsersMetricsSection } from "@/components/dashboard/users-metrics";
import { RegistrationMetricsSection } from "@/components/dashboard/registration-metrics";
import { AcademyMetricsSection } from "@/components/dashboard/academy-metrics";
import { AssessmentMetricsSection } from "@/components/dashboard/assessment-metrics";
import { RoleDashboard } from "@/components/dashboard/role-dashboard";
import { ItCoordinatorDashboard } from "@/components/dashboard/it-coordinator-dashboard";
import { PageHeader } from "@/components/layout/page-header";
import { CalendarDays } from "lucide-react";
import { getNavItemId } from "@/config/navigation";
import type { NavItem } from "@/lib/types";
import { requireUser } from "@/lib/auth/session";
import { SupervisorDashboardSection } from "@/app/supervision/dashboard/section";

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
 * Role-aware dashboard (server component) — 100% real data. The Phase-1
 * mock shell (DashboardView: mockOverviewStats cards, mock charts,
 * mock activities/events) is NOT rendered anywhere anymore. Every role
 * sees only its real, DB-backed sections:
 *   SUPER_ADMIN                -> platform metrics (schools, registration,
 *                                 users, academy, assessment)
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
  const homeModule = getNavItemId("home") as NavItem;
  const todayLabel = todayFormatter.format(new Date());

  const headerMeta = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">
      <CalendarDays className="size-3.5 text-brand-600" aria-hidden="true" />
      {todayLabel}
    </span>
  );

  if (user.role === "SUPER_ADMIN") {
    return (
      <div>
        <PageHeader
          module={homeModule}
          title="لوحة المعلومات"
          description="نظرة شاملة على المنصة: المدارس، التسجيلات، المستخدمون، والأكاديمية — كل الأرقام محسوبة من قاعدة البيانات مباشرة."
          meta={headerMeta}
        />
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
    return (
      <div>
        <PageHeader
          module={homeModule}
          title="لوحة المعلومات"
          description="تابع حالة التنمية المهنية في مدرستك: التسجيلات، المعلمون، البرامج، والمتابعات — كل الأرقام من قاعدة البيانات مباشرة."
          meta={headerMeta}
        />
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
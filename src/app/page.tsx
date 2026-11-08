import { SchoolsMetricsSection } from "@/components/dashboard/schools-metrics";
import { UsersMetricsSection } from "@/components/dashboard/users-metrics";
import { AcademyMetricsSection } from "@/components/dashboard/academy-metrics";
import { AssessmentMetricsSection } from "@/components/dashboard/assessment-metrics";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { RoleDashboard } from "@/components/dashboard/role-dashboard";
import { requireUser } from "@/lib/auth/session";
import { SupervisorDashboardSection } from "@/app/supervision/dashboard/section";

export const metadata = {
  title: "لوحة المعلومات",
};

/**
 * Role-aware dashboard (server component). The session user comes from
 * the DB — never from the client:
 *   SUPER_ADMIN                -> platform dashboard + schools + users + academy metrics
 *   DEVELOPMENT_OFFICE_MANAGER -> same shell + THEIR school's metrics
 *                                 (schoolId from the session only)
 *   SCHOOL_MANAGER             -> office-manager-equivalent dashboard,
 *                                 pinned to THEIR school's metrics
 *   EDUCATIONAL_SUPERVISOR     -> the merged supervisor dashboard
 *                                 (SupervisorDashboardSection): the
 *                                 former "لوحة المشرف" widgets — live
 *                                 DB KPIs, assigned teachers & branches,
 *                                 pending follow-ups, completions and
 *                                 notifications — now live HERE, and
 *                                 /supervision/dashboard redirects here.
 *   every other role           -> scoped role dashboard (RoleDashboard)
 *
 * Phase 1 mock sections keep their honest "بيانات تجريبية" labels.
 */
export default async function HomePage() {
  const user = await requireUser();

  if (user.role === "SUPER_ADMIN") {
    return (
      <DashboardView
        schoolsSlot={
          <div className="space-y-6">
            <SchoolsMetricsSection />
            <UsersMetricsSection />
            <AcademyMetricsSection />
            <AssessmentMetricsSection />
          </div>
        }
      />
    );
  }

  if (
    (user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
      user.role === "SCHOOL_MANAGER") &&
    user.schoolId
  ) {
    return (
      <DashboardView
        schoolsSlot={
          <div className="space-y-6">
            <SchoolsMetricsSection schoolId={user.schoolId} />
            <UsersMetricsSection schoolId={user.schoolId} />
            <AcademyMetricsSection schoolId={user.schoolId} />
            <AssessmentMetricsSection schoolId={user.schoolId} />
          </div>
        }
      />
    );
  }

  if (user.role === "EDUCATIONAL_SUPERVISOR") {
    return <SupervisorDashboardSection />;
  }

  return <RoleDashboard user={user} />;
}
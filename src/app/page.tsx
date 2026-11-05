import { redirect } from "next/navigation";

import { SchoolsMetricsSection } from "@/components/dashboard/schools-metrics";
import { UsersMetricsSection } from "@/components/dashboard/users-metrics";
import { AcademyMetricsSection } from "@/components/dashboard/academy-metrics";
import { AssessmentMetricsSection } from "@/components/dashboard/assessment-metrics";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { RoleDashboard } from "@/components/dashboard/role-dashboard";
import { requireUser } from "@/lib/auth/session";

export const metadata = {
  title: "لوحة المعلومات",
};

/**
 * Role-aware dashboard (server component). The session user comes from
 * the DB — never from the client:
 *   SUPER_ADMIN                -> platform dashboard + schools + users + academy metrics
 *   DEVELOPMENT_OFFICE_MANAGER -> same shell + THEIR school's metrics
 *   SCHOOL_MANAGER             -> school dashboard (own school only)
 *   IT_COORDINATOR             -> dedicated IT workspace (/it)
 *   deputy / supervisor / teacher -> scoped role dashboard
 */
export default async function HomePage() {
  const user = await requireUser();

  if (user.role === "IT_COORDINATOR") {
    redirect("/it");
  }

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

  if (user.role === "DEVELOPMENT_OFFICE_MANAGER" && user.schoolId) {
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

  if (user.role === "SCHOOL_MANAGER" && user.schoolId) {
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

  return <RoleDashboard user={user} />;
}
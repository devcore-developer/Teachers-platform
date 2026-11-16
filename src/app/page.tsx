
import { SchoolsMetrics } from "@/components/dashboard/schools-metrics";
import { UsersMetrics } from "@/components/dashboard/users-metrics";
import { RegistrationMetrics } from "@/components/dashboard/registration-metrics";
import { AcademyMetricsSection } from "@/components/dashboard/academy-metrics";
import { AssessmentMetricsSection } from "@/components/dashboard/assessment-metrics";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { RoleDashboard } from "@/components/dashboard/role-dashboard";
import { ItCoordinatorDashboard } from "@/components/dashboard/it-coordinator-dashboard";
import { requireUser } from "@/lib/auth/session";
import { SupervisorDashboardSection } from "@/app/supervision/dashboard/section";

export const metadata = {
  title: "لوحة المعلومات",
};

export default async function HomePage() {
  const user = await requireUser();

  if (user.role === "SUPER_ADMIN") {
    return (
      <DashboardView
        schoolsSlot={
          <div className="space-y-6">
            <SchoolsMetrics schoolId={null} />
            <RegistrationMetrics schoolId={null} />
            <UsersMetrics schoolId={null} />
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
            <RegistrationMetrics schoolId={user.schoolId} />
            <SchoolsMetrics schoolId={user.schoolId} />
            <UsersMetrics schoolId={user.schoolId} />
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

  if (user.role === "IT_COORDINATOR" && user.schoolId) {
    return (
      <ItCoordinatorDashboard
        name={user.name}
        schoolId={user.schoolId}
      />
    );
  }

  return <RoleDashboard user={user} />;
}

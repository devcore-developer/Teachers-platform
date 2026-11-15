/**
 * Phase 10 — لوحة التحكم role-adaptive dashboard router.
 *
 * One route, six server-side views. The role comes from the session —
 * never from a query param — and each view queries only what that role
 * may see:
 *   SUPER_ADMIN                → platform-wide aggregates (read-only)
 *   DEVELOPMENT_OFFICE_MANAGER → own-school operational dashboard
 *   EDUCATIONAL_DEPUTY         → granted schools (read-only)
 *   EDUCATIONAL_SUPERVISOR     → assigned teachers + granted branches
 *   IT_COORDINATOR             → its two server-enforced capabilities
 *                                (assignments + recovery) and real
 *                                school-scoped counters
 *   TEACHER                    → personal records only
 */
import { getCurrentUser } from "@/lib/auth/session";
import { toAnalyticsActor } from "@/lib/analytics/access";
import { AccessDenied } from "@/app/assignments/ui";
import { ItCoordinatorDashboard } from "@/components/dashboard/it-coordinator-dashboard";
import { PlatformDashboardView } from "@/app/dashboard/platform-view";
import { SchoolDashboardView } from "@/app/dashboard/school-view";
import { SupervisorDashboardView } from "@/app/dashboard/supervisor-view";
import { TeacherDashboardView } from "@/app/dashboard/teacher-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }

  // IT coordinator branches BEFORE the analytics actor resolution: the
  // coordinator has its own narrow context (identity + own school) and
  // its dashboard is rendered straight from that context.
  if (user.role === "IT_COORDINATOR") {
    if (!user.schoolId) {
      return (
        <AccessDenied hint="حساب منسق تقنية المعلومات غير مرتبط بمدرسة — راجع مدير المنصة." />
      );
    }
    return <ItCoordinatorDashboard name={user.name} schoolId={user.schoolId} />;
  }

  const actor = toAnalyticsActor(user);
  if (!actor) {
    return <AccessDenied hint="دور الحساب غير معروف — راجع مدير المنصة." />;
  }

  if (actor.role === "SUPER_ADMIN") {
    return <PlatformDashboardView actor={actor} />;
  }
  if (actor.role === "DEVELOPMENT_OFFICE_MANAGER" || actor.role === "EDUCATIONAL_DEPUTY") {
    return <SchoolDashboardView actor={actor} />;
  }
  if (actor.role === "EDUCATIONAL_SUPERVISOR") {
    return <SupervisorDashboardView actor={actor} />;
  }
  return <TeacherDashboardView />;
}
/**
 * Phase 10 — لوحة التحكم role-adaptive dashboard router.
 *
 * One route, five server-side views. The role comes from the session —
 * never from a query param — and each view queries only what that role
 * may see:
 *   SUPER_ADMIN                → platform-wide aggregates (read-only)
 *   DEVELOPMENT_OFFICE_MANAGER → own-school operational dashboard
 *   EDUCATIONAL_DEPUTY         → granted schools (read-only)
 *   EDUCATIONAL_SUPERVISOR     → assigned teachers + granted branches
 *   TEACHER                    → personal records only
 */
import { getCurrentUser } from "@/lib/auth/session";
import { toAnalyticsActor } from "@/lib/analytics/access";
import { AccessDenied } from "@/app/assignments/ui";
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
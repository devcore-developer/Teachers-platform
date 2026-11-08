import { redirect } from "next/navigation";

/**
 * The supervisor dashboard merged into the Home page.
 *
 * "لوحة المشرف" is no longer a separate destination: the Home page (/)
 * — the supervisor's "الرئيسية" — renders the full dashboard
 * (SupervisorDashboardSection). This route keeps old bookmarks,
 * notifications and muscle-memory links working by redirecting to the
 * home dashboard — one dashboard, one implementation, zero duplication.
 */
export default function SupervisorDashboardRedirectPage() {
  redirect("/");
}
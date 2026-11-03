"use client";

import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { RecentActivities } from "@/components/dashboard/recent-activities";
import { StageDistributionChart } from "@/components/dashboard/stage-distribution-chart";
import { TrainingProgressChart } from "@/components/dashboard/training-progress-chart";
import { UpcomingEvents } from "@/components/dashboard/upcoming-events";
import { StatCard } from "@/components/platform/stat-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { getNavItemId } from "@/config/navigation";
import { mockOverviewStats } from "@/lib/mock-data";
import type { NavItem } from "@/lib/types";

interface DashboardViewProps {
  /**
   * Server-rendered slot for the real (persisted) schools & branches
   * metrics section — passed from the server page so the dashboard
   * client bundle never touches the database directly.
   */
  schoolsSlot?: React.ReactNode;
}

const todayLabel = new Intl.DateTimeFormat("ar-EG", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(new Date());

/**
 * The dashboard: overview statistics, training progress visualization,
 * recent activities, upcoming events and quick actions.
 *
 * Phase 2: navigation goes through real routes via the router, and the
 * schools metrics section renders data straight from the database.
 */
export function DashboardView({ schoolsSlot }: DashboardViewProps) {
  const router = useRouter();
  const homeModule = getNavItemId("home") as NavItem;

  function handleModuleNavigation(moduleId: string) {
    router.push(getNavItemId(moduleId)?.href ?? "/");
  }

  return (
    <div>
      <PageHeader
        module={homeModule}
        title="لوحة المعلومات"
        description="تابع حالة التنمية المهنية في مساحة عمل مدرستك: المعلمون، البرامج التدريبية، والمتابعات التربوية."
        meta={
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">
              <CalendarDays className="size-3.5 text-brand-600" aria-hidden="true" />
              {todayLabel}
            </span>
            <StatusBadge tone="info" withDot={false}>
              بيانات تجريبية للمرحلة الأولى
            </StatusBadge>
          </>
        }
      />

      {/* Overview statistics */}
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        role="list"
        aria-label="إحصائيات عامة"
      >
        {mockOverviewStats.map((stat) => (
          <StatCard
            key={stat.id}
            stat={stat}
            onClick={() => handleModuleNavigation(stat.targetModuleId)}
          />
        ))}
      </div>

      {/* Real schools & branches metrics (persisted data) */}
      {schoolsSlot && <div className="mt-6">{schoolsSlot}</div>}

      {/* Progress visualization */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TrainingProgressChart />
        </div>
        <StageDistributionChart />
      </div>

      {/* Activities & events */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <RecentActivities />
        </div>
        <div className="xl:col-span-2">
          <UpcomingEvents />
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-6">
        <QuickActions onNavigate={handleModuleNavigation} />
      </div>
    </div>
  );
}
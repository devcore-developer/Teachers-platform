import Link from "next/link";
import { Building2, ChevronLeft, Landmark, ToggleLeft, Users } from "lucide-react";

import { SectionCard } from "@/components/platform/section-card";
import { getSchoolMetricsForSchool, getSchoolsMetrics } from "@/lib/schools/service";

/**
 * Real, persisted schools & branches metrics for the dashboard.
 * Server component — reads straight from the database on every request
 * (Next revalidates these paths after every school mutation).
 *
 * Two scopes, enforced server-side by the caller:
 *   - no schoolId -> platform-wide (SUPER_ADMIN dashboard)
 *   - schoolId    -> ONE school's branches + teachers (office manager;
 *                    the schoolId comes from the session, never client)
 *
 * Mock Phase-1 sections keep their honest "بيانات تجريبية" label; this
 * section is labelled as real persisted data.
 */
interface SchoolsMetricsSectionProps {
  /** When set, renders school-scoped metrics for the office manager. */
  schoolId?: string;
}

export async function SchoolsMetricsSection({ schoolId }: SchoolsMetricsSectionProps) {
  if (schoolId) {
    const scoped = await getSchoolMetricsForSchool(schoolId);
    if (!scoped) {
      return (
        <SectionCard title="بيانات المدرسة" description="لم يتم العثور على بيانات المدرسة.">
          <p className="py-4 text-center text-sm text-muted-foreground">
            تعذر تحميل مؤشرات مدرستك — تواصل مع مدير المنصة.
          </p>
        </SectionCard>
      );
    }

    const scopedItems = [
      {
        id: "total-branches",
        label: "إجمالي الفروع",
        value: scoped.totalBranches,
        icon: Landmark,
        tileClass: "bg-brand-100 text-brand-700",
      },
      {
        id: "active-branches",
        label: "فروع نشطة",
        value: scoped.activeBranches,
        icon: ToggleLeft,
        tileClass: "bg-success-soft text-success",
      },
      {
        id: "inactive-branches",
        label: "فروع موقوفة",
        value: scoped.inactiveBranches,
        icon: Building2,
        tileClass: "bg-warning-soft text-warning",
      },
      {
        id: "teachers",
        label: "المعلمون المسجلون",
        value: scoped.teachersCount,
        icon: Users,
        tileClass: "bg-info-soft text-info",
      },
    ];

    return (
      <SectionCard
        title={`مدرستك — ${scoped.schoolName}`}
        description="مؤشرات حقيقية لمدرستك من قاعدة البيانات — تتحدث مع كل إضافة أو تعديل."
      >
        <div
          className="grid grid-cols-2 gap-3 xl:grid-cols-4"
          role="list"
          aria-label="مؤشرات مدرستك"
        >
          {scopedItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                role="listitem"
                className="flex items-center gap-3 rounded-xl border bg-background/60 p-3.5"
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${item.tileClass}`}
                  aria-hidden="true"
                >
                  <Icon className="size-5" strokeWidth={1.9} />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-xl font-extrabold tabular-nums text-foreground">
                    {item.value}
                  </span>
                  <span className="block truncate text-xs font-medium text-muted-foreground">
                    {item.label}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </SectionCard>
    );
  }

  const metrics = await getSchoolsMetrics();

  const items = [
    {
      id: "total-schools",
      label: "إجمالي المدارس",
      value: metrics.totalSchools,
      icon: Landmark,
      tileClass: "bg-brand-100 text-brand-700",
    },
    {
      id: "active-schools",
      label: "مدارس نشطة",
      value: metrics.activeSchools,
      icon: ToggleLeft,
      tileClass: "bg-success-soft text-success",
    },
    {
      id: "inactive-schools",
      label: "مدارس موقوفة",
      value: metrics.inactiveSchools,
      icon: Building2,
      tileClass: "bg-warning-soft text-warning",
    },
    {
      id: "total-branches",
      label: "إجمالي الفروع",
      value: metrics.totalBranches,
      icon: Users,
      tileClass: "bg-info-soft text-info",
    },
  ];

  return (
    <SectionCard
      title="المدارس والفروع"
      description="مؤشرات حقيقية محفوظة في قاعدة البيانات — تُحدَّث مع كل إضافة أو تعديل."
      action={
        <Link
          href="/schools"
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
        >
          إدارة المدارس
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" role="list" aria-label="مؤشرات المدارس والفروع">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              role="listitem"
              className="flex items-center gap-3 rounded-xl border bg-background/60 p-3.5"
            >
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${item.tileClass}`}
                aria-hidden="true"
              >
                <Icon className="size-5" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block text-xl font-extrabold tabular-nums text-foreground">
                  {item.value}
                </span>
                <span className="block truncate text-xs font-medium text-muted-foreground">
                  {item.label}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
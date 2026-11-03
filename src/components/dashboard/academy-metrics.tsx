import { BookOpen, CheckCircle2, GraduationCap, Users } from "lucide-react";

import { SectionCard } from "@/components/platform/section-card";
import { getAcademyMetrics } from "@/lib/training/service";

interface AcademyMetricsSectionProps {
  /** When set, renders the office manager's school-scoped metrics. */
  schoolId?: string | null;
}

/**
 * Real, persisted academy metrics for the dashboard. Reads straight
 * from the database on every request — no mock values.
 */
export async function AcademyMetricsSection({
  schoolId = null,
}: AcademyMetricsSectionProps) {
  const metrics = await getAcademyMetrics(schoolId);

  const items = [
    {
      id: "courses-total",
      label: "إجمالي الدورات",
      value: metrics.coursesTotal,
      icon: BookOpen,
      tileClass: "bg-brand-100 text-brand-700",
    },
    {
      id: "courses-published",
      label: "دورات منشورة",
      value: metrics.coursesPublished,
      icon: CheckCircle2,
      tileClass: "bg-success-soft text-success",
    },
    {
      id: "programs-total",
      label: "البرامج التدريبية",
      value: metrics.programsTotal,
      icon: GraduationCap,
      tileClass: "bg-info-soft text-info",
    },
    {
      id: "enrollments",
      label: "تسجيلات المعلمين",
      value: metrics.enrollmentsCount,
      icon: Users,
      tileClass: "bg-warning-soft text-warning",
    },
  ];

  return (
    <SectionCard
      title="الأكاديمية التدريبية"
      description="مؤشرات حقيقية محفوظة في قاعدة البيانات — تُحدَّث مع كل إضافة أو نشر."
    >
      <div
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
        role="list"
        aria-label="مؤشرات الأكاديمية التدريبية"
      >
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
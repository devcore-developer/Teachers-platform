import { CheckCircle2, ClipboardCheck, FileQuestion, Percent } from "lucide-react";

import { SectionCard } from "@/components/platform/section-card";
import { getAssessmentMetrics } from "@/lib/assessment/service";

interface AssessmentMetricsSectionProps {
  /** When set, renders the office manager's school-scoped metrics. */
  schoolId?: string | null;
}

/**
 * Real, persisted assessment metrics for the dashboard. Empty states
 * are honest: null averages/rates render as "—" instead of misleading
 * zeros when no graded attempts exist yet.
 */
export async function AssessmentMetricsSection({
  schoolId = null,
}: AssessmentMetricsSectionProps) {
  const metrics = await getAssessmentMetrics(schoolId);

  const items = [
    {
      id: "assessments-published",
      label: "اختبارات منشورة",
      value: metrics.assessmentsPublished,
      icon: ClipboardCheck,
      tileClass: "bg-brand-100 text-brand-700",
    },
    {
      id: "attempts-finalized",
      label: "محاولات مُقيَّمة",
      value: metrics.attemptsFinalized,
      icon: FileQuestion,
      tileClass: "bg-info-soft text-info",
    },
    {
      id: "avg-percentage",
      label: "متوسط النتائج",
      value:
        metrics.avgPercentage === null ? "—" : `${metrics.avgPercentage}%`,
      icon: Percent,
      tileClass: "bg-success-soft text-success",
    },
    {
      id: "needs-review",
      label: "بانتظار المراجعة",
      value: metrics.needsReviewCount,
      icon: CheckCircle2,
      tileClass: "bg-warning-soft text-warning",
    },
  ];

  return (
    <SectionCard
      title="الاختبارات وتقييم الأثر"
      description="مؤشرات حقيقية محفوظة في قاعدة البيانات — محاولات مكتملة ومراجعات معلقة ومعدلات النجاح."
    >
      <div
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
        role="list"
        aria-label="مؤشرات الاختبارات"
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
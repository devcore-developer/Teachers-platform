"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { SectionCard } from "@/components/platform/section-card";
import { mockTeachersByStage } from "@/lib/mock-data";
import type { StageDistributionPoint } from "@/lib/types";

const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name?: string | number; value?: number | string }[];
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div dir="rtl" className="rounded-lg border bg-popover px-3 py-2 shadow-lg">
      <p className="text-xs font-bold text-foreground">{entry.name}</p>
      <p className="text-xs text-muted-foreground">
        <span className="font-bold text-foreground tabular-nums">{entry.value}</span> معلم
      </p>
    </div>
  );
}

/**
 * Teacher distribution across educational stages — donut chart fed
 * directly from the centralized mock dataset.
 */
export function StageDistributionChart() {
  const total = mockTeachersByStage.reduce((sum, p) => sum + p.count, 0);

  return (
    <SectionCard
      title="توزيع المعلمين على المراحل"
      description="عدد المعلمين في كل مرحلة دراسية"
    >
      <div className="relative mx-auto h-52 w-full max-w-60">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<DonutTooltip />} />
            <Pie
              data={mockTeachersByStage as StageDistributionPoint[]}
              dataKey="count"
              nameKey="stage"
              innerRadius="68%"
              outerRadius="94%"
              paddingAngle={3}
              strokeWidth={0}
              cornerRadius={6}
            >
              {mockTeachersByStage.map((entry, index) => (
                <Cell key={entry.stage} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-3xl font-extrabold tabular-nums text-foreground">{total}</p>
          <p className="text-xs font-semibold text-muted-foreground">إجمالي المعلمين</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2.5" role="list" aria-label="تفاصيل توزيع المعلمين">
        {mockTeachersByStage.map((entry, index) => {
          const percent = Math.round((entry.count / total) * 100);
          return (
            <li key={entry.stage} className="flex items-center gap-2.5 text-sm">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: chartColors[index % chartColors.length] }}
                aria-hidden="true"
              />
              <span className="flex-1 font-semibold text-foreground/85">{entry.stage}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{percent}%</span>
              <span className="w-9 text-end text-sm font-bold tabular-nums text-foreground">
                {entry.count}
              </span>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
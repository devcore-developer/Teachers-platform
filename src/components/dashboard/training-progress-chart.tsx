"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SectionCard } from "@/components/platform/section-card";
import { mockTrainingProgress } from "@/lib/mock-data";

interface TooltipPayloadItem {
  name?: string | number;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div dir="rtl" className="rounded-lg border bg-popover px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs font-bold text-foreground">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          {entry.name === "completed" ? "ساعات منجزة" : "الهدف"}:{" "}
          <span className="font-bold text-foreground tabular-nums">{entry.value}</span> ساعة
        </p>
      ))}
    </div>
  );
}

/**
 * Monthly training progress: completed hours (bars) against the
 * monthly target (line). Rendered RTL: months flow right-to-left and
 * the value axis sits on the right. Data comes exclusively from the
 * centralized mock dataset.
 */
export function TrainingProgressChart() {
  const totalCompleted = mockTrainingProgress.reduce((sum, p) => sum + p.completed, 0);
  const totalTarget = mockTrainingProgress.reduce((sum, p) => sum + p.target, 0);
  const progressPercent = Math.round((totalCompleted / totalTarget) * 100);

  return (
    <SectionCard
      title="تقدم التدريب الشهري"
      description="الساعات التدريبية المنجزة مقابل الهدف الشهري"
      action={
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700 ring-1 ring-brand-100">
          الإنجاز الكلي {progressPercent}%
        </span>
      }
    >
      <div dir="ltr" className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={mockTrainingProgress} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="month"
              reversed
              tick={{ fill: "var(--muted-foreground)", fontSize: 12, fontFamily: "var(--font-cairo)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              dy={8}
            />
            <YAxis
              orientation="right"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--accent)", opacity: 0.5 }} />
            <Bar
              dataKey="completed"
              name="completed"
              fill="var(--chart-1)"
              radius={[6, 6, 0, 0]}
              maxBarSize={36}
            />
            <Line
              type="monotone"
              dataKey="target"
              name="target"
              stroke="var(--chart-4)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 3, fill: "var(--chart-4)", strokeWidth: 0 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[var(--chart-1)]" aria-hidden="true" />
          ساعات منجزة
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed border-[var(--chart-4)]" aria-hidden="true" />
          الهدف الشهري
        </span>
      </div>
    </SectionCard>
  );
}
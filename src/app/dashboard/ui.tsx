/**
 * Phase 10 — server-safe chart & indicator primitives for dashboards
 * and the analytics page. Pure SVG/div rendering (no client JS, no new
 * dependencies), RTL-safe, brand blue only. Every renderer shows an
 * honest empty state when its dataset is empty — charts are never
 * fabricated to look populated.
 */
import type { ReactNode } from "react";
import Link from "next/link";

import type { TrendSeries } from "@/lib/analytics/service";

/** Multi-series trend line chart (SVG polyline over a fixed month grid). */
export function TrendChart({
  series,
  labels,
  height = 140,
}: {
  series: { name: string; values: number[]; color: string }[];
  labels: string[];
  height?: number;
}) {
  const width = 320;
  const padding = 8;
  const max = Math.max(1, ...series.flatMap((entry) => entry.values));
  const stepX = (width - padding * 2) / Math.max(1, labels.length - 1);
  const hasAnyData = series.some((entry) => entry.values.some((value) => value > 0));

  if (!hasAnyData) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
        لا توجد بيانات في نافذة الأشهر الستة الأخيرة — سيظهر المنحنى تلقائيًا عند تسجيل أنشطة.
      </div>
    );
  }

  const pointsFor = (values: number[]) =>
    values
      .map((value, index) => {
        const x = padding + index * stepX;
        const y = height - padding - (value / max) * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div dir="ltr" className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="منحنى الاتجاه الزمني">
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={padding}
            x2={width - padding}
            y1={height - padding - fraction * (height - padding * 2)}
            y2={height - padding - fraction * (height - padding * 2)}
            stroke="#e2e8f0"
            strokeWidth="1"
          />
        ))}
        <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />
        {series.map((entry) => (
          <g key={entry.name}>
            <polyline
              points={pointsFor(entry.values)}
              fill="none"
              stroke={entry.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {entry.values.map((value, index) => {
              const x = padding + index * stepX;
              const y = height - padding - (value / max) * (height - padding * 2);
              return <circle key={`${entry.name}-${index}`} cx={x} cy={y} r="3" fill={entry.color} />;
            })}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between px-1 text-[10px] text-slate-400" dir="rtl">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3" dir="rtl">
        {series.map((entry) => (
          <span key={entry.name} className="flex items-center gap-1 text-[11px] text-slate-600">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.name}
          </span>
        ))}
      </div>
    </div>
  );
}

const TREND_COLORS = {
  enrollments: "#1D5BD6",
  submissions: "#0ea5e9",
  certificates: "#059669",
  surveyResponses: "#d97706",
} as const;

const TREND_NAMES: Record<keyof typeof TREND_COLORS, string> = {
  enrollments: "الالتحاقات",
  submissions: "التسليمات",
  certificates: "الشهادات",
  surveyResponses: "ردود الاستبيانات",
};

/** Standard 4-series activity chart used by platform & school views. */
export function ActivityTrendChart({ trends }: { trends: TrendSeries }) {
  return (
    <TrendChart
      labels={trends.labels}
      series={[
        { name: TREND_NAMES.enrollments, values: trends.enrollments, color: TREND_COLORS.enrollments },
        { name: TREND_NAMES.submissions, values: trends.submissions, color: TREND_COLORS.submissions },
        { name: TREND_NAMES.certificates, values: trends.certificates, color: TREND_COLORS.certificates },
        { name: TREND_NAMES.surveyResponses, values: trends.surveyResponses, color: TREND_COLORS.surveyResponses },
      ]}
    />
  );
}

/** Horizontal bar list (RTL-safe: bars grow from the right). */
export function BarList({
  items,
  emptyMessage = "لا توجد بيانات بعد",
}: {
  items: { label: string; value: number; hint?: string }[];
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">
        {emptyMessage}
      </div>
    );
  }
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">{item.label}</span>
            <span dir="ltr" className="text-slate-500">
              {item.value}
              {item.hint ? <span className="mr-1 text-slate-400">({item.hint})</span> : null}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#1D5BD6]"
              style={{ width: `${Math.round((item.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rate chip with an explicit denominator note (null → honest dash). */
export function RateChip({ label, percent, note }: { label: string; percent: number | null; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-slate-900" dir="ltr">
        {percent === null ? "—" : `${percent}%`}
      </p>
      {note ? <p className="mt-0.5 text-[10px] leading-4 text-slate-400">{note}</p> : null}
    </div>
  );
}

/** Section heading inside dashboards. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2 first:mt-0">
      <h2 className="text-sm font-bold text-slate-700">{children}</h2>
      {action}
    </div>
  );
}

/** Shared quick-links strip (only links the role may actually open). */
export function DashboardLinks({ links }: { links: { href: string; label: string }[] }) {
  if (links.length === 0) return null;
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-lg border border-[#1D5BD6] px-3 py-1.5 text-xs font-semibold text-[#1D5BD6] hover:bg-blue-50"
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}

/** Simple data table used across dashboards (RTL, right-aligned). */
export function DataTable({
  headers,
  children,
  emptyMessage,
}: {
  headers: string[];
  children: ReactNode;
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {emptyMessage ? <p className="py-4 text-center text-xs text-slate-400">{emptyMessage}</p> : null}
    </div>
  );
}
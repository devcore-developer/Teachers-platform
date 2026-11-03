import { TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AccentColor, OverviewStat } from "@/lib/types";

interface StatCardProps {
  stat: OverviewStat;
  onClick?: () => void;
  className?: string;
}

const accentStyles: Record<AccentColor, { tile: string; trend: string }> = {
  primary: {
    tile: "bg-brand-100 text-brand-700",
    trend: "text-success",
  },
  info: {
    tile: "bg-info-soft text-info",
    trend: "text-success",
  },
  success: {
    tile: "bg-success-soft text-success",
    trend: "text-success",
  },
  warning: {
    tile: "bg-warning-soft text-warning",
    trend: "text-warning",
  },
};

/**
 * Dashboard overview statistic card. Clicking navigates to the related
 * module, so the card is a real control — not a dead tile.
 */
export function StatCard({ stat, onClick, className }: StatCardProps) {
  const Icon = stat.icon;
  const styles = accentStyles[stat.accent];
  const TrendIcon = stat.trend.direction === "down" ? TrendingDown : TrendingUp;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${stat.label}: ${stat.value}${stat.suffix ?? ""} — انتقل إلى القسم المرتبط`}
      className={cn(
        "group flex flex-col gap-4 rounded-xl border bg-card p-5 text-start shadow-xs transition-all",
        "hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "flex size-11 items-center justify-center rounded-lg",
            styles.tile
          )}
          aria-hidden="true"
        >
          <Icon className="size-5.5" strokeWidth={1.9} />
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold",
            stat.trend.direction === "down"
              ? "bg-warning-soft text-warning"
              : "bg-success-soft text-success"
          )}
        >
          <TrendIcon className="size-3.5" aria-hidden="true" />
          {stat.trend.value}%
        </span>
      </div>

      <div>
        <p className="text-3xl font-extrabold tracking-tight text-foreground tabular-nums">
          {stat.value.toLocaleString("en-US")}
          {stat.suffix && (
            <span className="ms-1 text-base font-bold text-muted-foreground">
              {stat.suffix}
            </span>
          )}
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground/80">{stat.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{stat.trend.label}</p>
      </div>
    </button>
  );
}
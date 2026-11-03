"use client";

import { activityIcons, mockRecentActivities } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { ActivityType } from "@/lib/types";

const activityTileStyles: Record<ActivityType, string> = {
  completed: "bg-success-soft text-success",
  enrolled: "bg-info-soft text-info",
  certificate: "bg-brand-100 text-brand-700",
  assessment: "bg-warning-soft text-warning",
  followup: "bg-muted text-muted-foreground",
};

/**
 * Recent professional-development activity feed, rendered as a
 * responsive list (timeline-style on desktop).
 */
export function RecentActivities() {
  return (
    <section
      aria-labelledby="recent-activities-title"
      className="flex flex-col rounded-xl border bg-card shadow-xs"
    >
      <div className="flex items-center justify-between px-5 pt-5 pb-4 sm:px-6">
        <div>
          <h2 id="recent-activities-title" className="text-base font-bold text-foreground">
            النشاطات الأخيرة
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            آخر التحديثات في أنشطة التنمية المهنية
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
          {mockRecentActivities.length} نشاطات
        </span>
      </div>

      <ul className="scrollbar-thin max-h-96 flex-1 overflow-y-auto px-5 pb-5 sm:px-6" role="list">
        {mockRecentActivities.map((activity, index) => {
          const Icon = activityIcons[activity.type];
          const isLast = index === mockRecentActivities.length - 1;
          return (
            <li key={activity.id} className="relative flex gap-3.5 pb-5 last:pb-0">
              {/* Timeline connector */}
              {!isLast && (
                <span
                  className="absolute top-11 bottom-0 start-[19px] w-px bg-border"
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  "z-10 flex size-10 shrink-0 items-center justify-center rounded-full ring-4 ring-card",
                  activityTileStyles[activity.type]
                )}
                aria-hidden="true"
              >
                <Icon className="size-4.5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-sm font-semibold leading-snug text-foreground">
                  {activity.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground/70">{activity.actor}</span>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  {activity.time}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
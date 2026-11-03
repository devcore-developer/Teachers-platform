"use client";

import { CalendarDays, Clock, MapPin, Presentation, Users, Video } from "lucide-react";

import { StatusBadge } from "@/components/platform/status-badge";
import { EmptyState } from "@/components/platform/empty-state";
import { mockUpcomingEvents } from "@/lib/mock-data";
import type { TrainingEventType } from "@/lib/types";

const eventTypeMeta: Record<TrainingEventType, { label: string; icon: typeof Presentation }> = {
  workshop: { label: "ورشة عمل", icon: Presentation },
  course: { label: "دورة", icon: Video },
  meeting: { label: "اجتماع", icon: Users },
};

/**
 * Upcoming training events list. Event data comes from the centralized
 * mock dataset; when no events exist the shared EmptyState is shown.
 */
export function UpcomingEvents() {
  const events = mockUpcomingEvents;

  return (
    <section
      aria-labelledby="upcoming-events-title"
      className="flex flex-col rounded-xl border bg-card shadow-xs"
    >
      <div className="px-5 pt-5 pb-4 sm:px-6">
        <h2 id="upcoming-events-title" className="text-base font-bold text-foreground">
          الفعاليات التدريبية القادمة
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          ورش ودورات واجتماعات مجدولة خلال الأسبوعين القادمين
        </p>
      </div>

      <div className="flex-1 px-5 pb-5 sm:px-6">
        {events.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="لا توجد فعاليات مجدولة"
            description="ستظهر هنا الورش والدورات التدريبية القادمة بمجرد جدولتها."
          />
        ) : (
          <ul className="space-y-3" role="list">
            {events.map((event) => {
              const TypeIcon = eventTypeMeta[event.type].icon;
              return (
                <li
                  key={event.id}
                  className="group flex gap-3.5 rounded-lg border bg-card p-3.5 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                >
                  {/* Date tile */}
                  <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-lg bg-gradient-to-b from-brand-600 to-brand-800 text-white shadow-sm">
                    <span className="text-[10px] font-semibold text-white/80">{event.day}</span>
                    <span className="text-sm font-extrabold leading-tight">{event.date.split(" ")[0]}</span>
                    <span className="text-[10px] text-white/80">{event.date.split(" ")[1]}</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                        <TypeIcon className="size-3" aria-hidden="true" />
                        {eventTypeMeta[event.type].label}
                      </span>
                      <StatusBadge tone="info">قادم</StatusBadge>
                    </div>
                    <p className="mt-1.5 truncate text-sm font-bold text-foreground">
                      {event.title}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" aria-hidden="true" />
                        {event.time}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden="true" />
                        {event.location}
                      </span>
                      {typeof event.seatsLeft === "number" && (
                        <span className="font-semibold text-warning">
                          {event.seatsLeft} مقعد متبقي
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
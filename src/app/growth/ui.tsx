/**
 * Phase 8 — server-safe presentational helpers for the professional
 * growth views (progress bars, timeline, section cards).
 */
import type { ReactNode } from "react";

import { GROWTH_EVENT_TYPE_LABELS } from "@/config/certificates";
import type { GrowthHistoryEvent } from "@/lib/growth/service";

export function GrowthStatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "brand" | "warning" | "success";
}) {
  const tones: Record<string, string> = {
    default: "border-slate-200 bg-white",
    brand: "border-blue-200 bg-blue-50",
    warning: "border-amber-200 bg-amber-50",
    success: "border-emerald-200 bg-emerald-50",
  };
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const clamped = Math.max(0, Math.min(100, percent));
  const tone =
    clamped >= 100 ? "bg-emerald-500" : clamped >= 50 ? "bg-[#1D5BD6]" : "bg-amber-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-600">{clamped}%</span>
    </div>
  );
}

const EVENT_DOT_CLASSES: Record<string, string> = {
  ENROLLMENT: "bg-blue-500",
  ASSESSMENT: "bg-indigo-500",
  ASSIGNMENT: "bg-amber-500",
  CERTIFICATE: "bg-emerald-500",
};

export function GrowthTimeline({ events }: { events: GrowthHistoryEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        لا توجد أنشطة تدريبية مسجلة بعد — سيتتبع هذا السجل التحاقك وتقييماتك وتسليماتك وشهاداتك.
      </p>
    );
  }
  return (
    <ol className="relative space-y-5 border-r-2 border-slate-100 pr-5">
      {events.map((event, index) => (
        <li key={`${event.type}-${event.date.toISOString()}-${index}`} className="relative">
          <span
            aria-hidden
            className={`absolute -right-[27px] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${
              EVENT_DOT_CLASSES[event.type] ?? "bg-slate-400"
            }`}
          />
          <p className="text-sm font-medium text-slate-800">{event.label}</p>
          {event.detail ? <p className="text-xs text-slate-500">{event.detail}</p> : null}
          <p className="mt-0.5 text-[11px] text-slate-400">
            {GROWTH_EVENT_TYPE_LABELS[event.type] ?? event.type} —{" "}
            {new Intl.DateTimeFormat("ar-EG", {
              dateStyle: "medium",
              numberingSystem: "latn",
            }).format(event.date)}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function RequirementChip({ met, label }: { met: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
        met
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {met ? "مستوفى" : "غير مستوفى"} — {label}
    </span>
  );
}
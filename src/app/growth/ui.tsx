import Link from "next/link";
import { ArrowUp, CheckCircle2, CircleDashed } from "lucide-react";

import type { GrowthHistoryEvent } from "@/lib/growth/service";
import { GROWTH_LEVELS, growthLevelLabel } from "@/config/growth";

/* ------------------------------------------------------------------ */
/* Batch 2 (part 2/2) — shared growth UI building blocks.              */
/*                                                                     */
/* Presentational-only (no hooks, no client APIs): the same components */
/* render inside server pages (/growth, /my-growth, /growth/[id]) and  */
/* inside the client projection component. Blue brand only — لا بنفسجي. */
/* ------------------------------------------------------------------ */

/** The T0..T5 ladder badge (the exact HTML label format). */
export function LevelBadge({
  level,
  tone = "current",
}: {
  level: string;
  tone?: "current" | "next" | "muted";
}) {
  const toneClass =
    tone === "current"
      ? "bg-brand-600 text-white"
      : tone === "next"
        ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${toneClass}`}
    >
      {growthLevelLabel(level)}
    </span>
  );
}

/** 60% promotion-gate progress bar (marker line at the threshold). */
export function GrowthProgressBar({
  percent,
  threshold = 60,
}: {
  percent: number;
  threshold?: number;
}) {
  const safe = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="relative h-3 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={safe}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-brand-600 transition-all"
        style={{ width: `${safe}%` }}
      />
      <span
        className="absolute inset-y-0 w-0.5 bg-brand-900/40"
        style={{ insetInlineStart: `${threshold}%` }}
        aria-hidden
      />
    </div>
  );
}

/** Eligible / not-yet pill for the promotion gate. */
export function EligibilityBadge({ eligible }: { eligible: boolean }) {
  return eligible ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
      <CheckCircle2 className="size-3.5" aria-hidden />
      مستحق للانتقال
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
      <CircleDashed className="size-3.5" aria-hidden />
      لم يكتمل شرط 60% بعد
    </span>
  );
}

/** The static T0..T5 journey stepper (current level highlighted). */
export function GrowthLadder({ currentLevel }: { currentLevel: string }) {
  const currentIndex = GROWTH_LEVELS.findIndex((level) => level.id === currentLevel);
  return (
    <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {GROWTH_LEVELS.map((level, index) => {
        const state =
          index < currentIndex
            ? "border-brand-600 bg-brand-600 text-white"
            : index === currentIndex
              ? "border-brand-600 bg-brand-50 text-brand-800 ring-2 ring-brand-600"
              : "border-border bg-muted text-muted-foreground";
        return (
          <li
            key={level.id}
            className={`rounded-xl border p-3 text-center ${state}`}
          >
            <p className="text-sm font-black">{level.id}</p>
            <p className="mt-1 text-[11px] font-semibold leading-4">{level.nameAr}</p>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The growth journey timeline — append-only GrowthEvent rows
 * (تصنيف المشرف / اعتماد الانتقال), newest first.
 */
export function GrowthHistoryTimeline({
  events,
}: {
  events: GrowthHistoryEvent[];
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        لا توجد أحداث نمو مسجّلة بعد — يظهر هنا كل تصنيف أو انتقال معتمد.
      </p>
    );
  }
  return (
    <ol className="relative space-y-4 border-s border-border ps-5">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span
            className="absolute -start-[26px] top-1 flex size-4 items-center justify-center rounded-full bg-brand-600 text-white"
            aria-hidden
          >
            <ArrowUp className="size-3" />
          </span>
          <p className="text-sm font-bold">
            {event.fromLabel
              ? `${event.fromLabel} ← ${event.toLabel}`
              : `تصنيف أول: ${event.toLabel}`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {event.reasonLabel}
            {event.actorName ? ` — بواسطة ${event.actorName}` : ""}
            {" · "}
            {new Intl.DateTimeFormat("ar-EG", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(event.createdAt)}
          </p>
          {event.note && (
            <p className="mt-1 rounded-lg bg-muted px-3 py-2 text-xs">{event.note}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Shared "open the full file" link used by roster tables. */
export function TeacherGrowthLink({ teacherId }: { teacherId: string }) {
  return (
    <Link
      href={`/growth/${teacherId}`}
      className="text-xs font-bold text-brand-700 underline-offset-4 hover:underline"
    >
      عرض ملف النمو
    </Link>
  );
}
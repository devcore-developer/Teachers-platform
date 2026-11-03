/**
 * Phase 7 — small server-safe presentational helpers shared by the
 * assignment pages (no client directives here).
 */
import type { ReactNode } from "react";

import {
  ASSIGNMENT_STATUS_CLASSES,
  ASSIGNMENT_STATUS_LABELS,
  SUBMISSION_STATUS_CLASSES,
  SUBMISSION_STATUS_LABELS,
  type AssignmentStatus,
  type SubmissionStatus,
} from "@/config/assignments";

export function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    numberingSystem: "latn",
  }).format(date);
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} بايت`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} كيلوبايت`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} ميغابايت`;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function AssignmentStatusBadge({ status }: { status: string }) {
  const label =
    ASSIGNMENT_STATUS_LABELS[status as AssignmentStatus] ?? status;
  const cls =
    ASSIGNMENT_STATUS_CLASSES[status as AssignmentStatus] ??
    "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function SubmissionStatusBadge({ status }: { status: string }) {
  const label =
    SUBMISSION_STATUS_LABELS[status as SubmissionStatus] ?? status;
  const cls =
    SUBMISSION_STATUS_CLASSES[status as SubmissionStatus] ??
    "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function StatTile({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "brand" | "warning" | "success";
  /** Phase 10 — optional denominator/definition note under the value. */
  hint?: string;
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
      {hint ? <p className="mt-1 text-[10px] leading-4 text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function AccessDenied({ hint }: { hint?: string }) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-8 text-center">
      <p className="text-base font-semibold text-red-700">لا تملك صلاحية الوصول إلى هذه الصفحة</p>
      {hint ? <p className="mt-2 text-sm text-red-500">{hint}</p> : null}
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}
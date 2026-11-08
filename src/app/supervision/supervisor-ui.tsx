import type { LucideIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Shared presentational primitives for the supervisor workspace.       */
/* Pure server-safe components — no session, no DB, no client hooks.    */
/* ------------------------------------------------------------------ */

const TONE_CLASSES = {
  brand: "bg-brand-600 text-white",
  success: "bg-success-soft text-success",
  info: "bg-brand-600/10 text-brand-600",
  warning: "bg-amber-100 text-amber-700",
  neutral: "bg-muted text-muted-foreground",
} as const;

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "brand",
}: {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: keyof typeof TONE_CLASSES;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-muted-foreground">{label}</span>
        {Icon && (
          <span
            className={`inline-flex size-8 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}
          >
            <Icon className="size-4" aria-hidden="true" />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-black tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-black text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "success" | "error" | "info" | "warning" | "neutral";
  children: React.ReactNode;
}) {
  const map = {
    success: "bg-success-soft text-success",
    error: "bg-destructive/10 text-destructive",
    info: "bg-brand-600/10 text-brand-600",
    warning: "bg-amber-100 text-amber-700",
    neutral: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyHint({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/30 px-4 py-8 text-center">
      <p className="text-sm font-bold text-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

export function statusTone(status: string): "success" | "info" | "warning" | "neutral" {
  if (status === "PUBLISHED") return "success";
  if (status === "DRAFT") return "warning";
  if (status === "CLOSED" || status === "ARCHIVED") return "neutral";
  return "info";
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "مسودة",
    PUBLISHED: "منشور",
    ARCHIVED: "مؤرشف",
    CLOSED: "مغلق",
    PLANNED: "مخطط",
    IN_PROGRESS: "قيد المتابعة",
    COMPLETED: "مكتمل",
    CANCELLED: "ملغى",
  };
  return map[status] ?? status;
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(date);
}
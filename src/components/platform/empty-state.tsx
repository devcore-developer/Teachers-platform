import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Optional call-to-action rendered under the description. */
  action?: React.ReactNode;
  className?: string;
}

/** Consistent empty-state block for lists and future module views. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/40 px-6 py-10 text-center",
        className
      )}
    >
      <div
        className="mb-3 flex size-12 items-center justify-center rounded-full bg-brand-100 text-brand-700"
        aria-hidden="true"
      >
        <Icon className="size-6" strokeWidth={1.8} />
      </div>
      <p className="text-sm font-bold text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "info" | "warning" | "error" | "neutral";

interface StatusBadgeProps extends React.ComponentProps<"span"> {
  tone: StatusTone;
  /** Optional leading dot rendered before the label. */
  withDot?: boolean;
}

/**
 * Semantic status badge built on the platform's status tokens
 * (success / info / warning / error / neutral) instead of scattered
 * hardcoded color classes.
 */
export function StatusBadge({
  tone,
  withDot = true,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap",
        tone === "success" && "bg-success-soft text-success",
        tone === "info" && "bg-info-soft text-info",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "error" && "bg-error-soft text-error",
        tone === "neutral" && "bg-muted text-muted-foreground",
        className
      )}
      {...props}
    >
      {withDot && (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            tone === "success" && "bg-success",
            tone === "info" && "bg-info",
            tone === "warning" && "bg-warning",
            tone === "error" && "bg-error",
            tone === "neutral" && "bg-muted-foreground"
          )}
        />
      )}
      {children}
    </span>
  );
}
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title: string;
  description?: string;
  /** Optional control rendered at the end of the header row. */
  action?: React.ReactNode;
  /** Optional footer rendered after a separator at the card bottom. */
  footer?: React.ReactNode;
  contentClassName?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Shared dashboard panel: card with a consistent header (title,
 * optional description and action) and an optional footer.
 */
export function SectionCard({
  title,
  description,
  action,
  footer,
  contentClassName,
  className,
  children,
}: SectionCardProps) {
  return (
    <Card
      className={cn(
        "flex flex-col gap-0 rounded-xl border bg-card py-0 shadow-xs",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 pb-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <CardContent className={cn("px-5 pb-5 sm:px-6", contentClassName)}>
        {children}
      </CardContent>
      {footer && (
        <>
          <Separator />
          <div className="px-5 py-3 sm:px-6">{footer}</div>
        </>
      )}
    </Card>
  );
}
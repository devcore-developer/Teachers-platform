import { GraduationCap } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PlatformBranding } from "@/lib/types";

interface BrandLogoProps {
  branding: PlatformBranding;
  /** "sidebar" renders on the navy sidebar, "light" on light surfaces. */
  variant?: "sidebar" | "light";
  withSubtitle?: boolean;
  className?: string;
}

/**
 * Platform wordmark. Uses the configured branding (never a hardcoded
 * school name) so a future tenant can swap name/logo seamlessly.
 */
export function BrandLogo({
  branding,
  variant = "sidebar",
  withSubtitle = true,
  className,
}: BrandLogoProps) {
  const light = variant === "light";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-sm",
          light
            ? "bg-gradient-to-br from-brand-600 to-brand-800 text-white"
            : "bg-white/10 text-white ring-1 ring-white/15"
        )}
        aria-hidden="true"
      >
        <GraduationCap className="size-5.5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 text-start leading-tight">
        <p
          className={cn(
            "truncate text-base font-extrabold tracking-tight",
            light ? "text-foreground" : "text-white"
          )}
        >
          {branding.productName}
        </p>
        {withSubtitle && (
          <p
            className={cn(
              "truncate text-xs font-medium",
              light ? "text-muted-foreground" : "text-sidebar-foreground/70"
            )}
          >
            {branding.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
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
 * Dynamic identity wordmark — platform or school.
 *
 * When the resolved branding carries a school logo it is rendered as an
 * image (the URL is server-validated); otherwise the platform mark is
 * drawn with brand colors that follow the runtime CSS variables, so the
 * same component serves every tenant without hardcoding any school.
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
      {branding.logoUrl ? (
        // School logo (uploaded through the authorized branding manager).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logoUrl}
          alt=""
          className="size-10 shrink-0 rounded-xl bg-white object-contain p-0.5 shadow-sm ring-1 ring-black/5"
          draggable={false}
        />
      ) : (
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
      )}
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
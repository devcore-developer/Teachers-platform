import { GraduationCap } from "lucide-react";

import { FitText } from "@/components/layout/fit-text";
import { cn } from "@/lib/utils";
import type { PlatformBranding } from "@/lib/types";

interface BrandLogoProps {
  branding: PlatformBranding;
  /** "sidebar" renders on the navy sidebar, "light" on light surfaces. */
  variant?: "sidebar" | "light";
  /** sm: rails and cards — lg: gate screens (login, register, recovery). */
  size?: "sm" | "md" | "lg";
  /** horizontal: rails — vertical: centered gate-screen headers. */
  orientation?: "horizontal" | "vertical";
  withSubtitle?: boolean;
  className?: string;
}

/**
 * Name sizes are EXPLICIT pixel ranges handed to <FitText>, which
 * measures the real rendered width of the school name and shrinks the
 * font so it ALWAYS stays on ONE line (min readable floor, ellipsis +
 * tooltip only beyond that floor). Previously these were fixed text-*
 * classes — long Arabic school names overflowed the rail.
 */
const SIZE_STYLES = {
  sm: {
    box: "size-10 rounded-xl",
    icon: "size-5.5",
    nameMaxPx: 16,
    nameMinPx: 9,
    subtitle: "text-xs",
  },
  md: {
    box: "size-12 rounded-xl",
    icon: "size-6.5",
    nameMaxPx: 18,
    nameMinPx: 10,
    subtitle: "text-xs",
  },
  lg: {
    box: "size-16 rounded-2xl sm:size-20",
    icon: "size-8 sm:size-9",
    nameMaxPx: 30,
    nameMinPx: 13,
    subtitle: "text-sm",
  },
} as const;

/**
 * Dynamic identity wordmark — platform or school.
 *
 * ROOT-CAUSE NOTE (sidebar overflow fix): this component renders as a
 * flex child inside rails and headers. A flex item's default
 * `min-width: auto` makes it refuse to shrink below its content width,
 * which let a long nowrap wordmark inflate this box past the sidebar
 * edge and disconnect the inner <FitText> measurement from the real
 * available width. The root is therefore pinned with min-w-0 /
 * max-w-full / overflow-hidden so the available width is ALWAYS the
 * parent's content box minus the fixed-size logo.
 *
 * The logo itself is FIXED-SIZE (shrink-0) — text never pushes it out
 * of the sidebar.
 */
export function BrandLogo({
  branding,
  variant = "sidebar",
  size = "sm",
  orientation = "horizontal",
  withSubtitle = true,
  className,
}: BrandLogoProps) {
  const light = variant === "light";
  const s = SIZE_STYLES[size];
  const stacked = orientation === "vertical";

  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full overflow-hidden",
        stacked
          ? "flex-col items-center gap-3 text-center"
          : "flex-1 items-center gap-3 text-start",
        className
      )}
    >
      {branding.logoUrl ? (
        // School logo (uploaded through the authorized branding manager).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logoUrl}
          alt=""
          draggable={false}
          className={cn(
            "shrink-0 object-contain",
            light
              ? size === "lg"
                ? // Gate screens: height-driven, keeps the natural aspect
                  // ratio of any uploaded logo — no plate, no cropping.
                  "h-16 w-auto max-w-48 sm:h-20 sm:max-w-56"
                : s.box
              : cn(s.box, "bg-white p-0.5 shadow-sm ring-1 ring-black/5")
          )}
        />
      ) : (
        <div
          className={cn(
            "flex shrink-0 items-center justify-center",
            s.box,
            light
              ? "bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-lg shadow-brand-600/25 ring-1 ring-brand-700/20"
              : "bg-white/10 text-white ring-1 ring-white/15"
          )}
          aria-hidden="true"
        >
          <GraduationCap className={s.icon} strokeWidth={1.8} />
        </div>
      )}
      <div
        className={cn(
          "min-w-0 leading-tight",
          stacked ? "w-full space-y-1" : "flex-1"
        )}
      >
        <FitText
          maxPx={s.nameMaxPx}
          minPx={s.nameMinPx}
          className={cn(
            "font-extrabold tracking-tight",
            light ? "text-foreground" : "text-white"
          )}
          title={branding.productName}
        >
          {branding.productName}
        </FitText>
        {withSubtitle && (
          <p
            className={cn(
              "truncate font-medium",
              s.subtitle,
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
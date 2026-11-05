import { GraduationCap } from "lucide-react";

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

const SIZE_STYLES = {
  sm: {
    box: "size-10 rounded-xl",
    icon: "size-5.5",
    name: "text-base",
    subtitle: "text-xs",
  },
  md: {
    box: "size-12 rounded-xl",
    icon: "size-6.5",
    name: "text-lg",
    subtitle: "text-xs",
  },
  lg: {
    box: "size-16 rounded-2xl sm:size-20",
    icon: "size-8 sm:size-9",
    name: "text-2xl sm:text-3xl",
    subtitle: "text-sm",
  },
} as const;

/**
 * Dynamic identity wordmark — platform or school.
 *
 * When the resolved branding carries a school logo the image renders
 * AS-IS with its natural aspect ratio — no artificial white container
 * on light surfaces. Only the navy sidebar keeps a subtle white plate
 * behind uploaded logos, because dark logos would vanish against it.
 * On light gate screens the logo is height-constrained instead of
 * boxed, so wide logos render at their real proportions (no cropping,
 * no padding plate). Without a logo the platform mark is drawn with
 * brand colors that follow the runtime CSS variables, so the same
 * component serves every tenant without hardcoding any school.
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
        "flex",
        stacked
          ? "flex-col items-center gap-3 text-center"
          : "items-center gap-3 text-start",
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
      <div className={cn("min-w-0 leading-tight", stacked && "space-y-1")}>
        <p
          className={cn(
            "truncate font-extrabold tracking-tight",
            s.name,
            light ? "text-foreground" : "text-white"
          )}
        >
          {branding.productName}
        </p>
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
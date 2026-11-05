import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { BrandLogo } from "@/components/layout/brand-logo";
import { defaultBranding } from "@/config/branding";
import { cn } from "@/lib/utils";
import type { PlatformBranding } from "@/lib/types";

interface AuthCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Narrower card for verification result screens. */
  compact?: boolean;
  /** Resolved identity (school or platform). Defaults to the platform
   * identity so unseen callers keep working unchanged. */
  branding?: PlatformBranding;
  className?: string;
}

/**
 * Shared card for the gate screens (login, registration, verification,
 * password recovery): dynamic identity logo, RTL Arabic-first layout
 * and consistent spacing with the rest of the platform. Colors follow
 * the runtime CSS variables set by the caller, so the same card renders
 * any school's identity without hardcoding it.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
  compact,
  branding,
  className,
}: AuthCardProps) {
  const resolved = branding ?? defaultBranding;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className={cn("w-full", compact ? "max-w-md" : "max-w-lg", className)}>
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 items-center rounded-xl bg-card px-4 shadow-xs">
            <BrandLogo branding={resolved} variant="sidebar" />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-brand-600" aria-hidden="true" />
            جلسة آمنة ومحمية على الخادم
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-xs sm:p-8">
          <h1 className="text-xl font-extrabold text-foreground">{title}</h1>
          {description && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
          <div className="mt-6">{children}</div>
        </div>

        {footer && (
          <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground/70">
          <Link href="/" className="transition-colors hover:text-brand-600">
            {resolved.productName}
          </Link>{" "}
          — بوابة الدخول الموحدة
        </p>
      </div>
    </div>
  );
}
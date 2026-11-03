import Link from "next/link";
import { GraduationCap, ShieldCheck } from "lucide-react";

import { defaultBranding } from "@/config/branding";
import { cn } from "@/lib/utils";

interface AuthCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Narrower card for verification result screens. */
  compact?: boolean;
  className?: string;
}

/**
 * Shared card for the gate screens (login, registration, verification,
 * password recovery): brand lockup, RTL Arabic-first layout, blue
 * identity and consistent spacing with the rest of the platform.
 *
 * The backdrop is a quiet brand scene built purely from design tokens
 * (brand-blue washes + a faint dot grid fading at the edges) — no
 * imagery, no hard gradients, clipped by overflow-hidden so it can
 * never cause horizontal overflow on small screens.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
  compact,
  className,
}: AuthCardProps) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Brand ambience (decorative only, hidden from AT) */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 [background-image:radial-gradient(oklch(0.6_0.175_260/0.10)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_78%)]" />
        <div className="absolute -top-36 -right-32 h-96 w-[44rem] rounded-full bg-brand-100/80 blur-3xl" />
        <div className="absolute -bottom-44 -left-36 h-96 w-[40rem] rounded-full bg-info-soft/80 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-[30rem] w-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-50/70 blur-3xl" />
      </div>

      <div className={cn("relative w-full", compact ? "max-w-md" : "max-w-lg", className)}>
        {/* Secure-session badge */}
        <div className="mb-5 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/80 py-1.5 ps-3.5 pe-4 text-xs font-semibold text-foreground shadow-sm backdrop-blur">
            <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
            جلسة آمنة ومحمية على الخادم
            <span className="relative flex size-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
          </span>
        </div>

        {/* Card */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-xl shadow-brand-900/10 backdrop-blur">
          <div
            aria-hidden="true"
            className="h-1 w-full bg-gradient-to-l from-brand-800 via-brand-500 to-brand-700"
          />

          <div className="px-6 py-8 sm:px-9 sm:py-10">
            <div className="mb-7 flex flex-col items-center gap-2.5 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 text-primary-foreground shadow-lg shadow-brand-600/25">
                <GraduationCap className="size-7" aria-hidden="true" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-bold text-brand-700">
                  {defaultBranding.productName}
                </p>
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                  {title}
                </h1>
                {description && (
                  <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            </div>

            {children}
          </div>
        </div>

        {footer && (
          <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground/70">
          <Link href="/" className="transition-colors hover:text-brand-600">
            {defaultBranding.productName}
          </Link>{" "}
          — بوابة الدخول الموحدة
        </p>
      </div>
    </div>
  );
}
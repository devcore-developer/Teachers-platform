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
 * Shared shell for the gate screens (login, registration, verification,
 * password recovery) — a premium, school-branded portal experience.
 *
 * Design notes:
 *  - the identity header (logo + school/platform name) renders DIRECTLY
 *    on the page — no white box around the logo — and sits directly on
 *    top of the card so the two read as one composition;
 *  - the background carries restrained brand-tinted decoration (soft
 *    blurred shapes and a hairline ring) driven by the runtime CSS
 *    variables, so every school gets its own palette with zero assets;
 *  - the card itself is a single elevated surface with a brand gradient
 *    accent line, generous padding and a quiet security footnote.
 *
 * Colors follow the runtime CSS variables set by the caller, so the
 * same shell renders any school's identity without hardcoding it.
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
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-gradient-to-b from-brand-50/80 via-background to-background">
      {/* Restrained brand decoration — pure CSS, follows the palette */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 start-[-12%] size-[30rem] rounded-full bg-brand-200/40 blur-3xl" />
        <div className="absolute bottom-[-14rem] end-[-10%] size-[28rem] rounded-full bg-brand-100/70 blur-3xl" />
        <div className="absolute top-[22%] end-[8%] hidden size-64 rounded-full border border-brand-200/60 md:block" />
        <div className="absolute bottom-[18%] start-[6%] hidden size-40 rounded-full border border-brand-200/40 lg:block" />
      </div>

      <main className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
        <div className={cn("w-full", compact ? "max-w-md" : "max-w-lg", className)}>
          {/* Identity header — visually connected to the card above it */}
          <div className="mb-8 flex justify-center">
            <BrandLogo
              branding={resolved}
              variant="light"
              size="lg"
              orientation="vertical"
            />
          </div>

          {/* The card — one elevated surface, brand accent on top */}
          <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/95 shadow-xl shadow-brand-950/10 backdrop-blur-sm">
            <div
              aria-hidden="true"
              className="h-1 w-full bg-gradient-to-l from-brand-600 via-brand-400 to-brand-600"
            />
            <div className="p-6 sm:p-10">
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                {title}
              </h1>
              {description && (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              )}
              <div className="mt-7">{children}</div>

              <p className="mt-8 flex items-center justify-center gap-1.5 border-t border-border/60 pt-4 text-[11px] font-medium text-muted-foreground/80">
                <ShieldCheck className="size-3.5 text-brand-600" aria-hidden="true" />
                جلسة آمنة — جميع التحققات تتم على الخادم
              </p>
            </div>
          </div>

          {footer && (
            <div className="mt-6 text-center text-sm text-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </main>

      {/* Platform footer — subtle, consistent identity */}
      <footer className="relative px-4 py-6 text-center">
        <p className="text-xs font-medium text-muted-foreground">
          <Link
            href="/"
            className="transition-colors hover:text-brand-700"
          >
            {resolved.productName}
          </Link>{" "}
          — {resolved.subtitle}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          © 2025 منارة — مكتب التطوير التربوي · جميع الحقوق محفوظة
        </p>
      </footer>
    </div>
  );
}
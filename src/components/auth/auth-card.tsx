import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { BrandLogo } from "@/components/layout/brand-logo";
import { defaultBranding } from "@/config/branding";
import { cn } from "@/lib/utils";
import type { PlatformBranding } from "@/lib/types";

/**
 * Display name rendered on the gate screens (login, registration,
 * verification, password recovery) when NO school context is resolved —
 * it replaces the former «منارة» wordmark so the portal identifies
 * itself as «منصة التنمية المهنية» alone, with no subtitle line.
 * School-scoped gate screens (?school= / /register/{token}) keep their
 * own resolved identity untouched.
 */
export const GATE_DISPLAY_NAME = "منصة التنمية المهنية";

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
 *  - for the PLATFORM scope the header shows «منصة التنمية المهنية» as
 *    a single title line — the former «منارة» wordmark and the subtitle
 *    line are gone; a school context keeps its full identity;
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
  const year = new Date().getFullYear();

  // Gate-screen identity: a school context renders as resolved; the
  // platform scope collapses to the single display name with no
  // subtitle line (an empty subtitle also removes the trailing dash in
  // the footer and the copyright line).
  const schoolScope = Boolean(resolved.currentSchool);
  const gateBranding: PlatformBranding = schoolScope
    ? resolved
    : { ...resolved, productName: GATE_DISPLAY_NAME, subtitle: "" };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-gradient-to-b from-brand-50/80 via-background to-background">
      {/* Restrained brand decoration — pure CSS, follows the palette */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 start-[-12%] size-[30rem] rounded-full bg-brand-200/40 blur-3xl" />
        <div className="absolute bottom-[-14rem] end-[-10%] size-[28rem] rounded-full bg-brand-100/70 blur-3xl" />
        <div className="absolute top-[22%] end-[8%] hidden size-64 rounded-full border border-brand-200/60 md:block" />
        <div className="absolute bottom-[18%] start-[6%] hidden size-40 rounded-full border border-brand-200/40 lg:block" />
      </div>

      <main className="relative flex flex-1 items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
        <div
          className={cn(
            "w-full animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none",
            compact ? "max-w-md" : "max-w-lg",
            className
          )}
        >
          {/* Identity header — visually connected to the card above it */}
          <div className="mb-4 flex justify-center sm:mb-5">
            <BrandLogo
              branding={gateBranding}
              variant="light"
              size="lg"
              orientation="vertical"
              withSubtitle={Boolean(gateBranding.subtitle)}
            />
          </div>

          {/* The card — one elevated surface, brand accent on top */}
          <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/95 shadow-xl shadow-brand-900/10 backdrop-blur-sm">
            <div
              aria-hidden="true"
              className="h-1 w-full bg-gradient-to-l from-brand-600 via-brand-300 to-brand-600"
            />
            <div className="p-6 sm:p-8">
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                {title}
              </h1>
              {description && (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              )}
              <div className="mt-5">{children}</div>

              <p className="mt-5 flex items-center justify-center gap-1.5 border-t border-border/60 pt-3 text-[11px] font-medium text-muted-foreground/80">
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
      <footer className="relative px-4 py-4 text-center">
        <p className="text-sm font-semibold text-muted-foreground">
          <Link
            href="/"
            className="transition-colors hover:text-brand-700"
          >
            {gateBranding.productName}
          </Link>
          {gateBranding.subtitle ? <> — {gateBranding.subtitle}</> : null}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/80">
          © {year} {gateBranding.productName} — مكتب التطوير التربوي · جميع الحقوق محفوظة
        </p>
      </footer>
    </div>
  );
}
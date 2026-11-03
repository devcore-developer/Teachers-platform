"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/types";

export interface BreadcrumbItem {
  label: string;
  /** When omitted the crumb renders as the current page (no link). */
  href?: string;
}

interface PageHeaderProps {
  /** Active module for the default trail (legacy Phase-1 usage). */
  module?: NavItem;
  title: string;
  description?: string;
  /** Optional contextual chips/meta rendered under the description. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * Phase 2: explicit breadcrumb trail rendered after the "الرئيسية"
   * root, which always links to "/". The last crumb is the current page.
   */
  breadcrumbs?: BreadcrumbItem[];
  /** Legacy home-crumb click handler (Phase 1 dashboard). */
  onNavigateHome?: () => void;
}

const crumbLinkClass =
  "rounded px-1 py-0.5 font-semibold transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Consistent page header: breadcrumb trail, page title, contextual
 * description and an optional actions slot.
 */
export function PageHeader({
  module,
  title,
  description,
  meta,
  actions,
  breadcrumbs,
  onNavigateHome,
}: PageHeaderProps) {
  const legacyIsHome = module?.id === "home";

  return (
    <div className="mb-6">
      {/* Breadcrumb */}
      <nav aria-label="مسار التنقل" className="mb-2">
        <ol className="flex items-center gap-1 text-xs text-muted-foreground" role="list">
          {/* Root crumb */}
          <li>
            {breadcrumbs || !onNavigateHome ? (
              <Link href="/" className={cn(crumbLinkClass, legacyIsHome && "text-foreground")} aria-current={legacyIsHome ? "page" : undefined}>
                الرئيسية
              </Link>
            ) : (
              <button
                type="button"
                onClick={onNavigateHome}
                className={cn(crumbLinkClass, legacyIsHome && "text-foreground")}
                aria-current={legacyIsHome ? "page" : undefined}
              >
                الرئيسية
              </button>
            )}
          </li>

          {/* Legacy module crumb (Phase 1 usage) */}
          {!breadcrumbs && module && !legacyIsHome && (
            <>
              <li aria-hidden="true">
                <ChevronLeft className="size-3.5 text-muted-foreground/60" />
              </li>
              <li>
                <span className="rounded px-1 py-0.5 font-semibold text-foreground" aria-current="page">
                  {module.label}
                </span>
              </li>
            </>
          )}

          {/* Explicit Phase-2 trail */}
          {breadcrumbs?.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                <ChevronLeft className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
                {crumb.href && !isLast ? (
                  <Link href={crumb.href} className={crumbLinkClass}>
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    className="rounded px-1 py-0.5 font-semibold text-foreground"
                    aria-current={isLast ? "page" : undefined}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
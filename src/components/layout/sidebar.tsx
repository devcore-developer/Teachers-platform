"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Landmark, Palette } from "lucide-react";

import { BrandLogo } from "@/components/layout/brand-logo";
import { FitText } from "@/components/layout/fit-text";
import {
  activeNavItemId,
  navGroupsForItems,
} from "@/config/navigation";
import { cn } from "@/lib/utils";
import type { NavItem, PlatformBranding } from "@/lib/types";

interface SidebarProps {
  branding: PlatformBranding;
  items: NavItem[];
  /** True when the role may manage school branding — upgrades the
   * identity card into a link to the branding manager. Computed on the
   * server (nav ids) — the sidebar never decides authorization. */
  canManageBranding?: boolean;
  className?: string;
}

/**
 * Desktop application sidebar — premium navy rail on the inline-start
 * side, which in the RTL layout is the right edge of the screen.
 * Hidden on mobile (the mobile navigation Sheet takes over below lg).
 *
 * Active state uses the longest-href match, so nested routes highlight
 * exactly one item (e.g. /academy/manage/12 highlights "إدارة الدورات"
 * without also highlighting "الأكاديمية التدريبية").
 *
 * Grouping comes from the shared navGroupsForItems (same source as the
 * mobile drawer): supervisors get the approved 4-group information
 * architecture, every other role keeps the classic grouping. Grouping
 * is presentation only — it never adds, removes or re-orders modules.
 *
 * Overflow contract (verified in a real browser with 44-character
 * Arabic school names): the rail is a fixed 18rem; the school wordmark
 * and the identity-card name use <FitText>, which MEASURES the real
 * available width and scales the font down so the full name stays on
 * ONE line — never wrapping, never leaving the rail. The logo keeps a
 * fixed size; the operator signature line is a constant string (the
 * school name is already fully rendered twice above it).
 */
export function Sidebar({ branding, items, canManageBranding, className }: SidebarProps) {
  const pathname = usePathname();
  const activeId = activeNavItemId(pathname, items);
  const groups = navGroupsForItems(items);

  const schoolName = branding.currentSchool?.name ?? null;

  return (
    <aside
      className={cn(
        "hidden lg:flex lg:w-72 lg:max-w-full lg:shrink-0 lg:flex-col",
        "sticky top-0 h-screen overflow-hidden bg-sidebar text-sidebar-foreground",
        "border-e border-sidebar-border/70",
        className
      )}
    >
      {/* Brand — school wordmark auto-fits on one line. px-4 (not px-5)
          buys extra width for the name; the logo stays size-10 fixed. */}
      <div className="flex h-16 w-full min-w-0 shrink-0 items-center overflow-hidden border-b border-sidebar-border/70 px-4">
        <BrandLogo branding={branding} variant="sidebar" />
      </div>

      {/* Navigation */}
      <nav
        aria-label="التنقل الرئيسي"
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-2"
      >
        {groups.map((group, groupIndex) => (
          <div
            key={group.label || `extra-${groupIndex}`}
            className={cn(groupIndex > 0 && "mt-5")}
          >
            {group.label && (
              <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-sidebar-foreground/40">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5" role="list">
              {group.items.map((item) => {
                const active = item.id === activeId;
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      title={item.label}
                      className={cn(
                        "group flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                        active
                          ? "bg-gradient-to-l from-brand-600 to-brand-500 text-white shadow-md shadow-brand-900/30"
                          : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-4.5 shrink-0",
                          active
                            ? "text-white"
                            : "text-sidebar-foreground/55 group-hover:text-sidebar-accent-foreground"
                        )}
                        strokeWidth={active ? 2.2 : 1.8}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-start">
                        {item.label}
                      </span>
                      {item.badge && !active && (
                        <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-bold text-sidebar-foreground/70 ring-1 ring-white/10">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* School identity card — real tenant identity (multi-school
          branding). When the signed-in role may manage branding, the
          whole card links to the branding manager. The school name
          auto-fits on one line via <FitText> (measured fluid font
          shrink), full name always available as a tooltip. */}
      <div className="w-full min-w-0 shrink-0 overflow-hidden border-t border-sidebar-border/70 p-4">
        {canManageBranding ? (
          <Link
            href="/schools/branding"
            className="group block w-full min-w-0 overflow-hidden rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10 transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <div className="flex w-full min-w-0 items-center gap-2.5">
              {branding.currentSchool?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.currentSchool.logoUrl}
                  alt=""
                  className="size-8 shrink-0 rounded-lg bg-white object-contain p-0.5"
                  draggable={false}
                />
              ) : (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Landmark className="size-4 text-brand-100" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1 leading-tight">
                <FitText
                  maxPx={12}
                  minPx={8}
                  className="font-bold text-sidebar-foreground"
                  title={schoolName ?? undefined}
                >
                  {schoolName ?? "هوية المدرسة"}
                </FitText>
                <p className="truncate text-[11px] text-sidebar-foreground/60">
                  تخصيص الشعار والألوان
                </p>
              </div>
              <Palette className="size-4 shrink-0 text-sidebar-foreground/50 transition-colors group-hover:text-white" aria-hidden="true" />
            </div>
          </Link>
        ) : (
          <div className="w-full min-w-0 overflow-hidden rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10">
            <div className="flex w-full min-w-0 items-center gap-2.5">
              {branding.currentSchool?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.currentSchool.logoUrl}
                  alt=""
                  className="size-8 shrink-0 rounded-lg bg-white object-contain p-0.5"
                  draggable={false}
                />
              ) : (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Landmark className="size-4 text-brand-100" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1 leading-tight">
                <FitText
                  maxPx={12}
                  minPx={8}
                  className="font-bold text-sidebar-foreground"
                  title={schoolName ?? "مساحة عمل المدرسة"}
                >
                  {schoolName ?? "مساحة عمل المدرسة"}
                </FitText>
                <p className="truncate text-[11px] text-sidebar-foreground/60">
                  {branding.subtitle}
                </p>
              </div>
            </div>
          </div>
        )}
        {/* Operator signature — a CONSTANT platform string. The school
            name is already fully rendered in the header and the card;
            repeating it here was the tightest overflow surface. */}
        <FitText
          maxPx={11}
          minPx={9}
          className="mt-3 text-center text-sidebar-foreground/40"
          title="منارة — مكتب التطوير التربوي"
        >
          {"منارة — مكتب التطوير التربوي"}
        </FitText>
      </div>
    </aside>
  );
}
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Landmark, Palette } from "lucide-react";

import { BrandLogo } from "@/components/layout/brand-logo";
import { activeNavItemId } from "@/config/navigation";
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
 * Visual grouping of the sidebar — presentation only. It never adds,
 * removes or re-orders modules: items still arrive role-filtered from
 * the server (navIdsForRole) in their config order, and any id that is
 * not listed below falls back to an unlabeled trailing group, so a
 * future module can never disappear from the UI by accident.
 */
const NAV_GROUPS: Array<{ label: string; members: string[] }> = [
  {
    label: "القائمة الرئيسية",
    members: [
      "home",
      "academy",
      "schools",
      "school-branding",
      "users",
      "supervision",
      "deputy-overview",
    ],
  },
  {
    label: "التدريب والتقييم",
    members: [
      "programs",
      "course-management",
      "assessments",
      "assignments",
      "certificates",
      "reports",
    ],
  },
  {
    label: "حسابي",
    members: ["my-profile", "settings"],
  },
];

/** Group the role-filtered items, preserving config order inside each group. */
function groupNavItems(
  items: NavItem[]
): Array<{ label: string; items: NavItem[] }> {
  const known = new Set(NAV_GROUPS.flatMap((group) => group.members));
  const groups = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: items.filter((item) => group.members.includes(item.id)),
  }));
  const leftovers = items.filter((item) => !known.has(item.id));
  if (leftovers.length > 0) groups.push({ label: "", items: leftovers });
  return groups.filter((group) => group.items.length > 0);
}

/**
 * Desktop application sidebar — premium navy rail on the inline-start
 * side, which in the RTL layout is the right edge of the screen.
 * Hidden on mobile (the mobile navigation Sheet takes over below lg).
 *
 * Active state uses the longest-href match, so nested routes highlight
 * exactly one item (e.g. /academy/manage/12 highlights "إدارة الدورات"
 * without also highlighting "الأكاديمية التدريبية").
 */
export function Sidebar({ branding, items, canManageBranding, className }: SidebarProps) {
  const pathname = usePathname();
  const activeId = activeNavItemId(pathname, items);
  const groups = groupNavItems(items);

  return (
    <aside
      className={cn(
        "hidden lg:flex lg:w-72 lg:shrink-0 lg:flex-col",
        "sticky top-0 h-screen bg-sidebar text-sidebar-foreground",
        "border-e border-sidebar-border/70",
        className
      )}
    >
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border/70 px-5">
        <BrandLogo branding={branding} variant="sidebar" />
      </div>

      {/* Navigation */}
      <nav
        aria-label="التنقل الرئيسي"
        className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4 pt-2"
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
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
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
                      <span className="flex-1 text-start">{item.label}</span>
                      {item.badge && !active && (
                        <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-bold text-sidebar-foreground/70 ring-1 ring-white/10">
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
          whole card links to the branding manager. */}
      <div className="shrink-0 border-t border-sidebar-border/70 p-4">
        {canManageBranding ? (
          <Link
            href="/schools/branding"
            className="group block rounded-xl bg-white/[0.06] p-3.5 ring-1 ring-white/10 transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <div className="flex items-center gap-2.5">
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
                <p className="truncate text-xs font-bold text-sidebar-foreground">
                  {branding.currentSchool?.name ?? "هوية المدرسة"}
                </p>
                <p className="truncate text-[11px] text-sidebar-foreground/60">
                  تخصيص الشعار والألوان
                </p>
              </div>
              <Palette className="size-4 shrink-0 text-sidebar-foreground/50 transition-colors group-hover:text-white" aria-hidden="true" />
            </div>
          </Link>
        ) : (
          <div className="rounded-xl bg-white/[0.06] p-3.5 ring-1 ring-white/10">
            <div className="flex items-center gap-2.5">
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
                <p className="truncate text-xs font-bold text-sidebar-foreground">
                  {branding.currentSchool?.name ?? "مساحة عمل المدرسة"}
                </p>
                <p className="truncate text-[11px] text-sidebar-foreground/60">
                  {branding.subtitle}
                </p>
              </div>
            </div>
          </div>
        )}
        <p className="mt-3 text-center text-[11px] text-sidebar-foreground/40">
          {branding.productName} · منارة — مكتب التطوير التربوي
        </p>
      </div>
    </aside>
  );
}
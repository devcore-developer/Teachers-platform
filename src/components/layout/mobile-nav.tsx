"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Landmark } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandLogo } from "@/components/layout/brand-logo";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { activeNavItemId } from "@/config/navigation";
import { cn } from "@/lib/utils";
import type { CurrentUser, NavItem, PlatformBranding } from "@/lib/types";

interface MobileNavProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branding: PlatformBranding;
  user: CurrentUser;
  items: NavItem[];
}

/**
 * Visual grouping — kept in sync with the desktop sidebar (presentation
 * only; never adds, removes or re-orders modules). Unknown ids fall back
 * to an unlabeled trailing group.
 */
const NAV_GROUPS: Array<{ label: string; members: string[] }> = [
  {
    label: "القائمة الرئيسية",
    members: ["home", "academy", "schools", "users", "supervision", "deputy-overview"],
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
 * Mobile navigation drawer. Slides from the inline-start edge (right
 * side in RTL) and mirrors the desktop sidebar navigation, including
 * its visual grouping.
 *
 * Active state uses the longest-href match — identical behavior to the
 * desktop sidebar. The drawer closes itself when a link is clicked and
 * the active state follows the current URL.
 */
export function MobileNav({
  open,
  onOpenChange,
  branding,
  user,
  items,
}: MobileNavProps) {
  const pathname = usePathname();
  const activeId = activeNavItemId(pathname, items);
  const groups = groupNavItems(items);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-80 flex-col bg-sidebar p-0 text-sidebar-foreground [&>button]:text-white/70"
      >
        <SheetHeader className="border-b border-sidebar-border/70 px-5 py-4 text-start">
          <SheetTitle asChild>
            <div>
              <BrandLogo branding={branding} variant="sidebar" />
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">
            قائمة التنقل الرئيسية
          </SheetDescription>
        </SheetHeader>

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
                        onClick={() => onOpenChange(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
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

        <div className="shrink-0 border-t border-sidebar-border/70 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10">
            <Avatar className="size-9">
              <AvatarFallback className="bg-brand-600 text-xs font-bold text-white">
                {user.initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-bold text-sidebar-foreground">
                {user.name}
              </p>
              <p className="truncate text-[11px] text-sidebar-foreground/60">
                {user.role}
              </p>
            </div>
            <Landmark className="size-4 shrink-0 text-sidebar-foreground/40" aria-hidden="true" />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
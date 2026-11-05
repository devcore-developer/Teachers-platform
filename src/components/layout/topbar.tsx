"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  LogOut,
  Menu,
  Search,
  Settings,
  UserRound,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { logoutAction } from "@/app/actions/auth";
import { NotificationBell } from "@/components/layout/notification-bell";
import type {
  CurrentUser,
  NavItem,
} from "@/lib/types";

interface TopbarProps {
  user: CurrentUser;
  items: NavItem[];
  onOpenMobileNav: () => void;
}

/**
 * Top application bar: clean white surface with the module search,
 * notifications, and the user identity + menu. Every visible control
 * performs a real action (navigation or a persisted state change) —
 * no dead buttons, no demo data.
 *
 * Notifications are REAL (Batch 1): the bell is the persisted
 * `NotificationBell` component — it reads the session-scoped
 * `/api/notifications` API, marks rows read through the same
 * owner-scoped API (the write is enforced server-side), and tapping a
 * notification navigates to the internal destination the server built
 * for it (course deep links carry the REAL course id).
 *
 * The user-menu "الإعدادات" entry renders only for roles whose
 * role-filtered `items` actually include the settings module — the
 * sidebar and the user menu can never disagree again.
 */
export function Topbar({
  user,
  items,
  onOpenMobileNav,
}: TopbarProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const canSeeSettings = items.some((item) => item.id === "settings");

  const normalizedQuery = query.trim();
  const searchResults =
    normalizedQuery.length > 0
      ? items.filter(
          (item) =>
            item.label.includes(normalizedQuery) ||
            item.description.includes(normalizedQuery)
        )
      : items;

  function handleNavigate(href: string) {
    setSearchOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border/70 bg-card/90 px-4 backdrop-blur-md sm:gap-3 sm:px-6">
      {/* Mobile menu */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMobileNav}
        aria-label="فتح قائمة التنقل"
      >
        <Menu className="size-5" />
      </Button>

      {/* Module search */}
      <Popover open={searchOpen} onOpenChange={setSearchOpen}>
        <PopoverAnchor asChild>
          <div className="relative hidden flex-1 md:block md:max-w-md">
            <Search
              className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              placeholder="ابحث عن صفحة أو ميزة…"
              className="h-10 rounded-xl border-transparent bg-muted/60 ps-10 text-sm transition-colors hover:bg-muted/80 focus-visible:bg-card"
              aria-label="البحث في المنصة"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-[min(26rem,92vw)] rounded-xl p-2"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <ul className="scrollbar-thin max-h-72 overflow-y-auto" role="listbox">
            {searchResults.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                لا توجد نتائج مطابقة لـ «{normalizedQuery}»
              </li>
            ) : (
              searchResults.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected="false"
                      onClick={() => handleNavigate(item.href)}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {item.label}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                      {item.badge && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </PopoverContent>
      </Popover>

      {/* Notifications — real and persisted (Batch 1).
          The bell fetches the signed-in user's notifications from
          /api/notifications, supports "تحديد الكل كمقروء" through the
          same owner-scoped API, navigates each row to its server-built
          internal destination, and polls every minute. */}
      <NotificationBell />

      {/* Flank (end side): pushes the user profile to the extreme left edge of the topbar (logical end in RTL). */}
      <div className="flex-1" aria-hidden="true" />

      <Separator orientation="vertical" className="hidden h-8 sm:block" />

      {/* User identity + menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="قائمة المستخدم"
          >
            <Avatar className="size-9">
              <AvatarFallback className="bg-gradient-to-br from-brand-600 to-brand-800 text-xs font-bold text-white">
                {user.initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden min-w-0 text-start leading-tight sm:block">
              <span className="block truncate text-sm font-bold">{user.name}</span>
              <span className="block truncate text-[11px] font-medium text-muted-foreground">
                {user.role}
              </span>
            </span>
            <ChevronDown className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 rounded-xl">
          <DropdownMenuLabel className="px-3 py-3">
            <div className="flex items-center gap-3">
              <Avatar className="size-10">
                <AvatarFallback className="bg-gradient-to-br from-brand-600 to-brand-800 text-xs font-bold text-white">
                  {user.initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{user.name}</p>
                <p className="truncate text-xs font-normal text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/my-profile" className="cursor-pointer">
              <UserRound className="size-4" aria-hidden="true" />
              الملف الشخصي
            </Link>
          </DropdownMenuItem>
          {canSeeSettings && (
            <DropdownMenuItem onSelect={() => handleNavigate("/settings")}>
              <Settings className="size-4" aria-hidden="true" />
              الإعدادات
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {/* Real logout: the server action clears the session cookie. */}
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-error outline-none transition-colors hover:bg-error-soft focus:bg-error-soft"
            >
              <LogOut className="size-4" aria-hidden="true" />
              تسجيل الخروج
            </button>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
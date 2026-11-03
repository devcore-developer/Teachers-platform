# =====================================================================
#  MANARAT QURTUBAH - SIDEBAR ACTIVATION PATCHER (batch 2, self-contained)
# =====================================================================
#  WHAT IT DOES
#    Writes 6 audited files into the project (backing up each one first):
#
#      1. src/config/navigation.ts
#         - removes the stale "قريباً" badges from التكليفات والمتابعة,
#           الشهادات and التقارير (all three are fully implemented
#           modules: pages + services + server actions + role guards)
#         - removes the dead "إدارة المعلمين" entry (its real capability
#           already lives in دليل المستخدمين /users)
#         - keeps the honest badge ONLY on الإعدادات (still a placeholder)
#         - adds activeNavItemId(): single longest-match highlight
#      2. src/components/layout/sidebar.tsx   - uses the single-match
#         active id (fixes double highlighting on nested routes like
#         /academy/manage/12)
#      3. src/components/layout/mobile-nav.tsx - same fix, mobile drawer
#      4. src/components/layout/topbar.tsx    - user-menu "الإعدادات"
#         entry now renders only for roles that actually have the
#         settings module (teacher/supervisor/deputy no longer see it)
#      5. src/app/teachers/page.tsx   - stale placeholder now REDIRECTS
#         to /users instead of showing an outdated "قريباً" screen
#      6. src/app/programs/page.tsx   - stale placeholder now REDIRECTS
#         to the real /academy/programs module
#
#  WHAT THIS DOES *NOT* DO
#    - Does NOT touch the database, prisma, seeds, accounts or auth
#      logic. roles.ts (NAV_ROLES) is left untouched on purpose.
#    - Does NOT change package.json and does NOT install anything.
#    - Does NOT delete any file. Every replaced file is backed up as
#      *.pre-navfix-<timestamp>.bak next to itself.
#
#  HOW TO RUN
#    Save this file anywhere inside the project (for example
#    D:\DevCore\Teachers-platform\manarat-nav-kit\apply-nav-fixes.ps1),
#    then from any directory run:
#
#      powershell -NoProfile -ExecutionPolicy Bypass -File "D:\DevCore\Teachers-platform\manarat-nav-kit\apply-nav-fixes.ps1"
#
#    The script finds the project root automatically by walking up
#    from its own folder. Add -Build to run "npm run build" afterwards.
# =====================================================================

param([switch]$Build)

 $ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ---------------------------------------------------------------------
# 0a) Encoding self-guard: this script MUST be saved as UTF-8 (with BOM
#     is best). If a wrong encoding mangles the Arabic, abort cleanly
#     instead of writing corrupted labels into the project.
# ---------------------------------------------------------------------
 $sentinel = 'قريباً'
if ($sentinel.Length -ne 6) {
    Write-Host 'ERROR: the script file was saved with the wrong encoding.' -ForegroundColor Red
    Write-Host 'Re-save it as "UTF-8 with BOM" (Notepad: Save As -> Encoding: UTF-8 with BOM) and run again.' -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------
# 0b) Locate the project root (walk up from this script's folder)
# ---------------------------------------------------------------------
 $Root = $null
 $searchDirs = New-Object System.Collections.Generic.List[string]
if ($PSScriptRoot) { $searchDirs.Add($PSScriptRoot) }
 $walk = $PSScriptRoot
for ($i = 0; $i -lt 5 -and $walk; $i++) {
    $walk = Split-Path -Parent $walk
    if ($walk) { $searchDirs.Add($walk) }
}
 $searchDirs.Add((Get-Location).Path)
foreach ($d in $searchDirs) {
    if ((Test-Path -LiteralPath (Join-Path $d 'package.json') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $d 'src') -PathType Container)) {
        $Root = $d
        break
    }
}
if ($null -eq $Root) {
    Write-Host 'ERROR: could not locate the project root (a folder with package.json + src).' -ForegroundColor Red
    Write-Host 'Save this script inside D:\DevCore\Teachers-platform (any subfolder) and run it again.' -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------
# 0c) Warn if the dev server is running (files would be re-read later
#     anyway, but a stopped server avoids half-written module states)
# ---------------------------------------------------------------------
 $devProcs = Get-Process node -ErrorAction SilentlyContinue
if ($devProcs) {
    Write-Host '  [WARN]   a node process is running - if that is "npm run dev",' -ForegroundColor Yellow
    Write-Host '           stop it first (Ctrl+C), then re-run this script.' -ForegroundColor Yellow
}

# ---------------------------------------------------------------------
# 1) Embedded new file contents
# ---------------------------------------------------------------------

 $C_nav = @'
import {
  Award,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Eye,
  GraduationCap,
  Landmark,
  LayoutDashboard,
  MonitorPlay,
  Settings,
  UserCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { NavItem } from "@/lib/types";

/**
 * Central navigation configuration.
 *
 * Every item below resolves to a real, implemented module route
 * (audited against src/app/**). Teacher management lives inside the
 * users directory (roles, statuses, supervisor assignments, school and
 * branch filters) — the dedicated /teachers placeholder route now
 * redirects there, so no duplicate sidebar entry is kept for it.
 *
 * The only intentionally-incomplete module left is "settings", which
 * keeps its honest "قريباً" badge until its phase begins.
 */
export const navItems: NavItem[] = [
  {
    id: "home",
    label: "الرئيسية",
    href: "/",
    description: "نظرة عامة على حالة التنمية المهنية ومؤشرات الأداء الرئيسية.",
    icon: LayoutDashboard,
    plannedFeatures: [],
  },
  {
    id: "academy",
    label: "الأكاديمية التدريبية",
    href: "/academy",
    description: "الدورات التدريبية المنشورة والمتاحة لك — تصفّح، سجّل، وابدأ التعلّم.",
    icon: BookOpen,
    plannedFeatures: [],
  },
  {
    id: "schools",
    label: "المدارس والفروع",
    href: "/schools",
    description: "إدارة المدارس المسجلة في المنصة وفروعها ومراحلها التعليمية.",
    icon: Landmark,
    plannedFeatures: [],
  },
  {
    id: "users",
    label: "دليل المستخدمين",
    href: "/users",
    description: "حسابات المنصة: الأدوار والحالات والإسنادات داخل نطاق صلاحيتك.",
    icon: Users,
    plannedFeatures: [],
  },
  {
    id: "supervision",
    label: "معلموّي",
    href: "/supervision",
    description: "المعلمون المسندون إليك وفروعك المصرّح بها — داخل نطاقك فقط.",
    icon: UserCheck,
    plannedFeatures: [],
  },
  {
    id: "programs",
    label: "البرامج التدريبية",
    href: "/academy/programs",
    description: "البرامج التي تُنظّم الدورات التدريبية — إنشاء ونشر وأرشفة.",
    icon: GraduationCap,
    plannedFeatures: [],
  },
  {
    id: "course-management",
    label: "إدارة الدورات",
    href: "/academy/manage",
    description: "إنشاء الدورات وبناء محتواها ونشرها لجمهورها المصرح له.",
    icon: MonitorPlay,
    plannedFeatures: [],
  },
  {
    id: "assessments",
    label: "الاختبارات والتقييم",
    href: "/assessments",
    description: "اختبارات مرتبطة بالدورات التدريبية — أدِ الاختبار وتابع نتائجك، أو أدر اختبارات مدرستك.",
    icon: ClipboardCheck,
    plannedFeatures: [],
  },
  {
    id: "deputy-overview",
    label: "نطاق اطلاعي",
    href: "/deputy-overview",
    description: "المدارس والفروع الممنوحة لك للاطلاع فقط مع مؤشراتها.",
    icon: Eye,
    plannedFeatures: [],
  },
  {
    id: "assignments",
    label: "التكليفات والمتابعة",
    href: "/assignments",
    description: "التكليفات التربوية والمتابعات المعلقة وحالتها.",
    icon: ClipboardList,
    plannedFeatures: [],
  },
  {
    id: "certificates",
    label: "الشهادات",
    href: "/certificates",
    description: "إصدار الشهادات للمشاركين والتحقق من صحتها.",
    icon: Award,
    plannedFeatures: [],
  },
  {
    id: "reports",
    label: "التقارير",
    href: "/reports",
    description: "تقارير تحليلية عن التدريب والمشاركة وأثرها.",
    icon: BarChart3,
    plannedFeatures: [],
  },
  {
    id: "my-profile",
    label: "ملفي الشخصي",
    href: "/my-profile",
    description: "بيانات حسابك ومدرستك وحالة توثيق بريدك.",
    icon: UserRound,
    plannedFeatures: [],
  },
  {
    id: "settings",
    label: "الإعدادات",
    href: "/settings",
    description: "إعدادات المنصة وهوية المدرسة والصلاحيات.",
    icon: Settings,
    badge: "قريباً",
    plannedFeatures: [
      "تخصيص هوية المدرسة والشعار والمراحل التعليمية",
      "إدارة الصلاحيات والأدوار",
      "الإعدادات العامة للمنصة",
    ],
  },
];

/** Find a nav item by its stable id. */
export function getNavItemId(id: string): NavItem | undefined {
  return navItems.find((item) => item.id === id);
}

/**
 * Route-aware active state for the sidebar/mobile navigation.
 * The dashboard matches exactly; module roots also match their
 * sub-routes (e.g. /schools matches /schools/new and /schools/{id}).
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Single best-matching item id for a pathname: the longest href wins.
 * Prevents double highlighting on nested routes — e.g. inside
 * /academy/manage/12 only "course-management" is active, not its
 * parent "academy" too. Returns null when nothing matches.
 */
export function activeNavItemId(pathname: string, items: NavItem[]): string | null {
  let bestId: string | null = null;
  let bestLength = -1;
  for (const item of items) {
    if (!isNavItemActive(pathname, item.href)) continue;
    if (item.href.length > bestLength) {
      bestId = item.id;
      bestLength = item.href.length;
    }
  }
  return bestId;
}
'@

 $C_sidebar = @'
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Landmark } from "lucide-react";

import { BrandLogo } from "@/components/layout/brand-logo";
import { activeNavItemId } from "@/config/navigation";
import { cn } from "@/lib/utils";
import type { NavItem, PlatformBranding } from "@/lib/types";

interface SidebarProps {
  branding: PlatformBranding;
  items: NavItem[];
  className?: string;
}

/**
 * Desktop application sidebar. Rendered on the inline-start side, which
 * in the RTL layout is the right edge of the screen. Hidden on mobile
 * (the mobile navigation Sheet takes over below lg).
 *
 * Active state uses the longest-href match, so nested routes highlight
 * exactly one item (e.g. /academy/manage/12 highlights "إدارة الدورات"
 * without also highlighting "الأكاديمية التدريبية").
 */
export function Sidebar({ branding, items, className }: SidebarProps) {
  const pathname = usePathname();
  const activeId = activeNavItemId(pathname, items);

  return (
    <aside
      className={cn(
        "hidden lg:flex lg:w-72 lg:shrink-0 lg:flex-col",
        "sticky top-0 h-screen bg-sidebar text-sidebar-foreground",
        className
      )}
    >
      {/* Brand */}
      <div className="flex h-16 items-center border-b border-sidebar-border px-5">
        <BrandLogo branding={branding} variant="sidebar" />
      </div>

      {/* Navigation */}
      <nav
        aria-label="التنقل الرئيسي"
        className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4"
      >
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          القائمة الرئيسية
        </p>
        <ul className="space-y-1" role="list">
          {items.map((item) => {
            const active = item.id === activeId;
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    active
                      ? "bg-gradient-to-l from-brand-600 to-brand-500 text-white shadow-md shadow-brand-900/30"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4.5 shrink-0",
                      active
                        ? "text-white"
                        : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground"
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
      </nav>

      {/* School workspace card — placeholder until tenant config arrives */}
      <div className="border-t border-sidebar-border p-4">
        <div className="rounded-xl bg-white/5 p-3.5 ring-1 ring-white/10">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-white/10">
              <Landmark className="size-4 text-brand-100" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs font-bold text-sidebar-foreground">
                {branding.currentSchool?.name ?? "مساحة عمل المدرسة"}
              </p>
              <p className="text-[11px] text-sidebar-foreground/60">
                تخصيص هوية المدرسة — قريباً
              </p>
            </div>
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-sidebar-foreground/40">
          {branding.productName} · الإصدار 0.2.0
        </p>
      </div>
    </aside>
  );
}
'@

 $C_mobile = @'
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
 * Mobile navigation drawer. Slides from the inline-start edge (right
 * side in RTL) and mirrors the desktop sidebar navigation.
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-80 flex-col bg-sidebar p-0 text-sidebar-foreground [&>button]:text-white/70"
      >
        <SheetHeader className="border-b border-sidebar-border px-5 py-4 text-start">
          <SheetTitle asChild>
            <div>
              <BrandLogo branding={branding} variant="sidebar" />
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">
            قائمة التنقل الرئيسية
          </SheetDescription>
        </SheetHeader>

        <nav aria-label="التنقل الرئيسي" className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1" role="list">
            {items.map((item) => {
              const active = item.id === activeId;
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={() => onOpenChange(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                      active
                        ? "bg-gradient-to-l from-brand-600 to-brand-500 text-white shadow-md shadow-brand-900/30"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="size-4.5 shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
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
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
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
'@

 $C_topbar = @'
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCheck,
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/actions/auth";
import { mockNotifications } from "@/lib/mock-data";
import type {
  AppNotification,
  CurrentUser,
  NavItem,
} from "@/lib/types";

interface TopbarProps {
  user: CurrentUser;
  items: NavItem[];
  onOpenMobileNav: () => void;
}

/**
 * Top application bar: module search, notifications, and user menu.
 * Every visible control performs a real action (navigation, local
 * state change, or an explicit "coming in a later phase" notice) —
 * no dead buttons.
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
  const { toast } = useToast();
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [notificationList, setNotificationList] =
    React.useState<AppNotification[]>(mockNotifications);
  const unreadCount = notificationList.filter((n) => !n.read).length;
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

  function markAllRead() {
    setNotificationList((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const laterPhaseNotice = (feature: string) =>
    toast({
      title: `${feature} — قيد التطوير`,
      description: "هذه الميزة جزء من مرحلة لاحقة من خطة التطوير.",
    });

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-card/85 px-4 backdrop-blur-md sm:gap-3 sm:px-6">
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
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              placeholder="ابحث عن صفحة أو ميزة…"
              className="bg-muted/60 border-transparent ps-10"
              aria-label="البحث في المنصة"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-[min(24rem,90vw)] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <ul className="scrollbar-thin max-h-72 overflow-y-auto p-1.5" role="listbox">
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
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-start transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <Icon className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
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

      {/* Flank (start side): balances the end flank so the search + notifications group stays centered (RTL-safe). */}
      <div className="flex-1" aria-hidden="true" />

      {/* Notifications */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={`الإشعارات${unreadCount > 0 ? ` (${unreadCount} غير مقروءة)` : ""}`}
          >
            <Bell className="size-5" />
            {unreadCount > 0 && (
              <span
                className="absolute end-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-error text-[10px] font-bold text-white"
                aria-hidden="true"
              >
                {unreadCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(22rem,92vw)] p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-bold">الإشعارات</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                <CheckCheck className="size-3.5" aria-hidden="true" />
                تحديد الكل كمقروء
              </button>
            )}
          </div>
          <ul className="scrollbar-thin max-h-80 overflow-y-auto" role="list">
            {notificationList.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                لا توجد إشعارات حالياً
              </li>
            ) : (
              notificationList.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "border-b px-4 py-3 last:border-b-0",
                    !n.read && "bg-brand-50/70"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        n.read ? "bg-muted" : "bg-brand-600"
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug">{n.title}</p>
                      {n.description && (
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {n.description}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground/70">{n.time}</p>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
          <div className="border-t px-4 py-2.5 text-center">
            <span className="text-xs text-muted-foreground">
              بيانات إشعارات تجريبية — الإشعارات الفعلية في مرحلة لاحقة
            </span>
          </div>
        </PopoverContent>
      </Popover>

      {/* يدفع قائمة المستخدم لأقصى شمال الصفحة (نهاية اتجاه RTL) */}
      <div className="flex-1" />

      <Separator orientation="vertical" className="hidden h-8 sm:block" />

      {/* User menu */}      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="قائمة المستخدم"
          >
            <Avatar className="size-9">
              <AvatarFallback className="bg-gradient-to-br from-brand-600 to-brand-800 text-xs font-bold text-white">
                {user.initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden min-w-0 text-start leading-tight sm:block">
              <span className="block truncate text-sm font-bold">{user.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {user.role}
              </span>
            </span>
            <ChevronDown className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>
            <p className="text-sm font-bold">{user.name}</p>
            <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
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
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none transition-colors hover:bg-accent focus:bg-accent"
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
'@

 $C_teachers = @'
import { redirect } from "next/navigation";

/**
 * /teachers — legacy Phase-1 placeholder route.
 *
 * The audit showed the dedicated page rendered only a "قريباً"
 * placeholder while the actual teacher-management capability already
 * lives in the users directory (teacher accounts, professional data,
 * activation/deactivation, supervisor assignments, school/branch
 * filters). Any legacy link or bookmark lands there directly — no
 * duplicate module is created.
 */
export default function TeachersPage() {
  redirect("/users");
}
'@

 $C_programs = @'
import { redirect } from "next/navigation";

/**
 * /programs — legacy Phase-1 placeholder route.
 *
 * The real programs module is implemented at /academy/programs
 * (program manager: create, publish, archive). This keeps any stale
 * link from landing on an outdated "قريباً" screen.
 */
export default function ProgramsPage() {
  redirect("/academy/programs");
}
'@

# ---------------------------------------------------------------------
# 2) Back up current files, then write the new versions
# ---------------------------------------------------------------------
 $Files = [ordered]@{
    'src\config\navigation.ts'            = $C_nav
    'src\components\layout\sidebar.tsx'   = $C_sidebar
    'src\components\layout\mobile-nav.tsx' = $C_mobile
    'src\components\layout\topbar.tsx'    = $C_topbar
    'src\app\teachers\page.tsx'           = $C_teachers
    'src\app\programs\page.tsx'           = $C_programs
}

 $Stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
 $Written = New-Object System.Collections.Generic.List[string]
 $Failed  = $false

Write-Host ''
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ' MANARAT QURTUBAH - NAVIGATION ACTIVATION PATCHER'                        -ForegroundColor Cyan
Write-Host ("   Project root : {0}" -f $Root)
Write-Host ("   Backup stamp : .pre-navfix-{0}.bak" -f $Stamp)
Write-Host '======================================================================' -ForegroundColor Cyan

Write-Host ''
Write-Host '=== STEP 1: backing up and writing files ===' -ForegroundColor Cyan

foreach ($rel in $Files.Keys) {
    $dest    = Join-Path $Root $rel
    $destDir = Split-Path -Parent $dest

    if (-not (Test-Path -LiteralPath $destDir -PathType Container)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    if (Test-Path -LiteralPath $dest -PathType Leaf) {
        $backup = "$dest.pre-navfix-$Stamp.bak"
        Copy-Item -LiteralPath $dest -Destination $backup -Force
        Write-Host ("  [BACKUP] {0}  ->  {1}" -f $rel, (Split-Path -Leaf $backup)) -ForegroundColor DarkCyan
    }
    # UTF-8 (no BOM) - the encoding Next.js/TypeScript expect.
    [System.IO.File]::WriteAllText($dest, $Files[$rel])
    $size = (Get-Item -LiteralPath $dest).Length
    $Written.Add($rel)
    Write-Host ("  [WROTE]  {0}  ({1:N0} bytes)" -f $rel, $size) -ForegroundColor Green
}

# ---------------------------------------------------------------------
# 3) Verify the written content
# ---------------------------------------------------------------------
Write-Host ''
Write-Host '=== STEP 2: verifying the written files ===' -ForegroundColor Cyan

function Check([bool]$Condition, [string]$OkMsg, [string]$FailMsg) {
    if ($Condition) { Write-Host ("  [OK]     " + $OkMsg) -ForegroundColor Green }
    else            { Write-Host ("  [FAIL]   " + $FailMsg) -ForegroundColor Red; $script:Failed = $true }
}

 $nav     = [System.IO.File]::ReadAllText((Join-Path $Root 'src\config\navigation.ts'))
 $side    = [System.IO.File]::ReadAllText((Join-Path $Root 'src\components\layout\sidebar.tsx'))
 $mob     = [System.IO.File]::ReadAllText((Join-Path $Root 'src\components\layout\mobile-nav.tsx'))
 $top     = [System.IO.File]::ReadAllText((Join-Path $Root 'src\components\layout\topbar.tsx'))
 $tPage   = [System.IO.File]::ReadAllText((Join-Path $Root 'src\app\teachers\page.tsx'))
 $pPage   = [System.IO.File]::ReadAllText((Join-Path $Root 'src\app\programs\page.tsx'))

 $badgeCount = ([regex]::Matches($nav, [regex]::Escape('badge: "قريباً"'))).Count

Check ($badgeCount -eq 1)                    'navigation.ts: exactly ONE "قريباً" badge left (الإعدادات only)'
Check (-not $nav.Contains('id: "teachers"')) 'navigation.ts: dead "إدارة المعلمين" entry removed'
Check $nav.Contains('activeNavItemId')       'navigation.ts: single longest-match active-state helper added'
Check $side.Contains('activeNavItemId')      'sidebar.tsx: single-match highlight wired'
Check $mob.Contains('activeNavItemId')       'mobile-nav.tsx: single-match highlight wired'
Check $top.Contains('canSeeSettings')        'topbar.tsx: settings menu entry gated by role'
Check $tPage.Contains('redirect("/users")')  'teachers/page.tsx: redirects to /users'
Check $pPage.Contains('redirect("/academy/programs")') 'programs/page.tsx: redirects to /academy/programs'

if ($Failed) {
    Write-Host ''
    Write-Host 'Verification FAILED - restore the .pre-navfix-*.bak files and send me the output above.' -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------
# 4) Optional production build
# ---------------------------------------------------------------------
if ($Build) {
    Write-Host ''
    Write-Host '=== STEP 3: production build (npm run build) ===' -ForegroundColor Cyan
    Push-Location $Root
    try {
        & npm run build
        if ($LASTEXITCODE -eq 0) {
            Write-Host '  [OK]     production build succeeded' -ForegroundColor Green
        } else {
            Write-Host "  [FAIL]   build exited with code $LASTEXITCODE - send me the full output" -ForegroundColor Red
            exit 1
        }
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------
# 5) Summary + manual test checklist
# ---------------------------------------------------------------------
Write-Host ''
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ' ACTIVATION SUMMARY'                                                          -ForegroundColor Cyan
Write-Host ("   Files written : {0}" -f $Written.Count)
foreach ($w in $Written) { Write-Host ("     - {0}" -f $w) }
Write-Host '   Untouched      : database, seeds, auth logic, roles.ts, package.json'
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host ' WHAT TO CHECK NOW (npm run dev, then hard-refresh Ctrl+Shift+R):' -ForegroundColor Cyan
Write-Host '   1. Sidebar: "قريباً" gone from التكليفات والمتابعة / الشهادات / التقارير.'
Write-Host '      All three open real pages. Only الإعدادات keeps the badge.'
Write-Host '   2. "إدارة المعلمين" is gone from the sidebar; /teachers redirects to /users.'
Write-Host '   3. Open /academy/manage/<any course>: only "إدارة الدورات" is highlighted'
Write-Host '      in the sidebar (no double highlight with الأكاديمية التدريبية).'
Write-Host '   4. Sign in as a TEACHER: no الشهادات management in the sidebar, and no'
Write-Host '      "الإعدادات" entry in the topbar user menu.'
Write-Host '   5. Mobile width: the drawer shows the same active-state behavior.'
Write-Host ''
Write-Host ' To undo: rename every *.pre-navfix-*.bak back over its file.'
Write-Host '======================================================================' -ForegroundColor Cyan
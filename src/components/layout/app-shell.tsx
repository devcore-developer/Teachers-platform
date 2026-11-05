"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { defaultBranding } from "@/config/branding";
import { navItems } from "@/config/navigation";
import type { CurrentUser, NavItem, PlatformBranding } from "@/lib/types";

interface AppShellProps {
  children: React.ReactNode;
  /** Session identity — null for unauthenticated visitors. */
  user: CurrentUser | null;
  /** Module ids allowed for this role, computed on the SERVER. The
   * full items (with icons) are resolved here on the client because
   * icon components cannot cross the RSC serialization boundary. */
  allowedModuleIds: string[];
  /** Resolved identity (platform or the signed-in user's school) —
   * computed on the SERVER from the session. Defaults to the platform
   * identity when not provided (gate screens). */
  branding?: PlatformBranding;
}

const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/forbidden",
];

/**
 * Application shell: RTL sidebar (desktop), sticky topbar with
 * search/notifications/user menu (with real logout), mobile navigation
 * drawer and a sticky footer.
 *
 * Gate screens (login, registration, verification, recovery) render in
 * a minimal bare layout — this is presentation only; every security
 * decision is enforced on the server (middleware + per-page guards).
 */
export function AppShell({ children, user, allowedModuleIds, branding }: AppShellProps) {
  const resolvedBranding = branding ?? defaultBranding;
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const pathname = usePathname();

  const items: NavItem[] = React.useMemo(
    () => navItems.filter((item) => allowedModuleIds.includes(item.id)),
    [allowedModuleIds]
  );

  const canManageBranding = items.some((item) => item.id === "school-branding");

  const isPublicRoute =
    !user || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isPublicRoute) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        branding={resolvedBranding}
        items={items}
        canManageBranding={canManageBranding}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          items={items}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>

        {/* Sticky footer: mt-auto keeps it at the bottom on short pages */}
        <footer className="mt-auto border-t border-border/70 bg-card/70 px-4 py-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-1.5 text-center sm:flex-row sm:text-start">
            <p className="text-xs text-muted-foreground">
              {resolvedBranding.productName} — {resolvedBranding.subtitle}
            </p>
            <p className="text-xs text-muted-foreground/70">
              منارة — مكتب التطوير التربوي © 2025
            </p>
          </div>
        </footer>
      </div>

      <MobileNav
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        branding={resolvedBranding}
        user={user}
        items={items}
      />
    </div>
  );
}
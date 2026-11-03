import "./globals.css";
import type { Metadata } from "next";
import { Cairo } from "next/font/google";

import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { navIdsForRole } from "@/lib/auth/roles";
import type { CurrentUser } from "@/lib/types";

/**
 * Cairo — the platform identity font (Arabic-first typography).
 *
 * next/font/google self-hosts the font files from our own origin
 * (/_next/static/media), which keeps the strict CSP from next.config.ts
 * intact (font-src 'self') — no third-party font CDN is contacted at
 * runtime. The font is exposed as the --font-cairo variable that the
 * design system in globals.css consumes for --font-sans.
 */
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo",
  display: "swap",
});

export const metadata: Metadata = { title: "منارة قرطبة" };

// Every page in this platform is session-driven; rendering is dynamic
// end-to-end (all pages already export force-dynamic themselves).
export const dynamic = "force-dynamic";

/**
 * Avatar initials from the display name — presentation only, no
 * security meaning. First letter of the first and last words:
 * "أحمد محمود" -> "أم", "Sara Ali" -> "SA". Safe fallback for an
 * empty/whitespace name.
 */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "؟";
  const first = [...parts[0]][0] ?? "؟";
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Session identity for the application shell. getCurrentUser() returns
  // null for anonymous/invalid/revoked sessions; AppShell then renders
  // the gate screens (login, registration, verification, recovery) in a
  // bare layout. Module visibility is computed on the SERVER from the
  // session role (navIdsForRole) — the client only receives serializable
  // ids and resolves icons locally.
  const user = await getCurrentUser();

  // Bridge the session projection (SafeUser) to the shell's display type
  // (CurrentUser): `initials` is derived presentation state, computed on
  // the server so the client receives a ready-to-render object.
  const shellUser: CurrentUser | null = user
    ? { ...user, initials: initialsOf(user.name) }
    : null;

  const allowedModuleIds = navIdsForRole(user?.role);

  return (
    <html lang="ar" dir="rtl">
      <body className={`${cairo.variable} font-sans`}>
        <AppShell user={shellUser} allowedModuleIds={allowedModuleIds}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
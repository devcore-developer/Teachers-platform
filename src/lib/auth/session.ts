import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/token";

/* ------------------------------------------------------------------ */
/* Server-side session handling.                                        */
/*                                                                      */
/* The cookie is httpOnly + SameSite=Lax (+ Secure in production) and   */
/* holds a stateless JWT. Every authorization decision re-reads the     */
/* user from the database — role/activation/verification changes apply  */
/* on the very next request. localStorage is never a security boundary. */
/* ------------------------------------------------------------------ */

export { SESSION_COOKIE };

/** Session-safe user projection — passwordHash NEVER leaves this module. */
export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: string;
  schoolId: string | null;
  branchId: string | null;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  tokenVersion: number;
}

/** Issue a session token for the user and set the auth cookie. */
export async function createSessionCookie(
  userId: string,
  tokenVersion: number
): Promise<void> {
  const token = await createSessionToken({ sub: userId, tv: tokenVersion });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Clear the auth cookie (logout). */
export async function destroySessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Resolve the current signed-in user from the session cookie, with all
 * security state re-checked against the database. Returns null for any
 * failure: no cookie, invalid/expired token, unknown user, deactivated
 * account, or stale tokenVersion (revoked sessions).
 *
 * cache() keeps one DB read per request even when several components ask.
 */
export const getCurrentUser = cache(async (): Promise<SafeUser | null> => {
  try {
    const store = await cookies();
    const claims = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
    if (!claims) return null;

    const user = await db.user.findUnique({ where: { id: claims.sub } });
    if (!user || !user.isActive) return null;
    if (user.tokenVersion !== claims.tv) return null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId,
      branchId: user.branchId,
      isActive: user.isActive,
      emailVerifiedAt: user.emailVerifiedAt,
      tokenVersion: user.tokenVersion,
    };
  } catch {
    // A missing AUTH_SECRET or a database hiccup means "not signed in"
    // rather than a crashed page; the provisioning/login flows surface
    // configuration errors explicitly.
    return null;
  }
});

/** Require a signed-in user or redirect to the Arabic login page. */
export async function requireUser(nextPath?: string): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) {
    const query = nextPath
      ? `?next=${encodeURIComponent(sanitizeNextPath(nextPath))}`
      : "";
    redirect(`/login${query}`);
  }
  return user;
}

/** Whitelist internal redirects coming from the ?next= parameter. */
export function sanitizeNextPath(value: string | undefined | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}
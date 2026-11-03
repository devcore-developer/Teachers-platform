import { SignJWT, jwtVerify } from "jose";

/* ------------------------------------------------------------------ */
/* Session token (stateless JWT in an httpOnly cookie).                 */
/*                                                                      */
/* The token carries ONLY the user id and the account's tokenVersion —  */
/* role, activation and verification state are ALWAYS re-read from the  */
/* database on every request (src/lib/auth/session.ts), so revoking or  */
/* deactivating an account takes effect immediately.                    */
/*                                                                      */
/* This module is edge-safe: it uses `jose` (WebCrypto) and touches no  */
/* Node-only or next/headers APIs, so the middleware can verify tokens  */
/* without pulling the database layer into the edge runtime.            */
/* ------------------------------------------------------------------ */

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** Cookie name — defined here (edge-safe) so middleware and session.ts share it. */
export const SESSION_COOKIE = "mq_session";

export interface SessionClaims {
  /** User id. */
  sub: string;
  /** tokenVersion at sign time — mismatch invalidates the session. */
  tv: number;
}

function sessionSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or too short — set a 32+ char random value in .env"
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  claims: SessionClaims,
  expiresAt: Date = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
): Promise<string> {
  return new SignJWT({ tv: claims.tv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(sessionSecret());
}

/**
 * Verify a session token and return its claims, or null for ANY failure
 * (missing token, bad signature, expiry, missing/short AUTH_SECRET).
 * Never throws — callers treat null as "not signed in".
 */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      algorithms: ["HS256"],
    });
    if (!payload.sub || typeof payload.tv !== "number") return null;
    return { sub: payload.sub, tv: payload.tv };
  } catch {
    return null;
  }
}
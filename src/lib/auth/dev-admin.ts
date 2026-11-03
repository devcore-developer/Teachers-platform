import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";

/* ------------------------------------------------------------------ */
/* ADMINISTRATIVE CONTEXT — real, session-backed authorization.         */
/*                                                                      */
/* Phase 2 introduced this seam as a development-only identity; Phase 3 */
/* replaces the implementation with the signed-in session. The call-    */
/* sites (every school-module mutation) did NOT change: they still go   */
/* through requireAdminContext() and re-validate ownership on the       */
/* server, so tenant isolation stays enforced at the data layer.        */
/*                                                                      */
/* Guarantees:                                                          */
/*   1. The actor's identity and school scope come from the DB session, */
/*      never from client-supplied fields.                              */
/*   2. Office managers are structurally confined to their own school   */
/*      (see schoolScopeError). Cross-school writes are rejected.       */
/*   3. Roles outside the administrative pair never receive a context — */
/*      they are redirected to the Arabic forbidden page.               */
/* ------------------------------------------------------------------ */

export type AdminContext =
  | {
      id: string;
      name: string;
      role: "SUPER_ADMIN";
      schoolId: null;
    }
  | {
      id: string;
      name: string;
      role: "DEVELOPMENT_OFFICE_MANAGER";
      schoolId: string;
    };

/**
 * Resolve the signed-in administrative actor or redirect:
 *   - unauthenticated            -> /login
 *   - teacher / supervisor / deputy -> /forbidden
 */
export async function requireAdminContext(): Promise<AdminContext> {
  const user = await requireUser();

  if (user.role === "SUPER_ADMIN") {
    return { id: user.id, name: user.name, role: "SUPER_ADMIN", schoolId: null };
  }

  if (user.role === "DEVELOPMENT_OFFICE_MANAGER" && user.schoolId) {
    return {
      id: user.id,
      name: user.name,
      role: "DEVELOPMENT_OFFICE_MANAGER",
      schoolId: user.schoolId,
    };
  }

  redirect("/forbidden");
}

/**
 * School-scope enforcement for service-layer writes. Returns a
 * ServiceResult-shaped rejection when the actor may not operate on the
 * requested school; null means "allowed".
 *
 *   SUPER_ADMIN                 -> any school
 *   DEVELOPMENT_OFFICE_MANAGER  -> only their own school
 *   anything else               -> never reaches here (no context), but
 *                                  stays denied for defense in depth
 */
export function schoolScopeError(
  ctx: AdminContext,
  schoolId: string
): { ok: false; message: string; code: "FORBIDDEN" } | null {
  if (ctx.role === "SUPER_ADMIN") return null;
  if (ctx.role === "DEVELOPMENT_OFFICE_MANAGER" && ctx.schoolId === schoolId) {
    return null;
  }
  return {
    ok: false,
    message: "ليس لديك صلاحية إدارة بيانات هذه المدرسة — العملية مرفوضة",
    code: "FORBIDDEN",
  };
}
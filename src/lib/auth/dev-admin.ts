import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";

/* ------------------------------------------------------------------ */
/* ADMINISTRATIVE CONTEXT — real, session-backed authorization.         */
/*                                                                      */
/* Guarantees:                                                          */
/*   1. The actor's identity and school scope come from the DB session, */
/*      never from client-supplied fields.                              */
/*   2. School-scoped administrators (office manager + school manager)  */
/*      are structurally confined to their own school.                  */
/*   3. Roles outside the admitted set never receive a context — they   */
/*      are redirected to the Arabic forbidden page.                    */
/*                                                                      */
/* IT_COORDINATOR intentionally does NOT receive an AdminContext: its   */
/* two powers (teacher assignment + account recovery) flow through the  */
/* dedicated requireItCoordinatorContext() seam instead, so a half-     */
/* wired role can never reach the broad administrative services.        */
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
    }
  | {
      id: string;
      name: string;
      role: "SCHOOL_MANAGER";
      schoolId: string;
    };

/** Narrow context for the IT coordinator's two permitted powers only. */
export type ItCoordinatorContext = {
  id: string;
  name: string;
  role: "IT_COORDINATOR";
  schoolId: string;
};

/**
 * Resolve the signed-in administrative actor or redirect:
 *   - unauthenticated                       -> /login
 *   - teacher / supervisor / deputy / IT    -> /forbidden
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

  if (user.role === "SCHOOL_MANAGER" && user.schoolId) {
    return {
      id: user.id,
      name: user.name,
      role: "SCHOOL_MANAGER",
      schoolId: user.schoolId,
    };
  }

  redirect("/forbidden");
}

/**
 * Resolve the signed-in IT coordinator or redirect:
 *   - unauthenticated -> /login
 *   - any other role  -> /forbidden
 */
export async function requireItCoordinatorContext(): Promise<ItCoordinatorContext> {
  const user = await requireUser();

  if (user.role === "IT_COORDINATOR" && user.schoolId) {
    return {
      id: user.id,
      name: user.name,
      role: "IT_COORDINATOR",
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
 *   SCHOOL_MANAGER              -> only their own school
 *
 * SCHOOL_MANAGER is admitted WITH the service-layer boundary update:
 * every consumer of this guard is structurally fenced to
 * `ctx.schoolId === schoolId`, and platform-wide or cross-school
 * operations stay impossible for school-scoped roles.
 */
export function schoolScopeError(
  ctx: AdminContext,
  schoolId: string
): { ok: false; message: string; code: "FORBIDDEN" } | null {
  if (ctx.role === "SUPER_ADMIN") return null;
  if (ctx.role === "DEVELOPMENT_OFFICE_MANAGER" && ctx.schoolId === schoolId) {
    return null;
  }
  if (ctx.role === "SCHOOL_MANAGER" && ctx.schoolId === schoolId) {
    return null;
  }
  return {
    ok: false,
    message: "ليس لديك صلاحية إدارة بيانات هذه المدرسة — العملية مرفوضة",
    code: "FORBIDDEN",
  };
}
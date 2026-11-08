import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";

/* ------------------------------------------------------------------ */
/* ADMINISTRATIVE CONTEXT — real, session-backed authorization.         */
/*                                                                      */
/* The call-sites (every school-module mutation) go through             */
/* requireAdminContext() and re-validate ownership on the server, so    */
/* tenant isolation stays enforced at the data layer.                   */
/*                                                                      */
/* Guarantees:                                                          */
/*   1. The actor's identity and school scope come from the DB session, */
/*      never from client-supplied fields.                              */
/*   2. Office managers AND school managers are structurally confined   */
/*      to their own school (see schoolScopeError). Cross-school        */
/*      writes are rejected.                                            */
/*   3. Roles outside the administrative trio never receive a context — */
/*      they are redirected to the Arabic forbidden page.               */
/*   4. IT_COORDINATOR is deliberately OUTSIDE AdminContext: it has     */
/*      its own narrower context (requireItCoordinatorContext) with     */
/*      exactly two capabilities, so a wide admin context can never     */
/*      leak to it by accident.                                         */
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

/** True when the actor is a school-scoped administrator (not platform). */
export function isSchoolScopedAdmin(
  ctx: AdminContext
): ctx is Extract<AdminContext, { schoolId: string }> {
  return ctx.role !== "SUPER_ADMIN";
}

/**
 * Resolve the signed-in administrative actor or redirect:
 *   - unauthenticated                                -> /login
 *   - teacher / supervisor / deputy / IT coordinator -> /forbidden
 */
export async function requireAdminContext(): Promise<AdminContext> {
  const user = await requireUser();

  if (user.role === "SUPER_ADMIN") {
    return { id: user.id, name: user.name, role: "SUPER_ADMIN", schoolId: null };
  }

  if (
    (user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
      user.role === "SCHOOL_MANAGER") &&
    user.schoolId
  ) {
    return {
      id: user.id,
      name: user.name,
      role: user.role,
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
 *   anything else               -> never reaches here (no context), but
 *                                  stays denied for defense in depth
 */
export function schoolScopeError(
  ctx: AdminContext,
  schoolId: string
): { ok: false; message: string; code: "FORBIDDEN" } | null {
  if (ctx.role === "SUPER_ADMIN") return null;
  if (
    (ctx.role === "DEVELOPMENT_OFFICE_MANAGER" ||
      ctx.role === "SCHOOL_MANAGER") &&
    ctx.schoolId === schoolId
  ) {
    return null;
  }
  return {
    ok: false,
    message: "ليس لديك صلاحية إدارة بيانات هذه المدرسة — العملية مرفوضة",
    code: "FORBIDDEN",
  };
}

/* ------------------------------------------------------------------ */
/* IT_COORDINATOR context — deliberately narrow                         */
/* ------------------------------------------------------------------ */

/**
 * The IT coordinator context carries ONLY what its two capabilities
 * need: identity + own school. It is a separate type on purpose —
 * passing it where an AdminContext is required is a compile error, and
 * no admin service accepts it.
 */
export interface ItCoordinatorContext {
  id: string;
  name: string;
  role: "IT_COORDINATOR";
  schoolId: string;
}

/**
 * Resolve the signed-in IT coordinator or redirect:
 *   - unauthenticated            -> /login
 *   - any other role             -> /forbidden
 *   - IT coordinator without a school (data anomaly) -> /forbidden
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

/* ------------------------------------------------------------------ */
/* EDUCATIONAL_SUPERVISOR training context — deliberately scoped        */
/* ------------------------------------------------------------------ */

/**
 * The supervisor training context carries ONLY what the training
 * management surfaces need: identity + own school. It is a separate
 * type on purpose — it never satisfies `AdminContext`, so no generic
 * admin page can accidentally accept it. Tenant scope is structural:
 * the supervisor's schoolId comes from the DB session, and every
 * service write re-checks the record's schoolId against it.
 */
export interface SupervisorTrainingContext {
  id: string;
  name: string;
  role: "EDUCATIONAL_SUPERVISOR";
  schoolId: string;
}

/**
 * Resolve the signed-in educational supervisor or redirect:
 *   - unauthenticated                          -> /login
 *   - any other role                           -> /forbidden
 *   - supervisor without a school (data anomaly) -> /forbidden
 */
export async function requireSupervisorContext(): Promise<SupervisorTrainingContext> {
  const user = await requireUser();

  if (user.role === "EDUCATIONAL_SUPERVISOR" && user.schoolId) {
    return {
      id: user.id,
      name: user.name,
      role: "EDUCATIONAL_SUPERVISOR",
      schoolId: user.schoolId,
    };
  }

  redirect("/forbidden");
}
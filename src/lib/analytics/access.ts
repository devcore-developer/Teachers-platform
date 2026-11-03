/**
 * Phase 10 — pure access predicates and tenant scoping for role-based
 * dashboards, analytics, the report center and the archive center.
 *
 * No DB access lives here — every rule is unit-testable and the service
 * layer composes these helpers. The actor is ALWAYS built server-side
 * from the session user; client payloads can never widen it.
 *
 * Role capability matrix (fixed by the product, enforced server-side):
 *   SUPER_ADMIN                — platform-wide aggregates + read-only
 *                                school reports (school must be chosen
 *                                explicitly). Never operational writes
 *                                on school-owned records; archive/
 *                                restore are school roles' work.
 *   DEVELOPMENT_OFFICE_MANAGER — full school dashboard, reports, exports,
 *                                archive/restore inside OWN school.
 *   EDUCATIONAL_DEPUTY         — READ-ONLY dashboards/reports/archives
 *                                for granted schools/branches.
 *   EDUCATIONAL_SUPERVISOR     — dashboards/reports restricted to
 *                                assigned teachers + granted branches.
 *   TEACHER                    — personal dashboard only; never other
 *                                teachers' records or school-wide data.
 */
import { db } from "@/lib/db";
import { DEPUTY_SCHOOLS_LIMIT } from "@/config/analytics";

/* ------------------------------------------------------------------ */
/* Result contract (mirrors the assignment/certificate/survey layers)   */
/* ------------------------------------------------------------------ */

export type AnalyticsErrorCode = "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND";

export type AnalyticsResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: AnalyticsErrorCode };

export function analyticsFail(
  message: string,
  code: AnalyticsErrorCode
): { ok: false; message: string; code: AnalyticsErrorCode } {
  return { ok: false, message, code };
}

/* ------------------------------------------------------------------ */
/* Actor identity                                                       */
/* ------------------------------------------------------------------ */

export type AnalyticsRole =
  | "SUPER_ADMIN"
  | "DEVELOPMENT_OFFICE_MANAGER"
  | "EDUCATIONAL_DEPUTY"
  | "EDUCATIONAL_SUPERVISOR"
  | "TEACHER";

export interface AnalyticsActor {
  id: string;
  name?: string;
  role: AnalyticsRole;
  schoolId: string | null;
  branchId: string | null;
}

/** Server-side projection of the session user (never client-built). */
export function toAnalyticsActor(user: {
  id: string;
  name?: string;
  role: string;
  schoolId: string | null;
  branchId: string | null;
}): AnalyticsActor | null {
  if (
    user.role === "SUPER_ADMIN" ||
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    user.role === "EDUCATIONAL_DEPUTY" ||
    user.role === "EDUCATIONAL_SUPERVISOR" ||
    user.role === "TEACHER"
  ) {
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      schoolId: user.schoolId,
      branchId: user.branchId,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Capability predicates                                                */
/* ------------------------------------------------------------------ */

export function canViewPlatformDashboard(role: string): boolean {
  return role === "SUPER_ADMIN";
}

/** School-scoped dashboards/reports: the three school back-office roles. */
export function canViewSchoolDashboard(role: string): boolean {
  return (
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "EDUCATIONAL_DEPUTY" ||
    role === "EDUCATIONAL_SUPERVISOR"
  );
}

/** Archive center visibility (view lists): school roles + platform. */
export function canViewArchive(role: string): boolean {
  return (
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "EDUCATIONAL_DEPUTY" ||
    role === "EDUCATIONAL_SUPERVISOR" ||
    role === "SUPER_ADMIN"
  );
}

/** Archive/restore mutations are school-operational: manager + supervisor
 * (supervisor only for follow-ups of covered teachers). SUPER_ADMIN and
 * deputies never archive or restore school records. */
export function canOperateArchive(role: string): boolean {
  return role === "DEVELOPMENT_OFFICE_MANAGER" || role === "EDUCATIONAL_SUPERVISOR";
}

/** Export endpoints reuse the report permission — explicit for clarity. */
export function canExportReports(role: string): boolean {
  return (
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "EDUCATIONAL_DEPUTY" ||
    role === "EDUCATIONAL_SUPERVISOR" ||
    role === "SUPER_ADMIN"
  );
}

/* ------------------------------------------------------------------ */
/* Failure guards                                                       */
/* ------------------------------------------------------------------ */

export function platformGuard(actor: AnalyticsActor): AnalyticsResult<never> | null {
  if (actor.role !== "SUPER_ADMIN") {
    return analyticsFail("لوحة المنصة متاحة لمدير النظام فقط", "FORBIDDEN");
  }
  return null;
}

/**
 * Resolves the schools an actor may read school-scoped data for.
 * SUPER_ADMIN is intentionally rejected here — platform roles use the
 * platform dashboard, and school reports require an explicit school
 * filter validated separately.
 */
export async function resolveReadableSchoolIds(
  actor: AnalyticsActor
): Promise<AnalyticsResult<string[]>> {
  if (actor.role === "DEVELOPMENT_OFFICE_MANAGER" || actor.role === "EDUCATIONAL_SUPERVISOR") {
    if (!actor.schoolId) {
      return analyticsFail("حسابك غير مرتبط بمدرسة", "FORBIDDEN");
    }
    return { ok: true, data: [actor.schoolId] };
  }
  if (actor.role === "EDUCATIONAL_DEPUTY") {
    const grants = await db.deputyGrant.findMany({
      where: { userId: actor.id },
      select: { schoolId: true },
    });
    const schoolIds = Array.from(new Set(grants.map((grant) => grant.schoolId)));
    if (schoolIds.length === 0) {
      return analyticsFail("لا توجد مدارس ضمن نطاق تفويضك", "FORBIDDEN");
    }
    return { ok: true, data: schoolIds };
  }
  return analyticsFail("غير مصرح بالوصول إلى بيانات المدارس", "FORBIDDEN");
}

/**
 * Supervisor coverage inside one school: explicit teacher assignments
 * UNION branch grants — the same union the growth service uses.
 * Returns teacher ids (empty = no coverage) plus branch ids.
 */
export async function supervisorCoverage(
  actor: AnalyticsActor,
  schoolId: string
): Promise<AnalyticsResult<{ teacherIds: string[]; branchIds: string[] }>> {
  if (actor.role !== "EDUCATIONAL_SUPERVISOR") {
    return analyticsFail("هذا النطاق متاح للمشرفين التربويين فقط", "FORBIDDEN");
  }
  if (!actor.schoolId || actor.schoolId !== schoolId) {
    return analyticsFail("النطاق المدرسي مختلف", "FORBIDDEN");
  }
  const [assigned, branchGrants] = await Promise.all([
    db.teacherSupervisorAssignment.findMany({
      where: { supervisorId: actor.id, schoolId },
      select: { teacherId: true },
    }),
    db.supervisorAssignment.findMany({
      where: { supervisorId: actor.id, schoolId },
      select: { branchId: true },
    }),
  ]);
  return {
    ok: true,
    data: {
      teacherIds: Array.from(new Set(assigned.map((row) => row.teacherId))),
      branchIds: Array.from(new Set(branchGrants.map((row) => row.branchId))),
    },
  };
}

/**
 * Teachers visible to an actor inside one school (the denominator of
 * every "teacher participation" metric):
 *   manager → all active school teachers
 *   deputy  → active teachers covered by grants (school-wide or branch)
 *   supervisor → assigned teachers + teachers of granted branches
 */
export async function visibleTeacherIds(
  actor: AnalyticsActor,
  schoolId: string
): Promise<AnalyticsResult<string[]>> {
  if (actor.role === "DEVELOPMENT_OFFICE_MANAGER") {
    if (!actor.schoolId || actor.schoolId !== schoolId) {
      return analyticsFail("النطاق المدرسي مختلف", "FORBIDDEN");
    }
    const teachers = await db.user.findMany({
      where: { schoolId, role: "TEACHER", isActive: true },
      select: { id: true },
    });
    return { ok: true, data: teachers.map((teacher) => teacher.id) };
  }
  if (actor.role === "EDUCATIONAL_SUPERVISOR") {
    const coverage = await supervisorCoverage(actor, schoolId);
    if (!coverage.ok) return coverage;
    const { teacherIds, branchIds } = coverage.data;
    const branchTeachers =
      branchIds.length > 0
        ? await db.user.findMany({
            where: { schoolId, role: "TEACHER", isActive: true, branchId: { in: branchIds } },
            select: { id: true },
          })
        : [];
    return {
      ok: true,
      data: Array.from(new Set([...teacherIds, ...branchTeachers.map((row) => row.id)])),
    };
  }
  if (actor.role === "EDUCATIONAL_DEPUTY") {
    const grants = await db.deputyGrant.findMany({
      where: { userId: actor.id, schoolId },
      select: { branchId: true },
    });
    if (grants.length === 0) {
      return analyticsFail("لا يوجد تفويض على هذه المدرسة", "FORBIDDEN");
    }
    if (grants.some((grant) => grant.branchId === null)) {
      const teachers = await db.user.findMany({
        where: { schoolId, role: "TEACHER", isActive: true },
        select: { id: true },
      });
      return { ok: true, data: teachers.map((teacher) => teacher.id) };
    }
    const branchIds = grants
      .map((grant) => grant.branchId)
      .filter((branchId): branchId is string => branchId !== null);
    const teachers = await db.user.findMany({
      where: { schoolId, role: "TEACHER", isActive: true, branchId: { in: branchIds } },
      select: { id: true },
    });
    return { ok: true, data: teachers.map((teacher) => teacher.id) };
  }
  if (actor.role === "SUPER_ADMIN") {
    // Read-only platform role: school reports may enumerate the school's
    // active teachers (the same read-only allowance as Phase 8 records).
    const teachers = await db.user.findMany({
      where: { schoolId, role: "TEACHER", isActive: true },
      select: { id: true },
    });
    return { ok: true, data: teachers.map((teacher) => teacher.id) };
  }
  return analyticsFail("غير مصرح بالوصول إلى قوائم المعلمين", "FORBIDDEN");
}

/** Deputy school list for the grants dashboard (capped, stable order). */
export async function deputySchoolIds(actor: AnalyticsActor): Promise<string[]> {
  if (actor.role !== "EDUCATIONAL_DEPUTY") return [];
  const grants = await db.deputyGrant.findMany({
    where: { userId: actor.id },
    select: { schoolId: true },
  });
  return Array.from(new Set(grants.map((grant) => grant.schoolId))).slice(
    0,
    DEPUTY_SCHOOLS_LIMIT
  );
}
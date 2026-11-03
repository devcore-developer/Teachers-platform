import { Prisma } from "@prisma/client";

import {
  requireAdminContext,
  schoolScopeError,
  type AdminContext,
} from "@/lib/auth/dev-admin";
import { db } from "@/lib/db";
import {
  createBranchSchema,
  createSchoolSchema,
  normalizeName,
  resolveSlug,
  updateBranchSchema,
  updateSchoolSchema,
  zodFieldErrors,
  type ServiceResult,
} from "@/lib/validation/schools";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type SchoolWithBranchCount = Prisma.SchoolGetPayload<{
  include: { _count: { select: { branches: true } } };
}>;

export type SchoolDetail = Prisma.SchoolGetPayload<{
  include: { branches: true };
}>;

export interface SchoolsMetrics {
  totalSchools: number;
  activeSchools: number;
  inactiveSchools: number;
  totalBranches: number;
}

/* ------------------------------------------------------------------ */
/* Queries (read-side)                                                 */
/* ------------------------------------------------------------------ */

/** All schools with their branch counts, newest first. */
export async function listSchools(): Promise<SchoolWithBranchCount[]> {
  return db.school.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { branches: true } } },
  });
}

/** One school with its branches — or null when the id does not exist. */
export async function getSchoolDetail(id: string): Promise<SchoolDetail | null> {
  if (!id) return null;
  return db.school.findUnique({
    where: { id },
    include: { branches: { orderBy: { createdAt: "asc" } } },
  });
}

/** Platform-level school & branch metrics computed from persisted data. */
export async function getSchoolsMetrics(): Promise<SchoolsMetrics> {
  const [totalSchools, activeSchools, totalBranches] = await Promise.all([
    db.school.count(),
    db.school.count({ where: { isActive: true } }),
    db.branch.count(),
  ]);

  return {
    totalSchools,
    activeSchools,
    inactiveSchools: totalSchools - activeSchools,
    totalBranches,
  };
}

/** Branch metrics scoped to ONE school — office-manager dashboard. */
export async function getSchoolMetricsForSchool(
  schoolId: string
): Promise<{
  schoolName: string;
  totalBranches: number;
  activeBranches: number;
  inactiveBranches: number;
  teachersCount: number;
} | null> {
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) return null;

  const [totalBranches, activeBranches, teachersCount] = await Promise.all([
    db.branch.count({ where: { schoolId } }),
    db.branch.count({ where: { schoolId, isActive: true } }),
    db.user.count({ where: { schoolId, role: "TEACHER" } }),
  ]);

  return {
    schoolName: school.nameAr,
    totalBranches,
    activeBranches,
    inactiveBranches: totalBranches - activeBranches,
    teachersCount,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations (write-side) — every write requires the admin context     */
/* and re-validates ownership on the server. No client-trusted ids.    */
/* ------------------------------------------------------------------ */

function handleUniqueViolation(error: unknown): ServiceResult<never> | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target)
      ? error.meta.target.join(",")
      : String(error.meta?.target ?? "");
    if (target.includes("slug")) {
      return {
        ok: false,
        message: "الرابط المختصر مستخدم بالفعل لمدرسة أخرى — اختر رابطًا مختلفًا",
        fieldErrors: { slug: "الرابط المختصر مستخدم بالفعل" },
        code: "DUPLICATE_SLUG",
      };
    }
    if (target.includes("nameNorm")) {
      return {
        ok: false,
        message: "يوجد فرع بنفس الاسم في هذه المدرسة بالفعل",
        fieldErrors: { nameAr: "اسم الفرع مستخدم بالفعل في هذه المدرسة" },
        code: "DUPLICATE_BRANCH",
      };
    }
  }
  return null;
}

/* ----------------------------- Schools ---------------------------- */

export async function createSchool(
  raw: unknown,
  actor?: AdminContext
): Promise<ServiceResult<SchoolWithBranchCount>> {
  const ctx = actor ?? (await requireAdminContext());
  if (ctx.role !== "SUPER_ADMIN") {
    return {
      ok: false,
      message: "إنشاء المدارس متاح لمدير المنصة فقط",
      code: "FORBIDDEN",
    };
  }

  const parsed = createSchoolSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  const input = parsed.data;
  const slug = resolveSlug(input.slug, input.nameEn);

  try {
    const school = await db.school.create({
      data: {
        nameAr: input.nameAr,
        nameEn: input.nameEn ?? null,
        slug,
        logoUrl: input.logoUrl ?? null,
        brandColor: input.brandColor ?? "#1D5BD6",
        isActive: input.isActive,
      },
      include: { _count: { select: { branches: true } } },
    });
    return { ok: true, data: school };
  } catch (error) {
    const unique = handleUniqueViolation(error);
    if (unique) return unique;
    return { ok: false, message: "تعذر إنشاء المدرسة — حدث خطأ غير متوقع" };
  }
}

export async function updateSchool(
  raw: unknown,
  actor?: AdminContext
): Promise<ServiceResult<SchoolWithBranchCount>> {
  const ctx = actor ?? (await requireAdminContext());
  if (ctx.role !== "SUPER_ADMIN") {
    return {
      ok: false,
      message: "تعديل بيانات المدرسة متاح لمدير المنصة فقط",
      code: "FORBIDDEN",
    };
  }

  const parsed = updateSchoolSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  const input = parsed.data;
  const existing = await db.school.findUnique({ where: { id: input.id } });
  if (!existing) {
    return { ok: false, message: "المدرسة غير موجودة", code: "NOT_FOUND" };
  }

  // Keep the existing slug when the field is left empty.
  const slug = input.slug ? input.slug : existing.slug;

  try {
    const school = await db.school.update({
      where: { id: input.id },
      data: {
        nameAr: input.nameAr,
        nameEn: input.nameEn ?? null,
        slug,
        logoUrl: input.logoUrl ?? null,
        brandColor: input.brandColor ?? "#1D5BD6",
      },
      include: { _count: { select: { branches: true } } },
    });
    return { ok: true, data: school };
  } catch (error) {
    const unique = handleUniqueViolation(error);
    if (unique) return unique;
    return { ok: false, message: "تعذر تحديث بيانات المدرسة — حدث خطأ غير متوقع" };
  }
}

/**
 * Deactivate/activate a school. Permanent deletion is intentionally not
 * offered: schools may own branches (and, in later phases, teachers,
 * programs and certificates) — deactivation preserves history and
 * referential integrity.
 */
export async function setSchoolActive(
  schoolId: string,
  isActive: boolean,
  actor?: AdminContext
): Promise<ServiceResult<SchoolWithBranchCount>> {
  const ctx = actor ?? (await requireAdminContext());
  if (ctx.role !== "SUPER_ADMIN") {
    return {
      ok: false,
      message: "تغيير حالة المدرسة متاح لمدير المنصة فقط",
      code: "FORBIDDEN",
    };
  }

  if (!schoolId) {
    return { ok: false, message: "معرّف المدرسة مطلوب", code: "VALIDATION_ERROR" };
  }

  try {
    const school = await db.school.update({
      where: { id: schoolId },
      data: { isActive },
      include: { _count: { select: { branches: true } } },
    });
    return { ok: true, data: school };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { ok: false, message: "المدرسة غير موجودة", code: "NOT_FOUND" };
    }
    return { ok: false, message: "تعذر تغيير حالة المدرسة — حدث خطأ غير متوقع" };
  }
}

/* ----------------------------- Branches --------------------------- */

/**
 * Create a branch. The school must exist (never trust a client-provided
 * school id) and the branch name must be unique within that school.
 */
export async function createBranch(
  raw: unknown,
  actor?: AdminContext
): Promise<ServiceResult<Prisma.BranchGetPayload<{ include: { school: true } }>>>
{
  const ctx = actor ?? (await requireAdminContext());

  const parsed = createBranchSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  const input = parsed.data;

  // Tenant isolation: office managers may only manage their own school.
  const scope = schoolScopeError(ctx, input.schoolId);
  if (scope) return scope;

  const school = await db.school.findUnique({ where: { id: input.schoolId } });
  if (!school) {
    return {
      ok: false,
      message: "المدرسة المحددة غير موجودة — لا يمكن إنشاء فرع لمدرسة غير موجودة",
      code: "RELATION_ERROR",
    };
  }

  const nameNorm = normalizeName(input.nameAr);
  const duplicate = await db.branch.findFirst({
    where: { schoolId: input.schoolId, nameNorm },
  });
  if (duplicate) {
    return {
      ok: false,
      message: "يوجد فرع بنفس الاسم في هذه المدرسة بالفعل",
      fieldErrors: { nameAr: "اسم الفرع مستخدم بالفعل في هذه المدرسة" },
      code: "DUPLICATE_BRANCH",
    };
  }

  try {
    const branch = await db.branch.create({
      data: {
        schoolId: input.schoolId,
        nameAr: input.nameAr,
        nameEn: input.nameEn ?? null,
        nameNorm,
        stage: input.stage,
        isActive: input.isActive,
      },
      include: { school: true },
    });
    return { ok: true, data: branch };
  } catch (error) {
    const unique = handleUniqueViolation(error);
    if (unique) return unique;
    return { ok: false, message: "تعذر إنشاء الفرع — حدث خطأ غير متوقع" };
  }
}

/**
 * Update a branch. Validates that the branch exists AND belongs to the
 * school passed by the caller — cross-school access is rejected with an
 * explicit error, never silently scoped.
 */
export async function updateBranch(
  raw: unknown,
  actor?: AdminContext
): Promise<ServiceResult<Prisma.BranchGetPayload<{ include: { school: true } }>>> {
  const ctx = actor ?? (await requireAdminContext());

  const parsed = updateBranchSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  const input = parsed.data;

  // Tenant isolation: cross-school branch access is rejected here even
  // if the (schoolId, branchId) pair happens to be consistent.
  const scope = schoolScopeError(ctx, input.schoolId);
  if (scope) return scope;

  const branch = await db.branch.findUnique({ where: { id: input.branchId } });
  if (!branch) {
    return { ok: false, message: "الفرع غير موجود", code: "NOT_FOUND" };
  }
  if (branch.schoolId !== input.schoolId) {
    return {
      ok: false,
      message: "الفرع لا ينتمي إلى هذه المدرسة — تم رفض العملية",
      code: "RELATION_ERROR",
    };
  }

  const nameNorm = normalizeName(input.nameAr);
  const duplicate = await db.branch.findFirst({
    where: { schoolId: input.schoolId, nameNorm, id: { not: input.branchId } },
  });
  if (duplicate) {
    return {
      ok: false,
      message: "يوجد فرع بنفس الاسم في هذه المدرسة بالفعل",
      fieldErrors: { nameAr: "اسم الفرع مستخدم بالفعل في هذه المدرسة" },
      code: "DUPLICATE_BRANCH",
    };
  }

  try {
    const updated = await db.branch.update({
      where: { id: input.branchId },
      data: {
        nameAr: input.nameAr,
        nameEn: input.nameEn ?? null,
        nameNorm,
        stage: input.stage,
      },
      include: { school: true },
    });
    return { ok: true, data: updated };
  } catch (error) {
    const unique = handleUniqueViolation(error);
    if (unique) return unique;
    return { ok: false, message: "تعذر تحديث الفرع — حدث خطأ غير متوقع" };
  }
}

/**
 * Activate/deactivate a branch with full school-ownership validation —
 * the same cross-school guard as updateBranch.
 */
export async function setBranchActive(
  schoolId: string,
  branchId: string,
  isActive: boolean,
  actor?: AdminContext
): Promise<ServiceResult<Prisma.BranchGetPayload<{ include: { school: true } }>>> {
  const ctx = actor ?? (await requireAdminContext());

  if (!schoolId || !branchId) {
    return {
      ok: false,
      message: "معرّفا المدرسة والفرع مطلوبان",
      code: "VALIDATION_ERROR",
    };
  }

  const scope = schoolScopeError(ctx, schoolId);
  if (scope) return scope;

  const branch = await db.branch.findUnique({ where: { id: branchId } });
  if (!branch) {
    return { ok: false, message: "الفرع غير موجود", code: "NOT_FOUND" };
  }
  if (branch.schoolId !== schoolId) {
    return {
      ok: false,
      message: "الفرع لا ينتمي إلى هذه المدرسة — تم رفض العملية",
      code: "RELATION_ERROR",
    };
  }

  const updated = await db.branch.update({
    where: { id: branchId },
    data: { isActive },
    include: { school: true },
  });
  return { ok: true, data: updated };
}
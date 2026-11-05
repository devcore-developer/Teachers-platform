import { Prisma } from "@prisma/client";

import type { AdminContext, ItCoordinatorContext } from "@/lib/auth/dev-admin";
import { hashPassword } from "@/lib/auth/password";
import { issueEmailVerificationToken, issuePasswordResetToken } from "@/lib/auth/one-time-tokens";
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
  defaultMailSender,
  type MailSender,
} from "@/lib/mail/mailer";
import { normalizeEmail } from "@/lib/validation/auth";
import { db } from "@/lib/db";
import { formatDateLabel } from "@/lib/schools/dto";
import {
  adminProfileUpdateSchema,
  CREATABLE_ROLES_BY_ACTOR,
  deputyScopeSchema,
  directoryQuerySchema,
  removeTeacherSupervisorSchema,
  staffAccountSchema,
  supervisorBranchesSchema,
  teacherRecoverySchema,
  teacherSupervisorSchema,
  USERS_PAGE_SIZE,
  zodUsersFieldErrors,
  type UsersServiceResult,
} from "@/lib/validation/users";

/* ------------------------------------------------------------------ */
/* User directory, assignments & account management service.            */
/*                                                                      */
/* Every authorization rule lives HERE (server-side), never in forms:   */
/*   - school-scoped administrators (office manager + school manager)   */
/*     are structurally confined to their own school;                   */
/*   - no input can create or promote to SUPER_ADMIN;                   */
/*   - the IT coordinator has exactly two powers (teacher assignment    */
/*     + account recovery), always inside their own school;             */
/*   - cross-school relationships are rejected explicitly;              */
/*   - multi-row changes run inside transactions;                       */
/*   - password hashes / tokens never leave this layer.                 */
/* ------------------------------------------------------------------ */

/* ------------------------------ Types ----------------------------- */

export interface DirectoryUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  schoolName: string | null;
  branchName: string | null;
  createdAtLabel: string;
  /** Arabic date label or null when the account never signed in. */
  lastLoginLabel: string | null;
}

export interface UserDirectoryResult {
  rows: DirectoryUserRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export interface UserDetailView {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  school: { id: string; nameAr: string } | null;
  branch: { id: string; nameAr: string } | null;
  createdAtLabel: string;
  lastLoginLabel: string | null;
  /** TEACHER only: current supervisor, if explicitly assigned. */
  supervisor: { id: string; name: string } | null;
  /** EDUCATIONAL_SUPERVISOR only: authorized branch scope. */
  supervisorBranches: { id: string; nameAr: string; stage: string }[];
  /** EDUCATIONAL_DEPUTY only: explicit read grants. */
  deputyGrants: { id: string; branchId: string | null; branchName: string | null }[];
}

export interface SupervisorWorkspace {
  branches: { id: string; nameAr: string; stage: string }[];
  teachers: {
    id: string;
    name: string;
    email: string;
    branchName: string | null;
    /** "explicit" = direct assignment; "branch" = via branch coverage. */
    source: "explicit" | "branch";
    isVerified: boolean;
  }[];
}

export interface DeputyOverview {
  grants: { id: string; schoolId: string; branchId: string | null }[];
  schools: {
    id: string;
    nameAr: string;
    branches: {
      id: string;
      nameAr: string;
      stage: string;
      isActive: boolean;
      teachersCount: number;
    }[];
  }[];
}

export interface OwnProfileView {
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  school: { id: string; nameAr: string } | null;
  branch: { id: string; nameAr: string } | null;
  /** TEACHER only. */
  supervisor: { id: string; name: string } | null;
  createdAtLabel: string;
  lastLoginLabel: string | null;
}

/* --------------------------- IT workspace -------------------------- */

export interface ItWorkspaceTeacher {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  isVerified: boolean;
  branchName: string | null;
  supervisor: { id: string; name: string } | null;
}

export interface ItWorkspaceSupervisor {
  id: string;
  name: string;
  /** Teachers currently assigned to this supervisor (same school). */
  assignedCount: number;
}

export interface ItWorkspaceData {
  school: { id: string; nameAr: string };
  stats: {
    teachersTotal: number;
    activeTeachers: number;
    supervisorsTotal: number;
    assignedTeachers: number;
    unassignedTeachers: number;
  };
  supervisors: ItWorkspaceSupervisor[];
  teachers: ItWorkspaceTeacher[];
}

export interface TeacherRecoveryOutcome {
  teacherName: string;
  teacherEmail: string;
  emailSent: boolean;
}

const dateTimeLabel = new Intl.DateTimeFormat("ar-EG", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function lastLoginLabel(date: Date | null): string | null {
  return date ? dateTimeLabel.format(date) : null;
}

function relationError(
  message: string,
  fieldErrors?: Record<string, string>
): UsersServiceResult<never> {
  return { ok: false, message, fieldErrors, code: "RELATION_ERROR" };
}

/**
 * Defense in depth: administrative mutations require an administrative
 * role. In production the server action already redirects other roles
 * via requireAdminContext — this gate keeps the SERVICE safe even when
 * called with a deputy/supervisor/teacher/IT context.
 */
function adminActorError(actor: AdminContext): UsersServiceResult<never> | null {
  if (
    actor.role === "SUPER_ADMIN" ||
    actor.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    actor.role === "SCHOOL_MANAGER"
  ) {
    return null;
  }
  return {
    ok: false,
    message: "غير مصرح لك بهذه العملية الإدارية — العملية مرفوضة",
    code: "FORBIDDEN",
  };
}

/** The two school-scoped administrators — always confined to own school. */
function isSchoolScopedAdmin(
  actor: AdminContext
): actor is Extract<AdminContext, { schoolId: string }> {
  return (
    actor.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    actor.role === "SCHOOL_MANAGER"
  );
}

/* ------------------------------------------------------------------ */
/* Directory (read-side)                                                */
/* ------------------------------------------------------------------ */

/**
 * Role-scoped, filterable, paginated user directory.
 *   - SUPER_ADMIN: platform-wide, optional school filter;
 *   - DEVELOPMENT_OFFICE_MANAGER / SCHOOL_MANAGER: forced to their OWN
 *     school — a client-supplied schoolId filter is IGNORED.
 * A tampered branchId simply yields zero rows (the forced school scope
 * stays in the WHERE clause) — no data leaks, no errors to probe with.
 */
export async function listUsersForDirectory(
  actor: AdminContext,
  rawQuery: unknown
): Promise<UsersServiceResult<UserDirectoryResult>> {
  const parsed = directoryQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return {
      ok: false,
      message: "معايير التصفية غير صالحة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const query = parsed.data;

  const effectiveSchoolId = isSchoolScopedAdmin(actor)
    ? actor.schoolId // forced — never from the client
    : query.schoolId;

  const where: Prisma.UserWhereInput = {
    ...(effectiveSchoolId ? { schoolId: effectiveSchoolId } : {}),
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { isActive: query.status === "ACTIVE" } : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q } },
            { email: { contains: query.q.toLowerCase() } },
          ],
        }
      : {}),
  };

  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      include: {
        school: { select: { id: true, nameAr: true } },
        branch: { select: { id: true, nameAr: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * USERS_PAGE_SIZE,
      take: USERS_PAGE_SIZE,
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));

  return {
    ok: true,
    data: {
      rows: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        isVerified: user.emailVerifiedAt !== null,
        schoolName: user.school?.nameAr ?? null,
        branchName: user.branch?.nameAr ?? null,
        createdAtLabel: formatDateLabel(user.createdAt),
        lastLoginLabel: lastLoginLabel(user.lastLoginAt),
      })),
      total,
      page: Math.min(query.page, pageCount),
      pageCount,
      pageSize: USERS_PAGE_SIZE,
    },
  };
}

/**
 * Full detail for the management view. School-scoped administrators may
 * only view users of their own school (SUPER_ADMIN rows are school-less
 * and are therefore structurally out of their reach).
 */
export async function getUserDetailForAdmin(
  actor: AdminContext,
  userId: string
): Promise<UsersServiceResult<UserDetailView>> {
  if (!userId) {
    return { ok: false, message: "معرّف المستخدم مفقود", code: "VALIDATION_ERROR" };
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      school: { select: { id: true, nameAr: true } },
      branch: { select: { id: true, nameAr: true } },
      teacherSupervision: {
        include: { supervisor: { select: { id: true, name: true } } },
      },
      supervisorAssignments: {
        include: { branch: { select: { id: true, nameAr: true, stage: true } } },
        orderBy: { createdAt: "asc" },
      },
      deputyGrants: {
        include: { branch: { select: { id: true, nameAr: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!user) {
    return { ok: false, message: "المستخدم غير موجود", code: "NOT_FOUND" };
  }
  if (isSchoolScopedAdmin(actor) && user.schoolId !== actor.schoolId) {
    return {
      ok: false,
      message: "لا يمكنك عرض حسابات خارج مدرستك — العملية مرفوضة",
      code: "FORBIDDEN",
    };
  }

  return {
    ok: true,
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      isVerified: user.emailVerifiedAt !== null,
      school: user.school,
      branch: user.branch,
      createdAtLabel: formatDateLabel(user.createdAt),
      lastLoginLabel: lastLoginLabel(user.lastLoginAt),
      supervisor: user.teacherSupervision?.supervisor ?? null,
      supervisorBranches: user.supervisorAssignments.map((a) => a.branch),
      deputyGrants: user.deputyGrants.map((grant) => ({
        id: grant.id,
        branchId: grant.branchId,
        branchName: grant.branch?.nameAr ?? null,
      })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Staff account creation (super admin / school admins)                 */
/* ------------------------------------------------------------------ */

export interface StaffAccountOutcome {
  id: string;
  name: string;
  email: string;
  role: string;
  emailSent: boolean;
}

/**
 * Per-actor creation matrix (product rule, enforced HERE server-side):
 *   SUPER_ADMIN                -> SCHOOL_MANAGER, IT_COORDINATOR,
 *                                 DEVELOPMENT_OFFICE_MANAGER + staff
 *   SCHOOL_MANAGER             -> DEVELOPMENT_OFFICE_MANAGER only,
 *                                 for their OWN school
 *   DEVELOPMENT_OFFICE_MANAGER -> staff roles only, for their OWN school
 * A school can have at most ONE active SCHOOL_MANAGER (single signatory).
 * The canonical map lives in validation/users.ts (client-safe) so the
 * creation form and this service can never drift apart.
 */

/**
 * Create a school staff account. The role comes from the schema
 * whitelist that EXCLUDES SUPER_ADMIN, the per-actor matrix above is
 * enforced here, the school is forced from the actor's context
 * (school-scoped admins) or validated explicitly (super admin), and the
 * account is NEVER pre-verified: the existing email-verification flow
 * is reused (an invite email with a single-use expiring token). A
 * failed provider is reported honestly via emailSent: false — the
 * account is NOT marked verified.
 */
export async function createStaffAccount(
  raw: unknown,
  actor: AdminContext,
  deps: { appBaseUrl: string; mailer?: MailSender }
): Promise<UsersServiceResult<StaffAccountOutcome>> {
  const gate = adminActorError(actor);
  if (gate) return gate;

  const parsed = staffAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const input = parsed.data;

  // Per-actor creation matrix — a stricter rule than the schema enum.
  const allowedRoles = CREATABLE_ROLES_BY_ACTOR[actor.role] ?? [];
  if (!allowedRoles.includes(input.role)) {
    return {
      ok: false,
      message: "دورك الحالي لا يسمح بإنشاء حسابات بهذا الدور",
      code: "FORBIDDEN",
    };
  }

  // Tenant resolution — school-scoped admins can NEVER create outside
  // their own school; the client-supplied schoolId is ignored for them.
  const schoolId = actor.role === "SUPER_ADMIN" ? input.schoolId : actor.schoolId;
  if (!schoolId) {
    return {
      ok: false,
      message: "المدرسة مطلوبة",
      fieldErrors: { schoolId: "اختر مدرسة" },
      code: "VALIDATION_ERROR",
    };
  }

  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    return {
      ok: false,
      message: "المدرسة غير موجودة",
      fieldErrors: { schoolId: "اختر مدرسة صحيحة" },
      code: "VALIDATION_ERROR",
    };
  }
  if (!school.isActive) {
    return {
      ok: false,
      message: "المدرسة غير مفعّلة — لا يمكن إضافة حسابات لها",
      code: "FORBIDDEN",
    };
  }

  // Single school manager rule: a school works with ONE active manager.
  if (input.role === "SCHOOL_MANAGER") {
    const existingManager = await db.user.findFirst({
      where: { role: "SCHOOL_MANAGER", schoolId, isActive: true },
      select: { id: true },
    });
    if (existingManager) {
      return {
        ok: false,
        message: "هذه المدرسة لديها مدير نشط بالفعل — كل مدرسة تعمل بمدير واحد",
        fieldErrors: { role: "المدرسة لديها مدير بالفعل" },
        code: "FORBIDDEN",
      };
    }
  }

  let branchId: string | null = null;
  if (input.branchId) {
    const branch = await db.branch.findUnique({ where: { id: input.branchId } });
    if (!branch || branch.schoolId !== schoolId || !branch.isActive) {
      return {
        ok: false,
        message: "الفرع المختار غير تابع للمدرسة المستهدفة",
        fieldErrors: { branchId: "اختر فرعًا من فروع هذه المدرسة" },
        code: "RELATION_ERROR",
      };
    }
    branchId = branch.id;
  }

  try {
    const user = await db.user.create({
      data: {
        name: input.name,
        email: input.email, // normalized by the schema
        passwordHash: await hashPassword(input.password),
        role: input.role, // whitelist + matrix enforced — never SUPER_ADMIN
        schoolId,
        branchId,
        isActive: true,
        emailVerifiedAt: null, // never silently verified
      },
    });

    // Reuse the existing verification pipeline (single-use expiring
    // token; hash-at-rest; tokens never logged).
    const rawToken = await issueEmailVerificationToken(user.id);
    const mailer = deps.mailer ?? defaultMailSender;
    const sent = await mailer({
      to: user.email,
      ...buildVerificationEmail(
        user.name,
        `${deps.appBaseUrl.replace(/\/$/, "")}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`
      ),
    });

    return {
      ok: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailSent: sent.ok,
      },
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return {
        ok: false,
        message: "البريد الإلكتروني مستخدم بالفعل لحساب آخر",
        fieldErrors: { email: "البريد مستخدم بالفعل" },
        code: "DUPLICATE_EMAIL",
      };
    }
    return { ok: false, message: "حدث خطأ غير متوقع — حاول مرة أخرى" };
  }
}

/* ------------------------------------------------------------------ */
/* Profile updates                                                      */
/* ------------------------------------------------------------------ */

/**
 * Administrative profile edit: display name + branch assignment ONLY.
 * The role, school and account state are NOT part of the schema — no
 * payload can escalate or move a user between schools. SUPER_ADMIN rows
 * are protected; school-scoped admins are confined to their own school.
 */
export async function updateUserProfileByAdmin(
  raw: unknown,
  actor: AdminContext
): Promise<UsersServiceResult<{ id: string; name: string }>> {
  const parsed = adminProfileUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const input = parsed.data;

  const gate = adminActorError(actor);
  if (gate) return gate;

  const target = await db.user.findUnique({ where: { id: input.userId } });
  if (!target) {
    return { ok: false, message: "المستخدم غير موجود", code: "NOT_FOUND" };
  }
  if (target.role === "SUPER_ADMIN") {
    return {
      ok: false,
      message: "حسابات مدير المنصة محمية — لا يمكن تعديلها من هنا",
      code: "FORBIDDEN",
    };
  }
  if (isSchoolScopedAdmin(actor) && target.schoolId !== actor.schoolId) {
    return {
      ok: false,
      message: "لا يمكنك تعديل حسابات خارج مدرستك",
      code: "FORBIDDEN",
    };
  }

  // Branch semantics: undefined => keep; "" => clear; id => assign
  // (validated against the user's own school).
  let branchUpdate: string | null | undefined;
  if (input.branchId === undefined) {
    branchUpdate = undefined; // keep current assignment
  } else if (input.branchId === "") {
    branchUpdate = null; // explicit clear
  } else {
    if (!target.schoolId) {
      return relationError("لا يمكن إسناد فرع لحساب لا يتبع أي مدرسة");
    }
    const branch = await db.branch.findUnique({ where: { id: input.branchId } });
    if (!branch || branch.schoolId !== target.schoolId) {
      return relationError("الفرع المختار غير تابع لمدرسة المستخدم", {
        branchId: "اختر فرعًا من فروع مدرسة المستخدم",
      });
    }
    branchUpdate = branch.id;
  }

  const updated = await db.user.update({
    where: { id: input.userId },
    data: {
      name: input.name,
      ...(branchUpdate !== undefined ? { branchId: branchUpdate } : {}),
    },
  });
  return { ok: true, data: { id: updated.id, name: updated.name } };
}

/**
 * Self-service profile edit. Only the display name can change — the
 * schema contains no other field, so role, school, branch, supervisor
 * and account state are structurally impossible to alter from here.
 */
export async function updateOwnProfile(
  raw: unknown,
  userId: string
): Promise<UsersServiceResult<{ id: string; name: string }>> {
  const parsed = adminProfileUpdateSchema.pick({ name: true }).safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { ok: false, message: "المستخدم غير موجود", code: "NOT_FOUND" };
  }
  if (!user.isActive) {
    return {
      ok: false,
      message: "الحساب غير مفعّل — لا يمكن تعديل الملف الشخصي",
      code: "FORBIDDEN",
    };
  }

  const updated = await db.user.update({
    where: { id: userId },
    data: { name: parsed.data.name },
  });
  return { ok: true, data: { id: updated.id, name: updated.name } };
}

/* ------------------------------------------------------------------ */
/* Supervisor scope & teacher assignments                               */
/* ------------------------------------------------------------------ */

/**
 * Replace a supervisor's branch scope (transactional whole-list
 * replace). Every branch must belong to the supervisor's own school —
 * cross-school branch assignments are rejected.
 */
export async function setSupervisorBranches(
  raw: unknown,
  actor: AdminContext
): Promise<UsersServiceResult<{ supervisorId: string }>> {
  const parsed = supervisorBranchesSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const input = parsed.data;

  const gate = adminActorError(actor);
  if (gate) return gate;

  const supervisor = await db.user.findUnique({
    where: { id: input.supervisorId },
  });
  if (!supervisor) {
    return { ok: false, message: "المستخدم غير موجود", code: "NOT_FOUND" };
  }
  if (supervisor.role !== "EDUCATIONAL_SUPERVISOR" || !supervisor.schoolId) {
    return relationError("الهدف يجب أن يكون مشرفًا تربويًا تابعًا لمدرسة");
  }
  // Captured after narrowing — usable inside the transaction callback.
  const supervisorSchoolId = supervisor.schoolId;
  if (isSchoolScopedAdmin(actor) && supervisor.schoolId !== actor.schoolId) {
    return {
      ok: false,
      message: "لا يمكنك إدارة مشرفين خارج مدرستك",
      code: "FORBIDDEN",
    };
  }

  // Deduplicate + validate every branch against the supervisor's school.
  const branchIds = [...new Set(input.branchIds)];
  if (branchIds.length > 0) {
    const branches = await db.branch.findMany({
      where: { id: { in: branchIds }, schoolId: supervisorSchoolId },
      select: { id: true },
    });
    if (branches.length !== branchIds.length) {
      return relationError("بعض الفروع غير تابعة لمدرسة المشرف — أعد الاختيار");
    }
  }

  await db.$transaction(async (tx) => {
    await tx.supervisorAssignment.deleteMany({ where: { supervisorId: supervisor.id } });
    for (const branchId of branchIds) {
      await tx.supervisorAssignment.create({
        data: { supervisorId: supervisor.id, schoolId: supervisorSchoolId, branchId },
      });
    }
  });

  return { ok: true, data: { supervisorId: supervisor.id } };
}

/**
 * Assign (or re-assign) a teacher's current supervisor. Both users must
 * belong to the SAME school; the teacher must be a TEACHER and the
 * target an EDUCATIONAL_SUPERVISOR. The change runs in a transaction:
 * the previous row (unique per teacher) is replaced, so the former
 * supervisor loses explicit access immediately — unless another valid
 * grant (branch coverage) still applies.
 */
export async function assignTeacherSupervisor(
  raw: unknown,
  actor: AdminContext
): Promise<UsersServiceResult<{ teacherId: string; supervisorId: string }>> {
  const parsed = teacherSupervisorSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const input = parsed.data;

  const gate = adminActorError(actor);
  if (gate) return gate;

  const [teacher, supervisor] = await Promise.all([
    db.user.findUnique({ where: { id: input.teacherId } }),
    db.user.findUnique({ where: { id: input.supervisorId } }),
  ]);

  if (!teacher) {
    return { ok: false, message: "المستخدم غير موجود", code: "NOT_FOUND" };
  }
  if (!supervisor) {
    return { ok: false, message: "المستخدم غير موجود", code: "NOT_FOUND" };
  }
  if (teacher.role !== "TEACHER") {
    return relationError("الإسناد متاح لمعلمي المنصة فقط");
  }
  if (supervisor.role !== "EDUCATIONAL_SUPERVISOR" || !supervisor.schoolId) {
    return relationError("المُسند إليه يجب أن يكون مشرفًا تربويًا تابعًا لمدرسة");
  }
  if (!teacher.schoolId || teacher.schoolId !== supervisor.schoolId) {
    return relationError(
      "لا يمكن إسناد معلم ومشرف من مدرستين مختلفتين — العملية مرفوضة"
    );
  }
  if (isSchoolScopedAdmin(actor) && teacher.schoolId !== actor.schoolId) {
    return {
      ok: false,
      message: "لا يمكنك إسناد معلمين خارج مدرستك",
      code: "FORBIDDEN",
    };
  }

  await db.$transaction(async (tx) => {
    await tx.teacherSupervisorAssignment.deleteMany({
      where: { teacherId: teacher.id },
    });
    await tx.teacherSupervisorAssignment.create({
      data: {
        teacherId: teacher.id,
        supervisorId: supervisor.id,
        schoolId: teacher.schoolId!,
      },
    });
  });

  return {
    ok: true,
    data: { teacherId: teacher.id, supervisorId: supervisor.id },
  };
}

/** Remove a teacher's current supervisor (idempotent, scope-checked). */
export async function removeTeacherSupervisor(
  raw: unknown,
  actor: AdminContext
): Promise<UsersServiceResult<{ teacherId: string }>> {
  const parsed = removeTeacherSupervisorSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  const teacher = await db.user.findUnique({
    where: { id: parsed.data.teacherId },
  });
  if (!teacher) {
    return { ok: false, message: "المستخدم غير موجود", code: "NOT_FOUND" };
  }

  const gate = adminActorError(actor);
  if (gate) return gate;

  if (isSchoolScopedAdmin(actor) && teacher.schoolId !== actor.schoolId) {
    return {
      ok: false,
      message: "لا يمكنك إسناد معلمين خارج مدرستك",
      code: "FORBIDDEN",
    };
  }

  await db.teacherSupervisorAssignment.deleteMany({
    where: { teacherId: teacher.id },
  });
  return { ok: true, data: { teacherId: teacher.id } };
}

/* ------------------------------------------------------------------ */
/* Deputy read scope                                                    */
/* ------------------------------------------------------------------ */

/**
 * Replace a deputy's read scope inside the deputy's OWN school:
 * either school-wide (branchId null) or an explicit branch list.
 * Cross-school grants are impossible — the school comes from the
 * deputy's account, never from the client.
 */
export async function setDeputyScope(
  raw: unknown,
  actor: AdminContext
): Promise<UsersServiceResult<{ deputyId: string }>> {
  const parsed = deputyScopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const input = parsed.data;

  const gate = adminActorError(actor);
  if (gate) return gate;

  const deputy = await db.user.findUnique({ where: { id: input.deputyId } });
  if (!deputy) {
    return { ok: false, message: "المستخدم غير موجود", code: "NOT_FOUND" };
  }
  if (deputy.role !== "EDUCATIONAL_DEPUTY" || !deputy.schoolId) {
    return relationError("الهدف يجب أن يكون وكيلًا تعليميًا تابعًا لمدرسة");
  }
  if (isSchoolScopedAdmin(actor) && deputy.schoolId !== actor.schoolId) {
    return {
      ok: false,
      message: "لا يمكنك إدارة وكلاء خارج مدرستك",
      code: "FORBIDDEN",
    };
  }

  const branchIds = [...new Set(input.branchIds)];
  if (input.mode === "branches" && branchIds.length > 0) {
    const branches = await db.branch.findMany({
      where: { id: { in: branchIds }, schoolId: deputy.schoolId },
      select: { id: true },
    });
    if (branches.length !== branchIds.length) {
      return relationError("بعض الفروع غير تابعة لمدرسة الوكيل — أعد الاختيار");
    }
  }

  const rows =
    input.mode === "school"
      ? [{ userId: deputy.id, schoolId: deputy.schoolId, branchId: null as string | null }]
      : branchIds.map((branchId) => ({
          userId: deputy.id,
          schoolId: deputy.schoolId!,
          branchId: branchId as string | null,
        }));

  await db.$transaction(async (tx) => {
    await tx.deputyGrant.deleteMany({ where: { userId: deputy.id } });
    for (const row of rows) {
      await tx.deputyGrant.create({ data: row });
    }
  });

  return { ok: true, data: { deputyId: deputy.id } };
}

/* ------------------------------------------------------------------ */
/* Role workspace readers                                               */
/* ------------------------------------------------------------------ */

/**
 * Supervisor workspace: authorized branch scope + the teachers they may
 * see, each labelled with WHY (explicit assignment vs branch coverage).
 */
export async function getSupervisorWorkspace(
  supervisorId: string
): Promise<SupervisorWorkspace | null> {
  const supervisor = await db.user.findUnique({
    where: { id: supervisorId },
    include: {
      supervisorAssignments: {
        include: { branch: { select: { id: true, nameAr: true, stage: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!supervisor || supervisor.role !== "EDUCATIONAL_SUPERVISOR" || !supervisor.schoolId) {
    return null;
  }

  const branchIds = supervisor.supervisorAssignments.map((a) => a.branchId);

  const branchDerived =
    branchIds.length > 0
      ? await db.user.findMany({
          where: {
            role: "TEACHER",
            isActive: true,
            schoolId: supervisor.schoolId,
            branchId: { in: branchIds },
          },
          include: { branch: { select: { id: true, nameAr: true } } },
        })
      : [];

  const explicitRows = await db.teacherSupervisorAssignment.findMany({
    where: { supervisorId, schoolId: supervisor.schoolId },
    include: {
      teacher: { include: { branch: { select: { id: true, nameAr: true } } } },
    },
  });

  type Row = SupervisorWorkspace["teachers"][number];
  const byId = new Map<string, Row>();
  for (const teacher of branchDerived) {
    byId.set(teacher.id, {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      branchName: teacher.branch?.nameAr ?? null,
      source: "branch",
      isVerified: teacher.emailVerifiedAt !== null,
    });
  }
  for (const row of explicitRows) {
    if (row.teacher && row.teacher.isActive && row.teacher.schoolId === supervisor.schoolId) {
      byId.set(row.teacher.id, {
        id: row.teacher.id,
        name: row.teacher.name,
        email: row.teacher.email,
        branchName: row.teacher.branch?.nameAr ?? null,
        source: "explicit",
        isVerified: row.teacher.emailVerifiedAt !== null,
      });
    }
  }

  return {
    branches: supervisor.supervisorAssignments.map((a) => a.branch),
    teachers: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ar")),
  };
}

/**
 * Deputy overview (read-only): granted schools/branches with real
 * per-branch teacher counts. Only granted scope is ever read.
 */
export async function getDeputyOverview(
  deputyId: string
): Promise<DeputyOverview | null> {
  const deputy = await db.user.findUnique({
    where: { id: deputyId },
    select: { id: true, role: true },
  });
  if (!deputy || deputy.role !== "EDUCATIONAL_DEPUTY") return null;

  const grants = await db.deputyGrant.findMany({
    where: { userId: deputyId },
    orderBy: { createdAt: "asc" },
  });

  const schoolIds = [...new Set(grants.map((g) => g.schoolId))];
  const schools: DeputyOverview["schools"] = [];

  for (const schoolId of schoolIds) {
    const grantedBranchIds = grants
      .filter((g) => g.schoolId === schoolId && g.branchId)
      .map((g) => g.branchId!);
    const wholeSchool = grants.some((g) => g.schoolId === schoolId && !g.branchId);

    const branches = await db.branch.findMany({
      where: {
        schoolId,
        ...(wholeSchool ? {} : { id: { in: grantedBranchIds } }),
      },
      orderBy: { createdAt: "asc" },
    });

    const branchesWithCounts = await Promise.all(
      branches.map(async (branch) => ({
        id: branch.id,
        nameAr: branch.nameAr,
        stage: branch.stage,
        isActive: branch.isActive,
        teachersCount: await db.user.count({
          where: { schoolId, branchId: branch.id, role: "TEACHER" },
        }),
      }))
    );

    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { id: true, nameAr: true },
    });
    if (school) {
      schools.push({ id: school.id, nameAr: school.nameAr, branches: branchesWithCounts });
    }
  }

  return {
    grants: grants.map((g) => ({ id: g.id, schoolId: g.schoolId, branchId: g.branchId })),
    schools,
  };
}

/** Own-profile projection for /my-profile and the teacher dashboard. */
export async function getOwnProfileView(
  userId: string
): Promise<OwnProfileView | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      school: { select: { id: true, nameAr: true } },
      branch: { select: { id: true, nameAr: true } },
      teacherSupervision: {
        include: { supervisor: { select: { id: true, name: true } } },
      },
    },
  });
  if (!user) return null;

  return {
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    isVerified: user.emailVerifiedAt !== null,
    school: user.school,
    branch: user.branch,
    supervisor: user.teacherSupervision?.supervisor ?? null,
    createdAtLabel: formatDateLabel(user.createdAt),
    lastLoginLabel: lastLoginLabel(user.lastLoginAt),
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard metrics (persisted, role-scoped)                           */
/* ------------------------------------------------------------------ */

export interface UsersMetrics {
  totalUsers: number;
  teachersCount: number;
  supervisorsCount: number;
  deputiesCount: number;
  managersCount: number;
  activeUsers: number;
}

/** Platform-wide user statistics — SUPER_ADMIN dashboard. */
export async function getPlatformUsersMetrics(): Promise<UsersMetrics> {
  const [totalUsers, teachersCount, supervisorsCount, deputiesCount, managersCount, activeUsers] =
    await Promise.all([
      db.user.count(),
      db.user.count({ where: { role: "TEACHER" } }),
      db.user.count({ where: { role: "EDUCATIONAL_SUPERVISOR" } }),
      db.user.count({ where: { role: "EDUCATIONAL_DEPUTY" } }),
      db.user.count({ where: { role: "DEVELOPMENT_OFFICE_MANAGER" } }),
      db.user.count({ where: { isActive: true } }),
    ]);
  return { totalUsers, teachersCount, supervisorsCount, deputiesCount, managersCount, activeUsers };
}

/** School-scoped user statistics — school dashboards. */
export async function getSchoolUsersMetrics(
  schoolId: string
): Promise<UsersMetrics> {
  const [totalUsers, teachersCount, supervisorsCount, deputiesCount, managersCount, activeUsers] =
    await Promise.all([
      db.user.count({ where: { schoolId } }),
      db.user.count({ where: { schoolId, role: "TEACHER" } }),
      db.user.count({ where: { schoolId, role: "EDUCATIONAL_SUPERVISOR" } }),
      db.user.count({ where: { schoolId, role: "EDUCATIONAL_DEPUTY" } }),
      db.user.count({ where: { schoolId, role: "DEVELOPMENT_OFFICE_MANAGER" } }),
      db.user.count({ where: { schoolId, isActive: true } }),
    ]);
  return { totalUsers, teachersCount, supervisorsCount, deputiesCount, managersCount, activeUsers };
}

/** Active supervisors of ONE school — for the assignment dropdowns. */
export async function listSupervisorsOfSchool(schoolId: string) {
  return db.user.findMany({
    where: { schoolId, role: "EDUCATIONAL_SUPERVISOR", isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/* ------------------------------------------------------------------ */
/* IT coordinator workspace (the role's TWO permitted powers)           */
/* ------------------------------------------------------------------ */

/**
 * Full IT workspace payload — real stats + supervisor/teacher rosters,
 * ALL confined to the IT coordinator's own school (re-read from the DB,
 * never trusted from the caller).
 */
export async function getItWorkspace(
  ctx: ItCoordinatorContext,
  query: {
    q?: string;
    status?: "ALL" | "ACTIVE" | "INACTIVE";
    assignment?: "ALL" | "ASSIGNED" | "UNASSIGNED";
  }
): Promise<ItWorkspaceData | null> {
  const it = await db.user.findUnique({
    where: { id: ctx.id },
    select: { role: true, schoolId: true },
  });
  if (!it || it.role !== "IT_COORDINATOR" || !it.schoolId) return null;
  const schoolId = it.schoolId;

  const q = query.q?.trim() ?? "";
  const status = query.status ?? "ALL";
  const assignment = query.assignment ?? "ALL";

  const teachers = await db.user.findMany({
    where: {
      schoolId,
      role: "TEACHER",
      ...(status === "ACTIVE"
        ? { isActive: true }
        : status === "INACTIVE"
          ? { isActive: false }
          : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q.toLowerCase() } },
            ],
          }
        : {}),
    },
    include: {
      branch: { select: { id: true, nameAr: true } },
      teacherSupervision: {
        include: { supervisor: { select: { id: true, name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  const filteredTeachers = teachers.filter((teacher) =>
    assignment === "ASSIGNED"
      ? teacher.teacherSupervision !== null
      : assignment === "UNASSIGNED"
        ? teacher.teacherSupervision === null
        : true
  );

  const supervisors = await db.user.findMany({
    where: { schoolId, role: "EDUCATIONAL_SUPERVISOR", isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const supervisorsWithCounts = await Promise.all(
    supervisors.map(async (supervisor) => ({
      ...supervisor,
      assignedCount: await db.teacherSupervisorAssignment.count({
        where: { supervisorId: supervisor.id, schoolId },
      }),
    }))
  );

  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { id: true, nameAr: true },
  });
  if (!school) return null;

  const assignedTeachers = teachers.filter(
    (teacher) => teacher.teacherSupervision !== null
  ).length;

  return {
    school,
    stats: {
      teachersTotal: teachers.length,
      activeTeachers: teachers.filter((teacher) => teacher.isActive).length,
      supervisorsTotal: supervisors.length,
      assignedTeachers,
      unassignedTeachers: teachers.length - assignedTeachers,
    },
    supervisors: supervisorsWithCounts,
    teachers: filteredTeachers.map((teacher) => ({
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      isActive: teacher.isActive,
      isVerified: teacher.emailVerifiedAt !== null,
      branchName: teacher.branch?.nameAr ?? null,
      supervisor: teacher.teacherSupervision?.supervisor ?? null,
    })),
  };
}

/**
 * IT power 1 — assign (or move) a teacher's supervisor. Same-school
 * guarantee on BOTH sides, transactional replace (the previous row is
 * deleted), and the IT coordinator can never touch another school.
 */
export async function assignTeacherSupervisorByIt(
  raw: unknown,
  actor: ItCoordinatorContext
): Promise<UsersServiceResult<{ teacherId: string; supervisorId: string }>> {
  const parsed = teacherSupervisorSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const input = parsed.data;

  const [teacher, supervisor] = await Promise.all([
    db.user.findUnique({ where: { id: input.teacherId } }),
    db.user.findUnique({ where: { id: input.supervisorId } }),
  ]);

  if (!teacher || !supervisor) {
    return { ok: false, message: "المستخدم غير موجود", code: "NOT_FOUND" };
  }
  if (teacher.role !== "TEACHER") {
    return relationError("الإسناد متاح لمعلمي المنصة فقط");
  }
  if (supervisor.role !== "EDUCATIONAL_SUPERVISOR" || !supervisor.schoolId) {
    return relationError("المُسند إليه يجب أن يكون مشرفًا تربويًا تابعًا لمدرسة");
  }
  if (
    !teacher.schoolId ||
    teacher.schoolId !== actor.schoolId ||
    supervisor.schoolId !== actor.schoolId
  ) {
    return relationError("لا يمكن إسناد معلمين أو مشرفين خارج مدرستك — العملية مرفوضة");
  }

  await db.$transaction(async (tx) => {
    await tx.teacherSupervisorAssignment.deleteMany({
      where: { teacherId: teacher.id },
    });
    await tx.teacherSupervisorAssignment.create({
      data: {
        teacherId: teacher.id,
        supervisorId: supervisor.id,
        schoolId: teacher.schoolId!,
      },
    });
  });

  return {
    ok: true,
    data: { teacherId: teacher.id, supervisorId: supervisor.id },
  };
}

/** IT power 1 (b) — remove a teacher's supervisor (idempotent). */
export async function removeTeacherSupervisorByIt(
  raw: unknown,
  actor: ItCoordinatorContext
): Promise<UsersServiceResult<{ teacherId: string }>> {
  const parsed = removeTeacherSupervisorSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  const teacher = await db.user.findUnique({
    where: { id: parsed.data.teacherId },
  });
  if (!teacher) {
    return { ok: false, message: "المستخدم غير موجود", code: "NOT_FOUND" };
  }
  if (!teacher.schoolId || teacher.schoolId !== actor.schoolId) {
    return relationError("لا يمكن تعديل إسنادات معلمين خارج مدرستك — العملية مرفوضة");
  }

  await db.teacherSupervisorAssignment.deleteMany({
    where: { teacherId: teacher.id },
  });
  return { ok: true, data: { teacherId: teacher.id } };
}

/**
 * IT power 2 — request a password-reset email for ONE teacher of their
 * own school. Reuses the EXISTING secure pipeline: single-use hashed
 * token, expiry, session revocation on use, and the configured mail
 * provider (never mailto links, never password disclosure). Rate
 * limited to 3 reset emails per teacher per hour (DB-based).
 */
export async function requestTeacherRecoveryByIt(
  raw: unknown,
  actor: ItCoordinatorContext,
  deps: { appBaseUrl: string; mailer?: MailSender }
): Promise<UsersServiceResult<TeacherRecoveryOutcome>> {
  const parsed = teacherRecoverySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "أدخل بريدًا إلكترونيًا صحيحًا",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  const teacher = await db.user.findUnique({
    where: { email: normalizeEmail(parsed.data.teacherEmail) },
  });
  if (!teacher || teacher.role !== "TEACHER" || teacher.schoolId !== actor.schoolId) {
    return {
      ok: false,
      message: "لا يوجد معلم بهذا البريد داخل مدرستك",
      code: "NOT_FOUND",
    };
  }
  if (!teacher.isActive) {
    return {
      ok: false,
      message: "حساب المعلم موقوف — استعادة كلمة المرور متاحة للحسابات النشطة فقط",
      code: "FORBIDDEN",
    };
  }

  // Rate limit: at most 3 reset emails per teacher per hour.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentTokens = await db.passwordResetToken.count({
    where: { userId: teacher.id, createdAt: { gte: oneHourAgo } },
  });
  if (recentTokens >= 3) {
    return {
      ok: false,
      message: "تم إرسال عدد كبير من روابط الاستعادة لهذا الحساب خلال الساعة الأخيرة — حاول لاحقًا",
      code: "FORBIDDEN",
    };
  }

  const rawToken = await issuePasswordResetToken(teacher.id);
  const mailer = deps.mailer ?? defaultMailSender;
  const sent = await mailer({
    to: teacher.email,
    ...buildPasswordResetEmail(
      teacher.name,
      `${deps.appBaseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(rawToken)}`
    ),
  });

  return {
    ok: true,
    data: {
      teacherName: teacher.name,
      teacherEmail: teacher.email,
      emailSent: sent.ok,
    },
  };
}
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { AdminContext } from "@/lib/auth/dev-admin";
import {
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from "@/lib/auth/password";
import {
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  issueEmailVerificationToken,
  issuePasswordResetToken,
} from "@/lib/auth/one-time-tokens";
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
  defaultMailSender,
  type MailSender,
} from "@/lib/mail/mailer";
import {
  createOfficeManagerSchema,
  normalizeEmail,
  passwordResetSchema,
  teacherRegistrationSchema,
  zodAuthFieldErrors,
  type AuthResult,
} from "@/lib/validation/auth";

/* ------------------------------------------------------------------ */
/* User & account service layer.                                        */
/*                                                                      */
/* Every rule the phase spec mandates lives HERE (server-side), not in  */
/* forms: school validation for self-registration, forced TEACHER role, */
/* duplicate-email suppression without existence disclosure, single-use */
/* tokens, inactive-account handling, and role-escalation guards.       */
/* Server actions are thin wrappers; UI never enforces security.        */
/* ------------------------------------------------------------------ */

export type SafeAccount = Omit<
  Prisma.UserGetPayload<{ include: { school: { select: { id: true; nameAr: true } } } }>,
  "passwordHash"
>;

function toSafeUser(user: Prisma.UserGetPayload<{
  include: { school: { select: { id: true, nameAr: true } } };
}>) {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

/** Build an absolute URL from a base that actions derive from headers. */
function verificationUrl(appBaseUrl: string, rawToken: string): string {
  return `${appBaseUrl.replace(/\/$/, "")}/api/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
}

function passwordResetUrl(appBaseUrl: string, rawToken: string): string {
  return `${appBaseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

/* ------------------------------------------------------------------ */
/* Teacher self-registration                                            */
/* ------------------------------------------------------------------ */

export type RegisterTeacherResult =
  | {
      ok: true;
      /** "duplicate_suppressed" never reveals account existence. */
      status: "created" | "duplicate_suppressed";
      emailSent: boolean;
    }
  | { ok: false; message: string; fieldErrors?: Record<string, string>; code?: string };

export interface RegisterTeacherDeps {
  /** Base URL (from request headers) used to build the emailed link. */
  appBaseUrl: string;
  /** Injectable sender for tests; production uses the SMTP mailer. */
  mailer?: MailSender;
}

/**
 * Self-registration for teachers via a school-specific link:
 * no roster matching, no approval gate, never pre-verified, and the
 * role is forced to TEACHER — the input cannot choose a role.
 */
export async function registerTeacher(
  raw: unknown,
  deps: RegisterTeacherDeps
): Promise<RegisterTeacherResult> {
  const parsed = teacherRegistrationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodAuthFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const input = parsed.data;

  // Re-validate the registration context on the server — the slug from
  // the URL must resolve to an ACTIVE school; client hints are ignored.
  const school = await db.school.findUnique({ where: { slug: input.slug } });
  if (!school || !school.isActive) {
    return {
      ok: false,
      message: "رابط التسجيل غير صالح أو أُغلق التسجيل لهذه المدرسة",
      code: "REGISTRATION_CLOSED",
    };
  }

  // Optional home branch must belong to this school and stay active.
  let branchId: string | null = null;
  if (input.branchId) {
    const branch = await db.branch.findUnique({
      where: { id: input.branchId },
    });
    if (!branch || branch.schoolId !== school.id || !branch.isActive) {
      return {
        ok: false,
        message: "الفرع المحدد غير متاح للتسجيل في هذه المدرسة",
        fieldErrors: { branchId: "اختر فرعًا من قائمة الفروع المتاحة" },
        code: "VALIDATION_ERROR",
      };
    }
    branchId = branch.id;
  }

  // Duplicate prevention — normalized email + DB unique constraint.
  // The public response is IDENTICAL either way (no existence leak).
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) {
    return { ok: true, status: "duplicate_suppressed", emailSent: false };
  }

  const user = await db.user.create({
    data: {
      name: input.name,
      email: input.email, // already normalized by the schema
      passwordHash: await hashPassword(input.password),
      role: "TEACHER",
      schoolId: school.id,
      branchId,
      isActive: true,
      emailVerifiedAt: null,
    },
  });

  const rawToken = await issueEmailVerificationToken(user.id);
  const mailer = deps.mailer ?? defaultMailSender;
  const sent = await mailer({
    to: user.email,
    ...buildVerificationEmail(user.name, verificationUrl(deps.appBaseUrl, rawToken)),
  });

  return { ok: true, status: "created", emailSent: sent.ok };
}

/* ------------------------------------------------------------------ */
/* Email verification                                                   */
/* ------------------------------------------------------------------ */

export type VerifyEmailStatus = "ok" | "invalid" | "used" | "expired";

export async function verifyEmailToken(
  rawToken: string
): Promise<{ status: VerifyEmailStatus }> {
  if (!rawToken) return { status: "invalid" };
  const result = await consumeEmailVerificationToken(rawToken);
  return { status: result.status };
}

/**
 * Resend a verification email. The response is always generic — the
 * caller cannot learn whether the address belongs to an account.
 */
export async function resendVerificationEmail(
  email: string,
  appBaseUrl: string,
  deps?: { mailer?: MailSender }
): Promise<{ ok: true }> {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
  });

  if (user && user.isActive && user.role === "TEACHER" && !user.emailVerifiedAt) {
    const rawToken = await issueEmailVerificationToken(user.id);
    const mailer = deps?.mailer ?? defaultMailSender;
    await mailer({
      to: user.email,
      ...buildVerificationEmail(user.name, verificationUrl(appBaseUrl, rawToken)),
    });
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Credentials / login                                                  */
/* ------------------------------------------------------------------ */

export type AuthFailureCode =
  | "INVALID_CREDENTIALS"
  | "INACTIVE"
  | "EMAIL_NOT_VERIFIED";

export type AuthenticateResult =
  | { ok: true; userId: string; tokenVersion: number }
  | { ok: false; code: AuthFailureCode; message: string };

export async function authenticateCredentials(
  email: string,
  password: string
): Promise<AuthenticateResult> {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
  });

  if (!user) {
    // Timing-equalized rejection — same cost as a real hash check.
    await verifyDummyPassword(password);
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "بيانات الدخول غير صحيحة — تحقق من البريد وكلمة المرور",
    };
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "بيانات الدخول غير صحيحة — تحقق من البريد وكلمة المرور",
    };
  }

  if (!user.isActive) {
    return {
      ok: false,
      code: "INACTIVE",
      message: "تم إيقاف هذا الحساب — تواصل مع إدارة المنصة أو إدارة مدرستك",
    };
  }

  // Email-verification enforcement applies to teachers (self-registered
  // accounts). Provisioned administrative accounts arrive pre-verified.
  if (user.role === "TEACHER" && !user.emailVerifiedAt) {
    return {
      ok: false,
      code: "EMAIL_NOT_VERIFIED",
      message: "يجب تأكيد بريدك الإلكتروني قبل تسجيل الدخول — تحقق من صندوق الرسائل",
    };
  }

  // Persist the last sign-in time (Phase 4) — displayed in the user
  // directory/details; never treated as a security signal.
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { ok: true, userId: user.id, tokenVersion: user.tokenVersion };
}

/** Invalidate every existing session of a user (logout everywhere). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}

/* ------------------------------------------------------------------ */
/* Password recovery                                                    */
/* ------------------------------------------------------------------ */

/**
 * Request a reset email. The response NEVER reveals account existence;
 * the reset email is only sent for real, active accounts.
 */
export async function requestPasswordReset(
  email: string,
  appBaseUrl: string,
  deps?: { mailer?: MailSender }
): Promise<{ ok: true }> {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
  });

  if (user && user.isActive) {
    const rawToken = await issuePasswordResetToken(user.id);
    const mailer = deps?.mailer ?? defaultMailSender;
    await mailer({
      to: user.email,
      ...buildPasswordResetEmail(user.name, passwordResetUrl(appBaseUrl, rawToken)),
    });
  }

  return { ok: true };
}

export type ResetPasswordResult = AuthResult<{ userId: string }>;

export async function resetPassword(raw: unknown): Promise<ResetPasswordResult> {
  const parsed = passwordResetSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodAuthFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const result = await consumePasswordResetToken(parsed.data.token, passwordHash);

  switch (result.status) {
    case "ok":
      return { ok: true, data: { userId: result.userId! } };
    case "expired":
      return {
        ok: false,
        message: "انتهت صلاحية رابط إعادة التعيين — اطلب رابطًا جديدًا",
        code: "TOKEN_EXPIRED",
      };
    case "used":
      return {
        ok: false,
        message: "تم استخدام رابط إعادة التعيين مسبقًا — اطلب رابطًا جديدًا",
        code: "TOKEN_USED",
      };
    default:
      return {
        ok: false,
        message: "رابط إعادة التعيين غير صالح",
        code: "TOKEN_INVALID",
      };
  }
}

/* ------------------------------------------------------------------ */
/* Platform account management (SUPER_ADMIN only)                       */
/* ------------------------------------------------------------------ */

/** All accounts with their school — for the platform management area. */
export async function listPlatformAccounts() {
  const users = await db.user.findMany({
    include: { school: { select: { id: true, nameAr: true } } },
    orderBy: { createdAt: "desc" },
  });
  return users.map(toSafeUser);
}

export type CreateOfficeManagerResult = AuthResult<SafeAccount>;

/**
 * Create a DEVELOPMENT_OFFICE_MANAGER account. Hard guarantees:
 *   - actor must be SUPER_ADMIN (checked here, again, on the server);
 *   - the role is forced — no input can create a SUPER_ADMIN;
 *   - provisioned accounts are pre-verified (created by the platform).
 */
export async function createOfficeManager(
  raw: unknown,
  actor: AdminContext
): Promise<CreateOfficeManagerResult> {
  if (actor.role !== "SUPER_ADMIN") {
    return {
      ok: false,
      message: "إنشاء حسابات الإدارة متاح لمدير المنصة فقط",
      code: "FORBIDDEN",
    };
  }

  const parsed = createOfficeManagerSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodAuthFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const input = parsed.data;

  const school = await db.school.findUnique({ where: { id: input.schoolId } });
  if (!school) {
    return {
      ok: false,
      message: "المدرسة المحددة غير موجودة",
      fieldErrors: { schoolId: "اختر مدرسة موجودة" },
      code: "VALIDATION_ERROR",
    };
  }

  try {
    const user = await db.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: "DEVELOPMENT_OFFICE_MANAGER", // forced — never from input
        schoolId: school.id,
        isActive: true,
        emailVerifiedAt: new Date(),
      },
      include: { school: { select: { id: true, nameAr: true } } },
    });
    return { ok: true, data: toSafeUser(user) };
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
        fieldErrors: { email: "هذا البريد مسجل بالفعل" },
        code: "VALIDATION_ERROR",
      };
    }
    return { ok: false, message: "تعذر إنشاء الحساب — حدث خطأ غير متوقع" };
  }
}

export type SetAccountActiveResult = AuthResult<SafeAccount>;

/**
 * Activate/deactivate an account (Phase 4 scope: BOTH administrative
 * roles, each inside its own boundary):
 *   - SUPER_ADMIN: any account except SUPER_ADMIN rows and themselves;
 *   - DEVELOPMENT_OFFICE_MANAGER: only accounts of their OWN school
 *     (schoolId comes from the DB session, never the client).
 * SUPER_ADMIN rows are protected for everyone. Deactivation revokes
 * live sessions immediately via tokenVersion.
 */
export async function setAccountActive(
  userId: string,
  isActive: boolean,
  actor: AdminContext
): Promise<SetAccountActiveResult> {
  // Defense in depth: only the two administrative roles may toggle
  // accounts — teachers/supervisors/deputies are rejected here even if
  // a future caller forgets the action-level redirect.
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return {
      ok: false,
      message: "إدارة الحسابات متاحة للإدارة المصرّح لها فقط",
      code: "FORBIDDEN",
    };
  }
  if (userId === actor.id) {
    return {
      ok: false,
      message: "لا يمكنك تغيير حالة حسابك الحالي",
      code: "FORBIDDEN",
    };
  }

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) {
    return { ok: false, message: "الحساب غير موجود", code: "NOT_FOUND" };
  }
  if (target.role === "SUPER_ADMIN") {
    return {
      ok: false,
      message: "لا يمكن إيقاف حساب مدير المنصة — هذا إجراء محمي",
      code: "FORBIDDEN",
    };
  }
  if (
    actor.role === "DEVELOPMENT_OFFICE_MANAGER" &&
    target.schoolId !== actor.schoolId
  ) {
    return {
      ok: false,
      message: "ليس لديك صلاحية إدارة حسابات هذه المدرسة — العملية مرفوضة",
      code: "FORBIDDEN",
    };
  }

  // Deactivation revokes live sessions immediately via tokenVersion.
  const updated = await db.user.update({
    where: { id: userId },
    data: {
      isActive,
      tokenVersion: isActive ? undefined : { increment: 1 },
    },
    include: { school: { select: { id: true, nameAr: true } } },
  });
  return { ok: true, data: toSafeUser(updated) };
}

/* ------------------------------------------------------------------ */
/* Role-scoped read helpers (supervisor / deputy boundaries)            */
/* ------------------------------------------------------------------ */

/**
 * Teachers visible to a supervisor — the single source of the
 * supervisor boundary (Phase 4 semantics):
 *   1. EXPLICIT assignments (TeacherSupervisorAssignment), and
 *   2. branch-derived teachers of the branches assigned to them
 *      (the Phase 3 boundary, preserved),
 * both confined to the supervisor's OWN school and ACTIVE accounts
 * only. When a teacher's explicit assignment moves to another
 * supervisor, the former supervisor keeps visibility ONLY if another
 * valid grant (branch coverage) still applies.
 */
export async function listTeachersForSupervisor(supervisorId: string) {
  const supervisor = await db.user.findUnique({
    where: { id: supervisorId },
    include: { supervisorAssignments: { select: { branchId: true } } },
  });
  if (
    !supervisor ||
    supervisor.role !== "EDUCATIONAL_SUPERVISOR" ||
    !supervisor.schoolId
  ) {
    return [];
  }

  const branchIds = supervisor.supervisorAssignments.map((a) => a.branchId);

  const branchDerived =
    branchIds.length > 0
      ? await db.user.findMany({
          where: {
            role: "TEACHER",
            isActive: true,
            schoolId: supervisor.schoolId, // never outside the supervisor's school
            branchId: { in: branchIds },
          },
          include: { branch: { select: { id: true, nameAr: true } } },
        })
      : [];

  const explicitRows = await db.teacherSupervisorAssignment.findMany({
    where: { supervisorId, schoolId: supervisor.schoolId },
    include: {
      teacher: {
        include: { branch: { select: { id: true, nameAr: true } } },
      },
    },
  });

  // Merge by id — explicit rows win; keep ACTIVE teachers only.
  const byId = new Map<string, (typeof branchDerived)[number]>();
  for (const teacher of branchDerived) byId.set(teacher.id, teacher);
  for (const row of explicitRows) {
    if (
      row.teacher &&
      row.teacher.isActive &&
      row.teacher.schoolId === supervisor.schoolId
    ) {
      byId.set(row.teacher.id, row.teacher);
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

/** Branches a supervisor is assigned to (their own school only). */
export async function listSupervisorAssignments(supervisorId: string) {
  return db.supervisorAssignment.findMany({
    where: { supervisorId },
    include: { branch: { select: { id: true, nameAr: true, stage: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** Explicit read-only grants for a deputy (school-wide or per branch). */
export async function listDeputyGrants(deputyId: string) {
  return db.deputyGrant.findMany({
    where: { userId: deputyId },
    include: {
      school: { select: { id: true, nameAr: true } },
      branch: { select: { id: true, nameAr: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** School identity for registration screens (public-safe fields). */
export async function getRegistrationSchool(slug: string) {
  return db.school.findUnique({
    where: { slug },
    select: {
      id: true,
      nameAr: true,
      nameEn: true,
      slug: true,
      logoUrl: true,
      brandColor: true,
      isActive: true,
      branches: {
        where: { isActive: true },
        select: { id: true, nameAr: true, stage: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}
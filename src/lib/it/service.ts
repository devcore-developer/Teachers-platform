import { db } from "@/lib/db";

import type { ItCoordinatorContext } from "@/lib/auth/dev-admin";
import { issuePasswordResetToken } from "@/lib/auth/one-time-tokens";
import {
  buildPasswordResetEmail,
  defaultMailSender,
  type MailSender,
} from "@/lib/mail/mailer";
import {
  itAssignTeacherSchema,
  itRecoverySchema,
  itRemoveTeacherSchema,
  itTeacherQuerySchema,
  IT_PAGE_SIZE,
  zodUsersFieldErrors,
  type ItServiceResult,
} from "@/lib/validation/it";

/* ------------------------------------------------------------------ */
/* IT_COORDINATOR service — the coordinator's ENTIRE world.             */
/*                                                                      */
/* Exactly two capabilities, both enforced server-side:                 */
/*   1. Teacher ↔ supervisor assignments (assign / transfer / remove)   */
/*      for the coordinator's OWN school;                               */
/*   2. Teacher account recovery: issues the SAME single-use expiring   */
/*      password-reset token used by the public flow (hash-only at      */
/*      rest, 1h expiry, atomic single use) and emails it to the        */
/*      teacher's own address through the existing mail provider.       */
/*                                                                      */
/* Security contract:                                                   */
/*   - schoolId comes from the session context, never from the client;  */
/*   - no password is ever displayed, generated or logged — the link    */
/*     goes ONLY to the teacher's own email (never mailto:);            */
/*   - durable per-teacher rate limit (tokens issued in the last hour)  */
/*     plus a per-coordinator in-process limiter (same documented       */
/*     limitations as the login rate limiter);                          */
/*   - responses never disclose whether another school's teacher exists.*/
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Shared read shapes                                                   */
/* ------------------------------------------------------------------ */

export interface ItTeacherRow {
  id: string;
  name: string;
  email: string;
  branchName: string | null;
  isActive: boolean;
  isVerified: boolean;
  /** Account created through a school self-registration link. */
  viaRegistrationLink: boolean;
  /** Self-registration date (when viaRegistrationLink). */
  registeredAt: Date;
  /** Current explicit supervisor, when assigned. */
  supervisor: { id: string; name: string } | null;
  /** Assignment audit — when the current row was last written. */
  supervisorAssignedAt: Date | null;
  /** Assignment audit — the coordinator/admin who wrote it (null for
   * legacy/imported rows; always set for IT-workspace writes). */
  supervisorAssignedBy: string | null;
}

export interface ItWorkspaceData {
  rows: ItTeacherRow[];
  supervisors: { id: string; name: string }[];
  branches: { id: string; nameAr: string }[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export interface ItDashboardStats {
  teachersActive: number;
  supervisorsActive: number;
  assignedActive: number;
  unassignedActive: number;
  recoveryLinks24h: number;
}

/* ------------------------------------------------------------------ */
/* Workspace listing (assignments screen)                               */
/* ------------------------------------------------------------------ */

/**
 * Teachers of the coordinator's school with their current supervisor,
 * filterable by free text / branch / assignment status and paginated.
 * The school scope is FORCED from the context — a tampered filter can
 * never widen the result beyond the coordinator's own school.
 */
export async function listItWorkspace(
  ctx: ItCoordinatorContext,
  rawQuery: unknown
): Promise<ItServiceResult<ItWorkspaceData>> {
  const parsed = itTeacherQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من معايير البحث ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const query = parsed.data;

  const where = {
    schoolId: ctx.schoolId, // forced — never from the client
    role: "TEACHER" as const,
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q } },
            { email: { contains: query.q.toLowerCase() } },
          ],
        }
      : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.status === "ASSIGNED"
      ? { teacherSupervision: { isNot: null } }
      : {}),
    ...(query.status === "UNASSIGNED"
      ? { teacherSupervision: { is: null } }
      : {}),
  };

  const [total, teachers, supervisors, branches] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      include: {
        branch: { select: { id: true, nameAr: true } },
        teacherSupervision: {
          include: {
            supervisor: { select: { id: true, name: true } },
            assignedBy: { select: { name: true } },
          },
        },
      },
      orderBy: { name: "asc" },
      skip: (query.page - 1) * IT_PAGE_SIZE,
      take: IT_PAGE_SIZE,
    }),
    db.user.findMany({
      where: {
        schoolId: ctx.schoolId,
        role: "EDUCATIONAL_SUPERVISOR",
        isActive: true,
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.branch.findMany({
      where: { schoolId: ctx.schoolId, isActive: true },
      select: { id: true, nameAr: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / IT_PAGE_SIZE));

  return {
    ok: true,
    data: {
      rows: teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        branchName: teacher.branch?.nameAr ?? null,
        isActive: teacher.isActive,
        isVerified: teacher.emailVerifiedAt !== null,
        viaRegistrationLink: teacher.registrationLinkId !== null,
        registeredAt: teacher.createdAt,
        supervisor: teacher.teacherSupervision?.supervisor ?? null,
        supervisorAssignedAt: teacher.teacherSupervision?.updatedAt ?? null,
        supervisorAssignedBy: teacher.teacherSupervision?.assignedBy?.name ?? null,
      })),
      supervisors,
      branches,
      total,
      page: Math.min(query.page, pageCount),
      pageCount,
      pageSize: IT_PAGE_SIZE,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Assign / transfer / remove                                           */
/* ------------------------------------------------------------------ */

/**
 * Assign (or transfer) a teacher to a supervisor. Both accounts must
 * belong to the coordinator's OWN school; the teacher must be a
 * TEACHER and the target an ACTIVE EDUCATIONAL_SUPERVISOR. The change
 * runs in a transaction — the previous row (unique per teacher) is
 * replaced, so the former supervisor loses explicit access immediately.
 */
export async function assignItTeacher(
  ctx: ItCoordinatorContext,
  raw: unknown
): Promise<
  ItServiceResult<{
    teacherId: string;
    supervisorId: string;
    /** True when this assignment ALSO activated a pending account. */
    activated: boolean;
  }>
> {
  const parsed = itAssignTeacherSchema.safeParse(raw);
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

  if (!teacher || teacher.role !== "TEACHER" || teacher.schoolId !== ctx.schoolId) {
    return {
      ok: false,
      message: "المعلم غير موجود داخل مدرستك — العملية مرفوضة",
      code: "NOT_FOUND",
    };
  }
  if (
    !supervisor ||
    supervisor.role !== "EDUCATIONAL_SUPERVISOR" ||
    supervisor.schoolId !== ctx.schoolId
  ) {
    return {
      ok: false,
      message: "المشرف المختار غير موجود داخل مدرستك — العملية مرفوضة",
      code: "NOT_FOUND",
    };
  }
  if (!supervisor.isActive) {
    return {
      ok: false,
      message: "حساب المشرف المختار موقوف — اختر مشرفًا نشطًا",
      code: "FORBIDDEN",
    };
  }

  // PENDING ACTIVATION: a self-registered teacher arrives inactive.
  // Completing the supervisor assignment IS the activation act — the
  // same transaction re-activates the account so the teacher can sign
  // in ONLY after a supervisor is explicitly assigned. Transferring an
  // already-active teacher is unaffected (idempotent update).
  const pendingActivation = !teacher.isActive;

  await db.$transaction(async (tx) => {
    await tx.teacherSupervisorAssignment.deleteMany({
      where: { teacherId: teacher.id, schoolId: ctx.schoolId },
    });
    await tx.teacherSupervisorAssignment.create({
      data: {
        teacherId: teacher.id,
        supervisorId: supervisor.id,
        schoolId: ctx.schoolId,
        // Assignment audit — who performed this assignment.
        assignedById: ctx.id,
      },
    });
    if (pendingActivation) {
      await tx.user.update({
        where: { id: teacher.id },
        data: { isActive: true },
      });
    }
  });

  return {
    ok: true,
    data: {
      teacherId: teacher.id,
      supervisorId: supervisor.id,
      activated: pendingActivation,
    },
  };
}

/** Remove a teacher's current supervisor (idempotent, school-checked). */
export async function removeItTeacherSupervisor(
  ctx: ItCoordinatorContext,
  raw: unknown
): Promise<ItServiceResult<{ teacherId: string }>> {
  const parsed = itRemoveTeacherSchema.safeParse(raw);
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
  if (!teacher || teacher.schoolId !== ctx.schoolId) {
    return {
      ok: false,
      message: "المعلم غير موجود داخل مدرستك — العملية مرفوضة",
      code: "NOT_FOUND",
    };
  }

  await db.teacherSupervisorAssignment.deleteMany({
    where: { teacherId: teacher.id, schoolId: ctx.schoolId },
  });

  return { ok: true, data: { teacherId: teacher.id } };
}

/* ------------------------------------------------------------------ */
/* Account recovery                                                     */
/* ------------------------------------------------------------------ */

export interface ItRecoveryOutcome {
  /** Honest delivery flag — false means the provider failed/unconfigured. */
  emailSent: boolean;
  /** Masked target address (e.g. a***@domain) — never the token/link. */
  maskedEmail: string;
}

const RECOVERY_TTL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_LINKS_PER_TEACHER_PER_HOUR = 3;
const MAX_LINKS_PER_COORDINATOR_PER_HOUR = 20;

/** Reset-link URL builder — same shape as the public forgot-password flow. */
function passwordResetUrl(appBaseUrl: string, rawToken: string): string {
  return `${appBaseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

/** a***@domain — enough for the coordinator to confirm the target. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••";
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.min(3, Math.max(1, local.length - 1)))}@${domain}`;
}

/**
 * Per-coordinator in-process limiter (defense in depth on top of the
 * durable per-teacher cap). Documented limitations mirror the login
 * limiter: counters reset on restart and are not shared across
 * instances; the durable per-teacher cap below always applies.
 */
const coordinatorIssuance = new Map<string, number[]>();

function coordinatorRateLimited(coordinatorId: string): boolean {
  const now = Date.now();
  const recent = (coordinatorIssuance.get(coordinatorId) ?? []).filter(
    (t) => now - t < RECOVERY_TTL_WINDOW_MS
  );
  coordinatorIssuance.set(coordinatorId, recent);
  return recent.length >= MAX_LINKS_PER_COORDINATOR_PER_HOUR;
}

function recordCoordinatorIssuance(coordinatorId: string): void {
  const recent = coordinatorIssuance.get(coordinatorId) ?? [];
  recent.push(Date.now());
  coordinatorIssuance.set(coordinatorId, recent);
}

/**
 * Issue a recovery link for ONE teacher of the coordinator's school.
 * The raw token is NEVER returned, displayed or logged — it travels
 * exclusively inside the email sent to the teacher's own address via
 * the platform's existing mail provider.
 */
export async function issueItRecoveryLink(
  ctx: ItCoordinatorContext,
  raw: unknown,
  deps: { appBaseUrl: string; mailer?: MailSender }
): Promise<ItServiceResult<ItRecoveryOutcome>> {
  const parsed = itRecoverySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  if (coordinatorRateLimited(ctx.id)) {
    return {
      ok: false,
      message: "لقد أرسلت العديد من روابط الاستعادة خلال الساعة الأخيرة — حاول لاحقًا",
      code: "RATE_LIMITED",
    };
  }

  const teacher = await db.user.findUnique({
    where: { id: parsed.data.teacherId },
  });

  if (!teacher || teacher.role !== "TEACHER" || teacher.schoolId !== ctx.schoolId) {
    return {
      ok: false,
      message: "المعلم غير موجود داخل مدرستك — العملية مرفوضة",
      code: "NOT_FOUND",
    };
  }
  if (!teacher.isActive) {
    // Distinguish pending-activation (self-registered, awaiting the
    // supervisor assignment) from an administratively suspended account.
    if (teacher.registrationLinkId) {
      return {
        ok: false,
        message:
          "حساب هذا المعلم قيد التفعيل — يُفعّل تلقائيًا عند إسناده إلى مشرف تربوي من شاشة الإسناد",
        code: "FORBIDDEN",
      };
    }
    return {
      ok: false,
      message: "حساب هذا المعلم موقوف — تفعيل الحساب يتم من إدارة المدرسة أولًا",
      code: "FORBIDDEN",
    };
  }

  // Durable rate limit — tokens actually issued for this account in the
  // last hour (each issuance also voids previous unused tokens, so this
  // window reflects real recovery pressure).
  const since = new Date(Date.now() - RECOVERY_TTL_WINDOW_MS);
  const recentLinks = await db.passwordResetToken.count({
    where: { userId: teacher.id, createdAt: { gte: since } },
  });
  if (recentLinks >= MAX_LINKS_PER_TEACHER_PER_HOUR) {
    return {
      ok: false,
      message:
        "تم إرسال عدة روابط استعادة لهذا الحساب خلال الساعة الأخيرة — انتظر قليلًا قبل إعادة المحاولة",
      code: "RATE_LIMITED",
    };
  }

  // Same pipeline as the public forgot-password flow: 256-bit token,
  // SHA-256 hash stored, 1h expiry, atomic single use.
  const rawToken = await issuePasswordResetToken(teacher.id);
  recordCoordinatorIssuance(ctx.id);

  const mailer = deps.mailer ?? defaultMailSender;
  const sent = await mailer({
    to: teacher.email,
    ...buildPasswordResetEmail(
      teacher.name,
      passwordResetUrl(deps.appBaseUrl, rawToken)
    ),
  });

  return {
    ok: true,
    data: { emailSent: sent.ok, maskedEmail: maskEmail(teacher.email) },
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard statistics (real counts, own school only)                  */
/* ------------------------------------------------------------------ */

/** Real, school-scoped counters for the IT coordinator dashboard. */
export async function getItDashboardStats(
  schoolId: string
): Promise<ItDashboardStats> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [teachersActive, supervisorsActive, assignedActive, recoveryLinks24h] =
    await Promise.all([
      db.user.count({
        where: { schoolId, role: "TEACHER", isActive: true },
      }),
      db.user.count({
        where: {
          schoolId,
          role: "EDUCATIONAL_SUPERVISOR",
          isActive: true,
        },
      }),
      db.teacherSupervisorAssignment.count({
        where: { schoolId, teacher: { isActive: true } },
      }),
      db.passwordResetToken.count({
        where: {
          createdAt: { gte: since24h },
          user: { schoolId, role: "TEACHER" },
        },
      }),
    ]);

  return {
    teachersActive,
    supervisorsActive,
    assignedActive,
    unassignedActive: Math.max(0, teachersActive - assignedActive),
    recoveryLinks24h,
  };
}
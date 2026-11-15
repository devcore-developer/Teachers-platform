import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { hashToken } from "@/lib/auth/one-time-tokens";
import type { AdminContext } from "@/lib/auth/dev-admin";
import { schoolScopeError } from "@/lib/auth/dev-admin";
import { getActiveSchoolBrandingById, getActiveSchoolBrandingBySlug, type ResolvedBranding } from "@/lib/branding";
import {
  registrationLinkCreateSchema,
  registrationLinkRevokeSchema,
  zodUsersFieldErrors,
  type RegistrationLinkServiceResult,
} from "@/lib/validation/registration-links";

/* ------------------------------------------------------------------ */
/* School-specific teacher self-registration links.                     */
/*                                                                      */
/* Security contract:                                                   */
/*   - The URL carries a 256-bit CSPRNG raw token; the database stores  */
/*     ONLY its SHA-256 hash (same hash-at-rest policy as the email     */
/*     verification / password reset tokens).                           */
/*   - Exactly ONE active link per school: create/regenerate runs in a  */
/*     transaction that deactivates every previous active link.         */
/*   - Revocation is permanent for that link; previously registered     */
/*     teachers keep their accounts untouched.                          */
/*   - Tenant scope: office/school managers are structurally confined   */
/*     to their own school (schoolId from the session, never from the   */
/*     client); SUPER_ADMIN may target any school explicitly.           */
/*   - Registration resolves the school from the token SERVER-SIDE —    */
/*     a client-supplied school id is never trusted.                    */
/*   - The raw token is shown exactly once (at creation) and is never   */
/*     logged; a lost link is recovered by generating a new one.        */
/* ------------------------------------------------------------------ */

function generateRawLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Absolute registration URL for a raw token (no trailing slashes). */
export function registrationLinkUrl(appBaseUrl: string, rawToken: string): string {
  return `${appBaseUrl.replace(/\/$/, "")}/register/${encodeURIComponent(rawToken)}`;
}

/* ------------------------------------------------------------------ */
/* Create / revoke                                                      */
/* ------------------------------------------------------------------ */

export interface CreatedRegistrationLink {
  id: string;
  /** The raw token — returned ONCE, only from this creation result. */
  rawToken: string;
  expiresAt: Date | null;
}

/**
 * Generate a new registration link for the managed school. Any previous
 * ACTIVE link of the school is deactivated atomically (regeneration
 * semantics), so at most one link can accept registrations at a time.
 */
export async function createRegistrationLink(
  ctx: AdminContext,
  raw: unknown
): Promise<RegistrationLinkServiceResult<CreatedRegistrationLink>> {
  const parsed = registrationLinkCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من البيانات المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }
  const input = parsed.data;

  // Tenant resolution — school managers/office managers are pinned to
  // their own school; only the platform owner picks a target school.
  const schoolId =
    ctx.role === "SUPER_ADMIN" ? input.schoolId : ctx.schoolId;
  if (!schoolId) {
    return {
      ok: false,
      message: "اختر المدرسة التي سيُنشأ لها رابط التسجيل",
      fieldErrors: { schoolId: "يجب اختيار المدرسة" },
      code: "VALIDATION_ERROR",
    };
  }
  const scope = schoolScopeError(ctx, schoolId);
  if (scope) return scope;

  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    return { ok: false, message: "المدرسة المختارة غير موجودة", code: "NOT_FOUND" };
  }
  if (!school.isActive) {
    return {
      ok: false,
      message: "المدرسة غير مفعّلة حاليًا — لا يمكن إنشاء روابط تسجيل لها",
      code: "FORBIDDEN",
    };
  }

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const rawToken = generateRawLinkToken();
  const link = await db.$transaction(async (tx) => {
    // «One active link per school» — revoke previous actives first.
    await tx.registrationLink.updateMany({
      where: { schoolId, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    });
    return tx.registrationLink.create({
      data: {
        schoolId,
        tokenHash: hashToken(rawToken),
        isActive: true,
        expiresAt,
        createdBy: ctx.id,
      },
      select: { id: true, expiresAt: true },
    });
  });

  return {
    ok: true,
    data: { id: link.id, rawToken, expiresAt: link.expiresAt },
  };
}

/**
 * Revoke a registration link permanently. Only links of the managed
 * school are reachable — any other id is indistinguishable from a
 * non-existent one (no cross-school probing).
 */
export async function revokeRegistrationLink(
  ctx: AdminContext,
  raw: unknown
): Promise<RegistrationLinkServiceResult<{ linkId: string }>> {
  const parsed = registrationLinkRevokeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "تحقق من البيانات المدخلة ثم أعد المحاولة",
      fieldErrors: zodUsersFieldErrors(parsed.error),
      code: "VALIDATION_ERROR",
    };
  }

  const schoolId = ctx.role === "SUPER_ADMIN" ? null : ctx.schoolId;
  const link = await db.registrationLink.findUnique({
    where: { id: parsed.data.linkId },
    select: { id: true, schoolId: true, isActive: true },
  });
  if (!link || (schoolId && link.schoolId !== schoolId)) {
    return {
      ok: false,
      message: "رابط التسجيل غير موجود ضمن نطاق مدرستك",
      code: "NOT_FOUND",
    };
  }
  if (ctx.role === "SUPER_ADMIN") {
    const scope = schoolScopeError(ctx, link.schoolId);
    if (scope) return scope;
  }
  if (!link.isActive) {
    return { ok: true, data: { linkId: link.id } }; // idempotent no-op
  }

  await db.registrationLink.update({
    where: { id: link.id },
    data: { isActive: false, revokedAt: new Date() },
  });

  return { ok: true, data: { linkId: link.id } };
}

/* ------------------------------------------------------------------ */
/* Read models                                                          */
/* ------------------------------------------------------------------ */

export interface RegistrationLinkRow {
  id: string;
  isActive: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdByName: string | null;
  /** Teachers created through this link (derived — single source). */
  registrationsCount: number;
  /** Most recent registration through this link. */
  lastRegistrationAt: Date | null;
}

export interface RegistrationLinksView {
  schoolId: string;
  schoolName: string;
  schoolIsActive: boolean;
  hasActiveLink: boolean;
  links: RegistrationLinkRow[];
}

/**
 * Link history + derived stats for the managed school. The school id
 * comes from the session context (or an explicit SUPER_ADMIN target
 * re-checked by schoolScopeError) — never from the client.
 */
export async function listRegistrationLinks(
  ctx: AdminContext,
  targetSchoolId: string
): Promise<RegistrationLinkServiceResult<RegistrationLinksView>> {
  const scope = schoolScopeError(ctx, targetSchoolId);
  if (scope) return scope;

  const school = await db.school.findUnique({
    where: { id: targetSchoolId },
    select: { id: true, nameAr: true, isActive: true },
  });
  if (!school) {
    return { ok: false, message: "المدرسة غير موجودة", code: "NOT_FOUND" };
  }

  const links = await db.registrationLink.findMany({
    where: { schoolId: school.id },
    orderBy: { createdAt: "desc" },
  });

  // createdBy is a plain id column (audit); resolve names in one query.
  const creatorIds = [...new Set(links.map((l) => l.createdBy))];
  const creators = creatorIds.length
    ? await db.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, name: true },
      })
    : [];
  const creatorName = new Map(creators.map((u) => [u.id, u.name]));

  // Derived per-link stats — one grouped query over users.
  const linkIds = links?.map((l) => l.id) ?? [];
  const grouped = linkIds.length
    ? await db.user.groupBy({
        by: ["registrationLinkId"],
        where: {
          role: "TEACHER",
          registrationLinkId: { in: linkIds },
        },
        _count: { _all: true },
        _max: { createdAt: true },
      })
    : [];
  const statsByLink = new Map(
    grouped.map((g) => [
      g.registrationLinkId as string,
      { count: g._count._all, last: g._max.createdAt },
    ])
  );

  const rows: RegistrationLinkRow[] = links.map((link) => ({
    id: link.id,
    isActive: link.isActive,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    createdByName: creatorName.get(link.createdBy) ?? null,
    registrationsCount: statsByLink.get(link.id)?.count ?? 0,
    lastRegistrationAt: statsByLink.get(link.id)?.last ?? null,
  }));

  return {
    ok: true,
    data: {
      schoolId: school.id,
      schoolName: school.nameAr,
      schoolIsActive: school.isActive,
      hasActiveLink: rows.some((r) => r.isActive),
      links: rows,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Token resolution (public side)                                       */
/* ------------------------------------------------------------------ */

export type RegistrationTokenStatus =
  | "valid"
  | "invalid"
  | "revoked"
  | "expired";

export interface RegistrationSchoolProfile {
  id: string;
  nameAr: string;
  nameEn: string | null;
  slug: string;
  logoUrl: string | null;
  brandColor: string;
  brandTagline: string | null;
}

export interface RegistrationTokenContext {
  status: "valid";
  linkId: string;
  expiresAt: Date | null;
  school: RegistrationSchoolProfile;
  /** Active branches of the registration school (home-branch picker). */
  branches: { id: string; nameAr: string }[];
}

export type RegistrationTokenResolution =
  | RegistrationTokenContext
  | { status: Exclude<RegistrationTokenStatus, "valid"> };

/**
 * Resolve a raw registration token SERVER-SIDE. The school association
 * comes exclusively from the link record — a tampered request can never
 * register into another school.
 */
export async function resolveRegistrationToken(
  rawToken: string
): Promise<RegistrationTokenResolution> {
  const token = (rawToken ?? "").trim();
  if (!token || token.length > 128) return { status: "invalid" };

  const link = await db.registrationLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      school: {
        select: {
          id: true,
          nameAr: true,
          nameEn: true,
          slug: true,
          logoUrl: true,
          brandColor: true,
          brandTagline: true,
          isActive: true,
          branches: {
            where: { isActive: true },
            select: { id: true, nameAr: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!link) return { status: "invalid" };
  if (!link.isActive || !link.school.isActive) return { status: "revoked" };
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return { status: "expired" };
  }

  return {
    status: "valid",
    linkId: link.id,
    expiresAt: link.expiresAt,
    school: {
      id: link.school.id,
      nameAr: link.school.nameAr,
      nameEn: link.school.nameEn,
      slug: link.school.slug,
      logoUrl: link.school.logoUrl,
      brandColor: link.school.brandColor,
      brandTagline: link.school.brandTagline,
    },
    branches: link.school.branches,
  };
}

/**
 * /register/{param} entry resolution — the single route accepts the
 * token format; a legacy school-slug param resolves to a friendly
 * "registration runs through your school's dedicated link" screen
 * (the raw token is never recoverable from its hash, so a slug can never
 * mint a live link — managers generate/share the token URL instead).
 */
export type RegisterEntryResolution =
  | { kind: "token"; resolution: RegistrationTokenResolution }
  | { kind: "school_closed" }
  | { kind: "invalid" };

export async function resolveRegisterEntry(
  rawParam: string
): Promise<RegisterEntryResolution> {
  const param = (rawParam ?? "").trim();
  if (!param) return { kind: "invalid" };

  const byToken = await resolveRegistrationToken(param);
  if (byToken.status !== "invalid") {
    return { kind: "token", resolution: byToken };
  }

  const school = await db.school.findUnique({
    where: { slug: param },
    select: { isActive: true },
  });
  if (school && school.isActive) return { kind: "school_closed" };
  return { kind: "invalid" };
}

/* ------------------------------------------------------------------ */
/* Branding + school-level statistics                                   */
/* ------------------------------------------------------------------ */

/** Branding for the register gate — token or legacy slug resolution. */
export async function resolveRegisterBranding(
  rawParam: string
): Promise<ResolvedBranding> {
  const param = (rawParam ?? "").trim();
  const byToken = await db.registrationLink.findUnique({
    where: { tokenHash: hashToken(param) },
    select: { schoolId: true },
  });
  if (byToken) return getActiveSchoolBrandingById(byToken.schoolId);
  return getActiveSchoolBrandingBySlug(param);
}

export interface RegistrationStats {
  /** All TEACHER accounts of the scope (any state). */
  totalTeachers: number;
  /** Accounts created through self-registration links. */
  viaLinks: number;
  /** Registered, email not yet verified (cannot sign in yet). */
  awaitingVerification: number;
  /** Verified but no Educational Supervisor assigned yet. */
  verifiedUnassigned: number;
  /** Currently assigned to a supervisor (active teachers). */
  assigned: number;
}

export async function getSchoolRegistrationStats(
  schoolId: string
): Promise<RegistrationStats> {
  const [totalTeachers, viaLinks, awaitingVerification, assigned] =
    await Promise.all([
      db.user.count({ where: { schoolId, role: "TEACHER" } }),
      db.user.count({
        where: { schoolId, role: "TEACHER", registrationLinkId: { not: null } },
      }),
      db.user.count({
        where: {
          schoolId,
          role: "TEACHER",
          isActive: true,
          emailVerifiedAt: null,
        },
      }),
      db.teacherSupervisorAssignment.count({
        where: { schoolId, teacher: { isActive: true } },
      }),
    ]);

  // Verified-but-unassigned: verified ACTIVE teachers without a current
  // supervisor row. Computed as a direct query to stay exact when
  // unassigned inactive teachers exist.
  const verifiedUnassigned = await db.user.count({
    where: {
      schoolId,
      role: "TEACHER",
      isActive: true,
      emailVerifiedAt: { not: null },
      teacherSupervision: { is: null },
    },
  });

  return {
    totalTeachers,
    viaLinks,
    awaitingVerification,
    verifiedUnassigned,
    assigned,
  };
}
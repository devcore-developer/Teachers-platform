/**
 * Batch 3 — READ-ONLY certificate listings for roles that never issue:
 *
 *   EDUCATIONAL_SUPERVISOR — certificates of THEIR assigned teachers
 *     inside their own school (scope from TeacherSupervisorAssignment).
 *   SUPER_ADMIN — platform-wide read-only register with the school name
 *     on every row. Issuance/revocation remain manager-only: the
 *     write-capable service is untouched and no mutation lives here.
 */
import { db } from "@/lib/db";

import { effectiveStatusOf } from "@/lib/certificates/service";

/** Matches the management page density. */
const PAGE_SIZE = 15;

/** Serializable row shared by both read paths (RSC-safe). */
export interface CertificateReadRow {
  id: string;
  certificateNumber: string;
  titleAr: string;
  teacherName: string;
  contentTitle: string | null;
  issuedAt: Date;
  expiresAt: Date | null;
  status: string;
  effectiveStatus: ReturnType<typeof effectiveStatusOf>;
  issuerName: string | null;
  schoolName?: string;
}

interface ListFilters {
  q?: string;
  status?: string;
  page?: number;
}

function buildWhere(filters: ListFilters, extra: Record<string, unknown>) {
  const where: Record<string, unknown> = { ...extra };
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { certificateNumber: { contains: q } },
      { titleAr: { contains: q } },
      { teacher: { name: { contains: q } } },
    ];
  }
  if (filters.status === "ISSUED" || filters.status === "REVOKED") {
    where.status = filters.status;
  }
  return where;
}

function toRow(row: {
  id: string;
  certificateNumber: string;
  titleAr: string;
  issuedAt: Date;
  expiresAt: Date | null;
  status: string;
  courseId: string | null;
  programId: string | null;
  teacher: { name: string } | null;
  course: { titleAr: string } | null;
  program: { nameAr: string } | null;
  issuedBy: { name: string } | null;
  school?: { nameAr: string } | null;
}): CertificateReadRow {
  return {
    id: row.id,
    certificateNumber: row.certificateNumber,
    titleAr: row.titleAr,
    teacherName: row.teacher?.name ?? "—",
    contentTitle: row.course?.titleAr ?? row.program?.nameAr ?? null,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    status: row.status,
    effectiveStatus: effectiveStatusOf(row),
    issuerName: row.issuedBy?.name ?? null,
    schoolName: row.school?.nameAr,
  };
}

/* ------------------------------------------------------------------ */
/* Supervisor — read-only certificates of assigned teachers             */
/* ------------------------------------------------------------------ */

export interface SupervisorCertificateResult {
  ok: boolean;
  message?: string;
  rows: CertificateReadRow[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listCertificatesForSupervisor(
  ctx: { id: string; role: string; schoolId: string | null },
  filters: ListFilters = {}
): Promise<SupervisorCertificateResult> {
  if (ctx.role !== "EDUCATIONAL_SUPERVISOR") {
    return {
      ok: false,
      message: "هذه القائمة متاحة للمشرفين التربويين فقط",
      rows: [],
      total: 0,
      page: 1,
      pageCount: 1,
    };
  }
  if (!ctx.schoolId) {
    return {
      ok: false,
      message: "حساب المشرف غير مرتبط بمدرسة — تواصل مع إدارة المنصة",
      rows: [],
      total: 0,
      page: 1,
      pageCount: 1,
    };
  }

  const links = await db.teacherSupervisorAssignment.findMany({
    where: { supervisorId: ctx.id, schoolId: ctx.schoolId },
    select: { teacherId: true },
  });
  const teacherIds = links.map((link) => link.teacherId);
  if (teacherIds.length === 0) {
    return { ok: true, rows: [], total: 0, page: 1, pageCount: 1 };
  }

  const where = buildWhere(filters, {
    schoolId: ctx.schoolId,
    teacherId: { in: teacherIds },
  });

  const [total, rows] = await Promise.all([
    db.certificate.count({ where }),
    db.certificate.findMany({
      where,
      include: {
        teacher: { select: { name: true } },
        course: { select: { titleAr: true } },
        program: { select: { nameAr: true } },
        issuedBy: { select: { name: true } },
      },
      orderBy: { issuedAt: "desc" },
      skip: (Math.max(1, filters.page ?? 1) - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  return { ok: true, rows: rows.map(toRow), total, page, pageCount };
}

/* ------------------------------------------------------------------ */
/* Platform — read-only cross-school register (SUPER_ADMIN)             */
/* ------------------------------------------------------------------ */

export interface PlatformCertificateResult {
  ok: boolean;
  message?: string;
  rows: CertificateReadRow[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listCertificatesPlatform(
  filters: ListFilters = {}
): Promise<PlatformCertificateResult> {
  const where = buildWhere(filters, {});

  const [total, rows] = await Promise.all([
    db.certificate.count({ where }),
    db.certificate.findMany({
      where,
      include: {
        teacher: { select: { name: true } },
        course: { select: { titleAr: true } },
        program: { select: { nameAr: true } },
        issuedBy: { select: { name: true } },
        school: { select: { nameAr: true } },
      },
      orderBy: { issuedAt: "desc" },
      skip: (Math.max(1, filters.page ?? 1) - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  return { ok: true, rows: rows.map(toRow), total, page, pageCount };
}
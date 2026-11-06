/**
 * Batch 3 — READ-ONLY assignment listings for roles that never manage:
 *
 *   EDUCATIONAL_SUPERVISOR — published/closed assignments whose audience
 *     targets at least one of THEIR assigned teachers. The teacher set
 *     comes from persisted TeacherSupervisorAssignment rows (plus the
 *     teachers' current branches), never from the client.
 *   SUPER_ADMIN — a platform-wide read-only register with the school
 *     name on every row. SUPER_ADMIN can look, never touch: no create,
 *     edit, publish or grade path is exposed through this module.
 *
 * This module intentionally contains ZERO mutations — the write-capable
 * service (listAssignmentsForManage and friends) stays untouched.
 */
import { isTeacherTargeted, parseJsonIds } from "@/lib/assignments/access";
import { db } from "@/lib/db";

/** Matches the management page density. */
const PLATFORM_PAGE_SIZE = 15;

/** Serializable row shared by both read paths (RSC-safe). */
export interface AssignmentReadRow {
  id: string;
  titleAr: string;
  titleEn: string | null;
  status: string;
  audienceMode: string;
  dueAt: Date;
  totalPoints: number;
  submissionsTotal: number;
  schoolName?: string;
}

type AssignmentWithCounts = {
  id: string;
  titleAr: string;
  titleEn: string | null;
  status: string;
  audienceMode: string;
  targetTeacherIdsJson: string | null;
  targetBranchIdsJson: string | null;
  dueAt: Date;
  totalPoints: number;
  _count: { submissions: number };
};

function targetingOf(assignment: {
  audienceMode: string;
  targetTeacherIdsJson: string | null;
  targetBranchIdsJson: string | null;
}) {
  return {
    audienceMode: assignment.audienceMode,
    targetTeacherIds: parseJsonIds(assignment.targetTeacherIdsJson),
    targetBranchIds: parseJsonIds(assignment.targetBranchIdsJson),
  };
}

function toRow(
  assignment: AssignmentWithCounts,
  schoolName?: string
): AssignmentReadRow {
  return {
    id: assignment.id,
    titleAr: assignment.titleAr,
    titleEn: assignment.titleEn,
    status: assignment.status,
    audienceMode: assignment.audienceMode,
    dueAt: assignment.dueAt,
    totalPoints: assignment.totalPoints,
    submissionsTotal: assignment._count.submissions,
    schoolName,
  };
}

/* ------------------------------------------------------------------ */
/* Supervisor — read-only register for assigned teachers                */
/* ------------------------------------------------------------------ */

export interface SupervisorReadResult {
  ok: boolean;
  message?: string;
  rows: AssignmentReadRow[];
}

export async function listAssignmentsForSupervisor(ctx: {
  id: string;
  role: string;
  schoolId: string | null;
}): Promise<SupervisorReadResult> {
  if (ctx.role !== "EDUCATIONAL_SUPERVISOR") {
    return { ok: false, message: "هذه القائمة متاحة للمشرفين التربويين فقط", rows: [] };
  }
  if (!ctx.schoolId) {
    return {
      ok: false,
      message: "حساب المشرف غير مرتبط بمدرسة — تواصل مع إدارة المنصة",
      rows: [],
    };
  }

  // Scope = persisted supervisor assignments inside the supervisor's
  // own school. No client input participates in this query.
  const links = await db.teacherSupervisorAssignment.findMany({
    where: { supervisorId: ctx.id, schoolId: ctx.schoolId },
    select: { teacherId: true },
  });
  const teacherIds = links.map((link) => link.teacherId);
  if (teacherIds.length === 0) {
    return { ok: true, rows: [] };
  }

  const teachers = await db.user.findMany({
    where: { id: { in: teacherIds } },
    select: { id: true, branchId: true },
  });

  const assignments = await db.assignment.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: { in: ["PUBLISHED", "CLOSED"] },
    },
    select: {
      id: true,
      titleAr: true,
      titleEn: true,
      status: true,
      audienceMode: true,
      targetTeacherIdsJson: true,
      targetBranchIdsJson: true,
      dueAt: true,
      totalPoints: true,
      _count: { select: { submissions: true } },
    },
    orderBy: { dueAt: "asc" },
  });

  const rows = assignments
    .filter((assignment) =>
      teachers.some((teacher) => isTeacherTargeted(targetingOf(assignment), teacher))
    )
    .map((assignment) => toRow(assignment));

  return { ok: true, rows };
}

/* ------------------------------------------------------------------ */
/* Platform — read-only cross-school register (SUPER_ADMIN)             */
/* ------------------------------------------------------------------ */

export interface PlatformListResult {
  ok: boolean;
  message?: string;
  rows: AssignmentReadRow[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listAssignmentsPlatform(filters: {
  q?: string;
  status?: string;
  page?: number;
}): Promise<PlatformListResult> {
  const where: {
    OR?: Array<Record<string, unknown>>;
    status?: string;
  } = {};
  const q = filters.q?.trim();
  if (q) {
    where.OR = [{ titleAr: { contains: q } }, { titleEn: { contains: q } }];
  }
  if (
    filters.status === "DRAFT" ||
    filters.status === "PUBLISHED" ||
    filters.status === "CLOSED" ||
    filters.status === "ARCHIVED"
  ) {
    where.status = filters.status;
  }

  const [total, rows] = await Promise.all([
    db.assignment.count({ where }),
    db.assignment.findMany({
      where,
      select: {
        id: true,
        titleAr: true,
        titleEn: true,
        status: true,
        audienceMode: true,
        targetTeacherIdsJson: true,
        targetBranchIdsJson: true,
        dueAt: true,
        totalPoints: true,
        _count: { select: { submissions: true } },
        school: { select: { nameAr: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (Math.max(1, filters.page ?? 1) - 1) * PLATFORM_PAGE_SIZE,
      take: PLATFORM_PAGE_SIZE,
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PLATFORM_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  return {
    ok: true,
    rows: rows.map((row) => toRow(row, row.school.nameAr)),
    total,
    page,
    pageCount,
  };
}
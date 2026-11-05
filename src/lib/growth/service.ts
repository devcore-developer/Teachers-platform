import { db } from "@/lib/db";
import {
  ANNUAL_HOURS_TARGET,
  GROWTH_LEVELS,
  PROMOTION_THRESHOLD_PERCENT,
  growthLevelLabel,
  isGrowthLevelId,
  nextGrowthLevel,
  suggestedGrowthLevel,
  type GrowthLevelId,
} from "@/config/growth";
import { notifyGrowthLevelChanged } from "@/lib/notifications/center";
import { getActiveAcademicYear } from "@/lib/academic-year";
import { teacherHoursSummary } from "@/lib/training/hours";

/* ------------------------------------------------------------------ */
/* Batch 2 — professional growth engine (HTML v48 + v13 parity).        */
/*                                                                      */
/* The persisted level lives on User.growthLevel (default "T0"). Every  */
/* change writes ONE append-only GrowthEvent row (the full history is   */
/* never rewritten) and notifies the teacher through the notification   */
/* center. The SUGGESTED level (v13 thresholds) is advisory only.       */
/*                                                                      */
/* Permissions (fail-closed, server-side):                              */
/*   - EDUCATIONAL_SUPERVISOR: only teachers inside their own scope        */
/*     (explicit assignment OR branch coverage) and own school.         */
/*   - DEVELOPMENT_OFFICE_MANAGER: only teachers of their own school.   */
/*   - SUPER_ADMIN: any teacher.                                        */
/* ------------------------------------------------------------------ */

export type GrowthServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code?: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" };

/** The acting supervisor/admin resolved from the session (never client input). */
export interface GrowthActor {
  id: string;
  role: string;
  schoolId: string | null;
}

/* ------------------------------------------------------------------ */
/* Stats                                                                */
/* ------------------------------------------------------------------ */

export interface TeacherGrowthStats {
  /** Published courses assigned to this teacher (platform-wide + own school). */
  assigned: number;
  completed: number;
  /** Accumulated completed-course hours (all completions — HTML parity). */
  hours: number;
  /** Mean of the best passed-assessment percentages (null when no exams). */
  avgPercentage: number | null;
  certificates: number;
  /** Round(completed / assigned * 100) — 0 when nothing is assigned. */
  percent: number;
}

export interface GrowthTeacherRow {
  teacher: {
    id: string;
    name: string;
    email: string;
    schoolId: string | null;
    schoolName: string | null;
    branchName: string | null;
    stage: string | null;
    subject: string | null;
    isActive: boolean;
  };
  currentLevel: GrowthLevelId;
  suggestedLevel: GrowthLevelId;
  stats: TeacherGrowthStats;
  eligible: boolean;
  nextLevel: GrowthLevelId | null;
}

interface TeacherRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  schoolId: string | null;
  branchId?: string | null;
  growthLevel: string;
  stage: string | null;
  subject: string | null;
  isActive: boolean;
  school?: { nameAr: string } | null;
  branch?: { nameAr: string } | null;
}

/** Exported for the messaging recipients list (same scope, same shape). */
export type ScopedTeacherRecord = TeacherRecord;

/**
 * Build growth rows for a set of teachers with BATCHED queries (no
 * per-teacher round trips — a school roster can hold hundreds of
 * teachers). Assigned published courses are resolved per distinct
 * schoolId exactly like the HTML v13AssignedCourses: platform-wide
 * courses (schoolId null) reach everyone; school courses reach that
 * school's teachers only.
 */
export async function buildGrowthRows(
  teachers: TeacherRecord[]
): Promise<GrowthTeacherRow[]> {
  if (teachers.length === 0) return [];

  const teacherIds = teachers.map((teacher) => teacher.id);
  const schoolIds = [
    ...new Set(
      teachers.map((teacher) => teacher.schoolId).filter((id): id is string => Boolean(id))
    ),
  ];

  // Published courses per scope — platform-wide once, then one per school.
  const scopeCourses = new Map<string, Set<string>>();
  const platformCourses = await db.course.findMany({
    where: { status: "PUBLISHED", schoolId: null },
    select: { id: true },
  });
  const platformIds = new Set(platformCourses.map((course) => course.id));
  for (const schoolId of schoolIds) {
    const schoolCourses = await db.course.findMany({
      where: { status: "PUBLISHED", schoolId },
      select: { id: true },
    });
    scopeCourses.set(schoolId, new Set(schoolCourses.map((course) => course.id)));
  }

  const completions = await db.courseCompletion.findMany({
    where: { userId: { in: teacherIds } },
    select: {
      userId: true,
      courseId: true,
      hours: true,
      bestPercentage: true,
    },
  });
  const certificateCounts = await db.certificate.groupBy({
    by: ["teacherId"],
    where: { teacherId: { in: teacherIds }, status: "ISSUED" },
    _count: { _all: true },
  });
  const certCountByTeacher = new Map(
    certificateCounts.map((row) => [row.teacherId, row._count._all])
  );

  const completionsByTeacher = new Map<string, typeof completions>();
  for (const completion of completions) {
    const list = completionsByTeacher.get(completion.userId) ?? [];
    list.push(completion);
    completionsByTeacher.set(completion.userId, list);
  }

  return teachers.map((teacher) => {
    const assignedIds = new Set(platformIds);
    if (teacher.schoolId) {
      const schoolSet = scopeCourses.get(teacher.schoolId);
      if (schoolSet) {
        for (const id of schoolSet) assignedIds.add(id);
      }
    }
    const own = completionsByTeacher.get(teacher.id) ?? [];
    const done = own.filter((completion) => assignedIds.has(completion.courseId));
    const assigned = assignedIds.size;
    const percent =
      assigned === 0 ? 0 : Math.round((done.length / assigned) * 100);
    const hours = own.reduce((sum, completion) => sum + Number(completion.hours ?? 0), 0);
    const percentages = own
      .map((completion) => completion.bestPercentage)
      .filter((value): value is number => typeof value === "number");
    const avgPercentage = percentages.length
      ? Math.round(
          (percentages.reduce((sum, value) => sum + value, 0) / percentages.length) * 10
        ) / 10
      : null;

    const currentLevel: GrowthLevelId = isGrowthLevelId(teacher.growthLevel)
      ? teacher.growthLevel
      : "T0";
    const suggestedLevel = suggestedGrowthLevel({ hours, assignedPercent: percent });
    const nextLevel = nextGrowthLevel(currentLevel);
    const eligible =
      assigned > 0 &&
      percent >= PROMOTION_THRESHOLD_PERCENT &&
      nextLevel !== null;

    return {
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        schoolId: teacher.schoolId,
        schoolName: teacher.school?.nameAr ?? null,
        branchName: teacher.branch?.nameAr ?? null,
        stage: teacher.stage,
        subject: teacher.subject,
        isActive: teacher.isActive,
      },
      currentLevel,
      suggestedLevel,
      stats: {
        assigned,
        completed: done.length,
        hours,
        avgPercentage,
        certificates: certCountByTeacher.get(teacher.id) ?? 0,
        percent,
      },
      eligible,
      nextLevel,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Scope resolution                                                     */
/* ------------------------------------------------------------------ */

/** Supervisor scope = explicit assignments ∪ branch coverage, own school. */
async function supervisorOwnsTeacher(
  supervisorId: string,
  teacherId: string
): Promise<boolean> {
  const supervisor = await db.user.findUnique({
    where: { id: supervisorId },
    select: { role: true, schoolId: true, supervisorAssignments: { select: { branchId: true } } },
  });
  if (!supervisor || supervisor.role !== "EDUCATIONAL_SUPERVISOR" || !supervisor.schoolId) {
    return false;
  }
  const teacher = await db.user.findUnique({
    where: { id: teacherId },
    select: { role: true, schoolId: true, branchId: true },
  });
  if (!teacher || teacher.role !== "TEACHER" || teacher.schoolId !== supervisor.schoolId) {
    return false;
  }
  const explicit = await db.teacherSupervisorAssignment.findFirst({
    where: { teacherId, supervisorId, schoolId: supervisor.schoolId },
    select: { id: true },
  });
  if (explicit) return true;
  const branchIds = supervisor.supervisorAssignments.map((row) => row.branchId);
  return Boolean(teacher.branchId && branchIds.includes(teacher.branchId));
}

function adminOwnsTeacher(actor: GrowthActor, teacherSchoolId: string | null): boolean {
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role === "DEVELOPMENT_OFFICE_MANAGER") {
    return Boolean(actor.schoolId) && teacherSchoolId === actor.schoolId;
  }
  return false;
}

/** Fail-closed permission check for reading/writing one teacher's growth. */
export async function canManageTeacherGrowth(
  actor: GrowthActor,
  teacherId: string
): Promise<boolean> {
  if (actor.role === "EDUCATIONAL_SUPERVISOR") {
    return supervisorOwnsTeacher(actor.id, teacherId);
  }
  const teacher = await db.user.findUnique({
    where: { id: teacherId },
    select: { role: true, schoolId: true },
  });
  if (!teacher || teacher.role !== "TEACHER") return false;
  return adminOwnsTeacher(actor, teacher.schoolId);
}

/* ------------------------------------------------------------------ */
/* Boards                                                               */
/* ------------------------------------------------------------------ */

/**
 * The supervisor's authorized teacher records (explicit assignments ∪
 * branch coverage, confined to the supervisor's school). Shared by the
 * growth board and the messaging recipients list — one scope, one query
 * path, everywhere.
 */
export async function supervisorScopedTeacherRecords(
  supervisorId: string
): Promise<GrowthServiceResult<TeacherRecord[]>> {
  const supervisor = await db.user.findUnique({
    where: { id: supervisorId },
    select: {
      role: true,
      schoolId: true,
      supervisorAssignments: { select: { branchId: true } },
    },
  });
  if (!supervisor || supervisor.role !== "EDUCATIONAL_SUPERVISOR" || !supervisor.schoolId) {
    return { ok: false, message: "هذه الصفحة متاحة للمشرفين التربويين فقط", code: "FORBIDDEN" };
  }

  const branchIds = supervisor.supervisorAssignments.map((row) => row.branchId);
  const branchDerived =
    branchIds.length > 0
      ? await db.user.findMany({
          where: {
            role: "TEACHER",
            schoolId: supervisor.schoolId,
            branchId: { in: branchIds },
          },
          select: growthTeacherSelect,
        })
      : [];
  const explicitRows = await db.teacherSupervisorAssignment.findMany({
    where: { supervisorId, schoolId: supervisor.schoolId },
    select: { teacher: { select: growthTeacherSelect } },
  });

  const byId = new Map<string, TeacherRecord>();
  for (const teacher of branchDerived) byId.set(teacher.id, teacher);
  for (const row of explicitRows) {
    if (row.teacher && row.teacher.schoolId === supervisor.schoolId) {
      byId.set(row.teacher.id, row.teacher);
    }
  }
  return { ok: true, data: [...byId.values()] };
}

/**
 * The supervisor's growth board (HTML v48Page): every teacher inside
 * the supervisor's authorized scope with stats + eligibility.
 */
export async function supervisorGrowthBoard(
  supervisorId: string
): Promise<GrowthServiceResult<GrowthTeacherRow[]>> {
  const scoped = await supervisorScopedTeacherRecords(supervisorId);
  if (!scoped.ok) return scoped;
  const rows = await buildGrowthRows(scoped.data);
  rows.sort((a, b) => a.teacher.name.localeCompare(b.teacher.name, "ar"));
  return { ok: true, data: rows };
}

/**
 * The administrative teachers board (/teachers): all teachers of the
 * actor's school (office) or the whole platform (super admin).
 */
export async function adminGrowthBoard(
  actor: GrowthActor
): Promise<GrowthServiceResult<GrowthTeacherRow[]>> {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return { ok: false, message: "هذه الصفحة متاحة للإدارة فقط", code: "FORBIDDEN" };
  }
  const teachers = await db.user.findMany({
    where: {
      role: "TEACHER",
      ...(actor.role === "DEVELOPMENT_OFFICE_MANAGER" ? { schoolId: actor.schoolId } : {}),
    },
    select: growthTeacherSelect,
    orderBy: { name: "asc" },
  });
  const rows = await buildGrowthRows(teachers);
  return { ok: true, data: rows };
}

const growthTeacherSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  schoolId: true,
  branchId: true,
  growthLevel: true,
  stage: true,
  subject: true,
  isActive: true,
  school: { select: { nameAr: true } },
  branch: { select: { nameAr: true } },
} as const;

/* ------------------------------------------------------------------ */
/* Writes                                                               */
/* ------------------------------------------------------------------ */

export interface LevelChangeOutcome {
  changed: boolean;
  from: GrowthLevelId;
  to: GrowthLevelId;
}

/**
 * v48SetTeacherLevel — the supervisor classifies the teacher directly.
 * Idempotent: classifying the same level again changes nothing (and
 * writes no duplicate history row).
 */
export async function setTeacherLevel(
  actor: GrowthActor,
  teacherId: string,
  level: string,
  note?: string
): Promise<GrowthServiceResult<LevelChangeOutcome>> {
  if (!isGrowthLevelId(level)) {
    return { ok: false, message: "مستوى النمو غير صالح", code: "VALIDATION_ERROR" };
  }
  const teacher = await db.user.findUnique({
    where: { id: teacherId },
    select: { id: true, name: true, role: true, schoolId: true, growthLevel: true, isActive: true },
  });
  if (!teacher || teacher.role !== "TEACHER") {
    return { ok: false, message: "المعلم غير موجود", code: "NOT_FOUND" };
  }
  if (!(await canManageTeacherGrowth(actor, teacherId))) {
    return { ok: false, message: "لا تملك صلاحية تصنيف هذا المعلم", code: "FORBIDDEN" };
  }

  const from: GrowthLevelId = isGrowthLevelId(teacher.growthLevel)
    ? teacher.growthLevel
    : "T0";
  if (from === level) {
    return { ok: true, data: { changed: false, from, to: level } };
  }

  await db.$transaction([
    db.user.update({ where: { id: teacherId }, data: { growthLevel: level } }),
    db.growthEvent.create({
      data: {
        userId: teacherId,
        fromLevel: from,
        toLevel: level,
        reason: "MANUAL_SUPERVISOR",
        note: note?.trim() ? note.trim().slice(0, 300) : null,
        actorId: actor.id,
      },
    }),
  ]);

  await notifyGrowthLevelChanged({
    teacherId,
    fromLevel: from,
    toLevel: level,
    kind: "MANUAL",
  });

  return { ok: true, data: { changed: true, from, to: level } };
}

/**
 * v48CheckPromotion + approve in one server-side step. The 60% gate is
 * re-checked HERE (never trusted from the client) and only ever moves
 * the teacher exactly ONE level up.
 */
export async function approvePromotion(
  actor: GrowthActor,
  teacherId: string
): Promise<
  GrowthServiceResult<
    | { promoted: true; from: GrowthLevelId; to: GrowthLevelId }
    | { promoted: false; message: string; completed: number; assigned: number; percent: number }
  >
> {
  const teacher = await db.user.findUnique({
    where: { id: teacherId },
    select: { id: true, name: true, role: true, schoolId: true, growthLevel: true },
  });
  if (!teacher || teacher.role !== "TEACHER") {
    return { ok: false, message: "المعلم غير موجود", code: "NOT_FOUND" };
  }
  if (!(await canManageTeacherGrowth(actor, teacherId))) {
    return { ok: false, message: "لا تملك صلاحية اعتماد انتقال هذا المعلم", code: "FORBIDDEN" };
  }

  const [row] = await buildGrowthRows([
    {
      id: teacher.id,
      name: teacher.name,
      email: "",
      schoolId: teacher.schoolId,
      branchId: null,
      role: teacher.role,
      growthLevel: teacher.growthLevel,
      stage: null,
      subject: null,
      isActive: teacher.role === "TEACHER",
      school: null,
      branch: null,
    },
  ]);

  if (!row.nextLevel) {
    return {
      ok: true,
      data: {
        promoted: false,
        message: "المعلم على أعلى مستوى بالفعل (T5 — باحث تربوي)",
        completed: row.stats.completed,
        assigned: row.stats.assigned,
        percent: row.stats.percent,
      },
    };
  }
  if (!row.eligible) {
    return {
      ok: true,
      data: {
        promoted: false,
        message: `لم يكتمل شرط ${PROMOTION_THRESHOLD_PERCENT}% بعد. المكتمل: ${row.stats.completed} من ${row.stats.assigned} دورة (${row.stats.percent}%).`,
        completed: row.stats.completed,
        assigned: row.stats.assigned,
        percent: row.stats.percent,
      },
    };
  }

  const from = row.currentLevel;
  const to = row.nextLevel;
  await db.$transaction([
    db.user.update({ where: { id: teacherId }, data: { growthLevel: to } }),
    db.growthEvent.create({
      data: {
        userId: teacherId,
        fromLevel: from,
        toLevel: to,
        reason: "PROMOTION_APPROVED",
        actorId: actor.id,
      },
    }),
  ]);

  await notifyGrowthLevelChanged({ teacherId, fromLevel: from, toLevel: to, kind: "PROMOTION" });

  return { ok: true, data: { promoted: true, from, to } };
}

/* ------------------------------------------------------------------ */
/* History + teacher self view                                          */
/* ------------------------------------------------------------------ */

export interface GrowthHistoryRow {
  id: string;
  fromLevel: string | null;
  toLevel: string;
  reason: string;
  note: string | null;
  actorName: string | null;
  createdAt: Date;
}

/** The teacher's own level + suggestion + last events (for /reports). */
export async function teacherGrowthSummary(teacherId: string): Promise<{
  currentLevel: GrowthLevelId;
  suggestedLevel: GrowthLevelId;
  history: GrowthHistoryRow[];
  stats: TeacherGrowthStats;
} | null> {
  const teacher = await db.user.findUnique({
    where: { id: teacherId },
    select: growthTeacherSelect,
  });
  if (!teacher) return null;
  const [row] = await buildGrowthRows([teacher]);
  const history = await db.growthEvent.findMany({
    where: { userId: teacherId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      fromLevel: true,
      toLevel: true,
      reason: true,
      note: true,
      actor: { select: { name: true } },
      createdAt: true,
    },
  });
  return {
    currentLevel: row.currentLevel,
    suggestedLevel: row.suggestedLevel,
    stats: row.stats,
    history: history.map((event) => ({
      id: event.id,
      fromLevel: event.fromLevel,
      toLevel: event.toLevel,
      reason: event.reason,
      note: event.note,
      actorName: event.actor?.name ?? null,
      createdAt: event.createdAt,
    })),
  };
}

/** Levels metadata for UI selects (stable order T0..T5). */
export function allGrowthLevels(): typeof GROWTH_LEVELS {
  return GROWTH_LEVELS;
}

/* ================================================================== */
/* Batch 2 (part 2/2) — page-facing growth views.                      */
/*                                                                     */
/* Everything below reads REAL database rows only (no mock data):      */
/*   - listGrowthRoster        -> /growth table + analytics module     */
/*   - getPlatformGrowthStats  -> /growth stat cards + per-school grid */
/*   - getTeacherGrowth        -> /growth/[teacherId] + /my-growth     */
/*   - teacherGrowthHistory    -> the growth journey timeline          */
/* The persisted level, the 60% gate and the 35-hour target all come   */
/* from the engine above and from src/config/growth.ts.                */
/* ================================================================== */

const REASON_LABELS: Record<string, string> = {
  MANUAL_SUPERVISOR: "تصنيف المشرف",
  PROMOTION_APPROVED: "اعتماد انتقال — شرط 60%",
  SEED: "تصنيف ابتدائي",
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

/** One row of the append-only growth journey (HTML v48 GL-events parity). */
export interface GrowthHistoryEvent {
  id: string;
  teacherId: string;
  teacherName: string;
  fromLevel: GrowthLevelId | null;
  fromLabel: string | null;
  toLevel: GrowthLevelId;
  toLabel: string;
  /** Raw machine reason (MANUAL_SUPERVISOR | PROMOTION_APPROVED | SEED). */
  reason: string;
  /** Arabic label used directly in the timeline UI. */
  reasonLabel: string;
  note: string | null;
  actorName: string | null;
  createdAt: Date;
}

/**
 * The teacher's growth journey, newest first. Backed exclusively by
 * GrowthEvent rows (append-only — the history is never rewritten).
 */
export async function teacherGrowthHistory(
  teacherId: string,
  limit = 20
): Promise<GrowthHistoryEvent[]> {
  const events = await db.growthEvent.findMany({
    where: { userId: teacherId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      fromLevel: true,
      toLevel: true,
      reason: true,
      note: true,
      actor: { select: { name: true } },
      createdAt: true,
      user: { select: { id: true, name: true } },
    },
  });

  return events.map((event) => {
    const fromLevel = event.fromLevel && isGrowthLevelId(event.fromLevel) ? event.fromLevel : null;
    const toLevel = isGrowthLevelId(event.toLevel) ? event.toLevel : "T0";
    return {
      id: event.id,
      teacherId: event.user.id,
      teacherName: event.user.name,
      fromLevel,
      fromLabel: fromLevel ? growthLevelLabel(fromLevel) : null,
      toLevel,
      toLabel: growthLevelLabel(toLevel),
      reason: event.reason,
      reasonLabel: reasonLabel(event.reason),
      note: event.note,
      actorName: event.actor?.name ?? null,
      createdAt: event.createdAt,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Roster                                                              */
/* ------------------------------------------------------------------ */

/** Flat roster row — consumed by /growth and by the analytics module. */
export interface GrowthRosterRow {
  teacherId: string;
  teacherName: string;
  email: string;
  schoolId: string | null;
  schoolName: string | null;
  /** Home branch name (null when the teacher has no branch). */
  branchName: string | null;
  stage: string | null;
  subject: string | null;
  level: GrowthLevelId;
  levelLabel: string;
  suggestedLevel: GrowthLevelId;
  nextLevel: GrowthLevelId | null;
  nextLevelLabel: string | null;
  /** Published courses assigned to this teacher (platform + own school). */
  coursesEnrolled: number;
  coursesCompleted: number;
  /** Round(completed/assigned*100) — the 60% promotion gate value. */
  completionPercentage: number;
  certificatesActive: number;
  hoursCompleted: number;
  hoursTarget: number;
  avgBestPercentage: number | null;
  eligible: boolean;
  isActive: boolean;
}

/**
 * Tolerant scope so every caller compiles against one signature:
 *   - nothing          -> whole platform (callers already tenant-scoped)
 *   - "schoolId"       -> one school (bare string also accepted)
 *   - { id, schoolId, supervisorId, teacherIds } -> explicit scope object
 *
 * `id` (the acting user) is accepted for backward compatibility with the
 * analytics/dashboard callers: when `supervisorId` is not passed and the
 * id belongs to an EDUCATIONAL_SUPERVISOR, the roster collapses to
 * exactly their teachers; for any other role it is safely ignored.
 */
export type GrowthRosterScope =
  | string
  | {
      [key: string]: unknown;
      id?: string | null;
      schoolId?: string | null;
      supervisorId?: string | null;
      teacherIds?: string[];
    }
  | null
  | undefined;

function normalizeRosterScope(scope: GrowthRosterScope): {
  actorId: string | null;
  schoolId: string | null;
  supervisorId: string | null;
  teacherIds: string[] | null;
} {
  if (typeof scope === "string") {
    return {
      actorId: null,
      schoolId: scope || null,
      supervisorId: null,
      teacherIds: null,
    };
  }
  if (!scope) {
    return { actorId: null, schoolId: null, supervisorId: null, teacherIds: null };
  }
  return {
    actorId: scope.id ?? null,
    schoolId: scope.schoolId ?? null,
    supervisorId: scope.supervisorId ?? null,
    teacherIds: Array.isArray(scope.teacherIds) ? scope.teacherIds.filter(Boolean) : null,
  };
}

/**
 * The roster result: the rows array itself, augmented with the
 * `{ ok: true, data: { rows } }` envelope so BOTH consumption styles
 * compile and behave identically:
 *   - array style   -> roster.length, roster.map(...)          (pages)
 *   - envelope style-> roster.ok ? roster.data.rows : []       (analytics)
 */
export type GrowthRosterCollection = GrowthRosterRow[] & {
  ok: true;
  data: { rows: GrowthRosterRow[] };
};

/**
 * The growth roster: every teacher of the requested scope with their
 * level, the 60% gate numbers, hours vs the 35-hour target, active
 * certificates and the mean of best assessment percentages.
 * Supervisors pass their own id — the scope then collapses to exactly
 * the teachers they are authorized to see (assignments ∪ branches).
 *
 * Returns a GrowthRosterCollection: the rows array augmented with the
 * `{ ok: true, data: { rows } }` envelope (see the type above), so
 * legacy ActionState-style callers keep compiling unchanged.
 */
export async function listGrowthRoster(
  scope?: GrowthRosterScope
): Promise<GrowthRosterCollection> {
  const { actorId, schoolId, supervisorId: explicitSupervisorId, teacherIds } =
    normalizeRosterScope(scope);

  // Backward-compatible actor scoping: a bare `id` only narrows the
  // roster when it really belongs to an educational supervisor —
  // admins and office managers keep the whole (school-scoped) roster.
  let supervisorId = explicitSupervisorId;
  if (!supervisorId && actorId) {
    const actor = await db.user.findUnique({
      where: { id: actorId },
      select: { role: true },
    });
    if (actor?.role === "EDUCATIONAL_SUPERVISOR") supervisorId = actorId;
  }

  let teachers: TeacherRecord[];
  if (supervisorId) {
    const scoped = await supervisorScopedTeacherRecords(supervisorId);
    teachers = scoped.ok ? scoped.data : [];
    if (schoolId) {
      teachers = teachers.filter((teacher) => teacher.schoolId === schoolId);
    }
  } else if (teacherIds && teacherIds.length > 0) {
    teachers = await db.user.findMany({
      where: {
        role: "TEACHER",
        id: { in: teacherIds },
        ...(schoolId ? { schoolId } : {}),
      },
      select: growthTeacherSelect,
    });
  } else {
    teachers = await db.user.findMany({
      where: { role: "TEACHER", ...(schoolId ? { schoolId } : {}) },
      select: growthTeacherSelect,
      orderBy: { name: "asc" },
    });
  }

  const rows = await buildGrowthRows(teachers);
  const roster: GrowthRosterRow[] = rows.map((row) => ({
    teacherId: row.teacher.id,
    teacherName: row.teacher.name,
    email: row.teacher.email,
    schoolId: row.teacher.schoolId,
    schoolName: row.teacher.schoolName,
    branchName: row.teacher.branchName,
    stage: row.teacher.stage,
    subject: row.teacher.subject,
    level: row.currentLevel,
    levelLabel: growthLevelLabel(row.currentLevel),
    suggestedLevel: row.suggestedLevel,
    nextLevel: row.nextLevel,
    nextLevelLabel: row.nextLevel ? growthLevelLabel(row.nextLevel) : null,
    coursesEnrolled: row.stats.assigned,
    coursesCompleted: row.stats.completed,
    completionPercentage: row.stats.percent,
    certificatesActive: row.stats.certificates,
    hoursCompleted: row.stats.hours,
    hoursTarget: ANNUAL_HOURS_TARGET,
    avgBestPercentage: row.stats.avgPercentage,
    eligible: row.eligible,
    isActive: row.teacher.isActive,
  }));

  // Envelope augmentation — `rows` is a shallow copy so the collection
  // stays JSON-serializable (no self-referencing cycle).
  return Object.assign(roster, {
    ok: true as const,
    data: { rows: roster.slice() },
  });
}

/* ------------------------------------------------------------------ */
/* Platform / school stats                                             */
/* ------------------------------------------------------------------ */

export interface GrowthSchoolStats {
  schoolId: string | null;
  schoolName: string;
  teachers: number;
  eligible: number;
  certificates: number;
  /** Hours accumulated in the ACTIVE academic year (real completions). */
  hoursThisYear: number;
  /** Mean of the teachers' completion percentages (0 when empty). */
  avgCompletion: number;
  levelCounts: Record<GrowthLevelId, number>;
}

export interface PlatformGrowthStats {
  academicYear: string;
  targetHours: number;
  totals: {
    teachers: number;
    eligible: number;
    certificates: number;
    hoursThisYear: number;
    avgCompletion: number;
  };
  byLevel: Array<{ id: GrowthLevelId; nameAr: string; count: number }>;
  schools: GrowthSchoolStats[];
}

/**
 * Aggregated growth statistics for the /growth landing page. `schoolId`
 * narrows everything to one school (office manager); null = platform.
 */
export async function getPlatformGrowthStats(
  schoolId?: string | null
): Promise<PlatformGrowthStats> {
  const academicYear = await getActiveAcademicYear();

  const [teachers, yearCompletions] = await Promise.all([
    db.user.findMany({
      where: { role: "TEACHER", ...(schoolId ? { schoolId } : {}) },
      select: growthTeacherSelect,
      orderBy: { name: "asc" },
    }),
    db.courseCompletion.findMany({
      where: { academicYear },
      select: { hours: true, user: { select: { id: true, schoolId: true } } },
    }),
  ]);

  const rows = await buildGrowthRows(teachers);

  const hoursByTeacher = new Map<string, number>();
  for (const completion of yearCompletions) {
    if (schoolId && completion.user.schoolId !== schoolId) continue;
    hoursByTeacher.set(
      completion.user.id,
      (hoursByTeacher.get(completion.user.id) ?? 0) + Number(completion.hours ?? 0)
    );
  }

  const emptyLevels = (): Record<GrowthLevelId, number> => ({
    T0: 0, T1: 0, T2: 0, T3: 0, T4: 0, T5: 0,
  });

  const schools = new Map<string, GrowthSchoolStats>();
  for (const row of rows) {
    const key = row.teacher.schoolId ?? "platform";
    let bucket = schools.get(key);
    if (!bucket) {
      bucket = {
        schoolId: row.teacher.schoolId,
        schoolName: row.teacher.schoolName ?? "غير محدد",
        teachers: 0,
        eligible: 0,
        certificates: 0,
        hoursThisYear: 0,
        avgCompletion: 0,
        levelCounts: emptyLevels(),
      };
      schools.set(key, bucket);
    }
    bucket.teachers += 1;
    if (row.eligible) bucket.eligible += 1;
    bucket.certificates += row.stats.certificates;
    bucket.hoursThisYear += hoursByTeacher.get(row.teacher.id) ?? 0;
    bucket.avgCompletion += row.stats.percent;
    bucket.levelCounts[row.currentLevel] += 1;
  }

  const schoolList = [...schools.values()].map((bucket) => ({
    ...bucket,
    hoursThisYear: Math.round(bucket.hoursThisYear * 10) / 10,
    avgCompletion:
      bucket.teachers === 0
        ? 0
        : Math.round(bucket.avgCompletion / bucket.teachers),
  }));
  schoolList.sort((a, b) => a.schoolName.localeCompare(b.schoolName, "ar"));

  const byLevel = GROWTH_LEVELS.map((level) => ({
    id: level.id,
    nameAr: level.nameAr,
    count: schoolList.reduce((sum, bucket) => sum + bucket.levelCounts[level.id], 0),
  }));

  const totalTeachers = rows.length;
  const totalPercent = rows.reduce((sum, row) => sum + row.stats.percent, 0);

  return {
    academicYear,
    targetHours: ANNUAL_HOURS_TARGET,
    totals: {
      teachers: totalTeachers,
      eligible: rows.filter((row) => row.eligible).length,
      certificates: rows.reduce((sum, row) => sum + row.stats.certificates, 0),
      hoursThisYear:
        Math.round(
          [...hoursByTeacher.values()].reduce((sum, hours) => sum + hours, 0) * 10
        ) / 10,
      avgCompletion:
        totalTeachers === 0 ? 0 : Math.round(totalPercent / totalTeachers),
    },
    byLevel,
    schools: schoolList,
  };
}

/* ------------------------------------------------------------------ */
/* One teacher — full projection                                       */
/* ------------------------------------------------------------------ */

export interface TeacherGrowthProjectionCourse {
  id: string;
  titleAr: string;
  hours: number | null;
  status: string;
  completed: boolean;
  completedAt: Date | null;
  bestPercentage: number | null;
  certificateId: string | null;
}

export interface TeacherGrowthProjectionAssessment {
  id: string;
  titleAr: string;
  status: string;
  attempts: number;
  bestPercentage: number | null;
  passed: boolean | null;
  lastAttemptAt: Date | null;
}

export interface TeacherGrowthProjectionAssignment {
  id: string;
  titleAr: string;
  status: string;
  dueAt: Date;
  submissionStatus: string | null;
  submittedAt: Date | null;
  score: number | null;
  totalPoints: number;
}

export interface TeacherGrowthProjectionCertificate {
  id: string;
  certificateNumber: string;
  titleAr: string;
  status: string;
  issuedAt: Date;
}

/**
 * The complete growth projection of ONE teacher: ladder position + the
 * 60% gate + the 35-hour annual target + every real learning artifact
 * (courses, assessments, assignments, certificates) + the journey
 * history. Consumed by /growth/[teacherId] and /my-growth.
 */
export interface TeacherGrowthProjection {
  teacher: {
    id: string;
    name: string;
    schoolName: string | null;
    stage: string | null;
    subject: string | null;
  };
  currentLevel: GrowthLevelId;
  currentLabel: string;
  nextLevel: GrowthLevelId | null;
  nextLabel: string | null;
  suggestedLevel: GrowthLevelId;
  suggestedLabel: string;
  completionPercentage: number;
  coursesAssigned: number;
  coursesCompleted: number;
  eligible: boolean;
  academicYear: string;
  hoursCompleted: number;
  hoursTarget: number;
  hoursPercent: number;
  courses: TeacherGrowthProjectionCourse[];
  assessments: TeacherGrowthProjectionAssessment[];
  assignments: TeacherGrowthProjectionAssignment[];
  certificates: TeacherGrowthProjectionCertificate[];
  history: GrowthHistoryEvent[];
}

/** Assessments the teacher can actually see (course-bound + school-wide). */
async function teacherVisibleAssessments(teacherId: string, schoolId: string | null) {
  return db.assessment.findMany({
    where: {
      status: "PUBLISHED",
      OR: [
        ...(schoolId ? [{ schoolId }] : []),
        { course: { completions: { some: { userId: teacherId } } } },
      ],
    },
    select: {
      id: true,
      titleAr: true,
      status: true,
      attempts: {
        where: { userId: teacherId },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          status: true,
          percentage: true,
          passed: true,
          submittedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getTeacherGrowth(
  teacherId: string
): Promise<TeacherGrowthProjection | null> {
  const teacher = await db.user.findUnique({
    where: { id: teacherId },
    select: growthTeacherSelect,
  });
  if (!teacher || teacher.role !== "TEACHER") return null;

  const [rows, hours, history] = await Promise.all([
    buildGrowthRows([teacher]),
    teacherHoursSummary(teacherId),
    teacherGrowthHistory(teacherId, 20),
  ]);
  const row = rows[0];
  if (!row) return null;

  // Assigned published courses (platform-wide + own school), HTML parity.
  const assignedCourses = await db.course.findMany({
    where: {
      status: "PUBLISHED",
      OR: [{ schoolId: null }, ...(teacher.schoolId ? [{ schoolId: teacher.schoolId }] : [])],
    },
    select: { id: true, titleAr: true, estimatedHours: true, status: true },
    orderBy: { createdAt: "desc" },
  });

  const completions = await db.courseCompletion.findMany({
    where: { userId: teacherId, courseId: { in: assignedCourses.map((course) => course.id) } },
    select: {
      courseId: true,
      completedAt: true,
      bestPercentage: true,
      certificateId: true,
    },
  });
  const completionByCourse = new Map(completions.map((item) => [item.courseId, item]));

  const assessments = await teacherVisibleAssessments(teacherId, teacher.schoolId);
  const assignments = teacher.schoolId
    ? await db.assignment.findMany({
        where: {
          schoolId: teacher.schoolId,
          status: { in: ["PUBLISHED", "CLOSED"] },
          OR: [
            { audienceMode: "ALL_TEACHERS" },
            {
              audienceMode: "TEACHERS",
              targetTeacherIdsJson: { contains: teacher.id },
            },
            ...(teacher.branchId
              ? [{ audienceMode: "BRANCHES", targetBranchIdsJson: { contains: teacher.branchId } }]
              : []),
          ],
        },
        select: {
          id: true,
          titleAr: true,
          status: true,
          dueAt: true,
          totalPoints: true,
          submissions: {
            where: { teacherId },
            select: { status: true, submittedAt: true, scoreTotal: true },
          },
        },
        orderBy: { dueAt: "desc" },
        take: 50,
      })
    : [];

  const certificates = await db.certificate.findMany({
    where: { teacherId },
    orderBy: { issuedAt: "desc" },
    take: 20,
    select: {
      id: true,
      certificateNumber: true,
      titleAr: true,
      status: true,
      issuedAt: true,
    },
  });

  return {
    teacher: {
      id: teacher.id,
      name: teacher.name,
      schoolName: teacher.school?.nameAr ?? null,
      stage: teacher.stage,
      subject: teacher.subject,
    },
    currentLevel: row.currentLevel,
    currentLabel: growthLevelLabel(row.currentLevel),
    nextLevel: row.nextLevel,
    nextLabel: row.nextLevel ? growthLevelLabel(row.nextLevel) : null,
    suggestedLevel: row.suggestedLevel,
    suggestedLabel: growthLevelLabel(row.suggestedLevel),
    completionPercentage: row.stats.percent,
    coursesAssigned: row.stats.assigned,
    coursesCompleted: row.stats.completed,
    eligible: row.eligible,
    academicYear: hours.academicYear,
    hoursCompleted: hours.hours,
    hoursTarget: hours.target,
    hoursPercent: hours.percent,
    courses: assignedCourses.map((course) => {
      const completion = completionByCourse.get(course.id);
      return {
        id: course.id,
        titleAr: course.titleAr,
        hours: course.estimatedHours,
        status: course.status,
        completed: Boolean(completion),
        completedAt: completion?.completedAt ?? null,
        bestPercentage: completion?.bestPercentage ?? null,
        certificateId: completion?.certificateId ?? null,
      };
    }),
    assessments: assessments.map((assessment) => {
      const graded = assessment.attempts.filter(
        (attempt) => attempt.percentage !== null
      );
      const best = graded.reduce<number | null>(
        (best, attempt) =>
          best === null || (attempt.percentage ?? 0) > best
            ? (attempt.percentage ?? 0)
            : best,
        null
      );
      return {
        id: assessment.id,
        titleAr: assessment.titleAr,
        status: assessment.status,
        attempts: assessment.attempts.length,
        bestPercentage: best,
        passed: graded.some((attempt) => attempt.passed === true),
        lastAttemptAt: assessment.attempts[0]?.submittedAt ?? null,
      };
    }),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      titleAr: assignment.titleAr,
      status: assignment.status,
      dueAt: assignment.dueAt,
      submissionStatus: assignment.submissions[0]?.status ?? null,
      submittedAt: assignment.submissions[0]?.submittedAt ?? null,
      score: assignment.submissions[0]?.scoreTotal ?? null,
      totalPoints: assignment.totalPoints,
    })),
    certificates: certificates.map((certificate) => ({
      id: certificate.id,
      certificateNumber: certificate.certificateNumber,
      titleAr: certificate.titleAr,
      status: certificate.status,
      issuedAt: certificate.issuedAt,
    })),
    history,
  };
}
import { db } from "@/lib/db";
import { getActiveAcademicYear } from "@/lib/academic-year";
import { canAdministerSchool } from "@/lib/auth/roles";
import { yearTeacherRows } from "@/lib/training/hours";

/* ------------------------------------------------------------------ */
/* Batch 2 — yearly training archives (HTML v26 parity).                */
/*                                                                      */
/* v26ArchiveYear snapshot-copied { courses, completions, certs } for   */
/* the academic year; v26StartYear moved the active year forward. Both  */
/* are implemented here against REAL rows: the snapshot is an immutable */
/* JSON payload stored on the TrainingArchive row (unique per year —    */
/* re-archiving a year REPLACES its snapshot, exactly like the HTML     */
/* state object did). Year boundaries never lose data.                  */
/*                                                                      */
/* Permissions: canAdministerSchool (SUPER_ADMIN / OFFICE) for every    */
/* write; the office is confined to its own school.                     */
/* ------------------------------------------------------------------ */

export interface ArchiveActor {
  id: string;
  role: string;
  schoolId: string | null;
}

export type ArchiveServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code?: "FORBIDDEN" | "VALIDATION_ERROR" | "NOT_FOUND" };

export interface ArchiveSnapshot {
  archivedAt: string;
  academicYear: string;
  schoolId: string | null;
  courses: Array<{
    id: string;
    titleAr: string;
    category: string;
    hours: number | null;
    status: string;
  }>;
  completions: Array<{
    id: string;
    courseId: string;
    userId: string;
    teacherName: string;
    hours: number | null;
    bestPercentage: number | null;
    completedAt: string;
    certificateId: string | null;
  }>;
  certificates: Array<{
    id: string;
    certificateNumber: string;
    teacherName: string;
    titleAr: string;
    status: string;
    issuedAt: string;
  }>;
}

export interface ArchiveSummaryRow {
  id: string;
  academicYear: string;
  archivedAt: Date;
  coursesCount: number;
  completionsCount: number;
  certificatesCount: number;
}

function actorScope(actor: ArchiveActor): string | null | "FORBIDDEN" {
  if (actor.role === "SUPER_ADMIN") return null; // platform-wide
  if (actor.role === "DEVELOPMENT_OFFICE_MANAGER" && actor.schoolId) {
    return actor.schoolId;
  }
  return "FORBIDDEN";
}

/**
 * Archive one academic year for the actor's scope. The snapshot is
 * derived from persisted completions (and their certificates) of that
 * year — the same rows the yearly table shows, frozen verbatim.
 */
export async function archiveYear(
  actor: ArchiveActor,
  year: string
): Promise<ArchiveServiceResult<ArchiveSummaryRow>> {
  const scope = actorScope(actor);
  if (scope === "FORBIDDEN") {
    return { ok: false, message: "الأرشفة السنوية متاحة لإدارة المدرسة فقط", code: "FORBIDDEN" };
  }

  const completions = await db.courseCompletion.findMany({
    where: { academicYear: year },
    select: {
      id: true,
      courseId: true,
      userId: true,
      hours: true,
      bestPercentage: true,
      completedAt: true,
      certificateId: true,
      user: { select: { name: true, schoolId: true } },
    },
  });
  const scoped = completions.filter(
    (completion) => scope === null || completion.user.schoolId === scope
  );

  const courseIds = [...new Set(scoped.map((completion) => completion.courseId))];
  const courses = await db.course.findMany({
    where: { id: { in: courseIds } },
    select: { id: true, titleAr: true, category: true, estimatedHours: true, status: true },
  });

  const certificateIds = [
    ...new Set(
      scoped
        .map((completion) => completion.certificateId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const certificates = await db.certificate.findMany({
    where: { id: { in: certificateIds } },
    select: {
      id: true,
      certificateNumber: true,
      titleAr: true,
      status: true,
      issuedAt: true,
      teacher: { select: { name: true } },
    },
  });

  const snapshot: ArchiveSnapshot = {
    archivedAt: new Date().toISOString(),
    academicYear: year,
    schoolId: scope,
    courses: courses.map((course) => ({
      id: course.id,
      titleAr: course.titleAr,
      category: course.category,
      hours: course.estimatedHours,
      status: course.status,
    })),
    completions: scoped.map((completion) => ({
      id: completion.id,
      courseId: completion.courseId,
      userId: completion.userId,
      teacherName: completion.user.name,
      hours: completion.hours,
      bestPercentage: completion.bestPercentage,
      completedAt: completion.completedAt.toISOString(),
      certificateId: completion.certificateId,
    })),
    certificates: certificates.map((certificate) => ({
      id: certificate.id,
      certificateNumber: certificate.certificateNumber,
      teacherName: certificate.teacher.name,
      titleAr: certificate.titleAr,
      status: certificate.status,
      issuedAt: certificate.issuedAt.toISOString(),
    })),
  };

  const scopeKey = archiveScopeKey(year, scope);
  const saved = await db.trainingArchive.upsert({
    where: { scopeKey },
    create: {
      academicYear: year,
      schoolId: scope,
      scopeKey,
      coursesCount: snapshot.courses.length,
      completionsCount: snapshot.completions.length,
      certificatesCount: snapshot.certificates.length,
      payloadJson: JSON.stringify(snapshot),
      createdById: actor.id,
    },
    update: {
      archivedAt: new Date(),
      coursesCount: snapshot.courses.length,
      completionsCount: snapshot.completions.length,
      certificatesCount: snapshot.certificates.length,
      payloadJson: JSON.stringify(snapshot),
      createdById: actor.id,
    },
  });

  return {
    ok: true,
    data: {
      id: saved.id,
      academicYear: saved.academicYear,
      archivedAt: saved.archivedAt,
      coursesCount: saved.coursesCount,
      completionsCount: saved.completionsCount,
      certificatesCount: saved.certificatesCount,
    },
  };
}

/**
 * The archive list (أعوام مؤرشفة) — filtered by the actor's scope
 * column directly (no JSON parsing): SUPER_ADMIN sees every archive;
 * the office sees only its own school's archives.
 */
export async function listArchives(
  actor: ArchiveActor
): Promise<ArchiveServiceResult<ArchiveSummaryRow[]>> {
  const scope = actorScope(actor);
  if (scope === "FORBIDDEN") {
    return { ok: false, message: "السجل التدريبي متاح لإدارة المدرسة فقط", code: "FORBIDDEN" };
  }
  const rows = await db.trainingArchive.findMany({
    where: scope === null ? {} : { schoolId: scope },
    orderBy: [{ academicYear: "desc" }, { archivedAt: "desc" }],
  });
  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      academicYear: row.academicYear,
      archivedAt: row.archivedAt,
      coursesCount: row.coursesCount,
      completionsCount: row.completionsCount,
      certificatesCount: row.certificatesCount,
    })),
  };
}

/** One archive with its full payload (archive detail view). */
export async function getArchive(
  actor: ArchiveActor,
  year: string
): Promise<ArchiveServiceResult<{ summary: ArchiveSummaryRow; snapshot: ArchiveSnapshot }>> {
  const scope = actorScope(actor);
  if (scope === "FORBIDDEN") {
    return { ok: false, message: "السجل التدريبي متاح لإدارة المدرسة فقط", code: "FORBIDDEN" };
  }
  const row = await db.trainingArchive.findUnique({
    where: { scopeKey: archiveScopeKey(year, scope) },
  });
  if (!row) return { ok: false, message: "لا يوجد أرشيف لهذا العام", code: "NOT_FOUND" };
  let snapshot: ArchiveSnapshot;
  try {
    snapshot = JSON.parse(row.payloadJson) as ArchiveSnapshot;
  } catch {
    return { ok: false, message: "بيانات الأرشيف تالفة", code: "NOT_FOUND" };
  }
  return {
    ok: true,
    data: {
      summary: {
        id: row.id,
        academicYear: row.academicYear,
        archivedAt: row.archivedAt,
        coursesCount: row.coursesCount,
        completionsCount: row.completionsCount,
        certificatesCount: row.certificatesCount,
      },
      snapshot,
    },
  };
}

/**
 * Start a new academic year (HTML v26StartYear) — moves the ACTIVE
 * year forward; completions stamped afterwards belong to the new year.
 */
export async function startAcademicYear(
  actor: ArchiveActor,
  year: string
): Promise<ArchiveServiceResult<{ year: string; previousYear: string }>> {
  if (!canAdministerSchool(actor.role)) {
    return { ok: false, message: "اعتماد عام دراسي جديد متاح للإدارة فقط", code: "FORBIDDEN" };
  }
  const { setActiveAcademicYear } = await import("@/lib/academic-year");
  const previousYear = await getActiveAcademicYear();
  const result = await setActiveAcademicYear(year);
  if (!result.ok) {
    return { ok: false, message: result.message, code: "VALIDATION_ERROR" };
  }
  return { ok: true, data: { year: result.year, previousYear } };
}

/** The current-year table for the archive page (real rows, scoped). */
export async function currentYearTable(actor: ArchiveActor): Promise<{
  year: string;
  rows: Awaited<ReturnType<typeof yearTeacherRows>>;
}> {
  const scope = actorScope(actor);
  const year = await getActiveAcademicYear();
  if (scope === "FORBIDDEN") {
    return { year, rows: [] };
  }
  const rows = await yearTeacherRows(year, scope);
  return { year, rows };
}

function archiveScopeKey(year: string, scope: string | null): string {
  return `${year}|${scope ?? "platform"}`;
}
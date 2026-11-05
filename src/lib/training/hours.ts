import { db } from "@/lib/db";
import { ANNUAL_HOURS_TARGET, annualHoursPercent } from "@/config/growth";
import { getActiveAcademicYear } from "@/lib/academic-year";

/* ------------------------------------------------------------------ */
/* Batch 2 — annual training hours & the 35-hour yearly target.         */
/*                                                                      */
/* The HTML counted a teacher's hours as the sum of completed-course    */
/* hours (completion.hours, the original completion record field). The  */
/* Next.js engine snapshots the same value into CourseCompletion.hours  */
/* and stamps every completion with the ACTIVE ACADEMIC YEAR, so the    */
/* yearly view, the 35-hour target and the archive are all computed     */
/* from REAL persisted rows — never from client input.                  */
/* ------------------------------------------------------------------ */

export interface TeacherHoursSummary {
  academicYear: string;
  hours: number;
  target: number;
  percent: number;
  completions: number;
  /** Per-year totals across the teacher's whole history (newest first). */
  byYear: Array<{ academicYear: string; hours: number; completions: number }>;
}

/** The teacher's own annual summary (teacher home + /reports view). */
export async function teacherHoursSummary(
  teacherId: string
): Promise<TeacherHoursSummary> {
  const academicYear = await getActiveAcademicYear();

  const grouped = await db.courseCompletion.groupBy({
    by: ["academicYear"],
    where: { userId: teacherId },
    _sum: { hours: true },
    _count: { _all: true },
  });

  const byYear = grouped
    .map((row) => ({
      academicYear: row.academicYear ?? "غير محدد",
      hours: Math.round((row._sum.hours ?? 0) * 10) / 10,
      completions: row._count._all,
    }))
    .sort((a, b) => b.academicYear.localeCompare(a.academicYear, "ar"));

  const current = grouped.find((row) => (row.academicYear ?? "") === academicYear);
  const hours = Math.round((current?._sum.hours ?? 0) * 10) / 10;

  return {
    academicYear,
    hours,
    target: ANNUAL_HOURS_TARGET,
    percent: annualHoursPercent(hours),
    completions: current?._count._all ?? 0,
    byYear,
  };
}

export interface YearTeacherRow {
  teacherId: string;
  teacherName: string;
  schoolName: string | null;
  completions: number;
  hours: number;
  academicYear: string;
}

/**
 * The per-teacher table of the yearly record page (HTML
 * v26TrainingArchivePage): كل معلم — عدد الدورات المكتملة والساعات
 * للعام الدراسي المحدد. `schoolId = null` means the whole platform
 * (SUPER_ADMIN view).
 */
export async function yearTeacherRows(
  year: string,
  schoolId: string | null
): Promise<YearTeacherRow[]> {
  const completions = await db.courseCompletion.findMany({
    where: { academicYear: year },
    select: {
      hours: true,
      user: { select: { id: true, name: true, schoolId: true, school: { select: { nameAr: true } } } },
    },
  });

  const byTeacher = new Map<string, YearTeacherRow>();
  for (const completion of completions) {
    if (schoolId && completion.user.schoolId !== schoolId) continue;
    const existing = byTeacher.get(completion.user.id);
    if (existing) {
      existing.completions += 1;
      existing.hours = Math.round((existing.hours + Number(completion.hours ?? 0)) * 10) / 10;
    } else {
      byTeacher.set(completion.user.id, {
        teacherId: completion.user.id,
        teacherName: completion.user.name,
        schoolName: completion.user.school?.nameAr ?? null,
        completions: 1,
        hours: Math.round(Number(completion.hours ?? 0) * 10) / 10,
        academicYear: year,
      });
    }
  }

  return [...byTeacher.values()].sort((a, b) => b.hours - a.hours);
}

export interface AnnualSchoolSummary {
  academicYear: string;
  target: number;
  teachersWithHours: number;
  totalHours: number;
  totalCompletions: number;
  /** Teachers who reached the 35-hour target this year. */
  reachedTarget: number;
  /** Completion percentage of the target averaged over active teachers. */
  averagePercent: number;
}

/**
 * School / platform aggregate for the reports hub — the 35-hour target
 * attainment computed from real completions.
 */
export async function annualSummary(
  schoolId: string | null
): Promise<AnnualSchoolSummary> {
  const academicYear = await getActiveAcademicYear();

  const completions = await db.courseCompletion.findMany({
    where: { academicYear },
    select: { userId: true, hours: true, user: { select: { schoolId: true } } },
  });

  const perTeacher = new Map<string, number>();
  for (const completion of completions) {
    if (schoolId && completion.user.schoolId !== schoolId) continue;
    perTeacher.set(
      completion.userId,
      (perTeacher.get(completion.userId) ?? 0) + Number(completion.hours ?? 0)
    );
  }

  const teachersWithHours = perTeacher.size;
  const totalHours =
    Math.round([...perTeacher.values()].reduce((sum, hours) => sum + hours, 0) * 10) / 10;
  const reachedTarget = [...perTeacher.values()].filter(
    (hours) => hours >= ANNUAL_HOURS_TARGET
  ).length;
  const averagePercent =
    teachersWithHours === 0
      ? 0
      : Math.round(
          [...perTeacher.values()].reduce(
            (sum, hours) => sum + annualHoursPercent(hours),
            0
          ) / teachersWithHours
        );

  return {
    academicYear,
    target: ANNUAL_HOURS_TARGET,
    teachersWithHours,
    totalHours,
    totalCompletions: schoolId
      ? completions.filter((completion) => completion.user.schoolId === schoolId).length
      : completions.length,
    reachedTarget,
    averagePercent,
  };
}
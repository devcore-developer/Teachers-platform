import { db } from "@/lib/db";
import { growthLevelLabel } from "@/config/growth";
import { toCsv } from "@/lib/reports/csv";

/* ------------------------------------------------------------------ */
/* Batch 2 — real-data report datasets (HTML v11/v13/v14 parity).       */
/*                                                                      */
/* Every dataset below is built from the DATABASE inside the actor's    */
/* tenant — the exact original columns and file names, no mock rows:    */
/*   - Qurtuba_Training_Report.csv  (المعلم/الدورة/المشرف/النتيجة/…)     */
/*   - Qurtuba_Teachers.csv         (المعرف/المعلم/المدرسة/…/المشرف/…)   */
/*   - Qurtuba_Courses.csv          (الدورة/المشرف/المدرسة/…/الحالة)     */
/*   - Qurtuba_Supervisor_Teachers_Analytics.csv (v13 analytics)         */
/*   - Qurtuba_Manara_Report.json   (the full bundle, same keys)         */
/*   - Qurtuba_User_Accounts.csv    (v14 — WITHOUT passwords: the       */
/*     original exported plaintext passwords, which is a vulnerability; */
/*     the secure version omits the password column deliberately).      */
/* ------------------------------------------------------------------ */

export type ReportActor =
  | { role: "SUPER_ADMIN"; id: string; schoolId: string | null }
  | { role: "DEVELOPMENT_OFFICE_MANAGER"; id: string; schoolId: string }
  | { role: "EDUCATIONAL_SUPERVISOR"; id: string; schoolId: string | null };

/** Tenant filter for office/admin reports (null = whole platform). */
function schoolWhere(actor: ReportActor, schoolId?: string | null) {
  if (actor.role === "DEVELOPMENT_OFFICE_MANAGER") {
    return { schoolId: actor.schoolId };
  }
  if (actor.role === "EDUCATIONAL_SUPERVISOR") {
    return { schoolId: actor.schoolId ?? undefined };
  }
  return schoolId ? { schoolId } : {};
}

export type ReportFormat = "csv" | "json";

export interface ReportFile {
  filename: string;
  mime: string;
  body: string;
}

/* ------------------------- Training report ------------------------ */

/** v11ExportCSV — one row per course completion. */
export async function buildTrainingReport(actor: ReportActor): Promise<ReportFile> {
  const completions = await db.courseCompletion.findMany({
    where: { user: schoolWhere(actor) },
    orderBy: { completedAt: "desc" },
    select: {
      hours: true,
      bestPercentage: true,
      completedAt: true,
      certificateId: true,
      user: { select: { name: true, teacherSupervision: { select: { supervisor: { select: { name: true } } } } } },
      course: { select: { titleAr: true, school: { select: { nameAr: true } }, instructor: { select: { name: true } } } },
    },
    take: 5000,
  });

  const rows: Array<Array<string | number | null>> = [
    ["المعلم", "الدورة", "المشرف", "المدرسة", "النتيجة", "الساعات", "الشهادة", "التاريخ"],
  ];
  for (const completion of completions) {
    rows.push([
      completion.user.name,
      completion.course?.titleAr ?? "—",
      completion.user.teacherSupervision?.supervisor.name ?? completion.course?.instructor?.name ?? "",
      completion.course?.school?.nameAr ?? "",
      completion.bestPercentage ?? "",
      completion.hours ?? "",
      completion.certificateId ?? "",
      completion.completedAt.toISOString().slice(0, 10),
    ]);
  }

  return {
    filename: "Qurtuba_Training_Report.csv",
    mime: "text/csv",
    body: toCsv(rows),
  };
}

/* --------------------------- Teachers ----------------------------- */

/** v11ExportTeachersCSV — the teacher directory with real stats. */
export async function buildTeachersReport(actor: ReportActor): Promise<ReportFile> {
  const teachers = await db.user.findMany({
    where: { role: "TEACHER", ...schoolWhere(actor) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      school: { select: { nameAr: true } },
      stage: true,
      subject: true,
      growthLevel: true,
      isActive: true,
      teacherSupervision: { select: { supervisor: { select: { name: true } } } },
      courseCompletions: { select: { hours: true } },
      certificates: { where: { status: "ISSUED" }, select: { id: true } },
    },
    take: 5000,
  });

  const rows: Array<Array<string | number | null>> = [
    ["المعرف", "المعلم", "المدرسة", "المرحلة", "التخصص", "المشرف", "الدورات المكتملة", "الساعات", "الشهادات", "المستوى", "الحالة"],
  ];
  for (const teacher of teachers) {
    rows.push([
      teacher.id,
      teacher.name,
      teacher.school?.nameAr ?? "",
      teacher.stage ?? "",
      teacher.subject ?? "",
      teacher.teacherSupervision?.supervisor.name ?? "",
      teacher.courseCompletions.length,
      Math.round(
        teacher.courseCompletions.reduce(
          (sum, completion) => sum + Number(completion.hours ?? 0),
          0
        ) * 10
      ) / 10,
      teacher.certificates.length,
      growthLevelLabel(teacher.growthLevel),
      teacher.isActive ? "نشط" : "موقوف",
    ]);
  }

  return {
    filename: "Qurtuba_Teachers.csv",
    mime: "text/csv",
    body: toCsv(rows),
  };
}

/* ---------------------------- Courses ----------------------------- */

/** v11ExportCoursesCSV — the course catalog with completion counts. */
export async function buildCoursesReport(actor: ReportActor): Promise<ReportFile> {
  const courses = await db.course.findMany({
    where: { ...schoolWhere(actor) },
    orderBy: { createdAt: "desc" },
    select: {
      titleAr: true,
      status: true,
      estimatedHours: true,
      category: true,
      school: { select: { nameAr: true } },
      instructor: { select: { name: true } },
      _count: { select: { completions: true, certificates: true, sections: true } },
    },
    take: 5000,
  });

  const rows: Array<Array<string | number | null>> = [
    ["الدورة", "المشرف", "المدرسة", "الفئة", "الساعات", "عدد الأقسام", "الإكمال", "الشهادات", "الحالة"],
  ];
  for (const course of courses) {
    rows.push([
      course.titleAr,
      course.instructor?.name ?? "",
      course.school?.nameAr ?? "",
      course.category,
      course.estimatedHours ?? "",
      course._count.sections,
      course._count.completions,
      course._count.certificates,
      course.status === "PUBLISHED" ? "منشور" : course.status === "DRAFT" ? "مسودة" : "مؤرشف",
    ]);
  }

  return {
    filename: "Qurtuba_Courses.csv",
    mime: "text/csv",
    body: toCsv(rows),
  };
}

/* --------------------- Supervisor analytics ------------------------ */

export interface SupervisorAnalyticsRow {
  teacherId: string;
  teacherName: string;
  schoolName: string;
  assigned: number;
  completed: number;
  percent: number;
  hours: number;
  avgPercentage: number;
  certificates: number;
  level: string;
}

/**
 * v13ExportSupervisorTeachers — the supervisor's assigned-teachers
 * analytics. The supervisor's scope is explicit assignments ∪ branch
 * coverage within their own school; the KPIs mirror the print report.
 */
export async function buildSupervisorAnalytics(
  actor: ReportActor & { role: "EDUCATIONAL_SUPERVISOR" }
): Promise<
  ReportFile & {
    kpis: { teachers: number; courses: number; rate: number; totalHours: number };
    rows: SupervisorAnalyticsRow[];
  }
> {
  const supervisor = await db.user.findUnique({
    where: { id: actor.id },
    select: { schoolId: true, supervisorAssignments: { select: { branchId: true } } },
  });
  const schoolId = supervisor?.schoolId ?? null;
  const branchIds = supervisor?.supervisorAssignments.map((row) => row.branchId) ?? [];

  const teachers = await db.user.findMany({
    where: {
      role: "TEACHER",
      isActive: true,
      ...(schoolId ? { schoolId } : {}),
      OR: [
        { teacherSupervision: { supervisorId: actor.id } },
        ...(branchIds.length > 0 ? [{ branchId: { in: branchIds } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      schoolId: true,
      school: { select: { nameAr: true } },
      growthLevel: true,
      courseCompletions: { select: { courseId: true, hours: true, bestPercentage: true } },
      certificates: { where: { status: "ISSUED" }, select: { id: true } },
    },
    take: 2000,
  });

  const teacherSchoolIds = [
    ...new Set(teachers.map((teacher) => teacher.schoolId).filter(Boolean)),
  ] as string[];
  const platformCourses = await db.course.findMany({
    where: { status: "PUBLISHED", schoolId: null },
    select: { id: true },
  });
  const schoolCourses = teacherSchoolIds.length
    ? await db.course.findMany({
        where: { status: "PUBLISHED", schoolId: { in: teacherSchoolIds } },
        select: { id: true, schoolId: true },
      })
    : [];

  const rows: SupervisorAnalyticsRow[] = teachers.map((teacher) => {
    const assignedIds = new Set(platformCourses.map((course) => course.id));
    for (const course of schoolCourses) {
      if (course.schoolId === teacher.schoolId) assignedIds.add(course.id);
    }
    const done = teacher.courseCompletions.filter((completion) => assignedIds.has(completion.courseId));
    const percent = assignedIds.size
      ? Math.round((done.length / assignedIds.size) * 100)
      : 0;
    const hours =
      Math.round(
        teacher.courseCompletions.reduce((sum, completion) => sum + Number(completion.hours ?? 0), 0) * 10
      ) / 10;
    const percentages = teacher.courseCompletions
      .map((completion) => completion.bestPercentage)
      .filter((value): value is number => typeof value === "number");
    const avg = percentages.length
      ? Math.round((percentages.reduce((sum, value) => sum + value, 0) / percentages.length) * 10) / 10
      : 0;
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      schoolName: teacher.school?.nameAr ?? "",
      assigned: assignedIds.size,
      completed: done.length,
      percent,
      hours,
      avgPercentage: avg,
      certificates: teacher.certificates.length,
      level: growthLevelLabel(teacher.growthLevel),
    };
  });
  rows.sort((a, b) => a.teacherName.localeCompare(b.teacherName, "ar"));

  const totalAssigned = rows.reduce((sum, row) => sum + row.assigned, 0);
  const totalCompleted = rows.reduce((sum, row) => sum + row.completed, 0);
  const csvRows: Array<Array<string | number | null>> = [
    ["المعرف", "المعلم", "المدرسة", "الدورات المسندة", "الدورات المكتملة", "نسبة الإنجاز", "الساعات", "متوسط الاختبار", "الشهادات", "المستوى"],
    ...rows.map((row) => [
      row.teacherId,
      row.teacherName,
      row.schoolName,
      row.assigned,
      row.completed,
      `${row.percent}%`,
      row.hours,
      `${row.avgPercentage}%`,
      row.certificates,
      row.level,
    ]),
  ];

  return {
    filename: "Qurtuba_Supervisor_Teachers_Analytics.csv",
    mime: "text/csv",
    body: toCsv(csvRows),
    kpis: {
      teachers: rows.length,
      courses: platformCourses.length + schoolCourses.length,
      rate: totalAssigned ? Math.round((totalCompleted / totalAssigned) * 100) : 0,
      totalHours: Math.round(rows.reduce((sum, row) => sum + row.hours, 0) * 10) / 10,
    },
    rows,
  };
}

/* --------------------------- Accounts ----------------------------- */

/**
 * v14ExportAccounts — the accounts export. SECURITY UPGRADE over the
 * HTML: the original included PLAINTEXT passwords; this export omits
 * them on purpose (passwords are bcrypt hashes and are never exported).
 */
export async function buildAccountsReport(actor: ReportActor): Promise<ReportFile> {
  if (actor.role === "EDUCATIONAL_SUPERVISOR") {
    return {
      filename: "Qurtuba_User_Accounts.csv",
      mime: "text/csv",
      body: toCsv([["غير مصرح"]]),
    };
  }
  const accounts = await db.user.findMany({
    where: schoolWhere(actor),
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      name: true,
      role: true,
      email: true,
      isActive: true,
      lastLoginAt: true,
      school: { select: { nameAr: true } },
    },
    take: 5000,
  });

  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: "مدير المنصة",
    DEVELOPMENT_OFFICE_MANAGER: "مدير مكتب التطوير",
    EDUCATIONAL_DEPUTY: "الوكيل التعليمي",
    EDUCATIONAL_SUPERVISOR: "المشرف التربوي",
    TEACHER: "معلم",
  };

  const rows: Array<Array<string | number | null>> = [
    ["الاسم", "الصلاحية", "البريد الإلكتروني", "المدرسة", "الحالة", "آخر دخول"],
  ];
  for (const account of accounts) {
    rows.push([
      account.name,
      roleLabels[account.role] ?? account.role,
      account.email,
      account.school?.nameAr ?? "",
      account.isActive ? "نشط" : "موقوف",
      account.lastLoginAt ? account.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") : "لم يسجل الدخول",
    ]);
  }

  return {
    filename: "Qurtuba_User_Accounts.csv",
    mime: "text/csv",
    body: toCsv(rows),
  };
}

/* -------------------------- JSON bundle --------------------------- */

/** v11ExportJSON — the full bundle with the ORIGINAL top-level keys. */
export async function buildBundleReport(actor: ReportActor): Promise<ReportFile> {
  const where = schoolWhere(actor);

  const [teachers, supervisors, courses, completions, certificates, impactResponses] =
    await Promise.all([
      db.user.findMany({
        where: { role: "TEACHER", ...where },
        select: {
          id: true,
          name: true,
          email: true,
          stage: true,
          subject: true,
          growthLevel: true,
          isActive: true,
          school: { select: { nameAr: true } },
          teacherSupervision: { select: { supervisor: { select: { name: true } } } },
        },
        take: 5000,
      }),
      db.user.findMany({
        where: { role: "EDUCATIONAL_SUPERVISOR", ...where },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          school: { select: { nameAr: true } },
        },
        take: 2000,
      }),
      db.course.findMany({
        where,
        select: {
          id: true,
          titleAr: true,
          category: true,
          status: true,
          estimatedHours: true,
          school: { select: { nameAr: true } },
          instructor: { select: { name: true } },
        },
        take: 2000,
      }),
      db.courseCompletion.findMany({
        where: { user: where },
        select: {
          id: true,
          courseId: true,
          userId: true,
          hours: true,
          bestPercentage: true,
          academicYear: true,
          completedAt: true,
          certificateId: true,
          user: { select: { name: true } },
          course: { select: { titleAr: true } },
        },
        take: 10000,
      }),
      db.certificate.findMany({
        where: { teacher: where },
        select: {
          id: true,
          certificateNumber: true,
          titleAr: true,
          status: true,
          issuedAt: true,
          teacher: { select: { name: true } },
          course: { select: { titleAr: true } },
        },
        take: 10000,
      }),
      db.surveyResponse.findMany({
        where: { schoolId: actor.role === "DEVELOPMENT_OFFICE_MANAGER" ? actor.schoolId : undefined },
        select: {
          id: true,
          status: true,
          submittedAt: true,
          respondent: { select: { name: true } },
          survey: { select: { titleAr: true, course: { select: { titleAr: true } } } },
        },
        take: 10000,
      }),
    ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    teachers: teachers.map((teacher) => ({
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      school: teacher.school?.nameAr ?? "",
      stage: teacher.stage ?? "",
      subject: teacher.subject ?? "",
      supervisor: teacher.teacherSupervision?.supervisor.name ?? "",
      growthLevel: growthLevelLabel(teacher.growthLevel),
      status: teacher.isActive ? "نشط" : "موقوف",
    })),
    supervisors: supervisors.map((supervisor) => ({
      id: supervisor.id,
      name: supervisor.name,
      email: supervisor.email,
      school: supervisor.school?.nameAr ?? "",
      status: supervisor.isActive ? "نشط" : "موقوف",
    })),
    courses: courses.map((course) => ({
      id: course.id,
      title: course.titleAr,
      trainer: course.instructor?.name ?? "",
      school: course.school?.nameAr ?? "",
      category: course.category,
      hours: course.estimatedHours,
      status: course.status,
    })),
    completions: completions.map((completion) => ({
      id: completion.id,
      teacher: completion.user.name,
      course: completion.course?.titleAr ?? "",
      courseId: completion.courseId,
      hours: completion.hours,
      score: completion.bestPercentage,
      academicYear: completion.academicYear,
      date: completion.completedAt.toISOString().slice(0, 10),
      certId: completion.certificateId,
    })),
    certificates: certificates.map((certificate) => ({
      id: certificate.id,
      serial: certificate.certificateNumber,
      teacher: certificate.teacher.name,
      title: certificate.titleAr,
      course: certificate.course?.titleAr ?? "",
      status: certificate.status,
      issuedAt: certificate.issuedAt.toISOString().slice(0, 10),
    })),
    impactResponses: impactResponses.map((response) => ({
      id: response.id,
      respondent: response.respondent?.name ?? "",
      survey: response.survey?.titleAr ?? "",
      course: response.survey?.course?.titleAr ?? "",
      status: response.status,
      submittedAt: response.submittedAt?.toISOString().slice(0, 10) ?? "",
    })),
  };

  return {
    filename: "Qurtuba_Manara_Report.json",
    mime: "application/json",
    body: JSON.stringify(payload, null, 2),
  };
}

/* ------------------------------------------------------------------ */

/** Re-exported for helpers that need the shared CSV dialect. */
export { toCsv };
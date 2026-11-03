/**
 * Phase 8 — professional growth service: single-teacher projections,
 * role-scoped rosters and platform-wide aggregates.
 *
 * Every number here is derived from PERSISTED data (enrollments,
 * assessment attempts, assignment submissions, certificates) — nothing
 * is invented, cached or duplicated into an independent source of
 * truth. "Course requirements met" reuses the SAME rule as the
 * certificate eligibility engine (imported from the certificates
 * service) so the growth view can never disagree with issuance.
 *
 * Scope rules (server-enforced):
 *   TEACHER               → own projection only.
 *   EDUCATIONAL_SUPERVISOR → assigned teachers only (explicit teacher
 *                            assignment or branch coverage, same
 *                            school).
 *   EDUCATIONAL_DEPUTY     → teachers covered by persisted grants.
 *   DEVELOPMENT_OFFICE_MANAGER → all active teachers of own school.
 *   SUPER_ADMIN            → platform-wide AGGREGATES only (never a
 *                            single teacher's profile).
 */
import type {
  CertificateActor,
  CertificateViewer,
} from "@/lib/certificates/access";
import {
  effectiveStatusOf,
  summarizeAssessments,
} from "@/lib/certificates/service";
import { db } from "@/lib/db";
import {
  GROWTH_HISTORY_LIMIT,
  GROWTH_ROSTER_LIMIT,
  PLATFORM_SCHOOLS_LIMIT,
  type CertificateEffectiveStatus,
} from "@/config/certificates";
import { certificateFail, type CertificateResult } from "@/lib/validation/certificates";
import {
  isTeacherTargeted,
  parseJsonIds,
} from "@/lib/assignments/access";

/* ------------------------------------------------------------------ */
/* Serializable projection shapes                                       */
/* ------------------------------------------------------------------ */

export interface GrowthCourseRow {
  courseId: string;
  courseTitle: string;
  programName: string | null;
  enrolledAt: Date;
  requirementsMet: boolean;
  assessmentsTotal: number;
  assessmentsPassed: number;
  lastActivityAt: Date | null;
}

export interface GrowthAssessmentRow {
  assessmentId: string;
  titleAr: string;
  courseTitle: string;
  attemptsCount: number;
  bestPercentage: number | null;
  passed: boolean;
  lastSubmittedAt: Date | null;
}

export interface GrowthAssignmentRow {
  id: string;
  titleAr: string;
  courseTitle: string | null;
  dueAt: Date;
  myStatus: string | null;
  isLate: boolean | null;
  scoreTotal: number | null;
  totalPoints: number;
}

export interface GrowthCertificateRow {
  id: string;
  certificateNumber: string;
  titleAr: string;
  contentTitle: string | null;
  issuedAt: Date;
  effectiveStatus: CertificateEffectiveStatus;
}

export interface GrowthHistoryEvent {
  date: Date;
  /** ENROLLMENT | ASSESSMENT | ASSIGNMENT | CERTIFICATE */
  type: string;
  label: string;
  detail: string | null;
}

export interface TeacherGrowthTotals {
  coursesEnrolled: number;
  coursesCompleted: number;
  assessmentsPassed: number;
  assessmentsTotal: number;
  assignmentsTargeted: number;
  assignmentsGraded: number;
  certificatesActive: number;
  /** Average of per-assessment best percentages (null when no grades). */
  avgBestPercentage: number | null;
  /** 0..100 average course progress (null when no enrolled courses). */
  overallProgressPercent: number | null;
}

export interface TeacherGrowthProjection {
  teacher: {
    id: string;
    name: string;
    branchName: string | null;
    schoolId: string | null;
  };
  totals: TeacherGrowthTotals;
  courses: GrowthCourseRow[];
  assessments: GrowthAssessmentRow[];
  assignments: GrowthAssignmentRow[];
  certificates: GrowthCertificateRow[];
  history: GrowthHistoryEvent[];
}

export interface GrowthRosterRow {
  teacherId: string;
  teacherName: string;
  branchName: string | null;
  coursesEnrolled: number;
  coursesCompleted: number;
  certificatesActive: number;
  avgBestPercentage: number | null;
}

export interface GrowthRosterData {
  rows: GrowthRosterRow[];
  /** Arabic description of the enforced scope (for the page header). */
  scopeLabel: string;
}

export interface PlatformSchoolRow {
  schoolId: string;
  schoolName: string;
  teachers: number;
  certificatesIssued: number;
  certificatesActive: number;
  assessmentsPassed: number;
  assignmentsGraded: number;
}

export interface PlatformGrowthStats {
  totals: {
    schools: number;
    teachers: number;
    certificatesIssued: number;
    certificatesActive: number;
    assessmentsPassed: number;
    assignmentsGraded: number;
  };
  schools: PlatformSchoolRow[];
}

/* ------------------------------------------------------------------ */
/* Scope checks                                                         */
/* ------------------------------------------------------------------ */

async function supervisorCoversTeacher(
  supervisorId: string,
  schoolId: string,
  teacher: { id: string; schoolId: string | null; branchId: string | null }
): Promise<boolean> {
  if (teacher.schoolId !== schoolId) return false;
  const assigned = await db.teacherSupervisorAssignment.findFirst({
    where: { supervisorId, teacherId: teacher.id },
    select: { id: true },
  });
  if (assigned) return true;
  if (!teacher.branchId) return false;
  const branchGrant = await db.supervisorAssignment.findFirst({
    where: { supervisorId, schoolId, branchId: teacher.branchId },
    select: { id: true },
  });
  return branchGrant !== null;
}

async function deputyCoversTeacher(
  deputyId: string,
  teacher: { schoolId: string | null; branchId: string | null }
): Promise<boolean> {
  if (!teacher.schoolId) return false;
  const grants = await db.deputyGrant.findMany({
    where: { userId: deputyId },
    select: { schoolId: true, branchId: true },
  });
  return grants.some(
    (grant) =>
      grant.schoolId === teacher.schoolId &&
      (grant.branchId === null || grant.branchId === teacher.branchId)
  );
}

/* ------------------------------------------------------------------ */
/* Single-teacher projection                                            */
/* ------------------------------------------------------------------ */

function targetingOf(row: {
  audienceMode: string;
  targetTeacherIdsJson: string | null;
  targetBranchIdsJson: string | null;
}) {
  return {
    audienceMode: row.audienceMode,
    targetTeacherIds: parseJsonIds(row.targetTeacherIdsJson),
    targetBranchIds: parseJsonIds(row.targetBranchIdsJson),
  };
}

function attemptOutcomeLabel(status: string, percentage: number | null): string {
  if (status === "PASSED") {
    return `اجتاز بنسبة ${percentage !== null ? `${percentage}%` : "مكتملة"}`;
  }
  if (status === "FAILED") {
    return `لم يجتز${percentage !== null ? ` (${percentage}%)` : ""}`;
  }
  if (status === "NEEDS_REVIEW") return "بانتظار مراجعة يدوية";
  if (status === "EXPIRED") return "انتهى وقت المحاولة دون تسليم";
  return "محاولة جارية";
}

function submissionOutcomeLabel(
  status: string,
  scoreTotal: number | null,
  totalPoints: number,
  isLate: boolean
): string {
  const late = isLate ? " (متأخر)" : "";
  if (status === "SUBMITTED") return `تم التسليم${late}`;
  if (status === "UNDER_REVIEW") return `قيد المراجعة${late}`;
  if (status === "RETURNED") return "أُعيد للتعديل";
  if (status === "GRADED") {
    return `تم التقييم — الدرجة ${scoreTotal ?? "—"}/${totalPoints}`;
  }
  return status;
}

export async function getTeacherGrowth(
  viewer: CertificateViewer,
  teacherId: string
): Promise<CertificateResult<TeacherGrowthProjection>> {
  const subject = await db.user.findUnique({
    where: { id: teacherId },
    select: {
      id: true,
      name: true,
      role: true,
      schoolId: true,
      branchId: true,
      isActive: true,
      branch: { select: { nameAr: true } },
    },
  });
  if (!subject || subject.role !== "TEACHER") {
    return certificateFail("بيانات النمو المهني غير موجودة", "NOT_FOUND");
  }

  // ---- role/scope enforcement (server-side) -----------------------
  if (viewer.role === "TEACHER") {
    if (viewer.id !== subject.id) {
      return certificateFail(
        "لا تملك صلاحية الاطلاع على النمو المهني لمعلم آخر",
        "FORBIDDEN"
      );
    }
  } else if (viewer.role === "EDUCATIONAL_SUPERVISOR") {
    const covered = await supervisorCoversTeacher(
      viewer.id,
      viewer.schoolId ?? "__none__",
      subject
    );
    if (!covered) {
      return certificateFail(
        "لا تملك صلاحية الاطلاع على نمو هذا المعلم — خارج نطاق إشرافك",
        "FORBIDDEN"
      );
    }
  } else if (viewer.role === "EDUCATIONAL_DEPUTY") {
    const covered = await deputyCoversTeacher(viewer.id, subject);
    if (!covered) {
      return certificateFail(
        "لا تملك صلاحية الاطلاع على نمو هذا المعلم — خارج نطاق التفويض",
        "FORBIDDEN"
      );
    }
  } else if (viewer.role === "DEVELOPMENT_OFFICE_MANAGER") {
    if (!viewer.schoolId || subject.schoolId !== viewer.schoolId) {
      return certificateFail(
        "لا تملك صلاحية الاطلاع على نمو هذا المعلم — النطاق المدرسي مختلف",
        "FORBIDDEN"
      );
    }
  } else {
    // SUPER_ADMIN deliberately gets aggregates only (no per-teacher
    // profile view) and any other role is rejected outright.
    return certificateFail(
      "العرض التجميعي على مستوى المنصة متاح عبر صفحة الإحصاءات",
      "FORBIDDEN"
    );
  }

  // ---- data loading (all persisted, no duplication) ----------------
  const enrollments = await db.courseEnrollment.findMany({
    where: { userId: subject.id },
    include: {
      course: {
        select: {
          id: true,
          titleAr: true,
          status: true,
          program: { select: { nameAr: true } },
        },
      },
    },
    orderBy: { enrolledAt: "desc" },
  });
  const courseIds = enrollments.map((enrollment) => enrollment.course.id);

  const [assessments, certificates, schoolAssignments] = await Promise.all([
    courseIds.length > 0
      ? db.assessment.findMany({
          where: { courseId: { in: courseIds }, status: "PUBLISHED" },
          select: { id: true, titleAr: true, courseId: true },
          orderBy: { titleAr: "asc" },
        })
      : Promise.resolve([]),
    db.certificate.findMany({
      where: { teacherId: subject.id },
      include: {
        course: { select: { titleAr: true } },
        program: { select: { nameAr: true } },
      },
      orderBy: { issuedAt: "desc" },
    }),
    subject.schoolId
      ? db.assignment.findMany({
          where: { schoolId: subject.schoolId, status: { in: ["PUBLISHED", "CLOSED"] } },
          include: {
            course: { select: { titleAr: true } },
            submissions: { where: { teacherId: subject.id } },
          },
          orderBy: { dueAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const assessmentIds = assessments.map((assessment) => assessment.id);
  const attempts =
    assessmentIds.length > 0
      ? await db.assessmentAttempt.findMany({
          where: { userId: subject.id, assessmentId: { in: assessmentIds } },
          select: {
            assessmentId: true,
            status: true,
            passed: true,
            percentage: true,
            submittedAt: true,
            updatedAt: true,
          },
        })
      : [];

  const attemptsByAssessment = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    const list = attemptsByAssessment.get(attempt.assessmentId);
    if (list) list.push(attempt);
    else attemptsByAssessment.set(attempt.assessmentId, [attempt]);
  }

  const courseById = new Map(enrollments.map((enrollment) => [enrollment.course.id, enrollment.course]));
  // Where-clause guarantees bound courses; explicit type refinement
  // (Assessment.courseId is nullable in the schema).
  const boundAssessments: { id: string; titleAr: string; courseId: string }[] = [];
  for (const assessment of assessments) {
    if (assessment.courseId !== null) {
      boundAssessments.push({
        id: assessment.id,
        titleAr: assessment.titleAr,
        courseId: assessment.courseId,
      });
    }
  }
  const assessmentsByCourse = new Map<string, { id: string; titleAr: string }[]>();
  for (const assessment of boundAssessments) {
    const list = assessmentsByCourse.get(assessment.courseId);
    if (list) list.push(assessment);
    else assessmentsByCourse.set(assessment.courseId, [assessment]);
  }

  // ---- course rows -------------------------------------------------
  const courseRows: GrowthCourseRow[] = enrollments.map((enrollment) => {
    const courseAssessments = assessmentsByCourse.get(enrollment.course.id) ?? [];
    const standings = summarizeAssessments(
      courseAssessments,
      courseAssessments.flatMap((assessment) => {
        const list = attemptsByAssessment.get(assessment.id);
        return (list ?? []).map((attempt) => ({
          assessmentId: attempt.assessmentId,
          status: attempt.status,
          passed: attempt.passed,
          percentage: attempt.percentage,
        }));
      })
    );
    const passedCount = standings.filter((standing) => standing.passed).length;
    const activityDates = courseAssessments.flatMap((assessment) => {
      const list = attemptsByAssessment.get(assessment.id);
      return (list ?? []).map(
        (attempt) => attempt.submittedAt ?? attempt.updatedAt
      );
    });
    const lastActivityAt =
      activityDates.length > 0
        ? activityDates.reduce((latest, current) =>
            current.getTime() > latest.getTime() ? current : latest
          )
        : null;
    return {
      courseId: enrollment.course.id,
      courseTitle: enrollment.course.titleAr,
      programName: enrollment.course.program?.nameAr ?? null,
      enrolledAt: enrollment.enrolledAt,
      // Same rule as certificate eligibility: every published assessment
      // bound to the course has a passed attempt (vacuously true when
      // the course has none — no invented completion signals).
      requirementsMet: standings.every((standing) => standing.passed),
      assessmentsTotal: standings.length,
      assessmentsPassed: passedCount,
      lastActivityAt,
    };
  });

  // ---- assessment rows ---------------------------------------------
  const assessmentRows: GrowthAssessmentRow[] = boundAssessments.map((assessment) => {
    const own = attemptsByAssessment.get(assessment.id) ?? [];
    const standings = summarizeAssessments([assessment], own);
    const standing = standings[0];
    const submittedDates = own
      .map((attempt) => attempt.submittedAt)
      .filter((date): date is Date => date !== null);
    return {
      assessmentId: assessment.id,
      titleAr: assessment.titleAr,
      courseTitle: courseById.get(assessment.courseId)?.titleAr ?? "—",
      attemptsCount: own.length,
      bestPercentage: standing.bestPercentage,
      passed: standing.passed,
      lastSubmittedAt:
        submittedDates.length > 0
          ? submittedDates.reduce((latest, current) =>
              current.getTime() > latest.getTime() ? current : latest
            )
          : null,
    };
  });

  // ---- assignment rows (Phase 7 data, server-side targeting) -------
  const assignmentRows: GrowthAssignmentRow[] = schoolAssignments
    .filter((row) =>
      isTeacherTargeted(
        targetingOf(row),
        subject as { id: string; branchId: string | null }
      )
    )
    .map((row) => {
      const submission = row.submissions[0];
      const graded = submission?.status === "GRADED";
      return {
        id: row.id,
        titleAr: row.titleAr,
        courseTitle: row.course?.titleAr ?? null,
        dueAt: row.dueAt,
        myStatus: submission?.status ?? null,
        isLate: submission?.isLate ?? null,
        scoreTotal: graded ? (submission?.scoreTotal ?? null) : null,
        totalPoints: row.totalPoints,
      };
    });

  // ---- certificate rows ---------------------------------------------
  const certificateRows: GrowthCertificateRow[] = certificates.map((certificate) => ({
    id: certificate.id,
    certificateNumber: certificate.certificateNumber,
    titleAr: certificate.titleAr,
    contentTitle: certificate.course?.titleAr ?? certificate.program?.nameAr ?? null,
    issuedAt: certificate.issuedAt,
    effectiveStatus: effectiveStatusOf(certificate),
  }));

  // ---- totals --------------------------------------------------------
  const bestPercentages = assessmentRows
    .map((row) => row.bestPercentage)
    .filter((value): value is number => value !== null);
  const courseProgresses = courseRows
    .map((row) => {
      if (row.requirementsMet) return 100;
      if (row.assessmentsTotal > 0) {
        return Math.round((row.assessmentsPassed / row.assessmentsTotal) * 100);
      }
      return null;
    })
    .filter((value): value is number => value !== null);

  const totals: TeacherGrowthTotals = {
    coursesEnrolled: courseRows.length,
    coursesCompleted: courseRows.filter((row) => row.requirementsMet).length,
    assessmentsPassed: assessmentRows.filter((row) => row.passed).length,
    assessmentsTotal: assessmentRows.length,
    assignmentsTargeted: assignmentRows.length,
    assignmentsGraded: assignmentRows.filter((row) => row.myStatus === "GRADED").length,
    certificatesActive: certificateRows.filter(
      (row) => row.effectiveStatus === "ISSUED"
    ).length,
    avgBestPercentage:
      bestPercentages.length > 0
        ? Math.round(
            bestPercentages.reduce((sum, value) => sum + value, 0) /
              bestPercentages.length
          )
        : null,
    overallProgressPercent:
      courseProgresses.length > 0
        ? Math.round(
            courseProgresses.reduce((sum, value) => sum + value, 0) /
              courseProgresses.length
          )
        : null,
  };

  // ---- chronological history (merged, capped) -----------------------
  const history: GrowthHistoryEvent[] = [];

  for (const enrollment of enrollments) {
    history.push({
      date: enrollment.enrolledAt,
      type: "ENROLLMENT",
      label: `التحاق بدورة «${enrollment.course.titleAr}»`,
      detail: null,
    });
  }

  for (const assessment of assessments) {
    const own = attemptsByAssessment.get(assessment.id) ?? [];
    for (const attempt of own) {
      if (attempt.status === "IN_PROGRESS") continue;
      history.push({
        date: attempt.submittedAt ?? attempt.updatedAt,
        type: "ASSESSMENT",
        label: `تقييم «${assessment.titleAr}»`,
        detail: attemptOutcomeLabel(attempt.status, attempt.percentage),
      });
    }
  }

  for (const row of schoolAssignments) {
    if (!isTeacherTargeted(targetingOf(row), subject as { id: string; branchId: string | null })) {
      continue;
    }
    const submission = row.submissions[0];
    if (!submission || submission.status === "DRAFT") continue;
    history.push({
      date: submission.lastSubmittedAt ?? submission.updatedAt,
      type: "ASSIGNMENT",
      label: `تكليف «${row.titleAr}»`,
      detail: submissionOutcomeLabel(
        submission.status,
        submission.status === "GRADED" ? submission.scoreTotal : null,
        row.totalPoints,
        submission.isLate
      ),
    });
  }

  for (const certificate of certificates) {
    history.push({
      date: certificate.issuedAt,
      type: "CERTIFICATE",
      label: `إصدار شهادة «${certificate.titleAr}»`,
      detail: certificate.status === "REVOKED" ? "أُلغيت لاحقًا" : "صادرة",
    });
  }

  history.sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    ok: true,
    data: {
      teacher: {
        id: subject.id,
        name: subject.name,
        branchName: subject.branch?.nameAr ?? null,
        schoolId: subject.schoolId,
      },
      totals,
      courses: courseRows,
      assessments: assessmentRows,
      assignments: assignmentRows,
      certificates: certificateRows,
      history: history.slice(0, GROWTH_HISTORY_LIMIT),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Growth roster (manager / supervisor / deputy)                        */
/* ------------------------------------------------------------------ */

interface RosterTeacherRow {
  id: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
}

async function loadRosterTeachers(ctx: CertificateActor): Promise<RosterTeacherRow[]> {
  if (ctx.role === "DEVELOPMENT_OFFICE_MANAGER") {
    const teachers = await db.user.findMany({
      where: { schoolId: ctx.schoolId, role: "TEACHER", isActive: true },
      select: { id: true, name: true, branchId: true, branch: { select: { nameAr: true } } },
      orderBy: { name: "asc" },
      take: GROWTH_ROSTER_LIMIT,
    });
    return teachers.map((teacher) => ({
      id: teacher.id,
      name: teacher.name,
      branchId: teacher.branchId,
      branchName: teacher.branch?.nameAr ?? null,
    }));
  }

  if (ctx.role === "EDUCATIONAL_SUPERVISOR") {
    const [assigned, branchGrants] = await Promise.all([
      db.teacherSupervisorAssignment.findMany({
        where: { supervisorId: ctx.id },
        select: { teacherId: true },
      }),
      db.supervisorAssignment.findMany({
        where: { supervisorId: ctx.id },
        select: { branchId: true },
      }),
    ]);
    const assignedIds = assigned.map((row) => row.teacherId);
    const branchIds = branchGrants.map((row) => row.branchId);
    const teachers = await db.user.findMany({
      where: {
        schoolId: ctx.schoolId,
        role: "TEACHER",
        isActive: true,
        OR: [{ id: { in: assignedIds } }, { branchId: { in: branchIds } }],
      },
      select: { id: true, name: true, branchId: true, branch: { select: { nameAr: true } } },
      orderBy: { name: "asc" },
      take: GROWTH_ROSTER_LIMIT,
    });
    return teachers.map((teacher) => ({
      id: teacher.id,
      name: teacher.name,
      branchId: teacher.branchId,
      branchName: teacher.branch?.nameAr ?? null,
    }));
  }

  // EDUCATIONAL_DEPUTY — teachers covered by persisted grants.
  const grants = await db.deputyGrant.findMany({
    where: { userId: ctx.id },
    select: { schoolId: true, branchId: true },
  });
  if (grants.length === 0) return [];
  const schoolIds = Array.from(new Set(grants.map((grant) => grant.schoolId)));
  const candidates = await db.user.findMany({
    where: { schoolId: { in: schoolIds }, role: "TEACHER", isActive: true },
    select: { id: true, name: true, schoolId: true, branchId: true, branch: { select: { nameAr: true } } },
    orderBy: { name: "asc" },
    take: GROWTH_ROSTER_LIMIT,
  });
  return candidates
    .filter((teacher) =>
      grants.some(
        (grant) =>
          grant.schoolId === teacher.schoolId &&
          (grant.branchId === null || grant.branchId === teacher.branchId)
      )
    )
    .map((teacher) => ({
      id: teacher.id,
      name: teacher.name,
      branchId: teacher.branchId,
      branchName: teacher.branch?.nameAr ?? null,
    }));
}

/**
 * Batched roster summary — 5 grouped queries total regardless of the
 * teacher count. "Completed" reuses the certificate eligibility rule.
 */
export async function listGrowthRoster(
  ctx: CertificateActor
): Promise<CertificateResult<GrowthRosterData>> {
  if (
    ctx.role !== "DEVELOPMENT_OFFICE_MANAGER" &&
    ctx.role !== "EDUCATIONAL_SUPERVISOR" &&
    ctx.role !== "EDUCATIONAL_DEPUTY"
  ) {
    return certificateFail(
      "قائمة النمو المهني متاحة لمديري المكاتب والمشرفين والوكالات التربوية فقط",
      "FORBIDDEN"
    );
  }
  if (ctx.role !== "EDUCATIONAL_DEPUTY" && !ctx.schoolId) {
    return certificateFail("النطاق المدرسي غير محدد", "FORBIDDEN");
  }

  const teachers = await loadRosterTeachers(ctx);
  const teacherIds = teachers.map((teacher) => teacher.id);
  const scopeLabel =
    ctx.role === "DEVELOPMENT_OFFICE_MANAGER"
      ? "جميع معلمي مدرستك"
      : ctx.role === "EDUCATIONAL_SUPERVISOR"
        ? "المعلمون ضمن نطاق إشرافك"
        : "المعلمون ضمن نطاق التفويض";

  if (teacherIds.length === 0) {
    return { ok: true, data: { rows: [], scopeLabel } };
  }

  const enrollments = await db.courseEnrollment.findMany({
    where: { userId: { in: teacherIds } },
    select: { userId: true, courseId: true },
  });
  const enrolledCourseIds = Array.from(
    new Set(enrollments.map((enrollment) => enrollment.courseId))
  );

  const assessments =
    enrolledCourseIds.length > 0
      ? await db.assessment.findMany({
          where: { courseId: { in: enrolledCourseIds }, status: "PUBLISHED" },
          select: { id: true, courseId: true },
        })
      : [];
  // Explicit refinement (Assessment.courseId is nullable in the
  // schema; the where-clause guarantees bound courses).
  const boundAssessments: { id: string; courseId: string }[] = [];
  for (const assessment of assessments) {
    if (assessment.courseId !== null) {
      boundAssessments.push({ id: assessment.id, courseId: assessment.courseId });
    }
  }
  const [attempts, certificates] = await Promise.all([
    boundAssessments.length > 0
      ? db.assessmentAttempt.findMany({
          where: {
            userId: { in: teacherIds },
            assessmentId: {
              in: boundAssessments.map((assessment) => assessment.id),
            },
          },
          select: {
            userId: true,
            assessmentId: true,
            status: true,
            passed: true,
            percentage: true,
          },
        })
      : Promise.resolve([]),
    db.certificate.findMany({
      where: { teacherId: { in: teacherIds } },
      select: {
        teacherId: true,
        status: true,
        expiresAt: true,
      },
    }),
  ]);

  const assessmentsByCourse = new Map<string, string[]>();
  for (const assessment of boundAssessments) {
    const list = assessmentsByCourse.get(assessment.courseId);
    if (list) list.push(assessment.id);
    else assessmentsByCourse.set(assessment.courseId, [assessment.id]);
  }
  const passedPairs = new Set<string>();
  const percentageByUser = new Map<string, number[]>();
  for (const attempt of attempts) {
    if (attempt.passed === true || attempt.status === "PASSED") {
      passedPairs.add(`${attempt.userId}:${attempt.assessmentId}`);
    }
    if (typeof attempt.percentage === "number") {
      const list = percentageByUser.get(attempt.userId);
      if (list) list.push(attempt.percentage);
      else percentageByUser.set(attempt.userId, [attempt.percentage]);
    }
  }
  const enrollmentsByUser = new Map<string, string[]>();
  for (const enrollment of enrollments) {
    const list = enrollmentsByUser.get(enrollment.userId);
    if (list) list.push(enrollment.courseId);
    else enrollmentsByUser.set(enrollment.userId, [enrollment.courseId]);
  }
  const activeCertsByUser = new Map<string, number>();
  for (const certificate of certificates) {
    if (effectiveStatusOf(certificate) === "ISSUED") {
      activeCertsByUser.set(
        certificate.teacherId,
        (activeCertsByUser.get(certificate.teacherId) ?? 0) + 1
      );
    }
  }

  const rows: GrowthRosterRow[] = teachers.map((teacher) => {
    const courseIds = enrollmentsByUser.get(teacher.id) ?? [];
    const completed = courseIds.filter((courseId) => {
      const requiredIds = assessmentsByCourse.get(courseId) ?? [];
      return requiredIds.every((assessmentId) =>
        passedPairs.has(`${teacher.id}:${assessmentId}`)
      );
    }).length;
    const percentages = percentageByUser.get(teacher.id) ?? [];
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      branchName: teacher.branchName,
      coursesEnrolled: courseIds.length,
      coursesCompleted: completed,
      certificatesActive: activeCertsByUser.get(teacher.id) ?? 0,
      avgBestPercentage:
        percentages.length > 0
          ? Math.round(
              percentages.reduce((sum, value) => sum + value, 0) / percentages.length
            )
          : null,
    };
  });

  return { ok: true, data: { rows, scopeLabel } };
}

/* ------------------------------------------------------------------ */
/* Platform-wide aggregate (SUPER_ADMIN, read-only)                     */
/* ------------------------------------------------------------------ */

export async function getPlatformGrowthStats(
  ctx: CertificateActor
): Promise<CertificateResult<PlatformGrowthStats>> {
  if (ctx.role !== "SUPER_ADMIN") {
    return certificateFail(
      "إحصاءات النمو على مستوى المنصة متاحة للإدارة العامة فقط",
      "FORBIDDEN"
    );
  }

  const now = new Date();
  const [schools, teachers, certGroups, activeCertGroups, attemptsPassed, gradedGroups] =
    await Promise.all([
      db.school.findMany({
        select: { id: true, nameAr: true },
        orderBy: { nameAr: "asc" },
        take: PLATFORM_SCHOOLS_LIMIT,
      }),
      db.user.findMany({
        where: { role: "TEACHER", isActive: true },
        select: { id: true, schoolId: true },
      }),
      db.certificate.groupBy({ by: ["schoolId"], _count: { _all: true } }),
      db.certificate.groupBy({
        by: ["schoolId"],
        where: { status: "ISSUED", OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        _count: { _all: true },
      }),
      db.assessmentAttempt.findMany({
        where: { passed: true },
        select: { userId: true },
      }),
      db.assignmentSubmission.groupBy({
        by: ["schoolId"],
        where: { status: "GRADED" },
        _count: { _all: true },
      }),
    ]);

  const teachersBySchool = new Map<string, number>();
  const teacherSchoolById = new Map<string, string>();
  for (const teacher of teachers) {
    if (!teacher.schoolId) continue;
    teachersBySchool.set(
      teacher.schoolId,
      (teachersBySchool.get(teacher.schoolId) ?? 0) + 1
    );
    teacherSchoolById.set(teacher.id, teacher.schoolId);
  }

  const passedBySchool = new Map<string, number>();
  for (const attempt of attemptsPassed) {
    const schoolId = teacherSchoolById.get(attempt.userId);
    if (schoolId) {
      passedBySchool.set(schoolId, (passedBySchool.get(schoolId) ?? 0) + 1);
    }
  }

  const certBySchool = new Map(
    certGroups.map((group) => [group.schoolId, group._count._all])
  );
  const activeCertBySchool = new Map(
    activeCertGroups.map((group) => [group.schoolId, group._count._all])
  );
  const gradedBySchool = new Map(
    gradedGroups.map((group) => [group.schoolId, group._count._all])
  );

  const schoolRows: PlatformSchoolRow[] = schools.map((school) => ({
    schoolId: school.id,
    schoolName: school.nameAr,
    teachers: teachersBySchool.get(school.id) ?? 0,
    certificatesIssued: certBySchool.get(school.id) ?? 0,
    certificatesActive: activeCertBySchool.get(school.id) ?? 0,
    assessmentsPassed: passedBySchool.get(school.id) ?? 0,
    assignmentsGraded: gradedBySchool.get(school.id) ?? 0,
  }));

  return {
    ok: true,
    data: {
      totals: {
        schools: schools.length,
        teachers: teachers.length,
        certificatesIssued: schoolRows.reduce((sum, row) => sum + row.certificatesIssued, 0),
        certificatesActive: schoolRows.reduce((sum, row) => sum + row.certificatesActive, 0),
        assessmentsPassed: schoolRows.reduce((sum, row) => sum + row.assessmentsPassed, 0),
        assignmentsGraded: schoolRows.reduce((sum, row) => sum + row.assignmentsGraded, 0),
      },
      schools: schoolRows,
    },
  };
}
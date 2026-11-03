/**
 * Phase 10 — role-based dashboard & analytics service.
 *
 * Every figure is computed from persisted rows with an explicit
 * denominator, aggregated in the database (groupBy/count) whenever
 * possible. Empty datasets produce zeros/nulls — never fabricated
 * numbers, never NaN. Trend buckets use a fixed 6-month window and are
 * built from date-only column scans (capped), not guesses.
 *
 * Authorization (enforced here, server-side):
 *   getPlatformDashboard  — SUPER_ADMIN only (read-only aggregates).
 *   getSchoolDashboard    — manager (own school) / deputy (granted).
 *   getSupervisorDashboard— supervisor (assigned teachers + branches).
 *   getTeacherDashboard   — TEACHER (own records only).
 *
 * School-wide survey/follow-up metric functions from Phase 9 are reused
 * with a synthetic MANAGER-role actor ONLY after this module's own
 * authorization pass (manager own-school or deputy grant). Supervisors
 * always go through their real actor so scoping stays theirs.
 */
import { db } from "@/lib/db";
import {
  MONTH_LABELS_AR,
  PERCENTAGE_SAMPLE_LIMIT,
  PLATFORM_SCHOOLS_LIMIT,
  TREND_MONTHS,
  TREND_SCAN_LIMIT,
} from "@/config/analytics";
import {
  analyticsFail,
  resolveReadableSchoolIds,
  supervisorCoverage,
  visibleTeacherIds,
  type AnalyticsActor,
  type AnalyticsResult,
} from "@/lib/analytics/access";
import { getSurveyMetrics, type SurveyMetrics } from "@/lib/surveys/service";
import { getFollowUpMetrics, listFollowUps, listSharedFollowUpsForTeacher, type FollowUpMetrics } from "@/lib/followups/service";
import { getAssignmentMetrics, listReviewQueue } from "@/lib/assignments/service";
import { listGrowthRoster, type GrowthRosterRow } from "@/lib/growth/service";
import { listSurveysForTeacher } from "@/lib/surveys/service";

/* ------------------------------------------------------------------ */
/* Trend helpers (shared)                                               */
/* ------------------------------------------------------------------ */

export interface TrendBucket {
  /** "2026-05" — UTC month key. */
  key: string;
  /** Arabic month label, e.g. "مايو". */
  label: string;
  start: Date;
  end: Date;
}

/** Fixed UTC month window, oldest first (deterministic for tests). */
export function monthBuckets(count = TREND_MONTHS, now = new Date()): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let index = count - 1; index >= 0; index -= 1) {
    const start = new Date(cursor);
    start.setUTCMonth(cursor.getUTCMonth() - index);
    const end = new Date(start);
    end.setUTCMonth(start.getUTCMonth() + 1);
    buckets.push({
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
      label: MONTH_LABELS_AR[start.getUTCMonth()],
      start,
      end,
    });
  }
  return buckets;
}

function bucketize(dates: Date[], buckets: TrendBucket[]): number[] {
  const counts = buckets.map(() => 0);
  for (const date of dates) {
    const index = buckets.findIndex(
      (bucket) => date >= bucket.start && date < bucket.end
    );
    if (index >= 0) counts[index] += 1;
  }
  return counts;
}

function percentOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

export interface TrendSeries {
  labels: string[];
  enrollments: number[];
  certificates: number[];
  surveyResponses: number[];
  submissions: number[];
}

async function schoolTrends(teacherIds: string[]): Promise<TrendSeries> {
  const buckets = monthBuckets();
  const since = buckets[0].start;
  if (teacherIds.length === 0) {
    return {
      labels: buckets.map((bucket) => bucket.label),
      enrollments: buckets.map(() => 0),
      certificates: buckets.map(() => 0),
      surveyResponses: buckets.map(() => 0),
      submissions: buckets.map(() => 0),
    };
  }
  const [enrollments, certificates, responses, submissions] = await Promise.all([
    db.courseEnrollment.findMany({
      where: { userId: { in: teacherIds }, enrolledAt: { gte: since } },
      select: { enrolledAt: true },
      take: TREND_SCAN_LIMIT,
    }),
    db.certificate.findMany({
      where: { teacherId: { in: teacherIds }, issuedAt: { gte: since } },
      select: { issuedAt: true },
      take: TREND_SCAN_LIMIT,
    }),
    db.surveyResponse.findMany({
      where: {
        respondentId: { in: teacherIds },
        status: "SUBMITTED",
        submittedAt: { gte: since },
      },
      select: { submittedAt: true, createdAt: true },
      take: TREND_SCAN_LIMIT,
    }),
    db.assignmentSubmission.findMany({
      where: {
        teacherId: { in: teacherIds },
        status: { not: "DRAFT" },
        createdAt: { gte: since },
      },
      select: { createdAt: true, lastSubmittedAt: true },
      take: TREND_SCAN_LIMIT,
    }),
  ]);
  return {
    labels: buckets.map((bucket) => bucket.label),
    enrollments: bucketize(
      enrollments.map((row) => row.enrolledAt),
      buckets
    ),
    certificates: bucketize(
      certificates.map((row) => row.issuedAt),
      buckets
    ),
    surveyResponses: bucketize(
      responses.map((row) => row.submittedAt ?? row.createdAt),
      buckets
    ),
    submissions: bucketize(
      submissions.map((row) => row.lastSubmittedAt ?? row.createdAt),
      buckets
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Course completion — SAME rule as certificate eligibility             */
/* ------------------------------------------------------------------ */

export interface CourseCompletionSummary {
  /** Distinct (teacher, course) pairs satisfying the completion rule. */
  completedPairs: number;
  /** Courses the covered teachers are enrolled in (distinct). */
  distinctCourses: number;
}

/**
 * "Completed" reuses the Phase 8 certificate eligibility rule: for each
 * (teacher, course) enrollment, every PUBLISHED assessment bound to the
 * course must have a PASSED attempt (vacuously met when the course has
 * none). One batched pass — no N+1.
 */
export async function summarizeCourseCompletions(
  teacherIds: string[]
): Promise<CourseCompletionSummary> {
  if (teacherIds.length === 0) return { completedPairs: 0, distinctCourses: 0 };
  const enrollments = await db.courseEnrollment.findMany({
    where: { userId: { in: teacherIds }, status: "ACTIVE" },
    select: { userId: true, courseId: true },
  });
  if (enrollments.length === 0) return { completedPairs: 0, distinctCourses: 0 };
  const courseIds = Array.from(new Set(enrollments.map((row) => row.courseId)));
  const assessments = await db.assessment.findMany({
    where: { courseId: { in: courseIds }, status: "PUBLISHED" },
    select: { id: true, courseId: true },
  });
  const boundAssessments = assessments.filter(
    (assessment): assessment is { id: string; courseId: string } =>
      assessment.courseId !== null
  );
  const assessmentsByCourse = new Map<string, string[]>();
  for (const assessment of boundAssessments) {
    const list = assessmentsByCourse.get(assessment.courseId);
    if (list) list.push(assessment.id);
    else assessmentsByCourse.set(assessment.courseId, [assessment.id]);
  }
  const passedPairs = new Set<string>();
  if (boundAssessments.length > 0) {
    const passedAttempts = await db.assessmentAttempt.findMany({
      where: {
        userId: { in: teacherIds },
        assessmentId: { in: boundAssessments.map((assessment) => assessment.id) },
        status: "PASSED",
      },
      select: { userId: true, assessmentId: true },
    });
    for (const attempt of passedAttempts) {
      passedPairs.add(`${attempt.userId}:${attempt.assessmentId}`);
    }
  }
  let completedPairs = 0;
  for (const enrollment of enrollments) {
    const required = assessmentsByCourse.get(enrollment.courseId) ?? [];
    const met = required.every((assessmentId) =>
      passedPairs.has(`${enrollment.userId}:${assessmentId}`)
    );
    if (met) completedPairs += 1;
  }
  return { completedPairs, distinctCourses: courseIds.length };
}

/* ------------------------------------------------------------------ */
/* School-wide stats (manager / deputy / analytics page)                */
/* ------------------------------------------------------------------ */

export interface BranchRow {
  branchId: string;
  branchName: string;
  teachers: number;
  enrollments: number;
}

export interface SchoolStats {
  schoolId: string;
  schoolName: string;
  branchesCount: number;
  teachersActive: number;
  teachersByBranch: BranchRow[];
  programsPublished: number;
  coursesPublished: number;
  enrollmentsTotal: number;
  enrolledTeachers: number;
  enrollmentRatePercent: number | null;
  coursesCompletedPairs: number;
  assessmentsPublished: number;
  attemptsFinalized: number;
  attemptsPassed: number;
  passRatePercent: number | null;
  avgPercentage: number | null;
  attemptsNeedingReview: number;
  assignmentsPublished: number;
  assignmentsArchived: number;
  submissionsActive: number;
  submissionsPendingReview: number;
  submissionsGraded: number;
  submissionsLate: number;
  submissionCompletionPercent: number | null;
  certificatesIssued: number;
  certificatesRevoked: number;
  certificatesExpired: number;
  surveys: SurveyMetrics;
  followUps: FollowUpMetrics;
  followUpsOverdue: number;
  trends: TrendSeries;
}

/**
 * School-wide aggregate. Callers MUST have authorized actor→schoolId
 * first (manager own-school or deputy grant) — the synthetic MANAGER
 * actor used for Phase 9 metric reuse is safe only inside this function.
 */
export async function computeSchoolStats(
  actor: AnalyticsActor,
  schoolId: string
): Promise<AnalyticsResult<SchoolStats>> {
  const readable = await resolveReadableSchoolIds(actor);
  if (!readable.ok) return readable;
  if (!readable.data.includes(schoolId)) {
    return analyticsFail("لا تملك صلاحية الوصول إلى بيانات هذه المدرسة", "FORBIDDEN");
  }

  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { id: true, nameAr: true },
  });
  if (!school) return analyticsFail("المدرسة غير موجودة", "NOT_FOUND");

  const teachers = await visibleTeacherIds(actor, schoolId);
  if (!teachers.ok) return teachers;
  const teacherIds = teachers.data;

  // Phase 9 metric functions under a synthetic MANAGER actor — this is
  // safe here because the school has just been authorized above.
  const metricsActor = {
    id: actor.id,
    name: actor.name,
    role: "DEVELOPMENT_OFFICE_MANAGER" as const,
    schoolId,
  };

  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  const [
    branches,
    programsPublished,
    coursesPublished,
    assessmentsPublished,
    completion,
    attemptsByStatus,
    percentageRows,
    assignmentMetrics,
    assignmentsArchived,
    certificatesIssued,
    certificatesRevoked,
    certificatesExpired,
    surveyMetricsResult,
    followUpMetricsResult,
    followUpsOverdue,
    trends,
  ] = await Promise.all([
    db.branch.findMany({
      where: { schoolId, isActive: true },
      select: { id: true, nameAr: true },
      orderBy: { nameAr: "asc" },
    }),
    db.trainingProgram.count({ where: { schoolId, status: "PUBLISHED" } }),
    db.course.count({
      where: { OR: [{ schoolId }, { schoolId: null }], status: "PUBLISHED" },
    }),
    db.assessment.count({
      where: { OR: [{ schoolId }, { schoolId: null }], status: "PUBLISHED" },
    }),
    summarizeCourseCompletions(teacherIds),
    db.assessmentAttempt.groupBy({
      by: ["status"],
      where: { userId: { in: teacherIds }, status: { in: ["PASSED", "FAILED", "NEEDS_REVIEW"] } },
      _count: true,
    }),
    db.assessmentAttempt.findMany({
      where: { userId: { in: teacherIds }, status: { in: ["PASSED", "FAILED"] } },
      select: { percentage: true },
      take: PERCENTAGE_SAMPLE_LIMIT,
    }),
    getAssignmentMetrics(schoolId),
    db.assignment.count({ where: { schoolId, status: "ARCHIVED" } }),
    db.certificate.count({ where: { schoolId, status: "ISSUED" } }),
    db.certificate.count({ where: { schoolId, status: "REVOKED" } }),
    db.certificate.count({
      where: { schoolId, status: "ISSUED", expiresAt: { lt: now } },
    }),
    getSurveyMetrics(metricsActor),
    getFollowUpMetrics(metricsActor),
    db.followUp.count({
      where: {
        schoolId,
        archivedAt: null,
        status: { in: ["PLANNED", "IN_PROGRESS"] },
        followUpDate: { lt: startOfToday },
      },
    }),
    schoolTrends(teacherIds),
  ]);

  if (!surveyMetricsResult.ok) {
    return analyticsFail(surveyMetricsResult.message, "FORBIDDEN");
  }
  if (!followUpMetricsResult.ok) {
    return analyticsFail(followUpMetricsResult.message, "FORBIDDEN");
  }

  const statusCount = (status: string) =>
    attemptsByStatus.find((row) => row.status === status)?._count ?? 0;
  const attemptsPassed = statusCount("PASSED");
  const attemptsFinalized = attemptsPassed + statusCount("FAILED");
  const percentages = percentageRows
    .map((row) => row.percentage)
    .filter((value): value is number => typeof value === "number");

  const enrollmentsTotal = await db.courseEnrollment.count({
    where: { status: "ACTIVE", user: { schoolId, role: "TEACHER", isActive: true } },
  });
  const enrolledTeachersRows = await db.courseEnrollment.findMany({
    where: { status: "ACTIVE", user: { schoolId, role: "TEACHER", isActive: true } },
    select: { userId: true },
    distinct: ["userId"],
  });

  const branchRows: BranchRow[] = [];
  for (const branch of branches.slice(0, 20)) {
    const [teachersInBranch, enrollmentsInBranch] = await Promise.all([
      db.user.count({
        where: { schoolId, role: "TEACHER", isActive: true, branchId: branch.id },
      }),
      db.courseEnrollment.count({
        where: { status: "ACTIVE", user: { branchId: branch.id, role: "TEACHER", isActive: true } },
      }),
    ]);
    branchRows.push({
      branchId: branch.id,
      branchName: branch.nameAr,
      teachers: teachersInBranch,
      enrollments: enrollmentsInBranch,
    });
  }

  return {
    ok: true,
    data: {
      schoolId,
      schoolName: school.nameAr,
      branchesCount: branches.length,
      teachersActive: teacherIds.length,
      teachersByBranch: branchRows,
      programsPublished,
      coursesPublished,
      enrollmentsTotal,
      enrolledTeachers: enrolledTeachersRows.length,
      enrollmentRatePercent: percentOf(enrolledTeachersRows.length, teacherIds.length),
      coursesCompletedPairs: completion.completedPairs,
      assessmentsPublished,
      attemptsFinalized,
      attemptsPassed,
      passRatePercent: percentOf(attemptsPassed, attemptsFinalized),
      avgPercentage:
        percentages.length > 0
          ? Math.round(
              percentages.reduce((sum, value) => sum + value, 0) / percentages.length
            )
          : null,
      attemptsNeedingReview: statusCount("NEEDS_REVIEW"),
      assignmentsPublished: assignmentMetrics.assignmentsPublished,
      assignmentsArchived,
      submissionsActive: assignmentMetrics.submissionsActive,
      submissionsPendingReview: assignmentMetrics.pendingReview,
      submissionsGraded: assignmentMetrics.gradedCount,
      submissionsLate: assignmentMetrics.lateCount,
      submissionCompletionPercent: percentOf(
        assignmentMetrics.gradedCount,
        assignmentMetrics.submissionsActive
      ),
      certificatesIssued,
      certificatesRevoked,
      certificatesExpired,
      surveys: surveyMetricsResult.data,
      followUps: followUpMetricsResult.data,
      followUpsOverdue,
      trends,
    },
  };
}

/* ------------------------------------------------------------------ */
/* SUPER_ADMIN — platform dashboard                                     */
/* ------------------------------------------------------------------ */

export interface PlatformSchoolRow {
  schoolId: string;
  schoolName: string;
  isActive: boolean;
  teachers: number;
  enrollments: number;
  submissions: number;
  certificates: number;
  surveys: number;
  followUpsCompleted: number;
}

export interface PlatformDashboard {
  generatedAt: Date;
  schoolsTotal: number;
  schoolsActive: number;
  schoolsInactive: number;
  branchesTotal: number;
  usersByRole: { role: string; count: number }[];
  teachersActive: number;
  programsPublished: number;
  coursesPublished: number;
  assessmentsPublished: number;
  enrollmentsTotal: number;
  attemptsFinalized: number;
  attemptsPassed: number;
  passRatePercent: number | null;
  assignmentsPublished: number;
  submissionsActive: number;
  submissionsGraded: number;
  certificatesIssued: number;
  certificatesRevoked: number;
  surveysTotal: number;
  surveyResponsesSubmitted: number;
  followUpsTotal: number;
  followUpsCompleted: number;
  perSchool: PlatformSchoolRow[];
  trends: TrendSeries;
}

export async function getPlatformDashboard(
  actor: AnalyticsActor
): Promise<AnalyticsResult<PlatformDashboard>> {
  if (actor.role !== "SUPER_ADMIN") {
    return analyticsFail("لوحة المنصة متاحة لمدير النظام فقط", "FORBIDDEN");
  }

  const [schools, branchesTotal, usersByRole, trends] = await Promise.all([
    db.school.findMany({
      select: { id: true, nameAr: true, isActive: true },
      orderBy: { nameAr: "asc" },
      take: PLATFORM_SCHOOLS_LIMIT,
    }),
    db.branch.count(),
    db.user.groupBy({ by: ["role"], _count: true }),
    platformTrends(),
  ]);

  const roleCount = (role: string) =>
    usersByRole.find((row) => row.role === role)?._count ?? 0;

  const schoolIds = schools.map((school) => school.id);
  const teachersActive = await db.user.count({
    where: { role: "TEACHER", isActive: true, schoolId: { in: schoolIds } },
  });

  const [
    programsPublished,
    coursesPublished,
    assessmentsPublished,
    enrollmentsTotal,
    attemptsByStatus,
    percentageRows,
    assignmentsPublished,
    submissionsActive,
    submissionsGraded,
    certificatesIssued,
    certificatesRevoked,
    surveysTotal,
    surveyResponsesSubmitted,
    followUpsTotal,
    followUpsCompleted,
  ] = await Promise.all([
    db.trainingProgram.count({ where: { status: "PUBLISHED" } }),
    db.course.count({ where: { status: "PUBLISHED" } }),
    db.assessment.count({ where: { status: "PUBLISHED" } }),
    db.courseEnrollment.count({ where: { status: "ACTIVE" } }),
    db.assessmentAttempt.groupBy({
      by: ["status"],
      where: { status: { in: ["PASSED", "FAILED"] } },
      _count: true,
    }),
    db.assessmentAttempt.findMany({
      where: { status: { in: ["PASSED", "FAILED"] } },
      select: { percentage: true },
      take: PERCENTAGE_SAMPLE_LIMIT,
    }),
    db.assignment.count({ where: { status: "PUBLISHED" } }),
    db.assignmentSubmission.count({ where: { status: { not: "DRAFT" } } }),
    db.assignmentSubmission.count({ where: { status: "GRADED" } }),
    db.certificate.count({ where: { status: "ISSUED" } }),
    db.certificate.count({ where: { status: "REVOKED" } }),
    db.survey.count(),
    db.surveyResponse.count({ where: { status: "SUBMITTED" } }),
    db.followUp.count({ where: { archivedAt: null } }),
    db.followUp.count({ where: { archivedAt: null, status: "COMPLETED" } }),
  ]);

  const attemptsPassed =
    attemptsByStatus.find((row) => row.status === "PASSED")?._count ?? 0;
  const attemptsFinalized =
    attemptsPassed + (attemptsByStatus.find((row) => row.status === "FAILED")?._count ?? 0);
  const percentages = percentageRows
    .map((row) => row.percentage)
    .filter((value): value is number => typeof value === "number");

  const perSchool: PlatformSchoolRow[] = [];
  for (const school of schools) {
    const [teachers, enrollments, submissions, certificates, surveys, followUpsCompletedFor] =
      await Promise.all([
        db.user.count({
          where: { schoolId: school.id, role: "TEACHER", isActive: true },
        }),
        db.courseEnrollment.count({
          where: { status: "ACTIVE", user: { schoolId: school.id } },
        }),
        db.assignmentSubmission.count({ where: { schoolId: school.id, status: { not: "DRAFT" } } }),
        db.certificate.count({ where: { schoolId: school.id } }),
        db.survey.count({ where: { schoolId: school.id } }),
        db.followUp.count({
          where: { schoolId: school.id, archivedAt: null, status: "COMPLETED" },
        }),
      ]);
    perSchool.push({
      schoolId: school.id,
      schoolName: school.nameAr,
      isActive: school.isActive,
      teachers,
      enrollments,
      submissions,
      certificates,
      surveys,
      followUpsCompleted: followUpsCompletedFor,
    });
  }

  return {
    ok: true,
    data: {
      generatedAt: new Date(),
      schoolsTotal: schools.length,
      schoolsActive: schools.filter((school) => school.isActive).length,
      schoolsInactive: schools.filter((school) => !school.isActive).length,
      branchesTotal,
      usersByRole: [
        { role: "SUPER_ADMIN", count: roleCount("SUPER_ADMIN") },
        { role: "DEVELOPMENT_OFFICE_MANAGER", count: roleCount("DEVELOPMENT_OFFICE_MANAGER") },
        { role: "EDUCATIONAL_DEPUTY", count: roleCount("EDUCATIONAL_DEPUTY") },
        { role: "EDUCATIONAL_SUPERVISOR", count: roleCount("EDUCATIONAL_SUPERVISOR") },
        { role: "TEACHER", count: roleCount("TEACHER") },
      ],
      teachersActive,
      programsPublished,
      coursesPublished,
      assessmentsPublished,
      enrollmentsTotal,
      attemptsFinalized,
      attemptsPassed,
      passRatePercent: percentOf(attemptsPassed, attemptsFinalized),
      assignmentsPublished,
      submissionsActive,
      submissionsGraded,
      certificatesIssued,
      certificatesRevoked,
      surveysTotal,
      surveyResponsesSubmitted,
      followUpsTotal,
      followUpsCompleted,
      perSchool,
      trends,
    },
  };
}

async function platformTrends(): Promise<TrendSeries> {
  const buckets = monthBuckets();
  const since = buckets[0].start;
  const [enrollments, certificates, responses, submissions] = await Promise.all([
    db.courseEnrollment.findMany({
      where: { enrolledAt: { gte: since } },
      select: { enrolledAt: true },
      take: TREND_SCAN_LIMIT,
    }),
    db.certificate.findMany({
      where: { issuedAt: { gte: since } },
      select: { issuedAt: true },
      take: TREND_SCAN_LIMIT,
    }),
    db.surveyResponse.findMany({
      where: { status: "SUBMITTED", submittedAt: { gte: since } },
      select: { submittedAt: true, createdAt: true },
      take: TREND_SCAN_LIMIT,
    }),
    db.assignmentSubmission.findMany({
      where: { status: { not: "DRAFT" }, createdAt: { gte: since } },
      select: { createdAt: true, lastSubmittedAt: true },
      take: TREND_SCAN_LIMIT,
    }),
  ]);
  return {
    labels: buckets.map((bucket) => bucket.label),
    enrollments: bucketize(
      enrollments.map((row) => row.enrolledAt),
      buckets
    ),
    certificates: bucketize(
      certificates.map((row) => row.issuedAt),
      buckets
    ),
    surveyResponses: bucketize(
      responses.map((row) => row.submittedAt ?? row.createdAt),
      buckets
    ),
    submissions: bucketize(
      submissions.map((row) => row.lastSubmittedAt ?? row.createdAt),
      buckets
    ),
  };
}

/* ------------------------------------------------------------------ */
/* MANAGER / DEPUTY — school dashboard                                  */
/* ------------------------------------------------------------------ */

export async function getSchoolDashboard(
  actor: AnalyticsActor
): Promise<AnalyticsResult<SchoolStats>> {
  if (actor.role !== "DEVELOPMENT_OFFICE_MANAGER" && actor.role !== "EDUCATIONAL_DEPUTY") {
    return analyticsFail(
      "لوحة المدرسة متاحة لمدير مكتب التطوير والوكيل التعليمي فقط",
      "FORBIDDEN"
    );
  }
  const readable = await resolveReadableSchoolIds(actor);
  if (!readable.ok) return readable;
  return computeSchoolStats(actor, readable.data[0]);
}

/* ------------------------------------------------------------------ */
/* EDUCATIONAL_SUPERVISOR — coverage dashboard                          */
/* ------------------------------------------------------------------ */

export interface PendingReviewRow {
  submissionId: string;
  assignmentTitle: string;
  teacherName: string;
  lastSubmittedAt: Date | null;
}

export interface UpcomingFollowUpRow {
  id: string;
  titleAr: string;
  teacherName: string;
  followUpDate: Date;
  status: string;
}

export interface SupervisorDashboard {
  scopeLabel: string;
  coverageTeacherCount: number;
  coverageBranchCount: number;
  roster: GrowthRosterRow[];
  submissionsPendingReview: number;
  attemptsNeedingReview: number;
  pendingReviewSample: PendingReviewRow[];
  followUps: FollowUpMetrics;
  followUpsOverdue: number;
  upcomingFollowUps: UpcomingFollowUpRow[];
  surveysOpen: number;
  surveysResponsesSubmitted: number;
  certificatesActive: number;
  avgPercentage: number | null;
}

export async function getSupervisorDashboard(
  actor: AnalyticsActor
): Promise<AnalyticsResult<SupervisorDashboard>> {
  if (actor.role !== "EDUCATIONAL_SUPERVISOR" || !actor.schoolId) {
    return analyticsFail("لوحة المشرف متاحة للمشرفين التربويين فقط", "FORBIDDEN");
  }
  const schoolId = actor.schoolId;
  const coverage = await supervisorCoverage(actor, schoolId);
  if (!coverage.ok) return coverage;
  const { teacherIds, branchIds } = coverage.data;

  const scopeTeacherIds = await visibleTeacherIds(actor, schoolId);
  if (!scopeTeacherIds.ok) return scopeTeacherIds;

  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const inFourteenDays = new Date(startOfToday);
  inFourteenDays.setUTCDate(startOfToday.getUTCDate() + 14);

  const surveyActor = {
    id: actor.id,
    name: actor.name,
    role: "EDUCATIONAL_SUPERVISOR" as const,
    schoolId,
  };

  const [roster, reviewQueue, attemptsNeedingReview, followUpMetrics, followUpsOverdue] =
    await Promise.all([
      listGrowthRoster({
        id: actor.id,
        name: actor.name,
        role: "EDUCATIONAL_SUPERVISOR",
        schoolId,
      }),
      listReviewQueue(
        { id: actor.id, name: actor.name, role: "EDUCATIONAL_SUPERVISOR", schoolId },
        { status: "SUBMITTED" }
      ),
      db.assessmentAttempt.count({
        where: { userId: { in: scopeTeacherIds.data }, status: "NEEDS_REVIEW" },
      }),
      getFollowUpMetrics(surveyActor),
      db.followUp.count({
        where: {
          schoolId,
          archivedAt: null,
          status: { in: ["PLANNED", "IN_PROGRESS"] },
          followUpDate: { lt: startOfToday },
          OR: [{ supervisorId: actor.id }, { createdById: actor.id }],
        },
      }),
    ]);

  if (!reviewQueue.ok) return analyticsFail(reviewQueue.message, "FORBIDDEN");
  if (!followUpMetrics.ok) return analyticsFail(followUpMetrics.message, "FORBIDDEN");

  const [upcomingRows, surveysOpen, responsesSubmitted, certificatesActive, percentageRows] =
    await Promise.all([
      db.followUp.findMany({
        where: {
          schoolId,
          archivedAt: null,
          status: { in: ["PLANNED", "IN_PROGRESS"] },
          AND: [
            {
              OR: [
                { nextFollowUpAt: { gte: startOfToday, lte: inFourteenDays } },
                { followUpDate: { gte: startOfToday, lte: inFourteenDays } },
              ],
            },
            { OR: [{ supervisorId: actor.id }, { createdById: actor.id }] },
          ],
        },
        select: {
          id: true,
          titleAr: true,
          followUpDate: true,
          status: true,
          teacher: { select: { name: true } },
        },
        orderBy: { followUpDate: "asc" },
        take: 5,
      }),
      db.survey.count({
        where: { schoolId, ownerUserId: actor.id, status: "PUBLISHED", archivedAt: null },
      }),
      db.surveyResponse.count({
        where: { status: "SUBMITTED", survey: { ownerUserId: actor.id } },
      }),
      db.certificate.count({
        where: { teacherId: { in: scopeTeacherIds.data }, status: "ISSUED" },
      }),
      db.assessmentAttempt.findMany({
        where: { userId: { in: scopeTeacherIds.data }, status: { in: ["PASSED", "FAILED"] } },
        select: { percentage: true },
        take: PERCENTAGE_SAMPLE_LIMIT,
      }),
    ]);

  const percentages = percentageRows
    .map((row) => row.percentage)
    .filter((value): value is number => typeof value === "number");

  const upcomingFollowUps = upcomingRows.map((row) => ({
    id: row.id,
    titleAr: row.titleAr,
    teacherName: row.teacher.name,
    followUpDate: row.followUpDate,
    status: row.status,
  }));

  return {
    ok: true,
    data: {
      scopeLabel: "المعلمون ضمن نطاق إشرافك",
      coverageTeacherCount: scopeTeacherIds.data.length,
      coverageBranchCount: branchIds.length,
      roster: roster.ok ? roster.data.rows : [],
      submissionsPendingReview: reviewQueue.data.length,
      attemptsNeedingReview,
      pendingReviewSample: reviewQueue.data.slice(0, 5).map((row) => ({
        submissionId: row.submissionId,
        assignmentTitle: row.assignmentTitle,
        teacherName: row.teacherName,
        lastSubmittedAt: row.lastSubmittedAt,
      })),
      followUps: followUpMetrics.data,
      followUpsOverdue,
      upcomingFollowUps,
      surveysOpen,
      surveysResponsesSubmitted: responsesSubmitted,
      certificatesActive,
      avgPercentage:
        percentages.length > 0
          ? Math.round(
              percentages.reduce((sum, value) => sum + value, 0) / percentages.length
            )
          : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* TEACHER — personal dashboard                                         */
/* ------------------------------------------------------------------ */

export interface TeacherCourseRow {
  courseId: string;
  titleAr: string;
  programName: string | null;
  instructorName: string | null;
  completed: boolean;
}

export interface TeacherAttemptRow {
  assessmentTitle: string;
  percentage: number | null;
  passed: boolean | null;
  submittedAt: Date | null;
}

export interface TeacherFeedbackRow {
  assignmentTitle: string;
  scoreTotal: number | null;
  totalPoints: number;
  feedbackText: string | null;
  reviewedAt: Date | null;
}

export interface TeacherDashboard {
  courses: TeacherCourseRow[];
  coursesCompleted: number;
  availableAssessments: number;
  attemptsFinalized: number;
  attemptsPassed: number;
  avgPercentage: number | null;
  recentAttempts: TeacherAttemptRow[];
  assignmentsPending: number;
  assignmentsAwaitingReview: number;
  assignmentsGraded: number;
  recentFeedback: TeacherFeedbackRow[];
  certificatesActive: number;
  surveysAwaiting: number;
  sharedFollowUpsCount: number;
  trends: TrendSeries;
}

export async function getTeacherDashboard(viewer: {
  id: string;
  role: string;
  schoolId: string | null;
}): Promise<AnalyticsResult<TeacherDashboard>> {
  if (viewer.role !== "TEACHER") {
    return analyticsFail("لوحة المعلم متاحة للمعلمين فقط", "FORBIDDEN");
  }
  const teacherId = viewer.id;
  const now = new Date();

  const enrollments = await db.courseEnrollment.findMany({
    where: { userId: teacherId, status: "ACTIVE" },
    select: { courseId: true, course: { select: { titleAr: true, program: { select: { nameAr: true } }, instructor: { select: { name: true } }, status: true } } },
    orderBy: { enrolledAt: "desc" },
    take: 20,
  });
  const courseIds = enrollments.map((row) => row.courseId);

  // Completion rule — same as the certificate eligibility engine.
  const assessments =
    courseIds.length > 0
      ? await db.assessment.findMany({
          where: { courseId: { in: courseIds }, status: "PUBLISHED" },
          select: { id: true, courseId: true },
        })
      : [];
  const boundAssessments = assessments.filter(
    (assessment): assessment is { id: string; courseId: string } =>
      assessment.courseId !== null
  );
  const assessmentsByCourse = new Map<string, string[]>();
  for (const assessment of boundAssessments) {
    const list = assessmentsByCourse.get(assessment.courseId);
    if (list) list.push(assessment.id);
    else assessmentsByCourse.set(assessment.courseId, [assessment.id]);
  }
  const myAttempts =
    boundAssessments.length > 0
      ? await db.assessmentAttempt.findMany({
          where: { userId: teacherId, assessmentId: { in: boundAssessments.map((a) => a.id) } },
          select: { assessmentId: true, status: true },
        })
      : [];
  const passedIds = new Set(
    myAttempts.filter((attempt) => attempt.status === "PASSED").map((attempt) => attempt.assessmentId)
  );
  const attemptedIds = new Set(myAttempts.map((attempt) => attempt.assessmentId));
  const availableAssessments = boundAssessments.filter(
    (assessment) => !attemptedIds.has(assessment.id)
  ).length;

  const courses: TeacherCourseRow[] = enrollments.map((row) => {
    const required = assessmentsByCourse.get(row.courseId) ?? [];
    return {
      courseId: row.courseId,
      titleAr: row.course.titleAr,
      programName: row.course.program?.nameAr ?? null,
      instructorName: row.course.instructor?.name ?? null,
      completed: required.every((assessmentId) => passedIds.has(assessmentId)),
    };
  });

  const buckets = monthBuckets();
  const since = buckets[0].start;
  const [
    recentAttemptRows,
    submissionCounts,
    gradedRows,
    certificatesActive,
    surveysAwaitingResult,
    sharedFollowUpsResult,
    attemptsFinalized,
    attemptsPassed,
    percentageRows,
    myEnrollmentTrend,
    myCertificateTrend,
    mySubmissionTrend,
  ] = await Promise.all([
    db.assessmentAttempt.findMany({
      where: { userId: teacherId, status: { in: ["PASSED", "FAILED"] } },
      select: { percentage: true, passed: true, submittedAt: true, assessment: { select: { titleAr: true } } },
      orderBy: { submittedAt: "desc" },
      take: 5,
    }),
    db.assignmentSubmission.groupBy({
      by: ["status"],
      where: { teacherId },
      _count: true,
    }),
    db.assignmentSubmission.findMany({
      where: { teacherId, status: "GRADED" },
      select: {
        scoreTotal: true,
        feedbackText: true,
        reviewedAt: true,
        assignment: { select: { titleAr: true, totalPoints: true } },
      },
      orderBy: { reviewedAt: "desc" },
      take: 3,
    }),
    db.certificate.count({ where: { teacherId, status: "ISSUED" } }),
    listSurveysForTeacher({ id: viewer.id, role: "TEACHER", schoolId: viewer.schoolId }),
    listSharedFollowUpsForTeacher({ id: viewer.id, role: "TEACHER", schoolId: viewer.schoolId }),
    db.assessmentAttempt.count({
      where: { userId: teacherId, status: { in: ["PASSED", "FAILED"] } },
    }),
    db.assessmentAttempt.count({ where: { userId: teacherId, status: "PASSED" } }),
    db.assessmentAttempt.findMany({
      where: { userId: teacherId, status: { in: ["PASSED", "FAILED"] } },
      select: { percentage: true },
      take: PERCENTAGE_SAMPLE_LIMIT,
    }),
    db.courseEnrollment.findMany({
      where: { userId: teacherId, enrolledAt: { gte: since } },
      select: { enrolledAt: true },
      take: TREND_SCAN_LIMIT,
    }),
    db.certificate.findMany({
      where: { teacherId, issuedAt: { gte: since } },
      select: { issuedAt: true },
      take: TREND_SCAN_LIMIT,
    }),
    db.assignmentSubmission.findMany({
      where: { teacherId, status: { not: "DRAFT" }, createdAt: { gte: since } },
      select: { createdAt: true, lastSubmittedAt: true },
      take: TREND_SCAN_LIMIT,
    }),
  ]);

  const count = (status: string) =>
    submissionCounts.find((row) => row.status === status)?._count ?? 0;
  const percentages = percentageRows
    .map((row) => row.percentage)
    .filter((value): value is number => typeof value === "number");

  const surveysAwaiting = surveysAwaitingResult.ok
    ? surveysAwaitingResult.data.filter(
        (row) => row.isOpenNow && row.myResponseSubmittedAt === null
      ).length
    : 0;
  const sharedFollowUpsCount = sharedFollowUpsResult.ok
    ? sharedFollowUpsResult.data.length
    : 0;

  return {
    ok: true,
    data: {
      courses,
      coursesCompleted: courses.filter((course) => course.completed).length,
      availableAssessments,
      attemptsFinalized,
      attemptsPassed,
      avgPercentage:
        percentages.length > 0
          ? Math.round(
              percentages.reduce((sum, value) => sum + value, 0) / percentages.length
            )
          : null,
      recentAttempts: recentAttemptRows.map((row) => ({
        assessmentTitle: row.assessment.titleAr,
        percentage: row.percentage,
        passed: row.passed,
        submittedAt: row.submittedAt,
      })),
      assignmentsPending: count("RETURNED") + count("DRAFT"),
      assignmentsAwaitingReview: count("SUBMITTED") + count("UNDER_REVIEW"),
      assignmentsGraded: count("GRADED"),
      recentFeedback: gradedRows.map((row) => ({
        assignmentTitle: row.assignment.titleAr,
        scoreTotal: row.scoreTotal,
        totalPoints: row.assignment.totalPoints,
        feedbackText: row.feedbackText,
        reviewedAt: row.reviewedAt,
      })),
      certificatesActive,
      surveysAwaiting,
      sharedFollowUpsCount,
      trends: {
        labels: buckets.map((bucket) => bucket.label),
        enrollments: bucketize(
          myEnrollmentTrend.map((row) => row.enrolledAt),
          buckets
        ),
        certificates: bucketize(
          myCertificateTrend.map((row) => row.issuedAt),
          buckets
        ),
        surveyResponses: buckets.map(() => 0),
        submissions: bucketize(
          mySubmissionTrend.map((row) => row.lastSubmittedAt ?? row.createdAt),
          buckets
        ),
      },
    },
  };
}

export type { AnalyticsResult };
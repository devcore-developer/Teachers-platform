/**
 * Phase 10 — report center service: catalog, server-side filter
 * validation and report builders for the four back-office roles.
 *
 * Invariants:
 *   • ONE dataset per report: the preview page, the print view and the
 *     CSV/Excel export endpoints all call buildReport() — exports can
 *     never contain data the screen would not show.
 *   • Every filter is validated server-side (Zod + database checks):
 *     users cannot reach unauthorized schools/branches/teachers by
 *     manipulating query strings.
 *   • Every percentage has an explicit denominator; empty datasets
 *     produce empty tables with honest messages — never fake rows.
 *   • Survey reports aggregate only; individual answers stay in the
 *     survey module under its own privacy rules.
 *   • Row hard cap (REPORT_ROW_LIMIT) protects report generation.
 */
import { z } from "zod";

import { db } from "@/lib/db";
import { REPORT_ROW_LIMIT } from "@/config/analytics";
import {
  analyticsFail,
  resolveReadableSchoolIds,
  visibleTeacherIds,
  type AnalyticsActor,
  type AnalyticsResult,
} from "@/lib/analytics/access";
import { summarizeCourseCompletions } from "@/lib/analytics/service";
import { resolveAudienceTeachers } from "@/lib/surveys/service";
import { effectiveStatusOf } from "@/lib/certificates/service";

/* ------------------------------------------------------------------ */
/* Catalog                                                              */
/* ------------------------------------------------------------------ */

export const REPORT_IDS = [
  "school-overview",
  "teacher-directory",
  "training-completion",
  "assessment-performance",
  "assignment-status",
  "certificates-growth",
  "survey-results",
  "followup-activity",
  "development-summary",
] as const;
export type ReportId = (typeof REPORT_IDS)[number];

export interface ReportDefinition {
  id: ReportId;
  titleAr: string;
  descriptionAr: string;
  /** Short hint of the date column the range filter applies to. */
  dateColumnHintAr: string | null;
}

export const REPORT_CATALOG: ReportDefinition[] = [
  {
    id: "school-overview",
    titleAr: "نظرة عامة على المدرسة والفروع",
    descriptionAr: "معلمو كل فرع، الالتحاق بالتدريب، الإنجاز، التسليمات والشهادات — صف لكل فرع.",
    dateColumnHintAr: null,
  },
  {
    id: "teacher-directory",
    titleAr: "دليل المعلمين والمشاركة",
    descriptionAr: "قائمة المعلمين مع الالتحاقات، الدورات المستوفاة، متوسط النتائج والتسليمات والشهادات.",
    dateColumnHintAr: "تاريخ الالتحاق بالدورات",
  },
  {
    id: "training-completion",
    titleAr: "إنجاز البرامج والدورات التدريبية",
    descriptionAr: "لكل دورة: الالتحاقات وإكمالات المتطلبات (نفس قاعدة أهلية الشهادات) ونسبة الإكمال.",
    dateColumnHintAr: "تاريخ الالتحاق",
  },
  {
    id: "assessment-performance",
    titleAr: "مشاركة ونتائج التقييمات",
    descriptionAr: "لكل تقييم: المحاولات النهائية والناجحة ومعدل النجاح ومتوسط النسبة — بمقام معلن.",
    dateColumnHintAr: "تاريخ إرسال المحاولة",
  },
  {
    id: "assignment-status",
    titleAr: "حالة التكليفات والتسليمات",
    descriptionAr: "لكل تكليف: المستهدفون والتسليمات بحالاتها والمتأخر ومتوسط الدرجات.",
    dateColumnHintAr: "تاريخ الاستحقاق",
  },
  {
    id: "certificates-growth",
    titleAr: "الشهادات والنمو المهني",
    descriptionAr: "سجل الشهادات الصادرة والملغاة والمنتهية مع تواريخها — كما هي في قاعدة البيانات.",
    dateColumnHintAr: "تاريخ الإصدار",
  },
  {
    id: "survey-results",
    titleAr: "نتائج الاستبيانات وقياس الأثر",
    descriptionAr: "لكل استبيان: حجم الجمهور والردود ونسبة الاستجابة — تجميعي فقط حفاظًا على الخصوصية.",
    dateColumnHintAr: "تاريخ النشر",
  },
  {
    id: "followup-activity",
    titleAr: "نشاط المتابعة والإنجاز",
    descriptionAr: "سجلات المتابعة النشطة بحالتها ومواعيدها ومشاركتها مع المعلمين.",
    dateColumnHintAr: "تاريخ جلسة المتابعة",
  },
  {
    id: "development-summary",
    titleAr: "ملخص تنمية المدرسة",
    descriptionAr: "تقرير موحد: حقائق مسجلة، مؤشرات محسوبة بمقامات معلنة، وقراءة وصفية غير سببية.",
    dateColumnHintAr: null,
  },
];

export function isReportId(value: string): value is ReportId {
  return (REPORT_IDS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/* Filters — Zod parsing + database-backed scope validation             */
/* ------------------------------------------------------------------ */

export interface ReportFilters {
  schoolId: string;
  branchId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  programId?: string;
  courseId?: string;
  teacherId?: string;
  supervisorId?: string;
  status?: string;
}

const optionalTrimmed = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined),
  z.string().max(100).optional()
);

const optionalDate = z.preprocess(
  (value) => {
    if (typeof value !== "string" || value.trim() === "") return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed;
  },
  z.date().optional()
);

const filterSchema = z.object({
  schoolId: optionalTrimmed,
  branchId: optionalTrimmed,
  dateFrom: optionalDate,
  dateTo: optionalDate,
  programId: optionalTrimmed,
  courseId: optionalTrimmed,
  teacherId: optionalTrimmed,
  supervisorId: optionalTrimmed,
  status: optionalTrimmed,
});

/** Parses raw query/form values; Zod messages surface as-is. */
export async function parseReportFilters(
  actor: AnalyticsActor,
  raw: Record<string, unknown>
): Promise<AnalyticsResult<ReportFilters>> {
  const parsed = filterSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return analyticsFail(
      first ? `قيمة مرشح غير صالحة (${first.path.join(".")})` : "المرشحات غير صالحة",
      "VALIDATION_ERROR"
    );
  }
  const input = parsed.data;

  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
    return analyticsFail("تاريخ البداية يجب أن يسبق تاريخ النهاية", "VALIDATION_ERROR");
  }

  return resolveSchoolScope(actor, input);
}

/**
 * Resolves + authorizes the school scope:
 *   manager/supervisor → own school (a mismatched schoolId is rejected)
 *   deputy             → schoolId must be covered by grants
 *   SUPER_ADMIN        → must pick a school explicitly
 */
async function resolveSchoolScope(
  actor: AnalyticsActor,
  input: {
    schoolId?: string;
    branchId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    programId?: string;
    courseId?: string;
    teacherId?: string;
    supervisorId?: string;
    status?: string;
  }
): Promise<AnalyticsResult<ReportFilters>> {
  let schoolId: string;
  if (actor.role === "SUPER_ADMIN") {
    if (!input.schoolId) {
      return analyticsFail(
        "اختر مدرسة من المرشحات — تقارير المدارس تتطلب تحديد المدرسة",
        "VALIDATION_ERROR"
      );
    }
    const school = await db.school.findUnique({ where: { id: input.schoolId }, select: { id: true } });
    if (!school) return analyticsFail("المدرسة المحددة غير موجودة", "NOT_FOUND");
    schoolId = school.id;
  } else {
    const readable = await resolveReadableSchoolIds(actor);
    if (!readable.ok) return readable;
    if (input.schoolId && input.schoolId !== actor.schoolId && !readable.data.includes(input.schoolId)) {
      return analyticsFail("لا تملك صلاحية تقارير هذه المدرسة", "FORBIDDEN");
    }
    schoolId = input.schoolId && readable.data.includes(input.schoolId) ? input.schoolId : readable.data[0];
  }

  const filters: ReportFilters = {
    schoolId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    programId: input.programId,
    courseId: input.courseId,
    status: input.status,
  };

  if (input.branchId) {
    const branch = await db.branch.findUnique({
      where: { id: input.branchId },
      select: { id: true, schoolId: true, nameAr: true },
    });
    if (!branch || branch.schoolId !== schoolId) {
      return analyticsFail("الفرع المحدد لا ينتمي إلى المدرسة المحددة", "VALIDATION_ERROR");
    }
    filters.branchId = branch.id;
  }

  if (input.programId) {
    const program = await db.trainingProgram.findUnique({
      where: { id: input.programId },
      select: { id: true, schoolId: true },
    });
    if (!program || (program.schoolId !== null && program.schoolId !== schoolId)) {
      return analyticsFail("البرنامج المحدد غير متاح في نطاق مدرستك", "VALIDATION_ERROR");
    }
  }

  if (input.courseId) {
    const course = await db.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, schoolId: true },
    });
    if (!course || (course.schoolId !== null && course.schoolId !== schoolId)) {
      return analyticsFail("الدورة المحددة غير متاحة في نطاق مدرستك", "VALIDATION_ERROR");
    }
  }

  if (input.teacherId) {
    const visible = await visibleTeacherIds(actor, schoolId);
    if (!visible.ok) return visible;
    if (actor.role === "SUPER_ADMIN") {
      const teacher = await db.user.findUnique({
        where: { id: input.teacherId },
        select: { id: true, role: true, schoolId: true },
      });
      if (!teacher || teacher.role !== "TEACHER" || teacher.schoolId !== schoolId) {
        return analyticsFail("المعلم المحدد غير موجود في المدرسة المحددة", "VALIDATION_ERROR");
      }
    } else if (!visible.data.includes(input.teacherId)) {
      return analyticsFail("المعلم المحدد خارج نطاق صلاحيتك", "FORBIDDEN");
    }
    filters.teacherId = input.teacherId;
  }

  if (input.supervisorId) {
    if (actor.role === "EDUCATIONAL_SUPERVISOR" && input.supervisorId !== actor.id) {
      return analyticsFail("يمكنك تصفية سجلاتك أنت فقط", "FORBIDDEN");
    }
    const supervisor = await db.user.findUnique({
      where: { id: input.supervisorId },
      select: { id: true, role: true, schoolId: true },
    });
    if (!supervisor || supervisor.role !== "EDUCATIONAL_SUPERVISOR" || supervisor.schoolId !== schoolId) {
      return analyticsFail("المشرف المحدد غير موجود في المدرسة المحددة", "VALIDATION_ERROR");
    }
    filters.supervisorId = input.supervisorId;
  }

  return { ok: true, data: filters };
}

/* ------------------------------------------------------------------ */
/* Report data shapes                                                   */
/* ------------------------------------------------------------------ */

export interface ReportColumn {
  key: string;
  label: string;
  type: "text" | "number" | "percent";
}

export type ReportCellValue = string | number | null;

export interface ReportRow {
  values: Record<string, ReportCellValue>;
}

export interface ReportSummaryItem {
  label: string;
  value: string;
  /** fact = recorded count, metric = calculated ratio, reading = labeled
   * descriptive interpretation of a computed metric (never causal). */
  kind: "fact" | "metric" | "reading";
  note?: string;
}

export interface ReportSection {
  titleAr: string;
  items: ReportSummaryItem[];
  note?: string;
}

export interface ReportData {
  meta: {
    reportId: ReportId;
    titleAr: string;
    descriptionAr: string;
    schoolName: string | null;
    branchName: string | null;
    dateRangeLabel: string | null;
    dateColumnHintAr: string | null;
    generatedAt: Date;
    generatedByRole: string;
    scopeNote: string;
  };
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: ReportSummaryItem[];
  sections: ReportSection[] | null;
  truncated: boolean;
}

function arabicDateLabel(date: Date | undefined): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    numberingSystem: "latn",
  }).format(date);
}

function percentOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/** Inclusive end-of-day for dateTo filters. */
function endOfDay(date: Date | undefined): Date | undefined {
  if (!date) return undefined;
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

/* ------------------------------------------------------------------ */
/* Builder entry                                                        */
/* ------------------------------------------------------------------ */

export async function buildReport(
  actor: AnalyticsActor,
  reportId: string,
  filters: ReportFilters
): Promise<AnalyticsResult<ReportData>> {
  if (!isReportId(reportId)) {
    return analyticsFail("التقرير المطلوب غير موجود", "NOT_FOUND");
  }
  const definition = REPORT_CATALOG.find((report) => report.id === reportId);
  if (!definition) return analyticsFail("التقرير المطلوب غير موجود", "NOT_FOUND");

  const school = await db.school.findUnique({
    where: { id: filters.schoolId },
    select: { id: true, nameAr: true },
  });
  if (!school) return analyticsFail("المدرسة غير موجودة", "NOT_FOUND");
  const branch = filters.branchId
    ? await db.branch.findUnique({ where: { id: filters.branchId }, select: { nameAr: true } })
    : null;

  const dateRangeLabel =
    filters.dateFrom || filters.dateTo
      ? `${arabicDateLabel(filters.dateFrom) ?? "بداية"} — ${arabicDateLabel(endOfDay(filters.dateTo)) ?? "الآن"}`
      : null;

  const scopeNote =
    actor.role === "EDUCATIONAL_SUPERVISOR"
      ? "البيانات محصورة بمعلمي نطاق إشرافك"
      : actor.role === "EDUCATIONAL_DEPUTY"
        ? "عرض للقراءة فقط ضمن نطاق التفويض"
        : actor.role === "SUPER_ADMIN"
          ? "عرض للقراءة فقط على مستوى المنصة"
          : "بيانات مدرستك";

  const baseMeta = {
    reportId,
    titleAr: definition.titleAr,
    descriptionAr: definition.descriptionAr,
    schoolName: school.nameAr,
    branchName: branch?.nameAr ?? null,
    dateRangeLabel,
    dateColumnHintAr: definition.dateColumnHintAr,
    generatedAt: new Date(),
    generatedByRole: actor.role,
    scopeNote,
  };

  switch (reportId) {
    case "school-overview":
      return schoolOverviewReport(actor, filters, baseMeta);
    case "teacher-directory":
      return teacherDirectoryReport(actor, filters, baseMeta);
    case "training-completion":
      return trainingCompletionReport(actor, filters, baseMeta);
    case "assessment-performance":
      return assessmentPerformanceReport(actor, filters, baseMeta);
    case "assignment-status":
      return assignmentStatusReport(actor, filters, baseMeta);
    case "certificates-growth":
      return certificatesReport(actor, filters, baseMeta);
    case "survey-results":
      return surveyResultsReport(actor, filters, baseMeta);
    case "followup-activity":
      return followUpActivityReport(actor, filters, baseMeta);
    case "development-summary":
      return developmentSummaryReport(actor, filters, baseMeta);
  }
}

/* ------------------------------------------------------------------ */
/* Shared loaders                                                       */
/* ------------------------------------------------------------------ */

async function scopedTeacherIds(
  actor: AnalyticsActor,
  filters: ReportFilters
): Promise<AnalyticsResult<string[]>> {
  const visible = await visibleTeacherIds(actor, filters.schoolId);
  if (!visible.ok) return visible;
  if (filters.branchId) {
    const branchTeachers = await db.user.findMany({
      where: {
        id: { in: visible.data },
        branchId: filters.branchId,
        role: "TEACHER",
        isActive: true,
      },
      select: { id: true },
    });
    return { ok: true, data: branchTeachers.map((row) => row.id) };
  }
  return visible;
}

/* ------------------------------------------------------------------ */
/* 1) School & branch overview                                          */
/* ------------------------------------------------------------------ */

async function schoolOverviewReport(
  actor: AnalyticsActor,
  filters: ReportFilters,
  meta: ReportData["meta"]
): Promise<AnalyticsResult<ReportData>> {
  const branches = await db.branch.findMany({
    where: { schoolId: filters.schoolId, isActive: true },
    select: { id: true, nameAr: true, stage: true },
    orderBy: { nameAr: "asc" },
  });
  const visible = await visibleTeacherIds(actor, filters.schoolId);
  if (!visible.ok) return visible;

  const columns: ReportColumn[] = [
    { key: "branch", label: "الفرع", type: "text" },
    { key: "stage", label: "المرحلة", type: "text" },
    { key: "teachers", label: "المعلمون النشطون", type: "number" },
    { key: "enrollments", label: "الالتحاقات النشطة", type: "number" },
    { key: "enrollmentRate", label: "نسبة الالتحاق %", type: "percent" },
    { key: "completions", label: "استيفاء متطلبات الدورات", type: "number" },
    { key: "submissions", label: "التسليمات", type: "number" },
    { key: "certificates", label: "الشهادات الصادرة", type: "number" },
  ];

  const rows: ReportRow[] = [];
  let truncated = false;
  const summaryTeachers = new Set(visible.data);
  let totalEnrollments = 0;
  let totalCompletions = 0;

  for (const branch of branches) {
    if (rows.length >= REPORT_ROW_LIMIT) {
      truncated = true;
      break;
    }
    const branchTeachers = await db.user.findMany({
      where: { id: { in: visible.data }, branchId: branch.id },
      select: { id: true },
    });
    const teacherIds = branchTeachers.map((row) => row.id);
    const [enrollments, enrolledTeacherRows, completions, submissions, certificates] = await Promise.all([
      teacherIds.length > 0
        ? db.courseEnrollment.count({
            where: { userId: { in: teacherIds }, status: "ACTIVE" },
          })
        : Promise.resolve(0),
      teacherIds.length > 0
        ? db.courseEnrollment.findMany({
            where: { userId: { in: teacherIds }, status: "ACTIVE" },
            select: { userId: true },
            distinct: ["userId"],
          })
        : Promise.resolve([] as { userId: string }[]),
      summarizeCourseCompletions(teacherIds),
      teacherIds.length > 0
        ? db.assignmentSubmission.count({
            where: { teacherId: { in: teacherIds }, status: { not: "DRAFT" } },
          })
        : Promise.resolve(0),
      teacherIds.length > 0
        ? db.certificate.count({
            where: { teacherId: { in: teacherIds }, status: "ISSUED" },
          })
        : Promise.resolve(0),
    ]);
    totalEnrollments += enrollments;
    totalCompletions += completions.completedPairs;
    rows.push({
      values: {
        branch: branch.nameAr,
        stage: branch.stage,
        teachers: teacherIds.length,
        enrollments,
        enrollmentRate: percentOf(enrolledTeacherRows.length, teacherIds.length),
        completions: completions.completedPairs,
        submissions,
        certificates,
      },
    });
  }

  // A branch-less teacher pool would be invisible above — surface it honestly.
  const noBranchTeachers = filters.branchId
    ? []
    : await db.user.findMany({
        where: { id: { in: visible.data }, branchId: null },
        select: { id: true },
      });
  if (noBranchTeachers.length > 0 && !truncated) {
    const teacherIds = noBranchTeachers.map((row) => row.id);
    const [enrollments, completions] = await Promise.all([
      db.courseEnrollment.count({ where: { userId: { in: teacherIds }, status: "ACTIVE" } }),
      summarizeCourseCompletions(teacherIds),
    ]);
    totalEnrollments += enrollments;
    totalCompletions += completions.completedPairs;
    rows.push({
      values: {
        branch: "بدون فرع محدد",
        stage: "—",
        teachers: teacherIds.length,
        enrollments,
        enrollmentRate: null,
        completions: completions.completedPairs,
        submissions: null,
        certificates: null,
      },
    });
  }

  const enrolledRows = await db.courseEnrollment.findMany({
    where: { status: "ACTIVE", user: { id: { in: visible.data } } },
    select: { userId: true },
    distinct: ["userId"],
  });

  return {
    ok: true,
    data: {
      meta,
      columns,
      rows,
      summary: [
        { label: "المعلمون النشطون", value: String(summaryTeachers.size), kind: "fact" },
        { label: "الفروع النشطة", value: String(branches.length), kind: "fact" },
        { label: "الالتحاقات النشطة", value: String(totalEnrollments), kind: "fact" },
        {
          label: "نسبة الالتحاق",
          value:
            percentOf(enrolledRows.length, summaryTeachers.size) === null
              ? "—"
              : `${percentOf(enrolledRows.length, summaryTeachers.size)}%`,
          kind: "metric",
          note: "البسط: معلمون نشطون مع التحاق واحد على الأقل — المقام: المعلمون النشطون",
        },
      ],
      sections: null,
      truncated,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 2) Teacher directory & participation                                 */
/* ------------------------------------------------------------------ */

async function teacherDirectoryReport(
  actor: AnalyticsActor,
  filters: ReportFilters,
  meta: ReportData["meta"]
): Promise<AnalyticsResult<ReportData>> {
  const teacherScope = await scopedTeacherIds(actor, filters);
  if (!teacherScope.ok) return teacherScope;
  const whereIds = filters.teacherId ? [filters.teacherId] : teacherScope.data;

  const teachers = await db.user.findMany({
    where: { id: { in: whereIds }, role: "TEACHER" },
    select: { id: true, name: true, isActive: true, branch: { select: { nameAr: true } } },
    orderBy: { name: "asc" },
    take: REPORT_ROW_LIMIT,
  });
  const truncated = teachers.length >= REPORT_ROW_LIMIT && whereIds.length > REPORT_ROW_LIMIT;
  const teacherIds = teachers.map((teacher) => teacher.id);

  const columns: ReportColumn[] = [
    { key: "teacher", label: "المعلم", type: "text" },
    { key: "branch", label: "الفرع", type: "text" },
    { key: "active", label: "الحالة", type: "text" },
    { key: "enrollments", label: "الالتحاقات", type: "number" },
    { key: "completed", label: "دورات مستوفاة", type: "number" },
    { key: "avgScore", label: "متوسط النتائج %", type: "percent" },
    { key: "submissions", label: "التسليمات", type: "number" },
    { key: "certificates", label: "شهادات سارية", type: "number" },
  ];

  if (teacherIds.length === 0) {
    return {
      ok: true,
      data: {
        meta,
        columns,
        rows: [],
        summary: [{ label: "المعلمون", value: "0", kind: "fact" }],
        sections: null,
        truncated: false,
      },
    };
  }

  const since = filters.dateFrom;
  const until = endOfDay(filters.dateTo);
  const [enrollments, completion, attempts, submissions, certificates] = await Promise.all([
    db.courseEnrollment.findMany({
      where: {
        userId: { in: teacherIds },
        status: "ACTIVE",
        ...(since || until
          ? { enrolledAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
          : {}),
      },
      select: { userId: true, courseId: true },
    }),
    summarizeCourseCompletions(teacherIds),
    db.assessmentAttempt.findMany({
      where: { userId: { in: teacherIds }, status: { in: ["PASSED", "FAILED"] } },
      select: { userId: true, percentage: true },
    }),
    db.assignmentSubmission.groupBy({
      by: ["teacherId"],
      where: { teacherId: { in: teacherIds }, status: { not: "DRAFT" } },
      _count: true,
    }),
    db.certificate.findMany({
      where: { teacherId: { in: teacherIds } },
      select: { teacherId: true, status: true, expiresAt: true },
    }),
  ]);

  const enrollmentsByTeacher = new Map<string, number>();
  for (const enrollment of enrollments) {
    enrollmentsByTeacher.set(enrollment.userId, (enrollmentsByTeacher.get(enrollment.userId) ?? 0) + 1);
  }
  const percentagesByTeacher = new Map<string, number[]>();
  for (const attempt of attempts) {
    if (typeof attempt.percentage !== "number") continue;
    const list = percentagesByTeacher.get(attempt.userId);
    if (list) list.push(attempt.percentage);
    else percentagesByTeacher.set(attempt.userId, [attempt.percentage]);
  }
  const submissionsByTeacher = new Map(
    submissions.map((row) => [row.teacherId, row._count] as const)
  );
  const activeCertsByTeacher = new Map<string, number>();
  for (const certificate of certificates) {
    if (effectiveStatusOf(certificate) === "ISSUED") {
      activeCertsByTeacher.set(
        certificate.teacherId,
        (activeCertsByTeacher.get(certificate.teacherId) ?? 0) + 1
      );
    }
  }

  const rows: ReportRow[] = teachers.map((teacher) => {
    const percentages = percentagesByTeacher.get(teacher.id) ?? [];
    return {
      values: {
        teacher: teacher.name,
        branch: teacher.branch?.nameAr ?? "بدون فرع",
        active: teacher.isActive ? "نشط" : "موقوف",
        enrollments: enrollmentsByTeacher.get(teacher.id) ?? 0,
        completed: null,
        avgScore:
          percentages.length > 0
            ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length)
            : null,
        submissions: submissionsByTeacher.get(teacher.id) ?? 0,
        certificates: activeCertsByTeacher.get(teacher.id) ?? 0,
      },
    };
  });

  // Completion counts use the eligibility rule per teacher (batched above
  // through the shared summarizer; per-teacher split is derived here).
  const perTeacherCompleted = await perTeacherCompletionCounts(teacherIds);
  for (const row of rows) {
    row.values.completed = perTeacherCompleted.get(String(row.values.teacher)) ?? 0;
  }

  const participants = enrollmentsByTeacher.size;
  return {
    ok: true,
    data: {
      meta,
      columns,
      rows,
      summary: [
        { label: "المعلمون في التقرير", value: String(teachers.length), kind: "fact" },
        { label: "مشاركون في التدريب", value: String(participants), kind: "fact" },
        {
          label: "نسبة المشاركة",
          value:
            percentOf(participants, teachers.length) === null
              ? "—"
              : `${percentOf(participants, teachers.length)}%`,
          kind: "metric",
          note: "البسط: معلمون بالتحاق نشط — المقام: معلمو التقرير",
        },
        { label: "دورات مستوفاة (إجمالي)", value: String(completion.completedPairs), kind: "fact" },
      ],
      sections: null,
      truncated,
    },
  };
}

/** Per-teacher "completed courses" using the certificate eligibility rule. */
async function perTeacherCompletionCounts(teacherIds: string[]): Promise<Map<string, number>> {
  if (teacherIds.length === 0) return new Map();
  const enrollments = await db.courseEnrollment.findMany({
    where: { userId: { in: teacherIds }, status: "ACTIVE" },
    select: { userId: true, courseId: true, user: { select: { name: true } } },
  });
  if (enrollments.length === 0) return new Map();
  const courseIds = Array.from(new Set(enrollments.map((row) => row.courseId)));
  const assessments = await db.assessment.findMany({
    where: { courseId: { in: courseIds }, status: "PUBLISHED" },
    select: { id: true, courseId: true },
  });
  const bound = assessments.filter(
    (assessment): assessment is { id: string; courseId: string } => assessment.courseId !== null
  );
  const byCourse = new Map<string, string[]>();
  for (const assessment of bound) {
    const list = byCourse.get(assessment.courseId);
    if (list) list.push(assessment.id);
    else byCourse.set(assessment.courseId, [assessment.id]);
  }
  const passedPairs = new Set<string>();
  if (bound.length > 0) {
    const attempts = await db.assessmentAttempt.findMany({
      where: {
        userId: { in: teacherIds },
        assessmentId: { in: bound.map((assessment) => assessment.id) },
        status: "PASSED",
      },
      select: { userId: true, assessmentId: true },
    });
    for (const attempt of attempts) passedPairs.add(`${attempt.userId}:${attempt.assessmentId}`);
  }
  const counts = new Map<string, number>();
  for (const enrollment of enrollments) {
    const required = byCourse.get(enrollment.courseId) ?? [];
    const met = required.every((assessmentId) => passedPairs.has(`${enrollment.userId}:${assessmentId}`));
    if (met) {
      counts.set(
        enrollment.user.name,
        (counts.get(enrollment.user.name) ?? 0) + 1
      );
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* 3) Training program & course completion                              */
/* ------------------------------------------------------------------ */

async function trainingCompletionReport(
  actor: AnalyticsActor,
  filters: ReportFilters,
  meta: ReportData["meta"]
): Promise<AnalyticsResult<ReportData>> {
  const teacherScope = await scopedTeacherIds(actor, filters);
  if (!teacherScope.ok) return teacherScope;
  const teacherIds = teacherScope.data;

  const courses = await db.course.findMany({
    where: {
      OR: [{ schoolId: filters.schoolId }, { schoolId: null }],
      status: { in: ["PUBLISHED", "ARCHIVED"] },
      ...(filters.programId ? { programId: filters.programId } : {}),
      ...(filters.courseId ? { id: filters.courseId } : {}),
    },
    select: {
      id: true,
      titleAr: true,
      status: true,
      program: { select: { nameAr: true } },
    },
    orderBy: { titleAr: "asc" },
    take: REPORT_ROW_LIMIT,
  });
  const truncated = courses.length >= REPORT_ROW_LIMIT;
  const courseIds = courses.map((course) => course.id);

  const columns: ReportColumn[] = [
    { key: "course", label: "الدورة", type: "text" },
    { key: "program", label: "البرنامج", type: "text" },
    { key: "status", label: "الحالة", type: "text" },
    { key: "enrollments", label: "التحاقات معلمي المدرسة", type: "number" },
    { key: "completions", label: "استيفاء المتطلبات", type: "number" },
    { key: "completionRate", label: "نسبة الإكمال %", type: "percent" },
  ];

  if (courseIds.length === 0 || teacherIds.length === 0) {
    return {
      ok: true,
      data: {
        meta,
        columns,
        rows: [],
        summary: [{ label: "الدورات", value: String(courseIds.length), kind: "fact" }],
        sections: null,
        truncated,
      },
    };
  }

  const since = filters.dateFrom;
  const until = endOfDay(filters.dateTo);
  const enrollments = await db.courseEnrollment.findMany({
    where: {
      courseId: { in: courseIds },
      status: "ACTIVE",
      user: { id: { in: teacherIds } },
      ...(since || until
        ? { enrolledAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
        : {}),
    },
    select: { courseId: true, userId: true },
  });
  const assessments = await db.assessment.findMany({
    where: { courseId: { in: courseIds }, status: "PUBLISHED" },
    select: { id: true, courseId: true },
  });
  const bound = assessments.filter(
    (assessment): assessment is { id: string; courseId: string } => assessment.courseId !== null
  );
  const byCourse = new Map<string, string[]>();
  for (const assessment of bound) {
    const list = byCourse.get(assessment.courseId);
    if (list) list.push(assessment.id);
    else byCourse.set(assessment.courseId, [assessment.id]);
  }
  const passedPairs = new Set<string>();
  if (bound.length > 0) {
    const attempts = await db.assessmentAttempt.findMany({
      where: {
        userId: { in: teacherIds },
        assessmentId: { in: bound.map((assessment) => assessment.id) },
        status: "PASSED",
      },
      select: { userId: true, assessmentId: true },
    });
    for (const attempt of attempts) passedPairs.add(`${attempt.userId}:${attempt.assessmentId}`);
  }

  const enrollmentsByCourse = new Map<string, number>();
  const completionsByCourse = new Map<string, number>();
  for (const enrollment of enrollments) {
    enrollmentsByCourse.set(enrollment.courseId, (enrollmentsByCourse.get(enrollment.courseId) ?? 0) + 1);
    const required = byCourse.get(enrollment.courseId) ?? [];
    const met = required.every((assessmentId) => passedPairs.has(`${enrollment.userId}:${assessmentId}`));
    if (met) {
      completionsByCourse.set(
        enrollment.courseId,
        (completionsByCourse.get(enrollment.courseId) ?? 0) + 1
      );
    }
  }

  const rows: ReportRow[] = courses.map((course) => {
    const enrolled = enrollmentsByCourse.get(course.id) ?? 0;
    const completed = completionsByCourse.get(course.id) ?? 0;
    return {
      values: {
        course: course.titleAr,
        program: course.program?.nameAr ?? "—",
        status: course.status === "PUBLISHED" ? "منشورة" : "مؤرشفة",
        enrollments: enrolled,
        completions: completed,
        completionRate: percentOf(completed, enrolled),
      },
    };
  });

  const totalEnrollments = enrollments.length;
  const totalCompletions = Array.from(completionsByCourse.values()).reduce((sum, value) => sum + value, 0);
  return {
    ok: true,
    data: {
      meta,
      columns,
      rows,
      summary: [
        { label: "الدورات في التقرير", value: String(courses.length), kind: "fact" },
        { label: "الالتحاقات", value: String(totalEnrollments), kind: "fact" },
        { label: "استيفاء المتطلبات", value: String(totalCompletions), kind: "fact" },
        {
          label: "نسبة الإكمال",
          value:
            percentOf(totalCompletions, totalEnrollments) === null
              ? "—"
              : `${percentOf(totalCompletions, totalEnrollments)}%`,
          kind: "metric",
          note: "الإكمال = استيفاء كل التقييمات المنشورة المرتبطة بالدورة (نفس قاعدة أهلية الشهادة)",
        },
      ],
      sections: null,
      truncated,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 4) Assessment participation & performance                            */
/* ------------------------------------------------------------------ */

async function assessmentPerformanceReport(
  actor: AnalyticsActor,
  filters: ReportFilters,
  meta: ReportData["meta"]
): Promise<AnalyticsResult<ReportData>> {
  const teacherScope = await scopedTeacherIds(actor, filters);
  if (!teacherScope.ok) return teacherScope;
  const teacherIds = teacherScope.data;
  const since = filters.dateFrom;
  const until = endOfDay(filters.dateTo);
  const attemptDate = since || until
    ? { submittedAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
    : {};

  const attempts = teacherIds.length > 0
    ? await db.assessmentAttempt.findMany({
        where: {
          userId: { in: teacherIds },
          status: { in: ["PASSED", "FAILED", "NEEDS_REVIEW"] },
          ...attemptDate,
        },
        select: { assessmentId: true, status: true, percentage: true },
      })
    : [];

  const attemptedIds = Array.from(new Set(attempts.map((attempt) => attempt.assessmentId)));
  const schoolAssessments = await db.assessment.findMany({
    where: {
      OR: [{ schoolId: filters.schoolId }, ...(attemptedIds.length > 0 ? [{ id: { in: attemptedIds } }] : [])],
      status: { in: ["PUBLISHED", "ARCHIVED"] },
      ...(filters.courseId ? { courseId: filters.courseId } : {}),
    },
    select: { id: true, titleAr: true, status: true, course: { select: { titleAr: true } }, passingScore: true, maxScore: true },
    orderBy: { titleAr: "asc" },
    take: REPORT_ROW_LIMIT,
  });
  const truncated = schoolAssessments.length >= REPORT_ROW_LIMIT;
  const reportIds = new Set(schoolAssessments.map((assessment) => assessment.id));

  const columns: ReportColumn[] = [
    { key: "assessment", label: "التقييم", type: "text" },
    { key: "course", label: "الدورة", type: "text" },
    { key: "status", label: "الحالة", type: "text" },
    { key: "finalized", label: "محاولات نهائية", type: "number" },
    { key: "passed", label: "ناجحة", type: "number" },
    { key: "passRate", label: "معدل النجاح %", type: "percent" },
    { key: "avgScore", label: "متوسط النسبة %", type: "percent" },
    { key: "pendingReview", label: "بانتظار المراجعة", type: "number" },
  ];

  const stats = new Map<
    string,
    { finalized: number; passed: number; percentages: number[]; pending: number }
  >();
  for (const attempt of attempts) {
    if (!reportIds.has(attempt.assessmentId)) continue;
    const entry =
      stats.get(attempt.assessmentId) ?? { finalized: 0, passed: 0, percentages: [], pending: 0 };
    if (attempt.status === "NEEDS_REVIEW") {
      entry.pending += 1;
    } else {
      entry.finalized += 1;
      if (attempt.status === "PASSED") entry.passed += 1;
      if (typeof attempt.percentage === "number") entry.percentages.push(attempt.percentage);
    }
    stats.set(attempt.assessmentId, entry);
  }

  const rows: ReportRow[] = schoolAssessments.map((assessment) => {
    const entry = stats.get(assessment.id) ?? { finalized: 0, passed: 0, percentages: [], pending: 0 };
    return {
      values: {
        assessment: assessment.titleAr,
        course: assessment.course?.titleAr ?? "—",
        status: assessment.status === "PUBLISHED" ? "منشور" : "مؤرشف",
        finalized: entry.finalized,
        passed: entry.passed,
        passRate: percentOf(entry.passed, entry.finalized),
        avgScore:
          entry.percentages.length > 0
            ? Math.round(entry.percentages.reduce((sum, value) => sum + value, 0) / entry.percentages.length)
            : null,
        pendingReview: entry.pending,
      },
    };
  });

  const totalFinalized = Array.from(stats.values()).reduce((sum, entry) => sum + entry.finalized, 0);
  const totalPassed = Array.from(stats.values()).reduce((sum, entry) => sum + entry.passed, 0);
  return {
    ok: true,
    data: {
      meta,
      columns,
      rows,
      summary: [
        { label: "التقييمات في التقرير", value: String(schoolAssessments.length), kind: "fact" },
        { label: "محاولات نهائية", value: String(totalFinalized), kind: "fact" },
        {
          label: "معدل النجاح",
          value:
            percentOf(totalPassed, totalFinalized) === null
              ? "—"
              : `${percentOf(totalPassed, totalFinalized)}%`,
          kind: "metric",
          note: "البسط: محاولات ناجحة — المقام: المحاولات النهائية فقط (تُستبعد قيد المراجعة)",
        },
      ],
      sections: null,
      truncated,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 5) Assignment completion & review status                             */
/* ------------------------------------------------------------------ */

async function assignmentStatusReport(
  actor: AnalyticsActor,
  filters: ReportFilters,
  meta: ReportData["meta"]
): Promise<AnalyticsResult<ReportData>> {
  const teacherScope = await scopedTeacherIds(actor, filters);
  if (!teacherScope.ok) return teacherScope;
  const teacherIds = teacherScope.data;

  const since = filters.dateFrom;
  const until = endOfDay(filters.dateTo);
  const assignments = await db.assignment.findMany({
    where: {
      schoolId: filters.schoolId,
      // Archived assignments stay out of the default view — explicit
      // status=ARCHIVED is the only way to list them here.
      status: { in: filters.status ? [filters.status] : ["PUBLISHED", "CLOSED"] },
      ...(since || until ? { dueAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}),
    },
    select: {
      id: true,
      titleAr: true,
      status: true,
      dueAt: true,
      audienceMode: true,
      targetTeacherIdsJson: true,
      targetBranchIdsJson: true,
      totalPoints: true,
    },
    orderBy: { dueAt: "desc" },
    take: REPORT_ROW_LIMIT,
  });
  const truncated = assignments.length >= REPORT_ROW_LIMIT;

  const activeTeachers = await db.user.count({
    where: { schoolId: filters.schoolId, role: "TEACHER", isActive: true },
  });
  const branchCounts = new Map<string, number>();
  const branchRows = await db.user.groupBy({
    by: ["branchId"],
    where: { schoolId: filters.schoolId, role: "TEACHER", isActive: true },
    _count: true,
  });
  for (const row of branchRows) {
    if (row.branchId) branchCounts.set(row.branchId, row._count);
  }

  function parseIds(json: string | null): string[] {
    if (!json) return [];
    try {
      const parsed: unknown = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  }

  function targetedCount(assignment: (typeof assignments)[number]): number {
    if (assignment.audienceMode === "ALL_TEACHERS") return activeTeachers;
    if (assignment.audienceMode === "BRANCHES") {
      return parseIds(assignment.targetBranchIdsJson).reduce(
        (sum, branchId) => sum + (branchCounts.get(branchId) ?? 0),
        0
      );
    }
    return parseIds(assignment.targetTeacherIdsJson).length;
  }

  const assignmentIds = assignments.map((assignment) => assignment.id);
  const submissions =
    assignmentIds.length > 0 && teacherIds.length > 0
      ? await db.assignmentSubmission.findMany({
          where: { assignmentId: { in: assignmentIds }, teacherId: { in: teacherIds }, status: { not: "DRAFT" } },
          select: { assignmentId: true, status: true, isLate: true, scoreTotal: true, assignment: { select: { totalPoints: true } } },
        })
      : [];

  const columns: ReportColumn[] = [
    { key: "assignment", label: "التكليف", type: "text" },
    { key: "status", label: "الحالة", type: "text" },
    { key: "dueAt", label: "الاستحقاق", type: "text" },
    { key: "targeted", label: "المستهدفون (نطاق التقرير)", type: "number" },
    { key: "submitted", label: "مرسلة", type: "number" },
    { key: "graded", label: "مصححة", type: "number" },
    { key: "late", label: "متأخرة", type: "number" },
    { key: "avgScore", label: "متوسط الدرجة %", type: "percent" },
  ];

  const stats = new Map<string, { submitted: number; graded: number; late: number; scores: number[] }>();
  for (const submission of submissions) {
    const entry =
      stats.get(submission.assignmentId) ?? { submitted: 0, graded: 0, late: 0, scores: [] };
    entry.submitted += 1;
    if (submission.status === "GRADED") {
      entry.graded += 1;
      if (submission.scoreTotal !== null && submission.assignment.totalPoints > 0) {
        entry.scores.push(Math.round((submission.scoreTotal / submission.assignment.totalPoints) * 100));
      }
    }
    if (submission.isLate) entry.late += 1;
    stats.set(submission.assignmentId, entry);
  }

  const statusLabels: Record<string, string> = {
    PUBLISHED: "منشور",
    CLOSED: "مغلق",
    ARCHIVED: "مؤرشف",
  };

  const rows: ReportRow[] = assignments.map((assignment) => {
    const entry = stats.get(assignment.id) ?? { submitted: 0, graded: 0, late: 0, scores: [] };
    return {
      values: {
        assignment: assignment.titleAr,
        status: statusLabels[assignment.status] ?? assignment.status,
        dueAt: new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", numberingSystem: "latn" }).format(assignment.dueAt),
        targeted: targetedCount(assignment),
        submitted: entry.submitted,
        graded: entry.graded,
        late: entry.late,
        avgScore:
          entry.scores.length > 0
            ? Math.round(entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length)
            : null,
      },
    };
  });

  const totalSubmitted = submissions.length;
  const totalGraded = submissions.filter((submission) => submission.status === "GRADED").length;
  return {
    ok: true,
    data: {
      meta,
      columns,
      rows,
      summary: [
        { label: "التكليفات في التقرير", value: String(assignments.length), kind: "fact" },
        { label: "تسليمات (غير مسودات)", value: String(totalSubmitted), kind: "fact" },
        {
          label: "نسبة التصحيح",
          value:
            percentOf(totalGraded, totalSubmitted) === null
              ? "—"
              : `${percentOf(totalGraded, totalSubmitted)}%`,
          kind: "metric",
          note: "البسط: تسليمات مصححة — المقام: التسليمات غير المسودة ضمن نطاق التقرير",
        },
      ],
      sections: null,
      truncated,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 6) Certificates & professional growth                                */
/* ------------------------------------------------------------------ */

async function certificatesReport(
  actor: AnalyticsActor,
  filters: ReportFilters,
  meta: ReportData["meta"]
): Promise<AnalyticsResult<ReportData>> {
  const teacherScope = await scopedTeacherIds(actor, filters);
  if (!teacherScope.ok) return teacherScope;

  const since = filters.dateFrom;
  const until = endOfDay(filters.dateTo);
  const certificates = await db.certificate.findMany({
    where: {
      schoolId: filters.schoolId,
      ...(filters.teacherId
        ? { teacherId: filters.teacherId }
        : { teacherId: { in: teacherScope.data.length > 0 ? teacherScope.data : ["__none__"] } }),
      ...(filters.status && ["ISSUED", "REVOKED"].includes(filters.status)
        ? { status: filters.status }
        : {}),
      ...(since || until
        ? { issuedAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
        : {}),
    },
    select: {
      id: true,
      certificateNumber: true,
      titleAr: true,
      status: true,
      issuedAt: true,
      expiresAt: true,
      teacher: { select: { name: true } },
      program: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
    },
    orderBy: { issuedAt: "desc" },
    take: REPORT_ROW_LIMIT,
  });
  const truncated = certificates.length >= REPORT_ROW_LIMIT;

  const columns: ReportColumn[] = [
    { key: "number", label: "رقم الشهادة", type: "text" },
    { key: "title", label: "الشهادة", type: "text" },
    { key: "teacher", label: "المعلم", type: "text" },
    { key: "content", label: "المحتوى", type: "text" },
    { key: "status", label: "الحالة الفعلية", type: "text" },
    { key: "issuedAt", label: "تاريخ الإصدار", type: "text" },
    { key: "expiresAt", label: "تاريخ الانتهاء", type: "text" },
  ];

  const statusLabels: Record<string, string> = {
    ISSUED: "صادرة",
    REVOKED: "ملغاة",
    EXPIRED: "منتهية الصلاحية",
  };

  const rows: ReportRow[] = certificates.map((certificate) => {
    const effective = effectiveStatusOf(certificate);
    return {
      values: {
        number: certificate.certificateNumber,
        title: certificate.titleAr,
        teacher: certificate.teacher.name,
        content: certificate.program?.nameAr ?? certificate.course?.titleAr ?? "—",
        status: statusLabels[effective] ?? effective,
        issuedAt: new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", numberingSystem: "latn" }).format(certificate.issuedAt),
        expiresAt: certificate.expiresAt
          ? new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", numberingSystem: "latn" }).format(certificate.expiresAt)
          : "لا تنتهي",
      },
    };
  });

  const issued = certificates.length;
  const active = certificates.filter((certificate) => effectiveStatusOf(certificate) === "ISSUED").length;
  const revoked = certificates.filter((certificate) => certificate.status === "REVOKED").length;
  return {
    ok: true,
    data: {
      meta,
      columns,
      rows,
      summary: [
        { label: "شهادات في التقرير", value: String(issued), kind: "fact" },
        { label: "سارية", value: String(active), kind: "fact" },
        { label: "ملغاة", value: String(revoked), kind: "fact" },
      ],
      sections: null,
      truncated,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 7) Survey results & impact (aggregates only — privacy-safe)          */
/* ------------------------------------------------------------------ */

async function surveyResultsReport(
  actor: AnalyticsActor,
  filters: ReportFilters,
  meta: ReportData["meta"]
): Promise<AnalyticsResult<ReportData>> {
  const isSupervisor = actor.role === "EDUCATIONAL_SUPERVISOR";
  const since = filters.dateFrom;
  const until = endOfDay(filters.dateTo);
  const surveys = await db.survey.findMany({
    where: {
      schoolId: filters.schoolId,
      ...(isSupervisor ? { ownerUserId: actor.id } : {}),
      ...(filters.status && ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"].includes(filters.status)
        ? { status: filters.status }
        : {}),
      ...(since || until
        ? { publishedAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
        : {}),
    },
    select: {
      id: true,
      schoolId: true,
      titleAr: true,
      stage: true,
      status: true,
      anonymous: true,
      audienceMode: true,
      targetBranchIdsJson: true,
      targetTeacherIdsJson: true,
      owner: { select: { id: true, role: true } },
      publishedAt: true,
      _count: { select: { responses: { where: { status: "SUBMITTED" } } } },
    },
    orderBy: { createdAt: "desc" },
    take: REPORT_ROW_LIMIT,
  });
  const truncated = surveys.length >= REPORT_ROW_LIMIT;

  const columns: ReportColumn[] = [
    { key: "survey", label: "الاستبيان", type: "text" },
    { key: "stage", label: "المرحلة", type: "text" },
    { key: "status", label: "الحالة", type: "text" },
    { key: "audience", label: "حجم الجمهور", type: "number" },
    { key: "responses", label: "ردود مرسلة", type: "number" },
    { key: "responseRate", label: "نسبة الاستجابة %", type: "percent" },
  ];

  const stageLabels: Record<string, string> = {
    PRE_TRAINING: "قبل التدريب",
    AFTER_TRAINING: "بعد التدريب",
    APPLICATION_FOLLOWUP: "متابعة التطبيق",
  };
  const statusLabels: Record<string, string> = {
    DRAFT: "مسودة",
    PUBLISHED: "منشور",
    CLOSED: "مغلق",
    ARCHIVED: "مؤرشف",
  };

  const rows: ReportRow[] = [];
  let totalAudience = 0;
  let totalResponses = 0;
  for (const survey of surveys) {
    const audience =
      survey.status === "DRAFT"
        ? 0
        : (await resolveAudienceTeachers(survey)).length;
    const responses = survey._count.responses;
    if (survey.status !== "DRAFT") {
      totalAudience += audience;
      totalResponses += responses;
    }
    rows.push({
      values: {
        survey: survey.titleAr,
        stage: survey.stage ? (stageLabels[survey.stage] ?? survey.stage) : "عام",
        status: statusLabels[survey.status] ?? survey.status,
        audience: survey.status === "DRAFT" ? null : audience,
        responses,
        responseRate: survey.status === "DRAFT" ? null : percentOf(responses, audience),
      },
    });
  }

  return {
    ok: true,
    data: {
      meta,
      columns,
      rows,
      summary: [
        { label: "الاستبيانات في التقرير", value: String(surveys.length), kind: "fact" },
        { label: "ردود مرسلة", value: String(totalResponses), kind: "fact" },
        {
          label: "متوسط نسبة الاستجابة",
          value:
            totalAudience > 0
              ? `${Math.round((totalResponses / totalAudience) * 100)}%`
              : "—",
          kind: "metric",
          note: "البسط: ردود مرسلة — المقام: حجم الجمهور الفعلي لكل استبيان (نفس محرك الأهلية)",
        },
      ],
      sections: null,
      truncated,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 8) Follow-up activity & completion                                   */
/* ------------------------------------------------------------------ */

async function followUpActivityReport(
  actor: AnalyticsActor,
  filters: ReportFilters,
  meta: ReportData["meta"]
): Promise<AnalyticsResult<ReportData>> {
  const since = filters.dateFrom;
  const until = endOfDay(filters.dateTo);

  let supervisorScope: Record<string, unknown> = {};
  if (actor.role === "EDUCATIONAL_SUPERVISOR") {
    const visible = await visibleTeacherIds(actor, filters.schoolId);
    if (!visible.ok) return visible;
    supervisorScope = {
      OR: [
        { supervisorId: actor.id },
        { createdById: actor.id },
        ...(visible.data.length > 0 ? [{ teacherId: { in: visible.data } }] : []),
      ],
    };
  }

  const statusAllowed = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
  const followUps = await db.followUp.findMany({
    where: {
      schoolId: filters.schoolId,
      archivedAt: null,
      ...supervisorScope,
      ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
      ...(filters.supervisorId ? { supervisorId: filters.supervisorId } : {}),
      ...(filters.status && statusAllowed.includes(filters.status) ? { status: filters.status } : {}),
      ...(since || until
        ? { followUpDate: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } }
        : {}),
    },
    select: {
      id: true,
      titleAr: true,
      status: true,
      followUpDate: true,
      nextFollowUpAt: true,
      sharedWithTeacher: true,
      teacher: { select: { name: true } },
      supervisor: { select: { name: true } },
    },
    orderBy: { followUpDate: "desc" },
    take: REPORT_ROW_LIMIT,
  });
  const truncated = followUps.length >= REPORT_ROW_LIMIT;

  const columns: ReportColumn[] = [
    { key: "title", label: "السجل", type: "text" },
    { key: "teacher", label: "المعلم", type: "text" },
    { key: "supervisor", label: "المشرف", type: "text" },
    { key: "date", label: "تاريخ الجلسة", type: "text" },
    { key: "status", label: "الحالة", type: "text" },
    { key: "shared", label: "مشترك مع المعلم", type: "text" },
    { key: "next", label: "المتابعة القادمة", type: "text" },
  ];

  const statusLabels: Record<string, string> = {
    PLANNED: "مجدولة",
    IN_PROGRESS: "قيد التنفيذ",
    COMPLETED: "مكتملة",
    CANCELLED: "ملغاة",
  };

  const rows: ReportRow[] = followUps.map((followUp) => ({
    values: {
      title: followUp.titleAr,
      teacher: followUp.teacher.name,
      supervisor: followUp.supervisor.name,
      date: new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", numberingSystem: "latn" }).format(followUp.followUpDate),
      status: statusLabels[followUp.status] ?? followUp.status,
      shared: followUp.sharedWithTeacher ? "نعم" : "لا",
      next: followUp.nextFollowUpAt
        ? new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", numberingSystem: "latn" }).format(followUp.nextFollowUpAt)
        : "—",
    },
  }));

  const completed = followUps.filter((followUp) => followUp.status === "COMPLETED").length;
  const cancelled = followUps.filter((followUp) => followUp.status === "CANCELLED").length;
  const denominator = followUps.length - cancelled;
  return {
    ok: true,
    data: {
      meta,
      columns,
      rows,
      summary: [
        { label: "سجلات في التقرير", value: String(followUps.length), kind: "fact" },
        { label: "مكتملة", value: String(completed), kind: "fact" },
        {
          label: "نسبة الإنجاز",
          value: denominator > 0 ? `${Math.round((completed / denominator) * 100)}%` : "—",
          kind: "metric",
          note: "البسط: سجلات مكتملة — المقام: السجلات ناقص الملغاة (نفس قاعدة مؤشرات المتابعة)",
        },
      ],
      sections: null,
      truncated,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 9) Consolidated school development summary                           */
/* ------------------------------------------------------------------ */

function readingForRate(percent: number | null): string {
  if (percent === null) return "لا توجد بيانات كافية لقراءة هذا المؤشر";
  if (percent >= 70) return "مرتفعة";
  if (percent >= 40) return "متوسطة";
  return "منخفضة";
}

async function developmentSummaryReport(
  actor: AnalyticsActor,
  filters: ReportFilters,
  meta: ReportData["meta"]
): Promise<AnalyticsResult<ReportData>> {
  const visible = await visibleTeacherIds(actor, filters.schoolId);
  if (!visible.ok) return visible;
  const teacherIds = visible.data;

  const [branches, programs, courses, enrollments, completion, attempts, submissions, certificates, surveys, followUps] =
    await Promise.all([
      db.branch.count({ where: { schoolId: filters.schoolId, isActive: true } }),
      db.trainingProgram.count({ where: { schoolId: filters.schoolId, status: "PUBLISHED" } }),
      db.course.count({ where: { OR: [{ schoolId: filters.schoolId }, { schoolId: null }], status: "PUBLISHED" } }),
      db.courseEnrollment.count({
        where: { status: "ACTIVE", user: { id: { in: teacherIds } } },
      }),
      summarizeCourseCompletions(teacherIds),
      teacherIds.length > 0
        ? db.assessmentAttempt.groupBy({
            by: ["status"],
            where: { userId: { in: teacherIds }, status: { in: ["PASSED", "FAILED"] } },
            _count: true,
          })
        : Promise.resolve([] as { status: string; _count: number }[]),
      teacherIds.length > 0
        ? db.assignmentSubmission.groupBy({
            by: ["status"],
            where: { teacherId: { in: teacherIds }, status: { not: "DRAFT" } },
            _count: true,
          })
        : Promise.resolve([] as { status: string; _count: number }[]),
      db.certificate.findMany({
        where: { schoolId: filters.schoolId },
        select: { status: true, expiresAt: true },
      }),
      db.survey.findMany({
        where: { schoolId: filters.schoolId, status: { in: ["PUBLISHED", "CLOSED"] } },
        select: {
          id: true,
          schoolId: true,
          status: true,
          audienceMode: true,
          targetBranchIdsJson: true,
          targetTeacherIdsJson: true,
          owner: { select: { id: true, role: true } },
          _count: { select: { responses: { where: { status: "SUBMITTED" } } } },
        },
      }),
      db.followUp.findMany({
        where: { schoolId: filters.schoolId, archivedAt: null },
        select: { status: true, challengesAr: true, supportNeedsAr: true, progressAr: true },
      }),
    ]);

  const passed = attempts.find((row) => row.status === "PASSED")?._count ?? 0;
  const failed = attempts.find((row) => row.status === "FAILED")?._count ?? 0;
  const finalized = passed + failed;
  const graded = submissions.find((row) => row.status === "GRADED")?._count ?? 0;
  const submittedTotal = submissions.reduce((sum, row) => sum + row._count, 0);
  const certsIssued = certificates.filter((certificate) => certificate.status === "ISSUED").length;
  const certsRevoked = certificates.filter((certificate) => certificate.status === "REVOKED").length;
  const now = new Date();
  const certsExpired = certificates.filter(
    (certificate) => certificate.status === "ISSUED" && certificate.expiresAt !== null && certificate.expiresAt < now
  ).length;

  let surveyAudience = 0;
  let surveyResponses = 0;
  for (const survey of surveys) {
    const audience = (await resolveAudienceTeachers(survey)).length;
    surveyAudience += audience;
    surveyResponses += survey._count.responses;
  }

  const followUpsCompleted = followUps.filter((row) => row.status === "COMPLETED").length;
  const followUpsCancelled = followUps.filter((row) => row.status === "CANCELLED").length;
  const followUpsDenominator = followUps.length - followUpsCancelled;
  const followUpsWithChallenges = followUps.filter((row) => (row.challengesAr ?? "").trim().length > 0).length;
  const followUpsWithSupport = followUps.filter((row) => (row.supportNeedsAr ?? "").trim().length > 0).length;
  const followUpsWithProgress = followUps.filter((row) => (row.progressAr ?? "").trim().length > 0).length;

  const enrolledTeachersRows = await db.courseEnrollment.findMany({
    where: { status: "ACTIVE", user: { id: { in: teacherIds } } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const enrollmentRate = percentOf(enrolledTeachersRows.length, teacherIds.length);
  const passRate = percentOf(passed, finalized);
  const gradingRate = percentOf(graded, submittedTotal);
  const surveyRate = percentOf(surveyResponses, surveyAudience);
  const followUpRate = percentOf(followUpsCompleted, followUpsDenominator);
  const completionRate = percentOf(completion.completedPairs, enrollments);

  const sections: ReportSection[] = [
    {
      titleAr: "أولًا: حقائق مسجّلة (أرقام من قاعدة البيانات كما هي)",
      items: [
        { label: "المعلمون النشطون", value: String(teacherIds.length), kind: "fact" },
        { label: "الفروع النشطة", value: String(branches), kind: "fact" },
        { label: "برامج تدريبية منشورة", value: String(programs), kind: "fact" },
        { label: "دورات منشورة (بما فيها دورات المنصة العامة)", value: String(courses), kind: "fact" },
        { label: "التحاقات نشطة", value: String(enrollments), kind: "fact" },
        { label: "شهادات صادرة / ملغاة / منتهية", value: `${certsIssued} / ${certsRevoked} / ${certsExpired}`, kind: "fact" },
      ],
      note: "كل الأرقام أعلاه عدّ مباشر لسجلات محفوظة — لا تقديرات ولا اكتمالات مفترضة.",
    },
    {
      titleAr: "ثانيًا: مؤشرات محسوبة (بسط ومقام معلنان)",
      items: [
        {
          label: "نسبة الالتحاق بالتدريب",
          value: enrollmentRate === null ? "—" : `${enrollmentRate}%`,
          kind: "metric",
          note: "البسط: معلمون مع التحاق نشط واحد على الأقل — المقام: المعلمون النشطون",
        },
        {
          label: "نسبة استيفاء متطلبات الدورات",
          value: completionRate === null ? "—" : `${completionRate}%`,
          kind: "metric",
          note: "البسط: التزامات (معلم × دورة) مستوفية لكل تقييماتها المنشورة — المقام: إجمالي الالتحاقات النشطة",
        },
        {
          label: "معدل نجاح التقييمات",
          value: passRate === null ? "—" : `${passRate}%`,
          kind: "metric",
          note: "البسط: محاولات ناجحة — المقام: المحاولات النهائية (الناجحة + الراسبة) فقط",
        },
        {
          label: "نسبة تصحيح التسليمات",
          value: gradingRate === null ? "—" : `${gradingRate}%`,
          kind: "metric",
          note: "البسط: تسليمات مصححة — المقام: التسليمات غير المسودة",
        },
        {
          label: "متوسط نسبة استجابة الاستبيانات",
          value: surveyRate === null ? "—" : `${surveyRate}%`,
          kind: "metric",
          note: "البسط: ردود مرسلة — المقام: حجم الجمهور الفعلي للاستبيانات المنشورة/المغلقة",
        },
        {
          label: "نسبة إنجاز المتابعات",
          value: followUpRate === null ? "—" : `${followUpRate}%`,
          kind: "metric",
          note: "البسط: سجلات مكتملة — المقام: السجلات ناقص الملغاة",
        },
      ],
    },
    {
      titleAr: "ثالثًا: التطبيق المُبلَّغ عنه والاحتياجات المسجّلة",
      items: [
        {
          label: "سجلات متابعة عليها ملاحظات تطبيق (progress)",
          value: String(followUpsWithProgress),
          kind: "fact",
          note: "عدد السجلات التي دوّن المشرف ملاحظات تطبيق فعلية — تُقرأ كمؤشر استرشادي فقط",
        },
        {
          label: "سجلات بتحدّيات مسجّلة",
          value: String(followUpsWithChallenges),
          kind: "fact",
        },
        {
          label: "سجلات باحتياجات دعم مسجّلة",
          value: String(followUpsWithSupport),
          kind: "fact",
        },
      ],
      note: "هذه الأرقام تعكس ما دوّنه المشرفون صراحةً — غياب التدوين لا يعني غياب التطبيق أو الحاجة.",
    },
    {
      titleAr: "رابعًا: قراءة وصفية للمؤشرات (ليست توصية ولا علاقة سببية)",
      items: [
        {
          label: "الالتحاق بالتدريب",
          value: readingForRate(enrollmentRate),
          kind: "reading",
          note: "قراءة وصفية لنسبة الالتحاق المحسوبة أعلاه",
        },
        {
          label: "استيفاء متطلبات الدورات",
          value: readingForRate(completionRate),
          kind: "reading",
        },
        {
          label: "نجاح التقييمات",
          value: readingForRate(passRate),
          kind: "reading",
        },
        {
          label: "الاستجابة للاستبيانات",
          value: readingForRate(surveyRate),
          kind: "reading",
        },
        {
          label: "إنجاز المتابعات",
          value: readingForRate(followUpRate),
          kind: "reading",
        },
      ],
      note: "هذه القراءة تصف مستوى المؤشر المحسوب فقط. لا تُقارن ببيانات قبلية ولا تدّعي أن تدريبًا سبّب نتيجة — قياس الأثر التطبيقي يتطلب تصميم تقييم قبل/بعد عبر استبيانات المراحل في وحدة قياس الأثر.",
    },
  ];

  return {
    ok: true,
    data: {
      meta,
      columns: [],
      rows: [],
      summary: [],
      sections,
      truncated: false,
    },
  };
}

export type { AnalyticsResult };
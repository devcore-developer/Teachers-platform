import { Prisma } from "@prisma/client";

import type { AdminContext } from "@/lib/auth/dev-admin";
import {
  assessmentScopeError,
  assessmentFail,
  availabilityState,
  canManageAssessments,
  canViewPublishedAssessment,
  publishedAssessmentWhere,
  type AvailabilityState,
  type ViewerIdentity,
} from "@/lib/assessment/access";
import { db } from "@/lib/db";
import {
  ASSESSMENTS_PAGE_SIZE,
  ATTEMPTS_PREVIEW_LIMIT,
  CHOICE_TYPES,
  MAX_ASSESSMENT_POINTS,
  MAX_QUESTIONS,
  MIN_QUESTIONS_TO_PUBLISH,
  type AttemptStatus,
  type QuestionType,
} from "@/config/assessment";
import {
  createAssessmentSchema,
  createQuestionSchema,
  deleteQuestionSchema,
  moveQuestionSchema,
  reviewAttemptSchema,
  saveDraftSchema,
  setAssessmentStatusSchema,
  submitAttemptSchema,
  updateAssessmentSchema,
  updateQuestionSchema,
  zodFieldErrors,
  type AssessmentErrorCode,
  type AssessmentResult,
  type QuestionOptionInput,
} from "@/lib/validation/assessment";

export type {
  AssessmentErrorCode,
  AssessmentResult,
} from "@/lib/validation/assessment";

/* ------------------------------------------------------------------ */
/* Phase 6 — assessment service: authoring, publishing, attempts,       */
/* server-side scoring, manual review and metrics.                      */
/*                                                                      */
/* Every mutation re-validates ownership on the server: the actor's     */
/* scope comes from AdminContext (session-backed), never from the       */
/* client. Platform-wide assessments (schoolId null) are SUPER_ADMIN    */
/* only. The answer key NEVER crosses the RSC boundary before an        */
/* attempt is finalized — teacher-facing projections strip it.          */
/*                                                                      */
/* Scoring rules (deterministic, integer-only):                         */
/*   SINGLE_CHOICE   exact one correct option id -> full points         */
/*   MULTIPLE_CHOICE exact set equality            -> full points       */
/*   TRUE_FALSE      exact boolean                 -> full points       */
/*   SHORT_ANSWER    human review (NEEDS_REVIEW)   -> reviewer points   */
/*   percentage = round(earned / max * 100), pass = earned >= passing   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Parsed JSON shapes                                                   */
/* ------------------------------------------------------------------ */

export interface QuestionOption {
  id: string;
  textAr: string;
}

export type AnswerKey =
  | { optionId: string }
  | { optionIds: string[] }
  | { value: boolean }
  | { modelAnswer?: string };

export interface SubmittedAnswer {
  questionId: string;
  choice?: string[];
  bool?: boolean;
  text?: string;
}

export interface ReviewScore {
  questionId: string;
  points: number;
}

interface ParsedQuestion {
  id: string;
  type: QuestionType;
  points: number;
  isRequired: boolean;
  orderIndex: number;
  textAr: string;
  textEn: string | null;
  explanation: string | null;
  options: QuestionOption[];
  answerKey: AnswerKey | null;
}

/* ------------------------------------------------------------------ */
/* Row shapes consumed by pages (RSC-serializable, no answer keys on    */
/* the teacher side — see TeacherQuestionView / TeacherAssessmentRow).  */
/* ------------------------------------------------------------------ */

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
}

export interface ManageAssessmentRow {
  id: string;
  titleAr: string;
  titleEn: string | null;
  status: string;
  schoolId: string | null;
  schoolName: string | null;
  courseId: string | null;
  courseTitle: string | null;
  questionsCount: number;
  attemptsCount: number;
  maxScore: number;
  passingScore: number;
  timeLimitMinutes: number | null;
  attemptLimit: number | null;
  availableFrom: Date | null;
  availableUntil: Date | null;
  updatedAt: Date;
}

export interface ManageQuestionRow {
  id: string;
  type: string;
  textAr: string;
  textEn: string | null;
  points: number;
  isRequired: boolean;
  orderIndex: number;
  options: QuestionOption[];
  /** Managers may see the key — this projection is admin-only. */
  answerKey: AnswerKey | null;
  explanation: string | null;
}

export interface AssessmentStats {
  attemptsTotal: number;
  needsReviewCount: number;
  passedCount: number;
  failedCount: number;
  expiredCount: number;
  avgPercentage: number | null;
  passRate: number | null;
}

export interface ManageAssessmentDetail {
  assessment: Omit<ManageAssessmentRow, "questionsCount" | "attemptsCount"> & {
    instructionsAr: string;
    instructionsEn: string | null;
  };
  questions: ManageQuestionRow[];
  stats: AssessmentStats;
}

export interface ManageAttemptRow {
  id: string;
  status: string;
  userId: string;
  userName: string;
  userEmail: string;
  startedAt: Date;
  submittedAt: Date | null;
  deadlineAt: Date | null;
  objectiveScore: number;
  earnedScore: number | null;
  maxScore: number | null;
  percentage: number | null;
  passed: boolean | null;
  /** Populated for NEEDS_REVIEW rows only — short answers to grade. */
  shortAnswers: {
    questionId: string;
    questionText: string;
    points: number;
    answerText: string;
    modelAnswer: string | null;
  }[];
}

/** Teacher-facing question — answer key and explanation STRIPPED. */
export interface TeacherQuestionView {
  id: string;
  type: string;
  textAr: string;
  textEn: string | null;
  points: number;
  isRequired: boolean;
  options: QuestionOption[];
}

export interface TeacherAssessmentRow {
  id: string;
  titleAr: string;
  titleEn: string | null;
  courseTitle: string | null;
  schoolName: string | null;
  questionsCount: number;
  maxScore: number;
  passingScore: number;
  timeLimitMinutes: number | null;
  attemptLimit: number | null;
  availableFrom: Date | null;
  availableUntil: Date | null;
  availability: AvailabilityState;
  attemptsUsed: number;
  latestStatus: AttemptStatus | null;
}

export interface TeacherAssessmentDetail {
  assessment: Omit<TeacherAssessmentRow, "latestStatus" | "attemptsUsed"> & {
    instructionsAr: string;
    instructionsEn: string | null;
  };
  enrollmentRequired: boolean;
  enrolled: boolean;
  attemptsUsed: number;
  remainingAttempts: number | null;
  activeAttempt: { id: string; startedAt: Date; deadlineAt: Date | null } | null;
}

export interface TakeAttemptView {
  attempt: {
    id: string;
    startedAt: Date;
    deadlineAt: Date | null;
    assessmentId: string;
  };
  assessment: {
    id: string;
    titleAr: string;
    titleEn: string | null;
    instructionsAr: string;
    instructionsEn: string | null;
    timeLimitMinutes: number | null;
    maxScore: number;
    passingScore: number;
  };
  questions: TeacherQuestionView[];
  savedAnswers: SubmittedAnswer[];
}

export interface ResultQuestionBreakdown {
  questionId: string;
  orderIndex: number;
  type: string;
  textAr: string;
  points: number;
  yourAnswer: {
    optionTexts: string[];
    bool: boolean | null;
    text: string | null;
  } | null;
  /** Revealed AFTER submission only — null for unsubmitted attempts. */
  correct: {
    optionTexts: string[];
    bool: boolean | null;
    modelAnswer: string | null;
  } | null;
  explanation: string | null;
  earnedPoints: number | null;
  isCorrect: boolean | null;
}

export interface AttemptResultView {
  attempt: {
    id: string;
    status: AttemptStatus;
    startedAt: Date;
    submittedAt: Date | null;
    deadlineAt: Date | null;
    objectiveScore: number;
    earnedScore: number | null;
    maxScore: number | null;
    percentage: number | null;
    passed: boolean | null;
    reviewedAt: Date | null;
  };
  assessment: { id: string; titleAr: string; passingScore: number };
  breakdown: ResultQuestionBreakdown[];
}

export interface MyAttemptRow {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  status: AttemptStatus;
  startedAt: Date;
  submittedAt: Date | null;
  earnedScore: number | null;
  maxScore: number | null;
  percentage: number | null;
  passed: boolean | null;
}

export interface ReadOnlyAttemptRow {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentStatus: string;
  teacherId: string;
  teacherName: string;
  schoolName: string | null;
  status: AttemptStatus;
  submittedAt: Date | null;
  earnedScore: number | null;
  maxScore: number | null;
  percentage: number | null;
  passed: boolean | null;
}

export interface AssessmentMetrics {
  assessmentsTotal: number;
  assessmentsPublished: number;
  attemptsFinalized: number;
  needsReviewCount: number;
  avgPercentage: number | null;
  passRate: number | null;
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                     */
/* ------------------------------------------------------------------ */

function validationFail<T>(error: { issues: unknown[] }): AssessmentResult<T> {
  const fieldErrors = zodFieldErrors(error as never);
  return {
    ok: false,
    message: "تحقق من الحقول المدخلة ثم أعد المحاولة",
    fieldErrors,
    code: "VALIDATION_ERROR",
  };
}

/** Defense-in-depth guard: assessment mutations are manager-only. */
function managerGuard(ctx: AdminContext): AssessmentResult<never> | null {
  if (!canManageAssessments(ctx.role)) {
    return {
      ok: false,
      message:
        "إدارة الاختبارات متاحة لمدير المنصة ومديري مكاتب التطوير فقط",
      code: "FORBIDDEN",
    };
  }
  return null;
}

/** Resolve the owning school for a new assessment from the actor. */
function resolveScope(
  ctx: AdminContext,
  scope: "platform" | "school",
  schoolId: string | undefined
): { ok: true; schoolId: string | null } | { ok: false; message: string; code: AssessmentErrorCode } {
  if (ctx.role === "DEVELOPMENT_OFFICE_MANAGER") {
    if (scope === "platform") {
      return {
        ok: false,
        message: "الاختبارات المشتركة على مستوى المنصة متاحة لمدير المنصة فقط",
        code: "FORBIDDEN",
      };
    }
    return { ok: true, schoolId: ctx.schoolId };
  }
  // SUPER_ADMIN
  if (scope === "platform") return { ok: true, schoolId: null };
  if (!schoolId) {
    return {
      ok: false,
      message: "اختر المدرسة المالكة للاختبار",
      code: "VALIDATION_ERROR",
    };
  }
  return { ok: true, schoolId };
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseOptions(raw: string | null | undefined): QuestionOption[] {
  const parsed = parseJson<{ id?: unknown; textAr?: unknown }[]>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is { id: string; textAr: string } =>
        typeof item?.id === "string" && typeof item?.textAr === "string"
    )
    .map((item) => ({ id: item.id, textAr: item.textAr }));
}

function parseAnswerKey(type: string, raw: string | null | undefined): AnswerKey | null {
  const parsed = parseJson<Record<string, unknown>>(raw);
  if (!parsed) return null;
  if (type === "SINGLE_CHOICE" && typeof parsed.optionId === "string") {
    return { optionId: parsed.optionId };
  }
  if (
    type === "MULTIPLE_CHOICE" &&
    Array.isArray(parsed.optionIds) &&
    parsed.optionIds.every((v) => typeof v === "string")
  ) {
    return { optionIds: parsed.optionIds as string[] };
  }
  if (type === "TRUE_FALSE" && typeof parsed.value === "boolean") {
    return { value: parsed.value };
  }
  if (type === "SHORT_ANSWER") {
    return {
      modelAnswer:
        typeof parsed.modelAnswer === "string" ? parsed.modelAnswer : undefined,
    };
  }
  return null;
}

function parseAnswers(raw: string | null | undefined): SubmittedAnswer[] {
  const parsed = parseJson<SubmittedAnswer[]>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) => item && typeof item.questionId === "string");
}

function parseReviewScores(raw: string | null | undefined): ReviewScore[] {
  const parsed = parseJson<ReviewScore[]>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item) => item && typeof item.questionId === "string" && typeof item.points === "number"
  );
}

/** Fresh server-generated option id (never client-supplied). */
function newOptionId(): string {
  return globalThis.crypto.randomUUID();
}

/** Build persisted option rows + the server-only answer key from input. */
function buildOptionsAndKey(
  type: QuestionType,
  options: QuestionOptionInput[],
  correctOptionIndexes: number[],
  correctValue: boolean | undefined,
  modelAnswer: string | undefined,
  existingOptions: QuestionOption[]
): { options: QuestionOption[]; answerKey: AnswerKey } {
  if (type === "TRUE_FALSE") {
    return { options: [], answerKey: { value: Boolean(correctValue) } };
  }
  if (type === "SHORT_ANSWER") {
    return { options: [], answerKey: modelAnswer ? { modelAnswer } : {} };
  }
  // Choice types: keep stable option ids when the count matches so
  // in-flight attempts' saved drafts stay addressable across edits.
  const stable =
    existingOptions.length === options.length
      ? existingOptions.map((o) => o.id)
      : options.map(() => newOptionId());
  const built = options.map((option, index) => ({
    id: stable[index],
    textAr: option.textAr,
  }));
  if (type === "SINGLE_CHOICE") {
    return { options: built, answerKey: { optionId: built[correctOptionIndexes[0]].id } };
  }
  return {
    options: built,
    answerKey: { optionIds: correctOptionIndexes.map((index) => built[index].id) },
  };
}

async function recomputeMaxScore(
  tx: Prisma.TransactionClient,
  assessmentId: string
): Promise<number> {
  const agg = await tx.assessmentQuestion.aggregate({
    where: { assessmentId },
    _sum: { points: true },
  });
  const maxScore = agg._sum.points ?? 0;
  await tx.assessment.update({
    where: { id: assessmentId },
    data: { maxScore },
  });
  return maxScore;
}

async function requireAdmin(): Promise<AdminContext> {
  // Services are called from server actions that already resolved the
  // context; this fallback exists for tests and keeps the signature
  // symmetric with the other services.
  const { requireAdminContext } = await import("@/lib/auth/dev-admin");
  return requireAdminContext();
}

/* ------------------------------------------------------------------ */
/* Manage — listing & detail                                            */
/* ------------------------------------------------------------------ */

export interface ManageAssessmentFilters {
  q?: string;
  status?: string;
  page?: number;
}

export async function listAssessmentsForManage(
  ctx: AdminContext,
  filters: ManageAssessmentFilters
): Promise<AssessmentResult<Paginated<ManageAssessmentRow>>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const where: Prisma.AssessmentWhereInput = {};
  if (ctx.role === "DEVELOPMENT_OFFICE_MANAGER") {
    where.schoolId = ctx.schoolId;
  }
  if (filters.status && filters.status.trim().length > 0) {
    where.status = filters.status.trim();
  }
  if (filters.q && filters.q.trim().length > 0) {
    where.titleAr = { contains: filters.q.trim() };
  }

  const total = await db.assessment.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ASSESSMENTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  const rows = await db.assessment.findMany({
    where,
    include: {
      school: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
      _count: { select: { questions: true, attempts: true } },
    },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * ASSESSMENTS_PAGE_SIZE,
    take: ASSESSMENTS_PAGE_SIZE,
  });

  return {
    ok: true,
    data: {
      rows: rows.map((row) => ({
        id: row.id,
        titleAr: row.titleAr,
        titleEn: row.titleEn,
        status: row.status,
        schoolId: row.schoolId,
        schoolName: row.school?.nameAr ?? null,
        courseId: row.courseId,
        courseTitle: row.course?.titleAr ?? null,
        questionsCount: row._count.questions,
        attemptsCount: row._count.attempts,
        maxScore: row.maxScore,
        passingScore: row.passingScore,
        timeLimitMinutes: row.timeLimitMinutes,
        attemptLimit: row.attemptLimit,
        availableFrom: row.availableFrom,
        availableUntil: row.availableUntil,
        updatedAt: row.updatedAt,
      })),
      total,
      page,
      pageCount,
    },
  };
}

async function buildAssessmentStats(
  tx: Prisma.TransactionClient | typeof db,
  assessmentId: string
): Promise<AssessmentStats> {
  const [attemptsTotal, needsReviewCount, passedCount, failedCount, expiredCount, graded] =
    await Promise.all([
      tx.assessmentAttempt.count({ where: { assessmentId } }),
      tx.assessmentAttempt.count({ where: { assessmentId, status: "NEEDS_REVIEW" } }),
      tx.assessmentAttempt.count({ where: { assessmentId, status: "PASSED" } }),
      tx.assessmentAttempt.count({ where: { assessmentId, status: "FAILED" } }),
      tx.assessmentAttempt.count({ where: { assessmentId, status: "EXPIRED" } }),
      tx.assessmentAttempt.findMany({
        where: { assessmentId, status: { in: ["PASSED", "FAILED"] } },
        select: { percentage: true },
      }),
    ]);

  const percentages = graded
    .map((row) => row.percentage)
    .filter((value): value is number => typeof value === "number");
  const avgPercentage =
    percentages.length > 0
      ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length)
      : null;
  const passRate =
    passedCount + failedCount > 0
      ? Math.round((passedCount / (passedCount + failedCount)) * 100)
      : null;

  return {
    attemptsTotal,
    needsReviewCount,
    passedCount,
    failedCount,
    expiredCount,
    avgPercentage,
    passRate,
  };
}

export async function getAssessmentForManage(
  ctx: AdminContext,
  assessmentId: string
): Promise<AssessmentResult<ManageAssessmentDetail>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const row = await db.assessment.findUnique({
    where: { id: assessmentId },
    include: {
      school: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
    },
  });
  if (!row) return assessmentFail("الاختبار غير موجود", "NOT_FOUND");
  const scopeCheck = assessmentScopeError(ctx, row.schoolId);
  if (scopeCheck) return scopeCheck;

  const questions = await db.assessmentQuestion.findMany({
    where: { assessmentId: row.id },
    orderBy: { orderIndex: "asc" },
  });

  const stats = await buildAssessmentStats(db, row.id);

  return {
    ok: true,
    data: {
      assessment: {
        id: row.id,
        titleAr: row.titleAr,
        titleEn: row.titleEn,
        status: row.status,
        schoolId: row.schoolId,
        schoolName: row.school?.nameAr ?? null,
        courseId: row.courseId,
        courseTitle: row.course?.titleAr ?? null,
        maxScore: row.maxScore,
        passingScore: row.passingScore,
        timeLimitMinutes: row.timeLimitMinutes,
        attemptLimit: row.attemptLimit,
        availableFrom: row.availableFrom,
        availableUntil: row.availableUntil,
        updatedAt: row.updatedAt,
        instructionsAr: row.instructionsAr,
        instructionsEn: row.instructionsEn,
      },
      questions: questions.map((question) => ({
        id: question.id,
        type: question.type,
        textAr: question.textAr,
        textEn: question.textEn,
        points: question.points,
        isRequired: question.isRequired,
        orderIndex: question.orderIndex,
        options: parseOptions(question.optionsJson),
        answerKey: parseAnswerKey(question.type, question.answerKeyJson),
        explanation: question.explanation,
      })),
      stats,
    },
  };
}

export async function listAttemptsForManage(
  ctx: AdminContext,
  assessmentId: string
): Promise<AssessmentResult<ManageAttemptRow[]>> {
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const assessment = await db.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, schoolId: true },
  });
  if (!assessment) return assessmentFail("الاختبار غير موجود", "NOT_FOUND");
  const scopeCheck = assessmentScopeError(ctx, assessment.schoolId);
  if (scopeCheck) return scopeCheck;

  const shortQuestions = await db.assessmentQuestion.findMany({
    where: { assessmentId, type: "SHORT_ANSWER" },
    select: { id: true, textAr: true, points: true, answerKeyJson: true },
  });
  const shortById = new Map(shortQuestions.map((q) => [q.id, q]));

  const rows = await db.assessmentAttempt.findMany({
    where: { assessmentId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { startedAt: "desc" },
    take: ATTEMPTS_PREVIEW_LIMIT,
  });

  return {
    ok: true,
    data: rows.map((row) => {
      const answers = parseAnswers(row.answersJson);
      const shortAnswers =
        row.status === "NEEDS_REVIEW"
          ? answers
              .filter((answer) => shortById.has(answer.questionId))
              .map((answer) => {
                const question = shortById.get(answer.questionId);
                const key = parseAnswerKey("SHORT_ANSWER", question?.answerKeyJson);
                return {
                  questionId: answer.questionId,
                  questionText: question?.textAr ?? "",
                  points: question?.points ?? 0,
                  answerText: answer.text ?? "",
                  modelAnswer: key && "modelAnswer" in key ? key.modelAnswer ?? null : null,
                };
              })
          : [];
      return {
        id: row.id,
        status: row.status,
        userId: row.user.id,
        userName: row.user.name,
        userEmail: row.user.email,
        startedAt: row.startedAt,
        submittedAt: row.submittedAt,
        deadlineAt: row.deadlineAt,
        objectiveScore: row.objectiveScore,
        earnedScore: row.earnedScore,
        maxScore: row.maxScore,
        percentage: row.percentage,
        passed: row.passed,
        shortAnswers,
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Manage — create / update / publish                                   */
/* ------------------------------------------------------------------ */

/** Course binding must share the assessment's tenant and stay active. */
async function validateCourseBinding(
  schoolId: string | null,
  courseId: string | undefined
): Promise<AssessmentResult<never> | null> {
  if (!courseId) return null;
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { schoolId: true, status: true },
  });
  if (!course) {
    return assessmentFail("الدورة المحددة غير موجودة", "NOT_FOUND");
  }
  if ((course.schoolId ?? null) !== schoolId) {
    return assessmentFail(
      "الدورة المحددة لا تنتمي إلى نطاق هذا الاختبار",
      "RELATION_ERROR"
    );
  }
  if (course.status === "ARCHIVED") {
    return assessmentFail("لا يمكن ربط اختبار بدورة مؤرشفة", "RELATION_ERROR");
  }
  return null;
}

export async function createAssessment(
  raw: unknown,
  actor?: AdminContext
): Promise<AssessmentResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = createAssessmentSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const scope = resolveScope(ctx, input.scope, input.schoolId);
  if (!scope.ok) return scope;

  const relationError = await validateCourseBinding(scope.schoolId, input.courseId);
  if (relationError) return relationError;

  const assessment = await db.assessment.create({
    data: {
      schoolId: scope.schoolId,
      courseId: input.courseId ?? null,
      titleAr: input.titleAr,
      titleEn: input.titleEn ?? null,
      instructionsAr: input.instructionsAr,
      instructionsEn: input.instructionsEn ?? null,
      status: "DRAFT",
      passingScore: input.passingScore,
      timeLimitMinutes: input.timeLimitMinutes ?? null,
      attemptLimit: input.attemptLimit ?? null,
      availableFrom: input.availableFrom ?? null,
      availableUntil: input.availableUntil ?? null,
      createdById: ctx.id,
    },
    select: { id: true },
  });
  return { ok: true, data: assessment };
}

/**
 * Settings update. Tenancy (schoolId) is intentionally IMMUTABLE after
 * creation — moving records between tenants would invalidate every
 * existing attempt's scoping.
 */
export async function updateAssessment(
  raw: unknown,
  actor?: AdminContext
): Promise<AssessmentResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = updateAssessmentSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const assessment = await db.assessment.findUnique({
    where: { id: input.assessmentId },
  });
  if (!assessment) return assessmentFail("الاختبار غير موجود", "NOT_FOUND");
  const scopeCheck = assessmentScopeError(ctx, assessment.schoolId);
  if (scopeCheck) return scopeCheck;

  if (assessment.status === "ARCHIVED") {
    return assessmentFail(
      "الاختبار مؤرشف — لا يمكن تعديله. أنشئ اختبارًا جديدًا أو أعد الحالة أولًا",
      "FORBIDDEN"
    );
  }

  const relationError = await validateCourseBinding(
    assessment.schoolId,
    input.courseId
  );
  if (relationError) return relationError;

  if (
    assessment.status === "PUBLISHED" &&
    input.passingScore > assessment.maxScore
  ) {
    return assessmentFail(
      `درجة النجاح أكبر من مجموع درجات الأسئلة الحالي (${assessment.maxScore} نقطة)`,
      "PUBLISH_BLOCKED"
    );
  }

  const updated = await db.assessment.update({
    where: { id: assessment.id },
    data: {
      courseId: input.courseId ?? null,
      titleAr: input.titleAr,
      titleEn: input.titleEn ?? null,
      instructionsAr: input.instructionsAr,
      instructionsEn: input.instructionsEn ?? null,
      passingScore: input.passingScore,
      timeLimitMinutes: input.timeLimitMinutes ?? null,
      attemptLimit: input.attemptLimit ?? null,
      availableFrom: input.availableFrom ?? null,
      availableUntil: input.availableUntil ?? null,
    },
    select: { id: true },
  });
  return { ok: true, data: updated };
}

/**
 * Publish guard: at least one question and a passing score that fits
 * the total points. Archive / unpublish are always allowed.
 */
export async function setAssessmentStatus(
  raw: unknown,
  actor?: AdminContext
): Promise<AssessmentResult<{ id: string; status: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = setAssessmentStatusSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const assessment = await db.assessment.findUnique({
    where: { id: input.assessmentId },
  });
  if (!assessment) return assessmentFail("الاختبار غير موجود", "NOT_FOUND");
  const scopeCheck = assessmentScopeError(ctx, assessment.schoolId);
  if (scopeCheck) return scopeCheck;

  if (input.status === "PUBLISHED") {
    const questionsCount = await db.assessmentQuestion.count({
      where: { assessmentId: assessment.id },
    });
    if (questionsCount < MIN_QUESTIONS_TO_PUBLISH) {
      return assessmentFail(
        "لا يمكن النشر — أضف سؤالًا واحدًا على الأقل قبل النشر",
        "PUBLISH_BLOCKED"
      );
    }
    if (assessment.passingScore > assessment.maxScore) {
      return assessmentFail(
        `لا يمكن النشر — درجة النجاح (${assessment.passingScore}) أكبر من مجموع درجات الأسئلة (${assessment.maxScore})`,
        "PUBLISH_BLOCKED"
      );
    }
  }
  if (input.status === "DRAFT" && assessment.status === "ARCHIVED") {
    return assessmentFail(
      "الاختبار مؤرشف — لا يمكن إرجاعه إلى مسودة في هذه المرحلة",
      "FORBIDDEN"
    );
  }

  const updated = await db.assessment.update({
    where: { id: assessment.id },
    data: { status: input.status },
    select: { id: true, status: true },
  });
  return { ok: true, data: updated };
}

/* ------------------------------------------------------------------ */
/* Manage — questions                                                   */
/* ------------------------------------------------------------------ */

async function loadQuestionContext(
  ctx: AdminContext,
  assessmentId: string
): Promise<
  | { ok: true; assessment: { id: string; schoolId: string | null; status: string; maxScore: number } }
  | { ok: false; message: string; code: AssessmentErrorCode }
> {
  const assessment = await db.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, schoolId: true, status: true, maxScore: true },
  });
  if (!assessment) {
    return { ok: false, message: "الاختبار غير موجود", code: "NOT_FOUND" };
  }
  const scopeCheck = assessmentScopeError(ctx, assessment.schoolId);
  if (scopeCheck) {
    return { ok: false, message: scopeCheck.message, code: scopeCheck.code };
  }
  return { ok: true, assessment };
}

function questionEditBlocked(
  status: string
): AssessmentResult<never> | null {
  if (status === "ARCHIVED") {
    return assessmentFail("الاختبار مؤرشف — لا يمكن تعديل أسئلته", "FORBIDDEN");
  }
  return null;
}

export async function addQuestion(
  raw: unknown,
  actor?: AdminContext
): Promise<AssessmentResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = createQuestionSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const loaded = await loadQuestionContext(ctx, input.assessmentId);
  if (!loaded.ok) return loaded;
  const blocked = questionEditBlocked(loaded.assessment.status);
  if (blocked) return blocked;

  const count = await db.assessmentQuestion.count({
    where: { assessmentId: input.assessmentId },
  });
  if (count >= MAX_QUESTIONS) {
    return assessmentFail(
      `لا يمكن إضافة المزيد من الأسئلة — الحد الأقصى ${MAX_QUESTIONS} سؤالًا`,
      "VALIDATION_ERROR"
    );
  }
  if (loaded.assessment.maxScore + input.points > MAX_ASSESSMENT_POINTS) {
    return assessmentFail(
      `مجموع درجات الأسئلة يتجاوز الحد الأقصى (${MAX_ASSESSMENT_POINTS} نقطة)`,
      "VALIDATION_ERROR"
    );
  }

  const { options, answerKey } = buildOptionsAndKey(
    input.type,
    input.options,
    input.correctOptionIndexes,
    input.correctValue,
    input.modelAnswer,
    []
  );

  const question = await db.$transaction(async (tx) => {
    const created = await tx.assessmentQuestion.create({
      data: {
        assessmentId: input.assessmentId,
        type: input.type,
        textAr: input.textAr,
        textEn: input.textEn ?? null,
        orderIndex: count,
        points: input.points,
        isRequired: input.isRequired,
        optionsJson: options.length > 0 ? JSON.stringify(options) : null,
        answerKeyJson: JSON.stringify(answerKey),
        explanation: input.explanation ?? null,
      },
      select: { id: true },
    });
    await recomputeMaxScore(tx, input.assessmentId);
    return created;
  });

  return { ok: true, data: question };
}

export async function updateQuestion(
  raw: unknown,
  actor?: AdminContext
): Promise<AssessmentResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = updateQuestionSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const loaded = await loadQuestionContext(ctx, input.assessmentId);
  if (!loaded.ok) return loaded;
  const blocked = questionEditBlocked(loaded.assessment.status);
  if (blocked) return blocked;

  const existing = await db.assessmentQuestion.findUnique({
    where: { id: input.questionId },
  });
  if (!existing || existing.assessmentId !== input.assessmentId) {
    return assessmentFail("السؤال غير موجود", "NOT_FOUND");
  }

  const { options, answerKey } = buildOptionsAndKey(
    input.type,
    input.options,
    input.correctOptionIndexes,
    input.correctValue,
    input.modelAnswer,
    parseOptions(existing.optionsJson)
  );

  const question = await db.$transaction(async (tx) => {
    const updated = await tx.assessmentQuestion.update({
      where: { id: existing.id },
      data: {
        type: input.type,
        textAr: input.textAr,
        textEn: input.textEn ?? null,
        points: input.points,
        isRequired: input.isRequired,
        optionsJson: options.length > 0 ? JSON.stringify(options) : null,
        answerKeyJson: JSON.stringify(answerKey),
        explanation: input.explanation ?? null,
      },
      select: { id: true },
    });
    await recomputeMaxScore(tx, input.assessmentId);
    return updated;
  });

  return { ok: true, data: question };
}

export async function deleteQuestion(
  raw: unknown,
  actor?: AdminContext
): Promise<AssessmentResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = deleteQuestionSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);

  const existing = await db.assessmentQuestion.findUnique({
    where: { id: parsed.data.questionId },
    include: {
      assessment: {
        select: { id: true, schoolId: true, status: true, maxScore: true },
      },
    },
  });
  if (!existing) return assessmentFail("السؤال غير موجود", "NOT_FOUND");
  const scopeCheck = assessmentScopeError(ctx, existing.assessment.schoolId);
  if (scopeCheck) return scopeCheck;
  const blocked = questionEditBlocked(existing.assessment.status);
  if (blocked) return blocked;

  const remainingCount = await db.assessmentQuestion.count({
    where: { assessmentId: existing.assessmentId, NOT: { id: existing.id } },
  });
  if (existing.assessment.status === "PUBLISHED" && remainingCount < 1) {
    return assessmentFail(
      "لا يمكن حذف آخر سؤال في اختبار منشور — أرشف الاختبار أو أضف سؤالًا آخر أولًا",
      "PUBLISH_BLOCKED"
    );
  }

  await db.$transaction(async (tx) => {
    await tx.assessmentQuestion.delete({ where: { id: existing.id } });
    await recomputeMaxScore(tx, existing.assessmentId);
  });

  return { ok: true, data: { id: existing.id } };
}

export async function moveQuestion(
  raw: unknown,
  actor?: AdminContext
): Promise<AssessmentResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = moveQuestionSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const loaded = await loadQuestionContext(ctx, input.assessmentId);
  if (!loaded.ok) return loaded;
  const blocked = questionEditBlocked(loaded.assessment.status);
  if (blocked) return blocked;

  const ordered = await db.assessmentQuestion.findMany({
    where: { assessmentId: input.assessmentId },
    orderBy: { orderIndex: "asc" },
    select: { id: true, orderIndex: true },
  });
  const index = ordered.findIndex((q) => q.id === input.questionId);
  if (index === -1) {
    return assessmentFail("السؤال غير موجود", "NOT_FOUND");
  }
  const targetIndex = input.direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ordered.length) {
    return { ok: true, data: { id: input.questionId } };
  }

  // Swap-based move — mirrors the training content ordering contract.
  await db.$transaction(async (tx) => {
    await tx.assessmentQuestion.update({
      where: { id: ordered[index].id },
      data: { orderIndex: ordered[targetIndex].orderIndex },
    });
    await tx.assessmentQuestion.update({
      where: { id: ordered[targetIndex].id },
      data: { orderIndex: ordered[index].orderIndex },
    });
  });

  return { ok: true, data: { id: input.questionId } };
}

/* ------------------------------------------------------------------ */
/* Teacher side — catalog                                               */
/* ------------------------------------------------------------------ */

export interface TeacherAssessmentFilters {
  q?: string;
  page?: number;
}

export async function listPublishedAssessments(
  viewer: ViewerIdentity,
  filters: TeacherAssessmentFilters
): Promise<AssessmentResult<Paginated<TeacherAssessmentRow>>> {
  const where: Prisma.AssessmentWhereInput = {
    ...publishedAssessmentWhere(viewer),
  };
  if (filters.q && filters.q.trim().length > 0) {
    where.titleAr = { contains: filters.q.trim() };
  }

  const total = await db.assessment.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ASSESSMENTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  const rows = await db.assessment.findMany({
    where,
    include: {
      school: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
      _count: { select: { questions: true } },
      attempts: {
        where: { userId: viewer.id },
        select: { status: true, startedAt: true },
        orderBy: { startedAt: "desc" },
      },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    skip: (page - 1) * ASSESSMENTS_PAGE_SIZE,
    take: ASSESSMENTS_PAGE_SIZE,
  });

  return {
    ok: true,
    data: {
      rows: rows.map((row) => {
        const attemptsUsed = row.attempts.length;
        const latest = row.attempts[0];
        return {
          id: row.id,
          titleAr: row.titleAr,
          titleEn: row.titleEn,
          courseTitle: row.course?.titleAr ?? null,
          schoolName: row.school?.nameAr ?? null,
          questionsCount: row._count.questions,
          maxScore: row.maxScore,
          passingScore: row.passingScore,
          timeLimitMinutes: row.timeLimitMinutes,
          attemptLimit: row.attemptLimit,
          availableFrom: row.availableFrom,
          availableUntil: row.availableUntil,
          availability: availabilityState(row),
          attemptsUsed,
          latestStatus: (latest?.status as AttemptStatus | undefined) ?? null,
        };
      }),
      total,
      page,
      pageCount,
    },
  };
}

/**
 * Instructions & eligibility detail for the teacher. Questions are
 * deliberately NOT included — they are only served inside an active
 * attempt and after submission (answer-key protection).
 */
export async function getAssessmentForTaking(
  viewer: ViewerIdentity,
  assessmentId: string
): Promise<AssessmentResult<TeacherAssessmentDetail>> {
  const row = await db.assessment.findUnique({
    where: { id: assessmentId },
    include: {
      school: { select: { nameAr: true } },
      course: { select: { id: true, titleAr: true } },
      _count: { select: { questions: true } },
    },
  });
  if (!row) return assessmentFail("الاختبار غير موجود", "NOT_FOUND");
  if (!canViewPublishedAssessment(viewer, row)) {
    return assessmentFail("هذا الاختبار غير متاح لك", "FORBIDDEN");
  }

  const [attempts, enrollment] = await Promise.all([
    db.assessmentAttempt.findMany({
      where: { assessmentId: row.id, userId: viewer.id },
      select: { id: true, status: true, startedAt: true, deadlineAt: true },
      orderBy: { startedAt: "desc" },
    }),
    row.courseId
      ? db.courseEnrollment.findUnique({
          where: {
            courseId_userId: { courseId: row.courseId, userId: viewer.id },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const active = attempts.find((attempt) => attempt.status === "IN_PROGRESS");
  const attemptsUsed = attempts.length;
  const remainingAttempts =
    row.attemptLimit === null ? null : Math.max(0, row.attemptLimit - attemptsUsed);

  return {
    ok: true,
    data: {
      assessment: {
        id: row.id,
        titleAr: row.titleAr,
        titleEn: row.titleEn,
        instructionsAr: row.instructionsAr,
        instructionsEn: row.instructionsEn,
        courseTitle: row.course?.titleAr ?? null,
        schoolName: row.school?.nameAr ?? null,
        questionsCount: row._count.questions,
        maxScore: row.maxScore,
        passingScore: row.passingScore,
        timeLimitMinutes: row.timeLimitMinutes,
        attemptLimit: row.attemptLimit,
        availableFrom: row.availableFrom,
        availableUntil: row.availableUntil,
        availability: availabilityState(row),
      },
      enrollmentRequired: row.courseId !== null,
      enrolled: enrollment !== null,
      attemptsUsed,
      remainingAttempts,
      activeAttempt: active
        ? { id: active.id, startedAt: active.startedAt, deadlineAt: active.deadlineAt }
        : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Teacher side — attempts                                              */
/* ------------------------------------------------------------------ */

export interface StartAttemptOutcome {
  attemptId: string;
  resumed: boolean;
  deadlineAt: Date | null;
}

/**
 * Start (or resume) an attempt. All eligibility rules run SERVER-SIDE:
 * role, visibility, availability window, enrollment (course-bound),
 * attempt limit (counted inside the transaction) and timer deadline.
 */
export async function startAttempt(
  viewer: ViewerIdentity,
  assessmentId: string
): Promise<AssessmentResult<StartAttemptOutcome>> {
  if (viewer.role !== "TEACHER") {
    return assessmentFail("بدء المحاولات متاح للمعلمين فقط", "FORBIDDEN");
  }

  const assessment = await db.assessment.findUnique({
    where: { id: assessmentId },
  });
  if (!assessment) return assessmentFail("الاختبار غير موجود", "NOT_FOUND");
  if (!canViewPublishedAssessment(viewer, assessment)) {
    return assessmentFail("هذا الاختبار غير متاح لك", "FORBIDDEN");
  }
  if (availabilityState(assessment) === "scheduled") {
    return assessmentFail(
      "لم يبدأ توافر هذا الاختبار بعد — راجع موعد البدء",
      "NOT_AVAILABLE"
    );
  }
  if (availabilityState(assessment) === "closed") {
    return assessmentFail("انتهت فترة توافر هذا الاختبار", "NOT_AVAILABLE");
  }

  if (assessment.courseId) {
    const enrollment = await db.courseEnrollment.findUnique({
      where: {
        courseId_userId: { courseId: assessment.courseId, userId: viewer.id },
      },
      select: { id: true },
    });
    if (!enrollment) {
      return assessmentFail(
        "هذا الاختبار مرتبط بدورة تدريبية — سجّل في الدورة أولًا",
        "ENROLLMENT_REQUIRED"
      );
    }
  }

  return db.$transaction(async (tx) => {
    const attempts = await tx.assessmentAttempt.findMany({
      where: { assessmentId: assessment.id, userId: viewer.id },
      select: { id: true, status: true, deadlineAt: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    });

    // Resume the live attempt instead of starting a new one.
    const live = attempts.find(
      (attempt) =>
        attempt.status === "IN_PROGRESS" &&
        (attempt.deadlineAt === null || attempt.deadlineAt.getTime() > Date.now())
    );
    if (live) {
      return {
        ok: true,
        data: {
          attemptId: live.id,
          resumed: true,
          deadlineAt: live.deadlineAt,
        },
      };
    }

    // Expire stale IN_PROGRESS attempts (deadline passed, never submitted).
    const stale = attempts.filter(
      (attempt) =>
        attempt.status === "IN_PROGRESS" &&
        attempt.deadlineAt !== null &&
        attempt.deadlineAt.getTime() <= Date.now()
    );
    for (const attempt of stale) {
      await tx.assessmentAttempt.update({
        where: { id: attempt.id },
        data: { status: "EXPIRED" },
      });
    }

    const attemptsUsed = attempts.length;
    if (assessment.attemptLimit !== null && attemptsUsed >= assessment.attemptLimit) {
      return {
        ok: false,
        message: `استهلكت كل المحاولات المسموحة (${assessment.attemptLimit}) لهذا الاختبار`,
        code: "ATTEMPT_LIMIT_REACHED" as AssessmentErrorCode,
      };
    }

    const deadlineAt =
      assessment.timeLimitMinutes !== null
        ? new Date(Date.now() + assessment.timeLimitMinutes * 60 * 1000)
        : null;

    const created = await tx.assessmentAttempt.create({
      data: {
        assessmentId: assessment.id,
        userId: viewer.id,
        status: "IN_PROGRESS",
        deadlineAt,
      },
      select: { id: true, deadlineAt: true },
    });

    return {
      ok: true,
      data: {
        attemptId: created.id,
        resumed: false,
        deadlineAt: created.deadlineAt,
      },
    };
  });
}

/** Shared validation of draft/submitted answers against THIS assessment. */
async function validateAnswerBelonging(
  tx: Prisma.TransactionClient | typeof db,
  assessmentId: string,
  answers: SubmittedAnswer[]
): Promise<AssessmentResult<Map<string, ParsedQuestion>>> {
  const questions = await tx.assessmentQuestion.findMany({
    where: { assessmentId },
    orderBy: { orderIndex: "asc" },
  });
  const byId = new Map<string, ParsedQuestion>(
    questions.map((question) => [
      question.id,
      {
        id: question.id,
        type: question.type as QuestionType,
        points: question.points,
        isRequired: question.isRequired,
        orderIndex: question.orderIndex,
        textAr: question.textAr,
        textEn: question.textEn,
        explanation: question.explanation,
        options: parseOptions(question.optionsJson),
        answerKey: parseAnswerKey(question.type, question.answerKeyJson),
      },
    ])
  );

  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question) {
      // Distinguish "foreign question" (reject) from "question deleted
      // mid-attempt by the manager" (drop silently — not the teacher's
      // fault and not another assessment's data).
      const stray = await tx.assessmentQuestion.findUnique({
        where: { id: answer.questionId },
        select: { assessmentId: true },
      });
      if (!stray || stray.assessmentId !== assessmentId) {
        return assessmentFail(
          "إجابة تشير إلى سؤال لا يخص هذا الاختبار — حدّث الصفحة وأعد المحاولة",
          "INVALID_ANSWER"
        );
      }
      continue;
    }

    const isChoice = (CHOICE_TYPES as readonly string[]).includes(question.type);
    if (answer.choice !== undefined) {
      if (!isChoice) {
        return assessmentFail(
          "صيغة إجابة غير مطابقة لنوع أحد الأسئلة",
          "INVALID_ANSWER"
        );
      }
      const validIds = new Set(question.options.map((option) => option.id));
      if (answer.choice.some((optionId) => !validIds.has(optionId))) {
        return assessmentFail(
          "إجابة تشير إلى خيار غير موجود — حدّث الصفحة وأعد المحاولة",
          "INVALID_ANSWER"
        );
      }
    }
    if (answer.bool !== undefined && question.type !== "TRUE_FALSE") {
      return assessmentFail(
        "صيغة إجابة غير مطابقة لنوع أحد الأسئلة",
        "INVALID_ANSWER"
      );
    }
    if (answer.text !== undefined && question.type !== "SHORT_ANSWER") {
      return assessmentFail(
        "صيغة إجابة غير مطابقة لنوع أحد الأسئلة",
        "INVALID_ANSWER"
      );
    }
  }

  return { ok: true, data: byId };
}

/** Autosave the teacher's draft answers on their own IN_PROGRESS attempt. */
export async function saveAttemptDraft(
  viewer: ViewerIdentity,
  raw: unknown
): Promise<AssessmentResult<{ id: string }>> {
  const parsed = saveDraftSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const attempt = await db.assessmentAttempt.findUnique({
    where: { id: input.attemptId },
  });
  if (!attempt) return assessmentFail("المحاولة غير موجودة", "NOT_FOUND");
  if (attempt.userId !== viewer.id) {
    return assessmentFail("لا يمكن تعديل محاولة معلم آخر", "FORBIDDEN");
  }
  if (attempt.status !== "IN_PROGRESS") {
    return assessmentFail("هذه المحاولة لم تعد قيد التنفيذ", "ALREADY_SUBMITTED");
  }
  if (attempt.deadlineAt && attempt.deadlineAt.getTime() <= Date.now()) {
    return assessmentFail("انتهى وقت المحاولة — لا يمكن حفظ المسودة", "DEADLINE_PASSED");
  }

  const answersResult = await validateAnswerBelonging(
    db,
    attempt.assessmentId,
    input.answers
  );
  if (!answersResult.ok) return answersResult;

  await db.assessmentAttempt.update({
    where: { id: attempt.id },
    data: { answersJson: JSON.stringify(input.answers) },
  });
  return { ok: true, data: { id: attempt.id } };
}

/**
 * Submit + grade inside ONE transaction:
 *   1. reload the attempt and re-check ownership/status/deadline,
 *   2. validate every answer against this assessment's questions,
 *   3. grade objective questions server-side (never trusting the
 *      browser's score), short answers defer to NEEDS_REVIEW,
 *   4. flip the row with a conditional updateMany(status =
 *      IN_PROGRESS) so concurrent double-submissions cannot double-grade.
 */
export async function submitAttempt(
  viewer: ViewerIdentity,
  raw: unknown
): Promise<AssessmentResult<{ attemptId: string; status: AttemptStatus }>> {
  const parsed = submitAttemptSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const existing = await db.assessmentAttempt.findUnique({
    where: { id: input.attemptId },
    include: {
      assessment: {
        select: {
          id: true,
          status: true,
          schoolId: true,
          passingScore: true,
          availableUntil: true,
          attemptLimit: true,
        },
      },
    },
  });
  if (!existing) return assessmentFail("المحاولة غير موجودة", "NOT_FOUND");
  if (existing.userId !== viewer.id) {
    return assessmentFail("لا يمكن تسليم محاولة معلم آخر", "FORBIDDEN");
  }

  return db.$transaction(async (tx) => {
    const attempt = await tx.assessmentAttempt.findUnique({
      where: { id: input.attemptId },
      include: {
        assessment: {
          select: {
            id: true,
            status: true,
            schoolId: true,
            passingScore: true,
            availableUntil: true,
          },
        },
      },
    });
    if (!attempt) {
      return {
        ok: false,
        message: "المحاولة غير موجودة",
        code: "NOT_FOUND" as AssessmentErrorCode,
      };
    }
    if (attempt.userId !== viewer.id) {
      return {
        ok: false,
        message: "لا يمكن تسليم محاولة معلم آخر",
        code: "FORBIDDEN" as AssessmentErrorCode,
      };
    }
    if (attempt.status !== "IN_PROGRESS") {
      return {
        ok: false,
        message: "تم تسليم هذه المحاولة من قبل",
        code: "ALREADY_SUBMITTED" as AssessmentErrorCode,
      };
    }
    if (attempt.deadlineAt && attempt.deadlineAt.getTime() <= Date.now()) {
      // Server-enforced deadline — the browser timer is only cosmetic.
      await tx.assessmentAttempt.update({
        where: { id: attempt.id },
        data: { status: "EXPIRED" },
      });
      return {
        ok: false,
        message: "انتهى وقت المحاولة — لم يُقبل التسليم بعد المهلة",
        code: "DEADLINE_PASSED" as AssessmentErrorCode,
      };
    }
    if (attempt.assessment.status !== "PUBLISHED") {
      return {
        ok: false,
        message: "هذا الاختبار غير متاح للتسليم الآن",
        code: "NOT_AVAILABLE" as AssessmentErrorCode,
      };
    }
    if (
      attempt.assessment.availableUntil &&
      Date.now() > attempt.assessment.availableUntil.getTime()
    ) {
      return {
        ok: false,
        message: "انتهت فترة توافر هذا الاختبار",
        code: "NOT_AVAILABLE" as AssessmentErrorCode,
      };
    }

    const gradedQuestions = await validateAnswerBelonging(
      tx,
      attempt.assessmentId,
      input.answers
    );
    if (!gradedQuestions.ok) return gradedQuestions;
    const questionsById = gradedQuestions.data;
    const orderedQuestions = [...questionsById.values()].sort(
      (a, b) => a.orderIndex - b.orderIndex
    );

    // Server-side scoring — the browser never supplies a score.
    let objectiveScore = 0;
    let hasShort = false;
    for (const answer of input.answers) {
      const question = questionsById.get(answer.questionId);
      if (!question) continue; // dropped: deleted mid-attempt
      if (question.type === "SHORT_ANSWER") {
        hasShort = true;
        continue;
      }
      const key = question.answerKey;
      if (!key) continue;

      let correct = false;
      if (question.type === "SINGLE_CHOICE" && "optionId" in key) {
        correct =
          Array.isArray(answer.choice) &&
          answer.choice.length === 1 &&
          answer.choice[0] === key.optionId;
      } else if (question.type === "MULTIPLE_CHOICE" && "optionIds" in key) {
        const submitted = [...(answer.choice ?? [])].sort();
        const expected = [...key.optionIds].sort();
        correct =
          submitted.length === expected.length &&
          submitted.every((optionId, index) => optionId === expected[index]);
      } else if (question.type === "TRUE_FALSE" && "value" in key) {
        correct = answer.bool === key.value;
      }
      if (correct) objectiveScore += question.points;
    }

    const maxScoreNow = orderedQuestions.reduce(
      (sum, question) => sum + question.points,
      0
    );
    if (maxScoreNow <= 0) {
      return {
        ok: false,
        message: "لا يمكن تسليم هذا الاختبار — لا توجد أسئلة صالحة",
        code: "NOT_AVAILABLE" as AssessmentErrorCode,
      };
    }

    const submittedAt = new Date();
    const status: AttemptStatus = hasShort
      ? "NEEDS_REVIEW"
      : objectiveScore >= attempt.assessment.passingScore
        ? "PASSED"
        : "FAILED";
    const percentage = hasShort
      ? null
      : Math.round((objectiveScore / maxScoreNow) * 100);
    const passed = hasShort ? null : objectiveScore >= attempt.assessment.passingScore;

    // Conditional flip: only an IN_PROGRESS row can be graded, so two
    // concurrent submissions can never both apply their scores.
    const flipped = await tx.assessmentAttempt.updateMany({
      where: { id: attempt.id, status: "IN_PROGRESS" },
      data: {
        status,
        submittedAt,
        answersJson: JSON.stringify(input.answers),
        objectiveScore,
        maxScore: maxScoreNow,
        percentage,
        passed,
      },
    });
    if (flipped.count !== 1) {
      return {
        ok: false,
        message: "تم تسليم هذه المحاولة من قبل",
        code: "ALREADY_SUBMITTED" as AssessmentErrorCode,
      };
    }

    return { ok: true, data: { attemptId: attempt.id, status } };
  });
}

/* ------------------------------------------------------------------ */
/* Results & review                                                     */
/* ------------------------------------------------------------------ */

/**
 * Per-question result for the attempt OWNER. Correct answers are
 * revealed only after submission; unscored (EXPIRED) attempts show the
 * saved answers without keys; NEEDS_REVIEW shows objective results and
 * marks short answers as awaiting review.
 */
export async function getAttemptResult(
  viewer: ViewerIdentity,
  attemptId: string
): Promise<AssessmentResult<AttemptResultView>> {
  const attempt = await db.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: {
      assessment: { select: { id: true, titleAr: true, passingScore: true } },
    },
  });
  if (!attempt) return assessmentFail("المحاولة غير موجودة", "NOT_FOUND");
  if (attempt.userId !== viewer.id) {
    return assessmentFail("لا يمكنك الاطلاع على نتائج محاولة معلم آخر", "FORBIDDEN");
  }
  if (attempt.status === "IN_PROGRESS") {
    return assessmentFail(
      "هذه المحاولة لم تُسلَّم بعد — أكملها من صفحة الاختبار",
      "NOT_AVAILABLE"
    );
  }

  const questions = await db.assessmentQuestion.findMany({
    where: { assessmentId: attempt.assessmentId },
    orderBy: { orderIndex: "asc" },
  });
  const answers = new Map(
    parseAnswers(attempt.answersJson).map((answer) => [answer.questionId, answer])
  );
  const reviewScores = new Map(
    parseReviewScores(attempt.reviewScoresJson).map((score) => [score.questionId, score.points])
  );
  const revealed = attempt.status !== "EXPIRED";

  const breakdown: ResultQuestionBreakdown[] = questions.map((question) => {
    const parsed = {
      id: question.id,
      type: question.type as QuestionType,
      options: parseOptions(question.optionsJson),
      answerKey: parseAnswerKey(question.type, question.answerKeyJson),
    };
    const answer = answers.get(question.id);

    let yourAnswer: ResultQuestionBreakdown["yourAnswer"] = null;
    if (answer) {
      yourAnswer = {
        optionTexts: (answer.choice ?? [])
          .map((optionId) => parsed.options.find((option) => option.id === optionId)?.textAr ?? "")
          .filter((text) => text.length > 0),
        bool: answer.bool ?? null,
        text: answer.text ?? null,
      };
    }

    let correct: ResultQuestionBreakdown["correct"] = null;
    let earnedPoints: number | null = null;
    let isCorrect: boolean | null = null;

    if (revealed && parsed.answerKey) {
      const key = parsed.answerKey;
      if (parsed.type === "SINGLE_CHOICE" && "optionId" in key) {
        const correctText =
          parsed.options.find((option) => option.id === key.optionId)?.textAr ?? "";
        correct = {
          optionTexts: correctText.length > 0 ? [correctText] : [],
          bool: null,
          modelAnswer: null,
        };
        earnedPoints = answer?.choice?.[0] === key.optionId ? question.points : 0;
        isCorrect = earnedPoints === question.points;
      } else if (parsed.type === "MULTIPLE_CHOICE" && "optionIds" in key) {
        const expectedTexts = key.optionIds
          .map((optionId) => parsed.options.find((option) => option.id === optionId)?.textAr ?? "")
          .filter((text) => text.length > 0);
        correct = { optionTexts: expectedTexts, bool: null, modelAnswer: null };
        const submitted = [...(answer?.choice ?? [])].sort();
        const expected = [...key.optionIds].sort();
        const matches =
          submitted.length === expected.length &&
          submitted.every((optionId, index) => optionId === expected[index]);
        earnedPoints = matches ? question.points : 0;
        isCorrect = matches;
      } else if (parsed.type === "TRUE_FALSE" && "value" in parsed.answerKey) {
        correct = {
          optionTexts: [],
          bool: parsed.answerKey.value,
          modelAnswer: null,
        };
        earnedPoints = answer?.bool === parsed.answerKey.value ? question.points : 0;
        isCorrect = earnedPoints === question.points;
      } else if (parsed.type === "SHORT_ANSWER") {
        correct = {
          optionTexts: [],
          bool: null,
          modelAnswer:
            "modelAnswer" in parsed.answerKey ? parsed.answerKey.modelAnswer ?? null : null,
        };
        // Manual review state — never invent a grade.
        earnedPoints = reviewScores.has(question.id)
          ? reviewScores.get(question.id) ?? null
          : null;
        isCorrect = null;
      }
    }

    return {
      questionId: question.id,
      orderIndex: question.orderIndex,
      type: question.type,
      textAr: question.textAr,
      points: question.points,
      yourAnswer,
      correct,
      explanation: revealed ? question.explanation : null,
      earnedPoints,
      isCorrect,
    };
  });

  return {
    ok: true,
    data: {
      attempt: {
        id: attempt.id,
        status: attempt.status as AttemptStatus,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        deadlineAt: attempt.deadlineAt,
        objectiveScore: attempt.objectiveScore,
        earnedScore: attempt.earnedScore,
        maxScore: attempt.maxScore,
        percentage: attempt.percentage,
        passed: attempt.passed,
        reviewedAt: attempt.reviewedAt,
      },
      assessment: {
        id: attempt.assessment.id,
        titleAr: attempt.assessment.titleAr,
        passingScore: attempt.assessment.passingScore,
      },
      breakdown,
    },
  };
}

/** The teacher's own attempt history across all assessments. */
export async function listMyAttempts(
  viewer: ViewerIdentity
): Promise<AssessmentResult<MyAttemptRow[]>> {
  const rows = await db.assessmentAttempt.findMany({
    where: { userId: viewer.id },
    include: { assessment: { select: { id: true, titleAr: true } } },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      assessmentId: row.assessment.id,
      assessmentTitle: row.assessment.titleAr,
      status: row.status as AttemptStatus,
      startedAt: row.startedAt,
      submittedAt: row.submittedAt,
      earnedScore: row.earnedScore,
      maxScore: row.maxScore,
      percentage: row.percentage,
      passed: row.passed,
    })),
  };
}

/**
 * Manual review of a NEEDS_REVIEW attempt (short-answer grading).
 * Finalized attempts (PASSED/FAILED) are immutable — review is rejected.
 */
export async function reviewAttempt(
  raw: unknown,
  actor?: AdminContext
): Promise<AssessmentResult<{ id: string; status: AttemptStatus; percentage: number }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = managerGuard(ctx);
  if (guard) return guard;

  const parsed = reviewAttemptSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const attempt = await db.assessmentAttempt.findUnique({
    where: { id: input.attemptId },
    include: {
      assessment: { select: { id: true, schoolId: true, passingScore: true } },
    },
  });
  if (!attempt) return assessmentFail("المحاولة غير موجودة", "NOT_FOUND");
  const scopeCheck = assessmentScopeError(ctx, attempt.assessment.schoolId);
  if (scopeCheck) return scopeCheck;

  if (attempt.status !== "NEEDS_REVIEW") {
    return assessmentFail(
      "لا يمكن تعديل نتيجة نهائية — المراجعة متاحة للمحاولات المنتظرة فقط",
      "ALREADY_SUBMITTED"
    );
  }

  const shortQuestions = await db.assessmentQuestion.findMany({
    where: { assessmentId: attempt.assessmentId, type: "SHORT_ANSWER" },
    select: { id: true, points: true },
  });
  const shortById = new Map(shortQuestions.map((question) => [question.id, question]));

  for (const score of input.scores) {
    const question = shortById.get(score.questionId);
    if (!question) {
      return assessmentFail(
        "درجة مراجعة تشير إلى سؤال ليس من أسئلة الإجابة القصيرة في هذا الاختبار",
        "INVALID_ANSWER"
      );
    }
    if (score.points > question.points) {
      return assessmentFail(
        `الدرجة الممنوحة أكبر من الدرجة القصوى للسؤال (${question.points} نقاط)`,
        "INVALID_ANSWER"
      );
    }
  }

  const earnedScore = attempt.objectiveScore + input.scores.reduce((sum, s) => sum + s.points, 0);
  const maxScore = attempt.maxScore ?? 0;
  if (maxScore <= 0) {
    return assessmentFail("تعذر احتساب الدرجة الكلية لهذه المحاولة", "INVALID_ANSWER");
  }
  const percentage = Math.round((earnedScore / maxScore) * 100);
  const passed = earnedScore >= attempt.assessment.passingScore;
  const status: AttemptStatus = passed ? "PASSED" : "FAILED";

  await db.$transaction(async (tx) => {
    const flipped = await tx.assessmentAttempt.updateMany({
      where: { id: attempt.id, status: "NEEDS_REVIEW" },
      data: {
        status,
        earnedScore,
        percentage,
        passed,
        reviewScoresJson: JSON.stringify(input.scores),
        reviewedById: ctx.id,
        reviewedAt: new Date(),
      },
    });
    if (flipped.count !== 1) {
      throw new Error("ATTEMPT_REVIEW_RACE");
    }
  });

  return { ok: true, data: { id: attempt.id, status, percentage } };
}

/* ------------------------------------------------------------------ */
/* Read-only result views (supervisor / deputy)                         */
/* ------------------------------------------------------------------ */

/**
 * Supervisor view: attempts of teachers explicitly assigned to them,
 * confined to the supervisor's own school.
 */
export async function listSupervisorResults(
  viewer: ViewerIdentity
): Promise<AssessmentResult<ReadOnlyAttemptRow[]>> {
  if (viewer.role !== "EDUCATIONAL_SUPERVISOR") {
    return assessmentFail("هذه الشاشة مخصصة للمشرفين التربويين", "FORBIDDEN");
  }
  const assignments = await db.teacherSupervisorAssignment.findMany({
    where: { supervisorId: viewer.id, schoolId: viewer.schoolId ?? undefined },
    select: { teacherId: true },
  });
  const teacherIds = assignments.map((assignment) => assignment.teacherId);
  if (teacherIds.length === 0) return { ok: true, data: [] };

  const rows = await db.assessmentAttempt.findMany({
    where: { userId: { in: teacherIds }, status: { not: "IN_PROGRESS" } },
    include: {
      assessment: { select: { id: true, titleAr: true, status: true } },
      user: { select: { id: true, name: true, school: { select: { nameAr: true } } } },
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return { ok: true, data: rows.map(toReadOnlyRow) };
}

/**
 * Deputy read-only view: attempts inside the granted schools/branches
 * only — the grant rows are the single source of this boundary.
 */
export async function listDeputyResults(
  viewer: ViewerIdentity
): Promise<AssessmentResult<ReadOnlyAttemptRow[]>> {
  if (viewer.role !== "EDUCATIONAL_DEPUTY") {
    return assessmentFail("هذه الشاشة مخصصة للوكلاء التعليميين", "FORBIDDEN");
  }
  const grants = await db.deputyGrant.findMany({
    where: { userId: viewer.id },
    select: { schoolId: true, branchId: true },
  });
  if (grants.length === 0) return { ok: true, data: [] };

  const userFilters = grants.map((grant) => ({
    user: {
      schoolId: grant.schoolId,
      ...(grant.branchId ? { branchId: grant.branchId } : {}),
    },
  }));

  const rows = await db.assessmentAttempt.findMany({
    where: { OR: userFilters, status: { not: "IN_PROGRESS" } },
    include: {
      assessment: { select: { id: true, titleAr: true, status: true } },
      user: { select: { id: true, name: true, school: { select: { nameAr: true } } } },
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return { ok: true, data: rows.map(toReadOnlyRow) };
}

function toReadOnlyRow(
  row: Prisma.AssessmentAttemptGetPayload<{
    include: {
      assessment: { select: { id: true; titleAr: true; status: true } };
      user: { select: { id: true; name: true; school: { select: { nameAr: true } } } };
    };
  }>
): ReadOnlyAttemptRow {
  return {
    id: row.id,
    assessmentId: row.assessment.id,
    assessmentTitle: row.assessment.titleAr,
    assessmentStatus: row.assessment.status,
    teacherId: row.user.id,
    teacherName: row.user.name,
    schoolName: row.user.school?.nameAr ?? null,
    status: row.status as AttemptStatus,
    submittedAt: row.submittedAt,
    earnedScore: row.earnedScore,
    maxScore: row.maxScore,
    percentage: row.percentage,
    passed: row.passed,
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard metrics                                                    */
/* ------------------------------------------------------------------ */

/** Real persisted assessment metrics scoped by school (null = platform). */
export async function getAssessmentMetrics(
  schoolId: string | null
): Promise<AssessmentMetrics> {
  const assessmentWhere: Prisma.AssessmentWhereInput = schoolId
    ? { schoolId }
    : {};
  const attemptWhere: Prisma.AssessmentAttemptWhereInput = schoolId
    ? { user: { schoolId } }
    : {};

  const [assessmentsTotal, assessmentsPublished, finalized, needsReviewCount, graded] =
    await Promise.all([
      db.assessment.count({ where: assessmentWhere }),
      db.assessment.count({ where: { ...assessmentWhere, status: "PUBLISHED" } }),
      db.assessmentAttempt.count({
        where: { ...attemptWhere, status: { in: ["PASSED", "FAILED"] } },
      }),
      db.assessmentAttempt.count({
        where: { ...attemptWhere, status: "NEEDS_REVIEW" },
      }),
      db.assessmentAttempt.findMany({
        where: { ...attemptWhere, status: { in: ["PASSED", "FAILED"] } },
        select: { percentage: true, passed: true },
      }),
    ]);

  const avgPercentage =
    finalized > 0
      ? Math.round(
          graded.reduce((sum, row) => sum + (row.percentage ?? 0), 0) / finalized
        )
      : null;
  const passedCount = graded.filter((row) => row.passed === true).length;
  const passRate = finalized > 0 ? Math.round((passedCount / finalized) * 100) : null;

  return {
    assessmentsTotal,
    assessmentsPublished,
    attemptsFinalized: finalized,
    needsReviewCount,
    avgPercentage,
    passRate,
  };
}

/* ------------------------------------------------------------------ */
/* Form option helpers                                                  */
/* ------------------------------------------------------------------ */

/** Course options for the assessment form: same tenant, non-archived. */
export async function listCourseOptions(
  ctx: AdminContext
): Promise<{ id: string; titleAr: string; schoolId: string | null }[]> {
  const where: Prisma.CourseWhereInput =
    ctx.role === "SUPER_ADMIN"
      ? { status: { not: "ARCHIVED" } }
      : {
          status: { not: "ARCHIVED" },
          OR: [
            { schoolId: ctx.schoolId },
            { schoolId: null, status: "PUBLISHED" },
          ],
        };
  const rows = await db.course.findMany({
    where,
    select: { id: true, titleAr: true, schoolId: true },
    orderBy: { titleAr: "asc" },
  });
  return rows;
}
/**
 * Phase 9 — impact surveys service: management lifecycle, audience
 * resolution, response workflow and outcome analytics.
 *
 * EVERY path re-validates role + tenant + data invariants server-side:
 * audience ids, content links and statuses are resolved from the
 * database — never trusted from the client. Anonymous surveys persist
 * no respondent identity (respondentId stays null forever) and their
 * aggregates are suppressed below the small-group threshold.
 *
 * Metrics follow one rule: the denominator is ALWAYS stated (eligible
 * resolved audience vs submitted responses), and no baseline/improvement
 * number is ever invented — change analysis runs only when comparable
 * pre/post pairs actually exist.
 */
import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { parseJsonIds } from "@/lib/assignments/access";
import {
  canCreateSurveys,
  canManageFollowUps,
  canViewIndividualResponses,
  canViewSurveyResults,
  canViewSurveySummaries,
  createSurveyGuard,
  surveyScopeError,
  type SurveyActor,
  type SurveyViewer,
} from "@/lib/surveys/access";
import { checkRateLimit } from "@/lib/surveys/rate-limit";
import {
  LIKERT_OPTIONS,
  LIKERT_POINTS,
  MAX_LISTED_TEXT_ANSWERS,
  MIN_ANONYMOUS_AGGREGATE,
  RATING_DEFAULT_MAX,
  RATING_MIN,
  RESPONSES_LIST_LIMIT,
  SUBMIT_RATE_LIMIT,
  SUBMIT_RATE_WINDOW_MS,
  SURVEYS_PAGE_SIZE,
  SURVEY_AUDIENCE_LABELS,
  type SurveyAudienceMode,
  type SurveyQuestionType,
  type SurveyStage,
  type SurveyStatus,
} from "@/config/surveys";
import {
  responsePayloadSchema,
  surveyDefinitionSchema,
  surveyFail,
  validationFail,
  type ResponsePayloadInput,
  type SurveyErrorCode,
  type SurveyResult,
} from "@/lib/validation/surveys";

/* ------------------------------------------------------------------ */
/* Public projections                                                   */
/* ------------------------------------------------------------------ */

export interface SurveyManageRow {
  id: string;
  titleAr: string;
  status: SurveyStatus;
  stage: SurveyStage | null;
  anonymous: boolean;
  audienceMode: SurveyAudienceMode;
  audienceLabel: string;
  ownerName: string;
  isOwn: boolean;
  contentTitle: string | null;
  questionsCount: number;
  submittedCount: number;
  opensAt: Date | null;
  closesAt: Date | null;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface SurveyMetrics {
  totalSurveys: number;
  draftSurveys: number;
  openSurveys: number;
  closedSurveys: number;
  submittedResponses: number;
  /** Mean response rate across surveys with a non-zero audience (percent). */
  averageResponseRatePercent: number | null;
}

export interface SurveyQuestionPublic {
  id: string;
  orderIndex: number;
  textAr: string;
  helpTextAr: string | null;
  type: SurveyQuestionType;
  required: boolean;
  options: string[];
  minScore: number | null;
  maxScore: number | null;
}

export interface MyResponseState {
  id: string;
  status: string;
  submittedAt: Date | null;
  updatedAt: Date;
  answers: {
    questionId: string;
    valueNumber: number | null;
    valueText: string | null;
    selectedOptions: string[];
  }[];
}

export interface TeacherSurveyRow {
  id: string;
  titleAr: string;
  descriptionAr: string | null;
  purposeAr: string | null;
  stage: SurveyStage | null;
  anonymous: boolean;
  isOpenNow: boolean;
  closesAt: Date | null;
  /** Identified surveys only — null for anonymous (by design). */
  myResponseStatus: string | null;
  myResponseSubmittedAt: Date | null;
}

export interface EligibilityCheck {
  eligible: boolean;
  reason: string | null;
}

export interface SurveyTakeData {
  survey: {
    id: string;
    titleAr: string;
    descriptionAr: string | null;
    purposeAr: string | null;
    instructionsAr: string | null;
    anonymous: boolean;
    stage: SurveyStage | null;
    closesAt: Date | null;
    allowMultipleResponses: boolean;
  };
  questions: SurveyQuestionPublic[];
  myResponse: MyResponseState | null;
  alreadySubmitted: boolean;
  /** Anonymous surveys without linking cannot block duplicates — surfaced in UI. */
  duplicateNote: string | null;
}

export interface IndividualResponseRow {
  id: string;
  respondentName: string | null;
  branchName: string | null;
  status: string;
  submittedAt: Date | null;
  updatedAt: Date;
}

export interface QuestionDistribution {
  questionId: string;
  textAr: string;
  type: SurveyQuestionType;
  required: boolean;
  answeredCount: number;
  skippedCount: number;
  /** RATING/LIKERT: value -> count; YES_NO: 1/0 -> count. */
  numericDistribution: { value: number; label: string | null; count: number }[];
  average: number | null;
  /** Choice questions: option text -> count. */
  optionCounts: { option: string; count: number }[];
  /** Free-text answers (privacy-gated). */
  texts: string[] | null;
}

export interface SurveyResults {
  survey: {
    id: string;
    titleAr: string;
    status: SurveyStatus;
    anonymous: boolean;
    stage: SurveyStage | null;
  };
  eligibleCount: number;
  submittedCount: number;
  draftCount: number;
  responseRatePercent: number | null;
  privacySuppressed: boolean;
  distributions: QuestionDistribution[];
  responses: IndividualResponseRow[];
  canSeeIndividualResponses: boolean;
}

export interface StageComparison {
  preSurveyId: string;
  preTitle: string;
  afterSurveyId: string;
  afterTitle: string;
  pairingMode: "IDENTIFIED" | "ANONYMOUS_KEY";
  pairedCount: number;
  privacySuppressed: boolean;
  preAverage: number | null;
  afterAverage: number | null;
  observedDelta: number | null;
  perQuestion: {
    textAr: string;
    preAverage: number | null;
    afterAverage: number | null;
    delta: number | null;
  }[];
  note: string;
}

export type { SurveyErrorCode };

/* ------------------------------------------------------------------ */
/* Internal helpers                                                     */
/* ------------------------------------------------------------------ */

const AUDIENCE_READ_LIMIT = 300;

function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((o): o is string => typeof o === "string") : [];
  } catch {
    return [];
  }
}

function ratingBounds(question: { minScore: number | null; maxScore: number | null }) {
  return {
    min: question.minScore ?? RATING_MIN,
    max: question.maxScore ?? RATING_DEFAULT_MAX,
  };
}

/**
 * Pseudonymous pre/post linking key — never exposed through any payload.
 *
 * Phase 12 honesty note: SURVEY_LINK_PEPPER has a built-in fallback so
 * upgrading never orphans existing response pairings, but production
 * deployments SHOULD set it (see .env.example). A one-time warning is
 * emitted in production when it is missing — changing the pepper AFTER
 * anonymous linked responses exist breaks pre/post pairing, so the
 * fallback is kept for data compatibility, not secrecy.
 */
let pepperWarned = false;
function computeRespondentKey(linkPairCode: string, userId: string): string {
  const pepper = process.env.SURVEY_LINK_PEPPER;
  if (!pepper) {
    if (!pepperWarned && process.env.NODE_ENV === "production") {
      pepperWarned = true;
      console.warn(
        "[surveys] SURVEY_LINK_PEPPER is not set — falling back to the built-in default. Set a long random value in .env (changing it later breaks existing pre/post pairings)."
      );
    }
    return createHash("sha256")
      .update(`${linkPairCode}|${userId}|mq-survey-link-pepper-v1`)
      .digest("hex");
  }
  return createHash("sha256").update(`${linkPairCode}|${userId}|${pepper}`).digest("hex");
}

export interface AudienceSurvey {
  schoolId: string;
  audienceMode: string;
  targetBranchIdsJson: string | null;
  targetTeacherIdsJson: string | null;
  owner: { id: string; role: string } | null;
}

/**
 * Resolves a survey's audience to actual active TEACHER rows of the
 * owning school. Supervisor-owned surveys are intersected with the
 * supervisor's persisted coverage (assigned teachers + branch grants) —
 * the audience can never exceed the author's real scope.
 *
 * Phase 10: exported for reuse by the report center so response-rate
 * denominators keep ONE source of truth.
 */
export async function resolveAudienceTeachers(survey: AudienceSurvey) {
  const baseWhere: Prisma.UserWhereInput = {
    schoolId: survey.schoolId,
    role: "TEACHER",
    isActive: true,
  };
  if (survey.audienceMode === "BRANCHES") {
    const branchIds = parseJsonIds(survey.targetBranchIdsJson);
    baseWhere.branchId = { in: branchIds };
  } else if (survey.audienceMode === "TEACHERS") {
    baseWhere.id = { in: parseJsonIds(survey.targetTeacherIdsJson) };
  }

  const teachers = await db.user.findMany({
    where: baseWhere,
    select: { id: true, name: true, branchId: true },
    orderBy: { name: "asc" },
    take: AUDIENCE_READ_LIMIT,
  });

  if (!survey.owner || survey.owner.role !== "EDUCATIONAL_SUPERVISOR") {
    return teachers;
  }

  const [assigned, branchGrants] = await Promise.all([
    db.teacherSupervisorAssignment.findMany({
      where: { supervisorId: survey.owner.id },
      select: { teacherId: true },
    }),
    db.supervisorAssignment.findMany({
      where: { supervisorId: survey.owner.id, schoolId: survey.schoolId },
      select: { branchId: true },
    }),
  ]);
  const assignedIds = new Set(assigned.map((row) => row.teacherId));
  const branchIds = new Set(branchGrants.map((row) => row.branchId));
  return teachers.filter(
    (teacher) => assignedIds.has(teacher.id) || (teacher.branchId !== null && branchIds.has(teacher.branchId))
  );
}

/**
 * Single-teacher eligibility against a resolved survey — used by the
 * response workflow. Returns a machine-checkable reason for denials.
 */
export async function checkTeacherEligibility(
  survey: AudienceSurvey & { id: string },
  teacher: { id: string; role: string; schoolId: string | null; branchId: string | null; isActive: boolean }
): Promise<EligibilityCheck> {
  if (teacher.role !== "TEACHER") {
    return { eligible: false, reason: "الاستبيانات متاحة للمعلمين فقط" };
  }
  if (!teacher.isActive) {
    return { eligible: false, reason: "الحساب غير مفعّل" };
  }
  if (teacher.schoolId !== survey.schoolId) {
    return { eligible: false, reason: "الاستبيان خارج نطاق مدرستك" };
  }

  const matchesAudience =
    survey.audienceMode === "ALL_TEACHERS" ||
    (survey.audienceMode === "BRANCHES" &&
      teacher.branchId !== null &&
      parseJsonIds(survey.targetBranchIdsJson).includes(teacher.branchId)) ||
    (survey.audienceMode === "TEACHERS" &&
      parseJsonIds(survey.targetTeacherIdsJson).includes(teacher.id));
  if (!matchesAudience) {
    return { eligible: false, reason: "لم يتم استهدافك في هذا الاستبيان" };
  }

  if (survey.owner && survey.owner.role === "EDUCATIONAL_SUPERVISOR") {
    const [assigned, branchGrant] = await Promise.all([
      db.teacherSupervisorAssignment.findFirst({
        where: { supervisorId: survey.owner.id, teacherId: teacher.id },
        select: { id: true },
      }),
      teacher.branchId
        ? db.supervisorAssignment.findFirst({
            where: { supervisorId: survey.owner.id, schoolId: survey.schoolId, branchId: teacher.branchId },
            select: { id: true },
          })
        : null,
    ]);
    if (!assigned && !branchGrant) {
      return { eligible: false, reason: "الاستبيان خارج نطاق إشراف مؤلفه" };
    }
  }

  return { eligible: true, reason: null };
}

function isWithinResponseWindow(
  survey: { status: string; opensAt: Date | null; closesAt: Date | null },
  now = new Date()
): boolean {
  if (survey.status !== "PUBLISHED") return false;
  if (survey.opensAt && now < survey.opensAt) return false;
  if (survey.closesAt && now > survey.closesAt) return false;
  return true;
}

export function isSurveyOpen(
  survey: { status: string; opensAt: Date | null; closesAt: Date | null },
  now = new Date()
): boolean {
  return isWithinResponseWindow(survey, now);
}

/** Normalizes a raw answer list against the survey's question set. */
function normalizeAnswers(
  rawAnswers: ResponsePayloadInput["answers"],
  questions: {
    id: string;
    type: string;
    required: boolean;
    optionsJson: string | null;
    minScore: number | null;
    maxScore: number | null;
  }[]
): { ok: true; answers: PersistableAnswer[] } | { ok: false; message: string; code: SurveyErrorCode } {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const seen = new Set<string>();
  const persistable: PersistableAnswer[] = [];

  for (const answer of rawAnswers) {
    const question = byId.get(answer.questionId);
    if (!question) {
      return { ok: false, message: "إجابة تشير إلى سؤال غير موجود في هذا الاستبيان", code: "ANSWER_INVALID" };
    }
    if (seen.has(question.id)) {
      return { ok: false, message: "إجابة مكررة لنفس السؤال", code: "ANSWER_INVALID" };
    }
    seen.add(question.id);

    const hasText = answer.valueText !== null && answer.valueText !== undefined && answer.valueText.trim() !== "";
    const hasNumber = answer.valueNumber !== null && answer.valueNumber !== undefined;
    const hasOptions = answer.selectedOptions.length > 0;

    switch (question.type) {
      case "SHORT_TEXT":
      case "LONG_TEXT": {
        if (hasNumber || hasOptions) {
          return { ok: false, message: "نوع الإجابة لا يطابق نوع السؤال", code: "ANSWER_INVALID" };
        }
        if (hasText) persistable.push({ questionId: question.id, valueText: answer.valueText!.trim() });
        break;
      }
      case "RATING": {
        if (hasText || hasOptions) {
          return { ok: false, message: "نوع الإجابة لا يطابق نوع السؤال", code: "ANSWER_INVALID" };
        }
        if (hasNumber) {
          const { min, max } = ratingBounds(question);
          const value = answer.valueNumber!;
          if (value < min || value > max) {
            return {
              ok: false,
              message: `قيمة التقييم يجب أن تكون بين ${min} و ${max}`,
              code: "ANSWER_INVALID",
            };
          }
          persistable.push({ questionId: question.id, valueNumber: value });
        }
        break;
      }
      case "LIKERT": {
        if (hasText || hasOptions) {
          return { ok: false, message: "نوع الإجابة لا يطابق نوع السؤال", code: "ANSWER_INVALID" };
        }
        if (hasNumber) {
          const value = answer.valueNumber!;
          if (value < 1 || value > LIKERT_POINTS) {
            return { ok: false, message: "قيمة ليكرت يجب أن تكون بين 1 و 5", code: "ANSWER_INVALID" };
          }
          persistable.push({ questionId: question.id, valueNumber: value });
        }
        break;
      }
      case "YES_NO": {
        if (hasText || hasOptions) {
          return { ok: false, message: "نوع الإجابة لا يطابق نوع السؤال", code: "ANSWER_INVALID" };
        }
        if (hasNumber) {
          const value = answer.valueNumber!;
          if (value !== 0 && value !== 1) {
            return { ok: false, message: "إجابة نعم/لا يجب أن تكون 0 أو 1", code: "ANSWER_INVALID" };
          }
          persistable.push({ questionId: question.id, valueNumber: value });
        }
        break;
      }
      case "SINGLE_CHOICE":
      case "MULTI_CHOICE": {
        if (hasText || hasNumber) {
          return { ok: false, message: "نوع الإجابة لا يطابق نوع السؤال", code: "ANSWER_INVALID" };
        }
        if (hasOptions) {
          const allowed = parseOptions(question.optionsJson);
          const selected = answer.selectedOptions;
          const unique = new Set(selected);
          if (unique.size !== selected.length) {
            return { ok: false, message: "خيارات مكررة في نفس السؤال", code: "ANSWER_INVALID" };
          }
          for (const option of selected) {
            if (!allowed.includes(option)) {
              return { ok: false, message: "خيار غير مسموح في هذا السؤال", code: "ANSWER_INVALID" };
            }
          }
          if (question.type === "SINGLE_CHOICE" && selected.length > 1) {
            return { ok: false, message: "هذا السؤال يقبل خيارًا واحدًا فقط", code: "ANSWER_INVALID" };
          }
          persistable.push({ questionId: question.id, selectedOptions: selected });
        }
        break;
      }
      default:
        return { ok: false, message: "نوع سؤال غير مدعوم", code: "ANSWER_INVALID" };
    }
  }
  return { ok: true, answers: persistable };
}

interface PersistableAnswer {
  questionId: string;
  valueNumber?: number;
  valueText?: string;
  selectedOptions?: string[];
}

/** Required-question completeness check (submission only, not drafts). */
function checkRequiredAnswers(
  questions: { id: string; type: string; required: boolean; textAr: string }[],
  answers: PersistableAnswer[]
): { ok: true } | { ok: false; message: string; code: SurveyErrorCode } {
  const answered = new Set(answers.map((answer) => answer.questionId));
  for (const question of questions) {
    if (question.required && !answered.has(question.id)) {
      return {
        ok: false,
        message: `السؤال المطلوب لم يُجب عليه: ${question.textAr}`,
        code: "REQUIRED_MISSING",
      };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Content-link validation (surveys + follow-ups share this rule)       */
/* ------------------------------------------------------------------ */

export interface ContentLinksInput {
  programId: string | null;
  courseId: string | null;
  lessonId: string | null;
  assignmentId: string | null;
  certificateId: string | null;
}

/**
 * Validates optional content links against the tenant: school-owned rows
 * must belong to the survey's school; platform-wide content (null-school
 * programs/courses) is allowed; archived content is rejected. Linked
 * lessons resolve their course through the section.
 */
export async function validateContentLinks(
  schoolId: string,
  links: ContentLinksInput
): Promise<SurveyResult<null>> {
  if (links.programId) {
    const program = await db.trainingProgram.findUnique({
      where: { id: links.programId },
      select: { schoolId: true, status: true },
    });
    if (!program || (program.schoolId !== null && program.schoolId !== schoolId)) {
      return surveyFail("البرنامج التدريبي المحدد غير موجود في نطاق مدرستك", "RELATION_ERROR");
    }
    if (program.status === "ARCHIVED") {
      return surveyFail("لا يمكن الربط مع برنامج مؤرشف", "RELATION_ERROR");
    }
  }
  if (links.courseId) {
    const course = await db.course.findUnique({
      where: { id: links.courseId },
      select: { schoolId: true, status: true },
    });
    if (!course || (course.schoolId !== null && course.schoolId !== schoolId)) {
      return surveyFail("الدورة التدريبية المحددة غير موجودة في نطاق مدرستك", "RELATION_ERROR");
    }
    if (course.status === "ARCHIVED") {
      return surveyFail("لا يمكن الربط مع دورة مؤرشفة", "RELATION_ERROR");
    }
  }
  if (links.lessonId) {
    const lesson = await db.courseLesson.findUnique({
      where: { id: links.lessonId },
      select: { section: { select: { course: { select: { schoolId: true, status: true } } } } },
    });
    if (!lesson) {
      return surveyFail("الدرس المحدد غير موجود", "RELATION_ERROR");
    }
    if (lesson.section.course.schoolId !== schoolId) {
      return surveyFail("الدرس المحدد يتبع مدرسة أخرى", "RELATION_ERROR");
    }
    if (lesson.section.course.status === "ARCHIVED") {
      return surveyFail("لا يمكن الربط مع درس في دورة مؤرشفة", "RELATION_ERROR");
    }
  }
  if (links.assignmentId) {
    const assignment = await db.assignment.findUnique({
      where: { id: links.assignmentId },
      select: { schoolId: true, status: true },
    });
    if (!assignment || assignment.schoolId !== schoolId) {
      return surveyFail("الواجب المحدد غير موجود في نطاق مدرستك", "RELATION_ERROR");
    }
    if (assignment.status === "ARCHIVED") {
      return surveyFail("لا يمكن الربط مع واجب مؤرشف", "RELATION_ERROR");
    }
  }
  if (links.certificateId) {
    const certificate = await db.certificate.findUnique({
      where: { id: links.certificateId },
      select: { schoolId: true },
    });
    if (!certificate || certificate.schoolId !== schoolId) {
      return surveyFail("الشهادة المحددة غير موجودة في نطاق مدرستك", "RELATION_ERROR");
    }
  }
  return { ok: true, data: null };
}

/* ------------------------------------------------------------------ */
/* Management: list / read / create / update                            */
/* ------------------------------------------------------------------ */

export interface SurveyListFilters {
  q?: string;
  status?: string;
  page?: number;
}

export async function listSurveysForManage(
  ctx: SurveyActor,
  filters: SurveyListFilters = {}
): Promise<SurveyResult<{ rows: SurveyManageRow[]; total: number; pageCount: number; page: number }>> {
  if (!canViewSurveySummaries(ctx.role)) {
    return surveyFail("قائمة الاستبيانات متاحة للأدوار الإدارية المدرسية فقط", "FORBIDDEN");
  }
  // Operational roles are school-scoped; deputies read their granted school.
  let schoolId = ctx.schoolId;
  if (ctx.role === "EDUCATIONAL_DEPUTY") {
    const grant = await db.deputyGrant.findFirst({ where: { userId: ctx.id }, select: { schoolId: true } });
    schoolId = grant?.schoolId ?? null;
  }
  if (!schoolId) {
    return surveyFail("النطاق المدرسي غير محدد", "FORBIDDEN");
  }
  const scopeError = surveyScopeError(ctx, schoolId);
  if (scopeError) return scopeError;

  const where: Record<string, unknown> = { schoolId };
  // Supervisors manage/see only their OWN surveys.
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") where.ownerUserId = ctx.id;
  if (filters.status && ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"].includes(filters.status)) {
    where.status = filters.status;
  }
  if (filters.q && filters.q.trim() !== "") {
    where.titleAr = { contains: filters.q.trim() };
  }

  const total = await db.survey.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / SURVEYS_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  const surveys = await db.survey.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * SURVEYS_PAGE_SIZE,
    take: SURVEYS_PAGE_SIZE,
    select: {
      id: true,
      titleAr: true,
      status: true,
      stage: true,
      anonymous: true,
      audienceMode: true,
      opensAt: true,
      closesAt: true,
      createdAt: true,
      publishedAt: true,
      ownerUserId: true,
      owner: { select: { name: true } },
      program: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
      lesson: { select: { titleAr: true } },
      assignment: { select: { titleAr: true } },
      certificate: { select: { titleAr: true } },
      _count: { select: { questions: true, responses: { where: { status: "SUBMITTED" } } } },
    },
  });

  const rows: SurveyManageRow[] = surveys.map((survey) => {
    const contentTitle =
      survey.program?.nameAr ??
      survey.course?.titleAr ??
      survey.lesson?.titleAr ??
      survey.assignment?.titleAr ??
      survey.certificate?.titleAr ??
      null;
    return {
      id: survey.id,
      titleAr: survey.titleAr,
      status: survey.status as SurveyStatus,
      stage: (survey.stage as SurveyStage | null) ?? null,
      anonymous: survey.anonymous,
      audienceMode: survey.audienceMode as SurveyAudienceMode,
      audienceLabel: SURVEY_AUDIENCE_LABELS[survey.audienceMode as SurveyAudienceMode] ?? survey.audienceMode,
      ownerName: survey.owner.name,
      isOwn: survey.ownerUserId === ctx.id,
      contentTitle,
      questionsCount: survey._count.questions,
      submittedCount: survey._count.responses,
      opensAt: survey.opensAt,
      closesAt: survey.closesAt,
      createdAt: survey.createdAt,
      publishedAt: survey.publishedAt,
    };
  });

  return { ok: true, data: { rows, total, pageCount, page } };
}

export interface SurveyManageView {
  survey: SurveyManageRow & {
    titleEn: string | null;
    descriptionAr: string | null;
    purposeAr: string | null;
    instructionsAr: string | null;
    audienceModeRaw: SurveyAudienceMode;
    targetBranchIds: string[];
    targetTeacherIds: string[];
    targetTeacherNames: string[];
    allowMultipleResponses: boolean;
    linkResponsesEnabled: boolean;
    linkPairCode: string | null;
    ownerUserId: string;
    programId: string | null;
    courseId: string | null;
    lessonId: string | null;
    assignmentId: string | null;
    certificateId: string | null;
    opensAtISO: string | null;
    closesAtISO: string | null;
  };
  questions: SurveyQuestionPublic[];
  events: { id: string; type: string; actorName: string | null; actorRole: string | null; createdAt: Date; note: string | null }[];
  eligibleCount: number;
  permissions: {
    canEdit: boolean;
    canPublish: boolean;
    canClose: boolean;
    canArchive: boolean;
    canSeeResults: boolean;
    canSeeIndividualResponses: boolean;
  };
}

export async function getSurveyManageView(
  ctx: SurveyActor,
  surveyId: string
): Promise<SurveyResult<SurveyManageView>> {
  if (!canViewSurveySummaries(ctx.role)) {
    return surveyFail("عرض الاستبيان متاح للأدوار الإدارية المدرسية فقط", "FORBIDDEN");
  }
  const survey = await db.survey.findUnique({
    where: { id: surveyId },
    include: {
      owner: { select: { id: true, name: true, role: true } },
      program: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
      lesson: { select: { titleAr: true } },
      assignment: { select: { titleAr: true } },
      certificate: { select: { titleAr: true } },
    },
  });
  if (!survey) return surveyFail("الاستبيان غير موجود", "NOT_FOUND");

  let effectiveSchoolId = ctx.schoolId;
  if (ctx.role === "EDUCATIONAL_DEPUTY") {
    const grant = await db.deputyGrant.findFirst({ where: { userId: ctx.id }, select: { schoolId: true } });
    effectiveSchoolId = grant?.schoolId ?? null;
  }
  if (!effectiveSchoolId || survey.schoolId !== effectiveSchoolId) {
    return surveyFail("لا تملك صلاحية الوصول إلى هذا الاستبيان — النطاق المدرسي مختلف", "FORBIDDEN");
  }
  if (ctx.role === "EDUCATIONAL_SUPERVISOR" && survey.ownerUserId !== ctx.id) {
    return surveyFail("المشرف التربوي يدير استبياناته الخاصة فقط", "FORBIDDEN");
  }

  const [questions, events, audienceTeachers] = await Promise.all([
    db.surveyQuestion.findMany({
      where: { surveyId },
      orderBy: { orderIndex: "asc" },
    }),
    db.surveyEvent.findMany({
      where: { surveyId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { actor: { select: { name: true } } },
    }),
    resolveAudienceTeachers({
      schoolId: survey.schoolId,
      audienceMode: survey.audienceMode,
      targetBranchIdsJson: survey.targetBranchIdsJson,
      targetTeacherIdsJson: survey.targetTeacherIdsJson,
      owner: { id: survey.owner.id, role: survey.owner.role },
    }),
  ]);

  // Teacher-mode audiences resolve to named rows for display.
  let targetTeacherNames: string[] = [];
  if (survey.audienceMode === "TEACHERS") {
    const ids = parseJsonIds(survey.targetTeacherIdsJson);
    if (ids.length > 0) {
      const teachers = await db.user.findMany({
        where: { id: { in: ids } },
        select: { name: true },
      });
      targetTeacherNames = teachers.map((teacher) => teacher.name);
    }
  }

  const row: SurveyManageView["survey"] = {
    id: survey.id,
    titleAr: survey.titleAr,
    titleEn: survey.titleEn,
    status: survey.status as SurveyStatus,
    stage: (survey.stage as SurveyStage | null) ?? null,
    anonymous: survey.anonymous,
    audienceMode: survey.audienceMode as SurveyAudienceMode,
    audienceModeRaw: survey.audienceMode as SurveyAudienceMode,
    audienceLabel: SURVEY_AUDIENCE_LABELS[survey.audienceMode as SurveyAudienceMode] ?? survey.audienceMode,
    ownerName: survey.owner.name,
    isOwn: survey.ownerUserId === ctx.id,
    contentTitle:
      survey.program?.nameAr ??
      survey.course?.titleAr ??
      survey.lesson?.titleAr ??
      survey.assignment?.titleAr ??
      survey.certificate?.titleAr ??
      null,
    questionsCount: questions.length,
    submittedCount: await db.surveyResponse.count({
      where: { surveyId, status: "SUBMITTED" },
    }),
    opensAt: survey.opensAt,
    closesAt: survey.closesAt,
    createdAt: survey.createdAt,
    publishedAt: survey.publishedAt,
    descriptionAr: survey.descriptionAr,
    purposeAr: survey.purposeAr,
    instructionsAr: survey.instructionsAr,
    targetBranchIds: parseJsonIds(survey.targetBranchIdsJson),
    targetTeacherIds: parseJsonIds(survey.targetTeacherIdsJson),
    targetTeacherNames,
    allowMultipleResponses: survey.allowMultipleResponses,
    linkResponsesEnabled: survey.linkResponsesEnabled,
    linkPairCode: survey.linkPairCode,
    ownerUserId: survey.ownerUserId,
    programId: survey.programId,
    courseId: survey.courseId,
    lessonId: survey.lessonId,
    assignmentId: survey.assignmentId,
    certificateId: survey.certificateId,
    opensAtISO: survey.opensAt ? survey.opensAt.toISOString() : null,
    closesAtISO: survey.closesAt ? survey.closesAt.toISOString() : null,
  };

  const isManager = ctx.role === "DEVELOPMENT_OFFICE_MANAGER";
  const isOwner = survey.ownerUserId === ctx.id;
  const canEdit = (isManager || (ctx.role === "EDUCATIONAL_SUPERVISOR" && isOwner)) && survey.status === "DRAFT";

  return {
    ok: true,
    data: {
      survey: row,
      questions: questions.map((question) => ({
        id: question.id,
        orderIndex: question.orderIndex,
        textAr: question.textAr,
        helpTextAr: question.helpTextAr,
        type: question.type as SurveyQuestionType,
        required: question.required,
        options: parseOptions(question.optionsJson),
        minScore: question.minScore,
        maxScore: question.maxScore,
      })),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        actorName: event.actor?.name ?? null,
        actorRole: event.actorRole,
        createdAt: event.createdAt,
        note: event.note,
      })),
      eligibleCount: audienceTeachers.length,
      permissions: {
        canEdit,
        canPublish: (isManager || (ctx.role === "EDUCATIONAL_SUPERVISOR" && isOwner)) && survey.status === "DRAFT",
        canClose: (isManager || (ctx.role === "EDUCATIONAL_SUPERVISOR" && isOwner)) && survey.status === "PUBLISHED",
        canArchive:
          (isManager || (ctx.role === "EDUCATIONAL_SUPERVISOR" && isOwner)) &&
          (survey.status === "CLOSED" || survey.status === "DRAFT"),
        canSeeResults: canViewSurveyResults(ctx.role),
        canSeeIndividualResponses:
          canViewIndividualResponses(ctx.role) && !survey.anonymous && (isManager || isOwner),
      },
    },
  };
}

export interface CreateSurveyInput {
  definition: unknown;
}

export async function createSurvey(
  ctx: SurveyActor,
  rawDefinition: unknown
): Promise<SurveyResult<{ id: string }>> {
  const guardError = createSurveyGuard(ctx);
  if (guardError) return guardError;
  const schoolId = ctx.schoolId as string;

  const parsed = surveyDefinitionSchema.safeParse(rawDefinition);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const linksResult = await validateContentLinks(schoolId, input);
  if (!linksResult.ok) return linksResult;

  // Audience targets must be real in-school rows.
  if (input.audienceMode === "BRANCHES") {
    const count = await db.branch.count({
      where: { id: { in: input.targetBranchIds }, schoolId },
    });
    if (count !== input.targetBranchIds.length) {
      return surveyFail("أحد الفروع المحددة غير موجود في نطاق مدرستك", "AUDIENCE_INVALID");
    }
  }
  if (input.audienceMode === "TEACHERS") {
    const count = await db.user.count({
      where: {
        id: { in: input.targetTeacherIds },
        schoolId,
        role: "TEACHER",
        isActive: true,
      },
    });
    if (count !== input.targetTeacherIds.length) {
      return surveyFail("أحد المعلمين المحددين غير موجود في نطاق مدرستك", "AUDIENCE_INVALID");
    }
  }

  // A supervisor's survey is automatically bounded by their real scope
  // at eligibility time (resolveAudienceTeachers) — creation here only
  // records the author.

  const survey = await db.$transaction(async (tx) => {
    const created = await tx.survey.create({
      data: {
        schoolId,
        ownerUserId: ctx.id,
        titleAr: input.titleAr,
        titleEn: input.titleEn,
        descriptionAr: input.descriptionAr,
        descriptionEn: input.descriptionEn,
        purposeAr: input.purposeAr,
        instructionsAr: input.instructionsAr,
        stage: input.stage,
        linkPairCode: input.linkPairCode,
        programId: input.programId,
        courseId: input.courseId,
        lessonId: input.lessonId,
        assignmentId: input.assignmentId,
        certificateId: input.certificateId,
        audienceMode: input.audienceMode,
        targetBranchIdsJson: input.targetBranchIds.length > 0 ? JSON.stringify(input.targetBranchIds) : null,
        targetTeacherIdsJson: input.targetTeacherIds.length > 0 ? JSON.stringify(input.targetTeacherIds) : null,
        anonymous: input.anonymous,
        allowMultipleResponses: input.allowMultipleResponses,
        linkResponsesEnabled: input.linkResponsesEnabled,
        status: "DRAFT",
        opensAt: input.opensAt ?? null,
        closesAt: input.closesAt ?? null,
      },
    });
    await tx.surveyQuestion.createMany({
      data: input.questions.map((question, index) => ({
        surveyId: created.id,
        orderIndex: index + 1,
        textAr: question.textAr,
        helpTextAr: question.helpTextAr,
        type: question.type,
        required: question.required,
        optionsJson:
          question.type === "SINGLE_CHOICE" || question.type === "MULTI_CHOICE"
            ? JSON.stringify(question.options.filter((option) => option.length > 0))
            : null,
        minScore: question.type === "RATING" ? (question.minScore ?? RATING_MIN) : null,
        maxScore: question.type === "RATING" ? (question.maxScore ?? RATING_DEFAULT_MAX) : null,
      })),
    });
    await tx.surveyEvent.create({
      data: {
        surveyId: created.id,
        type: "CREATED",
        actorId: ctx.id,
        actorRole: ctx.role,
      },
    });
    return created;
  });

  return { ok: true, data: { id: survey.id } };
}

export async function updateSurvey(
  ctx: SurveyActor,
  surveyId: string,
  rawDefinition: unknown
): Promise<SurveyResult<{ id: string }>> {
  if (!canCreateSurveys(ctx.role) || !ctx.schoolId) {
    return surveyFail("تعديل الاستبيانات متاح لمديري المكاتب والمشرفين فقط", "FORBIDDEN");
  }
  const survey = await db.survey.findUnique({ where: { id: surveyId }, select: { schoolId: true, ownerUserId: true, status: true } });
  if (!survey) return surveyFail("الاستبيان غير موجود", "NOT_FOUND");
  const scopeError = surveyScopeError(ctx, survey.schoolId);
  if (scopeError) return scopeError;
  if (ctx.role === "EDUCATIONAL_SUPERVISOR" && survey.ownerUserId !== ctx.id) {
    return surveyFail("المشرف التربوي يعدّل استبياناته الخاصة فقط", "FORBIDDEN");
  }
  if (survey.status !== "DRAFT") {
    return surveyFail(
      "لا يمكن تعديل الاستبيان بعد النشر — أغلق الاستبيان أو أنشئ نسخة جديدة لحماية سلامة الردود",
      "NOT_PUBLISHED"
    );
  }

  const parsed = surveyDefinitionSchema.safeParse(rawDefinition);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  const linksResult = await validateContentLinks(ctx.schoolId, input);
  if (!linksResult.ok) return linksResult;

  if (input.audienceMode === "BRANCHES") {
    const count = await db.branch.count({
      where: { id: { in: input.targetBranchIds }, schoolId: ctx.schoolId },
    });
    if (count !== input.targetBranchIds.length) {
      return surveyFail("أحد الفروع المحددة غير موجود في نطاق مدرستك", "AUDIENCE_INVALID");
    }
  }
  if (input.audienceMode === "TEACHERS") {
    const count = await db.user.count({
      where: {
        id: { in: input.targetTeacherIds },
        schoolId: ctx.schoolId,
        role: "TEACHER",
        isActive: true,
      },
    });
    if (count !== input.targetTeacherIds.length) {
      return surveyFail("أحد المعلمين المحددين غير موجود في نطاق مدرستك", "AUDIENCE_INVALID");
    }
  }

  await db.$transaction(async (tx) => {
    await tx.survey.update({
      where: { id: surveyId },
      data: {
        titleAr: input.titleAr,
        titleEn: input.titleEn,
        descriptionAr: input.descriptionAr,
        descriptionEn: input.descriptionEn,
        purposeAr: input.purposeAr,
        instructionsAr: input.instructionsAr,
        stage: input.stage,
        linkPairCode: input.linkPairCode,
        programId: input.programId,
        courseId: input.courseId,
        lessonId: input.lessonId,
        assignmentId: input.assignmentId,
        certificateId: input.certificateId,
        audienceMode: input.audienceMode,
        targetBranchIdsJson: input.targetBranchIds.length > 0 ? JSON.stringify(input.targetBranchIds) : null,
        targetTeacherIdsJson: input.targetTeacherIds.length > 0 ? JSON.stringify(input.targetTeacherIds) : null,
        anonymous: input.anonymous,
        allowMultipleResponses: input.allowMultipleResponses,
        linkResponsesEnabled: input.linkResponsesEnabled,
        opensAt: input.opensAt ?? null,
        closesAt: input.closesAt ?? null,
      },
    });
    // Questions are rebuilt wholesale — drafts have no responses yet.
    await tx.surveyQuestion.deleteMany({ where: { surveyId } });
    await tx.surveyQuestion.createMany({
      data: input.questions.map((question, index) => ({
        surveyId,
        orderIndex: index + 1,
        textAr: question.textAr,
        helpTextAr: question.helpTextAr,
        type: question.type,
        required: question.required,
        optionsJson:
          question.type === "SINGLE_CHOICE" || question.type === "MULTI_CHOICE"
            ? JSON.stringify(question.options.filter((option) => option.length > 0))
            : null,
        minScore: question.type === "RATING" ? (question.minScore ?? RATING_MIN) : null,
        maxScore: question.type === "RATING" ? (question.maxScore ?? RATING_DEFAULT_MAX) : null,
      })),
    });
    await tx.surveyEvent.create({
      data: { surveyId, type: "UPDATED", actorId: ctx.id, actorRole: ctx.role },
    });
  });

  return { ok: true, data: { id: surveyId } };
}

/* ------------------------------------------------------------------ */
/* Lifecycle transitions (publish / close / archive)                    */
/* ------------------------------------------------------------------ */

export type SurveyTransitionAction = "PUBLISH" | "CLOSE" | "ARCHIVE";

const TRANSITIONS: Record<SurveyTransitionAction, { from: string[]; to: SurveyStatus; event: string }> = {
  PUBLISH: { from: ["DRAFT"], to: "PUBLISHED", event: "PUBLISHED" },
  CLOSE: { from: ["PUBLISHED"], to: "CLOSED", event: "CLOSED" },
  ARCHIVE: { from: ["DRAFT", "CLOSED"], to: "ARCHIVED", event: "ARCHIVED" },
};

export async function transitionSurvey(
  ctx: SurveyActor,
  surveyId: string,
  action: SurveyTransitionAction
): Promise<SurveyResult<{ id: string; status: SurveyStatus }>> {
  if (!canCreateSurveys(ctx.role) || !ctx.schoolId) {
    return surveyFail("إدارة دورة حياة الاستبيان متاحة لمديري المكاتب والمشرفين فقط", "FORBIDDEN");
  }
  const survey = await db.survey.findUnique({
    where: { id: surveyId },
    select: { schoolId: true, ownerUserId: true, status: true },
  });
  if (!survey) return surveyFail("الاستبيان غير موجود", "NOT_FOUND");
  const scopeError = surveyScopeError(ctx, survey.schoolId);
  if (scopeError) return scopeError;
  if (ctx.role === "EDUCATIONAL_SUPERVISOR" && survey.ownerUserId !== ctx.id) {
    return surveyFail("المشرف التربوي يدير استبياناته الخاصة فقط", "FORBIDDEN");
  }

  const transition = TRANSITIONS[action];
  if (!transition.from.includes(survey.status)) {
    return surveyFail("لا يمكن تنفيذ هذا الإجراء من الحالة الحالية للاستبيان", "VALIDATION_ERROR");
  }

  if (action === "PUBLISH") {
    const questionsCount = await db.surveyQuestion.count({ where: { surveyId } });
    if (questionsCount === 0) {
      return surveyFail("لا يمكن نشر استبيان بدون أسئلة — أضف سؤالًا واحدًا على الأقل", "VALIDATION_ERROR");
    }
  }

  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.survey.updateMany({
      where: { id: surveyId, schoolId: ctx.schoolId!, status: { in: transition.from } },
      data: {
        status: transition.to,
        ...(action === "PUBLISH" ? { publishedAt: now } : {}),
        ...(action === "CLOSE" ? { closedAt: now } : {}),
        ...(action === "ARCHIVE" ? { archivedAt: now } : {}),
      },
    });
    if (result.count === 0) {
      return null;
    }
    await tx.surveyEvent.create({
      data: { surveyId, type: transition.event, actorId: ctx.id, actorRole: ctx.role },
    });
    return { id: surveyId, status: transition.to };
  });

  if (!updated) {
    return surveyFail("تغيّرت حالة الاستبيان — أعد تحميل الصفحة وحاول مجددًا", "VALIDATION_ERROR");
  }
  return { ok: true, data: updated };
}

/* ------------------------------------------------------------------ */
/* Teacher-facing: list / open / draft / submit                         */
/* ------------------------------------------------------------------ */

export async function listSurveysForTeacher(
  viewer: SurveyViewer
): Promise<SurveyResult<TeacherSurveyRow[]>> {
  if (viewer.role !== "TEACHER" || !viewer.schoolId) {
    return surveyFail("قائمة الاستبيانات متاحة للمعلمين فقط", "FORBIDDEN");
  }

  const surveys = await db.survey.findMany({
    where: { schoolId: viewer.schoolId, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: AUDIENCE_READ_LIMIT,
    select: {
      id: true,
      schoolId: true,
      status: true,
      titleAr: true,
      descriptionAr: true,
      purposeAr: true,
      stage: true,
      anonymous: true,
      opensAt: true,
      closesAt: true,
      audienceMode: true,
      targetBranchIdsJson: true,
      targetTeacherIdsJson: true,
      ownerUserId: true,
      owner: { select: { id: true, role: true } },
    },
  });

  const rows: TeacherSurveyRow[] = [];
  const teacher = await db.user.findUnique({
    where: { id: viewer.id },
    select: { id: true, role: true, schoolId: true, branchId: true, isActive: true },
  });
  if (!teacher || !teacher.isActive) {
    return { ok: true, data: [] };
  }
  for (const survey of surveys) {
    const eligibility = await checkTeacherEligibility(
      {
        id: survey.id,
        schoolId: survey.schoolId,
        audienceMode: survey.audienceMode,
        targetBranchIdsJson: survey.targetBranchIdsJson,
        targetTeacherIdsJson: survey.targetTeacherIdsJson,
        owner: { id: survey.owner.id, role: survey.owner.role },
      },
      teacher
    );
    if (!eligibility.eligible) continue;

    const myResponse = survey.anonymous
      ? null
      : await db.surveyResponse.findFirst({
          where: { surveyId: survey.id, respondentId: viewer.id, status: "SUBMITTED" },
          select: { id: true, status: true, submittedAt: true },
        });

    rows.push({
      id: survey.id,
      titleAr: survey.titleAr,
      descriptionAr: survey.descriptionAr,
      purposeAr: survey.purposeAr,
      stage: (survey.stage as SurveyStage | null) ?? null,
      anonymous: survey.anonymous,
      isOpenNow: isWithinResponseWindow(survey),
      closesAt: survey.closesAt,
      myResponseStatus: myResponse?.status ?? null,
      myResponseSubmittedAt: myResponse?.submittedAt ?? null,
    });
  }
  return { ok: true, data: rows };
}

export async function getSurveyForTaking(
  viewer: SurveyViewer,
  surveyId: string
): Promise<SurveyResult<SurveyTakeData>> {
  if (viewer.role !== "TEACHER" || !viewer.schoolId) {
    return surveyFail("الاستجابة للاستبيانات متاحة للمعلمين فقط", "FORBIDDEN");
  }
  const survey = await db.survey.findUnique({
    where: { id: surveyId },
    select: {
      id: true,
      schoolId: true,
      titleAr: true,
      descriptionAr: true,
      purposeAr: true,
      instructionsAr: true,
      anonymous: true,
      stage: true,
      status: true,
      opensAt: true,
      closesAt: true,
      allowMultipleResponses: true,
      linkResponsesEnabled: true,
      linkPairCode: true,
      audienceMode: true,
      targetBranchIdsJson: true,
      targetTeacherIdsJson: true,
      ownerUserId: true,
      owner: { select: { id: true, role: true } },
    },
  });
  if (!survey) return surveyFail("الاستبيان غير موجود", "NOT_FOUND");
  if (survey.schoolId !== viewer.schoolId) {
    return surveyFail("الاستبيان خارج نطاق مدرستك", "FORBIDDEN");
  }
  if (survey.status === "ARCHIVED" || survey.status === "CLOSED") {
    return surveyFail("هذا الاستبيان مغلق حاليًا", "CLOSED");
  }
  if (!isWithinResponseWindow(survey)) {
    return surveyFail("الاستبيان غير مفتوح للاستجابة حاليًا", "NOT_OPEN");
  }

  const teacher = await db.user.findUnique({
    where: { id: viewer.id },
    select: { id: true, role: true, schoolId: true, branchId: true, isActive: true },
  });
  if (!teacher) return surveyFail("الحساب غير موجود", "FORBIDDEN");
  const eligibility = await checkTeacherEligibility(survey, teacher);
  if (!eligibility.eligible) {
    return surveyFail(eligibility.reason ?? "غير مؤهل للاستجابة لهذا الاستبيان", "FORBIDDEN");
  }

  const questions = await db.surveyQuestion.findMany({
    where: { surveyId },
    orderBy: { orderIndex: "asc" },
  });

  let myResponse: MyResponseState | null = null;
  let alreadySubmitted = false;
  if (!survey.anonymous) {
    const responses = await db.surveyResponse.findMany({
      where: { surveyId, respondentId: viewer.id },
      orderBy: { updatedAt: "desc" },
      include: {
        answers: {
          select: {
            questionId: true,
            valueNumber: true,
            valueText: true,
            selectedOptionsJson: true,
          },
        },
      },
    });
    const submitted = responses.find((response) => response.status === "SUBMITTED");
    if (submitted && !survey.allowMultipleResponses) {
      alreadySubmitted = true;
      myResponse = {
        id: submitted.id,
        status: submitted.status,
        submittedAt: submitted.submittedAt,
        updatedAt: submitted.updatedAt,
        answers: submitted.answers.map((answer) => ({
          questionId: answer.questionId,
          valueNumber: answer.valueNumber,
          valueText: answer.valueText,
          selectedOptions: parseOptions(answer.selectedOptionsJson),
        })),
      };
    } else {
      const draft = responses.find((response) => response.status === "DRAFT");
      if (draft) {
        myResponse = {
          id: draft.id,
          status: draft.status,
          submittedAt: null,
          updatedAt: draft.updatedAt,
          answers: draft.answers.map((answer) => ({
            questionId: answer.questionId,
            valueNumber: answer.valueNumber,
            valueText: answer.valueText,
            selectedOptions: parseOptions(answer.selectedOptionsJson),
          })),
        };
      }
    }
  } else if (survey.linkResponsesEnabled && survey.linkPairCode) {
    const key = computeRespondentKey(survey.linkPairCode, viewer.id);
    const existing = await db.surveyResponse.findFirst({
      where: { surveyId, respondentKey: key, status: "SUBMITTED" },
      select: { id: true },
    });
    if (existing && !survey.allowMultipleResponses) {
      alreadySubmitted = true;
    }
  }

  const duplicateNote = survey.anonymous
    ? survey.linkResponsesEnabled
      ? null
      : "الاستبيان مجهول الهوية دون ربط ردود — لا يمكن تقنيًا منع تكرار الردود، واعتمد على توجيه المعلمين بعدم التكرار."
    : null;

  return {
    ok: true,
    data: {
      survey: {
        id: survey.id,
        titleAr: survey.titleAr,
        descriptionAr: survey.descriptionAr,
        purposeAr: survey.purposeAr,
        instructionsAr: survey.instructionsAr,
        anonymous: survey.anonymous,
        stage: (survey.stage as SurveyStage | null) ?? null,
        closesAt: survey.closesAt,
        allowMultipleResponses: survey.allowMultipleResponses,
      },
      questions: questions.map((question) => ({
        id: question.id,
        orderIndex: question.orderIndex,
        textAr: question.textAr,
        helpTextAr: question.helpTextAr,
        type: question.type as SurveyQuestionType,
        required: question.required,
        options: parseOptions(question.optionsJson),
        minScore: question.minScore,
        maxScore: question.maxScore,
      })),
      myResponse,
      alreadySubmitted,
      duplicateNote,
    },
  };
}

async function loadQuestionsForValidation(surveyId: string) {
  return db.surveyQuestion.findMany({
    where: { surveyId },
    select: {
      id: true,
      type: true,
      required: true,
      textAr: true,
      optionsJson: true,
      minScore: true,
      maxScore: true,
    },
    orderBy: { orderIndex: "asc" },
  });
}

function answersToRows(responseId: string, answers: PersistableAnswer[]) {
  return answers.map((answer) => ({
    responseId,
    questionId: answer.questionId,
    valueNumber: answer.valueNumber ?? null,
    valueText: answer.valueText ?? null,
    selectedOptionsJson:
      answer.selectedOptions && answer.selectedOptions.length > 0
        ? JSON.stringify(answer.selectedOptions)
        : null,
  }));
}

export interface RespondInput {
  answers: unknown;
}

export async function saveResponseDraft(
  viewer: SurveyViewer,
  surveyId: string,
  rawPayload: unknown
): Promise<SurveyResult<{ id: string }>> {
  if (viewer.role !== "TEACHER" || !viewer.schoolId) {
    return surveyFail("حفظ المسودة متاح للمعلمين فقط", "FORBIDDEN");
  }
  const survey = await db.survey.findUnique({
    where: { id: surveyId },
    select: {
      id: true,
      schoolId: true,
      status: true,
      anonymous: true,
      allowMultipleResponses: true,
      opensAt: true,
      closesAt: true,
      audienceMode: true,
      targetBranchIdsJson: true,
      targetTeacherIdsJson: true,
      ownerUserId: true,
      owner: { select: { id: true, role: true } },
    },
  });
  if (!survey) return surveyFail("الاستبيان غير موجود", "NOT_FOUND");
  if (survey.schoolId !== viewer.schoolId) {
    return surveyFail("الاستبيان خارج نطاق مدرستك", "FORBIDDEN");
  }
  // Drafts are an identified-survey convenience — anonymous surveys never
  // persist identity, so they cannot reconnect a draft to its author.
  if (survey.anonymous) {
    return surveyFail(
      "الاستبيانات مجهولة الهوية لا تدعم الحفظ المؤقت — أكمل الإجابة وأرسلها في الجلسة نفسها",
      "FORBIDDEN"
    );
  }
  if (!isWithinResponseWindow(survey)) {
    return surveyFail("الاستبيان غير مفتوح حاليًا", "NOT_OPEN");
  }

  const teacher = await db.user.findUnique({
    where: { id: viewer.id },
    select: { id: true, role: true, schoolId: true, branchId: true, isActive: true },
  });
  if (!teacher) return surveyFail("الحساب غير موجود", "FORBIDDEN");
  const eligibility = await checkTeacherEligibility(survey, teacher);
  if (!eligibility.eligible) {
    return surveyFail(eligibility.reason ?? "غير مؤهل للاستجابة", "FORBIDDEN");
  }

  const parsed = responsePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return validationFail(parsed.error);
  const questions = await loadQuestionsForValidation(surveyId);
  const normalized = normalizeAnswers(parsed.data.answers, questions);
  if (!normalized.ok) return { ok: false, message: normalized.message, code: normalized.code };

  const submitted = await db.surveyResponse.findFirst({
    where: { surveyId, respondentId: viewer.id, status: "SUBMITTED" },
    select: { id: true },
  });
  if (submitted && !survey.allowMultipleResponses) {
    return surveyFail("لقد أرسلت ردك على هذا الاستبيان بالفعل", "ALREADY_SUBMITTED");
  }

  const draft = await db.$transaction(async (tx) => {
    const existing = await tx.surveyResponse.findFirst({
      where: { surveyId, respondentId: viewer.id, status: "DRAFT" },
      select: { id: true },
    });
    const response = existing
      ? await tx.surveyResponse.update({
          where: { id: existing.id },
          data: { updatedAt: new Date() },
        })
      : await tx.surveyResponse.create({
          data: {
            surveyId,
            schoolId: survey.schoolId,
            respondentId: viewer.id,
            status: "DRAFT",
          },
        });
    await tx.surveyAnswer.deleteMany({ where: { responseId: response.id } });
    const draftRows = answersToRows(response.id, normalized.answers);
    if (draftRows.length > 0) {
      await tx.surveyAnswer.createMany({ data: draftRows });
    }
    return response;
  });

  return { ok: true, data: { id: draft.id } };
}

export async function submitResponse(
  viewer: SurveyViewer,
  surveyId: string,
  rawPayload: unknown
): Promise<SurveyResult<{ id: string; submittedAt: Date; surveyTitle: string }>> {
  if (viewer.role !== "TEACHER" || !viewer.schoolId) {
    return surveyFail("الاستجابة للاستبيانات متاحة للمعلمين فقط", "FORBIDDEN");
  }

  // Abuse protection (process-local sliding window).
  const rate = checkRateLimit("survey-submit", viewer.id, SUBMIT_RATE_LIMIT, SUBMIT_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return surveyFail(
      `محاولات كثيرة — أعد المحاولة بعد ${rate.retryAfterSeconds} ثانية`,
      "RATE_LIMITED"
    );
  }

  const survey = await db.survey.findUnique({
    where: { id: surveyId },
    select: {
      id: true,
      schoolId: true,
      titleAr: true,
      status: true,
      anonymous: true,
      allowMultipleResponses: true,
      linkResponsesEnabled: true,
      linkPairCode: true,
      opensAt: true,
      closesAt: true,
      audienceMode: true,
      targetBranchIdsJson: true,
      targetTeacherIdsJson: true,
      ownerUserId: true,
      owner: { select: { id: true, role: true } },
    },
  });
  if (!survey) return surveyFail("الاستبيان غير موجود", "NOT_FOUND");
  if (survey.schoolId !== viewer.schoolId) {
    return surveyFail("الاستبيان خارج نطاق مدرستك", "FORBIDDEN");
  }
  if (survey.status === "ARCHIVED" || survey.status === "CLOSED") {
    return surveyFail("هذا الاستبيان مغلق ولا يقبل ردودًا", "CLOSED");
  }
  if (!isWithinResponseWindow(survey)) {
    return surveyFail("الاستبيان غير مفتوح للاستجابة في الوقت الحالي", "NOT_OPEN");
  }

  // Eligibility is re-checked against the REAL audience + owner scope.
  // Submission on behalf of another user is structurally impossible: the
  // respondent identity ALWAYS comes from the session, never the payload.
  const teacher = await db.user.findUnique({
    where: { id: viewer.id },
    select: { id: true, role: true, schoolId: true, branchId: true, isActive: true },
  });
  if (!teacher) return surveyFail("الحساب غير موجود", "FORBIDDEN");
  const eligibility = await checkTeacherEligibility(survey, teacher);
  if (!eligibility.eligible) {
    return surveyFail(eligibility.reason ?? "غير مؤهل للاستجابة لهذا الاستبيان", "FORBIDDEN");
  }

  const parsed = responsePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return validationFail(parsed.error);
  const questions = await loadQuestionsForValidation(surveyId);
  const normalized = normalizeAnswers(parsed.data.answers, questions);
  if (!normalized.ok) return { ok: false, message: normalized.message, code: normalized.code };
  const requiredCheck = checkRequiredAnswers(questions, normalized.answers);
  if (!requiredCheck.ok) return { ok: false, message: requiredCheck.message, code: requiredCheck.code };

  // Duplicate policy.
  let respondentKey: string | null = null;
  if (!survey.anonymous) {
    if (!survey.allowMultipleResponses) {
      const submitted = await db.surveyResponse.findFirst({
        where: { surveyId, respondentId: viewer.id, status: "SUBMITTED" },
        select: { id: true },
      });
      if (submitted) {
        return surveyFail("لقد أرسلت ردك على هذا الاستبيان بالفعل", "ALREADY_SUBMITTED");
      }
    }
  } else if (survey.linkResponsesEnabled && survey.linkPairCode) {
    respondentKey = computeRespondentKey(survey.linkPairCode, viewer.id);
    if (!survey.allowMultipleResponses) {
      const submitted = await db.surveyResponse.findFirst({
        where: { surveyId, respondentKey, status: "SUBMITTED" },
        select: { id: true },
      });
      if (submitted) {
        return surveyFail("لقد أرسلت ردك على هذا الاستبيان بالفعل", "ALREADY_SUBMITTED");
      }
    }
  }
  // Anonymous without linking: duplicates are technically unpreventable —
  // documented in the UI before enabling the configuration.

  const now = new Date();
  const submittedRow = await db.$transaction(async (tx) => {
    // Identified surveys reuse the draft row when one exists.
    let responseId: string;
    if (!survey.anonymous) {
      const draft = await tx.surveyResponse.findFirst({
        where: { surveyId, respondentId: viewer.id, status: "DRAFT" },
        select: { id: true },
      });
      if (draft) {
        await tx.surveyResponse.update({
          where: { id: draft.id },
          data: { status: "SUBMITTED", submittedAt: now, updatedAt: now },
        });
        responseId = draft.id;
      } else {
        const created = await tx.surveyResponse.create({
          data: {
            surveyId,
            schoolId: survey.schoolId,
            respondentId: viewer.id,
            status: "SUBMITTED",
            submittedAt: now,
          },
        });
        responseId = created.id;
      }
      await tx.surveyAnswer.deleteMany({ where: { responseId } });
    } else {
      // Anonymous: respondentId stays null FOREVER — no draft, no identity.
      const created = await tx.surveyResponse.create({
        data: {
          surveyId,
          schoolId: survey.schoolId,
          respondentId: null,
          respondentKey,
          status: "SUBMITTED",
          submittedAt: now,
        },
      });
      responseId = created.id;
    }
    const submitRows = answersToRows(responseId, normalized.answers);
    if (submitRows.length > 0) {
      await tx.surveyAnswer.createMany({ data: submitRows });
    }
    return { id: responseId, submittedAt: now };
  });

  return {
    ok: true,
    data: { id: submittedRow.id, submittedAt: submittedRow.submittedAt, surveyTitle: survey.titleAr },
  };
}

/** Identified response history for the responding teacher (own rows only). */
export interface MyResponseHistoryRow {
  surveyId: string;
  surveyTitle: string;
  status: string;
  submittedAt: Date | null;
  updatedAt: Date;
}

export async function getMyResponseHistory(
  viewer: SurveyViewer
): Promise<SurveyResult<MyResponseHistoryRow[]>> {
  if (viewer.role !== "TEACHER" || !viewer.schoolId) {
    return surveyFail("سجل الردود متاح للمعلمين فقط", "FORBIDDEN");
  }
  // Anonymous responses never appear here — they carry no identity.
  const responses = await db.surveyResponse.findMany({
    where: { respondentId: viewer.id, schoolId: viewer.schoolId, status: "SUBMITTED" },
    orderBy: { submittedAt: "desc" },
    take: 50,
    include: { survey: { select: { id: true, titleAr: true } } },
  });
  return {
    ok: true,
    data: responses.map((response) => ({
      surveyId: response.survey.id,
      surveyTitle: response.survey.titleAr,
      status: response.status,
      submittedAt: response.submittedAt,
      updatedAt: response.updatedAt,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Results & outcome analysis                                           */
/* ------------------------------------------------------------------ */

interface ResultsSurvey {
  id: string;
  schoolId: string;
  titleAr: string;
  status: string;
  anonymous: boolean;
  stage: string | null;
  programId: string | null;
  courseId: string | null;
  linkPairCode: string | null;
  ownerUserId: string;
  audienceMode: string;
  targetBranchIdsJson: string | null;
  targetTeacherIdsJson: string | null;
  owner: { id: string; name: string; role: string };
}

function resultsFail(message: string, code: SurveyErrorCode) {
  return { ok: false as const, message, code };
}

async function loadResultsContext(
  ctx: SurveyActor,
  surveyId: string
): Promise<{ ok: true; survey: ResultsSurvey } | { ok: false; message: string; code: SurveyErrorCode }> {
  if (!canViewSurveyResults(ctx.role)) {
    return resultsFail("عرض نتائج الاستبيان متاح للأدوار الإدارية المدرسية فقط", "FORBIDDEN");
  }
  const survey = await db.survey.findUnique({
    where: { id: surveyId },
    select: {
      id: true,
      schoolId: true,
      titleAr: true,
      status: true,
      anonymous: true,
      stage: true,
      programId: true,
      courseId: true,
      linkPairCode: true,
      ownerUserId: true,
      audienceMode: true,
      targetBranchIdsJson: true,
      targetTeacherIdsJson: true,
      owner: { select: { id: true, name: true, role: true } },
    },
  });
  if (!survey) return resultsFail("الاستبيان غير موجود", "NOT_FOUND");

  let effectiveSchoolId = ctx.schoolId;
  if (ctx.role === "EDUCATIONAL_DEPUTY") {
    const grant = await db.deputyGrant.findFirst({ where: { userId: ctx.id }, select: { schoolId: true } });
    effectiveSchoolId = grant?.schoolId ?? null;
  }
  if (!effectiveSchoolId || survey.schoolId !== effectiveSchoolId) {
    return resultsFail("لا تملك صلاحية الوصول إلى نتائج هذا الاستبيان", "FORBIDDEN");
  }
  if (ctx.role === "EDUCATIONAL_SUPERVISOR" && survey.ownerUserId !== ctx.id) {
    return resultsFail("المشرف التربوي يطلع على نتائج استبياناته الخاصة فقط", "FORBIDDEN");
  }
  return { ok: true as const, survey };
}

function numericLabel(type: SurveyQuestionType, value: number): string | null {
  if (type === "LIKERT") {
    // 5 = strongest agreement → index 0 in LIKERT_OPTIONS.
    return LIKERT_OPTIONS[LIKERT_POINTS - value] ?? null;
  }
  if (type === "YES_NO") return value === 1 ? "نعم" : "لا";
  return null;
}

export async function getSurveyResults(
  ctx: SurveyActor,
  surveyId: string
): Promise<SurveyResult<SurveyResults>> {
  const context = await loadResultsContext(ctx, surveyId);
  if (!context.ok) return context;

  const survey = context.survey;
  const questions = await db.surveyQuestion.findMany({
    where: { surveyId },
    orderBy: { orderIndex: "asc" },
  });

  const [audienceTeachers, submittedResponses] = await Promise.all([
    resolveAudienceTeachers({
      schoolId: survey.schoolId,
      audienceMode: survey.audienceMode,
      targetBranchIdsJson: survey.targetBranchIdsJson,
      targetTeacherIdsJson: survey.targetTeacherIdsJson,
      owner: { id: survey.owner.id, role: survey.owner.role },
    }),
    db.surveyResponse.findMany({
      where: { surveyId, status: "SUBMITTED" },
      orderBy: { submittedAt: "desc" },
      take: RESPONSES_LIST_LIMIT,
      include: {
        answers: {
          select: {
            questionId: true,
            valueNumber: true,
            valueText: true,
            selectedOptionsJson: true,
          },
        },
        // Anonymous rows carry respondentId = null → respondent = null;
        // the projection below never renders it for anonymous surveys.
        respondent: { select: { id: true, name: true, branch: { select: { nameAr: true } } } },
      },
    }),
  ]);

  const eligibleCount = audienceTeachers.length;
  const submittedCount = await db.surveyResponse.count({
    where: { surveyId, status: "SUBMITTED" },
  });
  const draftCount = survey.anonymous
    ? 0
    : await db.surveyResponse.count({ where: { surveyId, status: "DRAFT" } });

  const responseRatePercent =
    eligibleCount > 0 ? Math.round((submittedCount / eligibleCount) * 100) : null;

  // Small-group privacy: anonymous distributions/texts are suppressed
  // when fewer than MIN_ANONYMOUS_AGGREGATE responses exist.
  const privacySuppressed = survey.anonymous && submittedCount < MIN_ANONYMOUS_AGGREGATE;

  const distributions: QuestionDistribution[] = [];
  for (const question of questions) {
    const type = question.type as SurveyQuestionType;
    const answers = submittedResponses.flatMap((response) =>
      response.answers.filter((answer) => answer.questionId === question.id)
    );
    const answeredCount = answers.length;
    const distribution: QuestionDistribution = {
      questionId: question.id,
      textAr: question.textAr,
      type,
      required: question.required,
      answeredCount,
      skippedCount: Math.max(0, submittedCount - answeredCount),
      numericDistribution: [],
      average: null,
      optionCounts: [],
      texts: null,
    };

    if (privacySuppressed) {
      distributions.push(distribution);
      continue;
    }

    if (type === "RATING" || type === "LIKERT" || type === "YES_NO") {
      const values = answers
        .map((answer) => answer.valueNumber)
        .filter((value): value is number => value !== null && value !== undefined);
      let min = 0;
      let max = 1;
      if (type === "RATING") {
        const bounds = ratingBounds(question);
        min = bounds.min;
        max = bounds.max;
      } else if (type === "LIKERT") {
        min = 1;
        max = LIKERT_POINTS;
      } else {
        min = 0;
        max = 1;
      }
      for (let value = min; value <= max; value++) {
        distribution.numericDistribution.push({
          value,
          label: numericLabel(type, value),
          count: values.filter((item) => item === value).length,
        });
      }
      distribution.average =
        values.length > 0
          ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
          : null;
    } else if (type === "SINGLE_CHOICE" || type === "MULTI_CHOICE") {
      const options = parseOptions(question.optionsJson);
      const selected = answers.flatMap((answer) => parseOptions(answer.selectedOptionsJson));
      distribution.optionCounts = options.map((option) => ({
        option,
        count: selected.filter((item) => item === option).length,
      }));
    } else {
      const texts = answers
        .map((answer) => answer.valueText)
        .filter((text): text is string => text !== null && text.trim() !== "");
      distribution.texts = texts.slice(0, MAX_LISTED_TEXT_ANSWERS);
    }

    distributions.push(distribution);
  }

  const canSeeIndividualResponses =
    canViewIndividualResponses(ctx.role) &&
    !survey.anonymous &&
    (ctx.role === "DEVELOPMENT_OFFICE_MANAGER" || survey.ownerUserId === ctx.id);

  const responses: IndividualResponseRow[] = survey.anonymous
    ? []
    : canSeeIndividualResponses
      ? submittedResponses.map((response) => ({
          id: response.id,
          respondentName: response.respondent?.name ?? null,
          branchName: response.respondent?.branch?.nameAr ?? null,
          status: response.status,
          submittedAt: response.submittedAt,
          updatedAt: response.updatedAt,
        }))
      : [];
  return {
    ok: true,
    data: {
      survey: {
        id: survey.id,
        titleAr: survey.titleAr,
        status: survey.status as SurveyStatus,
        anonymous: survey.anonymous,
        stage: (survey.stage as SurveyStage | null) ?? null,
      },
      eligibleCount,
      submittedCount,
      draftCount,
      responseRatePercent,
      privacySuppressed,
      distributions,
      responses,
      canSeeIndividualResponses,
    },
  };
}

export async function getIndividualResponse(
  ctx: SurveyActor,
  surveyId: string,
  responseId: string
): Promise<
  SurveyResult<{
    surveyTitle: string;
    respondentName: string;
    branchName: string | null;
    submittedAt: Date | null;
    answers: { textAr: string; type: SurveyQuestionType; display: string }[];
  }>
> {
  if (!canViewIndividualResponses(ctx.role)) {
    return surveyFail("عرض الردود الفردية غير متاح لدورك", "FORBIDDEN");
  }
  const survey = await db.survey.findUnique({
    where: { id: surveyId },
    select: { id: true, schoolId: true, titleAr: true, anonymous: true, ownerUserId: true },
  });
  if (!survey) return surveyFail("الاستبيان غير موجود", "NOT_FOUND");
  const scopeError = surveyScopeError(ctx, survey.schoolId);
  if (scopeError) return scopeError;
  if (ctx.role === "EDUCATIONAL_SUPERVISOR" && survey.ownerUserId !== ctx.id) {
    return surveyFail("المشرف التربوي يطلع على ردود استبياناته الخاصة فقط", "FORBIDDEN");
  }
  // Anonymous surveys NEVER expose individual rows — role cannot override.
  if (survey.anonymous) {
    return surveyFail("الاستبيان مجهول الهوية — الردود الفردية غير متاحة تقنيًا", "FORBIDDEN");
  }

  const response = await db.surveyResponse.findUnique({
    where: { id: responseId },
    include: {
      respondent: { select: { name: true, branch: { select: { nameAr: true } } } },
      answers: {
        select: { questionId: true, valueNumber: true, valueText: true, selectedOptionsJson: true },
      },
    },
  });
  if (!response || response.surveyId !== surveyId) {
    return surveyFail("الرد غير موجود", "NOT_FOUND");
  }

  const questions = await db.surveyQuestion.findMany({
    where: { surveyId },
    orderBy: { orderIndex: "asc" },
  });
  const answerByQuestion = new Map(response.answers.map((answer) => [answer.questionId, answer]));

  const answers = questions.map((question) => {
    const type = question.type as SurveyQuestionType;
    const answer = answerByQuestion.get(question.id);
    let display = "—";
    if (answer) {
      if (type === "SHORT_TEXT" || type === "LONG_TEXT") {
        display = answer.valueText ?? "—";
      } else if (type === "SINGLE_CHOICE" || type === "MULTI_CHOICE") {
        const options = parseOptions(answer.selectedOptionsJson);
        display = options.length > 0 ? options.join("، ") : "—";
      } else if (answer.valueNumber !== null && answer.valueNumber !== undefined) {
        const label = numericLabel(type, answer.valueNumber);
        display = label ?? String(answer.valueNumber);
      }
    }
    return { textAr: question.textAr, type, display };
  });

  return {
    ok: true,
    data: {
      surveyTitle: survey.titleAr,
      respondentName: response.respondent?.name ?? "—",
      branchName: response.respondent?.branch?.nameAr ?? null,
      submittedAt: response.submittedAt,
      answers,
    },
  };
}

/**
 * Pre/post stage comparison. Pairs respondents across the two surveys of
 * one content anchor + pair code: by identity when identified, by the
 * pseudonymous respondentKey when anonymous (linking explicitly enabled).
 * Only REAL paired observations are measured — no baselines are invented,
 * and anonymous pairings below the small-group threshold stay suppressed.
 */
export async function getStageComparison(
  ctx: SurveyActor,
  surveyId: string
): Promise<SurveyResult<StageComparison | null>> {
  const context = await loadResultsContext(ctx, surveyId);
  if (!context.ok) return context;
  const survey = context.survey;

  const stage = survey.stage as SurveyStage | null;
  if (stage !== "PRE_TRAINING" && stage !== "AFTER_TRAINING") {
    return { ok: true, data: null }; // comparison not applicable
  }
  if (!survey.linkPairCode || (!survey.programId && !survey.courseId)) {
    return { ok: true, data: null };
  }

  const twinStage = stage === "PRE_TRAINING" ? "AFTER_TRAINING" : "PRE_TRAINING";
  const twin = await db.survey.findFirst({
    where: {
      id: { not: survey.id },
      schoolId: survey.schoolId,
      linkPairCode: survey.linkPairCode,
      stage: twinStage,
      status: { in: ["PUBLISHED", "CLOSED"] },
      ...(survey.programId ? { programId: survey.programId } : { courseId: survey.courseId! }),
    },
    select: { id: true, titleAr: true, anonymous: true, linkResponsesEnabled: true },
    orderBy: { publishedAt: "desc" },
  });
  if (!twin) return { ok: true, data: null };

  const preSurvey = stage === "PRE_TRAINING" ? survey : twin;
  const afterSurvey = stage === "PRE_TRAINING" ? twin : survey;
  const pairingMode: StageComparison["pairingMode"] =
    preSurvey.anonymous && afterSurvey.anonymous ? "ANONYMOUS_KEY" : "IDENTIFIED";

  /**
   * Personal mean of RATING/LIKERT answers per submitted response,
   * keyed by pairing identity. Both scalar columns are always selected:
   * anonymous rows have respondentId = null and identified rows have
   * respondentKey = null, so nothing crosses the pairing domains.
   */
  const loadScored = async (sid: string, keyByRespondentKey: boolean) => {
    const rows = await db.surveyResponse.findMany({
      where: { surveyId: sid, status: "SUBMITTED" },
      select: {
        respondentId: true,
        respondentKey: true,
        answers: { select: { questionId: true, valueNumber: true } },
      },
    });
    const ratingQuestionIds = new Set(
      (
        await db.surveyQuestion.findMany({
          where: { surveyId: sid, type: { in: ["RATING", "LIKERT"] } },
          select: { id: true },
        })
      ).map((question) => question.id)
    );
    const scored: { key: string; mean: number }[] = [];
    for (const row of rows) {
      const key = keyByRespondentKey ? row.respondentKey : row.respondentId;
      if (!key) continue;
      const values = row.answers
        .filter(
          (answer) =>
            ratingQuestionIds.has(answer.questionId) &&
            answer.valueNumber !== null &&
            answer.valueNumber !== undefined
        )
        .map((answer) => answer.valueNumber as number);
      if (values.length === 0) continue;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      scored.push({ key, mean });
    }
    return new Map(scored.map((row) => [row.key, row.mean]));
  };

  const [preMap, afterMap] = await Promise.all([
    loadScored(preSurvey.id, pairingMode === "ANONYMOUS_KEY"),
    loadScored(afterSurvey.id, pairingMode === "ANONYMOUS_KEY"),
  ]);

  const pairedKeys = Array.from(preMap.keys()).filter((key) => afterMap.has(key));
  const pairedCount = pairedKeys.length;
  const privacySuppressed = pairingMode === "ANONYMOUS_KEY" && pairedCount < MIN_ANONYMOUS_AGGREGATE;

  const preAverage =
    pairedCount > 0 && !privacySuppressed
      ? Math.round((pairedKeys.reduce((sum, key) => sum + preMap.get(key)!, 0) / pairedCount) * 100) / 100
      : null;
  const afterAverage =
    pairedCount > 0 && !privacySuppressed
      ? Math.round((pairedKeys.reduce((sum, key) => sum + afterMap.get(key)!, 0) / pairedCount) * 100) / 100
      : null;
  const observedDelta =
    preAverage !== null && afterAverage !== null
      ? Math.round((afterAverage - preAverage) * 100) / 100
      : null;

  // Per-question comparison keyed by exact Arabic text (normalized).
  const perQuestion: StageComparison["perQuestion"] = [];
  if (!privacySuppressed && pairedCount > 0) {
    const [preQuestions, afterQuestions] = await Promise.all([
      db.surveyQuestion.findMany({
        where: { surveyId: preSurvey.id, type: { in: ["RATING", "LIKERT"] } },
        select: { id: true, textAr: true },
      }),
      db.surveyQuestion.findMany({
        where: { surveyId: afterSurvey.id, type: { in: ["RATING", "LIKERT"] } },
        select: { id: true, textAr: true },
      }),
    ]);
    const afterByText = new Map(afterQuestions.map((question) => [question.textAr.trim(), question.id]));
    for (const preQuestion of preQuestions) {
      const afterQuestionId = afterByText.get(preQuestion.textAr.trim());
      if (!afterQuestionId) continue;
      let preSum = 0;
      let preN = 0;
      let afterSum = 0;
      let afterN = 0;
      // Values are recomputed per question over the paired respondents.
      // Both pairing columns are always selected — anonymous rows carry
      // respondentId = null and identified rows carry respondentKey = null.
      const [preRows, afterRows] = await Promise.all([
        db.surveyAnswer.findMany({
          where: { questionId: preQuestion.id, response: { status: "SUBMITTED", surveyId: preSurvey.id } },
          select: {
            valueNumber: true,
            response: { select: { respondentId: true, respondentKey: true } },
          },
        }),
        db.surveyAnswer.findMany({
          where: { questionId: afterQuestionId, response: { status: "SUBMITTED", surveyId: afterSurvey.id } },
          select: {
            valueNumber: true,
            response: { select: { respondentId: true, respondentKey: true } },
          },
        }),
      ]);
      const pairKeyOf = (response: { respondentId: string | null; respondentKey: string | null }) =>
        pairingMode === "ANONYMOUS_KEY" ? response.respondentKey : response.respondentId;
      const preByKey = new Map(
        preRows
          .filter((row) => row.valueNumber !== null)
          .map((row) => [pairKeyOf(row.response), row.valueNumber as number])
      );
      const afterByKey = new Map(
        afterRows
          .filter((row) => row.valueNumber !== null)
          .map((row) => [pairKeyOf(row.response), row.valueNumber as number])
      );
      for (const key of pairedKeys) {
        const pre = preByKey.get(key);
        const after = afterByKey.get(key);
        if (pre !== undefined) {
          preSum += pre;
          preN += 1;
        }
        if (after !== undefined) {
          afterSum += after;
          afterN += 1;
        }
      }
      if (preN > 0 && afterN > 0) {
        const preMean = Math.round((preSum / preN) * 100) / 100;
        const afterMean = Math.round((afterSum / afterN) * 100) / 100;
        perQuestion.push({
          textAr: preQuestion.textAr,
          preAverage: preMean,
          afterAverage: afterMean,
          delta: Math.round((afterMean - preMean) * 100) / 100,
        });
      }
    }
  }

  return {
    ok: true,
    data: {
      preSurveyId: preSurvey.id,
      preTitle: preSurvey.titleAr,
      afterSurveyId: afterSurvey.id,
      afterTitle: afterSurvey.titleAr,
      pairingMode,
      pairedCount,
      privacySuppressed,
      preAverage,
      afterAverage,
      observedDelta,
      perQuestion,
      note:
        pairingMode === "ANONYMOUS_KEY"
          ? "الربط عبر مفاتيح مجهولة (لا تكشف هوية المستجيبين)."
          : "الربط عبر هوية المستجيبين في الاستبيانين.",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Manage-level metrics                                                 */
/* ------------------------------------------------------------------ */

export async function getSurveyMetrics(ctx: SurveyActor): Promise<SurveyResult<SurveyMetrics>> {
  if (!canViewSurveySummaries(ctx.role)) {
    return surveyFail("مؤشرات الاستبيانات متاحة للأدوار الإدارية المدرسية فقط", "FORBIDDEN");
  }
  let schoolId = ctx.schoolId;
  if (ctx.role === "EDUCATIONAL_DEPUTY") {
    const grant = await db.deputyGrant.findFirst({ where: { userId: ctx.id }, select: { schoolId: true } });
    schoolId = grant?.schoolId ?? null;
  }
  if (!schoolId) {
    return surveyFail("النطاق المدرسي غير محدد", "FORBIDDEN");
  }
  const scopeError = surveyScopeError(ctx, schoolId);
  if (scopeError) return scopeError;

  const where: Record<string, unknown> = { schoolId };
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") where.ownerUserId = ctx.id;

  const [totalSurveys, draftSurveys, openSurveys, closedSurveys] = await Promise.all([
    db.survey.count({ where }),
    db.survey.count({ where: { ...where, status: "DRAFT" } }),
    db.survey.count({ where: { ...where, status: "PUBLISHED" } }),
    db.survey.count({ where: { ...where, status: "CLOSED" } }),
  ]);

  // Response-rate denominator: each survey's resolved eligible audience.
  const surveys = await db.survey.findMany({
    where: { ...where, status: { in: ["PUBLISHED", "CLOSED"] } },
    select: {
      id: true,
      audienceMode: true,
      targetBranchIdsJson: true,
      targetTeacherIdsJson: true,
      ownerUserId: true,
      owner: { select: { id: true, role: true } },
    },
    take: 100,
  });
  let submittedTotal = 0;
  let eligibleTotal = 0;
  for (const survey of surveys) {
    const [eligible, submitted] = await Promise.all([
      resolveAudienceTeachers({
        schoolId,
        audienceMode: survey.audienceMode,
        targetBranchIdsJson: survey.targetBranchIdsJson,
        targetTeacherIdsJson: survey.targetTeacherIdsJson,
        owner: { id: survey.owner.id, role: survey.owner.role },
      }).then((teachers) => teachers.length),
      db.surveyResponse.count({ where: { surveyId: survey.id, status: "SUBMITTED" } }),
    ]);
    eligibleTotal += eligible;
    submittedTotal += submitted;
  }

  return {
    ok: true,
    data: {
      totalSurveys,
      draftSurveys,
      openSurveys,
      closedSurveys,
      submittedResponses: submittedTotal,
      averageResponseRatePercent:
        eligibleTotal > 0 ? Math.round((submittedTotal / eligibleTotal) * 100) : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Follow-up options for the follow-up form (school-scoped selects)     */
/* ------------------------------------------------------------------ */

/**
 * School surveys offered as follow-up links: published/closed only.
 * Used by the follow-up form; supervisors see their own surveys.
 */
export async function listSurveyLinkOptions(
  ctx: SurveyActor
): Promise<SurveyResult<{ id: string; titleAr: string; stage: SurveyStage | null }[]>> {
  if (!canManageFollowUps(ctx.role) || !ctx.schoolId) {
    return surveyFail("غير مصرح", "FORBIDDEN");
  }
  const where: Record<string, unknown> = {
    schoolId: ctx.schoolId,
    status: { in: ["PUBLISHED", "CLOSED"] },
  };
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") where.ownerUserId = ctx.id;
  const surveys = await db.survey.findMany({
    where,
    select: { id: true, titleAr: true, stage: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return {
    ok: true,
    data: surveys.map((survey) => ({
      id: survey.id,
      titleAr: survey.titleAr,
      stage: (survey.stage as SurveyStage | null) ?? null,
    })),
  };
}

/**
 * Options for the survey create/edit form: non-archived school (and
 * platform) content links + in-school branches/teachers for audience
 * selection. Supervisors get the full lists — their audiences are
 * intersected with their real coverage at eligibility time.
 */
export async function listSurveyFormOptions(
  ctx: SurveyActor
): Promise<
  SurveyResult<{
    programs: { id: string; nameAr: string }[];
    courses: { id: string; titleAr: string }[];
    lessons: { id: string; titleAr: string; courseId: string | null }[];
    assignments: { id: string; titleAr: string }[];
    certificates: { id: string; titleAr: string }[];
    branches: { id: string; nameAr: string }[];
    teachers: { id: string; name: string; branchName: string | null }[];
  }>
> {
  const guardError = createSurveyGuard(ctx);
  if (guardError) return guardError;
  const schoolId = ctx.schoolId as string;

  const [programs, courses, lessons, assignments, certificates, branches, teachers] = await Promise.all([
    db.trainingProgram.findMany({
      where: { status: { not: "ARCHIVED" }, OR: [{ schoolId }, { schoolId: null }] },
      select: { id: true, nameAr: true },
      orderBy: { nameAr: "asc" },
      take: 200,
    }),
    db.course.findMany({
      where: { status: { not: "ARCHIVED" }, OR: [{ schoolId }, { schoolId: null }] },
      select: { id: true, titleAr: true },
      orderBy: { titleAr: "asc" },
      take: 200,
    }),
    db.courseLesson.findMany({
      where: { section: { course: { schoolId, status: { not: "ARCHIVED" } } } },
      select: { id: true, titleAr: true, section: { select: { courseId: true } } },
      orderBy: { orderIndex: "asc" },
      take: 300,
    }),
    db.assignment.findMany({
      where: { schoolId, status: { not: "ARCHIVED" } },
      select: { id: true, titleAr: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.certificate.findMany({
      where: { schoolId },
      select: { id: true, titleAr: true },
      orderBy: { issuedAt: "desc" },
      take: 200,
    }),
    db.branch.findMany({
      where: { schoolId, isActive: true },
      select: { id: true, nameAr: true },
      orderBy: { nameAr: "asc" },
      take: 100,
    }),
    db.user.findMany({
      where: { schoolId, role: "TEACHER", isActive: true },
      select: { id: true, name: true, branch: { select: { nameAr: true } } },
      orderBy: { name: "asc" },
      take: 300,
    }),
  ]);

  return {
    ok: true,
    data: {
      programs,
      courses,
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        titleAr: lesson.titleAr,
        courseId: lesson.section.courseId,
      })),
      assignments,
      certificates,
      branches,
      teachers: teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        branchName: teacher.branch?.nameAr ?? null,
      })),
    },
  };
}
import { Prisma } from "@prisma/client";
import { z } from "zod";

import type { ViewerIdentity } from "@/lib/training/access";
import { canManageTraining } from "@/lib/training/access";
import { db } from "@/lib/db";
import {
  notifyImpactResponseReceived,
} from "@/lib/notifications/center";

/* ------------------------------------------------------------------ */
/* Batch 1 — impact measurement (قياس الأثر) on the Phase 9 Survey     */
/* models.                                                             */
/*                                                                     */
/* Restores the original HTML workflow end to end:                     */
/*   - impact tools live with the course (Survey bound to courseId,    */
/*     stage AFTER_TRAINING, published);                               */
/*   - a teacher can respond ONLY after a real CourseCompletion;       */
/*   - one response per teacher — re-submitting replaces the previous  */
/*     answers (the HTML submitImpact dedupe rule);                    */
/*   - office/supervisor results mirror the HTML dashboard: response   */
/*     count, average rating, per-question breakdowns;                 */
/*   - identified surveys keep respondent ids (platform-level truth),  */
/*     unlike the HTML's name-string matching.                         */
/* ------------------------------------------------------------------ */

export type ImpactErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "COMPLETION_REQUIRED"
  | "SURVEY_CLOSED"
  | "VALIDATION";

export type ImpactResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      message: string;
      code?: ImpactErrorCode;
      fieldErrors?: Record<string, string>;
    };

function impactFail<T>(
  message: string,
  code: ImpactErrorCode,
  fieldErrors?: Record<string, string>
): ImpactResult<T> {
  return { ok: false, message, code, fieldErrors };
}

/* ------------------------------------------------------------------ */
/* Public question projection (no internal metadata leaks)             */
/* ------------------------------------------------------------------ */

export interface ImpactQuestionView {
  id: string;
  orderIndex: number;
  textAr: string;
  helpTextAr: string | null;
  type: string;
  required: boolean;
  options: string[] | null;
  minScore: number | null;
  maxScore: number | null;
}

export interface ImpactSurveyView {
  surveyId: string;
  titleAr: string;
  descriptionAr: string | null;
  purposeAr: string | null;
  instructionsAr: string | null;
  questions: ImpactQuestionView[];
}

const SURVEY_TYPE_MAP: Record<string, string> = {
  RATING: "RATING",
  LIKERT: "RATING",
  YES_NO: "YES_NO",
  SINGLE_CHOICE: "SINGLE_CHOICE",
  MULTI_CHOICE: "MULTI_CHOICE",
  SHORT_TEXT: "SHORT_TEXT",
  LONG_TEXT: "TEXT",
};

function parseOptionsJson(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

function projectQuestion(question: {
  id: string;
  orderIndex: number;
  textAr: string;
  helpTextAr: string | null;
  type: string;
  required: boolean;
  optionsJson: string | null;
  minScore: number | null;
  maxScore: number | null;
}): ImpactQuestionView | null {
  const type = SURVEY_TYPE_MAP[question.type];
  if (!type) return null;
  return {
    id: question.id,
    orderIndex: question.orderIndex,
    textAr: question.textAr,
    helpTextAr: question.helpTextAr,
    type,
    required: question.required,
    options:
      type === "SINGLE_CHOICE" || type === "MULTI_CHOICE"
        ? parseOptionsJson(question.optionsJson) ?? []
        : null,
    minScore: type === "RATING" ? question.minScore ?? 1 : null,
    maxScore: type === "RATING" ? question.maxScore ?? 5 : null,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

async function loadPublishedCourseSurvey(courseId: string) {
  const surveys = await db.survey.findMany({
    where: {
      courseId,
      status: "PUBLISHED",
      OR: [{ stage: "AFTER_TRAINING" }, { stage: null }],
    },
    include: {
      questions: { orderBy: { orderIndex: "asc" } },
    },
    orderBy: { publishedAt: "desc" },
    take: 1,
  });
  return surveys[0] ?? null;
}

export interface MyImpactStatus {
  available: boolean;
  submitted: boolean;
  submittedAt: Date | null;
  survey: ImpactSurveyView | null;
}

/** The teacher's impact status for one course (survey + own response). */
export async function getMyImpactStatus(
  viewer: ViewerIdentity,
  courseId: string
): Promise<ImpactResult<MyImpactStatus>> {
  const survey = await loadPublishedCourseSurvey(courseId);
  if (!survey || survey.questions.length === 0) {
    return { ok: true, data: { available: false, submitted: false, submittedAt: null, survey: null } };
  }

  const [completion, response] = await Promise.all([
    db.courseCompletion.findUnique({
      where: { courseId_userId: { courseId, userId: viewer.id } },
      select: { id: true },
    }),
    survey.anonymous
      ? Promise.resolve(null)
      : db.surveyResponse.findFirst({
          where: {
            surveyId: survey.id,
            respondentId: viewer.id,
            status: "SUBMITTED",
          },
          select: { id: true, submittedAt: true },
          orderBy: { submittedAt: "desc" },
        }),
  ]);

  const surveyView: ImpactSurveyView = {
    surveyId: survey.id,
    titleAr: survey.titleAr,
    descriptionAr: survey.descriptionAr,
    purposeAr: survey.purposeAr,
    instructionsAr: survey.instructionsAr,
    questions: survey.questions
      .map(projectQuestion)
      .filter((question): question is ImpactQuestionView => question !== null),
  };

  return {
    ok: true,
    data: {
      available: completion !== null,
      submitted: response !== null,
      submittedAt: response?.submittedAt ?? null,
      survey: surveyView,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Submission                                                          */
/* ------------------------------------------------------------------ */

const submittedAnswerSchema = z.object({
  questionId: z.string().min(1),
  valueNumber: z.number().int().optional(),
  valueText: z.string().max(2000).optional(),
  selectedOption: z.string().max(300).optional(),
});

const submitSchema = z.object({
  answers: z.array(submittedAnswerSchema).min(1).max(50),
});

export interface SubmitImpactOutcome {
  responseId: string;
  replaced: boolean;
}

/**
 * Submit (or replace) the teacher's impact response for a course.
 * Requires a real CourseCompletion — impact measurement follows the
 * completed learning, exactly like the original HTML workflow.
 */
export async function submitImpactResponse(
  viewer: ViewerIdentity,
  courseId: string,
  raw: unknown
): Promise<ImpactResult<SubmitImpactOutcome>> {
  if (viewer.role !== "TEACHER") {
    return impactFail("قياس الأثر متاح للمعلمين فقط", "FORBIDDEN");
  }

  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    return impactFail("بيانات الاستجابة غير صالحة", "VALIDATION");
  }

  const completion = await db.courseCompletion.findUnique({
    where: { courseId_userId: { courseId, userId: viewer.id } },
    select: { id: true },
  });
  if (!completion) {
    return impactFail(
      "قياس الأثر متاح بعد إتمام الدورة — أكمل متطلبات الدورة أولًا",
      "COMPLETION_REQUIRED"
    );
  }

  const survey = await loadPublishedCourseSurvey(courseId);
  if (!survey || survey.anonymous || survey.questions.length === 0) {
    return impactFail("لا توجد أدوات قياس أثر متاحة لهذه الدورة", "NOT_FOUND");
  }
  const now = Date.now();
  const windowOpen =
    (survey.opensAt === null || survey.opensAt.getTime() <= now) &&
    (survey.closesAt === null || survey.closesAt.getTime() >= now);
  if (!windowOpen) {
    return impactFail("فترة استجابة قياس الأثر منتهية", "SURVEY_CLOSED");
  }

  // Validate every answer against its question definition.
  const questionsById = new Map(survey.questions.map((q) => [q.id, q]));
  const prepared: Array<{
    questionId: string;
    valueNumber?: number;
    valueText?: string;
    selectedOptionsJson?: string;
  }> = [];
  const fieldErrors: Record<string, string> = {};

  for (const answer of parsed.data.answers) {
    const question = questionsById.get(answer.questionId);
    if (!question) {
      fieldErrors[answer.questionId] = "سؤال لا يخص أدوات قياس هذه الدورة";
      continue;
    }
    const type = SURVEY_TYPE_MAP[question.type];
    if (type === "RATING") {
      const min = question.minScore ?? 1;
      const max = question.maxScore ?? 5;
      const value = answer.valueNumber;
      if (value === undefined || value < min || value > max) {
        fieldErrors[question.id] = `اختر تقييمًا من ${min} إلى ${max}`;
        continue;
      }
      prepared.push({ questionId: question.id, valueNumber: value });
    } else if (type === "YES_NO") {
      if (answer.valueNumber !== 0 && answer.valueNumber !== 1) {
        fieldErrors[question.id] = "اختر نعم أو لا";
        continue;
      }
      prepared.push({ questionId: question.id, valueNumber: answer.valueNumber });
    } else if (type === "SINGLE_CHOICE") {
      const options = parseOptionsJson(question.optionsJson) ?? [];
      if (!answer.selectedOption || !options.includes(answer.selectedOption)) {
        fieldErrors[question.id] = "اختر أحد الخيارات المتاحة";
        continue;
      }
      prepared.push({
        questionId: question.id,
        selectedOptionsJson: JSON.stringify([answer.selectedOption]),
      });
    } else if (type === "MULTI_CHOICE") {
      const options = parseOptionsJson(question.optionsJson) ?? [];
      if (!answer.selectedOption || !options.includes(answer.selectedOption)) {
        fieldErrors[question.id] = "اختر أحد الخيارات المتاحة";
        continue;
      }
      prepared.push({
        questionId: question.id,
        selectedOptionsJson: JSON.stringify([answer.selectedOption]),
      });
    } else {
      const text = (answer.valueText ?? "").trim();
      if (!text) {
        fieldErrors[question.id] = "اكتب إجابتك النصية";
        continue;
      }
      prepared.push({ questionId: question.id, valueText: text.slice(0, 2000) });
    }
  }

  for (const question of survey.questions) {
    if (!question.required) continue;
    if (!prepared.some((answer) => answer.questionId === question.id)) {
      fieldErrors[question.id] = fieldErrors[question.id] ?? "هذا السؤال مطلوب";
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return impactFail("راجع الإجابات المعلّمة", "VALIDATION", fieldErrors);
  }

  const respondentName = (
    await db.user.findUnique({
      where: { id: viewer.id },
      select: { name: true },
    })
  )?.name ?? "معلم";

  const transactionOutcome = await db.$transaction(async (tx) => {
    // HTML dedupe rule: one response per teacher per course — an
    // existing SUBMITTED response has its answers replaced in place.
    const existing = await tx.surveyResponse.findFirst({
      where: {
        surveyId: survey.id,
        respondentId: viewer.id,
        status: "SUBMITTED",
      },
      select: { id: true },
      orderBy: { submittedAt: "desc" },
    });

    if (existing && !survey.allowMultipleResponses) {
      await tx.surveyAnswer.deleteMany({ where: { responseId: existing.id } });
      await tx.surveyAnswer.createMany({
        data: prepared.map((answer) => ({
          responseId: existing.id,
          questionId: answer.questionId,
          valueNumber: answer.valueNumber ?? null,
          valueText: answer.valueText ?? null,
          selectedOptionsJson: answer.selectedOptionsJson ?? null,
        })),
      });
      await tx.surveyResponse.update({
        where: { id: existing.id },
        data: { submittedAt: new Date() },
      });
      return { id: existing.id, replaced: true };
    }

    const created = await tx.surveyResponse.create({
      data: {
        surveyId: survey.id,
        schoolId: survey.schoolId,
        respondentId: viewer.id,
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.surveyAnswer.createMany({
      data: prepared.map((answer) => ({
        responseId: created.id,
        questionId: answer.questionId,
        valueNumber: answer.valueNumber ?? null,
        valueText: answer.valueText ?? null,
        selectedOptionsJson: answer.selectedOptionsJson ?? null,
      })),
    });
    return { id: created.id, replaced: false };
  });

  // Notify the survey owner (office/supervisor) — post-commit, best effort.
  await notifyImpactResponseReceived({
    ownerUserId: survey.ownerUserId,
    courseId,
    surveyId: survey.id,
    courseTitleAr: (await db.course.findUnique({
      where: { id: courseId },
      select: { titleAr: true },
    }))?.titleAr ?? "الدورة",
    respondentName,
  });

  return { ok: true, data: { responseId: transactionOutcome.id, replaced: transactionOutcome.replaced } };
}

/* ------------------------------------------------------------------ */
/* Results (office / manager dashboards)                               */
/* ------------------------------------------------------------------ */

export interface ImpactQuestionResult {
  questionId: string;
  textAr: string;
  type: string;
  responses: number;
  /** RATING: average on the question scale. */
  average: number | null;
  /** RATING / YES_NO / choice: label -> count. */
  distribution: Array<{ label: string; count: number }> | null;
  /** TEXT: verbatim answers with respondent names (identified surveys). */
  texts: Array<{ name: string; text: string }> | null;
}

export interface ImpactCourseResults {
  courseId: string;
  courseTitleAr: string;
  surveyId: string;
  surveyTitleAr: string;
  responsesCount: number;
  /** Average of every numeric answer across the survey (x/5 style). */
  overallAverage: number | null;
  toolsCount: number;
  questions: ImpactQuestionResult[];
}

/**
 * Per-course impact results. Access: training managers (own school /
 * platform) or the survey owner — the same fence the manage lists use.
 */
export async function getImpactResults(
  viewer: ViewerIdentity,
  courseId: string
): Promise<ImpactResult<ImpactCourseResults>> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      titleAr: true,
      schoolId: true,
      surveys: {
        where: { status: "PUBLISHED" },
        include: {
          questions: { orderBy: { orderIndex: "asc" } },
          responses: {
            where: { status: "SUBMITTED" },
            include: {
              respondent: { select: { name: true } },
              answers: true,
            },
          },
        },
        orderBy: { publishedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!course) return impactFail("الدورة غير موجودة", "NOT_FOUND");

  const survey = course.surveys[0];
  if (!survey) return impactFail("لا توجد أدوات قياس أثر لهذه الدورة", "NOT_FOUND");

  // Access fence: training managers within EITHER tenant surface —
  // the course tenant (may be platform-wide/null) OR the survey
  // tenant (surveys are always school-owned) — plus the survey owner.
  const managerAllowed =
    (canManageTraining(viewer.role) &&
      (viewer.role === "SUPER_ADMIN" ||
        course.schoolId === viewer.schoolId ||
        survey.schoolId === viewer.schoolId)) ||
    survey.ownerUserId === viewer.id;
  if (!managerAllowed) {
    return impactFail(
      "نتائج قياس الأثر متاحة لمديري التدريب ومالك الأدوات فقط",
      "FORBIDDEN"
    );
  }

  const responses = survey.responses;
  const numericValues: number[] = [];
  const questionResults: ImpactQuestionResult[] = [];

  for (const question of survey.questions) {
    const type = SURVEY_TYPE_MAP[question.type];
    const answers = responses.flatMap((response) =>
      response.answers.filter((answer) => answer.questionId === question.id)
    );
    const base = {
      questionId: question.id,
      textAr: question.textAr,
      type: type ?? question.type,
      responses: answers.length,
    };

    if (type === "RATING") {
      const min = question.minScore ?? 1;
      const max = question.maxScore ?? 5;
      const values = answers
        .map((answer) => answer.valueNumber)
        .filter((value): value is number => value !== null);
      values.forEach((value) => numericValues.push(value));
      const distribution = Array.from(
        { length: max - min + 1 },
        (_, index) => {
          const score = min + index;
          return {
            label: String(score),
            count: values.filter((value) => value === score).length,
          };
        }
      );
      questionResults.push({
        ...base,
        average: values.length
          ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))
          : null,
        distribution,
        texts: null,
      });
    } else if (type === "YES_NO") {
      const values = answers
        .map((answer) => answer.valueNumber)
        .filter((value): value is number => value !== null);
      values.forEach((value) => numericValues.push(value));
      questionResults.push({
        ...base,
        average: null,
        distribution: [
          { label: "نعم", count: values.filter((value) => value === 1).length },
          { label: "لا", count: values.filter((value) => value === 0).length },
        ],
        texts: null,
      });
    } else if (type === "SINGLE_CHOICE" || type === "MULTI_CHOICE") {
      const options = parseOptionsJson(question.optionsJson) ?? [];
      const picks = answers.flatMap((answer) => {
        if (!answer.selectedOptionsJson) return [];
        try {
          const parsed = JSON.parse(answer.selectedOptionsJson);
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      });
      questionResults.push({
        ...base,
        average: null,
        distribution: options.map((option) => ({
          label: option,
          count: picks.filter((pick) => pick === option).length,
        })),
        texts: null,
      });
    } else {
      questionResults.push({
        ...base,
        average: null,
        distribution: null,
        texts: answers
          .filter((answer) => answer.valueText)
          .map((answer) => ({
            name:
              responses.find((response) =>
                response.answers.some((item) => item.id === answer.id)
              )?.respondent?.name ?? "مجهول",
            text: answer.valueText as string,
          })),
      });
    }
  }

  const overallAverage = numericValues.length
    ? Number(
        (numericValues.reduce((a, b) => a + b, 0) / numericValues.length).toFixed(2)
      )
    : null;

  return {
    ok: true,
    data: {
      courseId: course.id,
      courseTitleAr: course.titleAr,
      surveyId: survey.id,
      surveyTitleAr: survey.titleAr,
      responsesCount: responses.length,
      overallAverage,
      toolsCount: survey.questions.length,
      questions: questionResults,
    },
  };
}

/** Office overview: every school-scoped course that has impact tools. */
export async function listImpactOverview(viewer: ViewerIdentity): Promise<
  ImpactResult<
    Array<{
      courseId: string;
      courseTitleAr: string;
      responsesCount: number;
      overallAverage: number | null;
      completionsCount: number;
    }>
  >
> {
  if (!canManageTraining(viewer.role)) {
    return impactFail(
      "لوحة قياس الأثر متاحة لمديري التدريب فقط",
      "FORBIDDEN"
    );
  }
  const scopeWhere: Prisma.CourseWhereInput =
    viewer.role === "SUPER_ADMIN"
      ? {}
      : viewer.schoolId
        ? // Courses carrying their OWN school's tools (school courses)
          // OR platform courses whose impact tools belong to the school.
          {
            OR: [
              { schoolId: viewer.schoolId },
              {
                surveys: {
                  some: { status: "PUBLISHED", schoolId: viewer.schoolId },
                },
              },
            ],
          }
        : { id: "__none__" };

  const courses = await db.course.findMany({
    where: {
      ...scopeWhere,
      surveys: { some: { status: "PUBLISHED" } },
    },
    select: {
      id: true,
      titleAr: true,
      surveys: {
        where: { status: "PUBLISHED" },
        select: {
          id: true,
          questions: { select: { type: true, minScore: true, maxScore: true } },
          responses: {
            where: { status: "SUBMITTED" },
            select: {
              answers: { select: { valueNumber: true } },
            },
          },
        },
      },
      completions: { select: { id: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const rows = courses.map((course) => {
    const survey = course.surveys[0];
    const numericValues = survey
      ? survey.responses.flatMap((response) =>
          response.answers
            .map((answer) => answer.valueNumber)
            .filter((value): value is number => value !== null)
        )
      : [];
    return {
      courseId: course.id,
      courseTitleAr: course.titleAr,
      responsesCount: survey ? survey.responses.length : 0,
      overallAverage: numericValues.length
        ? Number(
            (numericValues.reduce((a, b) => a + b, 0) / numericValues.length).toFixed(2)
          )
        : null,
      completionsCount: course.completions.length,
    };
  });

  return { ok: true, data: rows };
}
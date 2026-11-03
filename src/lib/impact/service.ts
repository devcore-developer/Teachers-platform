/**
 * Phase 9 — outcome-measurement dashboard service (role-adaptive).
 *
 *   SUPER_ADMIN                → platform-wide AGGREGATES per school
 *                                (no record access, no operational data).
 *   DEVELOPMENT_OFFICE_MANAGER → school impact overview: survey response
 *                                rates, stage comparisons list, follow-up
 *                                completion, reported challenges/support.
 *   EDUCATIONAL_SUPERVISOR     → same shape restricted to their own
 *                                surveys + responsible follow-ups.
 *   EDUCATIONAL_DEPUTY         → read-only school aggregates within grants.
 *
 * Every figure is computed from persisted rows with an explicit
 * denominator. Observed deltas are labeled as such — no causality
 * claims and no invented baselines anywhere in this module.
 */
import { db } from "@/lib/db";
import {
  canViewPlatformImpact,
  canViewSurveyResults,
  canViewSurveySummaries,
  type SurveyActor,
} from "@/lib/surveys/access";
import { getFollowUpMetrics, type FollowUpMetrics } from "@/lib/followups/service";
import { getSurveyMetrics, type SurveyMetrics } from "@/lib/surveys/service";
import { surveyFail, type SurveyResult } from "@/lib/validation/surveys";
import { IMPACT_SCHOOLS_LIMIT } from "@/config/surveys";

export interface ImpactStagePairRow {
  surveyId: string;
  surveyTitle: string;
  stage: string;
  submittedCount: number;
  hasComparisonData: boolean;
}

export interface SchoolImpactOverview {
  surveys: SurveyMetrics;
  followUps: FollowUpMetrics;
  /** Published/closed stage surveys eligible for pre/post comparison. */
  stageSurveyCount: number;
}

export interface PlatformSchoolImpactRow {
  schoolId: string;
  schoolName: string;
  surveysCount: number;
  submittedResponses: number;
  followUpsCount: number;
  completedFollowUps: number;
}

export interface PlatformImpactStats {
  schools: PlatformSchoolImpactRow[];
  totals: {
    schools: number;
    surveys: number;
    submittedResponses: number;
    followUps: number;
    completedFollowUps: number;
  };
}

export async function getSchoolImpactOverview(
  ctx: SurveyActor
): Promise<SurveyResult<SchoolImpactOverview>> {
  if (!canViewSurveySummaries(ctx.role)) {
    return surveyFail("لوحة قياس الأثر متاحة للأدوار الإدارية المدرسية فقط", "FORBIDDEN");
  }

  const [surveys, followUps] = await Promise.all([
    getSurveyMetrics(ctx),
    getFollowUpMetrics(ctx),
  ]);
  if (!surveys.ok) return surveys;
  if (!followUps.ok) return followUps;

  return {
    ok: true,
    data: {
      surveys: surveys.data,
      followUps: followUps.data,
      stageSurveyCount: await countStageSurveys(ctx),
    },
  };
}

/** Stage surveys (pre/after) in scope — the input to impact comparison. */
async function countStageSurveys(ctx: SurveyActor): Promise<number> {
  let schoolId = ctx.schoolId;
  if (ctx.role === "EDUCATIONAL_DEPUTY") {
    const grant = await db.deputyGrant.findFirst({ where: { userId: ctx.id }, select: { schoolId: true } });
    schoolId = grant?.schoolId ?? null;
  }
  if (!schoolId) return 0;
  const where: Record<string, unknown> = {
    schoolId,
    stage: { in: ["PRE_TRAINING", "AFTER_TRAINING"] },
    status: { in: ["PUBLISHED", "CLOSED"] },
  };
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") where.ownerUserId = ctx.id;
  return db.survey.count({ where });
}

/**
 * Stage-pair candidates for the impact dashboard: stage surveys with a
 * pairing code, listed with submission counts. The actual pairing math
 * lives in getStageComparison (survey service) per survey page.
 */
export async function listStagePairCandidates(
  ctx: SurveyActor
): Promise<SurveyResult<ImpactStagePairRow[]>> {
  if (!canViewSurveyResults(ctx.role)) {
    return surveyFail("غير مصرح", "FORBIDDEN");
  }
  let schoolId = ctx.schoolId;
  if (ctx.role === "EDUCATIONAL_DEPUTY") {
    const grant = await db.deputyGrant.findFirst({ where: { userId: ctx.id }, select: { schoolId: true } });
    schoolId = grant?.schoolId ?? null;
  }
  if (!schoolId) {
    return surveyFail("النطاق المدرسي غير محدد", "FORBIDDEN");
  }

  const where: Record<string, unknown> = {
    schoolId,
    stage: { not: null },
    linkPairCode: { not: null },
    status: { in: ["PUBLISHED", "CLOSED"] },
  };
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") where.ownerUserId = ctx.id;

  const surveys = await db.survey.findMany({
    where,
    select: {
      id: true,
      titleAr: true,
      stage: true,
      _count: { select: { responses: { where: { status: "SUBMITTED" } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return {
    ok: true,
    data: surveys.map((survey) => ({
      surveyId: survey.id,
      surveyTitle: survey.titleAr,
      stage: survey.stage ?? "",
      submittedCount: survey._count.responses,
      hasComparisonData: survey._count.responses > 0,
    })),
  };
}

export async function getPlatformImpactStats(
  ctx: SurveyActor
): Promise<SurveyResult<PlatformImpactStats>> {
  if (!canViewPlatformImpact(ctx.role)) {
    return surveyFail("إحصاءات المنصة متاحة لمدير المنصة فقط", "FORBIDDEN");
  }

  const schools = await db.school.findMany({
    where: { isActive: true },
    select: { id: true, nameAr: true },
    orderBy: { nameAr: "asc" },
    take: IMPACT_SCHOOLS_LIMIT,
  });

  const rows: PlatformSchoolImpactRow[] = [];
  let surveysTotal = 0;
  let responsesTotal = 0;
  let followUpsTotal = 0;
  let completedTotal = 0;

  for (const school of schools) {
    const [surveysCount, submittedResponses, followUpsCount, completedFollowUps] = await Promise.all([
      db.survey.count({ where: { schoolId: school.id } }),
      db.surveyResponse.count({ where: { schoolId: school.id, status: "SUBMITTED" } }),
      db.followUp.count({ where: { schoolId: school.id } }),
      db.followUp.count({ where: { schoolId: school.id, status: "COMPLETED" } }),
    ]);
    rows.push({
      schoolId: school.id,
      schoolName: school.nameAr,
      surveysCount,
      submittedResponses,
      followUpsCount,
      completedFollowUps,
    });
    surveysTotal += surveysCount;
    responsesTotal += submittedResponses;
    followUpsTotal += followUpsCount;
    completedTotal += completedFollowUps;
  }

  return {
    ok: true,
    data: {
      schools: rows,
      totals: {
        schools: schools.length,
        surveys: surveysTotal,
        submittedResponses: responsesTotal,
        followUps: followUpsTotal,
        completedFollowUps: completedTotal,
      },
    },
  };
}
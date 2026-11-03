import { notFound, redirect } from "next/navigation";

import { TakeAssessment } from "@/components/assessments/take-assessment";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";
import { getAssessmentForTaking } from "@/lib/assessment/service";
import { db } from "@/lib/db";

export const metadata = {
  title: "أداء الاختبار",
};

/**
 * The live attempt screen. Guards (server-side): signed-in owner with an
 * IN_PROGRESS attempt for a PUBLISHED assessment — otherwise the teacher
 * is bounced to the honest state on the detail page. No answer keys are
 * ever loaded into this view.
 */
export default async function TakeAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const viewer = { id: user.id, role: user.role, schoolId: user.schoolId };

  const detail = await getAssessmentForTaking(viewer, id);
  if (!detail.ok) {
    if (detail.code === "NOT_FOUND") notFound();
    redirect(`/assessments/${id}`);
  }
  const { activeAttempt } = detail.data;
  if (!activeAttempt) {
    redirect(`/assessments/${id}`);
  }

  // Load the attempt WITH its assessment + questions — the teacher's own
  // IN_PROGRESS attempt only (ownership checked again here).
  const attempt = await db.assessmentAttempt.findUnique({
    where: { id: activeAttempt.id },
    include: {
      assessment: {
        select: {
          id: true,
          titleAr: true,
          titleEn: true,
          instructionsAr: true,
          instructionsEn: true,
          timeLimitMinutes: true,
          maxScore: true,
          passingScore: true,
          status: true,
          questions: {
            orderBy: { orderIndex: "asc" },
            select: {
              id: true,
              type: true,
              textAr: true,
              textEn: true,
              points: true,
              isRequired: true,
              optionsJson: true,
              // answerKeyJson + explanation are DELIBERATELY omitted —
              // they must never reach the browser before submission.
            },
          },
        },
      },
    },
  });

  if (
    !attempt ||
    attempt.userId !== user.id ||
    attempt.status !== "IN_PROGRESS" ||
    attempt.assessment.status !== "PUBLISHED"
  ) {
    redirect(`/assessments/${id}`);
  }

  const savedAnswers = attempt.answersJson
    ? (JSON.parse(attempt.answersJson) as { questionId: string }[])
    : [];

  return (
    <div>
      <PageHeader
        title={attempt.assessment.titleAr}
        description="أجب عن الأسئلة ثم راجع إجاباتك قبل التسليم النهائي."
        breadcrumbs={[
          { label: "الاختبارات والتقييم", href: "/assessments" },
          { label: attempt.assessment.titleAr, href: `/assessments/${id}` },
          { label: "أداء الاختبار" },
        ]}
      />

      <TakeAssessment
        view={{
          attempt: {
            id: attempt.id,
            startedAt: attempt.startedAt,
            deadlineAt: attempt.deadlineAt,
            assessmentId: attempt.assessment.id,
          },
          assessment: {
            id: attempt.assessment.id,
            titleAr: attempt.assessment.titleAr,
            titleEn: attempt.assessment.titleEn,
            instructionsAr: attempt.assessment.instructionsAr,
            instructionsEn: attempt.assessment.instructionsEn,
            timeLimitMinutes: attempt.assessment.timeLimitMinutes,
            maxScore: attempt.assessment.maxScore,
            passingScore: attempt.assessment.passingScore,
          },
          questions: attempt.assessment.questions.map((question) => ({
            id: question.id,
            type: question.type,
            textAr: question.textAr,
            textEn: question.textEn,
            points: question.points,
            isRequired: question.isRequired,
            options: question.optionsJson
              ? (JSON.parse(question.optionsJson) as { id: string; textAr: string }[])
              : [],
          })),
          savedAnswers,
        }}
      />
    </div>
  );
}
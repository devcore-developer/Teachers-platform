import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";

import { AssessmentsEditor } from "@/app/supervision/assessments/[assessmentId]/assessments-editor";
import { db } from "@/lib/db";
import {
  listSupervisorImpactCourseOptions,
  requireSupervisorContext,
} from "@/lib/supervision/training";

export const metadata = { title: "إدارة أسئلة الاختبار" };

interface QuestionRow {
  id: string;
  type: string;
  textAr: string;
  points: number;
  isRequired: boolean;
  orderIndex: number;
  options: Array<{ id: string; textAr: string }>;
  explanation: string | null;
}

/**
 * Supervisor question editor. Scope: the assessment must belong to the
 * supervisor's school — verified here BEFORE anything renders, and
 * again inside every mutation service call.
 */
export default async function SupervisorAssessmentEditorPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  const ctx = await requireSupervisorContext();

  const assessment = await db.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      titleAr: true,
      instructionsAr: true,
      status: true,
      schoolId: true,
      courseId: true,
      passingScore: true,
      timeLimitMinutes: true,
      attemptLimit: true,
      maxScore: true,
      questions: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          type: true,
          textAr: true,
          points: true,
          isRequired: true,
          orderIndex: true,
          optionsJson: true,
          explanation: true,
        },
      },
    },
  });

  const notAllowed =
    !assessment ||
    assessment.schoolId === null ||
    assessment.schoolId !== ctx.schoolId;

  if (notAllowed) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-8 text-center">
        <TriangleAlert className="mx-auto size-8 text-destructive" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-black text-foreground">الاختبار غير متاح</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          الاختبار غير موجود أو خارج نطاق مدرستك.
        </p>
        <Link
          href="/supervision/assessments"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
          العودة إلى الاختبارات
        </Link>
      </div>
    );
  }

  const courseOptions = await listSupervisorImpactCourseOptions(ctx);

  const questions: QuestionRow[] = assessment.questions.map((question) => {
    let options: Array<{ id: string; textAr: string }> = [];
    if (question.optionsJson) {
      try {
        const parsed = JSON.parse(question.optionsJson) as Array<{
          id?: unknown;
          textAr?: unknown;
        }>;
        options = Array.isArray(parsed)
          ? parsed.filter(
              (item): item is { id: string; textAr: string } =>
                typeof item?.id === "string" && typeof item?.textAr === "string"
            )
          : [];
      } catch {
        options = [];
      }
    }
    return {
      id: question.id,
      type: question.type,
      textAr: question.textAr,
      points: question.points,
      isRequired: question.isRequired,
      orderIndex: question.orderIndex,
      options,
      explanation: question.explanation,
    };
  });

  return (
    <AssessmentsEditor
      assessment={{
        id: assessment.id,
        titleAr: assessment.titleAr,
        instructionsAr: assessment.instructionsAr,
        status: assessment.status,
        courseId: assessment.courseId,
        passingScore: assessment.passingScore,
        timeLimitMinutes: assessment.timeLimitMinutes,
        attemptLimit: assessment.attemptLimit,
        maxScore: assessment.maxScore,
      }}
      questions={questions}
      courses={courseOptions.map((course) => ({ id: course.id, titleAr: course.titleAr }))}
    />
  );
}
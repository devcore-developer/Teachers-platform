import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ClipboardCheck,
  Clock,
  FileQuestion,
  ListChecks,
  PencilLine,
  Target,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { AssessmentForm } from "@/components/assessments/assessment-form";
import { AssessmentPublishControls } from "@/components/assessments/assessment-publish-controls";
import { AttemptReviewForm } from "@/components/assessments/attempt-review-form";
import { QuestionBuilder } from "@/components/assessments/question-builder";
import { EmptyState } from "@/components/platform/empty-state";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import {
  attemptStatusLabel,
  attemptStatusTone,
  assessmentStatusLabel,
  questionTypeLabel,
} from "@/config/assessment";
import {
  getAssessmentForManage,
  listAttemptsForManage,
} from "@/lib/assessment/service";
import { listCourseOptions } from "@/lib/assessment/service";
import { listSchools } from "@/lib/schools/service";

export const metadata = {
  title: "بناء الاختبار",
};

const dateFormatter = new Intl.DateTimeFormat("ar", { dateStyle: "medium" });

/**
 * Phase 6 — assessment editor: settings, questions, publish controls,
 * pre-publication preview (manager sees the answer key here — the ONLY
 * place it is rendered), statistics and the attempts table with the
 * manual-review panels for short-answer submissions.
 */
export default async function AssessmentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireAdminContext();
  const { id } = await params;

  const result = await getAssessmentForManage(ctx, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm font-semibold text-destructive"
      >
        {result.message}
      </div>
    );
  }

  const { assessment, questions, stats } = result.data;
  const attemptsResult = await listAttemptsForManage(ctx, id);
  const attempts = attemptsResult.ok ? attemptsResult.data : [];

  const [courseOptions, schools] = await Promise.all([
    listCourseOptions(ctx),
    ctx.role === "SUPER_ADMIN" ? listSchools() : Promise.resolve([]),
  ]);

  const statTiles = [
    {
      id: "attempts",
      label: "إجمالي المحاولات",
      value: stats.attemptsTotal,
      icon: Users,
    },
    {
      id: "passed",
      label: "ناجح",
      value: stats.passedCount,
      icon: ClipboardCheck,
    },
    {
      id: "failed",
      label: "غير مجتاز",
      value: stats.failedCount,
      icon: FileQuestion,
    },
    {
      id: "review",
      label: "بانتظار المراجعة",
      value: stats.needsReviewCount,
      icon: PencilLine,
    },
    {
      id: "avg",
      label: "متوسط النتائج",
      value: stats.avgPercentage === null ? "—" : `${stats.avgPercentage}%`,
      icon: Target,
    },
    {
      id: "pass-rate",
      label: "معدل النجاح",
      value: stats.passRate === null ? "—" : `${stats.passRate}%`,
      icon: ListChecks,
    },
  ];

  return (
    <div>
      <PageHeader
        title={assessment.titleAr}
        description="إعدادات الاختبار والأسئلة والنشر — والمعاينة تعرضه كما يراه المعلم."
        breadcrumbs={[
          { label: "الاختبارات والتقييم" },
          { label: "إدارة الاختبارات", href: "/assessments/manage" },
          { label: assessment.titleAr },
        ]}
        meta={
          <>
            <StatusBadge
              tone={
                assessment.status === "PUBLISHED"
                  ? "success"
                  : assessment.status === "ARCHIVED"
                    ? "neutral"
                    : "warning"
              }
            >
              {assessmentStatusLabel(assessment.status)}
            </StatusBadge>
            <span className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">
              {questions.length} سؤال · {assessment.maxScore} نقطة
            </span>
            {assessment.timeLimitMinutes && (
              <span className="inline-flex items-center gap-1 rounded-full bg-card px-3 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">
                <Clock className="size-3.5" aria-hidden="true" />
                {assessment.timeLimitMinutes} دقيقة
              </span>
            )}
          </>
        }
        actions={<AssessmentPublishControls assessmentId={assessment.id} status={assessment.status} />}
      />

      <div className="space-y-6">
        {/* Stats */}
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
          role="list"
          aria-label="إحصاءات الاختبار"
        >
          {statTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <div
                key={tile.id}
                role="listitem"
                className="rounded-xl border bg-card p-3.5"
              >
                <span className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {tile.label}
                </span>
                <span className="mt-1 block text-xl font-extrabold tabular-nums text-foreground">
                  {tile.value}
                </span>
              </div>
            );
          })}
        </div>

        {/* Settings */}
        <SectionCard
          title="إعدادات الاختبار"
          description={
            assessment.status === "PUBLISHED"
              ? "التعديلات تؤثر على المحاولات الجديدة فقط."
              : undefined
          }
        >
          <AssessmentForm
            mode="edit"
            assessmentId={assessment.id}
            initialValues={{
              titleAr: assessment.titleAr,
              titleEn: assessment.titleEn ?? "",
              instructionsAr: assessment.instructionsAr,
              instructionsEn: assessment.instructionsEn ?? "",
              courseId: assessment.courseId ?? "",
              passingScore: String(assessment.passingScore),
              timeLimitMinutes: assessment.timeLimitMinutes
                ? String(assessment.timeLimitMinutes)
                : "",
              attemptLimit: assessment.attemptLimit
                ? String(assessment.attemptLimit)
                : "",
              availableFrom: assessment.availableFrom
                ? assessment.availableFrom.toISOString()
                : "",
              availableUntil: assessment.availableUntil
                ? assessment.availableUntil.toISOString()
                : "",
            }}
            courseOptions={courseOptions.map((course) => ({
              id: course.id,
              titleAr: course.titleAr,
              schoolId: course.schoolId,
            }))}
            schoolOptions={schools.map((school) => ({
              id: school.id,
              nameAr: school.nameAr,
            }))}
            isSuperAdmin={ctx.role === "SUPER_ADMIN"}
            lockedTenancy={{
              scope: assessment.schoolId === null ? "platform" : "school",
              schoolName: assessment.schoolName,
            }}
          />
        </SectionCard>

        {/* Questions */}
        <SectionCard
          title="الأسئلة"
          description={`أضف وعدّل وأعد ترتيب الأسئلة — مجموع الدرجات الحالي ${assessment.maxScore} نقطة ودرجة النجاح ${assessment.passingScore}.`}
        >
          <QuestionBuilder
            assessmentId={assessment.id}
            status={assessment.status}
            questions={questions}
          />
        </SectionCard>

        {/* Preview (manager-only: renders the answer key) */}
        <SectionCard
          title="معاينة الاختبار"
          description="كما يراه المعلم — مع تمييز الإجابات الصحيحة للمدير فقط. لا تُرسل مفاتيح الإجابة للمتصفح قبل التسليم أبدًا."
        >
          {questions.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="لا توجد أسئلة للمعاينة بعد"
              description="أضف سؤالًا واحدًا على الأقل — النشر يتطلب سؤالًا واحدًا على الأقل."
              className="border-0 bg-transparent"
            />
          ) : (
            <ol className="space-y-4" role="list">
              {questions.map((question, index) => (
                <li key={question.id} className="rounded-lg border p-4">
                  <p className="text-sm font-bold text-foreground">
                    {index + 1}. {question.textAr}{" "}
                    <span className="text-[11px] font-bold text-muted-foreground">
                      ({question.points} نقاط — {questionTypeLabel(question.type)})
                    </span>
                  </p>
                  {"optionId" in (question.answerKey ?? {}) ||
                  "optionIds" in (question.answerKey ?? {}) ? (
                    <ul className="mt-2 space-y-1" role="list">
                      {question.options.map((option) => {
                        const key = question.answerKey;
                        const isCorrect =
                          (key && "optionId" in key && key.optionId === option.id) ||
                          (key && "optionIds" in key && key.optionIds.includes(option.id));
                        return (
                          <li
                            key={option.id}
                            className={`text-xs ${isCorrect ? "font-bold text-success" : "text-muted-foreground"}`}
                          >
                            {isCorrect ? "✓ " : "• "}
                            {option.textAr}
                          </li>
                        );
                      })}
                    </ul>
                  ) : question.answerKey && "value" in question.answerKey ? (
                    <p className="mt-2 text-xs font-bold text-success">
                      الإجابة الصحيحة: {question.answerKey.value ? "صح" : "خطأ"}
                    </p>
                  ) : null}
                  {question.explanation && (
                    <p className="mt-2 rounded-md bg-info-soft px-3 py-1.5 text-[11px] text-info">
                      {question.explanation}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </SectionCard>

        {/* Attempts + review */}
        <SectionCard
          title="محاولات المعلمين ونتائجهم"
          description="أحدث 50 محاولة — محاولات الإجابة القصيرة تظهر بلوحة مراجعة لحتى تُعتمد درجتها."
        >
          {attempts.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="لا توجد محاولات بعد"
              description="ستظهر المحاولات هنا بعد نشر الاختبار وبدء المعلمين بأدائه."
              className="border-0 bg-transparent"
            />
          ) : (
            <ul className="space-y-3" role="list">
              {attempts.map((attempt) => (
                <li key={attempt.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground">
                        {attempt.userName}
                      </p>
                      <p className="text-[11px] text-muted-foreground" dir="ltr">
                        {attempt.userEmail}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={attemptStatusTone(attempt.status)}>
                        {attemptStatusLabel(attempt.status)}
                      </StatusBadge>
                      {attempt.percentage !== null && (
                        <span className="text-xs font-extrabold tabular-nums text-foreground">
                          {attempt.earnedScore ?? attempt.objectiveScore}/
                          {attempt.maxScore} ({attempt.percentage}%)
                        </span>
                      )}
                      {attempt.submittedAt && (
                        <span className="text-[11px] text-muted-foreground">
                          {dateFormatter.format(attempt.submittedAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  {attempt.status === "NEEDS_REVIEW" &&
                    attempt.shortAnswers.length > 0 && (
                      <div className="mt-3 border-t pt-3">
                        <AttemptReviewForm
                          attemptId={attempt.id}
                          shortAnswers={attempt.shortAnswers}
                        />
                      </div>
                    )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <div>
          <Link
            href="/assessments/manage"
            className="text-xs font-bold text-brand-700 hover:underline"
          >
            العودة إلى قائمة الاختبارات
          </Link>
        </div>
      </div>
    </div>
  );
}
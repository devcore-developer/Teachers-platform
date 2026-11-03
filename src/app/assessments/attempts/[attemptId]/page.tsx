import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  Clock,
  Target,
  XCircle,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { requireUser } from "@/lib/auth/session";
import {
  attemptStatusLabel,
  attemptStatusTone,
  questionTypeLabel,
  TRUE_FALSE_LABELS,
} from "@/config/assessment";
import { getAttemptResult } from "@/lib/assessment/service";

export const metadata = {
  title: "نتيجة المحاولة",
};

const dateFormatter = new Intl.DateTimeFormat("ar", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Attempt result for the OWNER only (service enforces it). Correct
 * answers + explanations are revealed after submission; short-answer
 * questions show their explicit awaiting-review state until the
 * manager's review finalizes the grade.
 */
export default async function AttemptResultPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const user = await requireUser();
  const { attemptId } = await params;

  const result = await getAttemptResult(
    { id: user.id, role: user.role, schoolId: user.schoolId },
    attemptId
  );
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return (
      <div>
        <PageHeader
          title="نتيجة المحاولة"
          breadcrumbs={[{ label: "الاختبارات والتقييم", href: "/assessments" }, { label: "النتيجة" }]}
        />
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm font-semibold text-destructive"
        >
          {result.message}
        </div>
      </div>
    );
  }

  const { attempt, assessment, breakdown } = result.data;
  const revealed = attempt.status !== "EXPIRED";

  return (
    <div>
      <PageHeader
        title={`نتيجة محاولتك — ${assessment.titleAr}`}
        description="تفصيل درجاتك لكل سؤال مع التغذية الراجعة."
        breadcrumbs={[
          { label: "الاختبارات والتقييم", href: "/assessments" },
          { label: assessment.titleAr, href: `/assessments/${assessment.id}` },
          { label: "النتيجة" },
        ]}
        meta={
          <StatusBadge tone={attemptStatusTone(attempt.status)}>
            {attemptStatusLabel(attempt.status)}
          </StatusBadge>
        }
      />

      <div className="space-y-6">
        {/* Score summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-3.5">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <Target className="size-3.5" aria-hidden="true" />
              الدرجة
            </span>
            <span className="mt-1 block text-lg font-extrabold tabular-nums">
              {attempt.status === "EXPIRED"
                ? "—"
                : attempt.earnedScore === null
                  ? "بانتظار المراجعة"
                  : `${attempt.earnedScore} / ${attempt.maxScore}`}
            </span>
          </div>
          <div className="rounded-xl border bg-card p-3.5">
            <span className="text-[11px] font-bold text-muted-foreground">النسبة</span>
            <span className="mt-1 block text-lg font-extrabold tabular-nums">
              {attempt.percentage === null ? "—" : `${attempt.percentage}%`}
            </span>
          </div>
          <div className="rounded-xl border bg-card p-3.5">
            <span className="text-[11px] font-bold text-muted-foreground">درجة النجاح</span>
            <span className="mt-1 block text-lg font-extrabold tabular-nums">
              {assessment.passingScore}
            </span>
          </div>
          <div className="rounded-xl border bg-card p-3.5">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <Clock className="size-3.5" aria-hidden="true" />
              التسليم
            </span>
            <span className="mt-1 block text-xs font-bold">
              {attempt.submittedAt
                ? dateFormatter.format(attempt.submittedAt)
                : attempt.status === "EXPIRED"
                  ? "انتهى الوقت دون تسليم"
                  : "—"}
            </span>
          </div>
        </div>

        {attempt.status === "NEEDS_REVIEW" && (
          <div className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
            أسئلة الإجابة القصيرة في محاولتك تُراجع يدويًا — ستُعتمد النتيجة النهائية بعد
            اطلاع المشرف عليها.
          </div>
        )}

        {/* Per-question breakdown */}
        <SectionCard
          title="تفصيل الأسئلة"
          description={
            revealed
              ? "الإجابات الصحيحة والتغذية الراجعة ظاهرة لأن المحاولة سُلّمت."
              : "المحاولة انتهت بالوقت دون تسليم — تُعرض إجاباتك المحفوظة فقط دون المفاتيح."
          }
        >
          <ol className="space-y-4" role="list">
            {breakdown.map((item, index) => (
              <li key={item.questionId} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-bold text-foreground">
                    {index + 1}. {item.textAr}
                  </p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                    {item.points} نقاط · {questionTypeLabel(item.type)}
                  </span>
                </div>

                {/* Your answer */}
                <div className="mt-2 text-xs">
                  <span className="font-bold text-muted-foreground">إجابتك: </span>
                  {item.yourAnswer === null ? (
                    <span className="text-muted-foreground">— بدون إجابة —</span>
                  ) : item.yourAnswer.optionTexts.length > 0 ? (
                    <span className="font-semibold">{item.yourAnswer.optionTexts.join("، ")}</span>
                  ) : item.yourAnswer.bool !== null ? (
                    <span className="font-semibold">
                      {item.yourAnswer.bool ? TRUE_FALSE_LABELS.true : TRUE_FALSE_LABELS.false}
                    </span>
                  ) : (
                    <span className="font-semibold whitespace-pre-wrap">
                      {item.yourAnswer.text || "— نص فارغ —"}
                    </span>
                  )}
                </div>

                {/* Correct answer + points (after submission) */}
                {revealed && item.correct && (
                  <div className="mt-2 space-y-1 text-xs">
                    <span className="font-bold text-muted-foreground">الإجابة الصحيحة: </span>
                    {item.correct.optionTexts.length > 0 ? (
                      <span className="font-semibold text-success">
                        {item.correct.optionTexts.join("، ")}
                      </span>
                    ) : item.correct.bool !== null ? (
                      <span className="font-semibold text-success">
                        {item.correct.bool ? TRUE_FALSE_LABELS.true : TRUE_FALSE_LABELS.false}
                      </span>
                    ) : item.correct.modelAnswer ? (
                      <span className="font-semibold text-success whitespace-pre-wrap">
                        {item.correct.modelAnswer}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">تُحدَّد في المراجعة اليدوية</span>
                    )}

                    <p className="flex items-center gap-1.5 font-bold">
                      {item.isCorrect === true && (
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-3.5" aria-hidden="true" />
                          إجابة صحيحة
                        </span>
                      )}
                      {item.isCorrect === false && (
                        <span className="flex items-center gap-1 text-error">
                          <XCircle className="size-3.5" aria-hidden="true" />
                          إجابة غير صحيحة
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        النقاط:{" "}
                        {item.type === "SHORT_ANSWER"
                          ? item.earnedPoints === null
                            ? "بانتظار المراجعة"
                            : item.earnedPoints
                          : item.earnedPoints ?? 0}
                        {" / "}
                        {item.points}
                      </span>
                    </p>
                  </div>
                )}

                {item.explanation && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-md bg-info-soft px-3 py-2 text-[11px] text-info">
                    <Circle className="mt-0.5 size-2 shrink-0" aria-hidden="true" />
                    {item.explanation}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </SectionCard>

        <div className="flex gap-4">
          <Link
            href="/assessments"
            className="text-xs font-bold text-brand-700 hover:underline"
          >
            قائمة الاختبارات
          </Link>
          <Link
            href={`/assessments/${assessment.id}`}
            className="text-xs font-bold text-muted-foreground hover:underline"
          >
            صفحة الاختبار
          </Link>
        </div>
      </div>
    </div>
  );
}
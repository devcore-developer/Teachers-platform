"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  ListChecks,
  Save,
  Send,
} from "lucide-react";

import {
  saveDraftAction,
  submitAttemptAction,
  type AssessmentFormState,
} from "@/app/actions/assessment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TRUE_FALSE_LABELS } from "@/config/assessment";
import type { TakeAttemptView } from "@/lib/assessment/service";

/* ------------------------------------------------------------------ */
/* Teacher attempt UI: one question per screen, numbered navigation,    */
/* per-type inputs (RTL, keyboard accessible), debounced server-side    */
/* draft autosave, and a countdown for timed assessments.               */
/*                                                                      */
/* SECURITY: the deadline is enforced by the SERVER on submit — this    */
/* timer is a courtesy display only. No answer keys exist in this       */
/* component (they never cross the RSC boundary before submission).     */
/* ------------------------------------------------------------------ */

type AnswerEntry = { choice?: string[]; bool?: boolean; text?: string };

interface TakeAssessmentProps {
  view: TakeAttemptView;
}

export function TakeAssessment({ view }: TakeAssessmentProps) {
  const router = useRouter();
  const { attempt, assessment, questions } = view;

  const [answers, setAnswers] = React.useState<Record<string, AnswerEntry>>(
    () => {
      const initial: Record<string, AnswerEntry> = {};
      for (const answer of view.savedAnswers) {
        initial[answer.questionId] = {
          choice: answer.choice,
          bool: answer.bool,
          text: answer.text,
        };
      }
      return initial;
    }
  );
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [showReview, setShowReview] = React.useState(false);
  const [draftSavedAt, setDraftSavedAt] = React.useState<string | null>(null);
  const [remaining, setRemaining] = React.useState<number | null>(null);
  const autoSubmittedRef = React.useRef(false);

  const [submitState, submitFormAction] = React.useActionState<
    AssessmentFormState | null,
    FormData
  >(submitAttemptAction, null);
  const [, saveFormAction] = React.useActionState<
    AssessmentFormState | null,
    FormData
  >(saveDraftAction, null);
  const [isSaving, startSaving] = React.useTransition();

  const answersJson = React.useMemo(
    () =>
      JSON.stringify(
        questions.map((question) => ({
          questionId: question.id,
          ...(answers[question.id] ?? {}),
        }))
      ),
    [answers, questions]
  );
  const answersJsonRef = React.useRef(answersJson);
  answersJsonRef.current = answersJson;

  /* Countdown (cosmetic — the server enforces the real deadline). */
  React.useEffect(() => {
    if (!attempt.deadlineAt) return;
    const deadline = new Date(attempt.deadlineAt).getTime();
    function tick() {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(left);
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [attempt.deadlineAt]);

  /* Debounced server-side draft autosave. */
  const firstRenderRef = React.useRef(true);
  React.useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      const formData = new FormData();
      formData.set("attemptId", attempt.id);
      formData.set("answersJson", answersJsonRef.current);
      startSaving(async () => {
        await saveFormAction(formData);
        setDraftSavedAt(
          new Intl.DateTimeFormat("ar", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(new Date())
        );
      });
    }, 2500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  /* Auto-submit exactly once when the countdown reaches zero. */
  React.useEffect(() => {
    if (remaining === null || remaining > 0 || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    const formData = new FormData();
    formData.set("attemptId", attempt.id);
    formData.set("answersJson", answersJsonRef.current);
    startSaving(async () => {
      await submitFormAction(formData);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const current = questions[currentIndex];
  const unansweredRequired = questions.filter((question) => {
    const answer = answers[question.id];
    if (!question.isRequired) return false;
    if (!answer) return true;
    if (question.type === "SINGLE_CHOICE") return !answer.choice?.length;
    if (question.type === "MULTIPLE_CHOICE") return !answer.choice?.length;
    if (question.type === "TRUE_FALSE") return answer.bool === undefined;
    return !(answer.text ?? "").trim();
  });

  function setAnswer(questionId: string, entry: AnswerEntry) {
    setAnswers((current) => ({ ...current, [questionId]: entry }));
  }

  const minutes = remaining === null ? null : Math.floor(remaining / 60);
  const seconds = remaining === null ? null : remaining % 60;

  return (
    <div className="space-y-5">
      {/* Header card: timer + progress + draft indicator */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <ListChecks className="size-4 text-brand-600" aria-hidden="true" />
          السؤال {currentIndex + 1} من {questions.length}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isSaving ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <Save className="size-3.5 animate-pulse" aria-hidden="true" />
              جارٍ حفظ المسودة…
            </span>
          ) : draftSavedAt ? (
            <span className="text-[11px] font-semibold text-success">
              حُفظت المسودة {draftSavedAt}
            </span>
          ) : null}
          {remaining !== null && (
            <span
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-extrabold tabular-nums ${
                remaining <= 60
                  ? "bg-error-soft text-error"
                  : "bg-brand-50 text-brand-700"
              }`}
              role="timer"
              aria-label="الوقت المتبقي"
            >
              <Clock className="size-4" aria-hidden="true" />
              {minutes}:{String(seconds).padStart(2, "0")}
            </span>
          )}
        </div>
      </div>

      {submitState?.message && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertDescription>
            {submitState.message}
            {submitState.message.includes("وقت") && (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 ps-2 text-xs"
                onClick={() => router.push(`/assessments/${assessment.id}`)}
              >
                العودة إلى الاختبار
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Question navigation grid */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="التنقل بين الأسئلة">
        {questions.map((question, index) => {
          const answered =
            question.type === "TRUE_FALSE"
              ? answers[question.id]?.bool !== undefined
              : question.type === "SHORT_ANSWER"
                ? Boolean(answers[question.id]?.text?.trim())
                : Boolean(answers[question.id]?.choice?.length);
          return (
            <button
              key={question.id}
              type="button"
              role="tab"
              aria-selected={index === currentIndex}
              onClick={() => setCurrentIndex(index)}
              className={`size-9 rounded-lg text-xs font-extrabold tabular-nums transition-colors ${
                index === currentIndex
                  ? "bg-brand-600 text-white"
                  : answered
                    ? "bg-success-soft text-success"
                    : "border bg-card text-muted-foreground hover:bg-accent"
              }`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      {/* Current question */}
      {current && (
        <div className="rounded-xl border bg-card p-5" role="tabpanel">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-muted-foreground">
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-brand-700">
              {current.points} نقاط
            </span>
            {current.isRequired && <span>إجابة إلزامية</span>}
          </div>
          <p className="text-base font-bold leading-relaxed text-foreground">
            {current.textAr}
          </p>
          {current.textEn && (
            <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
              {current.textEn}
            </p>
          )}

          <div className="mt-5">
            <QuestionInput
              question={current}
              value={answers[current.id] ?? {}}
              onChange={(entry) => setAnswer(current.id, entry)}
            />
          </div>
        </div>
      )}

      {/* Navigation + submit */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
          السابق
        </Button>

        {currentIndex < questions.length - 1 ? (
          <Button
            type="button"
            onClick={() =>
              setCurrentIndex((value) => Math.min(questions.length - 1, value + 1))
            }
          >
            التالي
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button type="button" onClick={() => setShowReview(true)}>
            <Send className="size-4" aria-hidden="true" />
            مراجعة وتسليم
          </Button>
        )}
      </div>

      {/* Review-before-submit modal */}
      {showReview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="مراجعة الإجابات قبل التسليم"
        >
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-5 shadow-lg">
            <h2 className="text-base font-extrabold text-foreground">
              مراجعة نهائية قبل التسليم
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              بعد التسليم لا يمكن تعديل الإجابات أو إعادة هذه المحاولة.
            </p>

            {unansweredRequired.length > 0 && (
              <Alert variant="destructive" className="mt-3">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertDescription>
                  لديك {unansweredRequired.length}{" "}
                  {unansweredRequired.length === 1 ? "سؤال إلزامي" : "أسئلة إلزامية"}{" "}
                  بدون إجابة:{" "}
                  {unansweredRequired.map((question, index) => (
                    <button
                      key={question.id}
                      type="button"
                      className="font-bold underline"
                      onClick={() => {
                        setCurrentIndex(questions.indexOf(question));
                        setShowReview(false);
                      }}
                    >
                      رقم {questions.indexOf(question) + 1}
                      {index < unansweredRequired.length - 1 ? "، " : ""}
                    </button>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {/* The real submission form — hidden payload updated at submit. */}
            <form action={submitFormAction} className="mt-4 space-y-3">
              <input type="hidden" name="attemptId" value={attempt.id} />
              <input
                type="hidden"
                name="answersJson"
                value={answersJson}
                ref={(node) => {
                  if (node) node.value = answersJsonRef.current;
                }}
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowReview(false)}
                >
                  متابعة الحل
                </Button>
                <Button type="submit" disabled={isSaving}>
                  <Send className="size-4" aria-hidden="true" />
                  {isSaving ? "جارٍ التسليم…" : "تسليم المحاولة نهائيًا"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------- Per-type input -------------------------- */

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: TakeAttemptView["questions"][number];
  value: AnswerEntry;
  onChange: (entry: AnswerEntry) => void;
}) {
  if (question.type === "SINGLE_CHOICE") {
    return (
      <div className="space-y-2" role="radiogroup" aria-label="خيارات السؤال">
        {question.options.map((option, index) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors hover:bg-accent has-[input:checked]:border-brand-600 has-[input:checked]:bg-brand-50"
          >
            <input
              type="radio"
              name={`q-${question.id}`}
              checked={value.choice?.[0] === option.id}
              onChange={() => onChange({ choice: [option.id] })}
              className="size-4 shrink-0 accent-[#1D5BD6]"
            />
            <span className="font-semibold">{option.textAr}</span>
            <span className="ms-auto text-[10px] text-muted-foreground" aria-hidden="true">
              {index + 1}
            </span>
          </label>
        ))}
      </div>
    );
  }

  if (question.type === "MULTIPLE_CHOICE") {
    const selected = new Set(value.choice ?? []);
    function toggle(optionId: string, checked: boolean) {
      const next = new Set(selected);
      if (checked) next.add(optionId);
      else next.delete(optionId);
      onChange({ choice: [...next] });
    }
    return (
      <div className="space-y-2">
        {question.options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors hover:bg-accent has-[input:checked]:border-brand-600 has-[input:checked]:bg-brand-50"
          >
            <input
              type="checkbox"
              checked={selected.has(option.id)}
              onChange={(event) => toggle(option.id, event.target.checked)}
              className="size-4 shrink-0 accent-[#1D5BD6]"
            />
            <span className="font-semibold">{option.textAr}</span>
          </label>
        ))}
        <p className="text-[11px] text-muted-foreground">
          اختر كل الإجابات الصحيحة — تُحتسب الدرجة عند تطابق الاختيارات تمامًا.
        </p>
      </div>
    );
  }

  if (question.type === "TRUE_FALSE") {
    return (
      <div className="flex gap-3" role="radiogroup" aria-label="صح أو خطأ">
        {(["true", "false"] as const).map((key) => {
          const boolValue = key === "true";
          return (
            <label
              key={key}
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3.5 py-3 text-sm font-bold transition-colors hover:bg-accent has-[input:checked]:border-brand-600 has-[input:checked]:bg-brand-50"
            >
              <input
                type="radio"
                name={`q-${question.id}`}
                checked={value.bool === boolValue}
                onChange={() => onChange({ bool: boolValue })}
                className="size-4 accent-[#1D5BD6]"
              />
              {TRUE_FALSE_LABELS[key]}
            </label>
          );
        })}
      </div>
    );
  }

  // SHORT_ANSWER
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`answer-${question.id}`} className="text-xs">
        اكتب إجابتك — تُراجع يدويًا بعد التسليم
      </Label>
      <Textarea
        id={`answer-${question.id}`}
        rows={4}
        value={value.text ?? ""}
        onChange={(event) => onChange({ text: event.target.value })}
        maxLength={2000}
      />
    </div>
  );
}
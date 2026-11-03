"use client";

import * as React from "react";
import { ClipboardCheck } from "lucide-react";

import { reviewAttemptAction, type AssessmentFormState } from "@/app/actions/assessment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ReviewShortAnswer {
  questionId: string;
  questionText: string;
  points: number;
  answerText: string;
  modelAnswer: string | null;
}

interface AttemptReviewFormProps {
  attemptId: string;
  shortAnswers: ReviewShortAnswer[];
}

/**
 * Manual grading panel for a NEEDS_REVIEW attempt: shows the teacher's
 * short answers plus the optional model answer, collects per-question
 * points (0..question max) and submits the review — the service layer
 * finalizes the attempt atomically and keeps finalized rows immutable.
 */
export function AttemptReviewForm({
  attemptId,
  shortAnswers,
}: AttemptReviewFormProps) {
  const [state, formAction] = React.useActionState<
    AssessmentFormState | null,
    FormData
  >(reviewAttemptAction, null);

  const [scores, setScores] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(shortAnswers.map((answer) => [answer.questionId, "0"]))
  );

  const scoresJson = JSON.stringify(
    shortAnswers.map((answer) => ({
      questionId: answer.questionId,
      points: Number(scores[answer.questionId] ?? "0"),
    }))
  );

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="attemptId" value={attemptId} />
      <input type="hidden" name="scoresJson" value={scoresJson} />

      {state?.message && (
        <Alert
          variant={state.ok ? "default" : "destructive"}
          role={state.ok ? "status" : "alert"}
        >
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <ul className="space-y-3" role="list">
        {shortAnswers.map((answer, index) => (
          <li key={answer.questionId} className="rounded-lg border bg-background/60 p-3">
            <p className="text-xs font-bold text-foreground">
              {index + 1}. {answer.questionText}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed">
              {answer.answerText || <span className="text-muted-foreground">— بدون إجابة نصية —</span>}
            </p>
            {answer.modelAnswer && (
              <p className="mt-1.5 rounded-md bg-info-soft px-3 py-2 text-[11px] text-info">
                إرشاد المراجع: {answer.modelAnswer}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <label
                htmlFor={`score-${attemptId}-${answer.questionId}`}
                className="text-[11px] font-bold text-muted-foreground"
              >
                الدرجة الممنوحة (0–{answer.points}):
              </label>
              <Input
                id={`score-${attemptId}-${answer.questionId}`}
                type="number"
                min={0}
                max={answer.points}
                dir="ltr"
                value={scores[answer.questionId] ?? "0"}
                onChange={(event) =>
                  setScores((current) => ({
                    ...current,
                    [answer.questionId]: event.target.value,
                  }))
                }
                className="h-8 w-24"
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="flex justify-end">
        <Button type="submit" size="sm">
          <ClipboardCheck className="size-4" aria-hidden="true" />
          اعتماد المراجعة وحساب النتيجة
        </Button>
      </div>
    </form>
  );
}
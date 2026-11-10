"use client";

import { useActionState } from "react";

import {
  submitImpactAction,
  type LearningActionState,
} from "@/app/actions/learning";

/**
 * Batch 1 — قياس أثر التدريب (impact measurement form).
 *
 * Renders the course's published impact tools (the Phase 9 Survey
 * questions migrated from the original HTML impactQuestions) and
 * submits them through the server action — available only after a real
 * course completion, mirroring the original HTML openImpact/submitImpact
 * workflow without any mock state.
 */

interface ImpactQuestion {
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

/** Previously submitted answers keyed by questionId — the HTML
 *  openImpact pre-fill rule: re-opening the form shows the teacher's
 *  earlier answers so re-submitting is an EDIT, not a blind replace. */
const EMPTY_PREVIOUS: Record<string, string> = {};

const initialState: LearningActionState = { ok: false };

const RATING_LABELS: Record<number, string> = {
  1: "ضعيف جدًا",
  2: "ضعيف",
  3: "متوسط",
  4: "جيد",
  5: "مرتفع",
};

export function ImpactForm({
  courseId,
  surveyTitle,
  instructions,
  questions,
  previous = EMPTY_PREVIOUS,
}: {
  courseId: string;
  surveyTitle: string;
  instructions: string | null;
  questions: ImpactQuestion[];
  previous?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(
    submitImpactAction,
    initialState
  );

  if (questions.length === 0) return null;

  return (
    <form action={formAction} className="mt-4 space-y-5">
      <input type="hidden" name="courseId" value={courseId} />
      <p className="text-xs font-semibold text-slate-400">{surveyTitle}</p>
      {instructions && (
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          {instructions}
        </p>
      )}

      {questions.map((question, index) => {
        const error = state.fieldErrors?.[question.id];
        return (
          <fieldset key={question.id} className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-bold text-slate-800">
              {index + 1}. {question.textAr}
              {question.required && <span className="text-red-500"> *</span>}
            </legend>
            {question.helpTextAr && (
              <p className="mt-1 text-xs text-slate-500">{question.helpTextAr}</p>
            )}

            {question.type === "RATING" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Array.from(
                  { length: (question.maxScore ?? 5) - (question.minScore ?? 1) + 1 },
                  (_, i) => (question.minScore ?? 1) + i
                ).map((value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition has-checked:border-[#1D5BD6] has-checked:bg-blue-50 has-checked:text-[#1D5BD6]"
                  >
                    <input
                      type="radio"
                      name={`impact_${question.id}`}
                      value={value}
                      required={question.required}
                      defaultChecked={previous[question.id] === String(value)}
                      className="sr-only"
                    />
                    <span className="text-base font-extrabold">{value}</span>
                    {RATING_LABELS[value] && (
                      <span className="hidden sm:inline">{RATING_LABELS[value]}</span>
                    )}
                  </label>
                ))}
              </div>
            )}

            {question.type === "YES_NO" && (
              <div className="mt-3 flex gap-2">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition has-checked:border-[#1D5BD6] has-checked:bg-blue-50">
                  <input
                    type="radio"
                    name={`impact_${question.id}`}
                    value="1"
                    required={question.required}
                    defaultChecked={previous[question.id] === "1"}
                    className="accent-[#1D5BD6]"
                  />
                  نعم
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition has-checked:border-[#1D5BD6] has-checked:bg-blue-50">
                  <input
                    type="radio"
                    name={`impact_${question.id}`}
                    value="0"
                    required={question.required}
                    defaultChecked={previous[question.id] === "0"}
                    className="accent-[#1D5BD6]"
                  />
                  لا
                </label>
              </div>
            )}

            {(question.type === "SINGLE_CHOICE" || question.type === "MULTI_CHOICE") &&
              question.options && (
                <div className="mt-3 space-y-2">
                  {question.options.map((option) => (
                    <label
                      key={option}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition has-checked:border-[#1D5BD6] has-checked:bg-blue-50"
                    >
                      <input
                        type="radio"
                        name={`impact_${question.id}`}
                        value={option}
                        required={question.required}
                        defaultChecked={previous[question.id] === option}
                        className="accent-[#1D5BD6]"
                      />
                      {option}
                    </label>
                  ))}
                </div>
              )}

            {(question.type === "SHORT_TEXT" || question.type === "TEXT") && (
              <textarea
                name={`impact_${question.id}`}
                rows={3}
                required={question.required}
                maxLength={2000}
                placeholder="اكتب إجابتك هنا…"
                defaultValue={previous[question.id] ?? ""}
                className="mt-3 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
              />
            )}

            {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
          </fieldset>
        );
      })}

      {state.ok && state.message && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
          {state.message}
        </p>
      )}
      {!state.ok && state.message && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1D5BD6] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#174aa8] disabled:opacity-60"
      >
        {pending ? "جارٍ الإرسال…" : "إرسال قياس الأثر"}
      </button>
    </form>
  );
}
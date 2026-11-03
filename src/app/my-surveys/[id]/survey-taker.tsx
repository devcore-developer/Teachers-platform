"use client";

/**
 * Phase 9 — the respondent experience: renders questions by type,
 * validates required answers client-side (mirrored server-side), saves
 * drafts (identified surveys) and submits with a confirmation screen.
 *
 * Server-side validation is the ONLY authority: type, scale bounds and
 * option membership are all re-checked in the service; this component
 * merely prevents obvious mistakes before they hit the wire.
 */
import { useActionState, useMemo, useState } from "react";

import { LIKERT_OPTIONS } from "@/config/surveys";
import {
  saveResponseDraftAction,
  submitResponseAction,
  type SurveyActionState,
} from "@/app/actions/surveys";
import { formatDate } from "@/app/assignments/ui";
import type { SurveyTakeData } from "@/lib/surveys/service";

interface AnswerMap {
  [questionId: string]: {
    valueNumber?: number;
    valueText?: string;
    selectedOptions?: string[];
  };
}

export default function SurveyTaker({ data }: { data: SurveyTakeData }) {
  const { survey, questions, myResponse, alreadySubmitted, duplicateNote } = data;

  const initialAnswers = useMemo<AnswerMap>(() => {
    const map: AnswerMap = {};
    for (const answer of myResponse?.answers ?? []) {
      map[answer.questionId] = {
        valueNumber: answer.valueNumber ?? undefined,
        valueText: answer.valueText ?? undefined,
        selectedOptions: answer.selectedOptions,
      };
    }
    return map;
  }, [myResponse]);

  const [answers, setAnswers] = useState<AnswerMap>(initialAnswers);
  const [clientError, setClientError] = useState<string | null>(null);
  const [submitState, submitFormAction, submitPending] = useActionState<SurveyActionState, FormData>(
    submitResponseAction,
    { ok: false }
  );
  const [draftState, draftFormAction, draftPending] = useActionState<SurveyActionState, FormData>(
    saveResponseDraftAction,
    { ok: false }
  );

  function setAnswer(questionId: string, patch: AnswerMap[string]): void {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } }));
  }

  function buildPayloadJson(): string {
    return JSON.stringify({
      answers: questions.map((question) => {
        const answer = answers[question.id];
        return {
          questionId: question.id,
          valueNumber: answer?.valueNumber ?? null,
          valueText: answer?.valueText ?? "",
          selectedOptions: answer?.selectedOptions ?? [],
        };
      }),
    });
  }

  function validateRequired(): boolean {
    for (const question of questions) {
      if (!question.required) continue;
      const answer = answers[question.id];
      const hasValue =
        answer &&
        ((answer.valueNumber !== undefined && answer.valueNumber !== null) ||
          (answer.valueText !== undefined && answer.valueText!.trim() !== "") ||
          (answer.selectedOptions !== undefined && answer.selectedOptions.length > 0));
      if (!hasValue) {
        setClientError(`السؤال الإلزامي لم يُجب عليه: ${question.textAr}`);
        return false;
      }
    }
    setClientError(null);
    return true;
  }

  /* ------------------------------------------------ Confirmation */
  if (submitState.ok) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">✓</div>
        <h2 className="mb-2 text-lg font-bold text-emerald-800">تم إرسال ردك بنجاح</h2>
        <p className="text-sm text-emerald-700">
          شكرًا لمشاركتك في «{submitState.data?.surveyTitle}» — {formatDate(submitState.data?.submittedAt ? new Date(submitState.data.submittedAt) : null)}
        </p>
        {survey.anonymous ? (
          <p className="mt-3 text-xs text-emerald-600">
            هذا الاستبيان مجهول الهوية: لا يوجد سجل شخصي لردك، ولن يظهر في سجل ردودك.
          </p>
        ) : null}
      </div>
    );
  }

  if (alreadySubmitted) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-2xl text-[#1D5BD6]">✓</div>
        <h2 className="mb-2 text-lg font-bold text-slate-800">أرسلت ردك مسبقًا</h2>
        <p className="text-sm text-slate-500">
          تم تسجيل استجابتك على هذا الاستبيان {myResponse?.submittedAt ? `في ${formatDate(myResponse.submittedAt)}` : ""} — لا يمكن تعديل الرد بعد الإرسال.
        </p>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">{survey.titleAr}</h2>
        {survey.descriptionAr ? (
          <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{survey.descriptionAr}</p>
        ) : null}
        {survey.purposeAr ? <p className="mt-2 text-sm text-slate-600"><strong>الغرض:</strong> {survey.purposeAr}</p> : null}
        {survey.instructionsAr ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{survey.instructionsAr}</p>
        ) : null}
        {survey.anonymous ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            استبيان مجهول الهوية — لا يُربط ردك باسمك إطلاقًا، ولا يدعم الحفظ المؤقت. {duplicateNote ? duplicateNote : null}
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">
            يمكنك حفظ مسودة واستكمالها لاحقًا. بعد الإرسال لا يمكن تعديل الرد.
            {survey.closesAt ? ` — يُغلق: ${formatDate(survey.closesAt)}` : ""}
          </p>
        )}
      </div>

      <form action={submitFormAction} className="space-y-5" onSubmit={validateRequired}>
        <input type="hidden" name="surveyId" value={survey.id} />
        <input type="hidden" name="payloadJson" value={buildPayloadJson()} />

        {clientError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{clientError}</div>
        ) : null}
        {submitState.message ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitState.message}</div>
        ) : null}
        {draftState.ok ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">تم حفظ المسودة.</div>
        ) : null}
        {!draftState.ok && draftState.message ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{draftState.message}</div>
        ) : null}

        <ol className="space-y-5">
          {questions.map((question, index) => {
            const answer = answers[question.id];
            return (
              <li key={question.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-800">
                  {index + 1}. {question.textAr}
                  {question.required ? <span className="mr-1 text-red-500">*</span> : null}
                </p>
                {question.helpTextAr ? <p className="mt-1 text-xs text-slate-500">{question.helpTextAr}</p> : null}

                <div className="mt-3">
                  {question.type === "SINGLE_CHOICE" ? (
                    <div className="space-y-2">
                      {question.options.map((option) => (
                        <label key={option} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                          <input
                            type="radio"
                            name={`q-${question.id}`}
                            checked={answer?.selectedOptions?.[0] === option}
                            onChange={() => setAnswer(question.id, { selectedOptions: [option] })}
                            className="accent-[#1D5BD6]"
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {question.type === "MULTI_CHOICE" ? (
                    <div className="space-y-2">
                      {question.options.map((option) => (
                        <label key={option} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={(answer?.selectedOptions ?? []).includes(option)}
                            onChange={(event) => {
                              const current = answer?.selectedOptions ?? [];
                              setAnswer(question.id, {
                                selectedOptions: event.target.checked
                                  ? [...current, option]
                                  : current.filter((item) => item !== option),
                              });
                            }}
                            className="accent-[#1D5BD6]"
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {question.type === "RATING" ? (
                    <div className="flex flex-wrap gap-2">
                      {Array.from(
                        { length: (question.maxScore ?? 5) - (question.minScore ?? 1) + 1 },
                        (_, i) => (question.minScore ?? 1) + i
                      ).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setAnswer(question.id, { valueNumber: value })}
                          className={`h-10 w-10 rounded-lg border text-sm font-semibold transition ${
                            answer?.valueNumber === value
                              ? "border-[#1D5BD6] bg-[#1D5BD6] text-white"
                              : "border-slate-300 bg-white text-slate-600 hover:border-[#1D5BD6]"
                          }`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {question.type === "LIKERT" ? (
                    <div className="grid gap-2 sm:grid-cols-5">
                      {LIKERT_OPTIONS.map((label, labelIndex) => {
                        const value = 5 - labelIndex;
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() => setAnswer(question.id, { valueNumber: value })}
                            className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                              answer?.valueNumber === value
                                ? "border-[#1D5BD6] bg-[#1D5BD6] text-white"
                                : "border-slate-300 bg-white text-slate-600 hover:border-[#1D5BD6]"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {question.type === "YES_NO" ? (
                    <div className="flex gap-2">
                      {[{ value: 1, label: "نعم" }, { value: 0, label: "لا" }].map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setAnswer(question.id, { valueNumber: item.value })}
                          className={`rounded-lg border px-5 py-2 text-sm font-semibold transition ${
                            answer?.valueNumber === item.value
                              ? "border-[#1D5BD6] bg-[#1D5BD6] text-white"
                              : "border-slate-300 bg-white text-slate-600 hover:border-[#1D5BD6]"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {question.type === "SHORT_TEXT" ? (
                    <input
                      className={inputClass}
                      value={answer?.valueText ?? ""}
                      onChange={(event) => setAnswer(question.id, { valueText: event.target.value })}
                    />
                  ) : null}

                  {question.type === "LONG_TEXT" ? (
                    <textarea
                      className={inputClass}
                      rows={4}
                      value={answer?.valueText ?? ""}
                      onChange={(event) => setAnswer(question.id, { valueText: event.target.value })}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitPending}
            className="rounded-lg bg-[#1D5BD6] px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#174aa8] disabled:opacity-60"
          >
            {submitPending ? "جارٍ الإرسال…" : "إرسال الرد"}
          </button>
          {!survey.anonymous ? (
            <button
              type="submit"
              formAction={draftFormAction}
              disabled={draftPending}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {draftPending ? "جارٍ الحفظ…" : "حفظ مسودة"}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
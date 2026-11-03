"use client";

/**
 * Phase 9 — publish/close/archive buttons for a survey (author or
 * office manager; the server re-checks role + transition validity).
 */
import { useActionState } from "react";

import { transitionSurveyAction, type SurveyActionState } from "@/app/actions/surveys";

export default function SurveyStatusActions({
  surveyId,
  status,
}: {
  surveyId: string;
  status: string;
}) {
  const [state, formAction, pending] = useActionState<SurveyActionState, FormData>(
    transitionSurveyAction,
    { ok: false }
  );

  if (state.ok) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        تم تنفيذ الإجراء بنجاح — حدّث الصفحة لرؤية الحالة الجديدة.
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="surveyId" value={surveyId} />
      {state.message ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.message}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" ? (
          <>
            <button
              type="submit"
              name="action"
              value="PUBLISH"
              disabled={pending}
              className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-semibold text-white hover:bg-[#174aa8] disabled:opacity-60"
            >
              نشر الاستبيان
            </button>
            <button
              type="submit"
              name="action"
              value="ARCHIVE"
              disabled={pending}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              أرشفة
            </button>
          </>
        ) : null}
        {status === "PUBLISHED" ? (
          <button
            type="submit"
            name="action"
            value="CLOSE"
            disabled={pending}
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
          >
            إغلاق الاستجابة
          </button>
        ) : null}
        {status === "CLOSED" ? (
          <button
            type="submit"
            name="action"
            value="ARCHIVE"
            disabled={pending}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            أرشفة
          </button>
        ) : null}
      </div>
    </form>
  );
}
"use client";

/**
 * Phase 7 — review actions (supervisor / office manager):
 *   - claim for review (SUBMITTED -> UNDER_REVIEW),
 *   - return for revision with a mandatory reason,
 *   - grade against the rubric (scoresJson hidden input, the same
 *     Phase 6 pattern) or a direct score when no rubric exists.
 * Bounds are enforced again on the server; this UI only guides.
 */
import { useActionState, useState } from "react";

import {
  gradeSubmissionAction,
  markUnderReviewAction,
  returnSubmissionAction,
  type FormActionState,
} from "@/app/actions/assignments";
import type { CriterionRow } from "@/lib/assignments/service";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100";

export function ReviewActions({
  submissionId,
  assignmentId,
  status,
  criteria,
  existingScores,
  existingFeedback,
  hasRubric,
}: {
  submissionId: string;
  assignmentId: string;
  status: string;
  criteria: CriterionRow[];
  existingScores: { criterionId: string; points: number }[];
  existingFeedback: string | null;
  hasRubric: boolean;
}) {
  const actionable = status === "SUBMITTED" || status === "UNDER_REVIEW";
  const initialScores = new Map(existingScores.map((score) => [score.criterionId, score.points]));
  const [scores, setScores] = useState<Record<string, string>>(
    Object.fromEntries(criteria.map((criterion) => [criterion.id, String(initialScores.get(criterion.id) ?? "")]))
  );
  const [directScore, setDirectScore] = useState("");

  const [reviewState, reviewAction, reviewPending] = useActionState<FormActionState, FormData>(
    markUnderReviewAction,
    { ok: false }
  );
  const [returnState, returnFormAction, returnPending] = useActionState<FormActionState, FormData>(
    returnSubmissionAction,
    { ok: false }
  );
  const [gradeState, gradeFormAction, gradePending] = useActionState<FormActionState, FormData>(
    gradeSubmissionAction,
    { ok: false }
  );

  const rubricTotal = criteria.reduce((sum, criterion) => {
    const value = Number(scores[criterion.id]);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);

  if (!actionable) {
    return (
      <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">
        {status === "GRADED"
          ? "تم تقييم هذا التسليم — التقييم النهائي ظاهر للمعلم."
          : status === "RETURNED"
            ? "أُعيد هذا التسليم للمعلم للتعديل — بانتظار إعادة التسليم."
            : "لم يُسلَّم هذا التكليف بعد."}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {status === "SUBMITTED" ? (
        <form action={reviewAction} className="flex items-center gap-3">
          <input type="hidden" name="submissionId" value={submissionId} />
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <button
            type="submit"
            disabled={reviewPending}
            className="rounded-lg border border-[#1D5BD6] px-4 py-2 text-sm font-medium text-[#1D5BD6] hover:bg-blue-50 disabled:opacity-60"
          >
            بدء المراجعة
          </button>
          {reviewState.message && !reviewState.ok ? (
            <span className="text-xs text-red-600">{reviewState.message}</span>
          ) : null}
        </form>
      ) : null}

      <form action={returnFormAction} className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
        <input type="hidden" name="submissionId" value={submissionId} />
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <h3 className="mb-2 text-sm font-semibold text-amber-800">إعادة للتعديل</h3>
        <textarea
          name="feedbackText"
          required
          minLength={3}
          maxLength={4000}
          rows={3}
          placeholder="اكتب ملاحظات واضحة توجّه المعلم لما يجب تحسينه…"
          className={inputCls}
        />
        <button
          type="submit"
          disabled={returnPending}
          className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {returnPending ? "جارٍ الإرسال…" : "إعادة التسليم للتعديل"}
        </button>
        {returnState.message && !returnState.ok ? (
          <p className="mt-2 text-xs text-red-600">{returnState.message}</p>
        ) : null}
      </form>

      <form action={gradeFormAction} className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
        <input type="hidden" name="submissionId" value={submissionId} />
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <h3 className="mb-3 text-sm font-semibold text-emerald-800">التقييم النهائي</h3>

        {hasRubric ? (
          <div className="space-y-2">
            {criteria.map((criterion) => (
              <div key={criterion.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-slate-700">{criterion.titleAr}</span>
                <span className="text-xs text-slate-400">من {criterion.maxPoints}</span>
                <input
                  type="number"
                  min={0}
                  max={criterion.maxPoints}
                  name={`score-${criterion.id}`}
                  value={scores[criterion.id] ?? ""}
                  onChange={(event) =>
                    setScores((prev) => ({ ...prev, [criterion.id]: event.target.value }))
                  }
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-[#1D5BD6]"
                />
              </div>
            ))}
            <p className="text-xs font-medium text-slate-500">
              المجموع الحالي: <strong className="text-[#1D5BD6]">{rubricTotal}</strong> نقطة
            </p>
            <input
              type="hidden"
              name="scoresJson"
              value={JSON.stringify(
                criteria
                  .filter((criterion) => scores[criterion.id] !== "" && Number.isFinite(Number(scores[criterion.id])))
                  .map((criterion) => ({
                    criterionId: criterion.id,
                    points: Number(scores[criterion.id]),
                  }))
              )}
            />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-700" htmlFor="directScore">الدرجة المباشرة (من 100)</label>
            <input
              id="directScore"
              name="directScore"
              type="number"
              min={0}
              max={100}
              value={directScore}
              onChange={(event) => setDirectScore(event.target.value)}
              className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-[#1D5BD6]"
            />
          </div>
        )}

        <label className="mt-3 mb-1 block text-sm font-medium text-slate-700" htmlFor="feedbackText">
          التغذية الراجعة للمعلم — اختياري (تظهر بعد التقييم)
        </label>
        <textarea
          id="feedbackText"
          name="feedbackText"
          defaultValue={existingFeedback ?? ""}
          rows={3}
          maxLength={4000}
          className={inputCls}
        />

        <button
          type="submit"
          disabled={gradePending}
          className="mt-3 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {gradePending ? "جارٍ الحفظ…" : "اعتماد التقييم"}
        </button>
        {gradeState.message && !gradeState.ok ? (
          <p className="mt-2 text-xs text-red-600">{gradeState.message}</p>
        ) : null}
        {gradeState.ok ? (
          <p className="mt-2 text-xs text-emerald-700">
            تم اعتماد التقييم — الدرجة والتغذية الراجعة ظاهرة للمعلم الآن.
          </p>
        ) : null}
      </form>
    </div>
  );
}
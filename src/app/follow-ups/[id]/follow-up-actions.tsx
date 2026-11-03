"use client";

/**
 * Phase 9 — follow-up record actions: status transitions + sharing
 * toggle. Server re-checks role, scope and transition validity.
 */
import { useActionState } from "react";

import {
  changeFollowUpStatusAction,
  setFollowUpSharingAction,
  type SurveyActionState,
} from "@/app/actions/surveys";

export default function FollowUpActions({
  followUpId,
  status,
  sharedWithTeacher,
}: {
  followUpId: string;
  status: string;
  sharedWithTeacher: boolean;
}) {
  const [statusState, statusAction, statusPending] = useActionState<SurveyActionState, FormData>(
    changeFollowUpStatusAction,
    { ok: false }
  );
  const [shareState, shareAction, sharePending] = useActionState<SurveyActionState, FormData>(
    setFollowUpSharingAction,
    { ok: false }
  );

  const terminal = status === "COMPLETED" || status === "CANCELLED";

  return (
    <div className="space-y-4">
      {statusState.message && !statusState.ok ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{statusState.message}</div>
      ) : null}
      {statusState.ok ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          تم تحديث الحالة — حدّث الصفحة.
        </div>
      ) : null}

      <form action={statusAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="followUpId" value={followUpId} />
        {status === "PLANNED" ? (
          <button
            type="submit" name="status" value="IN_PROGRESS" disabled={statusPending}
            className="rounded-lg bg-[#1D5BD6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#174aa8] disabled:opacity-60"
          >
            بدء التنفيذ
          </button>
        ) : null}
        {status === "PLANNED" || status === "IN_PROGRESS" ? (
          <>
            <button
              type="submit" name="status" value="COMPLETED" disabled={statusPending}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
            >
              إنهاء (مكتملة)
            </button>
            <button
              type="submit" name="status" value="CANCELLED" disabled={statusPending}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              إلغاء
            </button>
          </>
        ) : null}
        {terminal ? (
          <p className="text-xs text-slate-400">هذا السجل نهائي — أنشئ سجل متابعة جديدًا لمواصلة الدورة.</p>
        ) : null}
      </form>

      {shareState.message && !shareState.ok ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{shareState.message}</div>
      ) : null}
      {shareState.ok ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          تم تحديث المشاركة — حدّث الصفحة.
        </div>
      ) : null}
      <form action={shareAction}>
        <input type="hidden" name="followUpId" value={followUpId} />
        <input type="hidden" name="shared" value={sharedWithTeacher ? "false" : "true"} />
        <button
          type="submit" disabled={sharePending}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
            sharedWithTeacher
              ? "border-slate-300 text-slate-600 hover:bg-slate-50"
              : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          }`}
        >
          {sharePending ? "جارٍ التنفيذ…" : sharedWithTeacher ? "إيقاف المشاركة مع المعلم" : "مشاركة السجل مع المعلم"}
        </button>
      </form>
      <p className="text-[11px] text-slate-400">
        المشاركة تكشف للمعلم: العنوان والغرض والتواريخ والحالة والتوصيات فقط — الملاحظات الداخلية لا تُشارك أبدًا.
      </p>
    </div>
  );
}
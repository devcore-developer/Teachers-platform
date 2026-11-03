"use client";

/**
 * Phase 7 — status transition buttons (office manager): publish, close,
 * re-open, archive. The service re-validates every guard server-side;
 * this component only surfaces the returned Arabic message.
 */
import { useActionState } from "react";

import { setAssignmentStatusAction, type FormActionState } from "@/app/actions/assignments";

const btn =
  "rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition disabled:opacity-60";

export function AssignmentStatusActions({
  assignmentId,
  status,
}: {
  assignmentId: string;
  status: string;
}) {
  const [state, formAction, pending] = useActionState<FormActionState, FormData>(
    setAssignmentStatusAction,
    { ok: false }
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="assignmentId" value={assignmentId} />
        {status === "DRAFT" ? (
          <button type="submit" name="status" value="PUBLISHED" disabled={pending} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
            نشر التكليف
          </button>
        ) : null}
        {status === "PUBLISHED" ? (
          <button type="submit" name="status" value="CLOSED" disabled={pending} className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}>
            إغلاق التسليم
          </button>
        ) : null}
        {status === "CLOSED" ? (
          <button type="submit" name="status" value="PUBLISHED" disabled={pending} className={`${btn} bg-[#1D5BD6] text-white hover:bg-[#174aa8]`}>
            إعادة الفتح
          </button>
        ) : null}
        {status !== "ARCHIVED" ? (
          <button type="submit" name="status" value="ARCHIVED" disabled={pending} className={`${btn} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}>
            أرشفة
          </button>
        ) : null}
      </form>
      {state.message ? (
        <p className={`text-xs ${state.ok ? "text-emerald-600" : "text-red-600"}`}>{state.message}</p>
      ) : null}
    </div>
  );
}
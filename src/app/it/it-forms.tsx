"use client";

import { useActionState } from "react";

import {
  assignTeacherSupervisorItAction,
  removeTeacherSupervisorItAction,
  requestTeacherRecoveryItAction,
  type ItActionState,
} from "@/app/actions/it";

/**
 * Client controls for the IT workspace: per-teacher assignment controls
 * and the account-recovery form. All rules run server-side; these
 * components only collect input and display the returned Arabic state.
 */

export function TeacherAssignmentControls({
  teacherId,
  supervisors,
  currentSupervisorId,
}: {
  teacherId: string;
  supervisors: { id: string; name: string; assignedCount: number }[];
  currentSupervisorId: string | null;
}) {
  const [assignState, assignAction, assignPending] = useActionState(
    assignTeacherSupervisorItAction,
    null
  );
  const [removeState, removeAction, removePending] = useActionState(
    async (_prev: ItActionState | null) => removeTeacherSupervisorItAction(teacherId),
    null
  );

  const message = assignState?.message ?? removeState?.message;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <form action={assignAction} className="flex items-center gap-2">
          <input type="hidden" name="teacherId" value={teacherId} />
          <select
            name="supervisorId"
            defaultValue={currentSupervisorId ?? ""}
            className="h-8 rounded-lg border bg-background px-2 text-xs"
            aria-label="المشرف التربوي"
          >
            <option value="" disabled>
              اختر المشرف…
            </option>
            {supervisors.map((supervisor) => (
              <option key={supervisor.id} value={supervisor.id}>
                {supervisor.name} ({supervisor.assignedCount})
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={assignPending || supervisors.length === 0}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {assignPending ? "جارٍ الإسناد…" : "إسناد"}
          </button>
        </form>
        {currentSupervisorId && (
          <form action={removeAction}>
            <button
              type="submit"
              disabled={removePending}
              className="rounded-lg border px-3 py-1.5 text-xs font-bold text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50"
            >
              {removePending ? "جارٍ الإزالة…" : "إزالة الإسناد"}
            </button>
          </form>
        )}
      </div>
      {message && (
        <p
          className={`text-xs font-semibold ${
            (assignState ?? removeState)?.ok ? "text-success" : "text-destructive"
          }`}
          role="status"
        >
          {message}
        </p>
      )}
    </div>
  );
}

export function TeacherRecoveryForm() {
  const [state, formAction, pending] = useActionState(
    requestTeacherRecoveryItAction,
    null
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-bold text-muted-foreground">
          بريد المعلم الإلكتروني
        </span>
        <input
          type="email"
          name="teacherEmail"
          dir="ltr"
          required
          placeholder="teacher@school.com"
          className="h-10 w-72 rounded-lg border bg-background px-3 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? "جارٍ الإرسال…" : "إرسال رابط الاستعادة"}
      </button>
      {state?.message && (
        <p
          className={`w-full text-xs font-semibold ${
            state.ok ? "text-success" : "text-destructive"
          }`}
          role="status"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
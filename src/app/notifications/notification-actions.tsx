"use client";

/**
 * Phase 11 — notification read-state controls (client).
 * Uses the project's useActionState + inline feedback conventions.
 */

import { useActionState } from "react";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type NotificationActionState,
} from "@/app/actions/notifications";

const initialState: NotificationActionState = { ok: false };

export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: NotificationActionState) => markAllNotificationsReadAction(_prev),
    initialState,
  );
  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending || disabled}
        className="rounded-lg border border-[#1D5BD6] px-3 py-1.5 text-xs font-semibold text-[#1D5BD6] transition hover:bg-blue-50 disabled:opacity-50"
      >
        {pending ? "جارٍ التنفيذ…" : "تحديد الكل كمقروء"}
      </button>
    </form>
  );
}

export function RowMarkReadButton({ notificationId }: { notificationId: string }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: NotificationActionState, formData: FormData) =>
      markNotificationReadAction(_prev, formData),
    initialState,
  );
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="notificationId" value={notificationId} />
      <button
        type="submit"
        disabled={pending}
        title="تحديد كمقروء"
        className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:border-[#1D5BD6] hover:text-[#1D5BD6] disabled:opacity-50"
      >
        {pending ? "…" : "تحديد كمقروء"}
      </button>
      {!state.ok && state.message ? (
        <span className="mr-2 text-[10px] text-red-600">{state.message}</span>
      ) : null}
    </form>
  );
}
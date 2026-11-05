"use client";

import { useTransition } from "react";
import { CheckCheck } from "lucide-react";

/**
 * Batch 1 — client helper for the notifications page: triggers the
 * server mark-all action and refreshes the server-rendered list.
 */
export function NotificationsActions({
  markAllAction,
}: {
  markAllAction: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => void markAllAction())}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
    >
      <CheckCheck className="size-3.5" aria-hidden="true" />
      {pending ? "جارٍ التحديث…" : "تحديد الكل كمقروء"}
    </button>
  );
}
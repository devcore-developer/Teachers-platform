"use client";

/**
 * Phase 8 — revocation control (office manager only by service guard).
 * Requires an explicit reason (Zod-validated server-side); the
 * conditional updateMany flip in the service makes double-revocation
 * impossible even if two admins submit simultaneously.
 */
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  revokeCertificateAction,
  type CertificateActionState,
} from "@/app/actions/certificates";

export function RevokeForm({ certificateId }: { certificateId: string }) {
  const [state, formAction, pending] = useActionState<CertificateActionState, FormData>(
    revokeCertificateAction,
    { ok: false }
  );
  const router = useRouter();

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <form action={formAction} className="no-print flex flex-col gap-2">
      <input type="hidden" name="certificateId" value={certificateId} />
      <label className="text-xs font-medium text-slate-500" htmlFor="revoke-reason">
        سبب إلغاء الشهادة (يُسجَّل في سجل التدقيق)
      </label>
      <textarea
        id="revoke-reason"
        name="reason"
        rows={3}
        required
        placeholder="مثال: تبين عدم استيفاء متطلبات الإتمام بعد إعادة التدقيق"
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
      >
        {pending ? "جارٍ الإلغاء…" : "إلغاء الشهادة نهائيًا"}
      </button>
      {state.message ? (
        <p className={`text-xs ${state.ok ? "text-emerald-600" : "text-red-600"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
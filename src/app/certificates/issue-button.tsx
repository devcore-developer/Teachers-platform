"use client";

/**
 * Phase 8 — per-teacher issuance button on the eligibility table.
 * The service re-computes eligibility server-side at submit time; the
 * button is only a convenience. Success shows the generated identifiers
 * and refreshes the roster (the row flips to "already issued").
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  issueCertificateAction,
  type CertificateActionState,
} from "@/app/actions/certificates";

export function IssueCertificateButton({
  teacherId,
  contentType,
  contentId,
  disabled,
}: {
  teacherId: string;
  contentType: string;
  contentId: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState<CertificateActionState, FormData>(
    issueCertificateAction,
    { ok: false }
  );
  const router = useRouter();

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <div className="flex flex-col items-start gap-1">
      <form action={formAction}>
        <input type="hidden" name="teacherId" value={teacherId} />
        <input type="hidden" name="contentType" value={contentType} />
        <input type="hidden" name="contentId" value={contentId} />
        <button
          type="submit"
          disabled={pending || disabled}
          className="rounded-lg bg-[#1D5BD6] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#174aa8] disabled:opacity-60"
        >
          {pending ? "جارٍ الإصدار…" : "إصدار الشهادة"}
        </button>
      </form>
      {state.ok && state.data?.certificateNumber ? (
        <p className="text-xs text-emerald-600">
          صدرت الشهادة رقم {state.data.certificateNumber}
        </p>
      ) : null}
      {!state.ok && state.message ? (
        <p className="max-w-xs text-xs text-red-600">{state.message}</p>
      ) : null}
    </div>
  );
}
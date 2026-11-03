"use client";

/**
 * Phase 11 — reset-password form (client). Validates match/length inline,
 * then lets the server enforce the real single-use token contract.
 */

import { useActionState } from "react";
import { resetPasswordAction, type AccountActionState } from "@/app/actions/account";

const initialState: AccountActionState = { ok: false };

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    async (prev: AccountActionState, formData: FormData) => resetPasswordAction(prev, formData),
    initialState,
  );

  if (state.ok) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-bold text-emerald-700">تم تحديث كلمة المرور</p>
        <p className="mt-1 text-xs leading-relaxed text-emerald-600">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor="reset-password" className="mb-1 block text-xs font-semibold text-slate-600">
          كلمة المرور الجديدة
        </label>
        <input
          id="reset-password"
          type="password"
          name="password"
          required
          minLength={8}
          dir="ltr"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-[#1D5BD6] focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="reset-confirm" className="mb-1 block text-xs font-semibold text-slate-600">
          تأكيد كلمة المرور
        </label>
        <input
          id="reset-confirm"
          type="password"
          name="confirm"
          required
          minLength={8}
          dir="ltr"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-[#1D5BD6] focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#174aa8] disabled:opacity-60"
      >
        {pending ? "جارٍ التحديث…" : "تحديث كلمة المرور"}
      </button>
      {!state.ok && state.message && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
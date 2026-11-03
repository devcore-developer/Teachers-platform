"use client";

/**
 * Phase 11 — forgot-password form (client). Shows the neutral response
 * plus the HONEST email-configuration state returned by the server action.
 */

import { useActionState } from "react";
import {
  requestPasswordResetAction,
  type AccountActionState,
} from "@/app/actions/account";

const initialState: AccountActionState = { ok: false };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    async (prev: AccountActionState, formData: FormData) =>
      requestPasswordResetAction(prev, formData),
    initialState,
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <div>
          <label htmlFor="forgot-email" className="mb-1 block text-xs font-semibold text-slate-600">
            البريد الإلكتروني المسجل
          </label>
          <input
            id="forgot-email"
            type="email"
            name="email"
            required
            dir="ltr"
            placeholder="name@school.example"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-[#1D5BD6] focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#174aa8] disabled:opacity-60"
        >
          {pending ? "جارٍ الإرسال…" : "إرسال رابط إعادة التعيين"}
        </button>
      </form>

      {state.message && (
        <div
          className={`rounded-lg border p-3 text-xs leading-relaxed whitespace-pre-line ${
            state.ok
              ? state.emailConfigured === false
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </div>
      )}
    </div>
  );
}
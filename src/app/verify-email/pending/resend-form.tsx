"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import {
  resendVerificationAction,
  type AuthFormState,
} from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-10 w-full rounded-xl border border-brand-200 bg-brand-50 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-60"
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {pending ? "جارٍ الإرسال…" : "إعادة إرسال رسالة التوثيق"}
    </Button>
  );
}

/**
 * Resend trigger for the pending-verification screen. The server action
 * answers with the same generic message regardless of whether the
 * address belongs to an account — no existence disclosure.
 */
export function ResendVerificationForm({ email }: { email: string }) {
  const [state, formAction] = React.useActionState<AuthFormState | null, FormData>(
    resendVerificationAction,
    null
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="email" value={email} />
      {state?.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
            state.ok
              ? "border-success/30 bg-success-soft text-success"
              : "border-error/30 bg-error-soft text-error"
          }`}
        >
          {state.message}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
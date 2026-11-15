"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, Loader2 } from "lucide-react";

import { forgotPasswordAction, type AuthFormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-11 w-full rounded-xl bg-gradient-to-l from-brand-600 to-brand-500 text-[15px] font-bold shadow-lg shadow-brand-600/25 transition-all hover:shadow-xl hover:shadow-brand-600/30 hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {pending ? "جارٍ الإرسال…" : "إرسال رابط إعادة التعيين"}
    </Button>
  );
}

/**
 * Forgot-password form — the server response is ALWAYS generic (it never
 * discloses whether the address belongs to an account), so the UI simply
 * renders whatever honest message the action returns.
 */
export function ForgotPasswordForm() {
  const [state, formAction] = React.useActionState<AuthFormState | null, FormData>(
    forgotPasswordAction,
    null
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state && !state.ok && !state.message?.includes("صحيحًا") && state.message && (
        <p
          role="status"
          className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold text-success"
        >
          {state.message}
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="forgot-email" className="text-[13px] font-semibold">
          البريد الإلكتروني
        </label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          placeholder="name@school.edu"
          required
          aria-invalid={Boolean(state?.fieldErrors?.email)}
          aria-describedby={
            state?.fieldErrors?.email ? "forgot-email-error" : undefined
          }
          className="h-11 w-full rounded-xl bg-background text-[15px] aria-[invalid=true]:border-destructive"
        />
        {state?.fieldErrors?.email && (
          <p id="forgot-email-error" className="text-xs font-semibold text-destructive">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <SubmitButton />

      {state?.ok && state.message && (
        <p
          role="status"
          className="rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold leading-relaxed text-success"
        >
          {state.message}
        </p>
      )}
      {state && !state.ok && state.message?.includes("صحيحًا") && (
        <p
          role="alert"
          className="rounded-xl border border-error/30 bg-error-soft px-4 py-3 text-sm font-semibold text-error"
        >
          {state.message}
        </p>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        لم يصلك الرابط؟ تحقق من مجلد الرسائل غير المرغوبة، أو تواصل مع
        تقنية المعلومات في مدرستك — يمكن للمنسق إرسال رابط استعادة مباشرة
        إلى بريدك المسجل.
      </p>
    </form>
  );
}
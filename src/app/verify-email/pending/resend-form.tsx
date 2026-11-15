"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2, MailCheck } from "lucide-react";

import { resendVerificationAction, type AuthFormState } from "@/app/actions/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      className="h-11 w-full rounded-xl"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <MailCheck className="size-4" aria-hidden="true" />
      )}
      {pending ? "جارٍ إعادة الإرسال…" : "إعادة إرسال رسالة التفعيل"}
    </Button>
  );
}

/**
 * Generic resend form — the server action's response is intentionally
 * identical whether or not the address has an unverified teacher
 * account, so no account-existence information is ever disclosed.
 */
export function ResendVerificationForm({ initialEmail }: { initialEmail: string }) {
  const [state, formAction] = React.useActionState<AuthFormState | null, FormData>(
    resendVerificationAction,
    null
  );

  return (
    <form action={formAction} className="space-y-3" noValidate>
      {state?.message && (
        <Alert role="status">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="pending-email" className="text-[13px]">
          بريدك الإلكتروني
        </Label>
        <Input
          id="pending-email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          defaultValue={initialEmail}
          placeholder="name@school.edu"
          required
          className="h-11 w-full rounded-xl bg-background"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
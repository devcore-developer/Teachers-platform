"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";

import { resetPasswordAction, type AuthFormState } from "@/app/actions/auth";
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
      {pending ? "جارٍ الحفظ…" : "تعيين كلمة المرور الجديدة"}
    </Button>
  );
}

/**
 * Reset-password form. On success the server action redirects to
 * /login?reset=1 (which renders the Arabic success banner) — the client
 * only adds presentation and field-level errors.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = React.useActionState<AuthFormState | null, FormData>(
    resetPasswordAction,
    null
  );
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />

      {state && !state.ok && state.message && (
        <p
          role="alert"
          className="rounded-xl border border-error/30 bg-error-soft px-4 py-3 text-sm font-semibold text-error"
        >
          {state.message}
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="reset-password" className="text-[13px] font-semibold">
          كلمة المرور الجديدة
        </label>
        <div className="relative">
          <Input
            id="reset-password"
            name="password"
            type={showPassword ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            placeholder="8 أحرف على الأقل مع رقم واحد"
            required
            aria-invalid={Boolean(state?.fieldErrors?.password)}
            aria-describedby={
              state?.fieldErrors?.password ? "reset-password-error" : undefined
            }
            className="h-11 w-full rounded-xl bg-background pe-10 text-[15px] aria-[invalid=true]:border-destructive"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            aria-pressed={showPassword}
            className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {state?.fieldErrors?.password && (
          <p id="reset-password-error" className="text-xs font-semibold text-destructive">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="reset-confirm" className="text-[13px] font-semibold">
          تأكيد كلمة المرور
        </label>
        <div className="relative">
          <Input
            id="reset-confirm"
            name="confirmPassword"
            type={showConfirm ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            placeholder="أعد كتابة كلمة المرور"
            required
            aria-invalid={Boolean(state?.fieldErrors?.confirmPassword)}
            aria-describedby={
              state?.fieldErrors?.confirmPassword ? "reset-confirm-error" : undefined
            }
            className="h-11 w-full rounded-xl bg-background pe-10 text-[15px] aria-[invalid=true]:border-destructive"
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? "إخفاء التأكيد" : "إظهار التأكيد"}
            aria-pressed={showConfirm}
            className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {showConfirm ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {state?.fieldErrors?.confirmPassword && (
          <p id="reset-confirm-error" className="text-xs font-semibold text-destructive">
            {state.fieldErrors.confirmPassword}
          </p>
        )}
      </div>

      <SubmitButton />

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden="true" />
        بعد التعيين تُغلق كل الجلسات المفتوحة على أجهزتك حفاظًا على حسابك.
      </p>
    </form>
  );
}
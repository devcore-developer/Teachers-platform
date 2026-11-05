"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  Mail,
} from "lucide-react";

import { loginAction, type AuthFormState } from "@/app/actions/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-11 w-full rounded-xl bg-gradient-to-l from-brand-600 to-brand-500 text-[15px] font-bold shadow-lg shadow-brand-600/25 transition-all hover:shadow-xl hover:shadow-brand-600/30 hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <LogIn className="size-4" aria-hidden="true" />
      )}
      {pending ? "جارٍ التحقق…" : "تسجيل الدخول"}
    </Button>
  );
}

interface LoginFormProps {
  nextPath?: string;
  /** Recovery link (may carry the school context for dynamic branding). */
  forgotHref?: string;
}

/**
 * Arabic RTL login form — validation and rate limiting run on the
 * server. The form only adds presentation polish: icon-affordance
 * fields, a password visibility toggle, field-level error wiring
 * (aria-describedby), a success flash and a repositioned recovery link.
 */
export function LoginForm({ nextPath, forgotHref = "/forgot-password" }: LoginFormProps) {
  const router = useRouter();
  const [state, formAction] = React.useActionState<AuthFormState | null, FormData>(
    loginAction,
    null
  );
  const [showPassword, setShowPassword] = React.useState(false);

  // loginAction redirects on success; refresh guarantees the shell
  // re-renders with the fresh session (role-aware navigation).
  React.useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, router]);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {nextPath && <input type="hidden" name="next" value={nextPath} />}

      {state?.ok && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold text-success"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          تم تسجيل الدخول بنجاح — جارٍ تحويلك الآن…
        </div>
      )}

      {state && !state.ok && state.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email" className="text-[13px]">
          البريد الإلكتروني
        </Label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            autoComplete="email"
            placeholder="name@school.edu"
            required
            aria-invalid={Boolean(state?.fieldErrors?.email)}
            aria-describedby={
              state?.fieldErrors?.email ? "login-email-error" : undefined
            }
            className="h-11 w-full rounded-xl bg-background ps-9"
          />
        </div>
        {state?.fieldErrors?.email && (
          <p
            id="login-email-error"
            className="text-xs font-semibold text-destructive"
          >
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="text-[13px]">
          كلمة المرور
        </Label>
        <div className="relative">
          <Lock
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            dir="ltr"
            autoComplete="current-password"
            placeholder="••••••••"
            required
            aria-invalid={Boolean(state?.fieldErrors?.password)}
            aria-describedby={
              state?.fieldErrors?.password ? "login-password-error" : undefined
            }
            className="h-11 w-full rounded-xl bg-background pe-10 ps-9"
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
          <p
            id="login-password-error"
            className="text-xs font-semibold text-destructive"
          >
            {state.fieldErrors.password}
          </p>
        )}
        <div className="flex justify-end">
          <Link
            href={forgotHref}
            className="text-[13px] font-semibold text-brand-600 transition-colors hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            نسيت كلمة المرور؟
          </Link>
        </div>
      </div>

      <SubmitButton />
    </form>
  );
}
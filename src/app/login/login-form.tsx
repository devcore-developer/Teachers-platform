"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { LogIn } from "lucide-react";

import { loginAction, type AuthFormState } from "@/app/actions/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      <LogIn className="size-4" aria-hidden="true" />
      {pending ? "جارٍ التحقق…" : "تسجيل الدخول"}
    </Button>
  );
}

interface LoginFormProps {
  nextPath?: string;
  /** Recovery link (may carry the school context for dynamic branding). */
  forgotHref?: string;
}

/** Arabic RTL login form — validation and rate limiting run on the server. */
export function LoginForm({ nextPath, forgotHref = "/forgot-password" }: LoginFormProps) {
  const router = useRouter();
  const [state, formAction] = React.useActionState<AuthFormState | null, FormData>(
    loginAction,
    null
  );

  // loginAction redirects on success; refresh guarantees the shell
  // re-renders with the fresh session (role-aware navigation).
  React.useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, router]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {nextPath && <input type="hidden" name="next" value={nextPath} />}

      {state && !state.ok && state.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          placeholder="name@school.edu"
          required
          aria-invalid={Boolean(state?.fieldErrors?.email)}
        />
        {state?.fieldErrors?.email && (
          <p className="text-xs font-semibold text-destructive">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">كلمة المرور</Label>
          <Link
            href={forgotHref}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            نسيت كلمة المرور؟
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          aria-invalid={Boolean(state?.fieldErrors?.password)}
        />
        {state?.fieldErrors?.password && (
          <p className="text-xs font-semibold text-destructive">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, LockKeyhole, LogIn, Mail } from "lucide-react";

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
      className="h-11 w-full text-sm font-bold shadow-lg shadow-brand-600/20"
    >
      <LogIn className="size-4" aria-hidden="true" />
      {pending ? "جارٍ التحقق…" : "تسجيل الدخول"}
    </Button>
  );
}

interface LoginFormProps {
  nextPath?: string;
}

/** Arabic RTL login form — validation and rate limiting run on the server. */
export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter();
  const [state, formAction] = React.useActionState<AuthFormState | null, FormData>(
    loginAction,
    null
  );
  // Presentation only: toggles the input type between "password" and
  // "text". The submitted value and the server action are unchanged.
  const [showPassword, setShowPassword] = React.useState(false);

  // loginAction redirects on success; refresh guarantees the shell
  // re-renders with the fresh session (role-aware navigation).
  React.useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, router]);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {nextPath && <input type="hidden" name="next" value={nextPath} />}

      {state && !state.ok && state.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">البريد الإلكتروني</Label>
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
            className="h-11 rounded-lg pl-9"
          />
        </div>
        {state?.fieldErrors?.email && (
          <p className="text-xs font-semibold text-destructive">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">كلمة المرور</Label>
          <Link
            href="/forgot-password"
            className="text-xs font-semibold text-brand-600 underline-offset-4 transition-colors hover:text-brand-700 hover:underline"
          >
            نسيت كلمة المرور؟
          </Link>
        </div>
        <div className="relative">
          <LockKeyhole
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
            className="h-11 rounded-lg pl-9 pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-1.5 my-auto grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
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
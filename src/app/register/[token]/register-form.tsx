"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { registerAction, type AuthFormState } from "@/app/actions/auth";
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
      {pending ? "جارٍ إنشاء الحساب…" : "إنشاء حسابي"}
    </Button>
  );
}

/** Password field with an inline show/hide toggle (gate-screen style). */
function PasswordField({
  id,
  label,
  name,
  autoComplete,
  placeholder,
  errorId,
  error,
}: {
  id: string;
  label: string;
  name: string;
  autoComplete: string;
  placeholder: string;
  errorId: string;
  error?: string;
}) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          dir="ltr"
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="h-11 w-full rounded-xl bg-background pe-10 text-[15px] aria-[invalid=true]:border-destructive"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
          aria-pressed={show}
          className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {show ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {error && (
        <p id={errorId} className="text-xs font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const formatDate = (d: Date) =>
  d.toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

/**
 * Teacher self-registration form. The school association rides ONLY on
 * the hidden token — `registerAction` → `registerTeacher` re-resolves
 * it server-side and re-validates every field, so nothing here is
 * trusted. On success the server action redirects to the
 * pending-activation screen (the account holds NO platform access
 * until the IT coordinator assigns a supervisor and activates it);
 * the client only renders field-level errors meanwhile.
 */
export function RegisterForm({
  token,
  branches,
  expiresAt,
}: {
  token: string;
  branches: { id: string; nameAr: string }[];
  expiresAt: Date | null;
}) {
  const [state, formAction] = React.useActionState<AuthFormState | null, FormData>(
    registerAction,
    null
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      {state && !state.ok && state.message && (
        <p
          role="alert"
          className="rounded-xl border border-error/30 bg-error-soft px-4 py-3 text-sm font-semibold text-error"
        >
          {state.message}
        </p>
      )}

      {expiresAt && (
        <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          هذا الرابط سارٍ حتى {formatDate(expiresAt)} — أكمل التسجيل قبل انتهاء
          صلاحيته.
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="register-name" className="text-[13px] font-semibold">
          الاسم الكامل
        </label>
        <Input
          id="register-name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="الاسم كما يظهر في وثائق المدرسة"
          required
          aria-invalid={Boolean(state?.fieldErrors?.name)}
          aria-describedby={
            state?.fieldErrors?.name ? "register-name-error" : undefined
          }
          className="h-11 w-full rounded-xl bg-background text-[15px] aria-[invalid=true]:border-destructive"
        />
        {state?.fieldErrors?.name && (
          <p id="register-name-error" className="text-xs font-semibold text-destructive">
            {state.fieldErrors.name}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="register-email" className="text-[13px] font-semibold">
          البريد الإلكتروني
        </label>
        <Input
          id="register-email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          placeholder="name@example.com"
          required
          aria-invalid={Boolean(state?.fieldErrors?.email)}
          aria-describedby={
            state?.fieldErrors?.email ? "register-email-error" : undefined
          }
          className="h-11 w-full rounded-xl bg-background text-[15px] aria-[invalid=true]:border-destructive"
        />
        {state?.fieldErrors?.email && (
          <p id="register-email-error" className="text-xs font-semibold text-destructive">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <PasswordField
        id="register-password"
        label="كلمة المرور"
        name="password"
        autoComplete="new-password"
        placeholder="8 أحرف على الأقل مع حرف ورقم"
        errorId="register-password-error"
        error={state?.fieldErrors?.password}
      />
      <PasswordField
        id="register-confirm-password"
        label="تأكيد كلمة المرور"
        name="confirmPassword"
        autoComplete="new-password"
        placeholder="أعد إدخال كلمة المرور"
        errorId="register-confirm-error"
        error={state?.fieldErrors?.confirmPassword}
      />

      {branches.length > 0 && (
        <div className="space-y-2">
          <label htmlFor="register-branch" className="text-[13px] font-semibold">
            الفرع — بيتك المدرسي
          </label>
          <select
            id="register-branch"
            name="branchId"
            defaultValue=""
            aria-invalid={Boolean(state?.fieldErrors?.branchId)}
            aria-describedby={
              state?.fieldErrors?.branchId ? "register-branch-error" : undefined
            }
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-[15px] aria-[invalid=true]:border-destructive"
          >
            <option value="">اختر الفرع (اختياري)</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.nameAr}
              </option>
            ))}
          </select>
          {state?.fieldErrors?.branchId && (
            <p id="register-branch-error" className="text-xs font-semibold text-destructive">
              {state.fieldErrors.branchId}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="register-stage" className="text-[13px] font-semibold">
            المرحلة التعليمية{" "}
            <span className="font-normal text-muted-foreground">(اختياري)</span>
          </label>
          <Input
            id="register-stage"
            name="stage"
            type="text"
            placeholder="مثال: المرحلة الابتدائية"
            className="h-11 w-full rounded-xl bg-background text-[15px]"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="register-subject" className="text-[13px] font-semibold">
            التخصص{" "}
            <span className="font-normal text-muted-foreground">(اختياري)</span>
          </label>
          <Input
            id="register-subject"
            name="subject"
            type="text"
            placeholder="مثال: الرياضيات"
            className="h-11 w-full rounded-xl bg-background text-[15px]"
          />
        </div>
      </div>

      <p className="rounded-xl border bg-muted/40 px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        بعد إنشاء الحساب سيبقى قيد التفعيل: يُسندك منسق تقنية المعلومات في
        مدرستك إلى المشرف التربوي ويُفعّل حسابك، وبعدها تسجّل الدخول مباشرة
        بالبريد وكلمة المرور اللذين أنشأتهما.
      </p>

      <SubmitButton />
    </form>
  );
}
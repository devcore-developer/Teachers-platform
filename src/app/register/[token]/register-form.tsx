"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, Loader2, UserPlus } from "lucide-react";

import { registerAction, type AuthFormState } from "@/app/actions/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RegisterFormProps {
  /** The raw registration-link token — submitted hidden, never editable. */
  token: string;
  /** Resolved server-side from the token (display + branch list caption). */
  schoolName: string;
  /** Active branches OF THE REGISTRATION SCHOOL only (server-resolved). */
  branches: { id: string; nameAr: string }[];
}

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
        <UserPlus className="size-4" aria-hidden="true" />
      )}
      {pending ? "جارٍ إنشاء الحساب…" : "إنشاء الحساب"}
    </Button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-semibold text-destructive">
      {message}
    </p>
  );
}

/**
 * Arabic RTL teacher registration form — all validation, tenant
 * resolution and rate rules run on the SERVER (registerAction →
 * registerTeacher). The school association is carried exclusively by
 * the hidden token; the form offers only the branches of the link's
 * school, so a teacher can never register into another school.
 */
export function RegisterForm({ token, schoolName, branches }: RegisterFormProps) {
  const [state, formAction] = React.useActionState<AuthFormState | null, FormData>(
    registerAction,
    null
  );
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />

      {state && !state.ok && state.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="name" className="text-[13px]">
          الاسم الكامل
        </Label>
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="الاسم الرباعي كما في ملفك الوظيفي"
          required
          aria-invalid={Boolean(state?.fieldErrors?.name)}
          aria-describedby={
            state?.fieldErrors?.name ? "register-name-error" : undefined
          }
          className="h-11 w-full rounded-xl bg-background"
        />
        <FieldError id="register-name-error" message={state?.fieldErrors?.name} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email" className="text-[13px]">
          البريد الإلكتروني
        </Label>
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
            state?.fieldErrors?.email ? "register-email-error" : undefined
          }
          className="h-11 w-full rounded-xl bg-background"
        />
        <FieldError id="register-email-error" message={state?.fieldErrors?.email} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          ستصلك رسالة تأكيد على هذا البريد — تأكد من صحته فهو معرّف حسابك.
        </p>
      </div>

      {branches.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="branchId" className="text-[13px]">
            الفرع{" "}
            <span className="text-[11px] font-normal text-muted-foreground">
              (اختياري)
            </span>
          </Label>
          <select
            id="branchId"
            name="branchId"
            defaultValue=""
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <option value="">— اختر الفرع (إن وجد) —</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.nameAr}
              </option>
            ))}
          </select>
          <FieldError
            id="register-branch-error"
            message={state?.fieldErrors?.branchId}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            قائمة فروع {schoolName} — يُتحقق من انتماء الفرع على الخادم.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="stage" className="text-[13px]">
            المرحلة{" "}
            <span className="text-[11px] font-normal text-muted-foreground">
              (اختياري)
            </span>
          </Label>
          <Input
            id="stage"
            name="stage"
            type="text"
            placeholder="مثال: المرحلة الابتدائية"
            className="h-11 w-full rounded-xl bg-background"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="subject" className="text-[13px]">
            التخصص{" "}
            <span className="text-[11px] font-normal text-muted-foreground">
              (اختياري)
            </span>
          </Label>
          <Input
            id="subject"
            name="subject"
            type="text"
            placeholder="مثال: الرياضيات"
            className="h-11 w-full rounded-xl bg-background"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="text-[13px]">
          كلمة المرور
        </Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            placeholder="••••••••"
            required
            aria-invalid={Boolean(state?.fieldErrors?.password)}
            aria-describedby={
              state?.fieldErrors?.password ? "register-password-error" : undefined
            }
            className="h-11 w-full rounded-xl bg-background pe-10"
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
        <FieldError id="register-password-error" message={state?.fieldErrors?.password} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          8 أحرف على الأقل، وتحتوي على حرف واحد ورقم واحد على الأقل.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword" className="text-[13px]">
          تأكيد كلمة المرور
        </Label>
        <div className="relative">
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type={showConfirm ? "text" : "password"}
            dir="ltr"
            autoComplete="new-password"
            placeholder="••••••••"
            required
            aria-invalid={Boolean(state?.fieldErrors?.confirmPassword)}
            aria-describedby={
              state?.fieldErrors?.confirmPassword
                ? "register-confirm-error"
                : undefined
            }
            className="h-11 w-full rounded-xl bg-background pe-10"
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
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
        <FieldError
          id="register-confirm-error"
          message={state?.fieldErrors?.confirmPassword}
        />
      </div>

      <SubmitButton />

      <ol className="space-y-1 rounded-xl border border-border/60 bg-muted/40 p-4 text-xs leading-6 text-muted-foreground">
        <li>1. إنشاء الحساب عبر هذا النموذج.</li>
        <li>2. تأكيد البريد الإلكتروني من رسالة التفعيل (شرط الدخول).</li>
        <li>
          3. إسنادك إلى مشرف تربوي — خطوة لاحقة يتمتها مكتب التطوير في{" "}
          {schoolName}.
        </li>
      </ol>
    </form>
  );
}
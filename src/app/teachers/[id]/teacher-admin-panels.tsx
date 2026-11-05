"use client";

import * as React from "react";
import { KeyRound, Loader2, Mail } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  adminResetPasswordAction,
  adminUpdateEmailAction,
  updateTeacherProfileAction,
  type TeacherAdminActionState,
} from "@/app/actions/teacher-profile";

const initialState: TeacherAdminActionState = { ok: false };

interface SupervisorOption {
  id: string;
  name: string;
}

/**
 * Batch 2 — the admin teacher forms. `mode="profile"` renders the
 * professional-data form; `mode="security"` renders the temporary-
 * password reset (the generated secret is displayed ONCE in local
 * state — it is never stored in the DOM history or persisted) and the
 * email-change form.
 */
export function TeacherAdminPanels({
  mode,
  teacherId,
  initial,
  supervisors = [],
  deputies = [],
}: {
  mode: "profile" | "security";
  teacherId: string;
  initial:
    | {
        name: string;
        stage: string;
        subject: string;
        supervisorId: string;
        deputyId: string;
      }
    | {
        email: string;
        lastLoginAt: string | null;
        passwordUpdatedAt: string | null;
      };
  supervisors?: SupervisorOption[];
  deputies?: SupervisorOption[];
}) {
  const { toast } = useToast();

  const [profileState, profileAction, profilePending] = React.useActionState(
    updateTeacherProfileAction,
    initialState
  );
  const [resetState, resetAction, resetPending] = React.useActionState(
    adminResetPasswordAction,
    initialState
  );
  const [emailState, emailAction, emailPending] = React.useActionState(
    adminUpdateEmailAction,
    initialState
  );

  React.useEffect(() => {
    if (profileState.ok && profileState.message) {
      toast({ title: "تم الحفظ", description: profileState.message });
    }
  }, [profileState, toast]);

  React.useEffect(() => {
    if (emailState.ok && emailState.message) {
      toast({ title: "تم التحديث", description: emailState.message });
    }
  }, [emailState, toast]);

  if (mode === "profile") {
    const data = initial as {
      name: string;
      stage: string;
      subject: string;
      supervisorId: string;
      deputyId: string;
    };
    return (
      <form action={profileAction} className="space-y-4">
        <input type="hidden" name="teacherId" value={teacherId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">الاسم</Label>
            <Input id="name" name="name" defaultValue={data.name} required />
            {profileState.fieldErrors?.name && (
              <p className="text-xs text-error">{profileState.fieldErrors.name}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stage">المرحلة</Label>
            <Input id="stage" name="stage" defaultValue={data.stage} placeholder="مثال: متوسط" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subject">التخصص</Label>
            <Input
              id="subject"
              name="subject"
              defaultValue={data.subject}
              placeholder="مثال: اللغة العربية"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supervisorId">المشرف التربوي</Label>
            <select
              id="supervisorId"
              name="supervisorId"
              defaultValue={data.supervisorId}
              className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
            >
              <option value="">— بدون تغيير/بدون مشرف —</option>
              {supervisors.map((supervisor) => (
                <option key={supervisor.id} value={supervisor.id}>
                  {supervisor.name}
                </option>
              ))}
            </select>
            {profileState.fieldErrors?.supervisorId && (
              <p className="text-xs text-error">
                {profileState.fieldErrors.supervisorId}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deputyId">الوكيل التعليمي</Label>
            <select
              id="deputyId"
              name="deputyId"
              defaultValue={data.deputyId}
              className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
            >
              <option value="">— بدون —</option>
              {deputies.map((deputy) => (
                <option key={deputy.id} value={deputy.id}>
                  {deputy.name}
                </option>
              ))}
            </select>
            {profileState.fieldErrors?.deputyId && (
              <p className="text-xs text-error">{profileState.fieldErrors.deputyId}</p>
            )}
          </div>
        </div>

        {profileState.message && !profileState.ok && (
          <p className="rounded-lg bg-error-soft px-3 py-2 text-sm text-error">
            {profileState.message}
          </p>
        )}

        <Button type="submit" disabled={profilePending} className="rounded-xl">
          {profilePending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          حفظ البيانات
        </Button>
      </form>
    );
  }

  const security = initial as {
    email: string;
    lastLoginAt: string | null;
    passwordUpdatedAt: string | null;
  };
  const temporaryPassword =
    resetState.ok && resetState.data?.temporaryPassword
      ? resetState.data.temporaryPassword
      : null;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p>
          البريد الحالي: <span className="font-semibold" dir="ltr">{security.email}</span>
        </p>
        <p>آخر دخول: {security.lastLoginAt ? new Date(security.lastLoginAt).toLocaleString("ar-EG") : "لم يسجل الدخول"}</p>
        <p>
          آخر تحديث لكلمة المرور:{" "}
          {security.passwordUpdatedAt
            ? new Date(security.passwordUpdatedAt).toLocaleString("ar-EG")
            : "غير مسجل"}
        </p>
      </div>

      {/* Temporary password reset */}
      <form action={resetAction} className="space-y-2">
        <input type="hidden" name="teacherId" value={teacherId} />
        <p className="text-sm font-bold">🔑 إعادة تعيين كلمة المرور</p>
        <p className="text-xs text-muted-foreground">
          يولّد النظام كلمة مرور مؤقتة قوية، تُعرض لك مرة واحدة فقط، وتُنهي كل جلسات الحساب.
          لا تُرسل كلمة المرور عبر الإشعارات أو البريد.
        </p>
        <Button type="submit" variant="outline" disabled={resetPending} className="rounded-xl">
          {resetPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          <KeyRound className="size-4" aria-hidden="true" />
          توليد كلمة مرور مؤقتة
        </Button>
        {temporaryPassword && (
          <div className="rounded-xl border-2 border-brand-300 bg-brand-50 p-3">
            <p className="text-xs font-bold text-brand-800">
              انسخها الآن — لن تُعرض مرة أخرى:
            </p>
            <p className="mt-1 select-all font-mono text-lg font-black tracking-wider text-brand-900" dir="ltr">
              {temporaryPassword}
            </p>
          </div>
        )}
        {resetState.message && !resetState.ok && (
          <p className="rounded-lg bg-error-soft px-3 py-2 text-sm text-error">
            {resetState.message}
          </p>
        )}
      </form>

      {/* Email change */}
      <form action={emailAction} className="space-y-2">
        <input type="hidden" name="teacherId" value={teacherId} />
        <p className="text-sm font-bold">✉ تحديث البريد الإلكتروني</p>
        <Input
          name="newEmail"
          type="email"
          dir="ltr"
          placeholder="new@qurtuba.edu.sa"
          required
        />
        {emailState.fieldErrors?.newEmail && (
          <p className="text-xs text-error">{emailState.fieldErrors.newEmail}</p>
        )}
        <p className="text-xs text-muted-foreground">
          البريد الجديد يبدأ غير موثق ويُعاد إرسال رسالة التوثيق عبر الخطوة الموجودة.
        </p>
        <Button type="submit" variant="outline" disabled={emailPending} className="rounded-xl">
          {emailPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          <Mail className="size-4" aria-hidden="true" />
          حفظ البريد الجديد
        </Button>
        {emailState.message && !emailState.ok && (
          <p className="rounded-lg bg-error-soft px-3 py-2 text-sm text-error">
            {emailState.message}
          </p>
        )}
      </form>
    </div>
  );
}
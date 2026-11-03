"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, MailWarning, UserPlus } from "lucide-react";

import {
  createStaffAccountAction,
  type UserFormState,
} from "@/app/actions/users";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionCard } from "@/components/platform/section-card";
import { roleLabel } from "@/lib/auth/roles";
import { STAFF_CREATABLE_ROLES } from "@/lib/validation/users";

/* ------------------------------------------------------------------ */
/* Staff account creation (school-scoped). The role select offers ONLY  */
/* the whitelist (supervisor / deputy / teacher) — SUPER_ADMIN is not   */
/* an option anywhere in the UI, and the service re-forces this         */
/* server-side. New accounts are NOT pre-verified: a verification email */
/* is sent through the existing Phase 3 flow and the honest emailSent   */
/* state is displayed.                                                  */
/* ------------------------------------------------------------------ */

interface StaffCreateFormProps {
  actorRole: string;
  /** Platform schools (SUPER_ADMIN only); empty for office managers. */
  schools: { id: string; nameAr: string; isActive: boolean }[];
  /** Fixed school for office managers. */
  schoolId?: string;
  /** Branch options of the target school (office manager's school). */
  branches: { id: string; nameAr: string }[];
}

function CreateSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="sm">
      <UserPlus className="size-4" aria-hidden="true" />
      {pending ? "جارٍ الإنشاء…" : "إنشاء الحساب وإرسال رابط التأكيد"}
    </Button>
  );
}

export function StaffCreateForm({
  actorRole,
  schools,
  schoolId,
  branches,
}: StaffCreateFormProps) {
  const isSuperAdmin = actorRole === "SUPER_ADMIN";
  const [state, formAction] = React.useActionState<UserFormState | null, FormData>(
    createStaffAccountAction,
    null
  );

  return (
    <SectionCard
      title="إنشاء حساب جديد"
      description="للمشرفين التربويين والوكلاء التعليميين والمعلمين — يُنشأ الحساب غير موثّق ويُرسل له رابط تأكيد البريد عبر مسار التحقق المعتمد."
    >
      <form action={formAction} className="space-y-4" noValidate>
        {state?.message && (
          <Alert
            variant={state.ok ? "default" : "destructive"}
            role={state.ok ? "status" : "alert"}
          >
            {state.ok && state.emailSent === true && (
              <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            )}
            {state.ok && state.emailSent === false && (
              <MailWarning className="size-4 text-warning" aria-hidden="true" />
            )}
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="staff-name">الاسم</Label>
            <Input id="staff-name" name="name" required placeholder="اسم المستخدم" />
            {state?.fieldErrors?.name && (
              <p className="text-xs font-semibold text-destructive">
                {state.fieldErrors.name}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="staff-email">البريد الإلكتروني</Label>
            <Input
              id="staff-email"
              name="email"
              type="email"
              dir="ltr"
              required
              placeholder="staff@school.edu"
            />
            {state?.fieldErrors?.email && (
              <p className="text-xs font-semibold text-destructive">
                {state.fieldErrors.email}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="staff-password">كلمة المرور الأولية</Label>
            <Input
              id="staff-password"
              name="password"
              type="password"
              dir="ltr"
              required
              placeholder="8 أحرف على الأقل + رقم"
            />
            {state?.fieldErrors?.password && (
              <p className="text-xs font-semibold text-destructive">
                {state.fieldErrors.password}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="staff-role">الدور</Label>
            <Select name="role" required>
              <SelectTrigger id="staff-role" className="w-full">
                <SelectValue placeholder="اختر الدور" />
              </SelectTrigger>
              <SelectContent>
                {STAFF_CREATABLE_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabel(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state?.fieldErrors?.role && (
              <p className="text-xs font-semibold text-destructive">
                {state.fieldErrors.role}
              </p>
            )}
          </div>

          {isSuperAdmin ? (
            <div className="space-y-1.5">
              <Label htmlFor="staff-school">المدرسة</Label>
              <Select name="schoolId" required>
                <SelectTrigger id="staff-school" className="w-full">
                  <SelectValue placeholder="اختر المدرسة" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.nameAr}
                      {!school.isActive ? " (موقوفة)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {state?.fieldErrors?.schoolId && (
                <p className="text-xs font-semibold text-destructive">
                  {state.fieldErrors.schoolId}
                </p>
              )}
            </div>
          ) : (
            <input type="hidden" name="schoolId" value={schoolId ?? ""} />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="staff-branch">الفرع (اختياري)</Label>
            {branches.length > 0 ? (
              <Select name="branchId">
                <SelectTrigger id="staff-branch" className="w-full">
                  <SelectValue placeholder="بدون فرع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون فرع</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="staff-branch"
                value={isSuperAdmin ? "تُعرض فروع المدرسة بعد اختيارها" : "لا توجد فروع بعد"}
                disabled
              />
            )}
            {state?.fieldErrors?.branchId && (
              <p className="text-xs font-semibold text-destructive">
                {state.fieldErrors.branchId}
              </p>
            )}
          </div>
        </div>

        <div>
          <CreateSubmitButton />
        </div>
      </form>
    </SectionCard>
  );
}
"use client";

import * as React from "react";
import { KeyRound, Loader2, Mail } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  changeOwnEmailAction,
  changeOwnPasswordAction,
  type AccountSecurityActionState,
} from "@/app/actions/account-security";

const initialState: AccountSecurityActionState = { ok: false };

/**
 * Batch 2 — the self-service security forms. After a successful
 * password change the server action re-issues the CURRENT session
 * cookie (all other devices stay logged out).
 */
export function AccountSecurityForms({ mode }: { mode: "password" | "email" }) {
  const { toast } = useToast();
  const [passwordState, passwordAction, passwordPending] = React.useActionState(
    changeOwnPasswordAction,
    initialState
  );
  const [emailState, emailAction, emailPending] = React.useActionState(
    changeOwnEmailAction,
    initialState
  );

  React.useEffect(() => {
    if (passwordState.ok && passwordState.message) {
      toast({ title: "تم التغيير 🔐", description: passwordState.message });
    }
  }, [passwordState, toast]);

  React.useEffect(() => {
    if (emailState.ok && emailState.message) {
      toast({ title: "تم التحديث ✉", description: emailState.message });
    }
  }, [emailState, toast]);

  if (mode === "password") {
    return (
      <form action={passwordAction} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="currentPassword">كلمة المرور الحالية</Label>
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
          {passwordState.fieldErrors?.currentPassword && (
            <p className="text-xs text-error">
              {passwordState.fieldErrors.currentPassword}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newPassword">كلمة المرور الجديدة</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          {passwordState.fieldErrors?.newPassword && (
            <p className="text-xs text-error">{passwordState.fieldErrors.newPassword}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">تأكيد كلمة المرور الجديدة</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          {passwordState.fieldErrors?.confirmPassword && (
            <p className="text-xs text-error">
              {passwordState.fieldErrors.confirmPassword}
            </p>
          )}
        </div>
        {passwordState.message && !passwordState.ok && (
          <p className="rounded-lg bg-error-soft px-3 py-2 text-sm text-error">
            {passwordState.message}
          </p>
        )}
        <Button type="submit" disabled={passwordPending} className="rounded-xl">
          {passwordPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          <KeyRound className="size-4" aria-hidden="true" />
          تغيير كلمة المرور
        </Button>
      </form>
    );
  }

  return (
    <form action={emailAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="emailCurrentPassword">كلمة المرور الحالية (للتأكيد)</Label>
        <Input
          id="emailCurrentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
        {emailState.fieldErrors?.currentPassword && (
          <p className="text-xs text-error">{emailState.fieldErrors.currentPassword}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="newEmail">البريد الإلكتروني الجديد</Label>
        <Input
          id="newEmail"
          name="newEmail"
          type="email"
          dir="ltr"
          autoComplete="email"
          required
        />
        {emailState.fieldErrors?.newEmail && (
          <p className="text-xs text-error">{emailState.fieldErrors.newEmail}</p>
        )}
      </div>
      {emailState.message && !emailState.ok && (
        <p className="rounded-lg bg-error-soft px-3 py-2 text-sm text-error">
          {emailState.message}
        </p>
      )}
      <Button type="submit" disabled={emailPending} className="rounded-xl">
        {emailPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        <Mail className="size-4" aria-hidden="true" />
        تغيير البريد الإلكتروني
      </Button>
    </form>
  );
}
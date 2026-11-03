"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Save } from "lucide-react";

import {
  updateOwnProfileAction,
  type UserFormState,
} from "@/app/actions/users";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ------------------------------------------------------------------ */
/* Self-service display-name edit. This is the ONLY self-mutation: the  */
/* server schema contains no other field, so role / school / branch /   */
/* supervisor / account state cannot be changed by the user.            */
/* ------------------------------------------------------------------ */

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <Save className="size-4" aria-hidden="true" />
      {pending ? "جارٍ الحفظ…" : "حفظ الاسم"}
    </Button>
  );
}

export function ProfileNameForm({ currentName }: { currentName: string }) {
  const [state, formAction] = React.useActionState<UserFormState | null, FormData>(
    updateOwnProfileAction,
    null
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state?.message && (
        <Alert
          variant={state.ok ? "default" : "destructive"}
          role={state.ok ? "status" : "alert"}
        >
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="profile-name">الاسم المعروض</Label>
        <Input
          id="profile-name"
          name="name"
          defaultValue={currentName}
          required
          minLength={2}
          maxLength={120}
        />
        {state?.fieldErrors?.name && (
          <p className="text-xs font-semibold text-destructive">
            {state.fieldErrors.name}
          </p>
        )}
      </div>
      <SaveButton />
      <p className="text-xs text-muted-foreground">
        لا يمكنك تعديل دورك أو مدرستك أو فرعك أو حالة حسابك — هذه البيانات تُدار من
        الإدارة المصرّح لها فقط.
      </p>
    </form>
  );
}
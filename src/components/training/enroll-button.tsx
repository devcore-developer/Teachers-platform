"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, UserPlus } from "lucide-react";

import {
  enrollAction,
  type TrainingFormState,
} from "@/app/actions/training";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/* Teacher enrollment — server-validated (role + school + published). */

function EnrollSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <UserPlus className="size-4" aria-hidden="true" />
      {pending ? "جارٍ التسجيل…" : "سجّل في الدورة"}
    </Button>
  );
}

export function EnrollButton({ courseId }: { courseId: string }) {
  const [state, formAction] = React.useActionState<
    TrainingFormState | null,
    FormData
  >(enrollAction, null);

  return (
    <div className="space-y-2">
      {state?.message && (
        <Alert variant={state.ok ? "default" : "destructive"} role={state.ok ? "status" : "alert"}>
          <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <form action={formAction}>
        <input type="hidden" name="courseId" value={courseId} />
        <EnrollSubmit />
      </form>
    </div>
  );
}
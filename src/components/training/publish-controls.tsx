"use client";

import * as React from "react";
import { Archive, Eye, Undo2 } from "lucide-react";

import {
  setCourseStatusAction,
  type TrainingFormState,
} from "@/app/actions/training";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/* Publish / unpublish / archive controls. The service validates the    */
/* course content before publishing and rejects unauthorized roles —    */
/* these buttons only carry the intent.                                 */
/* ------------------------------------------------------------------ */

interface PublishControlsProps {
  courseId: string;
  status: string;
}

export function PublishControls({ courseId, status }: PublishControlsProps) {
  const [state, formAction] = React.useActionState<
    TrainingFormState | null,
    FormData
  >(setCourseStatusAction, null);

  return (
    <div className="space-y-3">
      {state?.message && (
        <Alert variant={state.ok ? "default" : "destructive"} role={state.ok ? "status" : "alert"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="courseId" value={courseId} />

        {status !== "PUBLISHED" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="submit" name="status" value="PUBLISHED" size="sm">
                <Eye className="size-4" aria-hidden="true" />
                نشر الدورة
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>نشر الدورة</AlertDialogTitle>
                <AlertDialogDescription>
                  ستُنشر الدورة لجمهورها المصرح له (معلمو مدرستك أو جميع
                  المدارس إن كانت مشتركة). يتحقق النظام من اكتمال المحتوى
                  قبل النشر.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction>تأكيد النشر</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {status === "PUBLISHED" && (
          <Button
            type="submit"
            name="status"
            value="DRAFT"
            size="sm"
            variant="outline"
          >
            <Undo2 className="size-4" aria-hidden="true" />
            إرجاع إلى مسودة
          </Button>
        )}

        {status !== "ARCHIVED" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="submit"
                name="status"
                value="ARCHIVED"
                size="sm"
                variant="outline"
                className="text-warning hover:text-warning"
              >
                <Archive className="size-4" aria-hidden="true" />
                أرشفة
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>أرشفة الدورة</AlertDialogTitle>
                <AlertDialogDescription>
                  لن تظهر الدورة كتدريب متاح لدى المعلمين، وتبقى بياناتها
                  وسجلات التسجيل محفوظة. يمكنك إعادة نشرها لاحقًا.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction>تأكيد الأرشفة</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </form>
    </div>
  );
}
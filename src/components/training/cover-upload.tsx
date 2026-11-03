"use client";

import * as React from "react";
import { ImageUp, Trash2 } from "lucide-react";

import {
  deleteAttachmentAction,
  uploadCourseCoverAction,
  type TrainingFormState,
} from "@/app/actions/training";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ------------------------------------------------------------------ */
/* Course/program cover management — real upload through the server     */
/* action + storage adapter, replace deletes the previous file.         */
/* ------------------------------------------------------------------ */

interface CoverUploadProps {
  ownerType: "course" | "program";
  ownerId: string;
  currentCover: { id: string; name: string } | null;
}

export function CoverUpload({
  ownerType,
  ownerId,
  currentCover,
}: CoverUploadProps) {
  const [uploadState, uploadAction] = React.useActionState<
    TrainingFormState | null,
    FormData
  >(uploadCourseCoverAction, null);
  const [deleteState, deleteAction] = React.useActionState<
    TrainingFormState | null,
    FormData
  >(deleteAttachmentAction, null);

  const message = uploadState?.ok
    ? uploadState
    : deleteState?.ok
      ? deleteState
      : (!uploadState?.ok && uploadState?.message ? uploadState : (!deleteState?.ok && deleteState?.message ? deleteState : null));

  return (
    <div className="space-y-3">
      {currentCover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${currentCover.id}`}
          alt="صورة غلاف المحتوى"
          className="h-44 w-full max-w-md rounded-lg border object-cover"
        />
      ) : (
        <div className="flex h-44 w-full max-w-md items-center justify-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
          <span className="text-xs font-semibold">لا توجد صورة غلاف بعد</span>
        </div>
      )}

      {message?.message && (
        <Alert variant={message.ok ? "default" : "destructive"} role={message.ok ? "status" : "alert"}>
          <AlertDescription>{message.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <form action={uploadAction} className="space-y-1.5">
          <input type="hidden" name="ownerType" value={ownerType} />
          <input type="hidden" name="ownerId" value={ownerId} />
          <Label htmlFor="cover-file" className="sr-only">
            صورة الغلاف
          </Label>
          <Input
            id="cover-file"
            name="file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="w-72"
            required
          />
          <p className="text-[11px] text-muted-foreground">
            PNG أو JPG أو WebP — بحد أقصى 5 ميغابايت
          </p>
          <Button type="submit" size="sm" variant="outline">
            <ImageUp className="size-4" aria-hidden="true" />
            {uploadState?.ok ? "استبدال الغلاف" : "رفع الغلاف"}
          </Button>
        </form>

        {currentCover && (
          <form action={deleteAction}>
            <input type="hidden" name="attachmentId" value={currentCover.id} />
            {ownerType === "course" && (
              <input type="hidden" name="courseId" value={ownerId} />
            )}
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              إزالة الغلاف
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
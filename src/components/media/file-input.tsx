"use client";

import { MediaInput, type MediaKind } from "@/components/media/media-input";
import type { AttachTarget } from "@/app/actions/media";

/**
 * FileInput — <MediaInput kind="document"> preset for TRAINING
 * ATTACHMENTS: PDF / Word / Excel / PowerPoint / audio / images / text.
 * Files upload DIRECTLY from the browser to R2 via a presigned PUT
 * (progress bar) — never through the Next.js server — and register as
 * course attachments ({ attachTo: { type: "course-attachment" } }).
 */
export interface FileInputProps {
  value?: string | null | undefined;
  onChange: (url: string | null) => void;
  label?: string;
  hint?: string;
  /** Client-side size ceiling override (default 25MB, server-verified). */
  maxBytes?: number;
  disabled?: boolean;
  /** Course attachment registration target. */
  attachTo?: AttachTarget;
  deleteOnRemove?: boolean;
  className?: string;
}

export type { MediaKind };

export function FileInput({
  value,
  onChange,
  label,
  hint,
  maxBytes,
  disabled,
  attachTo,
  deleteOnRemove,
  className,
}: FileInputProps) {
  return (
    <MediaInput
      kind="document"
      value={value}
      onChange={onChange}
      label={label}
      hint={hint}
      maxBytes={maxBytes}
      disabled={disabled}
      attachTo={attachTo}
      deleteOnRemove={deleteOnRemove}
      className={className}
    />
  );
}
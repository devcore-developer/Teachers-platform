"use client";

import { MediaInput, type MediaKind } from "@/components/media/media-input";
import type { AttachTarget } from "@/app/actions/media";

/**
 * VideoInput — <MediaInput kind="video"> preset for video fields:
 * lesson videos, course trailers, … Large files upload DIRECTLY from
 * the browser to R2 via a presigned PUT (progress bar) — they never
 * stream through the Next.js server.
 * Both «رابط خارجي» and «رفع ملف» modes with inline playback preview.
 */
export interface VideoInputProps {
  value?: string | null | undefined;
  onChange: (url: string | null) => void;
  label?: string;
  hint?: string;
  /** Client-side size ceiling override (default 512MB, server-verified). */
  maxBytes?: number;
  disabled?: boolean;
  /** Lesson/cover registration target (course-builder integration). */
  attachTo?: AttachTarget;
  deleteOnRemove?: boolean;
  className?: string;
}

export type { MediaKind };

export function VideoInput({
  value,
  onChange,
  label,
  hint,
  maxBytes,
  disabled,
  attachTo,
  deleteOnRemove,
  className,
}: VideoInputProps) {
  return (
    <MediaInput
      kind="video"
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
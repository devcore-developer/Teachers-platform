"use client";

import { MediaInput } from "@/components/media/media-input";
import type { AttachTarget } from "@/app/actions/media";

/**
 * ImageInput — <MediaInput kind="image"> preset for image fields:
 * school logos, course/program covers, certificate art, …
 * Both «رابط خارجي» and «رفع ملف» modes with preview and validation.
 */
export interface ImageInputProps {
  value?: string | null | undefined;
  onChange: (url: string | null) => void;
  label?: string;
  hint?: string;
  /** Client-side size ceiling override (default 5MB, server-verified). */
  maxBytes?: number;
  disabled?: boolean;
  /** Fires when a file is chosen — e.g. logo palette analysis. */
  onFileSelected?: (file: File | null) => void;
  /** Cover registration target (course-builder integration). */
  attachTo?: AttachTarget;
  deleteOnRemove?: boolean;
  className?: string;
}

export function ImageInput({
  value,
  onChange,
  label,
  hint,
  maxBytes,
  disabled,
  onFileSelected,
  attachTo,
  deleteOnRemove,
  className,
}: ImageInputProps) {
  return (
    <MediaInput
      kind="image"
      value={value}
      onChange={onChange}
      label={label}
      hint={hint}
      maxBytes={maxBytes}
      disabled={disabled}
      onFileSelected={onFileSelected}
      attachTo={attachTo}
      deleteOnRemove={deleteOnRemove}
      className={className}
    />
  );
}
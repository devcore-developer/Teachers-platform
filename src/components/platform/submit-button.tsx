"use client";

import { useFormStatus } from "react-dom";

import { cn } from "@/lib/utils";

interface SubmitButtonProps extends React.ComponentProps<"button"> {
  children: React.ReactNode;
}

/**
 * Shared form-submit button with a pending state (react-dom
 * useFormStatus) — used by server-action forms across the platform.
 */
export function SubmitButton({ children, className, disabled, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    >
      {pending ? "جارٍ التنفيذ…" : children}
    </button>
  );
}
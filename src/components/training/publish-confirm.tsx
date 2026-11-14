"use client";

import { useEffect, useState } from "react";
import {
  Award,
  ClipboardCheck,
  Loader2,
  MonitorPlay,
  Rocket,
  Undo2,
} from "lucide-react";

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* PublishConfirmButton — a styled in-page confirmation modal that      */
/* replaces the browser's native confirm() bar on the publish action.   */
/*                                                                      */
/* Self-contained: overlay + centered card, RTL, fade/scale-in,         */
/* Escape / backdrop-click to cancel (blocked while pending), body      */
/* scroll lock, error surface that keeps the dialog open, and a         */
/* pending state on the confirm button. No new dependencies.            */
/*                                                                      */
/* The component never touches the server action itself — the caller    */
/* passes onConfirm (an async callback or a form requestSubmit) so it   */
/* plugs into the course builder, the unified editor and any other      */
/* publisher without coupling to a specific action module.              */
/* ------------------------------------------------------------------ */

export interface PublishConfirmButtonProps {
  /** Trigger label — default "نشر". */
  label?: string;
  /** Modal headline — default "تأكيد نشر التدريب". */
  title?: string;
  /** Main sentence under the headline. */
  description?: string;
  /** Confirm button label — default "تأكيد النشر". */
  confirmLabel?: string;
  /** Confirm label while the action runs — default "جارٍ النشر…". */
  pendingLabel?: string;
  /** Show the "you can undo this" strip — default true. */
  reversible?: boolean;
  /** Hide the trigger's rocket icon (e.g. unpublish variant). */
  hideIcon?: boolean;
  className?: string;
  disabled?: boolean;
  /**
   * The real publish work. Return { ok: false, message } to keep the
   * modal open and surface the error, anything else closes it.
   */
  onConfirm:
    | (() => Promise<{ ok: boolean; message?: string } | void> | void)
    | (() => Promise<{ ok: boolean; message?: string } | void> | void);
}

const defaultTrigger =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#1D5BD6] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#174aa8] disabled:cursor-not-allowed disabled:opacity-70";

export function PublishConfirmButton({
  label = "نشر",
  title = "تأكيد نشر التدريب",
  description = "سيصبح التدريب متاحًا فورًا لمعلمي المدرسة، وستُفتح لهم الرحلة الإلزامية.",
  confirmLabel = "تأكيد النشر",
  pendingLabel = "جارٍ النشر…",
  reversible = true,
  hideIcon = false,
  className,
  disabled = false,
  onConfirm,
}: PublishConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Transition-in + body scroll lock while the modal is open. */
  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  /* Escape cancels — but never while the action is running. */
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, pending]);

  async function handleConfirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm();
      if (result && result.ok === false) {
        setError(result.message ?? "تعذر إتمام العملية — حاول مرة أخرى");
        return;
      }
      setOpen(false);
    } catch {
      setError("حدث خطأ غير متوقع — حاول مرة أخرى");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={cn(defaultTrigger, className)}
      >
        {!hideIcon && <Rocket className="size-4" aria-hidden="true" />}
        {label}
      </button>

      {open && (
        <div
          className={cn(
            "fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-200",
            shown ? "opacity-100" : "opacity-0"
          )}
        >
          {/* Backdrop — click to cancel (ignored while pending). */}
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]"
            aria-hidden="true"
            onMouseDown={() => {
              if (!pending) setOpen(false);
            }}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-confirm-title"
            className={cn(
              "relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 transition-all duration-200",
              shown
                ? "translate-y-0 scale-100 opacity-100"
                : "translate-y-3 scale-95 opacity-0"
            )}
          >
            {/* Headline */}
            <div className="flex flex-col items-center px-6 pb-4 pt-8 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1D5BD6] to-[#4F46E5] text-white shadow-lg shadow-blue-600/25 ring-4 ring-blue-100">
                <Rocket className="size-7" aria-hidden="true" />
              </div>
              <h2
                id="publish-confirm-title"
                className="mt-4 text-lg font-extrabold text-slate-900"
              >
                {title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {description}
              </p>
            </div>

            {/* What publishing turns on — mirrors the real platform rules */}
            <ul className="mx-6 space-y-2 rounded-xl bg-slate-50 p-3">
              <li className="flex items-center gap-2.5 text-xs font-semibold text-slate-700">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#1D5BD6]">
                  <MonitorPlay className="size-4" aria-hidden="true" />
                </span>
                الدروس تُشاهد بالترتيب — الإتمام بالمشاهدة الفعلية فقط
              </li>
              <li className="flex items-center gap-2.5 text-xs font-semibold text-slate-700">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#1D5BD6]">
                  <ClipboardCheck className="size-4" aria-hidden="true" />
                </span>
                اختبار الدورة يُفتح للمعلم بعد إتمام كل الدروس
              </li>
              <li className="flex items-center gap-2.5 text-xs font-semibold text-slate-700">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#1D5BD6]">
                  <Award className="size-4" aria-hidden="true" />
                </span>
                شهادة إتمام تلقائية بعد النجاح في الاختبار
              </li>
            </ul>

            {reversible && (
              <p className="mx-6 mt-3 flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                <Undo2 className="size-3.5 shrink-0" aria-hidden="true" />
                يمكنك التراجع في أي وقت بإعادة الحالة إلى مسودة من نفس الأزرار.
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="mx-6 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
              >
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="mt-5 grid grid-cols-2 gap-3 px-6 pb-6">
              <button
                type="button"
                autoFocus
                disabled={pending}
                onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleConfirm}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1D5BD6] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#174aa8] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    {pendingLabel}
                  </>
                ) : (
                  <>
                    <Rocket className="size-4" aria-hidden="true" />
                    {confirmLabel}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
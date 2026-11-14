"use client";

import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { AlertTriangle, BellRing, Rocket, Trash2 } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Styled dialogs — replace the browser's native confirm() / alert().   */
/*                                                                      */
/* Imperative one-liners (no JSX wiring — the dialog mounts itself      */
/* on document.body):                                                   */
/*                                                                      */
/*    if (!(await confirmDialog({ description: "…", tone: "danger" }))) return; */
/*    await alertDialog({ description: result.message, tone: "danger" });       */
/*                                                                      */
/* And the hook API (when a component wants the dialog in its own JSX): */
/*                                                                      */
/*    const { confirm, host } = useConfirmDialog();                     */
/*    render {host} once, then: if (!(await confirm({ … }))) return;    */
/*                                                                      */
/* confirmDialog resolves true only on the confirm button;              */
/* alertDialog is informational and always resolves true.               */
/* Escape / backdrop click / cancel resolve false.                      */
/* ------------------------------------------------------------------ */

export type ConfirmTone = "brand" | "danger";

export interface ConfirmOptions {
  /** Headline — tone-dependent default. */
  title?: string;
  /** Main sentence under the headline. */
  description: string;
  /** Confirm button label — tone-dependent default. */
  confirmLabel?: string;
  /** Cancel button label — default "إلغاء". */
  cancelLabel?: string;
  /** "brand" = blue publish-style, "danger" = red delete-style. */
  tone?: ConfirmTone;
}

export interface AlertOptions {
  /** Headline — tone-dependent default. */
  title?: string;
  /** Main sentence under the headline. */
  description: string;
  /** Single button label — default "حسناً". */
  buttonLabel?: string;
  /** "danger" = red warning, "brand" = blue notice. */
  tone?: ConfirmTone;
}

const TONE_DEFAULTS: Record<
  ConfirmTone,
  { title: string; confirmLabel: string }
> = {
  brand: { title: "تأكيد العملية", confirmLabel: "تأكيد" },
  danger: { title: "تأكيد الحذف", confirmLabel: "حذف نهائي" },
};

const ALERT_DEFAULTS: Record<ConfirmTone, { title: string; buttonLabel: string }> =
  {
    brand: { title: "تنبيه", buttonLabel: "حسناً" },
    danger: { title: "تعذّر إتمام العملية", buttonLabel: "حسناً" },
  };

/* ------------------------- Shared chrome --------------------------- */

function useDialogChrome(onFinish: (value: boolean) => void) {
  const [shown, setShown] = React.useState(false);
  const settledRef = React.useRef(false);

  const finish = React.useCallback(
    (value: boolean) => {
      if (settledRef.current) return;
      settledRef.current = true;
      onFinish(value);
    },
    [onFinish]
  );

  /* Transition-in + body scroll lock while the dialog is open. */
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  /* Escape dismisses. */
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") finish(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish]);

  return { shown, finish };
}

function DialogFrame({
  shown,
  onBackdrop,
  children,
}: {
  shown: boolean;
  onBackdrop: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-200 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Backdrop — click to dismiss. */}
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]"
        aria-hidden="true"
        onMouseDown={onBackdrop}
      />

      <div
        role="dialog"
        aria-modal="true"
        className={`relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 transition-all duration-200 ${
          shown
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-95 opacity-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/* -------------------------- Confirm modal -------------------------- */

function ConfirmDialogModal({
  options,
  onFinish,
}: {
  options: ConfirmOptions;
  onFinish: (value: boolean) => void;
}) {
  const { shown, finish } = useDialogChrome(onFinish);
  const danger = options.tone === "danger";

  return (
    <DialogFrame shown={shown} onBackdrop={() => finish(false)}>
      {/* Headline */}
      <div className="flex flex-col items-center px-6 pb-4 pt-8 text-center">
        <div
          className={`flex size-14 items-center justify-center rounded-2xl text-white shadow-lg ring-4 ${
            danger
              ? "bg-gradient-to-br from-red-500 to-rose-600 shadow-red-600/25 ring-red-100"
              : "bg-gradient-to-br from-[#1D5BD6] to-[#4F46E5] shadow-blue-600/25 ring-blue-100"
          }`}
        >
          {danger ? (
            <Trash2 className="size-7" aria-hidden="true" />
          ) : (
            <Rocket className="size-7" aria-hidden="true" />
          )}
        </div>
        <h2
          id="confirm-dialog-title"
          className="mt-4 text-lg font-extrabold text-slate-900"
        >
          {options.title ?? TONE_DEFAULTS[options.tone ?? "brand"].title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          {options.description}
        </p>
      </div>

      {/* Actions */}
      <div className="mt-5 grid grid-cols-2 gap-3 px-6 pb-6">
        <button
          type="button"
          autoFocus
          onClick={() => finish(false)}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
        >
          {options.cancelLabel ?? "إلغاء"}
        </button>
        <button
          type="button"
          onClick={() => finish(true)}
          className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm transition ${
            danger
              ? "bg-destructive hover:bg-destructive/90"
              : "bg-[#1D5BD6] hover:bg-[#174aa8]"
          }`}
        >
          {options.confirmLabel ??
            TONE_DEFAULTS[options.tone ?? "brand"].confirmLabel}
        </button>
      </div>
    </DialogFrame>
  );
}

/* --------------------------- Alert modal --------------------------- */

function AlertDialogModal({
  options,
  onFinish,
}: {
  options: AlertOptions;
  onFinish: (value: boolean) => void;
}) {
  const { shown, finish } = useDialogChrome(onFinish);
  const danger = options.tone === "danger";
  const defaults = ALERT_DEFAULTS[options.tone ?? "danger"];

  return (
    <DialogFrame shown={shown} onBackdrop={() => finish(false)}>
      <div className="flex flex-col items-center px-6 pb-4 pt-8 text-center">
        <div
          className={`flex size-14 items-center justify-center rounded-2xl text-white shadow-lg ring-4 ${
            danger
              ? "bg-gradient-to-br from-red-500 to-rose-600 shadow-red-600/25 ring-red-100"
              : "bg-gradient-to-br from-[#1D5BD6] to-[#4F46E5] shadow-blue-600/25 ring-blue-100"
          }`}
        >
          {danger ? (
            <AlertTriangle className="size-7" aria-hidden="true" />
          ) : (
            <BellRing className="size-7" aria-hidden="true" />
          )}
        </div>
        <h2
          id="alert-dialog-title"
          className="mt-4 text-lg font-extrabold text-slate-900"
        >
          {options.title ?? defaults.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          {options.description}
        </p>
      </div>

      {/* Single dismiss button. */}
      <div className="px-6 pb-6 pt-1">
        <button
          type="button"
          autoFocus
          onClick={() => finish(true)}
          className={`w-full rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-sm transition ${
            danger
              ? "bg-destructive hover:bg-destructive/90"
              : "bg-[#1D5BD6] hover:bg-[#174aa8]"
          }`}
        >
          {options.buttonLabel ?? defaults.buttonLabel}
        </button>
      </div>
    </DialogFrame>
  );
}

/* ------------------------- Hook-based API -------------------------- */

export function useConfirmDialog() {
  const [pending, setPending] = React.useState<ConfirmOptions | null>(null);
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

  const confirm = React.useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPending(options);
    });
  }, []);

  const finish = React.useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
    setPending(null);
  }, []);

  const host = pending ? (
    <ConfirmDialogModal options={pending} onFinish={finish} />
  ) : null;

  return { confirm, host };
}

/* ---------------------- Imperative singleton ----------------------- */

let dialogContainer: HTMLDivElement | null = null;
let dialogRoot: Root | null = null;
let activeFinish: ((value: boolean) => void) | null = null;

function presentDialog(
  render: (finish: (value: boolean) => void) => React.ReactNode
): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);

  // A second call while a dialog is open auto-cancels the first one
  // (mirrors how the browser shows only one native dialog at a time).
  if (activeFinish) activeFinish(false);

  return new Promise<boolean>((resolve) => {
    dialogContainer = document.createElement("div");
    dialogContainer.setAttribute("data-confirm-dialog-root", "true");
    document.body.appendChild(dialogContainer);
    dialogRoot = createRoot(dialogContainer);

    activeFinish = (value) => {
      activeFinish = null;
      resolve(value);
      dialogRoot?.unmount();
      dialogRoot = null;
      dialogContainer?.remove();
      dialogContainer = null;
    };

    dialogRoot.render(render(activeFinish));
  });
}

/**
 * Promise-based styled confirm — drop-in replacement for window.confirm
 * inside async handlers:
 *
 * if (!(await confirmDialog({ description: "…", tone: "danger" }))) return;
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return presentDialog((finish) => (
    <ConfirmDialogModal options={options} onFinish={finish} />
  ));
}

/**
 * Promise-based styled alert — drop-in replacement for window.alert
 * inside async handlers:
 *
 * await alertDialog({ title: "تعذّر الحفظ", description: message, tone: "danger" });
 */
export function alertDialog(options: AlertOptions): Promise<boolean> {
  return presentDialog((finish) => (
    <AlertDialogModal options={options} onFinish={finish} />
  ));
}
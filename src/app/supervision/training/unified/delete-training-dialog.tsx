"use client";

/* ------------------------------------------------------------------ */
/* Destructive Delete control for ONE training — trigger + secure       */
/* confirmation dialog.                                                 */
/*                                                                      */
/* Deliberately SEPARATE from every Edit affordance:                    */
/*   • the trigger is a red outlined button that sits NEXT TO the blue  */
/*     Edit/open actions (never inside them),                           */
/*   • clicking it deletes NOTHING — it only opens this dialog,         */
/*   • the dialog states plainly that deletion is permanent, lists what */
/*     is removed with it, and demands the exact case-sensitive word    */
/*     DELETE typed by hand; the permanent-delete button stays DISABLED */
/*     until the input matches exactly (any other value is rejected),   */
/*   • while the request runs the dialog is locked (no Escape/backdrop  */
/*     close, buttons disabled) with a spinner, then it reports success */
/*     or error feedback before navigating back to the list.            */
/* Accessible: role=dialog + aria-modal + labelled/described-by ids,    */
/* focus moves to the confirmation input on open and returns to the     */
/* trigger on close, live validation feedback, Escape cancels when idle.*/
/* Responsive: bottom-sheet on phones, centered card on desktop.        */
/* ------------------------------------------------------------------ */

import { useRouter } from "next/navigation";
import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, Trash2 } from "lucide-react";

import { deleteSupervisorTrainingAction } from "@/app/actions/supervision-training";

/** The ONLY accepted confirmation value — exact, case-sensitive. */
const CONFIRM_WORD = "DELETE";

interface DeleteResult {
  ok: boolean;
  message?: string;
  data?: { id: string; mediaCleanupFailures?: number };
}

const deletedItems: string[] = [
  "فيديوهات الدروس والمرفقات — وملفاتها المرفوعة من التخزين السحابي",
  "الأقسام والدروس وكل محتواها",
  "الاختبار النهائي: الأسئلة والخيارات والإجابات الصحيحة",
  "محاولات المعلمين ودرجاتهم وتصحيح الأسئلة المقالية",
  "أداة قياس الأثر: أسئلتها وردود المعلمين ونتائجها",
  "الشهادات وسجلات الإكمال الصادرة لهذا التدريب",
  "تسجيلات المعلمين وتقدمهم وسجلات المشاهدة وتعليقات التدريب",
];

export function DeleteTrainingButton({
  courseId,
  courseTitle,
  lessonsCount = 0,
  size = "card",
}: {
  courseId: string;
  courseTitle: string;
  lessonsCount?: number;
  /** "card" = small row button in the list, "page" = larger editor header button. */
  size?: "card" | "page";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const redirectTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  const exactMatch = confirmText === CONFIRM_WORD;
  const mismatch = confirmText.length > 0 && !exactMatch;

  function openDialog() {
    setConfirmText("");
    setError(null);
    setSuccess(null);
    setOpen(true);
  }

  function closeDialog() {
    if (pending) return; // locked while the request runs
    setOpen(false);
    setConfirmText("");
    setError(null);
    setSuccess(null);
  }

  // Focus the input on open, lock page scroll, Escape cancels when idle.
  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 30);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDialog();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(focusTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  // Return focus to the trigger when the dialog closes.
  React.useEffect(() => {
    if (!open) triggerRef.current?.focus();
  }, [open]);

  function backToList() {
    router.push("/supervision/training");
    router.refresh();
  }

  async function confirmDelete() {
    if (pending || success) return;
    if (confirmText !== CONFIRM_WORD) {
      setError("النص غير مطابق — اكتب DELETE بالأحرف اللاتينية الكبيرة بالضبط (حساسة لحالة الأحرف).");
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = (await deleteSupervisorTrainingAction(courseId)) as DeleteResult;
      setPending(false);
      if (!result.ok) {
        setError(result.message ?? "تعذر حذف التدريب — تأكد من حالة الاتصال وأعد المحاولة.");
        return;
      }
      const failures = result.data?.mediaCleanupFailures ?? 0;
      setSuccess(
        failures > 0
          ? `تم حذف التدريب نهائيًا — تعذر إزالة ${failures} ملفًا من التخزين وستتولى الصيانة الدورية إزالتها.`
          : "تم حذف التدريب نهائيًا مع كل محتوياته."
      );
      redirectTimer.current = setTimeout(backToList, failures > 0 ? 3500 : 1200);
    } catch {
      setPending(false);
      setError("حدث خطأ غير متوقع — لم يتم الحذف. أعد المحاولة.");
    }
  }

  const triggerClasses =
    size === "page"
      ? "inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-card px-3.5 py-2 text-xs font-bold text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
      : "inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-card px-3 py-1.5 text-xs font-bold text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        className={triggerClasses}
        aria-haspopup="dialog"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {size === "page" ? "حذف التدريب" : "حذف"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
          onClick={closeDialog}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-training-title"
            aria-describedby="delete-training-desc"
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border bg-card shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                  <ShieldAlert className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 id="delete-training-title" className="text-sm font-black text-foreground">
                    حذف التدريب نهائيًا
                  </h2>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground" dir="auto">
                    {courseTitle}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 px-4 py-4">
              <p
                id="delete-training-desc"
                className="text-xs leading-relaxed text-foreground"
              >
                هذه العملية <strong className="font-black">نهائية ولا يمكن التراجع عنها</strong>.
                سيُحذف التدريب من مدرستك مع
                {lessonsCount > 0 ? ` ${lessonsCount} عنصر محتوى و` : " "}
                كل ما يرتبط به:
              </p>

              <ul className="space-y-1.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
                {deletedItems.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground">
                    <Trash2 className="mt-0.5 size-3 shrink-0 text-destructive" aria-hidden="true" />
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>

              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                بعد التأكيد تُحذف البيانات نهائيًا ولا يمكن استرجاعها بأي شكل — التدريبات الأخرى
                وبيانات المعلمين في باقي التدريبات لن تتأثر.
              </p>

              <div>
                <label htmlFor="delete-confirm-input" className="mb-1 block text-xs font-bold text-foreground">
                  للتأكيد اكتب{" "}
                  <span className="font-mono font-black text-destructive" dir="ltr">
                    DELETE
                  </span>{" "}
                  بالأحرف اللاتينية الكبيرة (حساسة لحالة الأحرف)
                </label>
                <input
                  id="delete-confirm-input"
                  ref={inputRef}
                  value={confirmText}
                  onChange={(event) => {
                    setConfirmText(event.target.value);
                    setError(null);
                  }}
                  disabled={pending || success !== null}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  dir="ltr"
                  placeholder="DELETE"
                  aria-invalid={mismatch}
                  aria-describedby="delete-confirm-hint"
                  className="h-10 w-full rounded-lg border bg-card px-3 font-mono text-sm tracking-widest outline-none transition-colors focus:border-destructive disabled:opacity-60"
                />
                <p
                  id="delete-confirm-hint"
                  role={mismatch ? "alert" : "status"}
                  className={`mt-1.5 flex items-center gap-1 text-[11px] font-semibold ${
                    exactMatch
                      ? "text-success"
                      : mismatch
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {exactMatch ? (
                    <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertTriangle
                      className={`size-3.5 shrink-0 ${mismatch ? "" : "opacity-0"}`}
                      aria-hidden="true"
                    />
                  )}
                  {exactMatch
                    ? "مطابق — يمكنك المتابعة بالحذف النهائي."
                    : mismatch
                      ? "غير مطابق — يجب كتابة DELETE بالأحرف الكبيرة بالضبط."
                      : "زر الحذف يبقى معطلًا حتى يطابق النص بالضبط."}
                </p>
              </div>

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] font-bold leading-relaxed text-destructive"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{error}</span>
                </p>
              )}
              {success && (
                <p
                  role="status"
                  className="flex items-start gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-[11px] font-bold leading-relaxed text-success"
                >
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{success}</span>
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDialog}
                disabled={pending}
                className="w-full rounded-lg border bg-card px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={pending || !exactMatch || success !== null}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-destructive px-4 py-2.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-4" aria-hidden="true" />
                )}
                {pending ? "جارٍ الحذف…" : "حذف نهائي"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
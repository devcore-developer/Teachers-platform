// ======================================================================
// src/components/schools/delete-school-dialog.tsx  (ملف جديد)
// ======================================================================
"use client";

/* ------------------------------------------------------------------ */
/* Destructive Delete control for ONE school — trigger + secure         */
/* confirmation dialog (SUPER_ADMIN only; visibility is decided by the  */
/* server page, and the action re-verifies the role on every call).     */
/*                                                                      */
/* Mirrors the training delete dialog's safety contract, scaled up to   */
/* a whole tenant:                                                      */
/*   • clicking the trigger deletes NOTHING — it only opens this dialog,*/
/*   • the dialog states plainly that deletion is permanent and lists   */
/*     what is removed with it (accounts, courses, exams, assignments,  */
/*     certificates, surveys, follow-ups, archives, storage files),     */
/*   • the permanent-delete button stays DISABLED until the user types  */
/*     the school's full Arabic name EXACTLY as displayed (trim-compared*/
/*     only for accidental whitespace) — proving the target is the      */
/*     intended school, not "DELETE" repeated from muscle memory,       */
/*   • while the request runs the dialog is locked (no Escape/backdrop  */
/*     close, buttons disabled) with a spinner, then reports success or */
/*     error before the directory refreshes.                            */
/* Accessible: role=dialog + aria-modal + labelled/described-by ids,    */
/* focus moves to the confirmation input on open and returns to the     */
/* trigger on close, live validation feedback, Escape cancels when idle.*/
/* Responsive: bottom-sheet on phones, centered card on desktop.        */
/* ------------------------------------------------------------------ */

import { useRouter } from "next/navigation";
import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, Trash2 } from "lucide-react";

import { deleteSchoolAction } from "@/app/actions/schools";

interface DeleteResult {
  ok: boolean;
  message?: string;
  data?: { id: string; nameAr: string; storageCleanupFailures?: number };
}

const deletedItems: string[] = [
  "كل الفروع والمراحل التعليمية المسجلة للمدرسة",
  "حسابات كل مستخدميها: المعلمين والمشرفين ومدير المدرسة والوكيل ومنسق التقنية — مع إبطال جلساتهم فورًا",
  "التدريبات والبرامج: الفيديوهات والمرفقات والاختبارات والأسئلة ومحاولات المعلمين ودرجاتهم",
  "الواجبات وتسليمات المعلمين وملفاتها والدرجات والمعايير",
  "الشهادات الصادرة باسم المدرسة — وأرقامها ورموز التحقق لن تعمل بعد الحذف",
  "استبانات قياس الأثر وردود المعلمين وسجلات المتابعة والأرشيف السنوي",
  "ملفات التخزين المرتبطة بها (الشعارات والفيديوهات والمرفقات وتسليمات الواجبات)",
];

export function DeleteSchoolButton({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  // Trim comparison only forgives accidental whitespace — the name
  // itself must still match exactly, character for character.
  const exactMatch = confirmText.trim() === schoolName.trim();
  const mismatch = confirmText.trim().length > 0 && !exactMatch;

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

  async function confirmDelete() {
    if (pending || success) return;
    if (!exactMatch) {
      setError("الاسم غير مطابق — اكتب اسم المدرسة كاملًا كما هو معروض بالأعلى.");
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = (await deleteSchoolAction(schoolId)) as DeleteResult;
      setPending(false);
      if (!result.ok) {
        setError(result.message ?? "تعذر حذف المدرسة — تأكد من حالة الاتصال وأعد المحاولة.");
        return;
      }
      const failures = result.data?.storageCleanupFailures ?? 0;
      setSuccess(
        failures > 0
          ? `تم حذف المدرسة نهائيًا مع كل بياناتها — تعذر إزالة ${failures} ملفًا من التخزين وستتولى الصيانة الدورية إزالتها.`
          : "تم حذف المدرسة نهائيًا مع كل بياناتها وملفاتها."
      );
      refreshTimer.current = setTimeout(() => router.refresh(), failures > 0 ? 3500 : 1500);
    } catch {
      setPending(false);
      setError("حدث خطأ غير متوقع — لم يتم الحذف. أعد المحاولة.");
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-label={`حذف ${schoolName} نهائيًا`}
        title="حذف المدرسة نهائيًا"
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2 className="size-4" aria-hidden="true" />
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
            aria-labelledby="delete-school-title"
            aria-describedby="delete-school-desc"
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border bg-card shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                  <ShieldAlert className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 id="delete-school-title" className="text-sm font-black text-foreground">
                    حذف المدرسة نهائيًا بكل بياناتها
                  </h2>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {schoolName}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 px-4 py-4">
              <p
                id="delete-school-desc"
                className="text-xs leading-relaxed text-foreground"
              >
                هذه العملية <strong className="font-black">نهائية ولا يمكن التراجع عنها</strong>.
                ستُحذف المدرسة من المنصة مع كل ما يتبعها:
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
                باقي مدارس المنصة والمحتوى العام (المنصّة المشتركة) لن يتأثر. إذا
                كانت المطلوب إيقاف المدرسة مؤقتًا فقط دون حذف بياناتها، استخدم
                «إيقاف/تفعيل» من صفحة المدرسة بدلًا من هذه العملية.
              </p>

              <div>
                <label htmlFor="delete-school-confirm-input" className="mb-1 block text-xs font-bold text-foreground">
                  للتأكيد اكتب اسم المدرسة كاملًا كما هو معروض أعلاه
                </label>
                <input
                  id="delete-school-confirm-input"
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
                  placeholder={schoolName}
                  aria-invalid={mismatch}
                  aria-describedby="delete-school-confirm-hint"
                  className="h-10 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors focus:border-destructive disabled:opacity-60"
                />
                <p
                  id="delete-school-confirm-hint"
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
                      ? "غير مطابق — يجب كتابة اسم المدرسة بالضبط كما هو معروض."
                      : "زر الحذف يبقى معطلًا حتى يطابق الاسم بالضبط."}
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
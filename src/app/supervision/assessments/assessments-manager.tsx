"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2 } from "lucide-react";

import { createSupervisorAssessmentAction } from "@/app/actions/supervision-training";

/* ------------------------------------------------------------------ */
/* Supervisor assessment creation (school scope hard-bound on server).  */
/* ------------------------------------------------------------------ */

interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: { id?: string };
}

export function AssessmentsCreateForm({
  courses,
}: {
  courses: Array<{ id: string; titleAr: string }>;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setFeedback(null);
    setFieldErrors({});

    const result = (await createSupervisorAssessmentAction({
      titleAr: String(data.get("titleAr") ?? ""),
      instructionsAr: String(data.get("instructionsAr") ?? ""),
      courseId: String(data.get("courseId") ?? "") || undefined,
      passingScore: Number(data.get("passingScore") ?? 1),
      timeLimitMinutes: data.get("timeLimitMinutes")
        ? Number(data.get("timeLimitMinutes"))
        : undefined,
      attemptLimit: data.get("attemptLimit") ? Number(data.get("attemptLimit")) : undefined,
    })) as ActionResult;

    setPending(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      setFeedback({ bad: true, text: result.message ?? "تعذر إنشاء الاختبار." });
      return;
    }
    form.reset();
    setFeedback({ bad: false, text: "تم إنشاء الاختبار كمسودة — أضف أسئلته الآن." });
    if (result.data?.id) {
      router.push(`/supervision/assessments/${result.data.id}`);
    }
    router.refresh();
  }

  const inputClass =
    "h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors focus:border-brand-600";

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border bg-card p-4" noValidate>
      <div className="flex items-center gap-2">
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-600/10 text-brand-600">
          <ClipboardCheck className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-black text-foreground">اختبار جديد</h2>
          <p className="text-[11px] text-muted-foreground">
            يُنشأ داخل مدرستك كمسودة — الربط بدورة اختياري، والنشر بعد إضافة الأسئلة.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold">عنوان الاختبار *</span>
          <input name="titleAr" className={inputClass} maxLength={150} required />
          {fieldErrors.titleAr && (
            <span className="mt-1 block text-[11px] font-semibold text-destructive">
              {fieldErrors.titleAr}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">الدورة المرتبطة (اختياري)</span>
          <select name="courseId" className={inputClass} defaultValue="">
            <option value="">— بدون ربط —</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.titleAr}
              </option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-bold">تعليمات الأداء *</span>
          <textarea
            name="instructionsAr"
            rows={2}
            className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-brand-600"
            maxLength={2000}
            required
            placeholder="مثال: اختر الإجابة الصحيحة لكل سؤال — لديك محاولة واحدة."
          />
          {fieldErrors.instructionsAr && (
            <span className="mt-1 block text-[11px] font-semibold text-destructive">
              {fieldErrors.instructionsAr}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">درجة النجاح (من مجموع الدرجات) *</span>
          <input name="passingScore" type="number" min={1} max={1000} defaultValue={10} className={inputClass} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">الحد الزمني بالدقائق (اختياري)</span>
          <input name="timeLimitMinutes" type="number" min={1} max={300} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">عدد المحاولات المسموح (اختياري)</span>
          <input name="attemptLimit" type="number" min={1} max={10} className={inputClass} />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ClipboardCheck className="size-4" aria-hidden="true" />
          )}
          إنشاء الاختبار
        </button>
        {feedback && (
          <p
            className={`flex items-center gap-1 text-xs font-semibold ${
              feedback.bad ? "text-destructive" : "text-success"
            }`}
            role={feedback.bad ? "alert" : "status"}
          >
            {feedback.bad ? (
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            {feedback.text}
          </p>
        )}
      </div>
    </form>
  );
}
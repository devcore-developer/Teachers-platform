"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus } from "lucide-react";

import { createSupervisorCourseAction } from "@/app/actions/supervision-training";

/* ------------------------------------------------------------------ */
/* Supervisor course creation form (school scope hard-bound server-side */
/* — the form never sends a schoolId).                                  */
/* ------------------------------------------------------------------ */

interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: { id?: string };
}

const LEVELS = [
  { value: "BEGINNER", label: "مبتدئ" },
  { value: "INTERMEDIATE", label: "متوسط" },
  { value: "ADVANCED", label: "متقدم" },
];

export function SupervisorCourseForm({
  categories,
  programs,
}: {
  categories: string[];
  programs: Array<{ id: string; nameAr: string; platformWide: boolean }>;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<
    { bad: boolean; text: string } | null
  >(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setFeedback(null);
    setFieldErrors({});

    const result = (await createSupervisorCourseAction({
      titleAr: String(data.get("titleAr") ?? ""),
      titleEn: String(data.get("titleEn") ?? "") || undefined,
      descriptionAr: String(data.get("descriptionAr") ?? ""),
      descriptionEn: String(data.get("descriptionEn") ?? "") || undefined,
      category: String(data.get("category") ?? ""),
      level: String(data.get("level") ?? "") || undefined,
      estimatedHours: data.get("estimatedHours")
        ? Number(data.get("estimatedHours"))
        : undefined,
      programId: String(data.get("programId") ?? "") || undefined,
    })) as ActionResult;

    setPending(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      setFeedback({ bad: true, text: result.message ?? "تعذر إنشاء الدورة." });
      return;
    }
    form.reset();
    setFeedback({ bad: false, text: "تم إنشاء الدورة كمسودة — أكمل بناء محتواها الآن." });
    if (result.data?.id) {
      router.push(`/supervision/training/${result.data.id}`);
    }
    router.refresh();
  }

  const inputClass =
    "h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors focus:border-brand-600";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border bg-card p-4"
      noValidate
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-600/10 text-brand-600">
          <Plus className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-black text-foreground">دورة تدريبية جديدة</h2>
          <p className="text-[11px] text-muted-foreground">
            تُنشأ داخل مدرستك كمسودة — النشر من شاشة البناء بعد إضافة المحتوى.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-foreground">
            عنوان الدورة بالعربية *
          </span>
          <input name="titleAr" className={inputClass} maxLength={150} required />
          {fieldErrors.titleAr && (
            <span className="mt-1 block text-[11px] font-semibold text-destructive">
              {fieldErrors.titleAr}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-foreground">
            العنوان بالإنجليزية (اختياري)
          </span>
          <input name="titleEn" className={inputClass} maxLength={150} dir="ltr" />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-bold text-foreground">
            الوصف بالعربية *
          </span>
          <textarea
            name="descriptionAr"
            rows={3}
            className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-brand-600"
            maxLength={4000}
            required
          />
          {fieldErrors.descriptionAr && (
            <span className="mt-1 block text-[11px] font-semibold text-destructive">
              {fieldErrors.descriptionAr}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-foreground">
            التصنيف *
          </span>
          <input
            name="category"
            className={inputClass}
            list="supervisor-course-categories"
            maxLength={60}
            required
            placeholder="اختر من التصنيفات المستخدمة أو اكتب مفتاحًا جديدًا"
          />
          <datalist id="supervisor-course-categories">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          {fieldErrors.category && (
            <span className="mt-1 block text-[11px] font-semibold text-destructive">
              {fieldErrors.category}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-foreground">
            المستوى (اختياري)
          </span>
          <select name="level" className={inputClass} defaultValue="">
            <option value="">— بدون —</option>
            {LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-foreground">
            الساعات المتوقعة (اختياري)
          </span>
          <input
            name="estimatedHours"
            type="number"
            min={1}
            max={200}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-foreground">
            البرنامج التدريبي (اختياري)
          </span>
          <select name="programId" className={inputClass} defaultValue="">
            <option value="">— بدون برنامج —</option>
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.nameAr}
                {program.platformWide ? " (مشترك)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
          إنشاء الدورة
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
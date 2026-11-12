"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ClipboardList, Loader2, Plus, TrendingUp, Trash2 } from "lucide-react";

import {
  createSupervisorImpactSurveyAction,
  setSupervisorImpactSurveyStatusAction,
} from "@/app/actions/supervision-training";
import type { TrainingWorkspace } from "@/lib/supervision/training";

import { Feedback, SectionCard } from "./unified-editor";

/* ------------------------------------------------------------------ */
/* Training Impact Measurement — the EXISTING survey system embedded in */
/* the unified page (Survey stage AFTER_TRAINING + SurveyQuestion).     */
/* Response types: Rating Scale (1–5), Yes/No, Multiple Choice, Text.   */
/* Teachers answer it ONLY after completing the journey (the server     */
/* unlocks it post-certificate) — same models, same results screens.    */
/* ------------------------------------------------------------------ */

interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: { id?: string };
}

const inputClass =
  "h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors focus:border-brand-600";

/** The four spec'd response types (the service supports more). */
const IMPACT_TYPES = [
  { value: "RATING", label: "مقياس تقييم (1–5)" },
  { value: "YES_NO", label: "نعم / لا" },
  { value: "SINGLE_CHOICE", label: "اختيار من متعدد" },
  { value: "LONG_TEXT", label: "إجابة نصية" },
];

interface DraftQuestion {
  textAr: string;
  type: string;
  required: boolean;
  options: string[];
}

function emptyQuestion(): DraftQuestion {
  return { textAr: "", type: "RATING", required: true, options: ["", ""] };
}

export function TrainingImpactSection({
  courseId,
  workspace,
}: {
  courseId: string;
  workspace: TrainingWorkspace;
}) {
  const survey = workspace.survey;
  return (
    <SectionCard
      icon={<TrendingUp className="size-4" aria-hidden="true" />}
      title="قياس أثر التدريب"
      description="أداة قياس تُفتح للمعلم بعد اجتياز الاختبار والحصول على الشهادة — استجاباتها تُحفظ على مستوى المعلم والتدريب والمدرسة."
    >
      {survey ? (
        <ImpactSummary courseId={courseId} survey={survey} />
      ) : (
        <ImpactCreateForm courseId={courseId} />
      )}
    </SectionCard>
  );
}

function ImpactSummary({
  survey,
}: {
  courseId: string;
  survey: NonNullable<TrainingWorkspace["survey"]>;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function run(action: "PUBLISH" | "CLOSE" | "ARCHIVE", confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setPending(true);
    const result = await setSupervisorImpactSurveyStatusAction({
      surveyId: survey.id,
      action,
    });
    setPending(false);
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-foreground">{survey.titleAr}</p>
          <p className="text-[10px] text-muted-foreground">
            {survey.questionsCount} سؤالًا ·{" "}
            {survey.status === "PUBLISHED"
              ? "منشورة — تظهر للمعلمين بعد إتمام الرحلة"
              : survey.status === "DRAFT"
                ? "مسودة — تُنشر تلقائيًا مع «نشر التدريب»"
                : survey.status === "CLOSED"
                  ? "مغلقة للاستجابات الجديدة"
                  : survey.status}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {survey.status === "DRAFT" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run("PUBLISH", "نشر الأداة يفتحها لمعلمي التدريب — متابعة؟")}
              className="rounded-lg bg-brand-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              نشر
            </button>
          )}
          {survey.status === "PUBLISHED" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run("CLOSE", "إغلاق الأداة يمنع استجابات جديدة — متابعة؟")}
              className="rounded-lg border bg-card px-2.5 py-1 text-[11px] font-bold text-muted-foreground hover:bg-accent disabled:opacity-60"
            >
              إغلاق
            </button>
          )}
          {survey.status !== "PUBLISHED" && survey.status !== "DRAFT" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run("ARCHIVE", "أرشفة الأداة؟ تُخفى نهائيًا.")}
              className="inline-flex items-center gap-1 rounded-lg border bg-card px-2.5 py-1 text-[11px] font-bold text-destructive hover:bg-accent disabled:opacity-60"
            >
              <Trash2 className="size-3" aria-hidden="true" />
              أرشفة
            </button>
          )}
        </div>
      </div>
      <Link
        href="/supervision/impact"
        className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-bold text-brand-600 hover:bg-accent"
      >
        <ClipboardList className="size-3.5" aria-hidden="true" />
        عرض نتائج قياس الأثر
      </Link>
    </div>
  );
}

function ImpactCreateForm({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [questions, setQuestions] = React.useState<DraftQuestion[]>([emptyQuestion()]);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  function updateQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((current) =>
      current.map((question, position) =>
        position === index ? { ...question, ...patch } : question
      )
    );
  }

  async function submit() {
    if (pending) return;
    if (title.trim().length < 3) {
      setFeedback({ bad: true, text: "عنوان أداة القياس مطلوب." });
      return;
    }
    const cleanedQuestions = questions.map((question) => ({
      textAr: question.textAr.trim(),
      type: question.type,
      required: question.required,
      options:
        question.type === "SINGLE_CHOICE"
          ? question.options.map((option) => option.trim()).filter(Boolean)
          : undefined,
    }));
    if (cleanedQuestions.some((question) => question.textAr.length < 3)) {
      setFeedback({ bad: true, text: "أكمل نص كل سؤال (3 أحرف على الأقل)." });
      return;
    }
    setPending(true);
    setFeedback(null);
    const result = (await createSupervisorImpactSurveyAction({
      courseId,
      titleAr: title.trim(),
      purposeAr: purpose.trim() || undefined,
      questions: cleanedQuestions,
    })) as ActionResult;
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذر إنشاء أداة القياس." });
      return;
    }
    setOpen(false);
    setFeedback({ bad: false, text: "تم إنشاء أداة قياس الأثر — تُنشر مع «نشر التدريب»." });
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        إضافة أداة قياس أثر
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {feedback && <Feedback {...feedback} />}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold">عنوان الأداة *</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
            maxLength={150}
            placeholder="مثال: أثر التدريب على الممارسات الصفية"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">الغرض (يظهر للمعلم)</span>
          <input
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            className={inputClass}
            maxLength={500}
          />
        </label>
      </div>

      <div className="space-y-2">
        <span className="block text-xs font-bold">الأسئلة *</span>
        {questions.map((question, index) => (
          <div key={index} className="rounded-xl border p-3">
            <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
              <input
                value={question.textAr}
                onChange={(event) => updateQuestion(index, { textAr: event.target.value })}
                placeholder={`نص السؤال ${index + 1}`}
                className={inputClass}
                maxLength={300}
              />
              <select
                value={question.type}
                onChange={(event) => updateQuestion(index, { type: event.target.value })}
                className={inputClass}
              >
                {IMPACT_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] font-bold">
                  <input
                    type="checkbox"
                    checked={question.required}
                    onChange={(event) => updateQuestion(index, { required: event.target.checked })}
                    className="size-3.5 accent-[var(--brand-600)]"
                  />
                  إجباري
                </label>
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setQuestions((current) => current.filter((_, position) => position !== index))
                    }
                    className="text-destructive"
                    aria-label="حذف السؤال"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            {question.type === "SINGLE_CHOICE" && (
              <div className="mt-2 space-y-1.5">
                {question.options.map((option, optionIndex) => (
                  <input
                    key={optionIndex}
                    value={option}
                    onChange={(event) =>
                      updateQuestion(index, {
                        options: question.options.map((value, position) =>
                          position === optionIndex ? event.target.value : value
                        ),
                      })
                    }
                    placeholder={`الخيار ${optionIndex + 1}`}
                    className={inputClass}
                    maxLength={120}
                  />
                ))}
                {question.options.length < 10 && (
                  <button
                    type="button"
                    onClick={() => updateQuestion(index, { options: [...question.options, ""] })}
                    className="text-[11px] font-bold text-brand-600 hover:underline"
                  >
                    + إضافة خيار
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setQuestions((current) => [...current, emptyQuestion()])}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-bold text-brand-600 hover:bg-accent"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          إضافة سؤال
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          حفظ الأداة
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border bg-card px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-accent"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
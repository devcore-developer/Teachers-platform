"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

import {
  createSupervisorImpactSurveyAction,
  setSupervisorImpactSurveyStatusAction,
} from "@/app/actions/supervision-training";

/* ------------------------------------------------------------------ */
/* Impact authoring UI — survey creation with a dynamic question        */
/* builder, plus publish/close actions per survey row.                  */
/* ------------------------------------------------------------------ */

interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: { id?: string };
}

const QUESTION_TYPES = [
  { value: "RATING", label: "تقييم من 1 إلى 5" },
  { value: "YES_NO", label: "نعم / لا" },
  { value: "SINGLE_CHOICE", label: "اختيار مفرد" },
  { value: "MULTI_CHOICE", label: "اختيار متعدد" },
  { value: "SHORT_TEXT", label: "إجابة قصيرة" },
  { value: "LONG_TEXT", label: "إجابة مطولة" },
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

export function ImpactCreateForm({
  courses,
}: {
  courses: Array<{ id: string; titleAr: string }>;
}) {
  const router = useRouter();
  const [courseId, setCourseId] = React.useState(courses[0]?.id ?? "");
  const [title, setTitle] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [questions, setQuestions] = React.useState<DraftQuestion[]>([emptyQuestion()]);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  const inputClass =
    "h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors focus:border-brand-600";

  function updateQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((current) =>
      current.map((question, position) =>
        position === index ? { ...question, ...patch } : question
      )
    );
  }

  async function submit() {
    if (pending) return;
    if (!courseId) {
      setFeedback({ bad: true, text: "اختر الدورة أولًا." });
      return;
    }
    if (title.trim().length < 3) {
      setFeedback({ bad: true, text: "عنوان الأداة مطلوب." });
      return;
    }
    if (questions.length === 0) {
      setFeedback({ bad: true, text: "أضف سؤالًا واحدًا على الأقل." });
      return;
    }
    setPending(true);
    setFeedback(null);
    const result = (await createSupervisorImpactSurveyAction({
      courseId,
      titleAr: title.trim(),
      purposeAr: purpose.trim() || undefined,
      questions: questions.map((question) => ({
        textAr: question.textAr.trim(),
        type: question.type,
        required: question.required,
        options:
          question.type === "SINGLE_CHOICE" || question.type === "MULTI_CHOICE"
            ? question.options.map((option) => option.trim()).filter(Boolean)
            : undefined,
      })),
    })) as ActionResult;
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذر إنشاء أداة القياس." });
      return;
    }
    setTitle("");
    setPurpose("");
    setQuestions([emptyQuestion()]);
    setFeedback({ bad: false, text: "تم إنشاء الأداة كمسودة — انشرها من القائمة أدناه." });
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="rounded-xl border bg-card p-4"
      noValidate
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-600/10 text-brand-600">
          <ClipboardList className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-black text-foreground">أداة قياس أثر جديدة</h2>
          <p className="text-[11px] text-muted-foreground">
            تُربط بدورة واحدة وتُنشأ داخل مدرستك — يجيب عنها المعلمون بعد إتمام الدورة.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold">الدورة *</span>
          <select
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            className={inputClass}
          >
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.titleAr}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">عنوان الأداة *</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
            maxLength={150}
            placeholder="مثال: أثر تدريب الاستراتيجيات الحديثة"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-bold">الغرض (يظهر للمعلم)</span>
          <input
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            className={inputClass}
            maxLength={500}
          />
        </label>
      </div>

      <div className="mt-4 space-y-2">
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
                {QUESTION_TYPES.map((option) => (
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
            {(question.type === "SINGLE_CHOICE" || question.type === "MULTI_CHOICE") && (
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
                    onClick={() =>
                      updateQuestion(index, { options: [...question.options, ""] })
                    }
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

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ClipboardList className="size-4" aria-hidden="true" />
          )}
          إنشاء الأداة
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

export function ImpactSurveyActions({
  surveyId,
  status,
}: {
  surveyId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function run(action: "PUBLISH" | "CLOSE" | "ARCHIVE", confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setPending(true);
    const result = await setSupervisorImpactSurveyStatusAction({ surveyId, action });
    setPending(false);
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    router.refresh();
  }

  if (status === "DRAFT") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => run("PUBLISH", "نشر الأداة يفتحها لمعلمي الدورة — متابعة؟")}
        className="rounded-lg bg-brand-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        نشر
      </button>
    );
  }
  if (status === "PUBLISHED") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => run("CLOSE", "إغلاق الأداة يمنع استجابات جديدة — متابعة؟")}
        className="rounded-lg border bg-card px-2.5 py-1 text-[11px] font-bold text-muted-foreground hover:bg-accent disabled:opacity-60"
      >
        إغلاق
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run("ARCHIVE", "أرشفة الأداة؟ تُخفى من القائمة نهائيًا.")}
      className="rounded-lg border bg-card px-2.5 py-1 text-[11px] font-bold text-destructive hover:bg-accent disabled:opacity-60"
    >
      أرشفة
    </button>
  );
}
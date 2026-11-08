"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import {
  addSupervisorQuestionAction,
  deleteSupervisorQuestionAction,
  editSupervisorQuestionAction,
  moveSupervisorQuestionAction,
  setSupervisorAssessmentStatusAction,
  updateSupervisorAssessmentAction,
} from "@/app/actions/supervision-training";

/* ------------------------------------------------------------------ */
/* Supervisor question editor — settings, question CRUD (4 platform     */
/* types), publish workflow. The answer key never renders for teachers; */
/* here it is the supervisor's own authoring surface.                   */
/* ------------------------------------------------------------------ */

interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: { id?: string };
}

interface QuestionRow {
  id: string;
  type: string;
  textAr: string;
  points: number;
  isRequired: boolean;
  orderIndex: number;
  options: Array<{ id: string; textAr: string }>;
  explanation: string | null;
}

const QUESTION_TYPES = [
  { value: "SINGLE_CHOICE", label: "اختيار مفرد" },
  { value: "MULTIPLE_CHOICE", label: "اختيار متعدد" },
  { value: "TRUE_FALSE", label: "صح وخطأ" },
  { value: "SHORT_ANSWER", label: "إجابة قصيرة (تصحيح يدوي)" },
];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة",
  PUBLISHED: "منشور",
  CLOSED: "مغلق",
  ARCHIVED: "مؤرشف",
};

const inputClass =
  "h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors focus:border-brand-600";

export function AssessmentsEditor({
  assessment,
  questions,
  courses,
}: {
  assessment: {
    id: string;
    titleAr: string;
    instructionsAr: string;
    status: string;
    courseId: string | null;
    passingScore: number;
    timeLimitMinutes: number | null;
    attemptLimit: number | null;
    maxScore: number;
  };
  questions: QuestionRow[];
  courses: Array<{ id: string; titleAr: string }>;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function run(action: () => Promise<ActionResult>, successText?: string) {
    setBusy(true);
    setFeedback(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذرت العملية." });
      return false;
    }
    if (successText) setFeedback({ bad: false, text: successText });
    router.refresh();
    return true;
  }

  async function changeStatus(next: string, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    await run(
      () => setSupervisorAssessmentStatusAction({ assessmentId: assessment.id, status: next }),
      "تم تحديث حالة الاختبار."
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/supervision/assessments" className="text-[11px] font-bold text-brand-600 hover:underline">
            ← الاختبارات
          </Link>
          <h1 className="mt-1 truncate text-xl font-black text-foreground">{assessment.titleAr}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {STATUS_LABEL[assessment.status] ?? assessment.status} · مجموع الدرجات{" "}
            <span className="font-bold tabular-nums">{assessment.maxScore}</span> · درجة
            النجاح <span className="font-bold tabular-nums">{assessment.passingScore}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {assessment.status !== "PUBLISHED" && assessment.status !== "ARCHIVED" && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                changeStatus(
                  "PUBLISHED",
                  `نشر الاختبار يجعله متاحًا لمعلمي المدرسة (مجموع ${assessment.maxScore} نقطة) — متابعة؟`
                )
              }
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              نشر الاختبار
            </button>
          )}
          {assessment.status === "PUBLISHED" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => changeStatus("CLOSED", "إغلاق الاختبار يمنع محاولات جديدة — متابعة؟")}
              className="rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-muted-foreground hover:bg-accent disabled:opacity-60"
            >
              إغلاق
            </button>
          )}
        </div>
      </header>

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

      <SettingsEditor
        assessment={assessment}
        courses={courses}
        onSaved={() => router.refresh()}
      />

      <section className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-black text-foreground">الأسئلة ({questions.length})</h2>
        </div>
        <div className="space-y-3 p-4">
          {questions.length === 0 && (
            <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
              لا أسئلة بعد — أضف أول سؤال من النموذج أدناه.
            </p>
          )}
          {questions.map((question, index) => (
            <div key={question.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground">
                    {index + 1}. {question.textAr}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {QUESTION_TYPES.find((type) => type.value === question.type)?.label ??
                      question.type}{" "}
                    · {question.points} نقطة/نقاط {question.isRequired ? "· إجباري" : ""}
                  </p>
                  {question.options.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {question.options.map((option) => (
                        <li key={option.id} className="text-[11px] text-muted-foreground">
                          • {option.textAr}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="تحريك لأعلى"
                    disabled={busy || index === 0}
                    onClick={() =>
                      run(() =>
                        moveSupervisorQuestionAction({
                          assessmentId: assessment.id,
                          questionId: question.id,
                          direction: "up",
                        })
                      )
                    }
                    className="inline-flex size-7 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:bg-accent disabled:opacity-40"
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    title="تحريك لأسفل"
                    disabled={busy || index === questions.length - 1}
                    onClick={() =>
                      run(() =>
                        moveSupervisorQuestionAction({
                          assessmentId: assessment.id,
                          questionId: question.id,
                          direction: "down",
                        })
                      )
                    }
                    className="inline-flex size-7 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:bg-accent disabled:opacity-40"
                  >
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    title="حذف السؤال"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm("حذف هذا السؤال نهائيًا — متابعة؟")) return;
                      await run(() =>
                        deleteSupervisorQuestionAction({
                          assessmentId: assessment.id,
                          questionId: question.id,
                        })
                      );
                    }}
                    className="inline-flex size-7 items-center justify-center rounded-lg border bg-card text-destructive hover:bg-accent disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {assessment.status !== "PUBLISHED" ? (
            <QuestionAddForm
              assessmentId={assessment.id}
              onAdded={() => run(async () => ({ ok: true }))}
            />
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
              الاختبار منشور — أغلقه أولًا لتتمكن من تعديل الأسئلة.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

/* --------------------------- Settings ------------------------------ */

function SettingsEditor({
  assessment,
  courses,
  onSaved,
}: {
  assessment: AssessmentsEditorProps["assessment"];
  courses: AssessmentsEditorProps["courses"];
  onSaved: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setFeedback(null);
    const result = (await updateSupervisorAssessmentAction({
      assessmentId: assessment.id,
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
      setFeedback({ bad: true, text: result.message ?? "تعذر حفظ الإعدادات." });
      return;
    }
    setFeedback({ bad: false, text: "تم حفظ إعدادات الاختبار." });
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border bg-card p-4" noValidate>
      <h2 className="text-sm font-black text-foreground">إعدادات الاختبار</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold">العنوان *</span>
          <input name="titleAr" defaultValue={assessment.titleAr} className={inputClass} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">الدورة المرتبطة</span>
          <select name="courseId" defaultValue={assessment.courseId ?? ""} className={inputClass}>
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
            defaultValue={assessment.instructionsAr}
            rows={2}
            className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-brand-600"
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">درجة النجاح *</span>
          <input
            name="passingScore"
            type="number"
            min={1}
            max={1000}
            defaultValue={assessment.passingScore}
            className={inputClass}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">الحد الزمني (دقائق)</span>
          <input
            name="timeLimitMinutes"
            type="number"
            min={1}
            max={300}
            defaultValue={assessment.timeLimitMinutes ?? ""}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">عدد المحاولات المسموح</span>
          <input
            name="attemptLimit"
            type="number"
            min={1}
            max={10}
            defaultValue={assessment.attemptLimit ?? ""}
            className={inputClass}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
          حفظ الإعدادات
        </button>
        {feedback && (
          <p
            className={`flex items-center gap-1 text-xs font-semibold ${
              feedback.bad ? "text-destructive" : "text-success"
            }`}
          >
            {feedback.text}
          </p>
        )}
      </div>
    </form>
  );
}

interface AssessmentsEditorProps {
  assessment: {
    id: string;
    titleAr: string;
    instructionsAr: string;
    status: string;
    courseId: string | null;
    passingScore: number;
    timeLimitMinutes: number | null;
    attemptLimit: number | null;
    maxScore: number;
  };
  questions: QuestionRow[];
  courses: Array<{ id: string; titleAr: string }>;
}

/* --------------------------- Add question -------------------------- */

function QuestionAddForm({
  assessmentId,
  onAdded,
}: {
  assessmentId: string;
  onAdded: () => void;
}) {
  const [type, setType] = React.useState("SINGLE_CHOICE");
  const [text, setText] = React.useState("");
  const [points, setPoints] = React.useState(1);
  const [required, setRequired] = React.useState(true);
  const [explanation, setExplanation] = React.useState("");
  const [options, setOptions] = React.useState<string[]>(["", ""]);
  const [correctIndexes, setCorrectIndexes] = React.useState<number[]>([0]);
  const [trueFalse, setTrueFalse] = React.useState("true");
  const [modelAnswer, setModelAnswer] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  const isChoice = type === "SINGLE_CHOICE" || type === "MULTIPLE_CHOICE";

  async function submit() {
    if (pending) return;
    if (text.trim().length < 3) {
      setFeedback({ bad: true, text: "نص السؤال مطلوب (3 أحرف على الأقل)." });
      return;
    }
    if (isChoice && options.filter((option) => option.trim()).length < 2) {
      setFeedback({ bad: true, text: "أضف خيارين على الأقل." });
      return;
    }
    if (isChoice && correctIndexes.length === 0) {
      setFeedback({ bad: true, text: "حدد الإجابة/الإجابات الصحيحة." });
      return;
    }
    if (type === "SHORT_ANSWER" && modelAnswer.trim().length === 0) {
      setFeedback({ bad: true, text: "الإجابة النموذجية مطلوبة للتصحيح اليدوي." });
      return;
    }

    setPending(true);
    setFeedback(null);
    const payload: Record<string, unknown> = {
      assessmentId,
      type,
      textAr: text.trim(),
      points,
      isRequired: required,
      explanation: explanation.trim() || undefined,
    };
    if (isChoice) {
      payload.options = options
        .filter((option) => option.trim())
        .map((option, index) => ({ id: `opt-${index + 1}`, textAr: option.trim() }));
      payload.correctOptionIndexes = correctIndexes;
    }
    if (type === "TRUE_FALSE") {
      payload.correctValue = trueFalse === "true";
    }
    if (type === "SHORT_ANSWER") {
      payload.modelAnswer = modelAnswer.trim();
    }

    const result = (await addSupervisorQuestionAction(payload)) as ActionResult;
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذر إضافة السؤال." });
      return;
    }
    setText("");
    setExplanation("");
    setModelAnswer("");
    setOptions(["", ""]);
    setCorrectIndexes([0]);
    setFeedback({ bad: false, text: "تمت إضافة السؤال." });
    onAdded();
  }

  return (
    <div className="rounded-xl border border-dashed p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-black text-foreground">
        <Plus className="size-3.5" aria-hidden="true" />
        سؤال جديد
      </h3>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-bold">نص السؤال *</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            maxLength={1000}
            className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-brand-600"
          />
        </label>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold">نوع السؤال *</span>
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setCorrectIndexes([0]);
              }}
              className={inputClass}
            >
              {QUESTION_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold">الدرجة *</span>
            <input
              type="number"
              min={1}
              max={100}
              value={points}
              onChange={(event) => setPoints(Number(event.target.value))}
              className={inputClass}
            />
          </label>
        </div>
      </div>

      {isChoice && (
        <div className="mt-3 space-y-2">
          <span className="block text-xs font-bold">الخيارات *</span>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type={type === "SINGLE_CHOICE" ? "radio" : "checkbox"}
                checked={correctIndexes.includes(index)}
                onChange={(event) =>
                  setCorrectIndexes((current) =>
                    type === "SINGLE_CHOICE"
                      ? [index]
                      : event.target.checked
                        ? [...current, index]
                        : current.filter((value) => value !== index)
                  )
                }
                className="size-3.5 shrink-0 accent-[var(--brand-600)]"
                aria-label={`الإجابة الصحيحة رقم ${index + 1}`}
              />
              <input
                value={option}
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((value, position) =>
                      position === index ? event.target.value : value
                    )
                  )
                }
                placeholder={`الخيار ${index + 1}`}
                className={inputClass}
                maxLength={300}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() =>
                    setOptions((current) => current.filter((_, position) => position !== index))
                  }
                  className="text-destructive"
                  aria-label="حذف الخيار"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button
              type="button"
              onClick={() => setOptions((current) => [...current, ""])}
              className="text-[11px] font-bold text-brand-600 hover:underline"
            >
              + إضافة خيار
            </button>
          )}
        </div>
      )}

      {type === "TRUE_FALSE" && (
        <label className="mt-3 block max-w-48">
          <span className="mb-1 block text-xs font-bold">الإجابة الصحيحة *</span>
          <select value={trueFalse} onChange={(event) => setTrueFalse(event.target.value)} className={inputClass}>
            <option value="true">صح</option>
            <option value="false">خطأ</option>
          </select>
        </label>
      )}

      {type === "SHORT_ANSWER" && (
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-bold">الإجابة النموذجية (للتصحيح اليدوي) *</span>
          <textarea
            value={modelAnswer}
            onChange={(event) => setModelAnswer(event.target.value)}
            rows={2}
            maxLength={1000}
            className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-brand-600"
          />
        </label>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs font-bold">
          <input
            type="checkbox"
            checked={required}
            onChange={(event) => setRequired(event.target.checked)}
            className="size-3.5 accent-[var(--brand-600)]"
          />
          سؤال إجباري
        </label>
        <label className="min-w-0 flex-1">
          <input
            value={explanation}
            onChange={(event) => setExplanation(event.target.value)}
            placeholder="تفسير الإجابة الصحيحة (اختياري)"
            className={inputClass}
            maxLength={500}
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
          إضافة السؤال
        </button>
        {feedback && (
          <p
            className={`flex items-center gap-1 text-xs font-semibold ${
              feedback.bad ? "text-destructive" : "text-success"
            }`}
          >
            {feedback.text}
          </p>
        )}
      </div>
    </div>
  );
}
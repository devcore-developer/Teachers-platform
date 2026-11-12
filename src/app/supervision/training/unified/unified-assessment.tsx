"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import {
  addSupervisorQuestionAction,
  createSupervisorAssessmentAction,
  deleteSupervisorQuestionAction,
  editSupervisorQuestionAction,
  moveSupervisorQuestionAction,
  setSupervisorAssessmentPassingPercentAction,
  updateSupervisorAssessmentAction,
} from "@/app/actions/supervision-training";
import { DEFAULT_PASSING_PERCENT } from "@/config/training-domains";
import type { TrainingWorkspace } from "@/lib/supervision/training";

import { Feedback, SectionCard } from "./unified-editor";
import { SmallIconButton } from "./unified-content";

/* ------------------------------------------------------------------ */
/* Final assessment — the EXISTING assessment engine embedded in the    */
/* unified page: same Assessment/AssessmentQuestion models, same        */
/* question types, same automatic + manual grading. Passing score is    */
/* configured as a PERCENTAGE (default 60%) and recomputed into points  */
/* on the server whenever it changes or on publish.                     */
/* ------------------------------------------------------------------ */

interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: { id?: string };
}

const inputClass =
  "h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors focus:border-brand-600";

const QUESTION_TYPES = [
  { value: "SINGLE_CHOICE", label: "اختيار مفرد" },
  { value: "MULTIPLE_CHOICE", label: "اختيار متعدد" },
  { value: "TRUE_FALSE", label: "صح وخطأ" },
  { value: "SHORT_ANSWER", label: "إجابة مقالية (تصحيح يدوي)" },
];

type QuestionType = (typeof QUESTION_TYPES)[number]["value"];

export function TrainingAssessmentSection({
  courseId,
  workspace,
}: {
  courseId: string;
  workspace: TrainingWorkspace;
}) {
  const assessment = workspace.assessment;

  return (
    <SectionCard
      icon={<Plus className="size-4" aria-hidden="true" />}
      title="الاختبار النهائي"
      description="أسئلة الاختبار ونسبتها الادائية — تصحيح آلي للاختيار، ويدوي للمقالي قبل إصدار الشهادة."
    >
      {assessment ? (
        <AssessmentEditor courseId={courseId} assessment={assessment} />
      ) : (
        <AssessmentCreateForm courseId={courseId} courseTitle={workspace.course.titleAr} />
      )}
    </SectionCard>
  );
}

/* ------------------------- create form ----------------------------- */

function AssessmentCreateForm({
  courseId,
  courseTitle,
}: {
  courseId: string;
  courseTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setFeedback(null);
    const attemptLimit = Number(data.get("attemptLimit") ?? 1);
    const timeLimitRaw = String(data.get("timeLimitMinutes") ?? "").trim();
    const result = (await createSupervisorAssessmentAction({
      courseId,
      titleAr: String(data.get("titleAr") ?? "").trim() || `الاختبار النهائي — ${courseTitle}`.slice(0, 150),
      instructionsAr:
        String(data.get("instructionsAr") ?? "").trim() ||
        "أجب عن جميع الأسئلة ثم سلّم إجاباتك — النجاح في الاختبار شرط لإصدار الشهادة.",
      passingScore: 1,
      attemptLimit: Number.isFinite(attemptLimit) && attemptLimit >= 1 ? Math.min(10, attemptLimit) : 1,
      timeLimitMinutes:
        timeLimitRaw && Number.isFinite(Number(timeLimitRaw)) && Number(timeLimitRaw) >= 1
          ? Math.min(300, Number(timeLimitRaw))
          : undefined,
    })) as ActionResult;
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذر إنشاء الاختبار." });
      return;
    }
    setFeedback({ bad: false, text: "تم إنشاء الاختبار — أضف أسئلته الآن." });
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
        إنشاء الاختبار النهائي
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-bold">عنوان الاختبار</span>
          <input
            name="titleAr"
            className={inputClass}
            maxLength={150}
            placeholder={`الاختبار النهائي — ${courseTitle}`}
          />
        </label>
        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs font-bold">تعليمات الاختبار</span>
          <textarea
            name="instructionsAr"
            rows={2}
            className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-brand-600"
            placeholder="أجب عن جميع الأسئلة ثم سلّم إجاباتك — النجاح شرط لإصدار الشهادة."
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">عدد المحاولات المسموح</span>
          <input name="attemptLimit" type="number" min={1} max={10} defaultValue={1} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">مدة الاختبار بالدقائق (اختياري)</span>
          <input name="timeLimitMinutes" type="number" min={1} max={300} className={inputClass} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          إنشاء الاختبار
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border bg-card px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-accent"
        >
          إلغاء
        </button>
        {feedback && <Feedback {...feedback} />}
      </div>
    </form>
  );
}

/* -------------------------- editor --------------------------------- */

type WorkspaceQuestion = NonNullable<
  TrainingWorkspace["assessment"]
>["questions"][number];

function AssessmentEditor({
  courseId,
  assessment,
}: {
  courseId: string;
  assessment: {
    id: string;
    titleAr: string;
    instructionsAr: string;
    status: string;
    passingScore: number;
    maxScore: number;
    passingPercent: number | null;
    attemptLimit: number | null;
    timeLimitMinutes: number | null;
    questions: WorkspaceQuestion[];
  };
}) {
  const router = useRouter();
  const [addingQuestion, setAddingQuestion] = React.useState(false);
  const [editingQuestionId, setEditingQuestionId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);
  const [pending, setPending] = React.useState(false);

  const displayPercent =
    assessment.passingPercent ??
    (assessment.maxScore > 0
      ? Math.round((assessment.passingScore / assessment.maxScore) * 100)
      : DEFAULT_PASSING_PERCENT);

  async function act(action: () => Promise<ActionResult>, successText?: string): Promise<boolean> {
    setPending(true);
    setFeedback(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذرت العملية." });
      return false;
    }
    setFeedback(successText ? { bad: false, text: successText } : null);
    router.refresh();
    return true;
  }

  async function changePercent(percent: number) {
    await act(
      () =>
        setSupervisorAssessmentPassingPercentAction({
          assessmentId: assessment.id,
          passingPercent: percent,
        }),
      `تم ضبط درجة النجاح على ${percent}%.`
    );
  }

  return (
    <div className="space-y-4">
      {feedback && <Feedback {...feedback} />}

      {/* Settings summary + passing percent */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/20 p-3">
        <div className="min-w-0 text-xs">
          <p className="font-bold text-foreground">{assessment.titleAr}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {assessment.questions.length} سؤالًا · مجموع النقاط {assessment.maxScore} ·
            درجة النجاح {assessment.passingScore}/{assessment.maxScore || "—"} نقطة
            {assessment.attemptLimit ? ` · ${assessment.attemptLimit} محاولات` : " · محاولات غير محدودة"}
            {assessment.timeLimitMinutes ? ` · ${assessment.timeLimitMinutes} دقيقة` : ""}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold">
          <span className="whitespace-nowrap">نسبة النجاح %</span>
          <select
            value={displayPercent}
            disabled={pending || assessment.status === "ARCHIVED"}
            onChange={(event) => void changePercent(Number(event.target.value))}
            className={`${inputClass} h-8 w-20`}
          >
            {[40, 50, 60, 70, 75, 80, 85, 90].map((percent) => (
              <option key={percent} value={percent}>
                {percent}%
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Questions */}
      <ul className="space-y-2">
        {assessment.questions.map((question, index) =>
          editingQuestionId === question.id ? (
            <li key={question.id}>
              <QuestionForm
                assessmentId={assessment.id}
                question={question}
                onDone={async (payload) => {
                  setEditingQuestionId(null);
                  if (!payload) return;
                  await act(() =>
                    payload.kind === "add"
                      ? addSupervisorQuestionAction(payload.body)
                      : editSupervisorQuestionAction(payload.body)
                  );
                }}
              />
            </li>
          ) : (
            <li key={question.id} className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground">
                    {index + 1}. {question.textAr}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {QUESTION_TYPES.find((option) => option.value === question.type)?.label ??
                      question.type}{" "}
                    · {question.points} نقطة {question.isRequired ? "· إجباري" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <SmallIconButton
                    label="تحريك لأعلى"
                    disabled={pending || index === 0}
                    onClick={() =>
                      act(() =>
                        moveSupervisorQuestionAction({
                          assessmentId: assessment.id,
                          questionId: question.id,
                          direction: "up",
                        })
                      )
                    }
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </SmallIconButton>
                  <SmallIconButton
                    label="تحريك لأسفل"
                    disabled={pending || index === assessment.questions.length - 1}
                    onClick={() =>
                      act(() =>
                        moveSupervisorQuestionAction({
                          assessmentId: assessment.id,
                          questionId: question.id,
                          direction: "down",
                        })
                      )
                    }
                  >
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </SmallIconButton>
                  <SmallIconButton label="تعديل السؤال" onClick={() => setEditingQuestionId(question.id)}>
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </SmallIconButton>
                  <SmallIconButton
                    label="حذف السؤال"
                    destructive
                    disabled={pending}
                    onClick={async () => {
                      if (!window.confirm("حذف هذا السؤال نهائيًا — متابعة؟")) return;
                      await act(() =>
                        deleteSupervisorQuestionAction({ questionId: question.id })
                      );
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </SmallIconButton>
                </div>
              </div>
            </li>
          )
        )}
      </ul>

      {addingQuestion ? (
        <QuestionForm
          assessmentId={assessment.id}
          question={null}
          onDone={async (payload) => {
            setAddingQuestion(false);
            if (!payload) return;
            await act(() =>
              payload.kind === "add"
                ? addSupervisorQuestionAction(payload.body)
                : editSupervisorQuestionAction(payload.body)
            );
          }}
        />
      ) : (
        <button
          type="button"
          disabled={assessment.status === "ARCHIVED"}
          onClick={() => setAddingQuestion(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-bold text-brand-600 hover:bg-accent disabled:opacity-60"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          إضافة سؤال
        </button>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        أسئلة الاختيار تُصحَّح آليًا فور التسليم، وأسئلة المقال تنتظر تقييمك من
        شاشة «الأسئلة والاختبارات» — لا تُصدر الشهادة قبل اجتياز الاختبار.
      </p>
    </div>
  );
}

/* ------------------------ question form ---------------------------- */

type QuestionPayload =
  | { kind: "add"; body: Record<string, unknown> }
  | { kind: "edit"; body: Record<string, unknown> };

function QuestionForm({
  assessmentId,
  question,
  onDone,
}: {
  assessmentId: string;
  question: WorkspaceQuestion | null;
  onDone: (payload: QuestionPayload | null) => void;
}) {
  const [type, setType] = React.useState<QuestionType>(
    (question?.type as QuestionType) ?? "SINGLE_CHOICE"
  );
  const [text, setText] = React.useState(question?.textAr ?? "");
  const [points, setPoints] = React.useState(question?.points ?? 1);
  const [required, setRequired] = React.useState(question?.isRequired ?? true);
  const [options, setOptions] = React.useState<string[]>(
    question && question.options.length > 0
      ? question.options.map((option) => option.textAr)
      : ["", "", "", ""]
  );
  const [correctIndex, setCorrectIndex] = React.useState<number>(() => {
    if (!question) return 0;
    const firstId = question.correctOptionIds[0] ?? "";
    const index = question.options.findIndex((option) => option.id === firstId);
    return index >= 0 ? index : 0;
  });
  const [correctIndexes, setCorrectIndexes] = React.useState<number[]>(() => {
    if (!question) return [];
    return question.correctOptionIds
      .map((id) => question.options.findIndex((option) => option.id === id))
      .filter((index) => index >= 0);
  });
  const [correctBool, setCorrectBool] = React.useState<boolean>(
    question?.correctBool ?? true
  );
  const [modelAnswer, setModelAnswer] = React.useState(question?.modelAnswer ?? "");
  const [error, setError] = React.useState<string | null>(null);

  function submit() {
    if (text.trim().length < 3) {
      setError("نص السؤال مطلوب (3 أحرف على الأقل).");
      return;
    }
    if (points < 1 || points > 100) {
      setError("درجة السؤال بين 1 و100.");
      return;
    }

    const body: Record<string, unknown> = {
      assessmentId,
      type,
      textAr: text.trim(),
      points,
      isRequired: required,
    };
    if (question?.id) body.questionId = question.id;

    if (type === "SINGLE_CHOICE" || type === "MULTIPLE_CHOICE") {
      const cleaned = options.map((option) => option.trim()).filter(Boolean);
      if (cleaned.length < 2) {
        setError("أضف خيارين على الأقل للسؤال.");
        return;
      }
      if (type === "SINGLE_CHOICE" && correctIndex >= cleaned.length) {
        setError("اختر الإجابة الصحيحة.");
        return;
      }
      if (type === "MULTIPLE_CHOICE" && correctIndexes.length === 0) {
        setError("اختر إجابة صحيحة واحدة على الأقل.");
        return;
      }
      body.options = cleaned.map((option) => ({ textAr: option }));
      body.correctOptionIndexes =
        type === "SINGLE_CHOICE" ? [Math.min(correctIndex, cleaned.length - 1)] : correctIndexes.filter((index) => index < cleaned.length);
    } else if (type === "TRUE_FALSE") {
      body.correctValue = correctBool;
    } else {
      if (modelAnswer.trim().length === 0) {
        setError("أضف إجابة نموذجية تساعدك عند التصحيح اليدوي.");
        return;
      }
      body.modelAnswer = modelAnswer.trim();
    }

    onDone(question?.id ? { kind: "edit", body } : { kind: "add", body });
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-[1fr_170px_90px]">
        <label className="block">
          <span className="mb-1 block text-xs font-bold">نص السؤال *</span>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            className={inputClass}
            maxLength={1000}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">نوع السؤال</span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as QuestionType)}
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
          <span className="mb-1 block text-xs font-bold">الدرجة</span>
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

      {(type === "SINGLE_CHOICE" || type === "MULTIPLE_CHOICE") && (
        <div className="mt-3 space-y-1.5">
          <span className="block text-xs font-bold">
            الخيارات {type === "SINGLE_CHOICE" ? "— حدّد الصحيحة" : "— حدّد كل الصحيحة"}
          </span>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type={type === "SINGLE_CHOICE" ? "radio" : "checkbox"}
                name="correct-option"
                checked={type === "SINGLE_CHOICE" ? correctIndex === index : correctIndexes.includes(index)}
                onChange={() => {
                  if (type === "SINGLE_CHOICE") {
                    setCorrectIndex(index);
                  } else {
                    setCorrectIndexes((current) =>
                      current.includes(index)
                        ? current.filter((value) => value !== index)
                        : [...current, index]
                    );
                  }
                }}
                className="size-3.5 shrink-0 accent-[#1D5BD6]"
                aria-label={`الإجابة الصحيحة ${index + 1}`}
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
                maxLength={200}
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
          {options.length < 6 && (
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
        <div className="mt-3 flex items-center gap-3 text-xs font-bold">
          <span>الإجابة الصحيحة:</span>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="correct-bool"
              checked={correctBool === true}
              onChange={() => setCorrectBool(true)}
              className="accent-[#1D5BD6]"
            />
            صحيح
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="correct-bool"
              checked={correctBool === false}
              onChange={() => setCorrectBool(false)}
              className="accent-[#1D5BD6]"
            />
            خطأ
          </label>
        </div>
      )}

      {type === "SHORT_ANSWER" && (
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-bold">الإجابة النموذجية (للتصحيح اليدوي)</span>
          <textarea
            value={modelAnswer}
            onChange={(event) => setModelAnswer(event.target.value)}
            rows={2}
            maxLength={2000}
            className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-brand-600"
          />
        </label>
      )}

      <label className="mt-3 flex items-center gap-2 text-xs font-bold">
        <input
          type="checkbox"
          checked={required}
          onChange={(event) => setRequired(event.target.checked)}
          className="size-3.5 accent-[#1D5BD6]"
        />
        سؤال إجباري
      </label>

      {error && (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
        >
          {question ? "حفظ السؤال" : "إضافة السؤال"}
        </button>
        <button
          type="button"
          onClick={() => onDone(null)}
          className="rounded-lg border bg-card px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-accent"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Award,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  Lock,
  PlayCircle,
  Timer,
  TrendingUp,
} from "lucide-react";

import {
  saveExamDraftAction,
  startExamAttemptAction,
  submitExamAttemptAction,
  type JourneyExamActionState,
} from "@/app/actions/journey-exam";
import type {
  ExamQuestionView,
  ExamSavedAnswer,
  JourneyExamRow,
  JourneyStage,
  JourneyView,
} from "@/lib/training/journey";
import { cn } from "@/lib/utils";

/**
 * Mandatory journey stepper — رحلة إتمام الدورة الإلزامية.
 *
 * Renders the SERVER-computed verdict of the four mandatory stages
 * (content -> exam -> certificate -> impact). This component is pure
 * presentation of server decisions: every lock, chip, reason and CTA
 * below mirrors `computeCourseJourney` + the server actions; the real
 * enforcement lives in the lesson gate, the assessment service and the
 * completion/certificate/impact services.
 *
 * The exam runs INSIDE this stepper (stage 2) — there is no separate
 * exams section in the sidebar; the journey is the only entry point.
 */

const emptyExamState: JourneyExamActionState = { ok: false };

const STAGE_ICONS = {
  content: BookOpenCheck,
  exam: ClipboardList,
  certificate: Award,
  impact: TrendingUp,
} as const;

function stateChip(state: JourneyStage["state"]) {
  switch (state) {
    case "locked":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-bold text-slate-500">
          <Lock className="size-3" aria-hidden="true" />
          مقفلة
        </span>
      );
    case "available":
      return (
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-[#1D5BD6]">
          متاحة الآن
        </span>
      );
    case "in_progress":
      return (
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-[#1D5BD6]">
          قيد الإنجاز
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
          <CheckCircle2 className="size-3" aria-hidden="true" />
          مكتملة
        </span>
      );
  }
}

function formatCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/* ------------------------------------------------------------------ */
/* Stage card shell                                                     */
/* ------------------------------------------------------------------ */

function StageCard({
  stage,
  current,
  children,
}: {
  stage: JourneyStage;
  current: boolean;
  children?: ReactNode;
}) {
  const Icon = STAGE_ICONS[stage.key];
  return (
    <li
      className={cn(
        "rounded-xl border bg-white p-4 transition",
        current
          ? "border-[#1D5BD6] shadow-sm ring-2 ring-[#1D5BD6]/20"
          : "border-slate-200",
        stage.state === "locked" && !current && "bg-slate-50/60"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg text-white",
              stage.state === "completed"
                ? "bg-emerald-600"
                : stage.state === "locked"
                  ? "bg-slate-300"
                  : "bg-[#1D5BD6]"
            )}
            aria-hidden="true"
          >
            {stage.state === "completed" ? (
              <CheckCircle2 className="size-5" />
            ) : stage.state === "locked" ? (
              <Lock className="size-5" />
            ) : (
              <Icon className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-slate-900">
              {stage.titleAr}
              {current && (
                <span className="rounded-full bg-[#1D5BD6] px-2 py-0.5 text-[10px] font-bold text-white">
                  المرحلة الحالية
                </span>
              )}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              {stage.detailAr}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {stateChip(stage.state)}
          <span className="text-xs font-extrabold text-slate-500">
            {stage.percent}%
          </span>
        </div>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            stage.state === "completed"
              ? "bg-emerald-500"
              : stage.state === "locked"
                ? "bg-slate-300"
                : "bg-[#1D5BD6]"
          )}
          style={{ width: `${stage.percent}%` }}
        />
      </div>

      {stage.state === "locked" && stage.lockReason && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{stage.lockReason}</span>
        </div>
      )}

      {children}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Stage 2 — the exam runner (questions served by the server only       */
/* while a live attempt exists; answer keys NEVER cross the boundary)   */
/* ------------------------------------------------------------------ */

function ExamStartForm({
  courseId,
  exam,
  label,
}: {
  courseId: string;
  exam: JourneyExamRow;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(
    startExamAttemptAction,
    emptyExamState
  );
  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="assessmentId" value={exam.id} />
      {!state.ok && state.message && (
        <p className="mt-1 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-red-700">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D5BD6] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#174aa8] disabled:opacity-60"
      >
        <PlayCircle className="size-4" aria-hidden="true" />
        {pending ? "جارٍ التحضير…" : label}
      </button>
    </form>
  );
}

function ExamQuestionField({
  question,
  saved,
}: {
  question: ExamQuestionView;
  saved?: ExamSavedAnswer;
}) {
  const fieldName = `q_${question.id}`;
  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-bold text-slate-800">
        السؤال {question.orderIndex + 1}. {question.textAr}
        {question.isRequired && <span className="text-red-500"> *</span>}
        <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
          {question.points} نقطة
        </span>
      </legend>

      {(question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE") && (
        <div className="mt-3 space-y-2">
          {question.type === "MULTIPLE_CHOICE" && (
            <p className="text-[11px] font-semibold text-slate-500">
              اختر كل الإجابات الصحيحة
            </p>
          )}
          {question.options.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition has-checked:border-[#1D5BD6] has-checked:bg-blue-50"
            >
              <input
                type={question.type === "SINGLE_CHOICE" ? "radio" : "checkbox"}
                name={fieldName}
                value={option.id}
                defaultChecked={saved?.choice?.includes(option.id) ?? false}
                required={question.type === "SINGLE_CHOICE" && question.isRequired}
                className="accent-[#1D5BD6]"
              />
              {option.textAr}
            </label>
          ))}
          {question.options.length === 0 && (
            <p className="text-xs text-amber-700">
              لا توجد خيارات معرفة لهذا السؤال — راجع فريق التدريب.
            </p>
          )}
        </div>
      )}

      {question.type === "TRUE_FALSE" && (
        <div className="mt-3 flex gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition has-checked:border-[#1D5BD6] has-checked:bg-blue-50">
            <input
              type="radio"
              name={fieldName}
              value="true"
              defaultChecked={saved?.bool === true}
              required={question.isRequired}
              className="accent-[#1D5BD6]"
            />
            صحيح
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition has-checked:border-[#1D5BD6] has-checked:bg-blue-50">
            <input
              type="radio"
              name={fieldName}
              value="false"
              defaultChecked={saved?.bool === false}
              required={question.isRequired}
              className="accent-[#1D5BD6]"
            />
            خطأ
          </label>
        </div>
      )}

      {question.type === "SHORT_ANSWER" && (
        <textarea
          name={fieldName}
          rows={3}
          maxLength={2000}
          required={question.isRequired}
          defaultValue={saved?.text ?? ""}
          placeholder="اكتب إجابتك هنا…"
          className="mt-3 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
        />
      )}

      {!["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"].includes(
        question.type
      ) && (
        <p className="mt-2 text-xs font-semibold text-amber-700">
          نوع سؤال غير مدعوم في العرض — أعد تحميل الصفحة أو راجع فريق التدريب.
        </p>
      )}
    </fieldset>
  );
}

function ExamRunner({ courseId, exam }: { courseId: string; exam: JourneyExamRow }) {
  const attempt = exam.activeAttempt;
  const [state, formAction, pending] = useActionState(
    submitExamAttemptAction,
    emptyExamState
  );
  const formRef = useRef<HTMLFormElement>(null);
  const draftTimer = useRef<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  // Countdown to the SERVER-enforced deadline — the browser timer is
  // cosmetic; the service re-checks the deadline on submission.
  useEffect(() => {
    if (!attempt?.deadlineAt) return;
    const deadline = new Date(attempt.deadlineAt).getTime();
    const tick = () =>
      setRemainingSeconds(Math.max(0, Math.floor((deadline - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [attempt?.deadlineAt]);

  // Silent draft autosave (debounced) — answers survive a page refresh;
  // the server restores them through savedAnswers on the next render.
  const scheduleDraftSave = () => {
    if (!formRef.current) return;
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      if (!formRef.current) return;
      const formData = new FormData(formRef.current);
      void saveExamDraftAction(emptyExamState, formData);
    }, 4000);
  };
  useEffect(() => {
    return () => {
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    };
  }, []);

  if (!attempt) return null;

  const expired = remainingSeconds !== null && remainingSeconds <= 0;
  const savedByQuestion = new Map<string, ExamSavedAnswer>(
    attempt.savedAnswers.map((answer) => [answer.questionId, answer])
  );

  return (
    <div className="mt-3 rounded-lg border border-[#1D5BD6]/30 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-extrabold text-[#1D5BD6]">
          محاولة جارية — أكمل الأسئلة ثم سلّم الإجابات (التسليم نهائي)
        </p>
        {attempt.deadlineAt && remainingSeconds !== null && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold",
              expired
                ? "bg-red-100 text-red-700"
                : remainingSeconds < 300
                  ? "bg-amber-100 text-amber-800"
                  : "bg-white text-[#1D5BD6] ring-1 ring-blue-100"
            )}
          >
            <Timer className="size-3.5" aria-hidden="true" />
            {expired ? "انتهى الوقت" : `المتبقي ${formatCountdown(remainingSeconds)}`}
          </span>
        )}
      </div>

      {expired && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            انتهى وقت هذه المحاولة — لن يُقبل التسليم بعد المهلة وستُسجَّل كمنتهية.
            حدّث الصفحة لبدء محاولة جديدة إذا توفرت محاولات.
          </span>
        </div>
      )}

      {exam.instructionsAr && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-bold text-[#1D5BD6]">
            تعليمات الاختبار
          </summary>
          <p className="mt-1.5 whitespace-pre-line rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-700">
            {exam.instructionsAr}
          </p>
        </details>
      )}

      <form
        ref={formRef}
        action={formAction}
        onChange={scheduleDraftSave}
        className="mt-4 space-y-3"
      >
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="attemptId" value={attempt.id} />

        {attempt.questions.map((question) => (
          <ExamQuestionField
            key={question.id}
            question={question}
            saved={savedByQuestion.get(question.id)}
          />
        ))}
        {attempt.questions.length === 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
            لا توجد أسئلة منشورة لهذا الاختبار — راجع فريق التدريب.
          </p>
        )}

        {state.ok && state.data?.status === "PASSED" && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-extrabold text-emerald-700">
            🎉 تم قبول إجاباتك — نجحت في الاختبار وانتقلت إلى مرحلة الشهادة.
          </p>
        )}
        {state.ok && state.data?.status === "NEEDS_REVIEW" && (
          <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-[#1D5BD6]">
            تم استلام إجاباتك — الأسئلة النصية بانتظار مراجعة المدرب.
          </p>
        )}
        {state.ok && state.data?.status === "FAILED" && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
            لم تجتز هذه المحاولة — يمكنك المحاولة مجددًا وفق قواعد الاختبار.
          </p>
        )}
        {!state.ok && state.message && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">
            {state.message}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-400">
            تُحفظ مسودتك تلقائيًا أثناء الإجابة، والتصحيح يجري على الخادم حصريًا.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[#1D5BD6] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#174aa8] disabled:opacity-60"
          >
            {pending ? "جارٍ التسليم…" : "تسليم الإجابات نهائيًا"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ExamCard({ journey, exam }: { journey: JourneyView; exam: JourneyExamRow }) {
  const attemptsLabel =
    exam.attemptLimit === null
      ? `${exam.attemptsUsed} محاولة`
      : `${exam.attemptsUsed}/${exam.attemptLimit} محاولات`;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-slate-900">{exam.titleAr}</p>
          <p className="mt-1 text-xs text-slate-500">
            درجة النجاح: {exam.passingScore}/{exam.maxScore}
            {" · "}
            المحاولات: {attemptsLabel}
            {exam.timeLimitMinutes !== null && ` · المدة: ${exam.timeLimitMinutes} دقيقة`}
          </p>
        </div>
        {exam.passed && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            مجتاز{exam.bestPercentage !== null ? ` — ${exam.bestPercentage}%` : ""}
          </span>
        )}
      </div>

      {exam.activeAttempt && <ExamRunner courseId={journey.courseId} exam={exam} />}

      {!exam.passed && !exam.activeAttempt && exam.pendingReview && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-[#1D5BD6]">
          <ClipboardList className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            سُلّمت إجاباتك — الأسئلة المقالية بانتظار تقييم المشرف. تظهر النتيجة
            النهائية ودرجتك هنا بعد التصحيح، وتُفتح مرحلة الشهادة تلقائيًا عند
            الاجتياز.
          </span>
        </div>
      )}

      {!exam.passed && !exam.activeAttempt && !exam.pendingReview && exam.startBlockReason && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{exam.startBlockReason}</span>
        </div>
      )}

      {!exam.passed && !exam.activeAttempt && !exam.pendingReview && exam.canStart && (
        <>
          {exam.attemptsUsed > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                لم تجتز المحاولة السابقة — يمكنك إعادة المحاولة وفق قواعد الاختبار
                (نفس درجة النجاح ونفس حد المحاولات).
              </span>
            </div>
          )}
          <ExamStartForm
            courseId={journey.courseId}
            exam={exam}
            label={exam.attemptsUsed > 0 ? "إعادة المحاولة" : "بدء الاختبار النهائي"}
          />
        </>
      )}
    </li>
  );
}

function ExamSection({ journey }: { journey: JourneyView }) {
  const examStage = journey.stages.find((stage) => stage.key === "exam");
  if (!examStage || examStage.state === "locked") return null;

  if (journey.exams.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        لا يوجد اختبار نهائي منشور لهذه الدورة — تم استيفاء متطلب الاختبار.
      </p>
    );
  }

  return (
    <div className="mt-3">
      {examStage.state === "available" && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3.5 text-xs leading-relaxed text-[#1D5BD6]">
          <span className="font-extrabold">أكملت جميع دروس الدورة — الاختبار النهائي متاح الآن: </span>
          ابدأ المحاولة من البطاقة أدناه (نفس قواعد درجة النجاح والمحاولات والمهلة)،
          وعند الاجتياز ستنتقل تلقائيًا إلى مرحلة الشهادة.
        </div>
      )}
      <ul className="space-y-3">
        {journey.exams.map((exam) => (
          <ExamCard key={exam.id} journey={journey} exam={exam} />
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The stepper                                                          */
/* ------------------------------------------------------------------ */

export function JourneyStepper({ journey }: { journey: JourneyView }) {
  const currentIndex = journey.stages.findIndex(
    (stage) => stage.state !== "completed"
  );

  return (
    <section
      id="journey"
      className="mt-6 rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-slate-800">
            رحلة إتمام الدورة — أربع مراحل إلزامية بالترتيب
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            محتوى الدورة ← الاختبار النهائي ← الشهادة ← قياس الأثر. تُفتح كل مرحلة
            تلقائيًا بعد إنهاء ما قبلها، والقفل والفتح يُفرضان على الخادم.
          </p>
        </div>
        <div className="w-full max-w-52 shrink-0">
          <div className="flex items-center justify-between text-xs font-bold text-slate-600">
            <span>تقدم الرحلة</span>
            <span className="text-[#1D5BD6]">{journey.overallPercent}%</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#1D5BD6] transition-all"
              style={{ width: `${journey.overallPercent}%` }}
            />
          </div>
        </div>
      </div>

      {!journey.isTeacher && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-500">
          وضع معاينة الإدارة — تقدم الرحلة يُسجَّل لحسابات المعلمين فقط.
        </p>
      )}

      <ol className="mt-4 space-y-3">
        {journey.stages.map((stage, index) => (
          <StageCard
            key={stage.key}
            stage={stage}
            current={index === currentIndex}
          >
            {stage.key === "content" && stage.state !== "completed" && (
              <a
                href="#lessons"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#1D5BD6] px-4 py-2 text-xs font-bold text-[#1D5BD6] transition hover:bg-blue-50"
              >
                <PlayCircle className="size-4" aria-hidden="true" />
                الانتقال إلى الدروس
              </a>
            )}

            {stage.key === "exam" && <ExamSection journey={journey} />}

            {stage.key === "certificate" && journey.certificate.issued && journey.certificate.href && (
              <Link
                href={journey.certificate.href}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#1D5BD6] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#174aa8]"
              >
                <Award className="size-4" aria-hidden="true" />
                عرض الشهادة
              </Link>
            )}
            {stage.key === "certificate" &&
              stage.state === "in_progress" &&
              journey.certificate.pendingReason && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                  {journey.certificate.pendingReason}
                </p>
              )}

            {stage.key === "impact" && stage.state === "available" && (
              <a
                href="#impact"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#1D5BD6] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#174aa8]"
              >
                <TrendingUp className="size-4" aria-hidden="true" />
                فتح أدوات قياس الأثر
              </a>
            )}
          </StageCard>
        ))}
      </ol>
    </section>
  );
}
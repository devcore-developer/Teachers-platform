"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  ListPlus,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

import {
  addQuestionAction,
  deleteQuestionAction,
  moveQuestionAction,
  updateQuestionAction,
  type AssessmentFormState,
} from "@/app/actions/assessment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  OPTIONS_MAX,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  TRUE_FALSE_LABELS,
  questionTypeLabel,
  type QuestionType,
} from "@/config/assessment";
import type { ManageQuestionRow, QuestionOption } from "@/lib/assessment/service";

/* ------------------------------------------------------------------ */
/* Question builder — add / edit / remove / reorder questions with      */
/* type-conditional controls. Correct-answer configuration is serialized */
/* to the server action; option ids are generated SERVER-SIDE only.     */
/* ------------------------------------------------------------------ */

interface QuestionBuilderProps {
  assessmentId: string;
  status: string;
  questions: ManageQuestionRow[];
}

export function QuestionBuilder({
  assessmentId,
  status,
  questions,
}: QuestionBuilderProps) {
  const editable = status !== "ARCHIVED";
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  return (
    <div className="space-y-4">
      {editable && !adding && (
        <div>
          <Button type="button" onClick={() => setAdding(true)} size="sm">
            <Plus className="size-4" aria-hidden="true" />
            إضافة سؤال
          </Button>
        </div>
      )}

      {editable && adding && (
        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold">سؤال جديد</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdding(false)}
            >
              <X className="size-4" aria-hidden="true" />
              إلغاء
            </Button>
          </div>
          <QuestionForm
            mode="create"
            assessmentId={assessmentId}
            onDone={() => setAdding(false)}
          />
        </div>
      )}

      {questions.length === 0 && !adding ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          لا توجد أسئلة بعد — أضف السؤال الأول لبدء بناء الاختبار.
        </p>
      ) : (
        <ol className="space-y-3" role="list" aria-label="أسئلة الاختبار">
          {questions.map((question, index) => (
            <li key={question.id} className="rounded-xl border bg-card p-4">
              {editable && editingId === question.id ? (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-bold">تعديل السؤال {index + 1}</h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="size-4" aria-hidden="true" />
                      إلغاء
                    </Button>
                  </div>
                  <QuestionForm
                    mode="edit"
                    assessmentId={assessmentId}
                    question={question}
                    onDone={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <QuestionCard
                  assessmentId={assessmentId}
                  question={question}
                  index={index}
                  total={questions.length}
                  editable={editable}
                  onEdit={() => setEditingId(question.id)}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------ Card ------------------------------- */

function QuestionCard({
  assessmentId,
  question,
  index,
  total,
  editable,
  onEdit,
}: {
  assessmentId: string;
  question: ManageQuestionRow;
  index: number;
  total: number;
  editable: boolean;
  onEdit: () => void;
}) {
  const correctIds = correctOptionIds(question);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">
            {index + 1}. {question.textAr}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5 font-bold">
              {questionTypeLabel(question.type)}
            </span>
            <span>{question.points} نقاط</span>
            {question.isRequired && <span>إجابته إلزامية</span>}
          </p>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-1.5">
            <form action={moveQuestionAction}>
              <input type="hidden" name="assessmentId" value={assessmentId} />
              <input type="hidden" name="questionId" value={question.id} />
              <input type="hidden" name="direction" value="up" />
              <Button
                type="submit"
                variant="outline"
                size="icon"
                className="size-8"
                disabled={index === 0}
                aria-label="نقل لأعلى"
              >
                <ArrowUp className="size-3.5" aria-hidden="true" />
              </Button>
            </form>
            <form action={moveQuestionAction}>
              <input type="hidden" name="assessmentId" value={assessmentId} />
              <input type="hidden" name="questionId" value={question.id} />
              <input type="hidden" name="direction" value="down" />
              <Button
                type="submit"
                variant="outline"
                size="icon"
                className="size-8"
                disabled={index === total - 1}
                aria-label="نقل لأسفل"
              >
                <ArrowDown className="size-3.5" aria-hidden="true" />
              </Button>
            </form>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onEdit}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              تعديل
            </Button>
            <form action={deleteQuestionAction}>
              <input type="hidden" name="assessmentId" value={assessmentId} />
              <input type="hidden" name="questionId" value={question.id} />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                حذف
              </Button>
            </form>
          </div>
        )}
      </div>

      {question.type === "TRUE_FALSE" ? (
        <p className="text-xs text-muted-foreground">
          الإجابة الصحيحة:{" "}
          <span className="font-bold text-success">
            {question.answerKey && "value" in question.answerKey
              ? question.answerKey.value
                ? TRUE_FALSE_LABELS.true
                : TRUE_FALSE_LABELS.false
              : "—"}
          </span>
        </p>
      ) : question.type === "SHORT_ANSWER" ? (
        <div className="text-xs text-muted-foreground">
          <p className="font-bold text-info">تدرج يدويًا بعد التسليم</p>
          {question.answerKey && "modelAnswer" in question.answerKey && question.answerKey.modelAnswer && (
            <p className="mt-1">
              الإجابة النموذجية: {question.answerKey.modelAnswer}
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-1.5" role="list">
          {question.options.map((option) => {
            const isCorrect = correctIds.includes(option.id);
            return (
              <li
                key={option.id}
                className="flex items-center gap-2 text-xs"
              >
                {isCorrect ? (
                  <CheckCircle2
                    className="size-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="size-4 shrink-0 text-muted-foreground/40"
                    aria-hidden="true"
                  />
                )}
                <span className={isCorrect ? "font-bold text-success" : ""}>
                  {option.textAr}
                </span>
                {isCorrect && (
                  <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-bold text-success">
                    الإجابة الصحيحة
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {question.explanation && (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
          تغذية راجعة: {question.explanation}
        </p>
      )}
    </div>
  );
}

function correctOptionIds(question: ManageQuestionRow): string[] {
  const key = question.answerKey;
  if (!key) return [];
  if ("optionId" in key) return [key.optionId];
  if ("optionIds" in key) return key.optionIds;
  return [];
}

/* ------------------------------ Form ------------------------------- */

interface QuestionFormProps {
  mode: "create" | "edit";
  assessmentId: string;
  question?: ManageQuestionRow;
  onDone: () => void;
}

function QuestionForm({ mode, assessmentId, question, onDone }: QuestionFormProps) {
  const [addState, addFormAction] = React.useActionState<
    AssessmentFormState | null,
    FormData
  >(addQuestionAction, null);
  const [editState, editFormAction] = React.useActionState<
    AssessmentFormState | null,
    FormData
  >(updateQuestionAction, null);
  const state = mode === "create" ? addState : editState;

  const [type, setType] = React.useState<QuestionType>(
    (question?.type as QuestionType) ?? "SINGLE_CHOICE"
  );
  const [optionTexts, setOptionTexts] = React.useState<string[]>(() => {
    if (question && question.options.length > 0) {
      return question.options.map((option) => option.textAr);
    }
    return ["", ""];
  });
  const [correctIndexes, setCorrectIndexes] = React.useState<number[]>(() =>
    question ? correctOptionIds(question).map((id) =>
      Math.max(0, question.options.findIndex((option) => option.id === id))
    ) : []
  );
  const [correctValue, setCorrectValue] = React.useState<string>(() => {
    if (question?.answerKey && "value" in question.answerKey) {
      return question.answerKey.value ? "true" : "false";
    }
    return "true";
  });

  const isChoice = type === "SINGLE_CHOICE" || type === "MULTIPLE_CHOICE";

  // Close on success (and reset for the next add).
  React.useEffect(() => {
    if (state?.ok) {
      if (mode === "create") {
        setType("SINGLE_CHOICE");
        setOptionTexts(["", ""]);
        setCorrectIndexes([]);
        setCorrectValue("true");
      }
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  function handleTypeChange(next: QuestionType) {
    setType(next);
    if (!question) {
      setOptionTexts(next === "SINGLE_CHOICE" || next === "MULTIPLE_CHOICE" ? ["", ""] : []);
      setCorrectIndexes([]);
    }
  }

  function toggleCorrectIndex(index: number, checked: boolean) {
    if (type === "SINGLE_CHOICE") {
      setCorrectIndexes([index]);
      return;
    }
    setCorrectIndexes((current) =>
      checked
        ? [...current, index].sort()
        : current.filter((value) => value !== index)
    );
  }

  return (
    <form
      action={mode === "create" ? addFormAction : editFormAction}
      className="space-y-4"
      noValidate
    >
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {mode === "edit" && question && (
        <input type="hidden" name="questionId" value={question.id} />
      )}
      <input type="hidden" name="type" value={type} />
      <input
        type="hidden"
        name="optionsJson"
        value={JSON.stringify(
          optionTexts.map((textAr) => ({ textAr: textAr.trim() }))
        )}
      />
      <input
        type="hidden"
        name="correctOptionIndexesJson"
        value={JSON.stringify(correctIndexes)}
      />
      <input type="hidden" name="correctValue" value={correctValue} />

      {state?.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>نوع السؤال *</Label>
          <Select value={type} onValueChange={(value) => handleTypeChange(value as QuestionType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUESTION_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {QUESTION_TYPE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`points-${question?.id ?? "new"}`}>درجة السؤال *</Label>
          <Input
            id={`points-${question?.id ?? "new"}`}
            name="points"
            type="number"
            min={1}
            max={100}
            dir="ltr"
            defaultValue={question?.points ?? 1}
            required
          />
        </div>
        <div className="flex items-end gap-2 pb-2">
          <input
            id={`required-${question?.id ?? "new"}`}
            name="isRequired"
            type="checkbox"
            defaultChecked={question?.isRequired ?? true}
            className="size-4 accent-[#1D5BD6]"
          />
          <Label htmlFor={`required-${question?.id ?? "new"}`} className="text-xs">
            إجابته إلزامية
          </Label>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`textAr-${question?.id ?? "new"}`}>نص السؤال (بالعربية) *</Label>
        <Textarea
          id={`textAr-${question?.id ?? "new"}`}
          name="textAr"
          rows={2}
          defaultValue={question?.textAr ?? ""}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`textEn-${question?.id ?? "new"}`}>
          نص السؤال بالإنجليزية (اختياري)
        </Label>
        <Input
          id={`textEn-${question?.id ?? "new"}`}
          name="textEn"
          dir="ltr"
          defaultValue={question?.textEn ?? ""}
        />
      </div>

      {isChoice && (
        <div className="space-y-2 rounded-lg border bg-background/60 p-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">
              الخيارات * — حدّد {type === "SINGLE_CHOICE" ? "الإجابة الصحيحة الواحدة" : "كل الإجابات الصحيحة"}
            </Label>
            {optionTexts.length < OPTIONS_MAX && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOptionTexts((current) => [...current, ""])}
              >
                <ListPlus className="size-3.5" aria-hidden="true" />
                خيار إضافي
              </Button>
            )}
          </div>
          {optionTexts.map((text, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type={type === "SINGLE_CHOICE" ? "radio" : "checkbox"}
                name={type === "SINGLE_CHOICE" ? "correct-radio" : undefined}
                checked={correctIndexes.includes(index)}
                onChange={(event) => toggleCorrectIndex(index, event.target.checked)}
                aria-label={`الإجابة الصحيحة للخيار ${index + 1}`}
                className="size-4 shrink-0 accent-[#1D5BD6]"
              />
              <Input
                value={text}
                onChange={(event) =>
                  setOptionTexts((current) =>
                    current.map((value, i) => (i === index ? event.target.value : value))
                  )
                }
                placeholder={`نص الخيار ${index + 1}`}
                required
                className="flex-1"
              />
              {optionTexts.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={`حذف الخيار ${index + 1}`}
                  onClick={() => {
                    setOptionTexts((current) => current.filter((_, i) => i !== index));
                    setCorrectIndexes((current) =>
                      current
                        .filter((value) => value !== index)
                        .map((value) => (value > index ? value - 1 : value))
                    );
                  }}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {type === "TRUE_FALSE" && (
        <div className="space-y-1.5 rounded-lg border bg-background/60 p-3">
          <Label className="text-xs">الإجابة الصحيحة *</Label>
          <div className="flex items-center gap-4">
            {(["true", "false"] as const).map((value) => (
              <label key={value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="correct-value-radio"
                  checked={correctValue === value}
                  onChange={() => setCorrectValue(value)}
                  className="size-4 accent-[#1D5BD6]"
                />
                {TRUE_FALSE_LABELS[value]}
              </label>
            ))}
          </div>
        </div>
      )}

      {type === "SHORT_ANSWER" && (
        <div className="space-y-1.5">
          <Label htmlFor={`model-${question?.id ?? "new"}`}>
            الإجابة النموذجية (مساعدة للمراجع — اختيارية)
          </Label>
          <Textarea
            id={`model-${question?.id ?? "new"}`}
            name="modelAnswer"
            rows={2}
            defaultValue={
              question?.answerKey && "modelAnswer" in question.answerKey
                ? question.answerKey.modelAnswer ?? ""
                : ""
            }
          />
          <p className="text-[11px] text-muted-foreground">
            أسئلة الإجابة القصيرة تُدرّج يدويًا بعد التسليم — تظهر المحاولة بحالة &quot;بانتظار المراجعة&quot;.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`explanation-${question?.id ?? "new"}`}>
          تغذية راجعة تظهر بعد التسليم (اختياري)
        </Label>
        <Textarea
          id={`explanation-${question?.id ?? "new"}`}
          name="explanation"
          rows={2}
          defaultValue={question?.explanation ?? ""}
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit">
          <Save className="size-4" aria-hidden="true" />
          {mode === "create" ? "إضافة السؤال" : "حفظ التعديلات"}
        </Button>
      </div>
    </form>
  );
}

/** Exported for the editor preview (maps option rows safely). */
export function questionOptionTexts(options: QuestionOption[]): string[] {
  return options.map((option) => option.textAr);
}
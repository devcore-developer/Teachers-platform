"use client";

/**
 * Phase 9 — survey create/edit form with an inline question builder.
 *
 * The builder is a pure client component; the ENTIRE definition is
 * serialized to a single `definitionJson` field and re-validated by the
 * server (surveyDefinitionSchema + DB checks) before persistence —
 * client state is never trusted. Dates come from datetime-local inputs
 * and audience ids from server-provided option lists only.
 */
import { useActionState, useMemo, useState } from "react";

import {
  MAX_SURVEY_QUESTIONS,
  SURVEY_AUDIENCE_LABELS,
  SURVEY_QUESTION_TYPE_LABELS,
  SURVEY_STAGES,
  SURVEY_STAGE_LABELS,
} from "@/config/surveys";
import {
  createSurveyAction,
  updateSurveyAction,
  type SurveyActionState,
} from "@/app/actions/surveys";
import { FieldError } from "@/app/assignments/ui";

export interface SurveyFormOptions {
  programs: { id: string; nameAr: string }[];
  courses: { id: string; titleAr: string }[];
  lessons: { id: string; titleAr: string; courseId: string | null }[];
  assignments: { id: string; titleAr: string }[];
  certificates: { id: string; titleAr: string }[];
  branches: { id: string; nameAr: string }[];
  teachers: { id: string; name: string; branchName: string | null }[];
}

export interface SurveyFormDefinition {
  titleAr: string;
  titleEn: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  purposeAr: string | null;
  instructionsAr: string | null;
  stage: string | null;
  linkPairCode: string | null;
  programId: string | null;
  courseId: string | null;
  lessonId: string | null;
  assignmentId: string | null;
  certificateId: string | null;
  audienceMode: string;
  targetBranchIds: string[];
  targetTeacherIds: string[];
  anonymous: boolean;
  allowMultipleResponses: boolean;
  linkResponsesEnabled: boolean;
  opensAt: string | null;
  closesAt: string | null;
  questions: BuilderQuestion[];
}

export interface BuilderQuestion {
  clientId: string;
  textAr: string;
  helpTextAr: string;
  type: string;
  required: boolean;
  options: string[];
  minScore: string;
  maxScore: string;
}

const CHOICE_TYPES = new Set(["SINGLE_CHOICE", "MULTI_CHOICE"]);

function newQuestion(): BuilderQuestion {
  return {
    clientId: `q-${Math.random().toString(36).slice(2, 10)}`,
    textAr: "",
    helpTextAr: "",
    type: "SINGLE_CHOICE",
    required: true,
    options: ["", ""],
    minScore: "1",
    maxScore: "5",
  };
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function SurveyForm({
  mode,
  surveyId,
  initial,
  options,
}: {
  mode: "create" | "edit";
  surveyId?: string;
  initial: SurveyFormDefinition;
  options: SurveyFormOptions;
}) {
  const action = mode === "create" ? createSurveyAction : updateSurveyAction;
  const [state, formAction, pending] = useActionState<SurveyActionState, FormData>(action, { ok: false });

  const [titleAr, setTitleAr] = useState(initial.titleAr);
  const [titleEn, setTitleEn] = useState(initial.titleEn ?? "");
  const [descriptionAr, setDescriptionAr] = useState(initial.descriptionAr ?? "");
  const [purposeAr, setPurposeAr] = useState(initial.purposeAr ?? "");
  const [instructionsAr, setInstructionsAr] = useState(initial.instructionsAr ?? "");
  const [stage, setStage] = useState(initial.stage ?? "");
  const [linkPairCode, setLinkPairCode] = useState(initial.linkPairCode ?? "");
  const [programId, setProgramId] = useState(initial.programId ?? "");
  const [courseId, setCourseId] = useState(initial.courseId ?? "");
  const [lessonId, setLessonId] = useState(initial.lessonId ?? "");
  const [assignmentId, setAssignmentId] = useState(initial.assignmentId ?? "");
  const [certificateId, setCertificateId] = useState(initial.certificateId ?? "");
  const [audienceMode, setAudienceMode] = useState(initial.audienceMode);
  const [targetBranchIds, setTargetBranchIds] = useState<string[]>(initial.targetBranchIds);
  const [targetTeacherIds, setTargetTeacherIds] = useState<string[]>(initial.targetTeacherIds);
  const [anonymous, setAnonymous] = useState(initial.anonymous);
  const [allowMultipleResponses, setAllowMultipleResponses] = useState(initial.allowMultipleResponses);
  const [linkResponsesEnabled, setLinkResponsesEnabled] = useState(initial.linkResponsesEnabled);
  const [opensAt, setOpensAt] = useState(toDateInput(initial.opensAt));
  const [closesAt, setClosesAt] = useState(toDateInput(initial.closesAt));
  const [questions, setQuestions] = useState<BuilderQuestion[]>(
    initial.questions.length > 0 ? initial.questions : [newQuestion()]
  );

  const filteredLessons = useMemo(
    () => (courseId ? options.lessons.filter((lesson) => lesson.courseId === courseId) : []),
    [courseId, options.lessons]
  );

  function patchQuestion(clientId: string, patch: Partial<BuilderQuestion>): void {
    setQuestions((prev) =>
      prev.map((question) => (question.clientId === clientId ? { ...question, ...patch } : question))
    );
  }

  function moveQuestion(index: number, direction: -1 | 1): void {
    setQuestions((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  function buildDefinitionJson(): string {
    return JSON.stringify({
      titleAr,
      titleEn,
      descriptionAr,
      descriptionEn: null,
      purposeAr,
      instructionsAr,
      stage: stage === "" ? null : stage,
      linkPairCode,
      programId: programId === "" ? null : programId,
      courseId: courseId === "" ? null : courseId,
      lessonId: lessonId === "" ? null : lessonId,
      assignmentId: assignmentId === "" ? null : assignmentId,
      certificateId: certificateId === "" ? null : certificateId,
      audienceMode,
      targetBranchIds: JSON.stringify(targetBranchIds),
      targetTeacherIds: JSON.stringify(targetTeacherIds),
      anonymous,
      allowMultipleResponses,
      linkResponsesEnabled: linkResponsesEnabled && anonymous && linkPairCode.trim() !== "",
      opensAt: opensAt === "" ? null : new Date(opensAt).toISOString(),
      closesAt: closesAt === "" ? null : new Date(closesAt).toISOString(),
      questions: questions.map((question) => ({
        textAr: question.textAr,
        helpTextAr: question.helpTextAr,
        type: question.type,
        required: question.required,
        options:
          CHOICE_TYPES.has(question.type)
            ? question.options.filter((option) => option.trim() !== "")
            : [],
        minScore: question.type === "RATING" ? question.minScore : null,
        maxScore: question.type === "RATING" ? question.maxScore : null,
      })),
    });
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100";
  const labelClass = "mb-1 block text-xs font-medium text-slate-500";

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="definitionJson" value={buildDefinitionJson()} />
      {mode === "edit" ? <input type="hidden" name="surveyId" value={surveyId ?? ""} /> : null}

      {state.ok ? null : state.message ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.message}
        </div>
      ) : null}

      {/* -------------------------------------------------- Content */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-slate-800">بيانات الاستبيان</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>عنوان الاستبيان (بالعربية) *</label>
            <input className={inputClass} value={titleAr} onChange={(event) => setTitleAr(event.target.value)} />
            <FieldError message={state.fieldErrors?.titleAr} />
          </div>
          <div>
            <label className={labelClass}>العنوان بالإنجليزية (اختياري)</label>
            <input className={inputClass} dir="ltr" value={titleEn} onChange={(event) => setTitleEn(event.target.value)} />
            <FieldError message={state.fieldErrors?.titleEn} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>وصف الاستبيان</label>
            <textarea className={inputClass} rows={2} value={descriptionAr} onChange={(event) => setDescriptionAr(event.target.value)} />
            <FieldError message={state.fieldErrors?.descriptionAr} />
          </div>
          <div>
            <label className={labelClass}>الغرض (يظهر للمستجيب)</label>
            <input className={inputClass} value={purposeAr} onChange={(event) => setPurposeAr(event.target.value)} />
            <FieldError message={state.fieldErrors?.purposeAr} />
          </div>
          <div>
            <label className={labelClass}>تعليمات المستجيب</label>
            <input className={inputClass} value={instructionsAr} onChange={(event) => setInstructionsAr(event.target.value)} />
            <FieldError message={state.fieldErrors?.instructionsAr} />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- Impact config */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-bold text-slate-800">ربط القياس والتأثير (اختياري)</h2>
        <p className="mb-4 text-xs text-slate-500">
          اربط الاستبيان بمحتوى تدريبي وحدد مرحلة التقييم لقياس الأثر. مقارنة «قبل/بعد» تتطلب رمز ربط مشتركًا بين الاستبيانين ورابطًا ببرنامج أو دورة.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>البرنامج التدريبي</label>
            <select className={inputClass} value={programId} onChange={(event) => setProgramId(event.target.value)}>
              <option value="">— بدون —</option>
              {options.programs.map((program) => (
                <option key={program.id} value={program.id}>{program.nameAr}</option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.programId} />
          </div>
          <div>
            <label className={labelClass}>الدورة التدريبية</label>
            <select className={inputClass} value={courseId} onChange={(event) => { setCourseId(event.target.value); setLessonId(""); }}>
              <option value="">— بدون —</option>
              {options.courses.map((course) => (
                <option key={course.id} value={course.id}>{course.titleAr}</option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.courseId} />
          </div>
          <div>
            <label className={labelClass}>الدرس (داخل الدورة المحددة)</label>
            <select className={inputClass} value={lessonId} onChange={(event) => setLessonId(event.target.value)} disabled={courseId === ""}>
              <option value="">— بدون —</option>
              {filteredLessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>{lesson.titleAr}</option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.lessonId} />
          </div>
          <div>
            <label className={labelClass}>الواجب التدريبي</label>
            <select className={inputClass} value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>
              <option value="">— بدون —</option>
              {options.assignments.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>{assignment.titleAr}</option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.assignmentId} />
          </div>
          <div>
            <label className={labelClass}>الشهادة</label>
            <select className={inputClass} value={certificateId} onChange={(event) => setCertificateId(event.target.value)}>
              <option value="">— بدون —</option>
              {options.certificates.map((certificate) => (
                <option key={certificate.id} value={certificate.id}>{certificate.titleAr}</option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.certificateId} />
          </div>
          <div>
            <label className={labelClass}>مرحلة التقييم</label>
            <select className={inputClass} value={stage} onChange={(event) => setStage(event.target.value)}>
              <option value="">استبيان عام (بلا مرحلة)</option>
              {SURVEY_STAGES.map((value) => (
                <option key={value} value={value}>{SURVEY_STAGE_LABELS[value]}</option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.stage} />
          </div>
          <div>
            <label className={labelClass}>رمز الربط (قبل/بعد)</label>
            <input className={inputClass} dir="ltr" placeholder="P9-PAIR-001" value={linkPairCode} onChange={(event) => setLinkPairCode(event.target.value)} />
            <FieldError message={state.fieldErrors?.linkPairCode} />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- Audience */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-slate-800">الجمهور المستهدف</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          {(["ALL_TEACHERS", "BRANCHES", "TEACHERS"] as const).map((modeValue) => (
            <button
              key={modeValue}
              type="button"
              onClick={() => setAudienceMode(modeValue)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                audienceMode === modeValue
                  ? "border-[#1D5BD6] bg-[#1D5BD6] text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {SURVEY_AUDIENCE_LABELS[modeValue]}
            </button>
          ))}
        </div>
        {audienceMode === "BRANCHES" ? (
          <div>
            <div className="mb-2 flex flex-wrap gap-3">
              {options.branches.map((branch) => (
                <label key={branch.id} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={targetBranchIds.includes(branch.id)}
                    onChange={(event) =>
                      setTargetBranchIds((prev) =>
                        event.target.checked ? [...prev, branch.id] : prev.filter((id) => id !== branch.id)
                      )
                    }
                  />
                  {branch.nameAr}
                </label>
              ))}
            </div>
            <FieldError message={state.fieldErrors?.targetBranchIds} />
          </div>
        ) : null}
        {audienceMode === "TEACHERS" ? (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-3">
            <div className="grid gap-2 md:grid-cols-2">
              {options.teachers.map((teacher) => (
                <label key={teacher.id} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={targetTeacherIds.includes(teacher.id)}
                    onChange={(event) =>
                      setTargetTeacherIds((prev) =>
                        event.target.checked ? [...prev, teacher.id] : prev.filter((id) => id !== teacher.id)
                      )
                    }
                  />
                  {teacher.name}
                  {teacher.branchName ? <span className="text-xs text-slate-400">({teacher.branchName})</span> : null}
                </label>
              ))}
            </div>
            <FieldError message={state.fieldErrors?.targetTeacherIds} />
          </div>
        ) : null}
      </section>

      {/* -------------------------------------------------- Response policy */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-slate-800">إعدادات الردود</h2>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} className="mt-1" />
            <span>
              <strong>استبيان مجهول الهوية</strong>
              <span className="block text-xs text-slate-500">
                لا يُخزَّن أي ربط بين الرد وهوية المعلم إطلاقًا: لا حفظ مؤقت، لا عرض ردود فردية، ولا سجل شخصي للرد. ولا يمكن تقنيًا منع تكرار الردود ما لم يُفعّل الربط المجهول برمز ربط.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={allowMultipleResponses} onChange={(event) => setAllowMultipleResponses(event.target.checked)} className="mt-1" />
            <span>
              <strong>السماح بأكثر من رد لنفس المستجيب</strong>
            </span>
          </label>
          {anonymous ? (
            <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <input type="checkbox" checked={linkResponsesEnabled} onChange={(event) => setLinkResponsesEnabled(event.target.checked)} className="mt-1" />
              <span>
                <strong>ربط ردود ما قبل/بعد التدريب بمفاتيح مجهولة</strong>
                <span className="block text-xs text-slate-500">
                  يُخزَّن مفتاح مجهول (SHA-256) مشتق من رمز الربط وهوية الجلسة — لا يمكن عكسه لكشف الهوية من قاعدة البيانات وحدها، ويُستخدم فقط لمطابقة النتائج المجمعة.
                </span>
              </span>
            </label>
          ) : null}
          <FieldError message={state.fieldErrors?.linkResponsesEnabled} />
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>يفتح في (اختياري)</label>
              <input type="datetime-local" className={inputClass} value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
              <FieldError message={state.fieldErrors?.opensAt} />
            </div>
            <div>
              <label className={labelClass}>يُغلق في (اختياري)</label>
              <input type="datetime-local" className={inputClass} value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
              <FieldError message={state.fieldErrors?.closesAt} />
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- Questions builder */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">أسئلة الاستبيان ({questions.length}/{MAX_SURVEY_QUESTIONS})</h2>
          <button
            type="button"
            onClick={() => setQuestions((prev) => (prev.length < MAX_SURVEY_QUESTIONS ? [...prev, newQuestion()] : prev))}
            className="rounded-lg bg-[#1D5BD6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#174aa8]"
          >
            + إضافة سؤال
          </button>
        </div>
        <FieldError message={state.fieldErrors?.questions} />

        <div className="space-y-4">
          {questions.map((question, index) => (
            <div key={question.clientId} className="rounded-lg border border-slate-200 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-400">سؤال {index + 1}</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveQuestion(index, -1)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">↑</button>
                  <button type="button" onClick={() => moveQuestion(index, 1)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">↓</button>
                  <button
                    type="button"
                    onClick={() => setQuestions((prev) => (prev.length > 1 ? prev.filter((item) => item.clientId !== question.clientId) : prev))}
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    حذف
                  </button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className={labelClass}>نص السؤال *</label>
                  <input
                    className={inputClass}
                    value={question.textAr}
                    onChange={(event) => patchQuestion(question.clientId, { textAr: event.target.value })}
                  />
                  <FieldError message={state.fieldErrors?.[`questions.${index}.textAr`]} />
                </div>
                <div>
                  <label className={labelClass}>نوع السؤال</label>
                  <select
                    className={inputClass}
                    value={question.type}
                    onChange={(event) => patchQuestion(question.clientId, { type: event.target.value })}
                  >
                    {Object.entries(SURVEY_QUESTION_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={question.required}
                      onChange={(event) => patchQuestion(question.clientId, { required: event.target.checked })}
                    />
                    سؤال إلزامي
                  </label>
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass}>سؤال مساعد (اختياري)</label>
                  <input
                    className={inputClass}
                    value={question.helpTextAr}
                    onChange={(event) => patchQuestion(question.clientId, { helpTextAr: event.target.value })}
                  />
                </div>
                {CHOICE_TYPES.has(question.type) ? (
                  <div className="md:col-span-2">
                    <label className={labelClass}>الخيارات (خياران على الأقل)</label>
                    <div className="space-y-2">
                      {question.options.map((option, optionIndex) => (
                        <div key={optionIndex} className="flex items-center gap-2">
                          <input
                            className={inputClass}
                            value={option}
                            placeholder={`الخيار ${optionIndex + 1}`}
                            onChange={(event) =>
                              patchQuestion(question.clientId, {
                                options: question.options.map((item, itemIndex) =>
                                  itemIndex === optionIndex ? event.target.value : item
                                ),
                              })
                            }
                          />
                          {question.options.length > 2 ? (
                            <button
                              type="button"
                              onClick={() =>
                                patchQuestion(question.clientId, {
                                  options: question.options.filter((_, itemIndex) => itemIndex !== optionIndex),
                                })
                              }
                              className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      ))}
                      {question.options.length < 10 ? (
                        <button
                          type="button"
                          onClick={() => patchQuestion(question.clientId, { options: [...question.options, ""] })}
                          className="text-xs font-medium text-[#1D5BD6] hover:underline"
                        >
                          + خيار
                        </button>
                      ) : null}
                    </div>
                    <FieldError message={state.fieldErrors?.[`questions.${index}.options`]} />
                  </div>
                ) : null}
                {question.type === "RATING" ? (
                  <>
                    <div>
                      <label className={labelClass}>أدنى درجة (1-10)</label>
                      <input
                        type="number" min={1} max={10}
                        className={inputClass}
                        value={question.minScore}
                        onChange={(event) => patchQuestion(question.clientId, { minScore: event.target.value })}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>أقصى درجة (1-10)</label>
                      <input
                        type="number" min={1} max={10}
                        className={inputClass}
                        value={question.maxScore}
                        onChange={(event) => patchQuestion(question.clientId, { maxScore: event.target.value })}
                      />
                      <FieldError message={state.fieldErrors?.[`questions.${index}.maxScore`]} />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1D5BD6] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8] disabled:opacity-60"
        >
          {pending ? "جارٍ الحفظ…" : mode === "create" ? "إنشاء الاستبيان" : "حفظ التعديلات"}
        </button>
        <span className="text-xs text-slate-500">يُحفظ الاستبيان كمسودة — يمكن نشره من صفحته بعد المراجعة.</span>
      </div>
    </form>
  );
}
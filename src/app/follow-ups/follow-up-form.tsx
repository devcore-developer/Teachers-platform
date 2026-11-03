"use client";

/**
 * Phase 9 — follow-up create/edit form. The whole definition is
 * serialized to `definitionJson` and re-validated server-side
 * (teacher/supervisor/content links + scope). Supervisors are assigned
 * automatically server-side; the supervisor select appears only for
 * office managers.
 */
import { useActionState, useState } from "react";

import {
  createFollowUpAction,
  updateFollowUpAction,
  type SurveyActionState,
} from "@/app/actions/surveys";
import { FieldError } from "@/app/assignments/ui";

export interface FollowUpFormOptions {
  teachers: { id: string; name: string; branchName: string | null }[];
  supervisors: { id: string; name: string }[];
  programs: { id: string; nameAr: string }[];
  courses: { id: string; titleAr: string }[];
  surveys: { id: string; titleAr: string; stage: string | null }[];
  assignments: { id: string; titleAr: string }[];
}

export interface FollowUpFormInitial {
  teacherId: string;
  supervisorId: string;
  titleAr: string;
  purposeAr: string;
  followUpDate: string; // datetime-local value
  nextFollowUpAt: string;
  programId: string;
  courseId: string;
  surveyId: string;
  assignmentId: string;
  observationAr: string;
  progressAr: string;
  challengesAr: string;
  supportNeedsAr: string;
  recommendationsAr: string;
  sharedWithTeacher: boolean;
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function FollowUpForm({
  mode,
  followUpId,
  initial,
  options,
  isOfficeManager,
}: {
  mode: "create" | "edit";
  followUpId?: string;
  initial: FollowUpFormInitial;
  options: FollowUpFormOptions;
  isOfficeManager: boolean;
}) {
  const action = mode === "create" ? createFollowUpAction : updateFollowUpAction;
  const [state, formAction, pending] = useActionState<SurveyActionState, FormData>(action, { ok: false });

  const [teacherId, setTeacherId] = useState(initial.teacherId);
  const [supervisorId, setSupervisorId] = useState(initial.supervisorId);
  const [titleAr, setTitleAr] = useState(initial.titleAr);
  const [purposeAr, setPurposeAr] = useState(initial.purposeAr);
  const [followUpDate, setFollowUpDate] = useState(toDateInput(initial.followUpDate || null));
  const [nextFollowUpAt, setNextFollowUpAt] = useState(toDateInput(initial.nextFollowUpAt || null));
  const [programId, setProgramId] = useState(initial.programId);
  const [courseId, setCourseId] = useState(initial.courseId);
  const [surveyId, setSurveyId] = useState(initial.surveyId);
  const [assignmentId, setAssignmentId] = useState(initial.assignmentId);
  const [observationAr, setObservationAr] = useState(initial.observationAr);
  const [progressAr, setProgressAr] = useState(initial.progressAr);
  const [challengesAr, setChallengesAr] = useState(initial.challengesAr);
  const [supportNeedsAr, setSupportNeedsAr] = useState(initial.supportNeedsAr);
  const [recommendationsAr, setRecommendationsAr] = useState(initial.recommendationsAr);
  const [sharedWithTeacher, setSharedWithTeacher] = useState(initial.sharedWithTeacher);

  function buildDefinitionJson(): string {
    return JSON.stringify({
      teacherId,
      supervisorId: supervisorId === "" ? null : supervisorId,
      titleAr,
      purposeAr,
      followUpDate: followUpDate === "" ? "" : new Date(followUpDate).toISOString(),
      nextFollowUpAt: nextFollowUpAt === "" ? null : new Date(nextFollowUpAt).toISOString(),
      programId: programId === "" ? null : programId,
      courseId: courseId === "" ? null : courseId,
      surveyId: surveyId === "" ? null : surveyId,
      assignmentId: assignmentId === "" ? null : assignmentId,
      observationAr,
      progressAr,
      challengesAr,
      supportNeedsAr,
      recommendationsAr,
      sharedWithTeacher,
    });
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100";
  const labelClass = "mb-1 block text-xs font-medium text-slate-500";

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="definitionJson" value={buildDefinitionJson()} />
      {mode === "edit" ? <input type="hidden" name="followUpId" value={followUpId ?? ""} /> : null}

      {state.ok ? null : state.message ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{state.message}</div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-slate-800">بيانات المتابعة</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>المعلم *</label>
            <select className={inputClass} value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
              <option value="">— اختر المعلم —</option>
              {options.teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}{teacher.branchName ? ` — ${teacher.branchName}` : ""}
                </option>
              ))}
            </select>
            <FieldError message={state.fieldErrors?.teacherId} />
          </div>
          {isOfficeManager ? (
            <div>
              <label className={labelClass}>المشرف المسؤول *</label>
              <select className={inputClass} value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)}>
                <option value="">— اختر المشرف —</option>
                {options.supervisors.map((supervisor) => (
                  <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>
                ))}
              </select>
              <FieldError message={state.fieldErrors?.supervisorId} />
            </div>
          ) : null}
          <div className="md:col-span-2">
            <label className={labelClass}>عنوان المتابعة *</label>
            <input className={inputClass} value={titleAr} onChange={(event) => setTitleAr(event.target.value)} />
            <FieldError message={state.fieldErrors?.titleAr} />
          </div>
          <div>
            <label className={labelClass}>تاريخ المتابعة *</label>
            <input type="datetime-local" className={inputClass} value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
            <FieldError message={state.fieldErrors?.followUpDate} />
          </div>
          <div>
            <label className={labelClass}>موعد المتابعة القادمة (اختياري)</label>
            <input type="datetime-local" className={inputClass} value={nextFollowUpAt} onChange={(event) => setNextFollowUpAt(event.target.value)} />
            <FieldError message={state.fieldErrors?.nextFollowUpAt} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>الغرض من المتابعة</label>
            <input className={inputClass} value={purposeAr} onChange={(event) => setPurposeAr(event.target.value)} />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-slate-800">الربط التدريبي (اختياري)</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>البرنامج التدريبي</label>
            <select className={inputClass} value={programId} onChange={(event) => setProgramId(event.target.value)}>
              <option value="">— بدون —</option>
              {options.programs.map((program) => (
                <option key={program.id} value={program.id}>{program.nameAr}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>الدورة التدريبية</label>
            <select className={inputClass} value={courseId} onChange={(event) => setCourseId(event.target.value)}>
              <option value="">— بدون —</option>
              {options.courses.map((course) => (
                <option key={course.id} value={course.id}>{course.titleAr}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>الاستبيان المرتبط</label>
            <select className={inputClass} value={surveyId} onChange={(event) => setSurveyId(event.target.value)}>
              <option value="">— بدون —</option>
              {options.surveys.map((survey) => (
                <option key={survey.id} value={survey.id}>{survey.titleAr}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>الواجب التدريبي</label>
            <select className={inputClass} value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>
              <option value="">— بدون —</option>
              {options.assignments.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>{assignment.titleAr}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-bold text-slate-800">ملاحظات المشرف (سرية — لا تظهر للمعلم)</h2>
        <p className="mb-4 text-xs text-slate-500">
          ملاحظات التطبيق الصفي والتحديات واحتياجات الدعم داخلية للمشرفة — لا تدخل مشروعة العرض المشترك مع المعلم إطلاقًا.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>ملاحظات التطبيق الصفي</label>
            <textarea className={inputClass} rows={3} value={observationAr} onChange={(event) => setObservationAr(event.target.value)} />
          </div>
          <div>
            <label className={labelClass}>التقدم المُلاحظ</label>
            <textarea className={inputClass} rows={3} value={progressAr} onChange={(event) => setProgressAr(event.target.value)} />
          </div>
          <div>
            <label className={labelClass}>التحديات</label>
            <textarea className={inputClass} rows={3} value={challengesAr} onChange={(event) => setChallengesAr(event.target.value)} />
          </div>
          <div>
            <label className={labelClass}>احتياجات الدعم</label>
            <textarea className={inputClass} rows={3} value={supportNeedsAr} onChange={(event) => setSupportNeedsAr(event.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>التوصيات (تظهر للمعلم عند المشاركة)</label>
            <textarea className={inputClass} rows={3} value={recommendationsAr} onChange={(event) => setRecommendationsAr(event.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700 md:col-span-2">
            <input type="checkbox" checked={sharedWithTeacher} onChange={(event) => setSharedWithTeacher(event.target.checked)} className="mt-1" />
            <span>
              <strong>مشاركة السجل مع المعلم</strong>
              <span className="block text-xs text-slate-500">
                عند التفعيل يرى المعلم: العنوان، الغرض، التواريخ، الحالة، والتوصيات فقط.
              </span>
            </span>
          </label>
        </div>
      </section>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1D5BD6] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8] disabled:opacity-60"
      >
        {pending ? "جارٍ الحفظ…" : mode === "create" ? "إنشاء سجل المتابعة" : "حفظ التعديلات"}
      </button>
    </form>
  );
}
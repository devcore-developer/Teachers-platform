"use client";

/**
 * Phase 7 — assignment create/edit form (office manager).
 * Client-side UX only: every rule is re-validated on the server.
 * Rubric editing appears only for DRAFT assignments (published rubrics
 * feed real scores and are frozen).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import type { AudienceOptions, ContentOptions, CriterionRow } from "@/lib/assignments/service";
import {
  AUDIENCE_MODE_LABELS,
  MAX_RUBRIC_CRITERIA,
  type AudienceMode,
} from "@/config/assignments";
import {
  createAssignmentAction,
  saveRubricAction,
  updateAssignmentAction,
  type FormActionState,
} from "@/app/actions/assignments";
import { FieldError } from "@/app/assignments/ui";

export interface AssignmentFormInitial {
  id?: string;
  status?: string;
  titleAr?: string;
  titleEn?: string | null;
  descriptionAr?: string;
  descriptionEn?: string | null;
  programId?: string | null;
  courseId?: string | null;
  sectionId?: string | null;
  lessonId?: string | null;
  audienceMode?: string;
  targetTeacherIds?: string[];
  targetBranchIds?: string[];
  dueAt?: string | null;
  allowLate?: boolean;
  lateUntil?: string | null;
  totalPoints?: number;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100";
const labelCls = "mb-1 block text-sm font-medium text-slate-700";

/** ISO string -> datetime-local value (YYYY-MM-DDTHH:mm, local clock). */
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AssignmentForm({
  initial,
  audience,
  content,
  criteria = [],
}: {
  initial?: AssignmentFormInitial;
  audience: AudienceOptions;
  content: ContentOptions;
  criteria?: CriterionRow[];
}) {
  const isEdit = Boolean(initial?.id);
  const isDraft = !isEdit || initial?.status === "DRAFT";

  const [audienceMode, setAudienceMode] = useState<AudienceMode>(
    (initial?.audienceMode as AudienceMode) ?? "ALL_TEACHERS"
  );
  const [courseId, setCourseId] = useState(initial?.courseId ?? "");
  const [sectionId, setSectionId] = useState(initial?.sectionId ?? "");
  const [allowLate, setAllowLate] = useState(Boolean(initial?.allowLate));

  const [rubric, setRubric] = useState<{ titleAr: string; maxPoints: string }[]>(
    criteria.map((criterion) => ({
      titleAr: criterion.titleAr,
      maxPoints: String(criterion.maxPoints),
    }))
  );
  const [rubricState, rubricFormAction, rubricPending] = useActionState<
    FormActionState,
    FormData
  >(saveRubricAction, { ok: false });

  const [mainState, mainFormAction, mainPending] = useActionState<
    FormActionState,
    FormData
  >(isEdit ? updateAssignmentAction : createAssignmentAction, { ok: false });
  const router = useRouter();

  // After creating a draft, jump straight to its edit page (rubric lives there).
  useEffect(() => {
    if (!isEdit && mainState.ok && mainState.data?.id) {
      router.push(`/assignments/${mainState.data.id}/edit`);
    }
  }, [isEdit, mainState, router]);

  const sections = useMemo(
    () => content.sections.filter((section) => !courseId || section.courseId === courseId),
    [content.sections, courseId]
  );
  const lessons = useMemo(
    () => content.lessons.filter((lesson) => !sectionId || lesson.sectionId === sectionId),
    [content.lessons, sectionId]
  );

  return (
    <div className="space-y-6">
      {mainState.message && !mainState.ok ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {mainState.message}
        </div>
      ) : null}
      {mainState.ok && isEdit ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          حفظت التعديلات بنجاح.
        </div>
      ) : null}

      <form action={mainFormAction} className="space-y-6">
        {isEdit ? <input type="hidden" name="assignmentId" value={initial?.id} /> : null}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-800">البيانات الأساسية</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="titleAr">عنوان التكليف (بالعربية) *</label>
              <input id="titleAr" name="titleAr" defaultValue={initial?.titleAr ?? ""} className={inputCls} required maxLength={200} />
            </div>
            <div>
              <label className={labelCls} htmlFor="titleEn">العنوان (بالإنجليزية) — اختياري</label>
              <input id="titleEn" name="titleEn" defaultValue={initial?.titleEn ?? ""} className={inputCls} maxLength={200} dir="ltr" />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls} htmlFor="descriptionAr">الوصف والتعليمات (بالعربية) *</label>
              <textarea id="descriptionAr" name="descriptionAr" defaultValue={initial?.descriptionAr ?? ""} className={`${inputCls} min-h-32`} required maxLength={5000} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls} htmlFor="descriptionEn">الوصف (بالإنجليزية) — اختياري</label>
              <textarea id="descriptionEn" name="descriptionEn" defaultValue={initial?.descriptionEn ?? ""} className={`${inputCls} min-h-24`} maxLength={5000} dir="ltr" />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-800">الربط بالمحتوى التدريبي (اختياري)</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="programId">البرنامج التدريبي</label>
              <select id="programId" name="programId" defaultValue={initial?.programId ?? ""} className={inputCls}>
                <option value="">— بدون —</option>
                {content.programs.map((program) => (
                  <option key={program.id} value={program.id}>{program.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="courseId">الدورة التدريبية</label>
              <select
                id="courseId"
                name="courseId"
                value={courseId}
                onChange={(event) => {
                  setCourseId(event.target.value);
                  setSectionId("");
                }}
                className={inputCls}
              >
                <option value="">— بدون —</option>
                {content.courses.map((course) => (
                  <option key={course.id} value={course.id}>{course.titleAr}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="sectionId">القسم</label>
              <select
                id="sectionId"
                name="sectionId"
                value={sectionId}
                onChange={(event) => setSectionId(event.target.value)}
                className={inputCls}
                disabled={!courseId}
              >
                <option value="">— بدون —</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>{section.titleAr}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="lessonId">الدرس</label>
              <select id="lessonId" name="lessonId" defaultValue={initial?.lessonId ?? ""} className={inputCls} disabled={!sectionId}>
                <option value="">— بدون —</option>
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>{lesson.titleAr}</option>
                ))}
              </select>
            </div>
          </div>
          {initial?.status === "PUBLISHED" ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              التكليف منشور: تعديل الفئة المستهدفة والربط بالمحتوى متوقف لحماية أهلية التسليمات الجارية.
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-800">الفئة المستهدفة</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(AUDIENCE_MODE_LABELS) as AudienceMode[]).map((mode) => (
              <label
                key={mode}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  audienceMode === mode
                    ? "border-[#1D5BD6] bg-blue-50 font-medium text-[#1D5BD6]"
                    : "border-slate-300 text-slate-600"
                }`}
              >
                <input
                  type="radio"
                  name="audienceMode"
                  value={mode}
                  checked={audienceMode === mode}
                  onChange={() => setAudienceMode(mode)}
                  disabled={initial?.status === "PUBLISHED"}
                />
                {AUDIENCE_MODE_LABELS[mode]}
              </label>
            ))}
          </div>

          {audienceMode === "BRANCHES" ? (
            <div className="mt-4">
              <p className={labelCls}>اختر الفروع *</p>
              <div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                {audience.branches.map((branch) => (
                  <label key={branch.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="branchIds"
                      value={branch.id}
                      defaultChecked={initial?.targetBranchIds?.includes(branch.id) ?? false}
                      disabled={initial?.status === "PUBLISHED"}
                    />
                    {branch.name}
                  </label>
                ))}
                {audience.branches.length === 0 ? (
                  <p className="text-xs text-slate-400">لا توجد فروع مسجلة لهذه المدرسة بعد.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {audienceMode === "TEACHERS" ? (
            <div className="mt-4">
              <p className={labelCls}>اختر المعلمين *</p>
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                {audience.teachers.map((teacher) => (
                  <label key={teacher.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="teacherIds"
                      value={teacher.id}
                      defaultChecked={initial?.targetTeacherIds?.includes(teacher.id) ?? false}
                      disabled={initial?.status === "PUBLISHED"}
                    />
                    {teacher.name}
                    {teacher.branchName ? (
                      <span className="text-xs text-slate-400">({teacher.branchName})</span>
                    ) : null}
                  </label>
                ))}
                {audience.teachers.length === 0 ? (
                  <p className="text-xs text-slate-400">لا يوجد معلمون في هذه المدرسة بعد.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-800">المواعيد وسياسة التأخر</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="dueAt">تاريخ ووقت الاستحقاق *</label>
              <input
                id="dueAt"
                name="dueAt"
                type="datetime-local"
                defaultValue={toDatetimeLocal(initial?.dueAt)}
                className={inputCls}
                required
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="allowLate"
                  checked={allowLate}
                  onChange={(event) => setAllowLate(event.target.checked)}
                />
                السماح بالتسليم المتأخر بعد الموعد
              </label>
            </div>
            {allowLate ? (
              <div>
                <label className={labelCls} htmlFor="lateUntil">نهاية القبول المتأخر — اختياري</label>
                <input
                  id="lateUntil"
                  name="lateUntil"
                  type="datetime-local"
                  defaultValue={toDatetimeLocal(initial?.lateUntil)}
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-slate-400">اتركه فارغًا للقبول المتأخر دون حد زمني.</p>
              </div>
            ) : null}
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mainPending}
            className="rounded-lg bg-[#1D5BD6] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8] disabled:opacity-60"
          >
            {mainPending ? "جارٍ الحفظ…" : isEdit ? "حفظ التعديلات" : "إنشاء التكليف (مسودة)"}
          </button>
          <Link href="/assignments" className="text-sm font-medium text-slate-500 hover:text-slate-700">
            إلغاء
          </Link>
        </div>
      </form>

      {isDraft ? (
        <RubricEditor
          assignmentId={initial?.id}
          state={rubricState}
          formAction={rubricFormAction}
          pending={rubricPending}
          rows={rubric}
          setRows={setRubric}
        />
      ) : null}
    </div>
  );
}

function RubricEditor({
  assignmentId,
  state,
  formAction,
  pending,
  rows,
  setRows,
}: {
  assignmentId?: string;
  state: FormActionState;
  formAction: (formData: FormData) => void;
  pending: boolean;
  rows: { titleAr: string; maxPoints: string }[];
  setRows: (rows: { titleAr: string; maxPoints: string }[]) => void;
}) {
  const total = rows.reduce(
    (sum, row) => sum + (Number(row.maxPoints) || 0),
    0
  );

  if (!assignmentId) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">سلّم التقييم (اختياري)</h2>
        <p className="mt-2 text-sm text-slate-500">
          أنشئ التكليف أولًا ثم عدّل صفحته لإضافة عناصر سلّم التقييم.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-800">سلّم التقييم (اختياري)</h2>
        <span className="text-sm text-slate-500">
          المجموع: <strong className="text-[#1D5BD6]">{total}</strong> نقطة
        </span>
      </div>

      {state.message && !state.ok ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>
      ) : null}
      {state.ok ? (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          تم حفظ سلّم التقييم بنجاح.
        </p>
      ) : null}

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <input
          type="hidden"
          name="criteriaJson"
          value={JSON.stringify(
            rows
              .filter((row) => row.titleAr.trim() && Number(row.maxPoints) > 0)
              .map((row) => ({ titleAr: row.titleAr.trim(), maxPoints: Number(row.maxPoints) }))
          )}
        />

        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input
                className={`${inputCls} flex-1`}
                placeholder={`عنصر التقييم ${index + 1}`}
                value={row.titleAr}
                maxLength={200}
                onChange={(event) => {
                  const next = [...rows];
                  next[index] = { ...next[index], titleAr: event.target.value };
                  setRows(next);
                }}
              />
              <input
                className={`${inputCls} w-28`}
                type="number"
                min={1}
                max={100}
                placeholder="الدرجة"
                value={row.maxPoints}
                onChange={(event) => {
                  const next = [...rows];
                  next[index] = { ...next[index], maxPoints: event.target.value };
                  setRows(next);
                }}
              />
              <button
                type="button"
                className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                حذف
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg border border-[#1D5BD6] px-4 py-2 text-sm font-medium text-[#1D5BD6] hover:bg-blue-50 disabled:opacity-60"
            disabled={rows.length >= MAX_RUBRIC_CRITERIA}
            onClick={() => setRows([...rows, { titleAr: "", maxPoints: "" }])}
          >
            + إضافة عنصر
          </button>
          <button
            type="submit"
            disabled={pending || rows.length === 0}
            className="rounded-lg bg-[#1D5BD6] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8] disabled:opacity-60"
          >
            {pending ? "جارٍ الحفظ…" : "حفظ سلّم التقييم"}
          </button>
        </div>
      </form>
    </section>
  );
}
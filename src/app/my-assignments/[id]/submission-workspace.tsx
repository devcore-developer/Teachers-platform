"use client";

/**
 * Phase 7 — the teacher's submission workspace: response text, file
 * attachments (upload/delete with server-enforced type/size/count),
 * draft saving and final submission with confirmation.
 * All rules re-run server-side; this UI mirrors their outcomes.
 */
import { useActionState, useRef } from "react";

import {
  deleteSubmissionFileAction,
  saveSubmissionDraftAction,
  submitSubmissionAction,
  uploadSubmissionFileAction,
  type FormActionState,
} from "@/app/actions/assignments";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100";

export interface SubmissionFileView {
  id: string;
  fileName: string;
  sizeLabel: string;
}

export function SubmissionWorkspace({
  assignmentId,
  initialText,
  files,
  canEdit,
  windowLabel,
}: {
  assignmentId: string;
  initialText: string;
  files: SubmissionFileView[];
  canEdit: boolean;
  windowLabel: string;
}) {
  const [draftState, draftFormAction, draftPending] = useActionState<FormActionState, FormData>(
    saveSubmissionDraftAction,
    { ok: false }
  );
  const [submitState, submitFormAction, submitPending] = useActionState<FormActionState, FormData>(
    submitSubmissionAction,
    { ok: false }
  );
  const [uploadState, uploadFormAction, uploadPending] = useActionState<FormActionState, FormData>(
    uploadSubmissionFileAction,
    { ok: false }
  );
  const [deleteState, deleteFormAction] = useActionState<FormActionState, FormData>(
    deleteSubmissionFileAction,
    { ok: false }
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!canEdit) {
    return null;
  }

  return (
    <div className="space-y-5">
      {submitState.ok ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {submitState.data?.isLate
            ? "تم استلام تسليمك (مسجل كتسليم متأخر وفق سياسة القبول المتأخر)."
            : "تم استلام تسليمك بنجاح — سيصلك التقييم والتغذية الراجعة بعد المراجعة."}
        </div>
      ) : null}
      {submitState.message && !submitState.ok ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitState.message}
        </div>
      ) : null}

      <form action={submitFormAction}>
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="responseText">
          نص التسليم
        </label>
        <textarea
          id="responseText"
          name="responseText"
          defaultValue={initialText}
          rows={8}
          maxLength={10000}
          placeholder="اكتب إجابتك أو وصف العمل المرفق…"
          className={inputCls}
        />
        <p className="mt-1 text-xs text-slate-400">{windowLabel}</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            formAction={submitFormAction}
            disabled={submitPending}
            className="rounded-lg bg-[#1D5BD6] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8] disabled:opacity-60"
          >
            {submitPending ? "جارٍ التسليم…" : "تسليم نهائي"}
          </button>
          <button
            type="submit"
            formAction={draftFormAction}
            disabled={draftPending}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {draftPending ? "جارٍ الحفظ…" : "حفظ كمسودة"}
          </button>
        </div>
        {draftState.message && !draftState.ok ? (
          <p className="mt-2 text-xs text-red-600">{draftState.message}</p>
        ) : null}
        {draftState.ok ? (
          <p className="mt-2 text-xs text-emerald-600">حُفظت المسودة.</p>
        ) : null}
      </form>

      <div className="rounded-lg border border-slate-200 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">المرفقات ({files.length}/5)</h3>
        {uploadState.message && !uploadState.ok ? (
          <p className="mb-2 text-xs text-red-600">{uploadState.message}</p>
        ) : null}
        <form action={uploadFormAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept=".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            className="block w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-[#1D5BD6]"
            required
          />
          <button
            type="submit"
            disabled={uploadPending || files.length >= 5}
            className="rounded-lg border border-[#1D5BD6] px-4 py-2 text-sm font-medium text-[#1D5BD6] hover:bg-blue-50 disabled:opacity-60"
          >
            {uploadPending ? "جارٍ الرفع…" : "رفع المرفق"}
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-400">
          الأنواع المسموحة: PDF، صور، Word، Excel، PowerPoint، نص — بحد أقصى 10 ميغابايت للملف.
        </p>

        {files.length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {files.map((file) => (
              <li key={file.id} className="flex items-center justify-between py-2 text-sm">
                <a href={`/api/assignment-files/${file.id}`} className="text-slate-700 hover:text-[#1D5BD6] hover:underline">
                  {file.fileName}
                </a>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{file.sizeLabel}</span>
                  <form action={deleteFormAction}>
                    <input type="hidden" name="fileId" value={file.id} />
                    <button
                      type="submit"
                      className="text-xs font-medium text-red-500 hover:underline"
                    >
                      حذف
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {deleteState.message && !deleteState.ok ? (
          <p className="mt-2 text-xs text-red-600">{deleteState.message}</p>
        ) : null}
      </div>
    </div>
  );
}
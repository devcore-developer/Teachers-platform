"use client";

/**
 * Phase 10 — archive/restore action forms (client). Each button posts
 * a server action whose actor comes from the session; failures surface
 * the service's Arabic message verbatim.
 */
import { useActionState } from "react";

import {
  archiveFollowUpAction,
  restoreAssignmentAction,
  restoreAssessmentAction,
  restoreCourseAction,
  restoreFollowUpAction,
  restoreProgramAction,
  type ArchiveActionState,
} from "@/app/actions/archive";

const initialState: ArchiveActionState = { ok: false };

function ActionButton({
  action,
  idField,
  id,
  label,
  tone = "brand",
}: {
  action: (prev: ArchiveActionState, formData: FormData) => Promise<ArchiveActionState>;
  idField: string;
  id: string;
  label: string;
  tone?: "brand" | "outline" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const toneClasses =
    tone === "brand"
      ? "bg-[#1D5BD6] text-white hover:bg-[#174bb3]"
      : tone === "danger"
        ? "border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
        : "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100";
  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name={idField} value={id} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-60 ${toneClasses}`}
      >
        {pending ? "جارٍ التنفيذ…" : label}
      </button>
      {state.message ? (
        <p className={`text-[11px] ${state.ok ? "text-emerald-600" : "text-red-600"}`}>{state.message}</p>
      ) : null}
    </form>
  );
}

export function ArchiveFollowUpButton({ followUpId }: { followUpId: string }) {
  return (
    <ActionButton
      action={archiveFollowUpAction}
      idField="followUpId"
      id={followUpId}
      label="أرشفة السجل"
      tone="danger"
    />
  );
}

export function RestoreFollowUpButton({ followUpId }: { followUpId: string }) {
  return (
    <ActionButton
      action={restoreFollowUpAction}
      idField="followUpId"
      id={followUpId}
      label="استعادة"
      tone="outline"
    />
  );
}

export function RestoreAssignmentButton({ assignmentId }: { assignmentId: string }) {
  return (
    <ActionButton
      action={restoreAssignmentAction}
      idField="assignmentId"
      id={assignmentId}
      label="استعادة إلى مغلق"
      tone="outline"
    />
  );
}

export function RestoreCourseButton({ courseId }: { courseId: string }) {
  return (
    <ActionButton action={restoreCourseAction} idField="courseId" id={courseId} label="استعادة" tone="outline" />
  );
}

export function RestoreProgramButton({ programId }: { programId: string }) {
  return (
    <ActionButton action={restoreProgramAction} idField="programId" id={programId} label="استعادة" tone="outline" />
  );
}

export function RestoreAssessmentButton({ assessmentId }: { assessmentId: string }) {
  return (
    <ActionButton
      action={restoreAssessmentAction}
      idField="assessmentId"
      id={assessmentId}
      label="استعادة"
      tone="outline"
    />
  );
}
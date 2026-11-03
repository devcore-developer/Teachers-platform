/**
 * Phase 9 — shared follow-up UI atoms.
 */
import { FOLLOW_UP_STATUS_LABELS, type FollowUpStatus } from "@/config/surveys";

const STATUS_STYLES: Record<FollowUpStatus, string> = {
  PLANNED: "bg-sky-50 text-sky-700 border-sky-200",
  IN_PROGRESS: "bg-blue-50 text-[#1D5BD6] border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-slate-100 text-slate-500 border-slate-200",
};

export function FollowUpStatusBadge({ status }: { status: string }) {
  const label = FOLLOW_UP_STATUS_LABELS[status as FollowUpStatus] ?? status;
  const style = STATUS_STYLES[status as FollowUpStatus] ?? STATUS_STYLES.PLANNED;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

export function SharedBadge({ shared }: { shared: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        shared ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"
      }`}
    >
      {shared ? "مشترك مع المعلم" : "غير مشترك"}
    </span>
  );
}
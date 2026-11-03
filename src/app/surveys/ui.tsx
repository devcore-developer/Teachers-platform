/**
 * Phase 9 — shared survey UI atoms: status/stage badges, question-type
 * labels and small renderers reused by management and respondent pages.
 */
import {
  LIKERT_OPTIONS,
  LIKERT_POINTS,
  SURVEY_QUESTION_TYPE_LABELS,
  SURVEY_STAGE_LABELS,
  SURVEY_STATUS_LABELS,
  type SurveyQuestionType,
  type SurveyStage,
  type SurveyStatus,
} from "@/config/surveys";

const STATUS_STYLES: Record<SurveyStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 border-slate-200",
  PUBLISHED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CLOSED: "bg-amber-50 text-amber-700 border-amber-200",
  ARCHIVED: "bg-slate-100 text-slate-500 border-slate-200",
};

export function SurveyStatusBadge({ status }: { status: string }) {
  const label = SURVEY_STATUS_LABELS[status as SurveyStatus] ?? status;
  const style = STATUS_STYLES[status as SurveyStatus] ?? STATUS_STYLES.DRAFT;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

const STAGE_STYLES: Record<SurveyStage, string> = {
  PRE_TRAINING: "bg-sky-50 text-sky-700 border-sky-200",
  AFTER_TRAINING: "bg-blue-50 text-[#1D5BD6] border-blue-200",
  APPLICATION_FOLLOWUP: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

export function SurveyStageBadge({ stage }: { stage: string | null }) {
  if (!stage) return null;
  const label = SURVEY_STAGE_LABELS[stage as SurveyStage] ?? stage;
  const style = STAGE_STYLES[stage as SurveyStage] ?? STAGE_STYLES.PRE_TRAINING;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      {label}
    </span>
  );
}

export function AnonymousBadge({ anonymous }: { anonymous: boolean }) {
  if (!anonymous) return null;
  return (
    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
      مجهول الهوية
    </span>
  );
}

export function questionTypeLabel(type: string): string {
  return SURVEY_QUESTION_TYPE_LABELS[type as SurveyQuestionType] ?? type;
}

/** Likert ordinal label (5 = strongest agreement). */
export function likertLabelForValue(value: number): string {
  const index = LIKERT_POINTS - value;
  return LIKERT_OPTIONS[index] ?? String(value);
}

/** Horizontal distribution bar (brand blue, RTL-safe). */
export function DistributionBar({
  label,
  count,
  total,
  highlight,
}: {
  label: string;
  count: number;
  total: number;
  highlight?: boolean;
}) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
        <span className="font-medium">{label}</span>
        <span dir="ltr" className="text-slate-500">
          {count} ({percent}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${highlight ? "bg-[#1D5BD6]" : "bg-[#1D5BD6]/70"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
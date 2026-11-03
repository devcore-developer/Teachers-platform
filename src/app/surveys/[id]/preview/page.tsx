/**
 * Phase 9 — respondent-experience preview (read-only, no interaction).
 * Renders exactly what teachers will see; excluded from indexing and
 * shows an explicit preview banner.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { getSurveyManageView } from "@/lib/surveys/service";
import { LIKERT_OPTIONS } from "@/config/surveys";
import { AccessDenied, Card, PageHeader } from "@/app/assignments/ui";
import { AnonymousBadge, SurveyStageBadge, questionTypeLabel } from "@/app/surveys/ui";

export const dynamic = "force-dynamic";

function actorFrom(user: { id: string; role: string; schoolId: string | null }): SurveyActor | null {
  if (user.role === "DEVELOPMENT_OFFICE_MANAGER" || user.role === "EDUCATIONAL_SUPERVISOR") {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

export default async function SurveyPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="المعاينة متاحة لمؤلف الاستبيان أو مدير المكتب فقط." />;
  }

  const { id } = await params;
  const result = await getSurveyManageView(ctx, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={result.message} />;
  }
  const { survey, questions } = result.data;

  return (
    <div>
      <PageHeader
        title="معاينة الاستبيان"
        subtitle="هكذا سيظهر الاستبيان للمعلمين — المعاينة للقراءة فقط"
        actions={
          <Link
            href={`/surveys/${id}`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            رجوع
          </Link>
        }
      />

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-[#1D5BD6]">
        وضع المعاينة — لا تُسجَّل أي إجابات هنا.
      </div>

      <Card>
        <div className="mb-6">
          <h2 className="text-lg font-bold text-slate-900">{survey.titleAr}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <SurveyStageBadge stage={survey.stage} />
            <AnonymousBadge anonymous={survey.anonymous} />
          </div>
          {survey.descriptionAr ? (
            <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{survey.descriptionAr}</p>
          ) : null}
          {survey.purposeAr ? (
            <p className="mt-2 text-sm text-slate-600"><strong>الغرض:</strong> {survey.purposeAr}</p>
          ) : null}
          {survey.instructionsAr ? (
            <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{survey.instructionsAr}</p>
          ) : null}
        </div>

        <ol className="space-y-6">
          {questions.map((question, index) => (
            <li key={question.id}>
              <p className="text-sm font-semibold text-slate-800">
                {index + 1}. {question.textAr}
                {question.required ? <span className="mr-1 text-red-500">*</span> : null}
              </p>
              {question.helpTextAr ? <p className="mt-1 text-xs text-slate-500">{question.helpTextAr}</p> : null}
              <p className="mt-1 text-[11px] text-slate-400">{questionTypeLabel(question.type)}</p>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                {question.type === "SINGLE_CHOICE" || question.type === "MULTI_CHOICE" ? (
                  question.options.map((option, optionIndex) => (
                    <label key={optionIndex} className="flex items-center gap-2">
                      <input type={question.type === "SINGLE_CHOICE" ? "radio" : "checkbox"} disabled className="accent-[#1D5BD6]" />
                      {option}
                    </label>
                  ))
                ) : null}
                {question.type === "RATING" ? (
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: (question.maxScore ?? 5) - (question.minScore ?? 1) + 1 }, (_, i) => (question.minScore ?? 1) + i).map((value) => (
                      <span key={value} className="rounded-lg border border-slate-200 px-3 py-1 text-xs">{value}</span>
                    ))}
                  </div>
                ) : null}
                {question.type === "LIKERT" ? (
                  <div className="grid gap-2 sm:grid-cols-5">
                    {LIKERT_OPTIONS.map((label, labelIndex) => (
                      <span key={labelIndex} className="rounded-lg border border-slate-200 px-2 py-1 text-center text-[11px]">{label}</span>
                    ))}
                  </div>
                ) : null}
                {question.type === "YES_NO" ? (
                  <div className="flex gap-2">
                    <span className="rounded-lg border border-slate-200 px-3 py-1 text-xs">نعم</span>
                    <span className="rounded-lg border border-slate-200 px-3 py-1 text-xs">لا</span>
                  </div>
                ) : null}
                {question.type === "SHORT_TEXT" ? (
                  <div className="h-9 rounded-lg border border-dashed border-slate-300" />
                ) : null}
                {question.type === "LONG_TEXT" ? (
                  <div className="h-24 rounded-lg border border-dashed border-slate-300" />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
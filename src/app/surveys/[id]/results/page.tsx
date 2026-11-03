/**
 * Phase 9 — "تحليل النتائج": aggregates computed from persisted
 * responses with explicit denominators, per-question distributions,
 * pre/post stage comparison and (when permitted) the identified
 * response list. Anonymous small groups are privacy-suppressed.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { getStageComparison, getSurveyResults } from "@/lib/surveys/service";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  formatDate,
} from "@/app/assignments/ui";
import { DistributionBar, SurveyStageBadge, SurveyStatusBadge } from "@/app/surveys/ui";

export const dynamic = "force-dynamic";

function actorFrom(user: { id: string; role: string; schoolId: string | null }): SurveyActor | null {
  if (
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    user.role === "EDUCATIONAL_SUPERVISOR" ||
    user.role === "EDUCATIONAL_DEPUTY"
  ) {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

export default async function SurveyResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="تحليل النتائج متاح للأدوار الإدارية المدرسية فقط." />;
  }

  const { id } = await params;
  const [results, comparison] = await Promise.all([
    getSurveyResults(ctx, id),
    getStageComparison(ctx, id),
  ]);
  if (!results.ok) {
    if (results.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={results.message} />;
  }
  const { survey, eligibleCount, submittedCount, draftCount, responseRatePercent, privacySuppressed, distributions, responses, canSeeIndividualResponses } = results.data;
  const stageComparison = comparison.ok ? comparison.data : null;

  return (
    <div>
      <PageHeader
        title="تحليل النتائج"
        subtitle={survey.titleAr}
        actions={
          <Link href={`/surveys/${id}`} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            رجوع للاستبيان
          </Link>
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SurveyStatusBadge status={survey.status} />
        <SurveyStageBadge stage={survey.stage} />
        {survey.anonymous ? (
          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">مجهول الهوية</span>
        ) : null}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="نسبة الاستجابة"
          value={responseRatePercent === null ? "—" : `${responseRatePercent}%`}
          tone="brand"
        />
        <StatTile label="الردود المرسلة" value={submittedCount} tone="success" />
        <StatTile label="المستجيبون المؤهلون (المقام)" value={eligibleCount} tone="warning" />
        <StatTile label="حفظ مؤقت غير مُرسل" value={draftCount} />
      </div>
      <p className="mb-6 text-xs text-slate-500">
        المقام: عدد المعلمين المؤهلين فعليًا (الجمهور المستهدف بعد تطبيق نطاق المؤلف). النسبة = الردود المرسلة ÷ المستجيبون المؤهلون. الحقول غير المُجابة تُستثنى من متوسطاتها فقط ولا تُحسب رفضًا.
      </p>

      {privacySuppressed ? (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          عدد الردود ({submittedCount}) أقل من الحد المطلوب للعرض ({3}) في استبيان مجهول الهوية — إخفاء التوزيعات والنصوص حمايةً لخصوصية المستجيبين.
        </div>
      ) : null}

      {/* --------------------------------------------- Stage comparison */}
      {stageComparison ? (
        <Card>
          <h2 className="mb-1 text-sm font-bold text-slate-800">مقارنة قبل/بعد التدريب</h2>
          <p className="mb-4 text-xs text-slate-500">
            {stageComparison.note} — المتوسطات لمقياس (التقييم/ليكرت) للمستجيبين الذين أجابوا على الاستبيانين. «التغير المُلاحظ» = فرق متوسطين فقط، ولا يُعد إثباتًا لعلاقة سببية.
          </p>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="مستجيبون مزدوجون (المقام)" value={stageComparison.pairedCount} tone="brand" />
            <StatTile label="متوسط ما قبل التدريب" value={stageComparison.preAverage ?? "—"} />
            <StatTile label="متوسط ما بعد التدريب" value={stageComparison.afterAverage ?? "—"} />
            <StatTile
              label="التغير المُلاحظ"
              value={stageComparison.observedDelta === null ? "—" : `${stageComparison.observedDelta > 0 ? "+" : ""}${stageComparison.observedDelta}`}
              tone={stageComparison.observedDelta !== null && stageComparison.observedDelta > 0 ? "success" : "warning"}
            />
          </div>
          {stageComparison.privacySuppressed ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              عدد الأزواج المجهولة أقل من الحد الآمن — تم إخفاء المتوسطات حمايةً للخصوصية.
            </div>
          ) : stageComparison.perQuestion.length > 0 ? (
            <div className="space-y-3">
              {stageComparison.perQuestion.map((question) => (
                <div key={question.textAr} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-sm">
                  <p className="font-medium text-slate-700">{question.textAr}</p>
                  <p className="mt-1 text-xs text-slate-500" dir="ltr">
                    {question.preAverage} → {question.afterAverage} (Δ {question.delta !== null && question.delta > 0 ? "+" : ""}{question.delta})
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">لا توجد أسئلة مقياس متطابقة النص بين الاستبيانين بعد.</p>
          )}
        </Card>
      ) : null}

      {/* --------------------------------------------- Per-question */}
      <div className="mt-6 space-y-6">
        {distributions.length === 0 ? (
          <EmptyState title="لا توجد أسئلة في هذا الاستبيان" />
        ) : null}
        {distributions.map((question, index) => (
          <Card key={question.questionId}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-800">
                {index + 1}. {question.textAr}
              </h3>
              <span className="text-xs text-slate-500">
                أجاب {question.answeredCount} من {submittedCount}
                {question.skippedCount > 0 ? ` — تجاوز ${question.skippedCount}` : ""}
              </span>
            </div>

            {privacySuppressed ? (
              <p className="text-xs text-slate-400">العرض مُخفي لحماية الخصوصية (عدد ردود قليل).</p>
            ) : question.numericDistribution.length > 0 ? (
              <>
                {question.average !== null ? (
                  <p className="mb-3 text-xs font-semibold text-[#1D5BD6]">
                    المتوسط: {question.average} {question.type === "LIKERT" ? "من 5" : ""}
                  </p>
                ) : null}
                {question.numericDistribution.map((item) => (
                  <DistributionBar
                    key={item.value}
                    label={item.label ?? String(item.value)}
                    count={item.count}
                    total={question.answeredCount}
                    highlight
                  />
                ))}
              </>
            ) : question.optionCounts.length > 0 ? (
              question.optionCounts.map((item) => (
                <DistributionBar key={item.option} label={item.option} count={item.count} total={question.answeredCount} highlight />
              ))
            ) : question.texts !== null ? (
              question.texts.length === 0 ? (
                <p className="text-xs text-slate-400">لا توجد إجابات نصية بعد.</p>
              ) : (
                <ul className="space-y-2">
                  {question.texts.map((text, textIndex) => (
                    <li key={textIndex} className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700">
                      {survey.anonymous ? <span className="mr-1 text-[11px] text-slate-400">رد مجهول — </span> : null}
                      {text}
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </Card>
        ))}
      </div>

      {/* --------------------------------------------- Individual responses */}
      {canSeeIndividualResponses ? (
        <Card>
          <h2 className="mb-4 text-sm font-bold text-slate-800">الردود الفردية (استبيان معرّف الهوية)</h2>
          {responses.length === 0 ? (
            <EmptyState title="لا توجد ردود مرسلة بعد" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">المستجيب</th>
                    <th className="px-3 py-2 font-medium">الفرع</th>
                    <th className="px-3 py-2 font-medium">وقت الإرسال</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((response) => (
                    <tr key={response.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2 text-slate-700">{response.respondentName ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{response.branchName ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{formatDate(response.submittedAt)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/surveys/${id}/responses/${response.id}`} className="text-xs font-medium text-[#1D5BD6] hover:underline">
                          عرض الرد
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : survey.anonymous ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          الاستبيان مجهول الهوية — الردود الفردية غير متاحة تقنيًا ولا تُعرض للمسمى الوظيفي مهما كانت صلاحياته.
        </div>
      ) : null}
    </div>
  );
}
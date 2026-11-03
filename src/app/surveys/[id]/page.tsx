/**
 * Phase 9 — survey overview (management): definition, questions,
 * audience summary, lifecycle actions and the append-only audit trail.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { getSurveyManageView } from "@/lib/surveys/service";
import { SURVEY_EVENT_LABELS, type SurveyEventType } from "@/config/surveys";
import {
  AccessDenied,
  Card,
  PageHeader,
  StatTile,
  formatDate,
} from "@/app/assignments/ui";
import {
  AnonymousBadge,
  SurveyStageBadge,
  SurveyStatusBadge,
  questionTypeLabel,
} from "@/app/surveys/ui";
import SurveyStatusActions from "@/app/surveys/[id]/survey-status-actions";

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

export default async function SurveyOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="صفحة الاستبيان متاحة للأدوار الإدارية المدرسية فقط." />;
  }

  const { id } = await params;
  const result = await getSurveyManageView(ctx, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={result.message} />;
  }

  const { survey, questions, events, eligibleCount, permissions } = result.data;

  return (
    <div>
      <PageHeader
        title={survey.titleAr}
        subtitle="نظرة عامة على الاستبيان وأسئلته وجمهوره وسجلّه التدقيقي"
        actions={
          <div className="flex flex-wrap gap-2">
            {permissions.canSeeResults ? (
              <Link
                href={`/surveys/${id}/results`}
                className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-semibold text-white hover:bg-[#174aa8]"
              >
                تحليل النتائج
              </Link>
            ) : null}
            {permissions.canEdit ? (
              <Link
                href={`/surveys/${id}/edit`}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                تعديل
              </Link>
            ) : null}
            {permissions.canEdit ? (
              <Link
                href={`/surveys/${id}/preview`}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                معاينة
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="الحالة" value={<SurveyStatusBadge status={survey.status} />} tone="brand" />
        <StatTile label="الأسئلة" value={survey.questionsCount} />
        <StatTile label="المستجيبون المؤهلون" value={eligibleCount} tone="warning" />
        <StatTile label="الردود المرسلة" value={survey.submittedCount} tone="success" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-sm font-bold text-slate-800">بيانات الاستبيان</h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">المرحلة</dt>
                <dd className="mt-1"><SurveyStageBadge stage={survey.stage} /></dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">الهوية</dt>
                <dd className="mt-1"><AnonymousBadge anonymous={survey.anonymous} /></dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">الجمهور</dt>
                <dd className="mt-1 text-slate-700">{survey.audienceLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">المحتوى المرتبط</dt>
                <dd className="mt-1 text-slate-700">{survey.contentTitle ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">فتح الإستجابة</dt>
                <dd className="mt-1 text-slate-700">{survey.opensAt ? formatDate(survey.opensAt) : "عند النشر"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">إغلاق الإستجابة</dt>
                <dd className="mt-1 text-slate-700">{survey.closesAt ? formatDate(survey.closesAt) : "حتى الإغلاق اليدوي"}</dd>
              </div>
              {survey.linkPairCode ? (
                <div>
                  <dt className="text-xs text-slate-500">رمز الربط (قبل/بعد)</dt>
                  <dd className="mt-1 font-mono text-xs text-slate-700" dir="ltr">{survey.linkPairCode}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs text-slate-500">المؤلف</dt>
                <dd className="mt-1 text-slate-700">{survey.ownerName}</dd>
              </div>
              {survey.descriptionAr ? (
                <div className="md:col-span-2">
                  <dt className="text-xs text-slate-500">الوصف</dt>
                  <dd className="mt-1 whitespace-pre-line text-slate-700">{survey.descriptionAr}</dd>
                </div>
              ) : null}
              {survey.purposeAr ? (
                <div className="md:col-span-2">
                  <dt className="text-xs text-slate-500">الغرض</dt>
                  <dd className="mt-1 whitespace-pre-line text-slate-700">{survey.purposeAr}</dd>
                </div>
              ) : null}
              {survey.instructionsAr ? (
                <div className="md:col-span-2">
                  <dt className="text-xs text-slate-500">التعليمات</dt>
                  <dd className="mt-1 whitespace-pre-line text-slate-700">{survey.instructionsAr}</dd>
                </div>
              ) : null}
              {survey.targetTeacherNames.length > 0 ? (
                <div className="md:col-span-2">
                  <dt className="text-xs text-slate-500">المعلمون المستهدفون ({survey.targetTeacherNames.length})</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {survey.targetTeacherNames.map((name) => (
                      <span key={name} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{name}</span>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card>
            <h2 className="mb-4 text-sm font-bold text-slate-800">الأسئلة ({questions.length})</h2>
            <ol className="space-y-3">
              {questions.map((question, index) => (
                <li key={question.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-800">
                      {index + 1}. {question.textAr}
                      {question.required ? <span className="mr-1 text-red-500">*</span> : null}
                    </p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200">
                      {questionTypeLabel(question.type)}
                    </span>
                  </div>
                  {question.helpTextAr ? (
                    <p className="mt-1 text-xs text-slate-500">{question.helpTextAr}</p>
                  ) : null}
                  {question.options.length > 0 ? (
                    <p className="mt-1 text-xs text-slate-500">الخيارات: {question.options.join(" / ")}</p>
                  ) : null}
                  {question.type === "RATING" ? (
                    <p className="mt-1 text-xs text-slate-500" dir="ltr">
                      Scale: {question.minScore}–{question.maxScore}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-sm font-bold text-slate-800">إجراءات دورة الحياة</h2>
            {survey.isOwn || ctx.role === "DEVELOPMENT_OFFICE_MANAGER" ? (
              <SurveyStatusActions surveyId={id} status={survey.status} />
            ) : (
              <p className="text-xs text-slate-500">لا تملك صلاحية تغيير حالة هذا الاستبيان.</p>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-bold text-slate-800">سجل التدقيق</h2>
            {events.length === 0 ? (
              <p className="text-xs text-slate-500">لا توجد أحداث بعد.</p>
            ) : (
              <ol className="space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="border-r-2 border-[#1D5BD6]/30 pr-3">
                    <p className="text-xs font-semibold text-slate-700">
                      {SURVEY_EVENT_LABELS[event.type as SurveyEventType] ?? event.type}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {event.actorName ?? "النظام"} — {formatDate(event.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
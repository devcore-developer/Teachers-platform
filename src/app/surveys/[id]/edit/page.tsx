/**
 * Phase 9 — survey edit page (DRAFT only, author or office manager).
 * Pre-fills the question builder from the persisted definition.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { getSurveyManageView, listSurveyFormOptions } from "@/lib/surveys/service";
import { AccessDenied, PageHeader } from "@/app/assignments/ui";
import SurveyForm, { type BuilderQuestion, type SurveyFormDefinition } from "@/app/surveys/survey-form";

export const dynamic = "force-dynamic";

function actorFrom(user: { id: string; role: string; schoolId: string | null }): SurveyActor | null {
  if (user.role === "DEVELOPMENT_OFFICE_MANAGER" || user.role === "EDUCATIONAL_SUPERVISOR") {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

export default async function EditSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="تعديل الاستبيانات متاح لمديري مكاتب التطوير والمشرفين التربويين فقط." />;
  }

  const { id } = await params;
  const [viewResult, options] = await Promise.all([
    getSurveyManageView(ctx, id),
    listSurveyFormOptions(ctx),
  ]);
  if (!viewResult.ok) {
    if (viewResult.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={viewResult.message} />;
  }
  if (!options.ok) return <AccessDenied hint={options.message} />;

  const { survey, questions, permissions } = viewResult.data;
  if (!permissions.canEdit) {
    return <AccessDenied hint="لا يمكن تعديل الاستبيان — التعديل متاح للمسودات فقط." />;
  }

  const initial: SurveyFormDefinition = {
    titleAr: survey.titleAr,
    titleEn: survey.titleEn,
    descriptionAr: survey.descriptionAr,
    descriptionEn: null,
    purposeAr: survey.purposeAr,
    instructionsAr: survey.instructionsAr,
    stage: survey.stage,
    linkPairCode: survey.linkPairCode,
    programId: survey.programId,
    courseId: survey.courseId,
    lessonId: survey.lessonId,
    assignmentId: survey.assignmentId,
    certificateId: survey.certificateId,
    audienceMode: survey.audienceModeRaw,
    targetBranchIds: survey.targetBranchIds,
    targetTeacherIds: survey.targetTeacherIds,
    anonymous: survey.anonymous,
    allowMultipleResponses: survey.allowMultipleResponses,
    linkResponsesEnabled: survey.linkResponsesEnabled,
    opensAt: survey.opensAtISO,
    closesAt: survey.closesAtISO,
    questions: questions.map<BuilderQuestion>((question) => ({
      clientId: `q-${question.id.slice(-8)}`,
      textAr: question.textAr,
      helpTextAr: question.helpTextAr ?? "",
      type: question.type,
      required: question.required,
      options: question.options.length > 0 ? question.options : ["", ""],
      minScore: question.minScore === null ? "1" : String(question.minScore),
      maxScore: question.maxScore === null ? "5" : String(question.maxScore),
    })),
  };

  return (
    <div>
      <PageHeader
        title="تعديل الاستبيان"
        subtitle="التعديل متاح قبل النشر فقط — حمايةً لسلامة الردود بعد النشر"
        actions={
          <Link href={`/surveys/${id}`} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            رجوع للتفاصيل
          </Link>
        }
      />
      <SurveyForm mode="edit" surveyId={id} initial={initial} options={options.data} />
    </div>
  );
}
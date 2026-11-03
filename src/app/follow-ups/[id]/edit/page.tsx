/**
 * Phase 9 — follow-up edit page (operational roles with edit rights).
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { listFollowUpFormOptions, listFollowUpLinkOptions } from "@/lib/followups/service";
import { getFollowUpManageView } from "@/lib/followups/service";
import { listSurveyLinkOptions } from "@/lib/surveys/service";
import { AccessDenied, PageHeader } from "@/app/assignments/ui";
import FollowUpForm, { type FollowUpFormInitial } from "@/app/follow-ups/follow-up-form";

export const dynamic = "force-dynamic";

function actorFrom(user: { id: string; role: string; schoolId: string | null }): SurveyActor | null {
  if (user.role === "DEVELOPMENT_OFFICE_MANAGER" || user.role === "EDUCATIONAL_SUPERVISOR") {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

export default async function EditFollowUpPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="تعديل سجلات المتابعة متاح لمديري المكاتب والمشرفين التربويين فقط." />;
  }

  const { id } = await params;
  const [viewResult, formOptions, linkOptions, surveyOptions] = await Promise.all([
    getFollowUpManageView(ctx, id),
    listFollowUpFormOptions(ctx),
    listFollowUpLinkOptions(ctx),
    listSurveyLinkOptions(ctx),
  ]);
  if (!viewResult.ok) {
    if (viewResult.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={viewResult.message} />;
  }
  if (!formOptions.ok || !linkOptions.ok || !surveyOptions.ok) {
    return <AccessDenied hint="تعذر تحميل بيانات النموذج." />;
  }

  const view = viewResult.data;
  if (!view.canEdit) {
    return <AccessDenied hint="لا تملك صلاحية تعديل هذا السجل." />;
  }

  const initial: FollowUpFormInitial = {
    teacherId: view.teacherId,
    supervisorId: view.supervisorId,
    titleAr: view.titleAr,
    purposeAr: view.purposeAr ?? "",
    followUpDate: view.followUpDate.toISOString(),
    nextFollowUpAt: view.nextFollowUpAt ? view.nextFollowUpAt.toISOString() : "",
    programId: view.programId ?? "",
    courseId: view.courseId ?? "",
    surveyId: view.surveyId ?? "",
    assignmentId: view.assignmentId ?? "",
    observationAr: view.observationAr ?? "",
    progressAr: view.progressAr ?? "",
    challengesAr: view.challengesAr ?? "",
    supportNeedsAr: view.supportNeedsAr ?? "",
    recommendationsAr: view.recommendationsAr ?? "",
    sharedWithTeacher: view.sharedWithTeacher,
  };

  return (
    <div>
      <PageHeader
        title="تعديل سجل المتابعة"
        subtitle="تحديث بيانات المتابعة — يُسجَّل التعديل في سجل التاريخ"
        actions={
          <Link href={`/follow-ups/${id}`} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            رجوع للتفاصيل
          </Link>
        }
      />
      <FollowUpForm
        mode="edit"
        followUpId={id}
        initial={initial}
        isOfficeManager={ctx.role === "DEVELOPMENT_OFFICE_MANAGER"}
        options={{
          teachers: formOptions.data.teachers,
          supervisors: formOptions.data.supervisors,
          programs: linkOptions.data.programs,
          courses: linkOptions.data.courses,
          surveys: surveyOptions.data,
          assignments: linkOptions.data.assignments,
        }}
      />
    </div>
  );
}
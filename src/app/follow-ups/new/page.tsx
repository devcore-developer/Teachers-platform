/**
 * Phase 9 — "سجل متابعة جديد" (office manager / supervisor).
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { listFollowUpFormOptions, listFollowUpLinkOptions } from "@/lib/followups/service";
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

const EMPTY_INITIAL: FollowUpFormInitial = {
  teacherId: "",
  supervisorId: "",
  titleAr: "",
  purposeAr: "",
  followUpDate: "",
  nextFollowUpAt: "",
  programId: "",
  courseId: "",
  surveyId: "",
  assignmentId: "",
  observationAr: "",
  progressAr: "",
  challengesAr: "",
  supportNeedsAr: "",
  recommendationsAr: "",
  sharedWithTeacher: false,
};

export default async function NewFollowUpPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="إنشاء سجلات المتابعة متاح لمديري المكاتب والمشرفين التربويين فقط." />;
  }

  const [formOptions, linkOptions, surveyOptions] = await Promise.all([
    listFollowUpFormOptions(ctx),
    listFollowUpLinkOptions(ctx),
    listSurveyLinkOptions(ctx),
  ]);
  if (!formOptions.ok) return <AccessDenied hint={formOptions.message} />;
  if (!linkOptions.ok) return <AccessDenied hint={linkOptions.message} />;
  if (!surveyOptions.ok) return <AccessDenied hint={surveyOptions.message} />;

  return (
    <div>
      <PageHeader
        title="سجل متابعة جديد"
        subtitle="توثيق زيارة متابعة التطبيق الصفي بعد نشاط تدريبي — الملاحظات الداخلية سرية"
        actions={
          <Link href="/follow-ups" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            رجوع للقائمة
          </Link>
        }
      />
      <FollowUpForm
        mode="create"
        initial={EMPTY_INITIAL}
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
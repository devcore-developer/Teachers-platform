/**
 * Phase 9 — "إنشاء استبيان جديد" (office manager / supervisor).
 * Loads the school-scoped option lists server-side and hands them to
 * the client question builder.
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { listSurveyFormOptions } from "@/lib/surveys/service";
import { AccessDenied, PageHeader } from "@/app/assignments/ui";
import SurveyForm, { type SurveyFormDefinition } from "@/app/surveys/survey-form";

export const dynamic = "force-dynamic";

function actorFrom(user: { id: string; role: string; schoolId: string | null }): SurveyActor | null {
  if (user.role === "DEVELOPMENT_OFFICE_MANAGER" || user.role === "EDUCATIONAL_SUPERVISOR") {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

const EMPTY_DEFINITION: SurveyFormDefinition = {
  titleAr: "",
  titleEn: null,
  descriptionAr: null,
  descriptionEn: null,
  purposeAr: null,
  instructionsAr: null,
  stage: null,
  linkPairCode: null,
  programId: null,
  courseId: null,
  lessonId: null,
  assignmentId: null,
  certificateId: null,
  audienceMode: "ALL_TEACHERS",
  targetBranchIds: [],
  targetTeacherIds: [],
  anonymous: false,
  allowMultipleResponses: false,
  linkResponsesEnabled: false,
  opensAt: null,
  closesAt: null,
  questions: [],
};

export default async function NewSurveyPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="إنشاء الاستبيانات متاح لمديري مكاتب التطوير والمشرفين التربويين فقط." />;
  }
  const options = await listSurveyFormOptions(ctx);
  if (!options.ok) return <AccessDenied hint={options.message} />;

  return (
    <div>
      <PageHeader
        title="استبيان جديد"
        subtitle="صمّم أسئلة الاستبيان وحدد جمهوره وإعدادات الردود — يُحفظ أولًا كمسودة"
        actions={
          <Link href="/surveys" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            رجوع للقائمة
          </Link>
        }
      />
      <SurveyForm mode="create" initial={EMPTY_DEFINITION} options={options.data} />
    </div>
  );
}
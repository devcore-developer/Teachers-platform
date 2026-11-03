/**
 * Phase 9 — individual response view. Operational roles only, and the
 * survey must be identified — anonymous rows can never be opened (the
 * service rejects before any projection is built).
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { getIndividualResponse } from "@/lib/surveys/service";
import { AccessDenied, Card, PageHeader, formatDate } from "@/app/assignments/ui";
import { questionTypeLabel } from "@/app/surveys/ui";

export const dynamic = "force-dynamic";

function actorFrom(user: { id: string; role: string; schoolId: string | null }): SurveyActor | null {
  if (user.role === "DEVELOPMENT_OFFICE_MANAGER" || user.role === "EDUCATIONAL_SUPERVISOR") {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

export default async function IndividualResponsePage({
  params,
}: {
  params: Promise<{ id: string; responseId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="عرض الردود الفردية متاح لمديري المكاتب ومؤلفي الاستبيانات فقط." />;
  }

  const { id, responseId } = await params;
  const result = await getIndividualResponse(ctx, id, responseId);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={result.message} />;
  }
  const { surveyTitle, respondentName, branchName, submittedAt, answers } = result.data;

  return (
    <div>
      <PageHeader
        title={`رد: ${respondentName}`}
        subtitle={`${surveyTitle} — ${branchName ?? "بلا فرع"} — ${formatDate(submittedAt)}`}
        actions={
          <Link
            href={`/surveys/${id}/results`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            رجوع للنتائج
          </Link>
        }
      />

      <Card>
        <ol className="space-y-4">
          {answers.map((answer, index) => (
            <li key={index} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
              <p className="text-sm font-medium text-slate-800">
                {index + 1}. {answer.textAr}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">{questionTypeLabel(answer.type)}</p>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{answer.display}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
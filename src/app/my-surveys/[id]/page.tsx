/**
 * Phase 9 — take-survey page: eligibility + open-window are re-checked
 * server-side before the taker is rendered; draft state is restored
 * from the teacher's own persisted row.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getSurveyForTaking } from "@/lib/surveys/service";
import { AccessDenied, PageHeader } from "@/app/assignments/ui";
import SurveyTaker from "@/app/my-surveys/[id]/survey-taker";

export const dynamic = "force-dynamic";

export default async function TakeSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  if (user.role !== "TEACHER") {
    return <AccessDenied hint="الاستجابة للاستبيانات متاحة للمعلمين فقط." />;
  }

  const { id } = await params;
  const result = await getSurveyForTaking(
    { id: user.id, role: user.role, schoolId: user.schoolId },
    id
  );
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return (
      <AccessDenied
        hint={result.message}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="استجابة الاستبيان"
        subtitle=""
        actions={
          <Link
            href="/my-surveys"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            رجوع للقائمة
          </Link>
        }
      />
      <SurveyTaker data={result.data} />
    </div>
  );
}
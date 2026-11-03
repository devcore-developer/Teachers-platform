/**
 * Phase 9 — follow-up record detail: full notes for operational roles,
 * lifecycle actions, sharing toggle and the append-only history.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import type { SurveyActor } from "@/lib/surveys/access";
import { getFollowUpManageView } from "@/lib/followups/service";
import { FOLLOW_UP_EVENT_LABELS, type FollowUpEventType } from "@/config/surveys";
import { AccessDenied, Card, PageHeader, formatDate } from "@/app/assignments/ui";
import { FollowUpStatusBadge, SharedBadge } from "@/app/follow-ups/ui";
import FollowUpActions from "@/app/follow-ups/[id]/follow-up-actions";

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

export default async function FollowUpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="سجلات المتابعة متاحة للأدوار الإدارية المدرسية فقط." />;
  }

  const { id } = await params;
  const result = await getFollowUpManageView(ctx, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={result.message} />;
  }
  const view = result.data;
  const isDeputy = ctx.role === "EDUCATIONAL_DEPUTY";

  return (
    <div>
      <PageHeader
        title={view.titleAr}
        subtitle={`متابعة المعلم ${view.teacherName} — المسؤول: ${view.supervisorName}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {view.canEdit ? (
              <Link
                href={`/follow-ups/${id}/edit`}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                تعديل
              </Link>
            ) : null}
            <Link
              href="/follow-ups"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              رجوع للقائمة
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FollowUpStatusBadge status={view.status} />
        <SharedBadge shared={view.sharedWithTeacher} />
        {isDeputy ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">عرض للقراءة فقط</span>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-sm font-bold text-slate-800">بيانات السجل</h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">تاريخ المتابعة</dt>
                <dd className="mt-1 text-slate-700">{formatDate(view.followUpDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">المتابعة القادمة</dt>
                <dd className="mt-1 text-slate-700">{formatDate(view.nextFollowUpAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">تاريخ الإكمال</dt>
                <dd className="mt-1 text-slate-700">{formatDate(view.completedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">الغرض</dt>
                <dd className="mt-1 whitespace-pre-line text-slate-700">{view.purposeAr ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">المحتوى المرتبط</dt>
                <dd className="mt-1 text-slate-700">
                  {view.programTitle ?? view.courseTitle ?? view.assignmentTitle ?? "—"}
                  {view.surveyTitle ? (
                    <Link href={`/surveys/${view.surveyId}/results`} className="mr-2 text-xs font-medium text-[#1D5BD6] hover:underline">
                      استبيان: {view.surveyTitle}
                    </Link>
                  ) : null}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h2 className="mb-1 text-sm font-bold text-slate-800">ملاحظات المشرف (سرية)</h2>
            <p className="mb-4 text-[11px] text-slate-400">هذه الملاحظات لا تظهر للمعلم في أي حال.</p>
            <dl className="space-y-4 text-sm">
              {[
                { label: "ملاحظات التطبيق الصفي", value: view.observationAr },
                { label: "التقدم المُلاحظ", value: view.progressAr },
                { label: "التحديات", value: view.challengesAr },
                { label: "احتياجات الدعم", value: view.supportNeedsAr },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-xs font-medium text-slate-500">{item.label}</dt>
                  <dd className="mt-1 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-slate-700">
                    {item.value ?? "—"}
                  </dd>
                </div>
              ))}
              <div>
                <dt className="text-xs font-medium text-emerald-700">التوصيات (تُشارك عند التفعيل)</dt>
                <dd className="mt-1 whitespace-pre-line rounded-lg bg-emerald-50/50 p-3 text-slate-700">
                  {view.recommendationsAr ?? "—"}
                </dd>
              </div>
            </dl>
          </Card>
        </div>

        <div className="space-y-6">
          {!isDeputy && view.canEdit ? (
            <Card>
              <h2 className="mb-3 text-sm font-bold text-slate-800">إجراءات السجل</h2>
              <FollowUpActions followUpId={id} status={view.status} sharedWithTeacher={view.sharedWithTeacher} />
            </Card>
          ) : null}

          <Card>
            <h2 className="mb-3 text-sm font-bold text-slate-800">سجل التاريخ</h2>
            {view.events.length === 0 ? (
              <p className="text-xs text-slate-500">لا توجد أحداث.</p>
            ) : (
              <ol className="space-y-3">
                {view.events.map((event) => (
                  <li key={event.id} className="border-r-2 border-[#1D5BD6]/30 pr-3">
                    <p className="text-xs font-semibold text-slate-700">
                      {FOLLOW_UP_EVENT_LABELS[event.type as FollowUpEventType] ?? event.type}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {event.actorName ?? "النظام"} — {formatDate(event.createdAt)}
                    </p>
                    {event.note ? <p className="mt-1 text-[11px] text-slate-500">{event.note}</p> : null}
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
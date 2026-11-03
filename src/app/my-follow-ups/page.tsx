/**
 * Phase 9 — "سجلات المتابعة" teacher view: ONLY the explicitly shared
 * subset of records targeted at the signed-in teacher. Internal
 * supervisor notes are structurally excluded by the service query.
 */
import { getCurrentUser } from "@/lib/auth/session";
import { listSharedFollowUpsForTeacher } from "@/lib/followups/service";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
  formatDate,
} from "@/app/assignments/ui";
import { FollowUpStatusBadge } from "@/app/follow-ups/ui";

export const dynamic = "force-dynamic";

export default async function MyFollowUpsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  if (user.role !== "TEACHER") {
    return <AccessDenied hint="سجلات المتابعة المشتركة متاحة للمعلمين فقط." />;
  }

  const result = await listSharedFollowUpsForTeacher({
    id: user.id,
    role: user.role,
    schoolId: user.schoolId,
  });
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const rows = result.data;

  return (
    <div>
      <PageHeader
        title="سجلات المتابعة"
        subtitle="سجلات متابعة التطبيق الصفي التي شاركها معك مشرفك التربوي — فقط السجلات المشاركة صراحةً تظهر هنا"
      />

      {rows.length === 0 ? (
        <EmptyState
          title="لا توجد سجلات مشتركة معك حاليًا"
          hint="عند مشاركة مشرفك لسجل متابعة يخصك ستظهر هنا التواريخ والتوصيات الخاصة بك."
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.id}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-800">{row.titleAr}</h3>
                <FollowUpStatusBadge status={row.status} />
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">تاريخ المتابعة</dt>
                  <dd className="mt-0.5 text-slate-700">{formatDate(row.followUpDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">المتابعة القادمة</dt>
                  <dd className="mt-0.5 text-slate-700">{formatDate(row.nextFollowUpAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">المشرف المسؤول</dt>
                  <dd className="mt-0.5 text-slate-700">{row.supervisorName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">النشاط التدريبي</dt>
                  <dd className="mt-0.5 text-slate-700">{row.programTitle ?? row.courseTitle ?? "—"}</dd>
                </div>
                {row.purposeAr ? (
                  <div className="md:col-span-2">
                    <dt className="text-xs text-slate-500">الغرض</dt>
                    <dd className="mt-0.5 whitespace-pre-line text-slate-700">{row.purposeAr}</dd>
                  </div>
                ) : null}
                {row.recommendationsAr ? (
                  <div className="md:col-span-2">
                    <dt className="text-xs font-medium text-emerald-700">توصيات المشرف</dt>
                    <dd className="mt-0.5 whitespace-pre-line rounded-lg bg-emerald-50/60 p-3 text-slate-700">
                      {row.recommendationsAr}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
/**
 * Phase 9 — "الاستبيانات" teacher workspace: surveys targeted at the
 * signed-in teacher (eligibility re-checked server-side per survey),
 * with submission state. Anonymous surveys never show a personal
 * submission record — the row explains that honestly.
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { getMyResponseHistory, listSurveysForTeacher } from "@/lib/surveys/service";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  formatDate,
} from "@/app/assignments/ui";
import { SurveyStageBadge } from "@/app/surveys/ui";

export const dynamic = "force-dynamic";

export default async function MySurveysPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  if (user.role !== "TEACHER") {
    return <AccessDenied hint="قائمة الاستبيانات متاحة للمعلمين فقط." />;
  }

  const [listResult, historyResult] = await Promise.all([
    listSurveysForTeacher({ id: user.id, role: user.role, schoolId: user.schoolId }),
    getMyResponseHistory({ id: user.id, role: user.role, schoolId: user.schoolId }),
  ]);
  if (!listResult.ok) return <AccessDenied hint={listResult.message} />;

  const rows = listResult.data;
  const history = historyResult.ok ? historyResult.data : [];
  const openCount = rows.filter((row) => row.isOpenNow).length;
  const submittedCount = history.length;

  return (
    <div>
      <PageHeader
        title="الاستبيانات"
        subtitle="الاستبيانات الموجهة إليك من إدارة التطوير المهني والإشراف التربوي"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="استبيانات متاحة" value={rows.length} tone="brand" />
        <StatTile label="مفتوحة للاستجابة" value={openCount} tone="success" />
        <StatTile label="ردودي المرسلة (معرّفة الهوية)" value={submittedCount} />
        <StatTile
          label="استبيانات مجهولة الهوية"
          value={rows.filter((row) => row.anonymous).length}
          tone="warning"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="لا توجد استبيانات موجهة إليك حاليًا"
          hint="ستظهر هنا استبيانات قياس الأثر ومتابعة التطبيق عند نشرها وتوجيهها إليك."
        />
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-800">{row.titleAr}</h3>
                    <SurveyStageBadge stage={row.stage} />
                    {row.anonymous ? (
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        مجهول الهوية
                      </span>
                    ) : null}
                    {!row.isOpenNow ? (
                      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        مغلق مؤقتًا
                      </span>
                    ) : null}
                  </div>
                  {row.descriptionAr ? (
                    <p className="mb-1 line-clamp-2 text-xs text-slate-500">{row.descriptionAr}</p>
                  ) : null}
                  <p className="text-xs text-slate-400">
                    {row.closesAt ? `يُغلق: ${formatDate(row.closesAt)}` : "مفتوح حتى الإغلاق اليدوي"}
                    {row.anonymous ? " — لا يُسجَّل حالة رد شخصية حفاظًا على الخصوصية" : ""}
                  </p>
                  {row.myResponseStatus === "SUBMITTED" ? (
                    <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      تم إرسال ردك — {formatDate(row.myResponseSubmittedAt)}
                    </p>
                  ) : null}
                </div>
                <Link
                  href={`/my-surveys/${row.id}`}
                  className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-semibold text-white hover:bg-[#174aa8]"
                >
                  {row.myResponseStatus === "SUBMITTED" ? "عرض الرد" : row.anonymous ? "استجابة" : "بدء الاستجابة"}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
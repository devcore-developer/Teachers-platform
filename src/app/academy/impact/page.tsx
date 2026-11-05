import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { listImpactOverview } from "@/lib/surveys/impact";
import { AccessDenied, Card, EmptyState, PageHeader, StatTile } from "@/app/assignments/ui";

/**
 * Batch 1 — لوحة قياس الأثر (impact measurement overview).
 *
 * The Next.js equivalent of the original HTML renderImpactDashboard:
 * one card per course with impact tools — response count, average
 * rating and completion count — for training managers, plus a link to
 * the per-question breakdown on each course learning page.
 */
export const dynamic = "force-dynamic";

export default async function ImpactOverviewPage() {
  const user = await requireUser();
  const viewer = { id: user.id, role: user.role, schoolId: user.schoolId };

  const result = await listImpactOverview(viewer);
  if (!result.ok) {
    return <AccessDenied hint={result.message} />;
  }
  const rows = result.data;

  const totalResponses = rows.reduce((sum, row) => sum + row.responsesCount, 0);
  const averages = rows
    .map((row) => row.overallAverage)
    .filter((value): value is number => value !== null);
  const globalAverage = averages.length
    ? Number((averages.reduce((a, b) => a + b, 0) / averages.length).toFixed(2))
    : null;

  return (
    <div>
      <PageHeader
        title="قياس الأثر"
        subtitle="نتائج أدوات قياس أثر التدريب على مستوى المدارس — الاستجابات والتقييمات والإكمالات"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="دورات بأدوات قياس" value={rows.length} tone="brand" />
        <StatTile label="إجمالي الاستجابات" value={totalResponses} tone="success" />
        <StatTile
          label="متوسط التقييم العام"
          value={globalAverage !== null ? `${globalAverage}/5` : "—"}
          tone="warning"
        />
        <StatTile
          label="إكمالات مسجلة"
          value={rows.reduce((sum, row) => sum + row.completionsCount, 0)}
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="لا توجد أدوات قياس أثر بعد"
            hint="تُنشأ أدوات القياس من الاستبيانات المرتبطة بالدورات — اربط استبيان أثر بدورة منشورة لتظهر نتائجه هنا."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((row) => (
            <Card key={row.courseId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {row.courseTitleAr}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.completionsCount} إكمالًا مسجلًا
                  </p>
                </div>
                <Link
                  href={`/academy/learn/${row.courseId}`}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  عرض التفاصيل
                </Link>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-lg font-extrabold text-[#1D5BD6]">
                    {row.responsesCount}
                  </p>
                  <p className="text-[11px] text-slate-500">استجابات</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-lg font-extrabold text-[#1D5BD6]">
                    {row.overallAverage !== null ? `${row.overallAverage}/5` : "—"}
                  </p>
                  <p className="text-[11px] text-slate-500">متوسط التقييم</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-lg font-extrabold text-[#1D5BD6]">
                    {row.completionsCount}
                  </p>
                  <p className="text-[11px] text-slate-500">إكمالات</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
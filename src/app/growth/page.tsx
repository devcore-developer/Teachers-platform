import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, UserRound } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { EmptyState } from "@/components/platform/empty-state";
import { requireUser } from "@/lib/auth/session";
import {
  getPlatformGrowthStats,
  listGrowthRoster,
} from "@/lib/growth/service";
import {
  EligibilityBadge,
  GrowthProgressBar,
  TeacherGrowthLink,
} from "@/app/growth/ui";

export const metadata = {
  title: "النمو المهني — لوحة الإدارة | منارة قرطبة",
};

/**
 * Batch 2 (part 2/2) — the administrative growth board (/growth):
 * platform/school aggregates (T0..T5 distribution, the 60% gate, the
 * 35-hour annual target) + the full teachers roster, all computed from
 * REAL database rows.
 *
 * Routing by role (fail-closed):
 *   - TEACHER               -> /my-growth (their own projection)
 *   - EDUCATIONAL_SUPERVISOR -> /supervision/growth (their v48 board)
 *   - DEVELOPMENT_OFFICE_MANAGER -> own school only
 *   - SUPER_ADMIN           -> whole platform
 */
export default async function GrowthPage() {
  const user = await requireUser();

  if (user.role === "TEACHER") redirect("/my-growth");
  if (user.role === "EDUCATIONAL_SUPERVISOR") redirect("/supervision/growth");
  if (user.role !== "SUPER_ADMIN" && user.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    redirect("/forbidden");
  }

  const schoolId = user.role === "DEVELOPMENT_OFFICE_MANAGER" ? user.schoolId : null;
  const [stats, roster] = await Promise.all([
    getPlatformGrowthStats(schoolId),
    listGrowthRoster({ schoolId }),
  ]);

  return (
    <div>
      <PageHeader
        title="النمو المهني"
        description={`سلّم T0–T5 وشرط الانتقال 60% وهدف ${stats.targetHours} ساعة سنويًا — من بيانات المنصة الحقيقية للعام ${stats.academicYear}.`}
        breadcrumbs={[{ label: "الرئيسية" }, { label: "النمو المهني" }]}
      />

      {/* --------------------------- totals --------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-2xl font-black tabular-nums">{stats.totals.teachers}</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">إجمالي المعلمين</p>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-2xl font-black tabular-nums">{stats.totals.eligible}</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            مستحقون للانتقال (شرط 60%)
          </p>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-2xl font-black tabular-nums">{stats.totals.certificates}</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">الشهادات الصادرة</p>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-2xl font-black tabular-nums">
            {stats.totals.hoursThisYear}
            <span className="text-sm font-bold text-muted-foreground">
              {" "}
              / {stats.targetHours} لكل معلم
            </span>
          </p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            ساعات التدريب لهذا العام
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ------------------------ by level ------------------------- */}
        <SectionCard
          title="توزيع المعلمين على سلّم النمو"
          description={`متوسط نسب إكمال الدورات: ${stats.totals.avgCompletion}%`}
        >
          <ul className="space-y-3">
            {stats.byLevel.map((level) => {
              const percent =
                stats.totals.teachers === 0
                  ? 0
                  : Math.round((level.count / stats.totals.teachers) * 100);
              return (
                <li key={level.id}>
                  <div className="mb-1 flex items-center justify-between text-xs font-bold">
                    <span>
                      {level.id} — {level.nameAr}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {level.count} معلم ({percent}%)
                    </span>
                  </div>
                  <GrowthProgressBar percent={percent} threshold={-1} />
                </li>
              );
            })}
          </ul>
        </SectionCard>

        {/* -------------------------- schools ------------------------ */}
        <SectionCard
          title="المدارس"
          description="مؤشرات النمو والساعات لكل مدرسة داخل نطاق صلاحيتك."
        >
          {stats.schools.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="لا توجد بيانات"
              description="لم يُسجَّل أي معلمين ضمن النطاق بعد."
            />
          ) : (
            <ul className="space-y-3">
              {stats.schools.map((school) => (
                <li key={school.schoolId ?? "platform"} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-black">{school.schoolName}</p>
                    <span className="text-xs font-bold text-muted-foreground">
                      {school.teachers} معلم
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <span className="rounded-lg bg-muted px-2 py-1.5 text-center font-bold">
                      مستحقون: {school.eligible}
                    </span>
                    <span className="rounded-lg bg-muted px-2 py-1.5 text-center font-bold">
                      شهادات: {school.certificates}
                    </span>
                    <span className="rounded-lg bg-muted px-2 py-1.5 text-center font-bold">
                      ساعات العام: {school.hoursThisYear}
                    </span>
                    <span className="rounded-lg bg-muted px-2 py-1.5 text-center font-bold">
                      متوسط الإنجاز: {school.avgCompletion}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* --------------------------- roster --------------------------- */}
      <div className="mt-6">
        <SectionCard
          title="سجل المعلمين — مسار النمو"
          description="كل معلم: تصنيفه الحالي والمقترح، الدورات، شرط 60%، الساعات، والشهادات."
        >
          {roster.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title="لا يوجد معلمون"
              description="لم يُسجَّل أي معلمين في نطاقك بعد."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-start text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-start font-bold">المعلم</th>
                    <th className="px-3 py-2 text-start font-bold">التصنيف الحالي</th>
                    <th className="px-3 py-2 text-start font-bold">التصنيف المقترح</th>
                    <th className="px-3 py-2 text-start font-bold">الدورات (مكتمل/مسند)</th>
                    <th className="px-3 py-2 text-start font-bold">شرط 60%</th>
                    <th className="px-3 py-2 text-start font-bold">الساعات</th>
                    <th className="px-3 py-2 text-start font-bold">الشهادات</th>
                    <th className="px-3 py-2 text-start font-bold">الملف</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((row) => (
                    <tr key={row.teacherId} className="border-b last:border-0">
                      <td className="px-3 py-2.5">
                        <p className="font-bold">{row.teacherName}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.schoolName ?? "—"}
                          {row.stage ? ` · ${row.stage}` : ""}
                          {row.subject ? ` · ${row.subject}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-bold">{row.levelLabel}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {row.suggestedLevel}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-bold tabular-nums">
                        {row.coursesCompleted} / {row.coursesEnrolled}
                      </td>
                      <td className="w-40 px-3 py-2.5">
                        <GrowthProgressBar percent={row.completionPercentage} />
                        <div className="mt-1.5">
                          <EligibilityBadge eligible={row.eligible} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-bold tabular-nums">
                        {row.hoursCompleted} / {row.hoursTarget}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-bold tabular-nums">
                        {row.certificatesActive}
                      </td>
                      <td className="px-3 py-2.5">
                        <TeacherGrowthLink teacherId={row.teacherId} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        مشرف تربوي؟ لوحة تصنيف معلميك واعتماد انتقالاتهم على{" "}
        <Link href="/supervision/growth" className="font-bold text-brand-700 hover:underline">
          متابعة المعلمين — النمو المهني
        </Link>
        .
      </p>
    </div>
  );
}
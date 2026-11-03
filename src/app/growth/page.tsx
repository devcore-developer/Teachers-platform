/**
 * Phase 8 — professional growth hub (back-office). Role-adaptive:
 *   DEVELOPMENT_OFFICE_MANAGER → roster of the school's teachers.
 *   EDUCATIONAL_SUPERVISOR     → roster of ASSIGNED teachers only.
 *   EDUCATIONAL_DEPUTY         → read-only roster within grants.
 *   SUPER_ADMIN                → platform-wide aggregate statistics
 *                                (no per-teacher drill-down, no ops).
 *   TEACHER                    → redirected to /my-growth.
 * All scoping is enforced server-side in the growth service.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import type { CertificateActor } from "@/lib/certificates/access";
import {
  getPlatformGrowthStats,
  listGrowthRoster,
} from "@/lib/growth/service";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
} from "@/app/assignments/ui";
import { GrowthStatTile } from "@/app/growth/ui";

export const dynamic = "force-dynamic";

function actorFrom(user: {
  id: string;
  role: string;
  schoolId: string | null;
}): CertificateActor | null {
  if (
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    user.role === "EDUCATIONAL_SUPERVISOR" ||
    user.role === "EDUCATIONAL_DEPUTY" ||
    user.role === "SUPER_ADMIN"
  ) {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

export default async function GrowthHubPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  if (user.role === "TEACHER") {
    redirect("/my-growth");
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return <AccessDenied hint="صفحة النمو المهني متاحة للأدوار الإدارية والمعلمين (لأنفسهم) فقط." />;
  }

  // ---- SUPER_ADMIN: platform-wide aggregate --------------------------
  if (ctx.role === "SUPER_ADMIN") {
    const statsResult = await getPlatformGrowthStats(ctx);
    if (!statsResult.ok) return <AccessDenied hint={statsResult.message} />;
    const stats = statsResult.data;
    return (
      <div>
        <PageHeader
          title="النمو المهني على مستوى المنصة"
          subtitle="إحصاءات تجميعية للقراءة فقط — صلاحيات التعديل المدرسي تبقى حصرية لمديري مكاتب التطوير"
        />
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <GrowthStatTile label="عدد المدارس" value={stats.totals.schools} />
          <GrowthStatTile label="المعلمون النشطون" value={stats.totals.teachers} />
          <GrowthStatTile label="الشهادات الصادرة" value={stats.totals.certificatesIssued} tone="brand" />
          <GrowthStatTile label="الشهادات السارية" value={stats.totals.certificatesActive} tone="success" />
          <GrowthStatTile label="تقييمات مجتازة" value={stats.totals.assessmentsPassed} />
          <GrowthStatTile label="تكليفات مُقيَّمة" value={stats.totals.assignmentsGraded} />
        </div>
        <Card title="التفصيل حسب المدرسة">
          {stats.schools.length === 0 ? (
            <EmptyState title="لا توجد مدارس مسجلة بعد" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">المدرسة</th>
                    <th className="px-3 py-2 font-medium">المعلمون</th>
                    <th className="px-3 py-2 font-medium">الشهادات</th>
                    <th className="px-3 py-2 font-medium">السارية</th>
                    <th className="px-3 py-2 font-medium">تقييمات مجتازة</th>
                    <th className="px-3 py-2 font-medium">تكليفات مُقيَّمة</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.schools.map((school) => (
                    <tr key={school.schoolId} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-3 font-medium text-slate-800">{school.schoolName}</td>
                      <td className="px-3 py-3 text-slate-600">{school.teachers}</td>
                      <td className="px-3 py-3 text-slate-600">{school.certificatesIssued}</td>
                      <td className="px-3 py-3 text-slate-600">{school.certificatesActive}</td>
                      <td className="px-3 py-3 text-slate-600">{school.assessmentsPassed}</td>
                      <td className="px-3 py-3 text-slate-600">{school.assignmentsGraded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // ---- MANAGER / SUPERVISOR / DEPUTY: scoped roster -------------------
  const rosterResult = await listGrowthRoster(ctx);
  if (!rosterResult.ok) return <AccessDenied hint={rosterResult.message} />;
  const { rows, scopeLabel } = rosterResult.data;
  const totalEnrolled = rows.reduce((sum, row) => sum + row.coursesEnrolled, 0);
  const totalCompleted = rows.reduce((sum, row) => sum + row.coursesCompleted, 0);
  const totalCertificates = rows.reduce((sum, row) => sum + row.certificatesActive, 0);
  const withProgress = rows.filter((row) => row.avgBestPercentage !== null);
  const avgScore =
    withProgress.length > 0
      ? Math.round(
          withProgress.reduce((sum, row) => sum + (row.avgBestPercentage ?? 0), 0) /
            withProgress.length
        )
      : null;

  return (
    <div>
      <PageHeader
        title="النمو المهني للمعلمين"
        subtitle={`ملخص النمو من سجلات التدريب الفعلية — ${scopeLabel}`}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <GrowthStatTile label="عدد المعلمين" value={rows.length} tone="brand" />
        <GrowthStatTile
          label="الالتحاقات بالدورات"
          value={totalEnrolled}
          hint={`دورات مكتملة: ${totalCompleted}`}
        />
        <GrowthStatTile label="شهادات سارية" value={totalCertificates} tone="success" />
        <GrowthStatTile
          label="متوسط أفضل النتائج"
          value={avgScore !== null ? `${avgScore}%` : "—"}
          hint="عند توفر نتائج تقييمات"
        />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="لا يوجد معلمون في نطاقك"
            hint={
              ctx.role === "EDUCATIONAL_SUPERVISOR"
                ? "ستظهر هنا بيانات المعلمين المسندهم إليك إشرافهم."
                : "ستظهر هنا بيانات معلمي النطاق المصرح به لك."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">المعلم</th>
                  <th className="px-3 py-2 font-medium">الفرع</th>
                  <th className="px-3 py-2 font-medium">دورات مسجلة</th>
                  <th className="px-3 py-2 font-medium">دورات مكتملة</th>
                  <th className="px-3 py-2 font-medium">شهادات سارية</th>
                  <th className="px-3 py-2 font-medium">متوسط أفضل النتائج</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.teacherId} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3 font-medium text-slate-800">{row.teacherName}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{row.branchName ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-600">{row.coursesEnrolled}</td>
                    <td className="px-3 py-3">
                      {row.coursesCompleted > 0 ? (
                        <span className="font-semibold text-emerald-600">{row.coursesCompleted}</span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{row.certificatesActive}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {row.avgBestPercentage !== null ? `${row.avgBestPercentage}%` : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/growth/${row.teacherId}`}
                        className="text-xs font-medium text-[#1D5BD6] hover:underline"
                      >
                        عرض النمو
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
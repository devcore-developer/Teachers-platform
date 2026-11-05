import Link from "next/link";
import { Download, FileSpreadsheet, UserRound } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { EmptyState } from "@/components/platform/empty-state";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { growthLevelLabel } from "@/config/growth";
import { adminGrowthBoard } from "@/lib/growth/service";
import { db } from "@/lib/db";

export const metadata = {
  title: "إدارة المعلمين | منارة قرطبة",
};

/**
 * Batch 2 — the administrative teachers hub (the original "إدارة
 * المعلمين" module, now real): the professional roster with growth
 * levels, hours and certificates, the administrative profile editing
 * entry point, the Excel/CSV assignment import and the accounts export.
 */
export default async function TeachersPage() {
  const actor = await requireAdminContext();
  const board = await adminGrowthBoard({
    id: actor.id,
    role: actor.role,
    schoolId: actor.schoolId,
  });
  if (!board.ok) {
    return (
      <div>
        <PageHeader title="إدارة المعلمين" description={board.message} />
        <EmptyState icon={UserRound} title="غير متاح" description={board.message} />
      </div>
    );
  }

  const teacherIds = board.data.map((row) => row.teacher.id);
  const assignments = await db.teacherSupervisorAssignment.findMany({
    where: { teacherId: { in: teacherIds } },
    select: {
      teacherId: true,
      supervisor: { select: { name: true } },
      deputy: { select: { name: true } },
    },
  });
  const assignmentByTeacher = new Map(assignments.map((row) => [row.teacherId, row]));

  const eligibleCount = board.data.filter((row) => row.eligible).length;
  const activeCount = board.data.filter((row) => row.teacher.isActive).length;

  return (
    <div>
      <PageHeader
        title="إدارة المعلمين"
        description="السجل المهني المركزي: التصنيف T0–T5، الساعات، الشهادات، الإسناد — مع التعديل الإداري والاستيراد من Excel."
        breadcrumbs={[{ label: "الرئيسية" }, { label: "إدارة المعلمين" }]}
        meta={
          <>
            <StatusBadge tone="info" withDot={false}>
              {board.data.length} معلمًا
            </StatusBadge>
            <StatusBadge tone="success" withDot={false}>
              {activeCount} نشط
            </StatusBadge>
            {eligibleCount > 0 && (
              <StatusBadge tone="warning" withDot={false}>
                {eligibleCount} مستحق للانتقال
              </StatusBadge>
            )}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <Link
          href="/teachers/import"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700"
        >
          <FileSpreadsheet className="size-4" aria-hidden="true" />
          استيراد الإسنادات من Excel/CSV
        </Link>
        <a
          href="/api/reports/export?type=teachers"
          className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors hover:bg-accent"
        >
          <Download className="size-4" aria-hidden="true" />
          تصدير المعلمين CSV
        </a>
        <a
          href="/api/reports/export?type=accounts"
          className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors hover:bg-accent"
        >
          <Download className="size-4" aria-hidden="true" />
          تصدير الحسابات CSV
        </a>
      </div>

      <SectionCard
        title="السجل المهني للمعلمين"
        description="اضغط «الملف الإداري» لتعديل البيانات المهنية والإسناد وإعادة تعيين كلمة المرور."
      >
        {board.data.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="لا يوجد معلمون في نطاقك بعد"
            description="استورد ملف الإسنادات أو أنشئ حسابات من إدارة المستخدمين."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-start font-semibold">المعلم</th>
                  <th className="py-2 text-start font-semibold">المجمع</th>
                  <th className="py-2 text-start font-semibold">المرحلة / التخصص</th>
                  <th className="py-2 text-start font-semibold">المشرف</th>
                  <th className="py-2 text-start font-semibold">المستوى</th>
                  <th className="py-2 text-start font-semibold">الساعات</th>
                  <th className="py-2 text-start font-semibold">الشهادات</th>
                  <th className="py-2 text-start font-semibold">الإنجاز</th>
                  <th className="py-2 text-start font-semibold">الحالة</th>
                  <th className="py-2 text-start font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {board.data.map((row) => {
                  const assignment = assignmentByTeacher.get(row.teacher.id);
                  return (
                    <tr key={row.teacher.id} className="border-b last:border-b-0">
                      <td className="py-2.5">
                        <span className="block font-semibold">{row.teacher.name}</span>
                        <span className="block text-xs text-muted-foreground" dir="ltr">
                          {row.teacher.email}
                        </span>
                      </td>
                      <td className="py-2.5">{row.teacher.schoolName ?? "—"}</td>
                      <td className="py-2.5">
                        {[row.teacher.stage, row.teacher.subject].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="py-2.5">{assignment?.supervisor.name ?? "غير مسند"}</td>
                      <td className="py-2.5 font-semibold">
                        {growthLevelLabel(row.currentLevel)}
                      </td>
                      <td className="py-2.5 tabular-nums">{row.stats.hours}</td>
                      <td className="py-2.5 tabular-nums">{row.stats.certificates}</td>
                      <td className="py-2.5 tabular-nums">
                        {row.stats.percent}%
                        {row.eligible && (
                          <span className="ms-1 text-[10px] font-bold text-brand-600">
                            مستحق
                          </span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <StatusBadge
                          tone={row.teacher.isActive ? "success" : "warning"}
                          withDot={false}
                        >
                          {row.teacher.isActive ? "نشط" : "موقوف"}
                        </StatusBadge>
                      </td>
                      <td className="py-2.5">
                        <Link
                          href={`/teachers/${row.teacher.id}`}
                          className="text-xs font-bold text-brand-600 hover:text-brand-700"
                        >
                          الملف الإداري
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
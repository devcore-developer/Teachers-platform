import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { requireUser } from "@/lib/auth/session";
import {
  canManageTeacherGrowth,
  getTeacherGrowth,
} from "@/lib/growth/service";
import { GrowthProjection } from "@/app/growth/growth-projection";
import {
  GrowthHistoryTimeline,
  GrowthLadder,
} from "@/app/growth/ui";

export const metadata = {
  title: "ملف النمو المهني | منارة قرطبة",
};

/**
 * Batch 2 (part 2/2) — one teacher's growth file (/growth/[teacherId]):
 * the T0–T5 ladder position, the 60% gate, the 35-hour annual target,
 * every real learning artifact and the append-only journey history.
 *
 * Access (fail-closed):
 *   - the teacher themselves -> /my-growth
 *   - their supervisor / school office / super admin -> full projection
 *   - everyone else -> /forbidden
 * Classification & promotion CONTROLS live on /supervision/growth —
 * this page is the read-only projection shared by all authorized roles.
 */
export default async function TeacherGrowthPage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const { teacherId } = await params;
  const user = await requireUser();

  if (user.role === "TEACHER") {
    // Teachers read their own journey on /my-growth — nothing else.
    if (user.id === teacherId) redirect("/my-growth");
    redirect("/forbidden");
  }

  const allowed = await canManageTeacherGrowth(
    { id: user.id, role: user.role, schoolId: user.schoolId },
    teacherId
  );
  if (!allowed) redirect("/forbidden");

  const data = await getTeacherGrowth(teacherId);
  if (!data) notFound();

  return (
    <div>
      <PageHeader
        title={`النمو المهني — ${data.teacher.name}`}
        description={[
          data.teacher.schoolName ?? "غير محدد",
          data.teacher.stage ?? null,
          data.teacher.subject ?? null,
        ]
          .filter(Boolean)
          .join(" · ")}
        breadcrumbs={[
          { label: "الرئيسية" },
          { label: "النمو المهني" },
          { label: data.teacher.name },
        ]}
        meta={
          user.role === "EDUCATIONAL_SUPERVISOR" ? (
            <Link
              href="/supervision/growth"
              className="rounded-xl border bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700"
            >
              تصنيف واعتماد الانتقال
            </Link>
          ) : null
        }
      />

      <div className="space-y-6">
        <GrowthLadder currentLevel={data.currentLevel} />

        <GrowthProjection data={data} />

        <SectionCard
          title="رحلة النمو — السجل الكامل"
          description="كل تصنيف وكل انتقال معتمد يُسجَّل هنا ولا يُحذف (سجل إضافي فقط)."
        >
          <GrowthHistoryTimeline events={data.history} />
        </SectionCard>
      </div>
    </div>
  );
}
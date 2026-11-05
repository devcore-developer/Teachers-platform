import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { requireUser } from "@/lib/auth/session";
import { getTeacherGrowth } from "@/lib/growth/service";
import { GrowthProjection } from "@/app/growth/growth-projection";
import {
  GrowthHistoryTimeline,
  GrowthLadder,
} from "@/app/growth/ui";

export const metadata = {
  title: "نموي المهني | منارة قرطبة",
};

/**
 * Batch 2 (part 2/2) — the teacher's OWN growth journey (/my-growth):
 * where they stand on the T0–T5 ladder, how far they are from the 60%
 * promotion gate and the 35-hour annual target, every course,
 * assessment, assignment and certificate behind those numbers, and the
 * full journey history. One hundred percent real database rows — the
 * persisted level only ever changes through the supervisor's v48
 * controls (تصنيف المشرف / اعتماد الانتقال).
 */
export default async function MyGrowthPage() {
  const user = await requireUser();

  // Role routing: teachers here; managers to the platform board;
  // supervisors to their v48 classification board.
  if (user.role === "SUPER_ADMIN" || user.role === "DEVELOPMENT_OFFICE_MANAGER") {
    redirect("/growth");
  }
  if (user.role === "EDUCATIONAL_SUPERVISOR") redirect("/supervision/growth");
  if (user.role !== "TEACHER") redirect("/forbidden");

  const data = await getTeacherGrowth(user.id);
  if (!data) redirect("/forbidden");

  return (
    <div>
      <PageHeader
        title="نموي المهني"
        description={`تقدمك على سلّم T0–T5 — التصنيف الحالي: ${data.currentLabel} — العام الدراسي ${data.academicYear}.`}
        breadcrumbs={[{ label: "الرئيسية" }, { label: "نموي المهني" }]}
      />

      <div className="space-y-6">
        <GrowthLadder currentLevel={data.currentLevel} />

        <GrowthProjection data={data} />

        <SectionCard
          title="رحلة نموي — السجل الكامل"
          description="كل تصنيف وكل انتقال معتمد يظهر هنا بالتاريخ والسبب — سجل إضافي لا يُحذف."
        >
          <GrowthHistoryTimeline events={data.history} />
        </SectionCard>
      </div>
    </div>
  );
}
/**
 * Phase 8 — "نموي المهني" (teacher): the teacher's own professional
 * growth view built ONLY from persisted data — enrollments, assessment
 * attempts, Phase 7 assignment submissions and earned certificates.
 * Rendering is shared with the authorized staff drill-down.
 */
import { getCurrentUser } from "@/lib/auth/session";
import { getTeacherGrowth } from "@/lib/growth/service";
import { AccessDenied, PageHeader } from "@/app/assignments/ui";
import { GrowthProjection } from "@/app/growth/growth-projection";

export const dynamic = "force-dynamic";

export default async function MyGrowthPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "TEACHER") {
    return <AccessDenied hint="صفحة النمو المهني متاحة للمعلمين فقط." />;
  }

  const result = await getTeacherGrowth(user, user.id);
  if (!result.ok) return <AccessDenied hint={result.message} />;

  return (
    <div>
      <PageHeader
        title="نموي المهني"
        subtitle="ملخص تطورك المهني من سجلات التدريب الفعلية: التحاقك، تقييماتك، تكليفاتك وشهاداتك"
      />
      <GrowthProjection data={result.data} />
    </div>
  );
}
/**
 * Phase 8 — per-teacher growth drill-down (back-office). Scope is
 * enforced inside getTeacherGrowth: supervisor → assigned teachers
 * only, deputy → granted scope, manager → own school. SUPER_ADMIN is
 * deliberately pointed to the aggregate page. Any tampering with the
 * route id lands on the service's scope rejection.
 */
import { getCurrentUser } from "@/lib/auth/session";
import { getTeacherGrowth } from "@/lib/growth/service";
import { AccessDenied, PageHeader } from "@/app/assignments/ui";
import { GrowthProjection } from "@/app/growth/growth-projection";

export const dynamic = "force-dynamic";

export default async function TeacherGrowthPage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  if (user.role === "TEACHER") {
    return (
      <AccessDenied hint="لمعلمي النمو المهني صفحتهم الخاصة — استخدم صفحة «نموي المهني»." />
    );
  }
  if (user.role === "SUPER_ADMIN") {
    return (
      <AccessDenied hint="الإطلاع على ملف معلم محدد غير متاح للإدارة العامة — استخدم الإحصاءات التجميعية على مستوى المنصة." />
    );
  }
  if (
    user.role !== "DEVELOPMENT_OFFICE_MANAGER" &&
    user.role !== "EDUCATIONAL_SUPERVISOR" &&
    user.role !== "EDUCATIONAL_DEPUTY"
  ) {
    return <AccessDenied />;
  }

  const { teacherId } = await params;
  const result = await getTeacherGrowth(user, teacherId);
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const data = result.data;

  return (
    <div>
      <PageHeader
        title={`النمو المهني — ${data.teacher.name}`}
        subtitle={`ملخص من سجلات التدريب الفعلية${data.teacher.branchName ? ` — فرع: ${data.teacher.branchName}` : ""}`}
      />
      <GrowthProjection data={data} />
    </div>
  );
}
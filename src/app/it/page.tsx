import { KeyRound, UserCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { requireItCoordinatorContext } from "@/lib/auth/dev-admin";
import { getItDashboardStats } from "@/lib/it/service";

export const metadata = {
  title: "لوحة تقنية المعلومات | منارة قرطبة",
};

export const dynamic = "force-dynamic";

/**
 * IT coordinator — the workspace hub (/it): real school-scoped counters
 * (getItDashboardStats reads the DB with the session's schoolId — never
 * a client value) plus quick entries to the exactly-two server-enforced
 * capabilities. Everything on this page is read-only.
 */
export default async function ItPage() {
  const ctx = await requireItCoordinatorContext();
  const stats = await getItDashboardStats(ctx.schoolId);

  const counters = [
    { label: "معلمون نشطون", value: stats.teachersActive },
    { label: "مشرفون نشطون", value: stats.supervisorsActive },
    { label: "معلمون مسندون", value: stats.assignedActive },
    { label: "بدون إسناد", value: stats.unassignedActive },
  ];

  return (
    <div>
      <PageHeader
        title="لوحة تقنية المعلومات"
        description="مساحتك محصورة على صلاحيتين داخل مدرستك: إسناد المعلمين إلى المشرفين، واستعادة حسابات المعلمين — كلاهما محمي على الخادم."
        breadcrumbs={[
          { label: "الرئيسية" },
          { label: "تقنية المعلومات" },
          { label: "اللوحة" },
        ]}
        meta={
          <>
            <StatusBadge tone="info" withDot={false}>
              {stats.teachersActive} معلمًا نشطًا
            </StatusBadge>
            <StatusBadge tone="success" withDot={false}>
              {stats.assignedActive} مسند
            </StatusBadge>
            {stats.unassignedActive > 0 && (
              <StatusBadge tone="warning" withDot={false}>
                {stats.unassignedActive} بدون إسناد
              </StatusBadge>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {counters.map((counter) => (
          <div
            key={counter.label}
            className="rounded-2xl border bg-card p-4 shadow-xs"
          >
            <p className="text-xs text-muted-foreground">{counter.label}</p>
            <p className="mt-1.5 text-2xl font-extrabold tabular-nums">
              {counter.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <a
          href="/it/assignments"
          className="group rounded-2xl border bg-card p-5 shadow-xs transition-colors hover:border-brand-600"
        >
          <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <UserCheck className="size-5" aria-hidden="true" />
          </span>
          <p className="font-extrabold">إسناد المعلمين إلى المشرفين</p>
          <p className="mt-1 text-sm text-muted-foreground">
            بحث وتصفية داخل معلمي مدرستك، إسناد فوري أو نقل أو إزالة — كل عملية
            تتحقق من انتماء الطرفين لمدرستك على الخادم.
          </p>
          <span className="mt-3 inline-block text-xs font-bold text-brand-600 group-hover:text-brand-700">
            فتح مساحة الإسناد ←
          </span>
        </a>

        <a
          href="/it/recovery"
          className="group rounded-2xl border bg-card p-5 shadow-xs transition-colors hover:border-brand-600"
        >
          <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <KeyRound className="size-5" aria-hidden="true" />
          </span>
          <p className="font-extrabold">استعادة حسابات المعلمين</p>
          <p className="mt-1 text-sm text-muted-foreground">
            رابط آمن لإعادة تعيين كلمة المرور يصل بريد المعلم نفسه — يُستخدم
            مرة واحدة وينتهي بعد ساعة، مع حد أقصى للمحاولات.
          </p>
          <span className="mt-3 inline-block text-xs font-bold text-brand-600 group-hover:text-brand-700">
            فتح مساحة الاستعادة ←
          </span>
        </a>
      </div>

      <div className="mt-6">
        <SectionCard
          title="مؤشرات آخر 24 ساعة"
          description="عدد روابط الاستعادة المرسلة فعليًا لحسابات معلمي مدرستك خلال اليوم الماضي."
        >
          <p className="text-3xl font-extrabold tabular-nums">
            {stats.recoveryLinks24h}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            رابط استعادة — الحد الأقصى 3 روابط لكل معلم و20 لكل منسق خلال
            الساعة.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
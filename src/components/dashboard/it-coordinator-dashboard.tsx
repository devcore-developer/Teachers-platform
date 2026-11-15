import Link from "next/link";
import { ArrowLeft, KeyRound, UserCheck } from "lucide-react";

import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { roleLabel } from "@/lib/auth/roles";
import { getItDashboardStats } from "@/lib/it/service";

/**
 * IT_COORDINATOR dashboard — real school-scoped counters and direct
 * access to the coordinator's exactly-two capabilities. Nothing else
 * from the administrative area is reachable for this role (each page
 * and service re-checks the role server-side).
 */
export async function ItCoordinatorDashboard({
  name,
  schoolId,
}: {
  name: string;
  schoolId: string;
}) {
  const stats = await getItDashboardStats(schoolId);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card p-5 shadow-xs">
        <p className="text-sm text-muted-foreground">أهلًا بك في منارة قرطبة</p>
        <p className="mt-0.5 text-lg font-extrabold">
          {name}{" "}
          <span className="ms-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700">
            {roleLabel("IT_COORDINATOR")}
          </span>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          مساحتك محصورة على صلاحيتين داخل مدرستك: إسناد المعلمين للمشرفين، واستعادة حسابات
          المعلمين — كلاهما محمي على الخادم.
        </p>
      </div>

      {/* Real school-scoped stats */}
      <div
        className="grid grid-cols-2 gap-4 sm:grid-cols-4"
        aria-label="إحصائيات مساحة تقنية المعلومات"
      >
        <ItStat
          label="معلمون نشطون"
          value={stats.teachersActive}
          icon={<UserCheck className="size-4" aria-hidden="true" />}
        />
        <ItStat
          label="مشرفون نشطون"
          value={stats.supervisorsActive}
          icon={<UserCheck className="size-4" aria-hidden="true" />}
        />
        <ItStat
          label="معلمون مسندون"
          value={stats.assignedActive}
          icon={<UserCheck className="size-4" aria-hidden="true" />}
        />
        <ItStat
          label="بدون إسناد"
          value={stats.unassignedActive}
          icon={<UserCheck className="size-4" aria-hidden="true" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="إسناد المعلمين إلى المشرفين"
          description="بحث وتصفية معلمي مدرستك، ثم إسناد أو نقل أو إزالة — كل عملية تتحقق من انتماء الطرفين لمدرستك على الخادم."
          action={
            <Link
              href="/it/assignments"
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              فتح الشاشة
              <ArrowLeft className="size-3.5" aria-hidden="true" />
            </Link>
          }
        >
          <div className="flex items-center gap-3 rounded-xl border bg-background/60 p-4">
            <span className="flex size-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
              <UserCheck className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-bold">
                {stats.assignedActive} مُسند · {stats.unassignedActive} بدون إسناد
              </p>
              <p className="text-xs text-muted-foreground">
                من إجمالي {stats.teachersActive} معلم نشط في مدرستك
              </p>
            </div>
            <span className="ms-auto shrink-0">
              <StatusBadge tone="info">الصلاحية 1 من 2</StatusBadge>
            </span>
          </div>
        </SectionCard>

        <SectionCard
          title="استعادة حسابات المعلمين"
          description="إرسال رابط آمن لإعادة تعيين كلمة المرور يصل بريد المعلم نفسه — يُستخدم مرة واحدة وينتهي بعد ساعة، مع حد أقصى للمحاولات."
          action={
            <Link
              href="/it/recovery"
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              فتح الشاشة
              <ArrowLeft className="size-3.5" aria-hidden="true" />
            </Link>
          }
        >
          <div className="flex items-center gap-3 rounded-xl border bg-background/60 p-4">
            <span className="flex size-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
              <KeyRound className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-bold">
                {stats.recoveryLinks24h} رابط خلال 24 ساعة
              </p>
              <p className="text-xs text-muted-foreground">
                الروابط تُرسل لبريد المعلم حصريًا — لا تُعرض أي كلمات مرور
              </p>
            </div>
            <span className="ms-auto shrink-0">
              <StatusBadge tone="info">الصلاحية 2 من 2</StatusBadge>
            </span>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function ItStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="text-brand-600">{icon}</span>
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}
import {
  BadgeCheck,
  Clock,
  GraduationCap,
  KeyRound,
  Landmark,
  Link2,
  Mail,
  MapPin,
  ShieldCheck,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { ProfileNameForm } from "@/components/users/profile-name-form";
import { requireUser } from "@/lib/auth/session";
import { roleLabel } from "@/lib/auth/roles";
import { getOwnProfileView } from "@/lib/users/directory";
import { notFound } from "next/navigation";

export const metadata = {
  title: "ملفي الشخصي",
};

/**
 * Self-service profile (Phase 4) — the signed-in user's OWN data only.
 * There is no id parameter: the data always comes from the session, so
 * no user can view or edit another user's profile here. Teachers see
 * their school, branch and current supervisor; the only editable field
 * is the display name (enforced server-side).
 */
export default async function MyProfilePage() {
  const user = await requireUser();
  const profile = await getOwnProfileView(user.id);
  if (!profile) notFound();

  return (
    <div>
      <PageHeader
        title="ملفي الشخصي"
        description="بيانات حسابك الأساسية — التعديل الذاتي محصور في الاسم المعروض فقط."
        breadcrumbs={[{ label: "ملفي الشخصي" }]}
        meta={
          <>
            <StatusBadge tone={profile.isActive ? "success" : "error"}>
              {profile.isActive ? "حساب نشط" : "حساب موقوف"}
            </StatusBadge>
            <StatusBadge tone={profile.isVerified ? "info" : "warning"} withDot={false}>
              {profile.isVerified ? (
                <>
                  <BadgeCheck className="size-3" aria-hidden="true" />
                  بريد موثّق
                </>
              ) : (
                <>
                  <Clock className="size-3" aria-hidden="true" />
                  بانتظار التأكيد
                </>
              )}
            </StatusBadge>
          </>
        }
      />

      <div className="space-y-6">
        <SectionCard
          title="بياناتي"
          description="قيم حقيقية من قاعدة البيانات مرتبطة بجلستك الحالية."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Row icon={KeyRound} label="الاسم" value={profile.name} />
            <Row icon={Mail} label="البريد الإلكتروني" value={profile.email} ltr />
            <Row icon={ShieldCheck} label="الدور" value={roleLabel(profile.role)} />
            <Row
              icon={Landmark}
              label="المدرسة"
              value={profile.school?.nameAr ?? "— منصة (بدون مدرسة)"}
            />
            <Row
              icon={MapPin}
              label="الفرع"
              value={profile.branch?.nameAr ?? "— بدون فرع"}
            />
            {profile.role === "TEACHER" && (
              <Row
                icon={Link2}
                label="المشرف التربوي"
                value={profile.supervisor?.name ?? "— لا يوجد مشرف بعد"}
              />
            )}
            <Row icon={Clock} label="تاريخ الإنشاء" value={profile.createdAtLabel} />
            <Row
              icon={Clock}
              label="آخر دخول"
              value={profile.lastLoginLabel ?? "لم تسجّل الدخول بعد"}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="تعديل الاسم المعروض"
          description="حقل الاسم فقط قابل للتعديل الذاتي — بقية البيانات تُدار من الإدارة المصرّح لها."
        >
          <ProfileNameForm currentName={profile.name} />
        </SectionCard>

        <SectionCard
          title="رحلتي المهنية"
          description="قيد التطوير — وحدات التدريب والتقييم والشهادات ستُفتح في مراحل لاحقة من الخطة."
        >
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-4">
            <span className="flex size-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
              <GraduationCap className="size-5" aria-hidden="true" />
            </span>
            <p className="text-sm text-muted-foreground">
              لا توجد وحدات مهنية متاحة بعد — ستظهر هنا برامجك التدريبية واختباراتك
              وشهاداتك عند إطلاقها، وسيتابعها مشرفك التربوي إن كان مسندًا لك.
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  ltr,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background/60 p-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <span
          className="mt-0.5 block truncate text-sm font-bold"
          dir={ltr ? "ltr" : undefined}
        >
          {value}
        </span>
      </span>
    </div>
  );
}
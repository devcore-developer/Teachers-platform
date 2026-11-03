import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  Clock,
  KeyRound,
  Landmark,
  Link2,
  Mail,
  MapPin,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { UserStatusToggle } from "@/components/users/user-status-toggle";
import {
  DeputyScopeForm,
  ProfileEditForm,
  SupervisorBranchesForm,
  TeacherSupervisorForm,
} from "@/components/users/user-edit-forms";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { roleLabel } from "@/lib/auth/roles";
import { getUserDetailForAdmin, listSupervisorsOfSchool } from "@/lib/users/directory";
import { db } from "@/lib/db";
import { branchStageLabel } from "@/lib/validation/schools";
import { notFound, redirect } from "next/navigation";

export const metadata = {
  title: "تفاصيل المستخدم",
};

/**
 * User details + authorized management actions. The viewer is an
 * administrative actor (requireAdminContext); the service re-checks the
 * school scope. Teachers see their own data via /my-profile instead.
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireAdminContext();
  const { id } = await params;

  const result = await getUserDetailForAdmin(ctx, id);
  if (!result.ok) {
    if (result.code === "FORBIDDEN") redirect("/forbidden");
    notFound();
  }
  const user = result.data;

  const targetSchoolId = user.school?.id ?? null;
  const [branches, supervisors] = targetSchoolId
    ? await Promise.all([
        db.branch.findMany({
          where: { schoolId: targetSchoolId },
          select: { id: true, nameAr: true, stage: true },
          orderBy: { createdAt: "asc" },
        }),
        listSupervisorsOfSchool(targetSchoolId),
      ])
    : [[], []];

  const isSelf = user.id === ctx.id;
  const isSuperAdminTarget = user.role === "SUPER_ADMIN";
  const canToggle = !isSelf && !isSuperAdminTarget;
  const canEditProfile = !isSuperAdminTarget;

  return (
    <div>
      <PageHeader
        title={user.name}
        description={`${roleLabel(user.role)}${user.school ? ` — ${user.school.nameAr}` : " — حساب منصة"}`}
        breadcrumbs={[
          { label: "دليل المستخدمين", href: "/users" },
          { label: user.name },
        ]}
      />

      <div className="space-y-6">
        {/* Identity card */}
        <SectionCard
          title="بيانات الحساب"
          description="قيم حقيقية من قاعدة البيانات — لا تُعرض كلمات المرور أو التوكنات إطلاقًا."
          action={
            <UserStatusToggle
              userId={user.id}
              userName={user.name}
              isActive={user.isActive}
              disabled={!canToggle}
              disabledReason={
                isSelf
                  ? "لا يمكنك تغيير حالة حسابك الحالي"
                  : "حسابات مدير المنصة محمية"
              }
            />
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <InfoRow icon={UserRound} label="الاسم" value={user.name} />
            <InfoRow icon={Mail} label="البريد الإلكتروني" value={user.email} ltr />
            <InfoRow icon={KeyRound} label="الدور" value={roleLabel(user.role)} />
            <InfoRow
              icon={Landmark}
              label="المدرسة"
              value={user.school?.nameAr ?? "— منصة (بدون مدرسة)"}
            />
            <InfoRow
              icon={MapPin}
              label="الفرع"
              value={user.branch?.nameAr ?? "— بدون فرع"}
            />
            <div className="flex items-center gap-3 rounded-xl border bg-background/60 p-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
                <ShieldCheck className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block text-xs font-medium text-muted-foreground">
                  حالة الحساب
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  <StatusBadge tone={user.isActive ? "success" : "error"}>
                    {user.isActive ? "نشط" : "موقوف"}
                  </StatusBadge>
                  <StatusBadge tone={user.isVerified ? "info" : "warning"} withDot={false}>
                    {user.isVerified ? (
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
                </span>
              </span>
            </div>
            <InfoRow
              icon={Building2}
              label="تاريخ الإنشاء"
              value={user.createdAtLabel}
            />
            <InfoRow
              icon={Clock}
              label="آخر دخول"
              value={user.lastLoginLabel ?? "لم يسجّل بعد"}
            />
            {user.role === "TEACHER" && (
              <InfoRow
                icon={Link2}
                label="المشرف التربوي"
                value={user.supervisor?.name ?? "— لا يوجد مشرف بعد"}
              />
            )}
          </div>
        </SectionCard>

        {canEditProfile && (
          <SectionCard
            title="تعديل بيانات الحساب"
            description="الاسم وإسناد الفرع فقط — الدور والمدرسة وحالة الحساب لا تُعدّل من هنا (لا يمكن نقل مستخدم بين المدارس من هذه الواجهة)."
          >
            <ProfileEditForm
              userId={user.id}
              name={user.name}
              branchId={user.branch?.id ?? null}
              branches={branches}
              targetSchoolName={user.school?.nameAr ?? null}
            />
          </SectionCard>
        )}

        {user.role === "TEACHER" && targetSchoolId && (
          <SectionCard
            title="إسناد المشرف التربوي"
            description="اختيار المشرف يستبدل الإسناد السابق داخل المعاملة — المشرف السابق يفقد الاطلاع فورًا ما لم يشمله نطاق فروعه."
          >
            <TeacherSupervisorForm
              teacherId={user.id}
              currentSupervisorId={user.supervisor?.id ?? null}
              supervisors={supervisors}
            />
          </SectionCard>
        )}

        {user.role === "EDUCATIONAL_SUPERVISOR" && targetSchoolId && (
          <SectionCard
            title="نطاق فروع المشرف"
            description="المشرف يرى معلمي هذه الفروع تلقائيًا، إضافة إلى المعلمين المسندين إليه صراحةً — داخل مدرسته فقط."
          >
            <SupervisorBranchesForm
              supervisorId={user.id}
              assignedBranchIds={user.supervisorBranches.map((branch) => branch.id)}
              branches={branches}
            />
          </SectionCard>
        )}

        {user.role === "EDUCATIONAL_DEPUTY" && targetSchoolId && (
          <SectionCard
            title="نطاق اطلاع الوكيل (قراءة فقط)"
            description="المنح يحدد ما يراه الوكيل في مساحته — لا يمنحه أي صلاحية إنشاء أو تعديل أو حذف إطلاقًا."
          >
            <DeputyScopeForm
              deputyId={user.id}
              grants={user.deputyGrants}
              branches={branches}
            />
          </SectionCard>
        )}

        {user.role === "EDUCATIONAL_SUPERVISOR" && (
          <SectionCard
            title="المعلمون في نطاق هذا المشرف"
            description="اتحاد الإسناد الصريح وتغطية الفروع — المحسوبة من قاعدة البيانات."
          >
            {user.supervisorBranches.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                لا توجد فروع مسندة لهذا المشرف بعد — أسند فروعًا لتظهر معلموها.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2" role="list">
                {user.supervisorBranches.map((branch) => (
                  <li
                    key={branch.id}
                    className="flex items-center gap-3 rounded-xl border bg-background/60 p-3.5"
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                      <Users className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-sm font-bold">
                        {branch.nameAr}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {branchStageLabel(branch.stage)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              لعرض القائمة الكاملة بمنظور المشرف نفسه:{" "}
              <Link href="/supervision" className="font-bold text-brand-600 hover:underline">
                مساحة المشرف
              </Link>{" "}
              (تتطلب الدخول بحساب المشرف).
            </p>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function InfoRow({
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
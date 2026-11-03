import {
  ArrowLeft,
  Eye,
  GraduationCap,
  KeyRound,
  Landmark,
  Link2,
  MapPin,
  ShieldCheck,
  UserRound,
  UserCheck,
} from "lucide-react";

import Link from "next/link";

import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { branchStageLabel } from "@/lib/validation/schools";
import { roleLabel } from "@/lib/auth/roles";
import type { SafeUser } from "@/lib/auth/session";
import {
  listDeputyGrants,
  listSupervisorAssignments,
} from "@/lib/users/service";
import {
  getOwnProfileView,
  getSupervisorWorkspace,
} from "@/lib/users/directory";

/**
 * Role-aware dashboard for the non-administrative roles. Each role sees
 * ONLY the data its server-side boundary allows:
 *   - supervisor: branches assigned to them + teachers inside them;
 *   - deputy: explicitly granted schools/branches, read-only notice;
 *   - teacher: own real profile (school/branch/supervisor) + honest
 *     placeholders for the future professional modules.
 */
export async function RoleDashboard({ user }: { user: SafeUser }) {
  if (user.role === "EDUCATIONAL_SUPERVISOR") {
    const [workspace, assignments] = await Promise.all([
      getSupervisorWorkspace(user.id),
      listSupervisorAssignments(user.id),
    ]);
    const teachers = workspace?.teachers ?? [];

    return (
      <div className="space-y-6">
        <WelcomeHeader user={user} />
        <SectionCard
          title="الفروع المسندة إليك"
          description="يمكنك متابعة معلمي هذه الفروع فقط — الإسناد يتم من إدارة مكتب التطوير في مدرستك."
          action={
            <Link
              href="/supervision"
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              مساحة المشرف الكاملة
              <ArrowLeft className="size-3.5" aria-hidden="true" />
            </Link>
          }
        >
          {assignments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              لا توجد فروع مسندة إليك بعد — تواصل مع إدارة مكتب التطوير.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2" role="list">
              {assignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex items-center gap-3 rounded-xl border bg-background/60 p-4"
                >
                  <span className="flex size-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                    <MapPin className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">
                      {assignment.branch.nameAr}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {branchStageLabel(assignment.branch.stage)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={`المعلمون داخل نطاقك (${teachers.length})`}
          description="إسناد مباشر أو عبر تغطية الفروع — محصور دائمًا داخل مدرستك وبفروقك المصرّح بها."
        >
          {teachers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              لا يوجد معلمون في نطاقك حتى الآن.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border" role="list">
              {teachers.map((teacher) => (
                <li
                  key={teacher.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{teacher.name}</p>
                    <p className="truncate text-xs text-muted-foreground" dir="ltr">
                      {teacher.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {teacher.branchName ?? "بدون فرع"}
                    </span>
                    <StatusBadge
                      tone={teacher.source === "explicit" ? "info" : "neutral"}
                      withDot={false}
                    >
                      {teacher.source === "explicit" ? "إسناد مباشر" : "عبر الفرع"}
                    </StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    );
  }

  if (user.role === "EDUCATIONAL_DEPUTY") {
    const grants = await listDeputyGrants(user.id);

    return (
      <div className="space-y-6">
        <WelcomeHeader user={user} />
        <SectionCard
          title="صلاحيات الاطلاع الممنوحة لك"
          description="وصول قراءة فقط على المدارس والفروع الممنوحة صراحة — لا تملك صلاحيات إنشاء أو تعديل أو حذف."
          action={
            <Link
              href="/deputy-overview"
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
            >
              <Eye className="size-3.5" aria-hidden="true" />
              نطاق اطلاعي الكامل
            </Link>
          }
        >
          {grants.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              لا توجد صلاحيات اطلاع ممنوحة لك بعد — تواصل مع إدارة مكتب التطوير.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2" role="list">
              {grants.map((grant) => (
                <li
                  key={grant.id}
                  className="flex items-center gap-3 rounded-xl border bg-background/60 p-4"
                >
                  <span className="flex size-10 items-center justify-center rounded-lg bg-info-soft text-info">
                    <Landmark className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">
                      {grant.school.nameAr}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {grant.branch
                        ? `فرع: ${grant.branch.nameAr}`
                        : "اطلاع على المدرسة كاملة"}
                    </span>
                  </span>
                  <span className="ms-auto shrink-0">
                    <StatusBadge tone="info">قراءة فقط</StatusBadge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    );
  }

  // TEACHER — real own profile data (school, branch, supervisor) via the
  // session-bound reader; no other user's data is reachable here.
  const profile = await getOwnProfileView(user.id);

  return (
    <div className="space-y-6">
      <WelcomeHeader user={user} />
      <SectionCard
        title="ملفي الشخصي"
        description="بيانات حسابك الحقيقية — وحدات التدريب والتقييم والشهادات الخاصة بك ستتوفر في مراحل لاحقة."
        action={
          <Link
            href="/my-profile"
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            ملفي الكامل
            <ArrowLeft className="size-3.5" aria-hidden="true" />
          </Link>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <ProfileRow icon={UserRound} label="الاسم" value={user.name} />
          <ProfileRow icon={KeyRound} label="البريد الإلكتروني" value={user.email} ltr />
          <ProfileRow
            icon={Landmark}
            label="المدرسة"
            value={profile?.school?.nameAr ?? "— غير محددة"}
          />
          <ProfileRow
            icon={MapPin}
            label="الفرع"
            value={profile?.branch?.nameAr ?? "— بدون فرع"}
          />
          {profile?.supervisor && (
            <ProfileRow
              icon={UserCheck}
              label="المشرف التربوي"
              value={profile.supervisor.name}
            />
          )}
          <div className="flex items-center gap-3 rounded-xl border bg-background/60 p-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-xs font-medium text-muted-foreground">
                حالة التوثيق
              </span>
              <span className="mt-1 block">
                <StatusBadge tone={user.emailVerifiedAt ? "success" : "warning"}>
                  {user.emailVerifiedAt ? "بريد موثّق" : "بانتظار التأكيد"}
                </StatusBadge>
              </span>
            </span>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="رحلتي المهنية"
        description="قيد التطوير — ستشمل برامجك التدريبية واختباراتك وشهاداتك في مراحل قادمة."
      >
        <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-4">
          <span className="flex size-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
            <GraduationCap className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            لا توجد وحدات مهنية متاحة بعد — سيصلك إشعار عند إطلاقها.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}

function WelcomeHeader({ user }: { user: SafeUser }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-xs">
      <p className="text-sm text-muted-foreground">أهلًا بك في منارة قرطبة</p>
      <p className="mt-0.5 text-lg font-extrabold">
        {user.name}{" "}
        <span className="ms-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700">
          {roleLabel(user.role)}
        </span>
      </p>
    </div>
  );
}

function ProfileRow({
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
        <span className="mt-0.5 block truncate text-sm font-bold" dir={ltr ? "ltr" : undefined}>
          {value}
        </span>
      </span>
    </div>
  );
}
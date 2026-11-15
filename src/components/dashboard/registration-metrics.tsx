import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Link2,
  ShieldAlert,
  UserCheck,
  UserRoundCheck,
} from "lucide-react";

import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import {
  getSchoolRegistrationStats,
  type RegistrationStats,
} from "@/lib/registration-links/service";
import { db } from "@/lib/db";

/**
 * Registration workflow visibility for the school administration
 * dashboard (Phase 6): registered / awaiting-verification /
 * awaiting-supervisor / assigned counts + the active link state.
 *   - schoolId present -> that school's numbers (office/school manager);
 *   - schoolId null    -> platform-wide aggregate (SUPER_ADMIN).
 */
export async function RegistrationMetricsSection({
  schoolId,
}: {
  schoolId?: string;
}) {
  const stats: RegistrationStats = schoolId
    ? await getSchoolRegistrationStats(schoolId)
    : {
        totalTeachers: await db.user.count({ where: { role: "TEACHER" } }),
        viaLinks: await db.user.count({
          where: { role: "TEACHER", registrationLinkId: { not: null } },
        }),
        awaitingVerification: await db.user.count({
          where: { role: "TEACHER", isActive: true, emailVerifiedAt: null },
        }),
        verifiedUnassigned: await db.user.count({
          where: {
            role: "TEACHER",
            isActive: true,
            emailVerifiedAt: { not: null },
            teacherSupervision: { is: null },
          },
        }),
        assigned: await db.teacherSupervisorAssignment.count({
          where: { teacher: { isActive: true } },
        }),
      };

  // Active registration link status — the first card the manager checks.
  const activeLinkRow = schoolId
    ? await db.registrationLink.findFirst({
        where: { schoolId, isActive: true },
        select: { expiresAt: true },
      })
    : null;
  const activeLinkCount = schoolId
    ? null
    : await db.registrationLink.count({ where: { isActive: true } });

  const activeLinkExpired = activeLinkRow?.expiresAt
    ? activeLinkRow.expiresAt.getTime() <= Date.now()
    : false;
  const activeLinkLabel = schoolId
    ? activeLinkRow
      ? activeLinkExpired
        ? "نشط لكن منتهي الصلاحية"
        : "نشط — يقبل التسجيلات"
      : "لا يوجد رابط نشط"
    : `${activeLinkCount ?? 0} رابط نشط على المنصة`;

  const unassigned = stats.verifiedUnassigned;

  return (
    <SectionCard
      title="تسجيل المعلمين عبر الروابط"
      description="تسجيل معلم جديد ثم توثيق بريده ثم إسناده لمشرف تربوي — كل خطوة ظاهرة هنا بأرقامها الحقيقية."
      action={
        <Link
          href="/registration-links"
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
        >
          إدارة الروابط
          <ArrowLeft className="size-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <RegStat
          label="إجمالي المعلمين"
          value={stats.totalTeachers}
          icon={<UserRoundCheck className="size-4" aria-hidden="true" />}
        />
        <RegStat
          label="عبر روابط التسجيل"
          value={stats.viaLinks}
          icon={<Link2 className="size-4" aria-hidden="true" />}
        />
        <RegStat
          label="بانتظار التوثيق"
          value={stats.awaitingVerification}
          icon={<ShieldAlert className="size-4" aria-hidden="true" />}
        />
        <RegStat
          label="بانتظار الإسناد"
          value={stats.verifiedUnassigned}
          icon={<UserCheck className="size-4" aria-hidden="true" />}
        />
        <RegStat
          label="مُسنَدون لمشرف"
          value={stats.assigned}
          icon={<BadgeCheck className="size-4" aria-hidden="true" />}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border bg-background/60 p-3.5">
        <span className="text-sm font-bold">رابط التسجيل:</span>
        <StatusBadge
          tone={
            schoolId
              ? activeLinkRow && !activeLinkExpired
                ? "success"
                : "warning"
              : "info"
          }
        >
          {activeLinkLabel}
        </StatusBadge>
        {unassigned > 0 && (
          <span className="text-xs text-muted-foreground">
            {unassigned} معلم موثّق بانتظار إسناد المشرف التربوي من تقنية المعلومات.
          </span>
        )}
      </div>
    </SectionCard>
  );
}

function RegStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-background/60 p-3.5">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="text-brand-600">{icon}</span>
        {label}
      </div>
      <p className="mt-1 text-xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}
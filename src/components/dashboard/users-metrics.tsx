import Link from "next/link";
import { ChevronLeft, Eye, ShieldCheck, UserCheck, UserCog, Users } from "lucide-react";

import { SectionCard } from "@/components/platform/section-card";
import { getPlatformUsersMetrics, getSchoolUsersMetrics } from "@/lib/users/directory";

/**
 * Real, persisted USER metrics for the dashboard (Phase 4):
 *   - no schoolId -> platform-wide (SUPER_ADMIN);
 *   - schoolId    -> one school (office manager; the id comes from the
 *     session, never the client). A school-scoped viewer never sees
 *     another school's counts.
 */
interface UsersMetricsSectionProps {
  schoolId?: string;
}

export async function UsersMetricsSection({ schoolId }: UsersMetricsSectionProps) {
  const metrics = schoolId
    ? await getSchoolUsersMetrics(schoolId)
    : await getPlatformUsersMetrics();

  const items = schoolId
    ? [
        {
          id: "school-users",
          label: "مستخدمو المدرسة",
          value: metrics.totalUsers,
          icon: Users,
          tileClass: "bg-brand-100 text-brand-700",
        },
        {
          id: "school-teachers",
          label: "المعلمون",
          value: metrics.teachersCount,
          icon: UserCheck,
          tileClass: "bg-info-soft text-info",
        },
        {
          id: "school-supervisors",
          label: "المشرفون التربويون",
          value: metrics.supervisorsCount,
          icon: UserCog,
          tileClass: "bg-success-soft text-success",
        },
        {
          id: "school-active",
          label: "حسابات نشطة",
          value: metrics.activeUsers,
          icon: ShieldCheck,
          tileClass: "bg-warning-soft text-warning",
        },
      ]
    : [
        {
          id: "platform-users",
          label: "إجمالي المستخدمين",
          value: metrics.totalUsers,
          icon: Users,
          tileClass: "bg-brand-100 text-brand-700",
        },
        {
          id: "platform-teachers",
          label: "المعلمون",
          value: metrics.teachersCount,
          icon: UserCheck,
          tileClass: "bg-info-soft text-info",
        },
        {
          id: "platform-managers",
          label: "مديرو مكاتب التطوير",
          value: metrics.managersCount,
          icon: UserCog,
          tileClass: "bg-success-soft text-success",
        },
        {
          id: "platform-active",
          label: "حسابات نشطة",
          value: metrics.activeUsers,
          icon: ShieldCheck,
          tileClass: "bg-warning-soft text-warning",
        },
      ];

  return (
    <SectionCard
      title={schoolId ? "مستخدمو مدرستك" : "مستخدمو المنصة"}
      description="مؤشرات حقيقية للحسابات من قاعدة البيانات — تُحدَّث مع كل إضافة أو تعديل."
      action={
        <Link
          href="/users"
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
        >
          دليل المستخدمين
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <div
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
        role="list"
        aria-label="مؤشرات المستخدمين"
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              role="listitem"
              className="flex items-center gap-3 rounded-xl border bg-background/60 p-3.5"
            >
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${item.tileClass}`}
                aria-hidden="true"
              >
                <Icon className="size-5" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block text-xl font-extrabold tabular-nums text-foreground">
                  {item.value}
                </span>
                <span className="block truncate text-xs font-medium text-muted-foreground">
                  {item.label}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      {schoolId && metrics.deputiesCount > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Eye className="size-3.5" aria-hidden="true" />
          ويشمل {metrics.deputiesCount} وكيلًا تعليميًا بصلاحيات اطلاع.
        </p>
      )}
    </SectionCard>
  );
}
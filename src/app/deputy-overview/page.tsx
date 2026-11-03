import { Eye, Landmark, MapPin, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { EmptyState } from "@/components/platform/empty-state";
import { requireUser } from "@/lib/auth/session";
import { getDeputyOverview } from "@/lib/users/directory";
import { branchStageLabel } from "@/lib/validation/schools";
import { redirect } from "next/navigation";

export const metadata = {
  title: "نطاق اطلاعي",
};

/**
 * Deputy workspace (Phase 4) — strictly READ-ONLY. Shows only the
 * explicitly granted schools/branches with real per-branch teacher
 * counts. There are intentionally NO create/edit/delete controls on
 * this page, and the service layer grants the deputy no mutation path.
 */
export default async function DeputyOverviewPage() {
  const user = await requireUser();
  if (user.role !== "EDUCATIONAL_DEPUTY") redirect("/forbidden");

  const overview = await getDeputyOverview(user.id);
  if (!overview) redirect("/forbidden");

  return (
    <div>
      <PageHeader
        title="نطاق اطلاعي"
        description="المدارس والفروع الممنوحة لك صراحةً للاطلاع فقط — لا تملك صلاحيات إنشاء أو تعديل أو حذف."
        breadcrumbs={[{ label: "نطاق اطلاعي" }]}
        meta={<StatusBadge tone="info">وصول قراءة فقط</StatusBadge>}
      />

      <div className="space-y-6">
        {overview.schools.length === 0 ? (
          <SectionCard title="النطاق الممنوح لك">
            <EmptyState
              icon={Eye}
              title="لا توجد صلاحيات اطلاع ممنوحة لك بعد"
              description="تواصل مع إدارة مكتب التطوير في مدرستك — سيتم منحك نطاق اطلاع (مدرسة كاملة أو فروع محددة)."
            />
          </SectionCard>
        ) : (
          overview.schools.map((school) => (
            <SectionCard
              key={school.id}
              title={school.nameAr}
              description="مؤشرات حقيقية من قاعدة البيانات داخل النطاق الممنوح لك — قراءة فقط."
              action={<StatusBadge tone="info">قراءة فقط</StatusBadge>}
            >
              {school.branches.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  لا توجد فروع داخل نطاقك لهذه المدرسة بعد.
                </p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="list">
                  {school.branches.map((branch) => (
                    <li
                      key={branch.id}
                      className="flex items-center gap-3 rounded-xl border bg-background/60 p-4"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                        <MapPin className="size-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate text-sm font-bold">
                          {branch.nameAr}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {branchStageLabel(branch.stage)}
                        </span>
                      </span>
                      <span className="ms-auto flex flex-col items-end gap-1">
                        <span className="inline-flex items-center gap-1 text-sm font-extrabold tabular-nums">
                          <Users className="size-3.5 text-muted-foreground" aria-hidden="true" />
                          {branch.teachersCount}
                        </span>
                        <span className="text-[11px] text-muted-foreground">معلم</span>
                        {!branch.isActive && (
                          <StatusBadge tone="warning" withDot={false}>
                            فرع موقوف
                          </StatusBadge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Landmark className="size-3.5" aria-hidden="true" />
                إجمالي الفروع المعروضة: {school.branches.length} — وفق النطاق الممنوح لك
              </p>
            </SectionCard>
          ))
        )}
      </div>
    </div>
  );
}
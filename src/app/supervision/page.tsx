import { ClipboardList, MapPin, UserCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { EmptyState } from "@/components/platform/empty-state";
import { requireUser } from "@/lib/auth/session";
import { roleLabel } from "@/lib/auth/roles";
import { getSupervisorWorkspace } from "@/lib/users/directory";
import { branchStageLabel } from "@/lib/validation/schools";
import { redirect } from "next/navigation";

export const metadata = {
  title: "مساحة المشرف",
};

/**
 * Supervisor workspace (Phase 4). Shows ONLY the supervisor's authorized
 * branch scope and the teachers they may see (explicit assignments +
 * branch coverage, computed server-side). Follow-up entry points link to
 * the (honest) upcoming follow-up module — no operational writes here.
 */
export default async function SupervisionPage() {
  const user = await requireUser();
  if (user.role !== "EDUCATIONAL_SUPERVISOR") redirect("/forbidden");

  const workspace = await getSupervisorWorkspace(user.id);
  if (!workspace) redirect("/forbidden");

  const explicitCount = workspace.teachers.filter((t) => t.source === "explicit").length;

  return (
    <div>
      <PageHeader
        title="معلموّي"
        description={`المعلمون داخل نطاقك المصرّح به فقط — ${roleLabel(user.role)}${user.schoolId ? "" : ""}`}
        breadcrumbs={[{ label: "معلموّي" }]}
        meta={
          <>
            <StatusBadge tone="info" withDot={false}>
              {workspace.branches.length} فرع مسند
            </StatusBadge>
            <StatusBadge tone="success" withDot={false}>
              {workspace.teachers.length} معلم في نطاقك
            </StatusBadge>
            {explicitCount > 0 && (
              <StatusBadge tone="neutral" withDot={false}>
                {explicitCount} إسناد مباشر
              </StatusBadge>
            )}
          </>
        }
      />

      <div className="space-y-6">
        <SectionCard
          title="الفروع المسندة إليك"
          description="الإسناد يتم من إدارة مكتب التطوير في مدرستك — أنت ترى معلمي هذه الفروع تلقائيًا."
        >
          {workspace.branches.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="لا توجد فروع مسندة إليك بعد"
              description="تواصل مع إدارة مكتب التطوير في مدرستك لإسناد فروعك — ستظهر معلموها هنا تلقائيًا."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="list">
              {workspace.branches.map((branch) => (
                <li
                  key={branch.id}
                  className="flex items-center gap-3 rounded-xl border bg-background/60 p-4"
                >
                  <span className="flex size-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
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
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={`المعلمون في نطاقك (${workspace.teachers.length})`}
          description="قائمة حقيقية من قاعدة البيانات — إسناد مباشر أو عبر تغطية الفرع، ومحصورة دائمًا داخل مدرستك."
        >
          {workspace.teachers.length === 0 ? (
            <EmptyState
              icon={UserCheck}
              title="لا يوجد معلمون في نطاقك حتى الآن"
              description="سيظهر هنا كل معلم يُسند إليك مباشرةً أو يُسجل في فروعك المسندة."
            />
          ) : (
            <ul className="divide-y rounded-xl border" role="list">
              {workspace.teachers.map((teacher) => (
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {teacher.branchName ?? "بدون فرع"}
                    </span>
                    <StatusBadge
                      tone={teacher.source === "explicit" ? "info" : "neutral"}
                      withDot={false}
                    >
                      {teacher.source === "explicit" ? "إسناد مباشر" : "عبر الفرع"}
                    </StatusBadge>
                    <StatusBadge
                      tone={teacher.isVerified ? "success" : "warning"}
                      withDot={false}
                    >
                      {teacher.isVerified ? "موثّق" : "بانتظار التأكيد"}
                    </StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="نقاط المتابعة"
          description="بوابات المتابعة التربوية والتكليفات — تُفتح مع وحدة التكليفات في مرحلة لاحقة."
        >
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-4">
            <span className="flex size-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
              <ClipboardList className="size-5" aria-hidden="true" />
            </span>
            <p className="text-sm text-muted-foreground">
              لا توجد متابعات نشطة بعد — وحدة «التكليفات والمتابعة» قيد التطوير وستربط
              بمعلمي نطاقك تلقائيًا.
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
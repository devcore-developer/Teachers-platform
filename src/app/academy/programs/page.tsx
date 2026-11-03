import { requireAdminContext } from "@/lib/auth/dev-admin";
import { listSchools } from "@/lib/schools/service";
import { PageHeader } from "@/components/layout/page-header";
import { ProgramManager } from "@/components/training/program-manager";
import { listProgramsForManage } from "@/lib/training/service";

export const metadata = {
  title: "البرامج التدريبية",
};

const dateFormatter = new Intl.DateTimeFormat("ar", { dateStyle: "medium" });

/**
 * Phase 5 — training program management. SUPER_ADMIN manages platform
 * programs plus every school's; office managers manage their own
 * school's programs only (service-enforced).
 */
export default async function ProgramsPage() {
  const ctx = await requireAdminContext();

  const result = await listProgramsForManage(ctx);
  if (!result.ok) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm font-semibold text-destructive"
      >
        {result.message}
      </div>
    );
  }

  const schools =
    ctx.role === "SUPER_ADMIN" ? await listSchools() : [];

  const programs = result.data.map((program) => ({
    ...program,
    updatedAtLabel: dateFormatter.format(program.updatedAt),
  }));

  return (
    <div>
      <PageHeader
        title="البرامج التدريبية"
        description="البرامج التي تُنظّم الدورات — تُنشأ كمسودات وتُنشر لتصبح متاحة عند بناء الدورات."
        breadcrumbs={[
          { label: "إدارة الدورات", href: "/academy/manage" },
          { label: "البرامج التدريبية" },
        ]}
      />
      <ProgramManager
        programs={programs}
        schools={schools.map((school) => ({ id: school.id, nameAr: school.nameAr }))}
        isSuperAdmin={ctx.role === "SUPER_ADMIN"}
      />
    </div>
  );
}
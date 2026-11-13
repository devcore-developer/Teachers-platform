import { db } from "@/lib/db";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { listSchools } from "@/lib/schools/service";
import { CourseForm } from "@/components/training/course-form";
import { PageHeader } from "@/components/layout/page-header";
import {
  getInstructorOptions,
} from "@/lib/training/service";

export const metadata = {
  title: "دورة تدريبية جديدة",
};

/**
 * Create-course page. Scope options and instructor candidates depend on
 * the actor: office managers are fixed to their own school; the platform
 * admin picks the scope and gets instructor candidates grouped by school.
 */
export default async function NewCoursePage() {
  const ctx = await requireAdminContext();

  const schools =
    ctx.role === "SUPER_ADMIN" ? await listSchools() : [];

  const instructors =
    ctx.role === "DEVELOPMENT_OFFICE_MANAGER"
      ? (await getInstructorOptions(ctx, ctx.schoolId)).map((instructor) => ({
          ...instructor,
          schoolId: ctx.schoolId,
        }))
      : await db.user.findMany({
          where: {
            role: { in: ["TEACHER", "EDUCATIONAL_SUPERVISOR"] },
            isActive: true,
            schoolId: { not: null },
          },
          select: { id: true, name: true, schoolId: true },
          orderBy: { name: "asc" },
        });

  return (
    <div>
      <PageHeader
        title="دورة تدريبية جديدة"
        description="أنشئ الدورة كمسودة ثم انتقل مباشرة إلى بانى المحتوى لإضافة الأقسام والدروس."
        breadcrumbs={[
          { label: "إدارة الدورات", href: "/academy/manage" },
          { label: "دورة جديدة" },
        ]}
      />
      <CourseForm
        mode="create"
        schools={schools.map((school) => ({ id: school.id, nameAr: school.nameAr }))}
        instructors={instructors}
        showScope={ctx.role === "SUPER_ADMIN"}
        defaultScope="school"
        fixedSchoolId={ctx.role === "DEVELOPMENT_OFFICE_MANAGER" ? ctx.schoolId : undefined}
      />
    </div>
  );
}
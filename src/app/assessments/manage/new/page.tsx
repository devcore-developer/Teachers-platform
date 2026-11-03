import { AssessmentForm } from "@/components/assessments/assessment-form";
import { PageHeader } from "@/components/layout/page-header";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { listCourseOptions } from "@/lib/assessment/service";
import { listSchools } from "@/lib/schools/service";

export const metadata = {
  title: "اختبار جديد",
};

/**
 * Create a new assessment — starts as a DRAFT; questions and publishing
 * happen on the editor page. Tenancy is decided here and stays fixed.
 */
export default async function NewAssessmentPage() {
  const ctx = await requireAdminContext();

  const [courseOptions, schools] = await Promise.all([
    listCourseOptions(ctx),
    ctx.role === "SUPER_ADMIN" ? listSchools() : Promise.resolve([]),
  ]);

  return (
    <div>
      <PageHeader
        title="إنشاء اختبار جديد"
        description="اضبط عنوان الاختبار وتعليماته ودرجة النجاح وقيوده الزمنية — ثم أضف الأسئلة في صفحة البناء."
        breadcrumbs={[
          { label: "الاختبارات والتقييم" },
          { label: "إدارة الاختبارات", href: "/assessments/manage" },
          { label: "اختبار جديد" },
        ]}
      />

      <div className="rounded-xl border bg-card p-5 sm:p-6">
        <AssessmentForm
          mode="create"
          courseOptions={courseOptions.map((course) => ({
            id: course.id,
            titleAr: course.titleAr,
            schoolId: course.schoolId,
          }))}
          schoolOptions={schools.map((school) => ({
            id: school.id,
            nameAr: school.nameAr,
          }))}
          isSuperAdmin={ctx.role === "SUPER_ADMIN"}
        />
      </div>
    </div>
  );
}
import { PageHeader } from "@/components/layout/page-header";
import { SchoolForm } from "@/components/schools/school-form";

export const metadata = {
  title: "إضافة مدرسة",
};

export default function NewSchoolPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="إضافة مدرسة جديدة"
        description="سجّل المدرسة في المنصة وحدّد هويتها الأساسية. يمكنك إضافة الفروع والمراحل التعليمية بعد الإنشاء."
        breadcrumbs={[{ label: "المدارس", href: "/schools" }, { label: "إضافة مدرسة" }]}
      />
      <SchoolForm mode="create" />
    </div>
  );
}
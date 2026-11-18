import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { SchoolForm } from "@/components/schools/school-form";
import { requireUser } from "@/lib/auth/session";
import { canManagePlatform } from "@/lib/auth/roles";

export const metadata = {
  title: "إضافة مدرسة",
};

export default async function NewSchoolPage() {
  // SERVER-SIDE GUARD — creating a school is a platform-owner action:
  // only SUPER_ADMIN may open this page, even by direct URL. The
  // createSchool service re-checks the role on every submission.
  const user = await requireUser("/schools/new");
  if (!canManagePlatform(user.role)) redirect("/forbidden");

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
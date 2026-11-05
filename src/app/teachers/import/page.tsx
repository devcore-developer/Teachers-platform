import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { ImportClient } from "@/app/teachers/import/import-client";

export const metadata = {
  title: "استيراد الإسنادات | منارة قرطبة",
};

/**
 * Batch 2 — Excel/CSV import for teacher-supervisor assignments and
 * teacher data (HTML v21/v26 parity): server-side parsing + validation
 * preview with the ORIGINAL states, then an explicit approve step.
 */
export default async function TeachersImportPage() {
  await requireAdminContext();

  return (
    <div>
      <PageHeader
        title="استيراد الإسنادات والبيانات"
        description="ملف CSV (يفتح ويُحفظ من Excel مباشرة): اسم المعلم، المشرف المسند إليه، الوكيل، المجمع التعليمي — بنفس أعمدة المنصة الأصلية."
        breadcrumbs={[
          { label: "الرئيسية" },
          { label: "إدارة المعلمين" },
          { label: "استيراد" },
        ]}
      />
      <SectionCard
        title="الخطوات"
        description="حمّل القالب ← جهّز الملف ← اعرض المطابقة ← اعتمد الإسناد. الصفوف التي تحتاج مراجعة تُتخطى وتُبلَّغ ولا تُفقد."
      >
        <ImportClient />
      </SectionCard>
    </div>
  );
}
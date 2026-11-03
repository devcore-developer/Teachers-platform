/**
 * Phase 7 — create a new assignment (office manager). The form starts
 * as a DRAFT; the rubric editor becomes available on the edit page.
 */
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { listAudienceOptions, listContentOptions } from "@/lib/assignments/service";
import { AccessDenied, PageHeader } from "@/app/assignments/ui";
import { AssignmentForm } from "@/app/assignments/assignment-form";

export const dynamic = "force-dynamic";

export default async function NewAssignmentPage() {
  const ctx = await requireAdminContext();
  if (ctx.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return <AccessDenied hint="إدارة التكليفات متاحة لمديري مكاتب التطوير فقط." />;
  }

  const [audience, content] = await Promise.all([
    listAudienceOptions(ctx),
    listContentOptions(ctx),
  ]);
  if (!audience.ok || !content.ok) {
    return (
      <AccessDenied
        hint={!audience.ok ? audience.message : content.ok ? "" : content.message}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="تكليف جديد"
        subtitle="يُنشأ التكليف كمسودة ولا يراه المعلمون قبل النشر"
      />
      <AssignmentForm audience={audience.data} content={content.data} />
    </div>
  );
}
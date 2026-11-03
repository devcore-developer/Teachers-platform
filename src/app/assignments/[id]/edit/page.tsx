/**
 * Phase 7 — edit an assignment (office manager). DRAFT rows get a full
 * edit (audience/content/rubric); PUBLISHED rows get text + deadline
 * policy only — the service enforces the split, the form mirrors it.
 */
import { notFound } from "next/navigation";

import { requireAdminContext } from "@/lib/auth/dev-admin";
import {
  getAssignmentForManage,
  listAudienceOptions,
  listContentOptions,
} from "@/lib/assignments/service";
import { AccessDenied, PageHeader } from "@/app/assignments/ui";
import { AssignmentForm } from "@/app/assignments/assignment-form";

export const dynamic = "force-dynamic";

export default async function EditAssignmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAdminContext();
  if (ctx.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return <AccessDenied hint="إدارة التكليفات متاحة لمديري مكاتب التطوير فقط." />;
  }

  const [detail, audience, content] = await Promise.all([
    getAssignmentForManage(ctx, id),
    listAudienceOptions(ctx),
    listContentOptions(ctx),
  ]);
  if (!detail.ok) {
    if (detail.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={detail.message} />;
  }
  if (!audience.ok || !content.ok) {
    return <AccessDenied hint={!audience.ok ? audience.message : content.ok ? "" : content.message} />;
  }

  const { assignment, criteria } = detail.data;

  return (
    <div>
      <PageHeader
        title={`تعديل: ${assignment.titleAr}`}
        subtitle={
          assignment.status === "PUBLISHED"
            ? "تكليف منشور — تعديل النصوص والمواعيد فقط"
            : "تكليف مسودة — تعديل كامل متاح"
        }
      />
      <AssignmentForm
        initial={{
          id: assignment.id,
          status: assignment.status,
          titleAr: assignment.titleAr,
          titleEn: assignment.titleEn,
          descriptionAr: assignment.descriptionAr,
          descriptionEn: assignment.descriptionEn,
          programId: assignment.programId,
          courseId: assignment.courseId,
          sectionId: assignment.sectionId,
          lessonId: assignment.lessonId,
          audienceMode: assignment.audienceMode,
          targetTeacherIds: assignment.targetTeacherIds,
          targetBranchIds: assignment.targetBranchIds,
          dueAt: assignment.dueAt.toISOString(),
          allowLate: assignment.allowLate,
          lateUntil: assignment.lateUntil ? assignment.lateUntil.toISOString() : null,
          totalPoints: assignment.totalPoints,
        }}
        audience={audience.data}
        content={content.data}
        criteria={criteria}
      />
    </div>
  );
}
/**
 * Phase 7 — assignment detail for the office manager: full settings,
 * rubric, live submission stats and lifecycle actions.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdminContext } from "@/lib/auth/dev-admin";
import { getAssignmentForManage } from "@/lib/assignments/service";
import { AUDIENCE_MODE_LABELS, type AudienceMode } from "@/config/assignments";
import {
  AccessDenied,
  AssignmentStatusBadge,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  formatDate,
} from "@/app/assignments/ui";
import { AssignmentStatusActions } from "@/app/assignments/assignment-status-actions";

export const dynamic = "force-dynamic";

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAdminContext();
  if (ctx.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return <AccessDenied hint="إدارة التكليفات متاحة لمديري مكاتب التطوير فقط." />;
  }

  const result = await getAssignmentForManage(ctx, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={result.message} />;
  }
  const { assignment, criteria, stats } = result.data;

  return (
    <div>
      <PageHeader
        title={assignment.titleAr}
        subtitle={`استحقاق: ${formatDate(assignment.dueAt)} — ${AUDIENCE_MODE_LABELS[assignment.audienceMode as AudienceMode] ?? assignment.audienceMode}`}
        actions={
          <>
            <AssignmentStatusActions assignmentId={assignment.id} status={assignment.status} />
            {assignment.status !== "ARCHIVED" ? (
              <Link
                href={`/assignments/${assignment.id}/edit`}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                تعديل
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="المعلمون المستهدفون" value={stats.targeted} tone="brand" />
        <StatTile label="مسودات" value={stats.drafts} />
        <StatTile label="بانتظار المراجعة" value={stats.submitted + stats.underReview} tone="warning" />
        <StatTile label="أُعيدت للتعديل" value={stats.returned} tone="warning" />
        <StatTile label="مُقيَّمة" value={stats.graded} tone="success" />
        <StatTile label="تسليمات متأخرة" value={stats.lateCount} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="بيانات التكليف">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">الحالة</dt>
              <dd><AssignmentStatusBadge status={assignment.status} /></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">نُشر في</dt>
              <dd className="text-slate-800">{formatDate(assignment.publishedAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">الاستحقاق</dt>
              <dd className="text-slate-800">{formatDate(assignment.dueAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">القبول المتأخر</dt>
              <dd className="text-slate-800">
                {assignment.allowLate
                  ? assignment.lateUntil
                    ? `حتى ${formatDate(assignment.lateUntil)}`
                    : "مسموح دون حد زمني"
                  : "غير مسموح"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">مجموع درجات السلّم</dt>
              <dd className="font-semibold text-slate-800">{assignment.totalPoints} نقطة</dd>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <dt className="mb-1 text-slate-500">الوصف والتعليمات</dt>
              <dd className="whitespace-pre-wrap text-slate-800">{assignment.descriptionAr}</dd>
            </div>
            {assignment.descriptionEn ? (
              <div>
                <dt className="mb-1 text-slate-500">Description (EN)</dt>
                <dd className="whitespace-pre-wrap text-slate-700" dir="ltr">{assignment.descriptionEn}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card title="سلّم التقييم">
          {criteria.length === 0 ? (
            <EmptyState
              title="لا يوجد سلّم تقييم"
              hint="أضف عناصر التقييم من صفحة التعديل أثناء كون التكليف مسودة."
            />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {criteria.map((criterion) => (
                <li key={criterion.id} className="flex items-center justify-between py-2.5">
                  <span className="text-slate-700">
                    {criterion.orderIndex + 1}. {criterion.titleAr}
                  </span>
                  <span className="font-semibold text-[#1D5BD6]">{criterion.maxPoints} نقطة</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Link
          href={`/assignments/${assignment.id}/submissions`}
          className="inline-block rounded-lg bg-[#1D5BD6] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
        >
          عرض تسليمات المعلمين ({stats.submitted + stats.underReview + stats.returned + stats.graded})
        </Link>
      </div>
    </div>
  );
}
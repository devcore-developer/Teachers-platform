/**
 * Phase 7 — teacher assignment detail: full brief, rubric, own
 * submission state, released feedback/score, revision history and the
 * submission workspace. Access is re-checked server-side (school +
 * targeting); other teachers' submissions are unreachable by design.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { getTeacherAssignment } from "@/lib/assignments/service";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
  SubmissionStatusBadge,
  formatBytes,
  formatDate,
} from "@/app/assignments/ui";
import {
  SubmissionWorkspace,
  type SubmissionFileView,
} from "@/app/my-assignments/[id]/submission-workspace";

export const dynamic = "force-dynamic";

const WINDOW_LABELS: Record<string, string> = {
  open: "التسليم مفتوح حتى الموعد المحدد",
  late: "انتهى الموعد — التسليم المتأخر مفعّل وفق السياسة",
  closed: "انتهى موعد التسليم",
};

export default async function MyAssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || user.role !== "TEACHER") {
    return <AccessDenied hint="صفحة التكليف متاحة للمعلمين فقط." />;
  }

  const result = await getTeacherAssignment(user, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={result.message} />;
  }
  const { assignment, criteria, mySubmission } = result.data;
  const windowLabel = WINDOW_LABELS[result.data.windowState] ?? "";

  return (
    <div>
      <PageHeader
        title={assignment.titleAr}
        subtitle={`الاستحقاق: ${formatDate(assignment.dueAt)}${assignment.allowLate ? " — القبول المتأخر مفعّل" : ""}`}
        actions={
          <Link
            href="/my-assignments"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            كل التكليفات
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="الوصف والتعليمات">
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
              {assignment.descriptionAr}
            </p>
            {assignment.descriptionEn ? (
              <p className="mt-4 whitespace-pre-wrap border-t border-slate-100 pt-3 text-sm text-slate-600" dir="ltr">
                {assignment.descriptionEn}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              {assignment.programTitle ? <span>البرنامج: {assignment.programTitle}</span> : null}
              {assignment.courseTitle ? <span>الدورة: {assignment.courseTitle}</span> : null}
              {assignment.sectionTitle ? <span>القسم: {assignment.sectionTitle}</span> : null}
              {assignment.lessonTitle ? <span>الدرس: {assignment.lessonTitle}</span> : null}
            </div>
          </Card>

          <Card title="سلّم التقييم">
            {criteria.length === 0 ? (
              <EmptyState title="لا يوجد سلّم تقييم لهذا التكليف" hint="سيظهر التقييم كدرجة مباشرة من 100." />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {criteria.map((criterion) => {
                  const awarded = mySubmission?.rubricScores?.find(
                    (score) => score.criterionId === criterion.id
                  )?.points;
                  return (
                    <li key={criterion.id} className="flex items-center justify-between py-2.5">
                      <span className="text-slate-700">
                        {criterion.orderIndex + 1}. {criterion.titleAr}
                      </span>
                      <span className="text-xs text-slate-500">
                        {awarded !== undefined ? (
                          <strong className="text-emerald-600">{awarded}</strong>
                        ) : null}{" "}
                        / {criterion.maxPoints} نقطة
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {mySubmission ? (
            <Card
              title="تسليمك"
              actions={<SubmissionStatusBadge status={mySubmission.status} />}
            >
              {mySubmission.responseText && mySubmission.responseText.trim().length > 0 ? (
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
                  {mySubmission.responseText}
                </p>
              ) : (
                <p className="text-sm text-slate-400">لا يوجد نص بعد.</p>
              )}
              <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                {mySubmission.submittedAt ? (
                  <>أول تسليم: {formatDate(mySubmission.submittedAt)} — </>
                ) : null}
                {mySubmission.lastSubmittedAt ? (
                  <>آخر تحديث: {formatDate(mySubmission.lastSubmittedAt)} — </>
                ) : null}
                مرات إعادة التسليم: {mySubmission.resubmitCount}
                {mySubmission.isLate ? " — سُلِّم متأخرًا" : ""}
              </div>

              {mySubmission.revisions.length > 0 ? (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <h4 className="mb-2 text-xs font-semibold text-slate-500">سجل النسخ السابقة</h4>
                  <ol className="space-y-2">
                    {mySubmission.revisions.map((revision) => (
                      <li key={revision.revisionIndex} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        النسخة {revision.revisionIndex} — {formatDate(revision.createdAt)}
                        {revision.note ? ` — ${revision.note}` : ""}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {mySubmission?.feedbackText ? (
            <Card title={mySubmission.status === "GRADED" ? "التقييم والتغذية الراجعة" : "ملاحظات الإعادة للتعديل"}>
              {mySubmission.status === "GRADED" ? (
                <p className="text-3xl font-bold text-emerald-600">
                  {mySubmission.scoreTotal}
                  <span className="text-sm font-medium text-slate-400"> / {assignment.totalPoints || 100}</span>
                </p>
              ) : (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  أُعيد التسليم إليك للتعديل — عدّل المحتوى ثم أعد التسليم قبل الموعد.
                </p>
              )}
              <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                {mySubmission.feedbackText}
              </p>
              {mySubmission.reviewedAt ? (
                <p className="mt-2 text-xs text-slate-400">آخر مراجعة: {formatDate(mySubmission.reviewedAt)}</p>
              ) : null}
            </Card>
          ) : mySubmission && ["SUBMITTED", "UNDER_REVIEW"].includes(mySubmission.status) ? (
            <Card title="حالة المراجعة">
              <p className="text-sm text-slate-600">
                {mySubmission.status === "UNDER_REVIEW"
                  ? "تسليمك قيد المراجعة الآن من المشرف التربوي."
                  : "تسليمك مستلم — بانتظار بدء المراجعة."}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                سيظهر التقييم والتغذية الراجعة هنا بعد اعتمادهما.
              </p>
            </Card>
          ) : null}

          {mySubmission && mySubmission.files.length > 0 && !mySubmission.canEdit ? (
            <Card title={`مرفقاتك (${mySubmission.files.length})`}>
              <ul className="divide-y divide-slate-100">
                {mySubmission.files.map((file) => (
                  <li key={file.id} className="flex items-center justify-between py-2 text-sm">
                    <a
                      href={`/api/assignment-files/${file.id}`}
                      className="text-slate-700 hover:text-[#1D5BD6] hover:underline"
                    >
                      {file.fileName}
                    </a>
                    <span className="text-xs text-slate-400">{formatBytes(file.sizeBytes)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {mySubmission?.canEdit || !mySubmission ? (
            <Card title={mySubmission ? "تعديل التسليم" : "تسليم العمل"}>
              {result.data.windowState === "closed" ? (
                <p className="text-sm text-slate-500">{windowLabel}</p>
              ) : (
                <SubmissionWorkspace
                  assignmentId={assignment.id}
                  initialText={mySubmission?.responseText ?? ""}
                  files={(mySubmission?.files ?? []).map((file) => ({
                    id: file.id,
                    fileName: file.fileName,
                    sizeLabel: formatBytes(file.sizeBytes),
                  })) satisfies SubmissionFileView[]}
                  canEdit={mySubmission?.canEdit ?? true}
                  windowLabel={windowLabel}
                />
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
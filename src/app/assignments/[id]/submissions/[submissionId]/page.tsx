/**
 * Phase 7 — "مراجعة التسليمات / التقييم والملاحظات": the supervisor's
 * full view of one submission — response text, attachments, rubric,
 * revision history and the grading panel.
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { canReviewSubmissions, type AssignmentActor } from "@/lib/assignments/access";
import { getSubmissionForReview } from "@/lib/assignments/service";
import {
  AccessDenied,
  Card,
  SubmissionStatusBadge,
  formatBytes,
  formatDate,
} from "@/app/assignments/ui";
import { ReviewActions } from "@/app/assignments/[id]/submissions/[submissionId]/review-actions";

export const dynamic = "force-dynamic";

export default async function SubmissionReviewPage({
  params,
}: {
  params: Promise<{ id: string; submissionId: string }>;
}) {
  const { id, submissionId } = await params;
  const user = await getCurrentUser();
  if (!user || !canReviewSubmissions(user.role) || !user.schoolId) {
    return <AccessDenied hint="مراجعة التسليمات متاحة للمشرفين التربويين ومديري مكاتب التطوير فقط." />;
  }
  // canReviewSubmissions narrows the runtime set to exactly these two
  // roles — the literal below keeps the union type intact for callers.
  const ctx: AssignmentActor =
    user.role === "DEVELOPMENT_OFFICE_MANAGER"
      ? { id: user.id, role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: user.schoolId }
      : { id: user.id, role: "EDUCATIONAL_SUPERVISOR", schoolId: user.schoolId };

  const result = await getSubmissionForReview(ctx, submissionId);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <AccessDenied hint={result.message} />;
  }
  const { submission, assignment, teacher, criteria, rubricScores, files, revisions } = result.data;
  const scoreByCriterion = new Map(rubricScores.map((score) => [score.criterionId, score.points]));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">
            <Link href={`/assignments/${id}/submissions`} className="text-[#1D5BD6] hover:underline">
              تسليمات التكليف
            </Link>{" "}
            / {assignment.titleAr}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">مراجعة تسليم: {teacher.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {teacher.email} — الفرع: {teacher.branchName ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SubmissionStatusBadge status={submission.status} />
          {submission.isLate ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              سُلِّم متأخرًا
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="نص التسليم">
            {submission.responseText && submission.responseText.trim().length > 0 ? (
              <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
                {submission.responseText}
              </p>
            ) : (
              <p className="text-sm text-slate-400">لا يوجد نص — التسليم بمرفقات فقط.</p>
            )}
            <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              أول تسليم: {formatDate(submission.submittedAt)} — آخر تحديث: {formatDate(submission.lastSubmittedAt)} — عدد مرات إعادة التسليم: {submission.resubmitCount}
            </div>
          </Card>

          <Card title={`المرفقات (${files.length})`}>
            {files.length === 0 ? (
              <p className="text-sm text-slate-400">لا توجد مرفقات.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {files.map((file) => (
                  <li key={file.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-slate-700">{file.fileName}</span>
                    <span className="flex items-center gap-3 text-xs text-slate-400">
                      {formatBytes(file.sizeBytes)} — {formatDate(file.createdAt)}
                      <a
                        href={`/api/assignment-files/${file.id}`}
                        className="font-medium text-[#1D5BD6] hover:underline"
                      >
                        تنزيل
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="سجل المراجعات السابقة">
            {revisions.length === 0 ? (
              <p className="text-sm text-slate-400">لا توجد نسخ سابقة — لم يُعَد التسليم للتعديل من قبل.</p>
            ) : (
              <ol className="space-y-3">
                {revisions.map((revision) => (
                  <li key={revision.revisionIndex} className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-medium text-slate-500">
                      النسخة {revision.revisionIndex} — {formatDate(revision.createdAt)} — {revision.note ?? ""}
                    </p>
                    {revision.responseText ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{revision.responseText}</p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">نسخة بمرفقات فقط.</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="التقييم والملاحظات">
            <ReviewActions
              submissionId={submission.id}
              assignmentId={assignment.id}
              status={submission.status}
              criteria={criteria}
              existingScores={rubricScores}
              existingFeedback={submission.feedbackText}
              hasRubric={assignment.hasRubric}
            />
          </Card>

          {criteria.length > 0 ? (
            <Card title="سلّم تقييم التكليف">
              <ul className="divide-y divide-slate-100 text-sm">
                {criteria.map((criterion) => {
                  const awarded = scoreByCriterion.get(criterion.id);
                  return (
                    <li key={criterion.id} className="flex items-center justify-between py-2.5">
                      <span className="text-slate-700">{criterion.titleAr}</span>
                      <span className="text-xs text-slate-500">
                        {awarded !== undefined ? (
                          <strong className="text-emerald-600">{awarded}</strong>
                        ) : (
                          "—"
                        )}{" "}
                        / {criterion.maxPoints}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                الاستحقاق: {formatDate(assignment.dueAt)}
                {assignment.allowLate ? " — القبول المتأخر مفعّل" : ""}
              </p>
            </Card>
          ) : null}

          {submission.status === "GRADED" ? (
            <Card title="النتيجة المعتمدة">
              <p className="text-3xl font-bold text-emerald-600">{submission.scoreTotal}</p>
              <p className="mt-1 text-xs text-slate-500">اعتمدت في {formatDate(submission.reviewedAt)}</p>
              {submission.feedbackText ? (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                  {submission.feedbackText}
                </p>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
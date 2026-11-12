"use client";

import Link from "next/link";
import { BarChart3, ClipboardCheck, GraduationCap, TrendingUp } from "lucide-react";

import type {
  SupervisorTrainingProgress,
  TrainingWorkspace,
} from "@/lib/supervision/training";

import { SectionCard } from "./unified-editor";

/* ------------------------------------------------------------------ */
/* Teacher participation & results — ONE section inside the training    */
/* workspace. Read-only aggregation over EXISTING models:               */
/*   • lesson progress  → CourseLessonProgress                          */
/*   • exam results     → AssessmentAttempt (best finalized + reviews)  */
/*   • essay grading    → NEEDS_REVIEW attempts → the existing review   */
/*     UI at /assessments/manage/[assessmentId]                         */
/*   • certificates     → Certificate (auto or manually issued)         */
/*   • impact           → SurveyResponse (identifiable submissions)     */
/* Nothing here mutates data — every row links to the existing page     */
/* that owns the mutation, so grading/issuing flows stay untouched.     */
/* ------------------------------------------------------------------ */

const dateFormatter = new Intl.DateTimeFormat("ar", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? "—" : dateFormatter.format(value);
}

function Chip({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-bold text-foreground">
      <span className="text-muted-foreground">{label}:</span>
      {value}
    </span>
  );
}

function ExamCell({
  row,
}: {
  row: SupervisorTrainingProgress["rows"][number];
}) {
  if (!row.exam) {
    return <span className="text-muted-foreground">—</span>;
  }
  const { bestPercentage, bestPassed, attemptsCount, needsReviewCount } = row.exam;
  if (bestPercentage === null && attemptsCount === 0 && needsReviewCount === 0) {
    return <span className="text-muted-foreground">لم يتقدم بعد</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {bestPercentage !== null ? (
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            bestPassed
              ? "bg-success-soft text-success"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {bestPercentage}%
        </span>
      ) : null}
      {attemptsCount > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {attemptsCount} {attemptsCount === 1 ? "محاولة" : "محاولات"}
        </span>
      )}
      {needsReviewCount > 0 && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
          مقالي بانتظار التصحيح
        </span>
      )}
    </span>
  );
}

export function TrainingProgressSection({
  courseId,
  workspace,
  progress,
}: {
  courseId: string;
  workspace: TrainingWorkspace;
  progress: SupervisorTrainingProgress | null;
}) {
  const rows = progress?.rows ?? [];
  const enrolledCount = workspace.enrollments.length;
  const completedCount = rows.filter((row) => row.completedAt).length;
  const pendingReviews = rows.reduce(
    (sum, row) => sum + (row.exam?.needsReviewCount ?? 0),
    0
  );
  const certificatesCount = rows.filter(
    (row) => row.certificate && row.certificate.status === "ISSUED"
  ).length;
  const impactCount = progress?.surveyResponsesCount ?? 0;

  return (
    <SectionCard
      icon={<BarChart3 className="size-4" aria-hidden="true" />}
      title="متابعة المعلمين والنتائج"
      description="مشاركة المعلمين وتقدمهم، نتائج الاختبار والدرجات، التصحيح اليدوي للمقالي، الشهادات، واستجابات قياس الأثر — كل ذلك من مكان واحد."
    >
      {enrolledCount === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-4 text-center text-[11px] text-muted-foreground">
          لا يوجد معلمون مسجلون بعد — أسند التدريب من القسم أعلاه أو سيجدونه
          في الأكاديمية بعد النشر.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip label="مسجلون" value={enrolledCount} />
            <Chip label="أتمّوا" value={completedCount} />
            {progress?.assessmentId && (
              <Chip label="بانتظار تصحيح مقالي" value={pendingReviews} />
            )}
            <Chip label="شهادات صادرة" value={certificatesCount} />
            {progress?.surveyId && (
              <Chip label="استجابات قياس الأثر" value={impactCount} />
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-right text-xs">
              <thead>
                <tr className="border-b text-[11px] text-muted-foreground">
                  <th className="px-2 py-2 font-bold">المعلم</th>
                  <th className="px-2 py-2 font-bold">إنجاز الدروس</th>
                  <th className="px-2 py-2 font-bold">الإكمال</th>
                  {progress?.assessmentId && (
                    <th className="px-2 py-2 font-bold">الاختبار</th>
                  )}
                  <th className="px-2 py-2 font-bold">الشهادة</th>
                  {progress?.surveyId && (
                    <th className="px-2 py-2 font-bold">قياس الأثر</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const done = row.lessonsDone;
                  const total = progress?.lessonsTotal ?? 0;
                  const percent =
                    total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
                  return (
                    <tr key={row.userId} className="border-b last:border-b-0">
                      <td className="px-2 py-2.5">
                        <p className="font-bold text-foreground">{row.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          مسجل {shortDate(row.enrolledAt)}
                        </p>
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-brand-600"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-muted-foreground">
                            {done}/{total}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5">
                        {row.completedAt ? (
                          <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-bold text-success">
                            أتمّ التدريب
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            جارٍ التعلّم
                          </span>
                        )}
                      </td>
                      {progress?.assessmentId && (
                        <td className="px-2 py-2.5">
                          <ExamCell row={row} />
                        </td>
                      )}
                      <td className="px-2 py-2.5">
                        {row.certificate ? (
                          <Link
                            href={`/certificates/${row.certificate.id}`}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              row.certificate.status === "ISSUED"
                                ? "bg-success-soft text-success hover:underline"
                                : "bg-muted text-muted-foreground hover:underline"
                            }`}
                            title={row.certificate.certificateNumber}
                          >
                            <GraduationCap className="size-3" aria-hidden="true" />
                            {row.certificate.status === "ISSUED"
                              ? "صادرة"
                              : "ملغاة"}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {progress?.surveyId && (
                        <td className="px-2 py-2.5">
                          {row.impactSubmittedAt ? (
                            <span className="text-[10px] font-bold text-success">
                              استجاب ✓ {shortDate(row.impactSubmittedAt)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Actionable links to the EXISTING management screens */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {progress?.assessmentId && (
              <Link
                href={`/assessments/manage/${progress.assessmentId}`}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[11px] font-bold text-brand-600 transition-colors hover:bg-accent"
              >
                <ClipboardCheck className="size-3.5" aria-hidden="true" />
                نتائج الاختبار وتصحيح المقالي
              </Link>
            )}
            {progress?.surveyId && (
              <Link
                href={`/surveys/${progress.surveyId}/results`}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-[11px] font-bold text-brand-600 transition-colors hover:bg-accent"
              >
                <TrendingUp className="size-3.5" aria-hidden="true" />
                نتائج قياس الأثر
              </Link>
            )}
          </div>

          {progress?.surveyId && progress.surveyAnonymous && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              أداة قياس الأثر مجهولة الهوية — لا يمكن ربط كل استجابة بمعلم
              بعينه؛ العدد الإجمالي ({progress.surveyResponsesCount}) والنتائج
              المجمعة متاحة من زر «نتائج قياس الأثر» أعلاه.
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}
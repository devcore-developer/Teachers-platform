import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  ClipboardCheck,
  Clock,
  ListChecks,
  Target,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/platform/empty-state";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { requireUser } from "@/lib/auth/session";
import {
  attemptStatusLabel,
  attemptStatusTone,
  attemptStatusTone as statusTone,
} from "@/config/assessment";
import {
  listDeputyResults,
  listMyAttempts,
  listPublishedAssessments,
  listSupervisorResults,
  type AssessmentResult,
  type ReadOnlyAttemptRow,
} from "@/lib/assessment/service";

export const metadata = {
  title: "الاختبارات والتقييم",
};

const dateFormatter = new Intl.DateTimeFormat("ar", { dateStyle: "medium" });

const AVAILABILITY_LABELS: Record<string, { label: string; tone: "success" | "info" | "neutral" }> = {
  available: { label: "متاح الآن", tone: "success" },
  scheduled: { label: "لم يبدأ بعد", tone: "info" },
  closed: { label: "انتهت الفترة", tone: "neutral" },
};

/**
 * Role-aware assessments hub:
 *   managers   -> redirected to the management directory
 *   teachers   -> published catalog + their own attempt history
 *   supervisor -> read-only results of their assigned teachers
 *   deputy     -> read-only results inside their granted scope
 */
export default async function AssessmentsPage() {
  const user = await requireUser();
  const viewer = { id: user.id, role: user.role, schoolId: user.schoolId };

  if (user.role === "SUPER_ADMIN" || user.role === "DEVELOPMENT_OFFICE_MANAGER") {
    redirect("/assessments/manage");
  }

  if (user.role === "EDUCATIONAL_SUPERVISOR" || user.role === "EDUCATIONAL_DEPUTY") {
    const result =
      user.role === "EDUCATIONAL_SUPERVISOR"
        ? await listSupervisorResults(viewer)
        : await listDeputyResults(viewer);
    return (
      <div>
        <PageHeader
          title="نتائج الاختبارات"
          description={
            user.role === "EDUCATIONAL_SUPERVISOR"
              ? "نتائج المعلمين المسندين إليك — اطلاع فقط داخل نطاقك."
              : "نتائج اختبارات المدارس الممنوحة لك — اطلاع فقط."
          }
          breadcrumbs={[{ label: "الاختبارات والتقييم" }]}
        />
        <ReadOnlyResults result={result} />
      </div>
    );
  }

  // TEACHER
  const [catalog, history] = await Promise.all([
    listPublishedAssessments(viewer, {}),
    listMyAttempts(viewer),
  ]);

  return (
    <div>
      <PageHeader
        title="الاختبارات والتقييم"
        description="الاختبارات المنشورة والمتاحة لك — اقرأ التعليمات، أدِ المحاولة، وتابع نتائجك."
        breadcrumbs={[{ label: "الاختبارات والتقييم" }]}
      />

      <div className="space-y-6">
        <SectionCard
          title="الاختبارات المتاحة"
          description="اختبارات منشورة على مستوى المنصة أو خاصة بمدرستك."
        >
          {!catalog.ok ? (
            <div role="alert" className="text-sm font-semibold text-destructive">
              {catalog.message}
            </div>
          ) : catalog.data.rows.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="لا توجد اختبارات متاحة حاليًا"
              description="ستظهر هنا الاختبارات فور نشرها لمدرستك أو للمنصة."
              className="border-0 bg-transparent"
            />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2" role="list">
              {catalog.data.rows.map((assessment) => {
                const availability = AVAILABILITY_LABELS[assessment.availability];
                return (
                  <li
                    key={assessment.id}
                    className="flex flex-col rounded-xl border bg-background/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold text-foreground">
                        {assessment.titleAr}
                      </h3>
                      <StatusBadge tone={availability.tone}>
                        {availability.label}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {assessment.courseTitle
                        ? `مرتبط بدورة: ${assessment.courseTitle}`
                        : "اختبار مستقل"}
                      {assessment.schoolName ? ` · ${assessment.schoolName}` : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-semibold text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <ListChecks className="size-3.5" aria-hidden="true" />
                        {assessment.questionsCount} سؤال
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Target className="size-3.5" aria-hidden="true" />
                        {assessment.maxScore} نقطة · نجاح {assessment.passingScore}
                      </span>
                      {assessment.timeLimitMinutes && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3.5" aria-hidden="true" />
                          {assessment.timeLimitMinutes} دقيقة
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {assessment.attemptLimit
                          ? `المحاولات: ${assessment.attemptsUsed}/${assessment.attemptLimit}`
                          : `محاولاتك السابقة: ${assessment.attemptsUsed}`}
                      </span>
                      {assessment.latestStatus ? (
                        <StatusBadge tone={attemptStatusTone(assessment.latestStatus)}>
                          {attemptStatusLabel(assessment.latestStatus)}
                        </StatusBadge>
                      ) : null}
                      <Link
                        href={`/assessments/${assessment.id}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700"
                      >
                        التفاصيل والبدء
                        <ArrowLeft className="size-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="سجل محاولاتي"
          description="كل محاولاتك عبر الاختبارات — بحالتها الحقيقية."
        >
          {!history.ok ? (
            <div role="alert" className="text-sm font-semibold text-destructive">
              {history.message}
            </div>
          ) : history.data.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="لم تبدأ أي محاولة بعد"
              description="عند أداء أي اختبار ستظهر محاولاتك ونتائجها هنا."
              className="border-0 bg-transparent"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-start font-bold">الاختبار</th>
                    <th className="px-4 py-3 text-start font-bold">الحالة</th>
                    <th className="px-4 py-3 text-start font-bold">النتيجة</th>
                    <th className="px-4 py-3 text-start font-bold">تاريخ التسليم</th>
                    <th className="px-4 py-3 text-start font-bold" aria-label="إجراءات" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.data.map((attempt) => (
                    <tr key={attempt.id} className="transition-colors hover:bg-muted/20">
                      <td className="px-4 py-3 text-sm font-bold">
                        {attempt.assessmentTitle}
                      </td>
                      <td>
                        <StatusBadge tone={statusTone(attempt.status)}>
                          {attemptStatusLabel(attempt.status)}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {attempt.status === "IN_PROGRESS"
                          ? "—"
                          : attempt.earnedScore === null
                            ? "بانتظار المراجعة"
                            : `${attempt.earnedScore}/${attempt.maxScore} (${attempt.percentage}%)`}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {attempt.submittedAt
                          ? dateFormatter.format(attempt.submittedAt)
                          : "—"}
                      </td>
                      <td>
                        {attempt.status === "IN_PROGRESS" ? (
                          <Link
                            href={`/assessments/${attempt.assessmentId}/take`}
                            className="rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700"
                          >
                            متابعة المحاولة
                          </Link>
                        ) : (
                          <Link
                            href={`/assessments/attempts/${attempt.id}`}
                            className="rounded-lg border px-2.5 py-1.5 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-50"
                          >
                            عرض النتيجة
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* --------------------- Read-only results list ---------------------- */

function ReadOnlyResults({
  result,
}: {
  result: AssessmentResult<ReadOnlyAttemptRow[]>;
}) {
  if (!result.ok) {
    return (
      <div role="alert" className="text-sm font-semibold text-destructive">
        {result.message}
      </div>
    );
  }
  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="لا توجد نتائج في نطاقك بعد"
        description="ستظهر نتائج المحاولات المكتملة هنا فور تسليمها."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-4 py-3 text-start font-bold">المعلم</th>
              <th className="px-4 py-3 text-start font-bold">الاختبار</th>
              <th className="px-4 py-3 text-start font-bold">الحالة</th>
              <th className="px-4 py-3 text-start font-bold">النتيجة</th>
              <th className="px-4 py-3 text-start font-bold">التسليم</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.data.map((attempt) => (
              <tr key={attempt.id} className="transition-colors hover:bg-muted/20">
                <td className="px-4 py-3 text-sm font-bold">{attempt.teacherName}</td>
                <td className="px-4 py-3 text-xs">{attempt.assessmentTitle}</td>
                <td>
                  <StatusBadge tone={attemptStatusTone(attempt.status)}>
                    {attemptStatusLabel(attempt.status)}
                  </StatusBadge>
                </td>
                <td className="px-4 py-3 text-xs tabular-nums">
                  {attempt.earnedScore === null
                    ? "—"
                    : `${attempt.earnedScore}/${attempt.maxScore} (${attempt.percentage}%)`}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {attempt.submittedAt ? dateFormatter.format(attempt.submittedAt) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
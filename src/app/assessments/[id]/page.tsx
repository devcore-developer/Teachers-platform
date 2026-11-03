import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  Clock,
  ListChecks,
  PlayCircle,
  Target,
} from "lucide-react";

import { startAttemptAction } from "@/app/actions/assessment";
import { PageHeader } from "@/components/layout/page-header";
import { SubmitButton } from "@/components/platform/submit-button";
import { StatusBadge } from "@/components/platform/status-badge";
import { requireUser } from "@/lib/auth/session";
import { attemptStatusLabel, attemptStatusTone } from "@/config/assessment";
import { getAssessmentForTaking } from "@/lib/assessment/service";

export const metadata = {
  title: "تفاصيل الاختبار",
};

const dateFormatter = new Intl.DateTimeFormat("ar", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Teacher-facing assessment detail: instructions, eligibility and
 * availability states, and the start/resume action. All eligibility
 * rules re-run on the server inside startAttempt — this page only
 * renders honest states.
 */
export default async function AssessmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const startError =
    typeof sp.error === "string" && sp.error.length > 0 ? sp.error : null;

  const result = await getAssessmentForTaking(
    { id: user.id, role: user.role, schoolId: user.schoolId },
    id
  );
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm font-semibold text-destructive"
      >
        {result.message}
      </div>
    );
  }

  const { assessment, enrollmentRequired, enrolled, attemptsUsed, remainingAttempts, activeAttempt } =
    result.data;

  const isTeacher = user.role === "TEACHER";
  const availability = assessment.availability;
  const enrollmentBlocked = enrollmentRequired && !enrolled;
  const attemptsExhausted =
    remainingAttempts !== null && remainingAttempts <= 0 && !activeAttempt;
  const canStart =
    isTeacher && availability === "available" && !enrollmentBlocked && !attemptsExhausted;

  return (
    <div>
      <PageHeader
        title={assessment.titleAr}
        description={assessment.titleEn ?? undefined}
        breadcrumbs={[
          { label: "الاختبارات والتقييم", href: "/assessments" },
          { label: assessment.titleAr },
        ]}
        meta={
          <>
            <StatusBadge
              tone={
                availability === "available"
                  ? "success"
                  : availability === "scheduled"
                    ? "info"
                    : "neutral"
              }
            >
              {availability === "available"
                ? "متاح الآن"
                : availability === "scheduled"
                  ? "لم يبدأ بعد"
                  : "انتهت الفترة"}
            </StatusBadge>
            {assessment.schoolName && (
              <span className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">
                {assessment.schoolName}
              </span>
            )}
          </>
        }
      />

      <div className="space-y-6">
        {startError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-semibold text-destructive"
          >
            <AlertTriangle className="size-4" aria-hidden="true" />
            {startError}
          </div>
        )}

        {/* Facts grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-card p-3.5">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <ListChecks className="size-3.5" aria-hidden="true" />
              الأسئلة
            </span>
            <span className="mt-1 block text-xl font-extrabold tabular-nums">
              {assessment.questionsCount}
            </span>
          </div>
          <div className="rounded-xl border bg-card p-3.5">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <Target className="size-3.5" aria-hidden="true" />
              الدرجات
            </span>
            <span className="mt-1 block text-sm font-extrabold tabular-nums">
              {assessment.maxScore} نقطة · نجاح {assessment.passingScore}
            </span>
          </div>
          <div className="rounded-xl border bg-card p-3.5">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <Clock className="size-3.5" aria-hidden="true" />
              المدة
            </span>
            <span className="mt-1 block text-sm font-extrabold">
              {assessment.timeLimitMinutes
                ? `${assessment.timeLimitMinutes} دقيقة`
                : "غير مؤقت"}
            </span>
          </div>
          <div className="rounded-xl border bg-card p-3.5">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              المحاولات
            </span>
            <span className="mt-1 block text-sm font-extrabold tabular-nums">
              {assessment.attemptLimit
                ? `${attemptsUsed}/${assessment.attemptLimit}`
                : attemptsUsed}
            </span>
          </div>
        </div>

        {/* Course binding / eligibility */}
        {enrollmentRequired && (
          <div
            className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
              enrolled
                ? "border-success/30 bg-success-soft text-success"
                : "border-warning/40 bg-warning-soft text-warning"
            }`}
          >
            <BookOpen className="size-4" aria-hidden="true" />
            {enrolled
              ? `مرتبط بدورة: ${assessment.courseTitle ?? ""} — أنت مسجل فيها.`
              : `هذا الاختبار مرتبط بدورة تدريبية (${assessment.courseTitle ?? ""}) — سجّل في الدورة أولًا ثم عد لهذه الصفحة.`}
            {!enrolled && (
              <Link
                href="/academy"
                className="ms-auto rounded-lg border bg-card px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50"
              >
                الذهاب إلى الأكاديمية
              </Link>
            )}
          </div>
        )}

        {/* Availability / attempts states */}
        {availability === "scheduled" && assessment.availableFrom && (
          <div className="rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm font-semibold text-info">
            يبدأ توافر هذا الاختبار في: {dateFormatter.format(assessment.availableFrom)}
          </div>
        )}
        {availability === "closed" && assessment.availableUntil && (
          <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm font-semibold text-muted-foreground">
            انتهت فترة التوافر في: {dateFormatter.format(assessment.availableUntil)}
          </div>
        )}
        {attemptsExhausted && (
          <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm font-semibold text-muted-foreground">
            استهلكت كل المحاولات المسموحة ({assessment.attemptLimit}) — لا توجد محاولات متبقية.
          </div>
        )}

        {/* Instructions */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-base font-bold text-foreground">تعليمات الاختبار</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {assessment.instructionsAr}
          </p>
          {assessment.instructionsEn && (
            <p
              className="mt-3 whitespace-pre-wrap border-t pt-3 text-xs leading-relaxed text-muted-foreground"
              dir="ltr"
            >
              {assessment.instructionsEn}
            </p>
          )}
        </div>

        {/* Active attempt / start */}
        {activeAttempt ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3.5">
            <div>
              <p className="text-sm font-bold text-brand-800">
                لديك محاولة قيد التنفيذ — يمكن متابعتها حتى انتهاء الوقت.
              </p>
              {activeAttempt.deadlineAt && (
                <p className="text-xs font-semibold text-brand-700">
                  المهلة تنتهي: {dateFormatter.format(activeAttempt.deadlineAt)}
                </p>
              )}
            </div>
            {isTeacher && (
              <form action={startAttemptAction}>
                <input type="hidden" name="assessmentId" value={assessment.id} />
                <SubmitButton className="bg-brand-600 text-white hover:bg-brand-700">
                  <PlayCircle className="size-4" aria-hidden="true" />
                  متابعة المحاولة
                </SubmitButton>
              </form>
            )}
          </div>
        ) : canStart ? (
          <form action={startAttemptAction} className="flex justify-end">
            <input type="hidden" name="assessmentId" value={assessment.id} />
            <SubmitButton className="bg-brand-600 text-white hover:bg-brand-700">
              <PlayCircle className="size-4" aria-hidden="true" />
              {remainingAttempts === null
                ? "بدء المحاولة"
                : `بدء المحاولة (المتبقي ${remainingAttempts})`}
            </SubmitButton>
          </form>
        ) : null}

        {!isTeacher && availability === "available" && !enrollmentBlocked && (
          <p className="text-xs text-muted-foreground">
            أداء الاختبارات متاح لحسابات المعلمين — دورك الحالي يتيح الاطلاع فقط.
          </p>
        )}

        <div>
          <Link
            href="/assessments"
            className="text-xs font-bold text-brand-700 hover:underline"
          >
            العودة إلى قائمة الاختبارات
          </Link>
        </div>
      </div>
    </div>
  );
}
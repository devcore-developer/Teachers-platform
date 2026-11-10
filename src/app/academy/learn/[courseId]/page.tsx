import { requireUser } from "@/lib/auth/session";
import { getCourseForViewer } from "@/lib/training/service";
import { getCourseLearningStatus } from "@/lib/training/progress";
import { computeCourseJourney } from "@/lib/training/journey";
import { computeSequentialLocks } from "@/lib/training/sequence";
import { getMyImpactStatus } from "@/lib/surveys/impact";
import { listCourseComments } from "@/lib/comments/service";
import { AccessDenied } from "@/app/assignments/ui";
import { LessonChecklist, type ChecklistLesson } from "./lesson-checklist";
import { ImpactForm } from "./impact-form";
import { CourseComments } from "./course-comments";
import { JourneyStepper } from "./journey-stepper";

/**
 * Batch 1 + Mandatory journey — صفحة التعلّم (course learning hub).
 *
 * The teacher's single page for the whole journey — the Next.js
 * equivalent of the original HTML training player (openTraining +
 * v11 player + test gating + certificate + impact measurement):
 *   - the four-stage MANDATORY journey stepper (content -> exam ->
 *     certificate -> impact), computed by the server journey service;
 *     the exam runs INSIDE the journey — there is no separate exams
 *     section anywhere else,
 *   - published lessons with per-lesson completion state,
 *   - mandatory sequential unlocking + mandatory video playback
 *     (server-enforced; the UI only mirrors the server decision),
 *   - progress bar + completion card with the auto-issued certificate,
 *   - impact measurement form (after completion) + course wall comments.
 */
export const dynamic = "force-dynamic";

const LESSON_TYPE_LABELS: Record<string, string> = {
  VIDEO: "فيديو",
  EXTERNAL_VIDEO: "فيديو خارجي",
  RESOURCE: "مصدر تعلّم",
  TEXT: "نص",
};

export default async function CourseLearnPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const user = await requireUser();
  const viewer = { id: user.id, role: user.role, schoolId: user.schoolId };
  const { courseId } = await params;

  const [viewResult, statusResult, impactResult, commentsResult, journeyResult] =
    await Promise.all([
      getCourseForViewer(viewer, courseId),
      getCourseLearningStatus(viewer, courseId),
      getMyImpactStatus(viewer, courseId),
      listCourseComments(viewer, courseId),
      computeCourseJourney(viewer, courseId),
    ]);

  if (!viewResult.ok) {
    return <AccessDenied hint={viewResult.message ?? "هذه الدورة غير متاحة لك"} />;
  }
  const view = viewResult.data;
  const status = statusResult.ok ? statusResult.data! : null;
  const impact = impactResult.ok ? impactResult.data : null;
  const comments = commentsResult.ok ? commentsResult.data : null;
  const journey = journeyResult.ok ? journeyResult.data : null;

  const completion = status?.completion ?? null;
  const isTeacher = user.role === "TEACHER";
  const threshold = status?.lessonCompletionThreshold ?? 95;

  // Mandatory sequential unlocking — computed on the SERVER from the
  // completion ledger; the checklist only renders the verdict.
  const orderedLessons = view.sections.flatMap((section) =>
    section.lessons.map((lesson) => ({ id: lesson.id, titleAr: lesson.titleAr }))
  );
  const enforceSequence = isTeacher && (status?.requireSequentialLessons ?? true);
  const locks = computeSequentialLocks(
    orderedLessons,
    status?.completedLessonIds ?? [],
    enforceSequence
  );
  const watchByLesson = new Map(
    (status?.watchStates ?? []).map((row) => [row.lessonId, row])
  );

  const buildChecklistLesson = (
    lesson: (typeof view.sections)[number]["lessons"][number]
  ): ChecklistLesson => {
    const lock = locks.get(lesson.id);
    const watch = watchByLesson.get(lesson.id);
    return {
      id: lesson.id,
      titleAr: lesson.titleAr,
      type: lesson.type,
      typeLabel: LESSON_TYPE_LABELS[lesson.type] ?? lesson.type,
      description: lesson.description,
      content: lesson.content,
      videoUrl: lesson.videoUrl,
      attachmentName: lesson.attachmentName,
      durationSeconds: null,
      locked: lock?.locked ?? false,
      lockedByTitle: lock?.lockedByTitle ?? null,
      current: lock?.current ?? false,
      watch: watch
        ? {
            lastPositionSeconds: watch.lastPositionSeconds,
            maxPositionSeconds: watch.maxPositionSeconds,
            watchSeconds: watch.watchSeconds,
          }
        : null,
    };
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      {/* Course header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {view.course.programName && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-[#1D5BD6]">
                  {view.course.programName}
                </span>
              )}
              <span>{view.course.category}</span>
              {view.course.level && <span>· {view.course.level}</span>}
              {view.course.estimatedHours !== null && (
                <span>· {view.course.estimatedHours} ساعات</span>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-extrabold text-slate-900">
              {view.course.titleAr}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
              {view.course.descriptionAr}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {view.course.instructorName && <span>المدرب: {view.course.instructorName}</span>}
              {view.course.schoolName && <span>المدرسة: {view.course.schoolName}</span>}
            </div>
          </div>

          {/* Progress ring / completion badge */}
          <div className="w-full max-w-56 shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
            {completion ? (
              <>
                <p className="text-3xl" aria-hidden="true">🏁</p>
                <p className="mt-1 text-sm font-extrabold text-emerald-700">دورة مكتملة</p>
                <p className="mt-1 text-xs text-slate-500">
                  {completion.hours ? `${completion.hours} ساعات تدريبية` : "أحسنت!"}
                </p>
                {completion.certificateId && (
                  <a
                    href={`/certificates/${completion.certificateId}`}
                    className="mt-3 inline-block rounded-lg bg-[#1D5BD6] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#174aa8]"
                  >
                    عرض الشهادة
                  </a>
                )}
              </>
            ) : (
              <>
                <p className="text-2xl font-extrabold text-[#1D5BD6]">
                  {status?.lessonsPercent ?? 0}%
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-600">تقدمك في الدروس</p>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-[#1D5BD6] transition-all"
                    style={{ width: `${status?.lessonsPercent ?? 0}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {status ? `${status.completedLessons} من ${status.totalLessons} دروس` : "—"}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mandatory journey — the four-stage stepper (exam included here) */}
      {journey && <JourneyStepper journey={journey} />}

      {/* Mandatory learning notice */}
      {isTeacher && enforceSequence && !completion && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-relaxed text-[#1D5BD6]">
          <span className="font-extrabold">تعلّم تسلسلي إلزامي: </span>
          تُفتح الدروس بالترتيب بعد إكمال ما قبلها، ويُحتسب درس الفيديو منجزًا
          فقط بعد مشاهدة {threshold}% منه — بدون تخطٍ للأمام وبتشغيل سرعة 1x.
        </div>
      )}

      {/* Completion blocked note (certificate pending) */}
      {completion && !completion.certificateId && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          تم تسجيل إتمامك للدورة بنجاح. شهادتك تنتظر توقيع مدير المدرسة —
          سيتم إصدارها تلقائيًا بمجرد توفّر الموقّع، أو يمكنك متابعة إدارة الشهادات.
        </div>
      )}

      {/* Lessons */}
      <div id="lessons" className="mt-6 space-y-5">
        {view.sections.map((section) => (
          <section key={section.id} className="rounded-xl border border-slate-200 bg-white">
            <header className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-extrabold text-slate-800">{section.titleAr}</h2>
              {section.description && (
                <p className="mt-0.5 text-xs text-slate-500">{section.description}</p>
              )}
            </header>
            <LessonChecklist
              courseId={courseId}
              isTeacher={isTeacher}
              thresholdPercent={threshold}
              completedIds={status?.completedLessonIds ?? []}
              lessons={section.lessons.map(buildChecklistLesson)}
            />
          </section>
        ))}
        {view.publishedLessonsCount === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            لا توجد دروس منشورة في هذه الدورة بعد.
          </div>
        )}
      </div>

      {/* Impact measurement — journey stage 4 (unlocked after completion) */}
      {impact?.available && impact.survey && (
        <section
          id="impact"
          className="mt-6 rounded-xl border border-slate-200 bg-white p-5"
        >
          <h2 className="text-sm font-extrabold text-slate-800">
            قياس أثر التدريب — المرحلة الرابعة
          </h2>
          {impact.survey.purposeAr && (
            <p className="mt-1 text-xs text-slate-500">{impact.survey.purposeAr}</p>
          )}
          {impact.submitted ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              شكرًا لمساهمتك — تم استلام استجابتك. يمكنك تعديل إجاباتك بإعادة الإرسال.
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              شاركنا تجربتك بعد التطبيق — إجاباتك تساعد في تحسين التدريبات القادمة.
            </p>
          )}
          <ImpactForm
            courseId={courseId}
            surveyTitle={impact.survey.titleAr}
            instructions={impact.survey.instructionsAr}
            questions={impact.survey.questions}
          />
        </section>
      )}

      {/* Course wall */}
      <section className="mt-6">
        <CourseComments
          courseId={courseId}
          initialComments={comments?.rows ?? []}
          canComment={true}
        />
      </section>
    </div>
  );
}
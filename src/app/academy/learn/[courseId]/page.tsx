import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { getCourseForViewer } from "@/lib/training/service";
import { getCourseLearningStatus } from "@/lib/training/progress";
import { getMyImpactStatus } from "@/lib/surveys/impact";
import { listCourseComments } from "@/lib/comments/service";
import { AccessDenied } from "@/app/assignments/ui";
import { LessonChecklist } from "./lesson-checklist";
import { ImpactForm } from "./impact-form";
import { CourseComments } from "./course-comments";

/**
 * Batch 1 — صفحة التعلّم (course learning hub).
 *
 * The teacher's single page for the whole journey — the Next.js
 * equivalent of the original HTML training player (openTraining +
 * v11 player + test gating + certificate + impact measurement):
 *   - published lessons with per-lesson completion toggles,
 *   - progress bar + exam gate state (locked until lessons are done),
 *   - completion card with the auto-issued certificate link,
 *   - impact measurement form (after completion),
 *   - course wall comments.
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

  const [viewResult, statusResult, impactResult, commentsResult] =
    await Promise.all([
      getCourseForViewer(viewer, courseId),
      getCourseLearningStatus(viewer, courseId),
      getMyImpactStatus(viewer, courseId),
      listCourseComments(viewer, courseId),
    ]);

  if (!viewResult.ok) {
    return <AccessDenied hint={viewResult.message ?? "هذه الدورة غير متاحة لك"} />;
  }
  const view = viewResult.data;
  const status = statusResult.ok ? statusResult.data! : null;
  const impact = impactResult.ok ? impactResult.data : null;
  const comments = commentsResult.ok ? commentsResult.data : null;

  const completion = status?.completion ?? null;
  const isTeacher = user.role === "TEACHER";

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
                  <Link
                    href={`/certificates/${completion.certificateId}`}
                    className="mt-3 inline-block rounded-lg bg-[#1D5BD6] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#174aa8]"
                  >
                    عرض الشهادة
                  </Link>
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

      {/* Completion blocked note (certificate pending) */}
      {completion && !completion.certificateId && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          تم تسجيل إتمامك للدورة بنجاح. شهادتك تنتظر توقيع مدير المدرسة —
          سيتم إصدارها تلقائيًا بمجرد توفّر الموقّع، أو يمكنك متابعة إدارة الشهادات.
        </div>
      )}

      {/* Lessons */}
      <div className="mt-6 space-y-5">
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
              completedIds={status?.completedLessonIds ?? []}
              lessons={section.lessons.map((lesson) => ({
                id: lesson.id,
                titleAr: lesson.titleAr,
                type: lesson.type,
                typeLabel: LESSON_TYPE_LABELS[lesson.type] ?? lesson.type,
                description: lesson.description,
                content: lesson.content,
                videoUrl: lesson.videoUrl,
                attachmentName: lesson.attachmentName,
              }))}
            />
          </section>
        ))}
        {view.publishedLessonsCount === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            لا توجد دروس منشورة في هذه الدورة بعد.
          </div>
        )}
      </div>

      {/* Assessments + exam gate */}
      {status && status.assessments.length > 0 && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-extrabold text-slate-800">تقييمات الدورة</h2>
          <p className="mt-1 text-xs text-slate-500">
            يُفتح الاختبار بعد إكمال جميع دروس الدورة — نفس آلية المنصة الأصلية.
          </p>
          <ul className="mt-4 space-y-3">
            {status.assessments.map((assessment) => {
              const gateLocked = isTeacher && !completion && (status.totalLessons > 0 ? status.completedLessons < status.totalLessons : false);
              return (
                <li
                  key={assessment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800">{assessment.titleAr}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      درجة النجاح: {assessment.passingScore}/{assessment.maxScore}
                      {assessment.attemptLimit !== null &&
                        ` · المحاولات: ${assessment.attemptsUsed}/${assessment.attemptLimit}`}
                    </p>
                  </div>
                  {assessment.passed ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                      مجتاز {assessment.bestPercentage !== null ? `— ${assessment.bestPercentage}%` : ""}
                    </span>
                  ) : gateLocked ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                      مقفل — أكمل الدروس أولًا
                    </span>
                  ) : (
                    <Link
                      href="/assessments"
                      className="rounded-lg bg-[#1D5BD6] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#174aa8]"
                    >
                      اذهب إلى الاختبارات
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Impact measurement */}
      {impact?.available && impact.survey && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-extrabold text-slate-800">
            قياس أثر التدريب
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
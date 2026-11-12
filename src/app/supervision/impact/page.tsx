import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { ImpactCreateForm, ImpactSurveyActions } from "@/app/supervision/impact/impact-manager";
import {
  EmptyHint,
  Panel,
  Pill,
  formatDate,
  statusLabel,
  statusTone,
} from "@/app/supervision/supervisor-ui";
import { getImpactResults } from "@/lib/surveys/impact";
import {
  listSupervisorImpactCourseOptions,
  listSupervisorImpactSurveys,
  requireSupervisorContext,
} from "@/lib/supervision/training";

export const metadata = { title: "قياس الأثر التدريبي" };

/**
 * Supervisor impact workspace: author after-training impact tools for
 * their courses (reuse of the Survey models the teacher-facing flow
 * already consumes), monitor submissions, and view per-course results
 * served by the existing impact service.
 */
export default async function SupervisorImpactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSupervisorContext();
  const flat = Object.fromEntries(
    Object.entries(await searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? (value[0] ?? "") : (value ?? ""),
    ])
  );
  const selectedCourseId = flat.course && flat.course.trim() ? flat.course.trim() : null;

  const [surveys, courseOptions, results] = await Promise.all([
    listSupervisorImpactSurveys(ctx),
    listSupervisorImpactCourseOptions(ctx),
    selectedCourseId
      ? getImpactResults({ id: ctx.id, role: ctx.role, schoolId: ctx.schoolId }, selectedCourseId)
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      {/* Navigation moved into each training's workspace — this legacy
          route stays reachable by URL with its guards untouched. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-600/30 bg-brand-600/[0.04] px-4 py-3 text-[11px] leading-relaxed text-foreground">
        <span className="font-bold">ملاحظة:</span>
        <span>
          إعداد قياس الأثر أصبح داخل مساحة كل تدريب نفسها — افتح التدريب من
        </span>
        <Link
          href="/academy"
          className="font-bold text-brand-600 hover:underline"
        >
          الأكاديمية التدريبية
        </Link>
        <span>أو من</span>
        <Link
          href="/supervision/training"
          className="font-bold text-brand-600 hover:underline"
        >
          إدارة التدريب
        </Link>
        <span>— وهذه الصفحة تبقى متاحة للرجوع السريع.</span>
      </div>
      <header>
        <h1 className="text-xl font-black text-foreground">قياس الأثر التدريبي</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          أنشئ أدوات قياس أثر ما بعد التدريب لدورات مدرستك، وانشرها لمعلميك، ثم
          تابع الاستجابات والنتائج والمتوسطات — كلها من قاعدة البيانات.
        </p>
      </header>

      <ImpactCreateForm
        courses={courseOptions.map((course) => ({ id: course.id, titleAr: course.titleAr }))}
      />

      <Panel
        title={`أدوات القياس (${surveys.length})`}
        description="أدوات أثر دورات مدرستك — النشر يفتحها لمعلميك من داخل الدورة."
      >
        {surveys.length === 0 ? (
          <EmptyHint
            title="لا أدوات قياس بعد"
            description="أنشئ أول أداة من النموذج أعلاه واربطها بدورة."
          />
        ) : (
          <ul className="space-y-2">
            {surveys.map((survey) => (
              <li
                key={survey.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-foreground">{survey.titleAr}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {survey.courseTitleAr ?? "بدون دورة"} · {survey.questionsCount} سؤالًا ·{" "}
                    {survey.responsesCount} استجابة
                    {survey.publishedAt ? ` · نُشرت ${formatDate(survey.publishedAt)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={statusTone(survey.status)}>{statusLabel(survey.status)}</Pill>
                  {survey.courseId && (
                    <a
                      href={`/supervision/impact?course=${survey.courseId}`}
                      className="rounded-lg border bg-card px-2.5 py-1 text-[11px] font-bold text-brand-600 hover:bg-accent"
                    >
                      النتائج
                    </a>
                  )}
                  <ImpactSurveyActions surveyId={survey.id} status={survey.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {selectedCourseId && (
        <Panel
          title="نتائج الأثر للدورة المحددة"
          description="توزيع الإجابات ومتوسطات التقييم لكل سؤال."
        >
          {!results || !results.ok ? (
            <EmptyHint
              title="لا نتائج متاحة"
              description={results && !results.ok ? results.message : "لا توجد أداة منشورة لهذه الدورة."}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-brand-600/10 px-2.5 py-1 font-bold text-brand-600">
                  {results.data.responsesCount} استجابة
                </span>
                {results.data.overallAverage !== null && (
                  <span className="rounded-full bg-success-soft px-2.5 py-1 font-bold text-success">
                    المتوسط العام {results.data.overallAverage} / 5
                  </span>
                )}
              </div>
              <ul className="space-y-3">
                {results.data.questions.map((question) => (
                  <li key={question.questionId} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 text-xs font-bold text-foreground">
                        {question.textAr}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {question.responses} إجابة
                      </span>
                    </div>
                    {question.average !== null && (
                      <p className="mt-1 text-[11px] font-bold text-success">
                        المتوسط: {question.average}
                      </p>
                    )}
                    {question.distribution && question.distribution.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {question.distribution.map((bucket) => {
                          const percent =
                            question.responses > 0
                              ? Math.round((bucket.count / question.responses) * 100)
                              : 0;
                          return (
                            <div key={bucket.label} className="flex items-center gap-2">
                              <span className="w-16 shrink-0 text-[10px] text-muted-foreground">
                                {bucket.label}
                              </span>
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full rounded-full bg-brand-600"
                                  style={{ width: `${percent}%` }}
                                />
                              </span>
                              <span className="w-10 shrink-0 text-end text-[10px] tabular-nums text-muted-foreground">
                                {bucket.count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {question.texts && question.texts.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {question.texts.slice(0, 5).map((item, index) => (
                          <li
                            key={index}
                            className="rounded-lg bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground"
                          >
                            <span className="font-bold text-foreground">{item.name}:</span>{" "}
                            «{item.text}»
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ClipboardList className="size-3.5 shrink-0" aria-hidden="true" />
        يجيب المعلمون عن أدوات الأثر من صفحة الدورة نفسها — نفس مسار قياس الأثر
        الموجود، دون أي تغيير على تدفق المعلمين.
      </p>
    </div>
  );
}
"use client";

import Link from "next/link";
import {
  Award,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  ClipboardList,
  TrendingUp,
} from "lucide-react";

import type { TeacherGrowthProjection } from "@/lib/growth/service";
import {
  EligibilityBadge,
  GrowthProgressBar,
  LevelBadge,
} from "@/app/growth/ui";

/* ------------------------------------------------------------------ */
/* Batch 2 (part 2/2) — the teacher growth projection (client).        */
/*                                                                     */
/* Renders ONE teacher's complete growth projection from the service   */
/* payload: ladder position, the 60% gate, the 35-hour annual target,  */
/* and every real learning artifact (courses, assessments,             */
/* assignments, certificates). All data is server-computed; this       */
/* component only presents it.                                         */
/* ------------------------------------------------------------------ */

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(
      new Date(value)
    );
  } catch {
    return "—";
  }
}

function SectionTitle({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof BookOpen;
  title: string;
  count: number;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-black">
        <Icon className="size-4 text-brand-600" aria-hidden />
        {title}
      </h3>
      <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
        {count}
      </span>
    </div>
  );
}

const SUBMISSION_LABELS: Record<string, string> = {
  DRAFT: "مسودة",
  SUBMITTED: "مُسلَّم — بانتظار المراجعة",
  UNDER_REVIEW: "قيد المراجعة",
  RETURNED: "أُعيد للتعديل",
  GRADED: "مُقيَّم",
};

export function GrowthProjection({ data }: { data: TeacherGrowthProjection }) {
  const completedCourses = data.courses.filter((course) => course.completed);

  return (
    <div className="space-y-6">
      {/* ---------------------------- gate ---------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-xs font-medium text-muted-foreground">التصنيف الحالي</p>
          <div className="mt-2">
            <LevelBadge level={data.currentLevel} />
          </div>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-xs font-medium text-muted-foreground">التصنيف التالي</p>
          <div className="mt-2">
            {data.nextLevel ? (
              <LevelBadge level={data.nextLevel} tone="next" />
            ) : (
              <span className="text-xs font-bold text-muted-foreground">
                أعلى مستوى — T5 باحث تربوي 🏅
              </span>
            )}
          </div>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-xs font-medium text-muted-foreground">الساعات هذا العام</p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {data.hoursCompleted}
            <span className="text-sm font-bold text-muted-foreground">
              {" "}
              / {data.hoursTarget} ساعة
            </span>
          </p>
          <div className="mt-2">
            <GrowthProgressBar percent={data.hoursPercent} threshold={100} />
          </div>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-xs font-medium text-muted-foreground">
            شرط الانتقال (60% من الدورات)
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {data.coursesCompleted}
            <span className="text-sm font-bold text-muted-foreground">
              {" "}
              / {data.coursesAssigned} دورة
            </span>
          </p>
          <div className="mt-2">
            <GrowthProgressBar percent={data.completionPercentage} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-brand-50/60 p-4">
        <p className="text-sm font-bold text-brand-900">
          {data.nextLevel
            ? `للانتقال إلى ${data.nextLabel} يلزم إكمال 60% من الدورات المنشورة المتاحة — المكتمل الآن ${data.completionPercentage}%.`
            : "المعلم على أعلى مستوى في سلّم النمو المهني."}
        </p>
        <EligibilityBadge eligible={data.eligible} />
      </div>

      {/* --------------------------- courses --------------------------- */}
      <div className="rounded-xl border p-4">
        <SectionTitle icon={BookOpen} title="الدورات المنشورة المتاحة" count={data.courses.length} />
        {data.courses.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد دورات منشورة متاحة بعد.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.courses.map((course) => (
              <li key={course.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    <Link href={`/academy/learn/${course.id}`} className="hover:underline">
                      {course.titleAr}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {course.hours ? `${course.hours} ساعة تدريبية` : "ساعات غير محددة"}
                    {course.completedAt ? ` — أُكملت ${formatDate(course.completedAt)}` : ""}
                    {course.bestPercentage !== null ? ` — أفضل نتيجة ${course.bestPercentage}%` : ""}
                  </p>
                </div>
                {course.completed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    مكتملة
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                    <CircleDashed className="size-3.5" aria-hidden />
                    قيد التعلّم
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {completedCourses.length > 0 && (
          <p className="mt-3 text-xs font-bold text-muted-foreground">
            مكتمل: {completedCourses.length} من {data.courses.length} — نسبة الإنجاز{" "}
            {data.completionPercentage}%.
          </p>
        )}
      </div>

      {/* ------------------------- assessments ------------------------ */}
      <div className="rounded-xl border p-4">
        <SectionTitle icon={ClipboardCheck} title="الاختبارات" count={data.assessments.length} />
        {data.assessments.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد اختبارات متاحة بعد.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.assessments.map((assessment) => (
              <li key={assessment.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{assessment.titleAr}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    المحاولات: {assessment.attempts}
                    {assessment.lastAttemptAt ? ` — آخر محاولة ${formatDate(assessment.lastAttemptAt)}` : ""}
                  </p>
                </div>
                {assessment.passed ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                    ناجح{assessment.bestPercentage !== null ? ` — ${assessment.bestPercentage}%` : ""}
                  </span>
                ) : assessment.bestPercentage !== null ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                    {assessment.bestPercentage}%
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                    لم يُختبر بعد
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ------------------------- assignments ------------------------ */}
      <div className="rounded-xl border p-4">
        <SectionTitle icon={ClipboardList} title="التكليفات التربوية" count={data.assignments.length} />
        {data.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد تكليفات مكلف بها.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.assignments.map((assignment) => (
              <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{assignment.titleAr}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    الاستحقاق: {formatDate(assignment.dueAt)}
                    {assignment.score !== null
                      ? ` — الدرجة ${assignment.score} من ${assignment.totalPoints}`
                      : ""}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                  {assignment.submissionStatus
                    ? (SUBMISSION_LABELS[assignment.submissionStatus] ?? assignment.submissionStatus)
                    : "لم يُسلَّم"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ------------------------ certificates ------------------------ */}
      <div className="rounded-xl border p-4">
        <SectionTitle icon={Award} title="الشهادات" count={data.certificates.length} />
        {data.certificates.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد شهادات صادرة بعد.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.certificates.map((certificate) => (
              <li key={certificate.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    <Link href={`/certificates/${certificate.id}`} className="hover:underline">
                      {certificate.titleAr}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground" dir="ltr">
                    {certificate.certificateNumber}
                  </p>
                </div>
                <span className="text-xs font-bold text-muted-foreground">
                  صدرت {formatDate(certificate.issuedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <TrendingUp className="size-3.5 text-brand-600" aria-hidden />
        المستوى المقترح من بيانات الأداء (توصية إرشادية): {data.suggestedLabel} — والتصنيف
        الرسمي يبقى بقرار المشرف وفق آلية T0–T5.
      </p>
    </div>
  );
}
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  BookOpen,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Link2,
  PlayCircle,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/platform/empty-state";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { EnrollButton } from "@/components/training/enroll-button";
import { requireUser } from "@/lib/auth/session";
import {
  courseLevelLabel,
  LESSON_TYPE_LABELS,
  trainingCategoryLabel,
} from "@/config/training";
import { getCourseForViewer } from "@/lib/training/service";

export const metadata = {
  title: "تفاصيل الدورة",
};

const dateFormatter = new Intl.DateTimeFormat("ar", { dateStyle: "long" });

const LESSON_ICONS: Record<string, LucideIcon> = {
  TEXT: FileText,
  VIDEO: Video,
  EXTERNAL_VIDEO: Link2,
  RESOURCE: Download,
};

/**
 * Course learning view — description, instructor, and the full
 * published outline. Only published lessons appear; drafts stay
 * invisible. Teachers enroll here; managers get a preview banner.
 */
export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const viewer = { id: user.id, role: user.role, schoolId: user.schoolId };

  const result = await getCourseForViewer(viewer, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    redirect("/forbidden");
  }
  const view = result.data;
  const { course } = view;

  const isManager =
    user.role === "SUPER_ADMIN" || user.role === "DEVELOPMENT_OFFICE_MANAGER";
  const isTeacher = user.role === "TEACHER";

  const firstLessonId = view.sections[0]?.lessons[0]?.id ?? null;
  const level = courseLevelLabel(course.level);

  return (
    <div>
      <PageHeader
        title={course.titleAr}
        description={course.descriptionAr}
        breadcrumbs={[
          { label: "الأكاديمية التدريبية", href: "/academy" },
          { label: course.titleAr },
        ]}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {trainingCategoryLabel(course.category)}
            </span>
            {level && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {level}
              </span>
            )}
            {course.estimatedHours !== null && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                <Clock className="size-3" aria-hidden="true" />
                {course.estimatedHours} ساعة تقديرية
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              <Layers className="size-3" aria-hidden="true" />
              {view.sections.length} قسم · {view.publishedLessonsCount} درس منشور
            </span>
            {course.programName && (
              <span className="rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                {course.programName}
              </span>
            )}
            {view.enrollment && (
              <StatusBadge tone="success">
                مسجّل منذ {dateFormatter.format(view.enrollment.enrolledAt)}
              </StatusBadge>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        {isManager && course.status !== "PUBLISHED" && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning-soft/50 px-4 py-3 text-sm font-semibold text-warning"
          >
            <span>
              معاينة إدارية — هذه الدورة {course.status === "DRAFT" ? "مسودة" : "مؤرشفة"} ولا يراها المعلمون.
            </span>
            <Link
              href={`/academy/manage/${course.id}`}
              className="rounded-lg border border-warning/50 px-3 py-1.5 text-xs font-bold transition-colors hover:bg-warning-soft"
            >
              الانتقال إلى إدارة المحتوى
            </Link>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard
            title="عن الدورة"
            description={
              course.instructorName
                ? `المدرّب المسؤول: ${course.instructorName}`
                : undefined
            }
            className="lg:col-span-2"
          >
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {course.descriptionAr}
            </p>
            {course.descriptionEn && (
              <p dir="ltr" className="mt-3 whitespace-pre-wrap border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                {course.descriptionEn}
              </p>
            )}
            {course.schoolName && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <UserRound className="size-3.5" aria-hidden="true" />
                تابعة لِـ{course.schoolName}
              </p>
            )}
          </SectionCard>

          <SectionCard title="ابدأ الآن" description="سجّل ثم تابع الدروس بالترتيب.">
            {view.enrollment || !isTeacher ? (
              <div className="space-y-3">
                {firstLessonId ? (
                  <Link
                    href={`/academy/courses/${course.id}/lessons/${firstLessonId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700"
                  >
                    <PlayCircle className="size-4" aria-hidden="true" />
                    {view.enrollment ? "متابعة الدورة" : "استعراض الدروس"}
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    لم يُنشر محتوى لهذه الدورة بعد.
                  </p>
                )}
                {isManager && !view.enrollment && (
                  <p className="text-[11px] text-muted-foreground">
                    التسجيل متاح للمعلمين فقط — أنت تتصفح كإداري.
                  </p>
                )}
              </div>
            ) : (
              <EnrollButton courseId={course.id} />
            )}
          </SectionCard>
        </div>

        <SectionCard
          title="محتوى الدورة"
          description="الأقسام والدروس المنشورة بالترتيب — اضغط أي درس لفتحه."
        >
          {view.publishedLessonsCount === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="لم يُنشر محتوى بعد"
              description="أُنشئت الدورة ولم تُنشر دروسها بعد — عوداً لاحقاً."
            />
          ) : (
            <div className="space-y-4">
              {view.sections.map((section, sectionIndex) =>
                section.lessons.length === 0 ? null : (
                  <div key={section.id} className="rounded-xl border">
                    <div className="flex items-center gap-2 border-b px-4 py-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-100 text-xs font-extrabold text-brand-700">
                        {sectionIndex + 1}
                      </span>
                      <p className="text-sm font-bold">{section.titleAr}</p>
                      <span className="ms-auto text-[11px] text-muted-foreground">
                        {section.lessons.length} درس
                      </span>
                    </div>
                    <ul className="divide-y">
                      {section.lessons.map((lesson) => {
                        const Icon = LESSON_ICONS[lesson.type] ?? FileText;
                        return (
                          <li key={lesson.id}>
                            <Link
                              href={`/academy/courses/${course.id}/lessons/${lesson.id}`}
                              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30"
                            >
                              <span
                                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                                aria-hidden="true"
                              >
                                <Icon className="size-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold">
                                  {lesson.titleAr}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {LESSON_TYPE_LABELS[lesson.type as keyof typeof LESSON_TYPE_LABELS] ?? lesson.type}
                                </span>
                              </span>
                              <ExternalLink
                                className="size-3.5 shrink-0 text-muted-foreground/60"
                                aria-hidden="true"
                              />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )
              )}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
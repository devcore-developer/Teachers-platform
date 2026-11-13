import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ContentBuilder } from "@/components/training/content-builder";
import { CoverUpload } from "@/components/training/cover-upload";
import { CourseForm } from "@/components/training/course-form";
import { PublishControls } from "@/components/training/publish-controls";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { db } from "@/lib/db";
import {
  contentStatusLabel,
  courseLevelLabel,
  trainingCategoryLabel,
} from "@/config/training";
import {
  getCourseForManage,
  getInstructorOptions,
} from "@/lib/training/service";

export const metadata = {
  title: "بناء محتوى الدورة",
};

const dateFormatter = new Intl.DateTimeFormat("ar", { dateStyle: "long" });

/**
 * Course editor + content builder: metadata form, cover upload,
 * publish/archive controls and the sections/lessons builder — all
 * persisted server-side.
 */
export default async function CourseManageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAdminContext();

  const result = await getCourseForManage(ctx, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    redirect("/forbidden");
  }
  const course = result.data;

  const instructors = course.schoolId
    ? (await getInstructorOptions(ctx, course.schoolId)).map((instructor) => ({
        ...instructor,
        schoolId: course.schoolId,
      }))
    : [];

  const cover = course.coverAttachmentId
    ? await db.attachment.findUnique({
        where: { id: course.coverAttachmentId },
        select: { id: true, originalName: true },
      })
    : null;

  const sectionsCount = course.sections.length;
  const lessonsCount = course.sections.reduce(
    (sum, section) => sum + section.lessons.length,
    0
  );

  return (
    <div>
      <PageHeader
        title={course.titleAr}
        description="بيانات الدورة وصورتها والمحتوى الكامل — كل تعديل يُحفظ في قاعدة البيانات فوراً."
        breadcrumbs={[
          { label: "إدارة الدورات", href: "/academy/manage" },
          { label: course.titleAr },
        ]}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={
                course.status === "PUBLISHED"
                  ? "success"
                  : course.status === "ARCHIVED"
                    ? "neutral"
                    : "warning"
              }
            >
              {contentStatusLabel(course.status)}
            </StatusBadge>
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {trainingCategoryLabel(course.category)}
            </span>
            {courseLevelLabel(course.level) && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {courseLevelLabel(course.level)}
              </span>
            )}
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {sectionsCount} قسم · {lessonsCount} درس
            </span>
            {course.publishedAt && (
              <span className="text-[11px] text-muted-foreground">
                نُشرت في {dateFormatter.format(course.publishedAt)}
              </span>
            )}
          </div>
        }
        actions={
          course.status === "PUBLISHED" ? (
            <Link
              href={`/academy/courses/${course.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-50"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              معاينة كمتعلّم
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-6">
        <PublishControls courseId={course.id} status={course.status} />

        <SectionCard
          title="صورة الغلاف"
          description="تظهر في كتالوج الأكاديمية — PNG أو JPG أو WebP حتى 5 ميغابايت."
        >
          <CoverUpload
            ownerType="course"
            ownerId={course.id}
            currentCover={
              cover ? { id: cover.id, name: cover.originalName } : null
            }
          />
        </SectionCard>

        <CourseForm
          mode="edit"
          courseId={course.id}
          initial={{
            titleAr: course.titleAr,
            titleEn: course.titleEn,
            descriptionAr: course.descriptionAr,
            descriptionEn: course.descriptionEn,
            category: course.category,
            programId: course.programId,
            level: course.level,
            estimatedHours: course.estimatedHours,
            instructorId: course.instructorId,
            schoolId: course.schoolId,
          }}
          schools={[]}
          instructors={instructors}
          showScope={false}
          defaultScope={course.schoolId === null ? "platform" : "school"}
        />

        <ContentBuilder
          courseId={course.id}
          courseStatus={course.status}
          sections={course.sections}
        />
      </div>
    </div>
  );
}
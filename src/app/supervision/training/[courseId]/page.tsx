import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";

import { CourseBuilder } from "@/app/supervision/training/[courseId]/course-builder";
import { db } from "@/lib/db";
import { publicUrlFor } from "@/lib/media/r2";
import {
  getSupervisorCourse,
  getSupervisorCoursePolicy,
  listSupervisorCategoryOptions,
  listSupervisorEnrollments,
  listSupervisorProgramOptions,
  listSupervisorTeachers,
  requireSupervisorContext,
} from "@/lib/supervision/training";

export const metadata = { title: "بناء محتوى الدورة" };

/**
 * Supervisor course builder. Loads the same CourseManageDetail the
 * admin-trio builder uses (tenant-fenced) and hands it to the client
 * builder with the supervisor's scoped teachers and enrollments.
 */
export default async function SupervisorCourseBuilderPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const ctx = await requireSupervisorContext();
  const detail = await getSupervisorCourse(ctx, courseId);

  if (!detail.ok) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-8 text-center">
        <TriangleAlert className="mx-auto size-8 text-destructive" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-black text-foreground">
          الدورة غير متاحة
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{detail.message}</p>
        <Link
          href="/supervision/training"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
          العودة إلى دوراتي
        </Link>
      </div>
    );
  }

  const course = detail.data;

  const [teachers, enrollments, programs, categories, coverAttachment, courseAssessments, policy] =
    await Promise.all([
      listSupervisorTeachers(ctx),
      listSupervisorEnrollments(ctx, courseId),
      listSupervisorProgramOptions(ctx),
      listSupervisorCategoryOptions(ctx),
      course.coverAttachmentId
        ? db.attachment.findUnique({
            where: { id: course.coverAttachmentId },
            select: { storageKey: true },
          })
        : Promise.resolve(null),
      db.assessment.findMany({
        where: { courseId },
        select: { id: true, titleAr: true, status: true, _count: { select: { questions: true } } },
        orderBy: { updatedAt: "desc" },
      }),
      getSupervisorCoursePolicy(ctx, courseId),
    ]);

  const coverUrl = coverAttachment ? publicUrlFor(coverAttachment.storageKey) : null;

  return (
    <CourseBuilder
      course={{
        id: course.id,
        titleAr: course.titleAr,
        titleEn: course.titleEn,
        descriptionAr: course.descriptionAr,
        descriptionEn: course.descriptionEn,
        category: course.category,
        level: course.level,
        estimatedHours: course.estimatedHours,
        status: course.status,
        programId: course.programId,
      }}
      coverUrl={coverUrl}
      sections={course.sections}
      teachers={teachers.map((teacher) => ({ id: teacher.id, name: teacher.name }))}
      enrollments={enrollments.map((row) => ({
        userId: row.userId,
        name: row.name,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      }))}
      assessments={courseAssessments.map((row) => ({
        id: row.id,
        titleAr: row.titleAr,
        status: row.status,
        questionsCount: row._count.questions,
      }))}
      programs={programs.map((program) => ({
        id: program.id,
        nameAr: program.nameAr,
        platformWide: program.platformWide,
      }))}
      categories={categories}
      policy={
        policy.ok
          ? policy.data
          : { requireSequentialLessons: true, lessonCompletionThreshold: 95 }
      }
    />
  );
}
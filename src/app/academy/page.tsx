import Link from "next/link";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  MonitorPlay,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { CatalogFilters } from "@/components/training/catalog-filters";
import { EmptyState } from "@/components/platform/empty-state";
import { AcademySupervisorTrainings } from "@/app/academy/supervisor-trainings";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listPublishedCourses } from "@/lib/training/service";
import {
  courseLevelLabel,
  TRAINING_CATEGORY_LABELS,
  trainingCategoryLabel,
} from "@/config/training";

export const metadata = {
  title: "الأكاديمية التدريبية",
};

/**
 * Phase 5 — teacher-facing academy catalog. Only PUBLISHED courses
 * visible to the viewer's school (or platform-wide) are listed; drafts
 * and archived courses never reach this page. Filters are URL-driven.
 */
export default async function AcademyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const viewer = { id: user.id, role: user.role, schoolId: user.schoolId };

  const params = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? (value[0] ?? "") : (value ?? ""),
    ])
  );
  const mine = flat.mine === "1";

  const result = await listPublishedCourses(viewer, {
    q: flat.q,
    category: flat.category,
    programId: flat.programId,
    mine,
    page: Number.parseInt(flat.page || "1", 10) || 1,
  });

  // Program filter options — published programs in the viewer's scope.
  const programs = await db.trainingProgram.findMany({
    where:
      user.role === "SUPER_ADMIN"
        ? { status: "PUBLISHED" }
        : {
            status: "PUBLISHED",
            OR: [{ schoolId: null }, ...(user.schoolId ? [{ schoolId: user.schoolId }] : [])],
          },
    select: { id: true, nameAr: true, schoolId: true },
    orderBy: { nameAr: "asc" },
  });

  const isManager =
    user.role === "SUPER_ADMIN" || user.role === "DEVELOPMENT_OFFICE_MANAGER";
  const isSupervisor = user.role === "EDUCATIONAL_SUPERVISOR";

  function pageHref(page: number): string {
    const sp = new URLSearchParams(
      Object.entries(flat).filter(([, v]) => v !== "" && v !== undefined)
    );
    sp.set("page", String(page));
    return `/academy?${sp.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="الأكاديمية التدريبية"
        description="الدورات التدريبية المنشورة والمتاحة لك — تصفّح، سجّل، وابدأ التعلّم وفق صلاحياتك."
        breadcrumbs={[{ label: "الأكاديمية التدريبية" }]}
        actions={
          isManager ? (
            <Link
              href="/academy/manage"
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-50"
            >
              <MonitorPlay className="size-4" aria-hidden="true" />
              إدارة الدورات
            </Link>
          ) : isSupervisor ? (
            <Link
              href="/supervision/training/new"
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-50"
            >
              <MonitorPlay className="size-4" aria-hidden="true" />
              إنشاء تدريب جديد
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {/* Supervisor central workspace — every training they created,
            each opening its own full management page. */}
        <AcademySupervisorTrainings />

        <CatalogFilters
          action="/academy"
          q={flat.q}
          category={flat.category}
          programId={flat.programId}
          programs={programs.map((program) => ({
            id: program.id,
            nameAr: program.nameAr,
            platformWide: program.schoolId === null,
          }))}
          showMine
          mine={mine}
        />

        {result.ok ? (
          result.data.rows.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={
                mine
                  ? "لم تسجّل في أي دورة بعد"
                  : "لا توجد دورات متاحة مطابقة"
              }
              description={
                mine
                  ? "تصفّح الكتالوج وسجّل في ما يناسبك — ستظهر دوراتك هنا."
                  : "جرّب تعديل الفلاتر أو كلمات البحث — أو عوداً لاحقاً فسيتم نشر دورات جديدة."
              }
            />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {result.data.rows.map((course) => {
                  const level = courseLevelLabel(course.level);
                  return (
                    <Link
                      key={course.id}
                      href={`/academy/courses/${course.id}`}
                      className="group flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md"
                    >
                      <div className="relative h-36 w-full overflow-hidden bg-brand-50">
                        {course.coverAttachmentId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/files/${course.coverAttachmentId}`}
                            alt=""
                            className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div
                            className="flex h-full items-center justify-center text-brand-300"
                            aria-hidden="true"
                          >
                            <BookOpen className="size-10" strokeWidth={1.5} />
                          </div>
                        )}
                        {course.enrolled && (
                          <span className="absolute end-2 top-2 rounded-full bg-success-soft px-2.5 py-0.5 text-[11px] font-bold text-success">
                            مسجّل
                          </span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-2 p-4">
                        <h3 className="text-sm font-bold text-foreground transition-colors group-hover:text-brand-700">
                          {course.titleAr}
                        </h3>
                        {course.programName && (
                          <p className="text-[11px] font-semibold text-muted-foreground">
                            {course.programName}
                          </p>
                        )}
                        <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                          <span className="rounded-md bg-muted px-2 py-0.5">
                            {trainingCategoryLabel(course.category)}
                          </span>
                          {level && (
                            <span className="rounded-md bg-muted px-2 py-0.5">
                              {level}
                            </span>
                          )}
                          {course.estimatedHours !== null && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                              <Clock className="size-3" aria-hidden="true" />
                              {course.estimatedHours} ساعة
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                            <Layers className="size-3" aria-hidden="true" />
                            {course.sectionsCount} قسم · {course.lessonsCount} درس
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {result.data.pageCount > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    الإجمالي: {result.data.total} دورة — صفحة {result.data.page} من{" "}
                    {result.data.pageCount}
                  </p>
                  <div className="flex items-center gap-2">
                    {result.data.page > 1 ? (
                      <Link
                        href={pageHref(result.data.page - 1)}
                        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-accent"
                      >
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                        السابقة
                      </Link>
                    ) : null}
                    {result.data.page < result.data.pageCount ? (
                      <Link
                        href={pageHref(result.data.page + 1)}
                        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-accent"
                      >
                        التالية
                        <ChevronLeft className="size-3.5" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )
        ) : (
          <div
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm font-semibold text-destructive"
          >
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}
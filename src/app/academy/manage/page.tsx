import Link from "next/link";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  GraduationCap,
  Layers,
  MonitorPlay,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { CatalogFilters } from "@/components/training/catalog-filters";
import { EmptyState } from "@/components/platform/empty-state";
import { StatusBadge } from "@/components/platform/status-badge";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import {
  contentStatusLabel,
  trainingCategoryLabel,
} from "@/config/training";
import {
  listCoursesForManage,
  listProgramOptionsForManage,
} from "@/lib/training/service";

export const metadata = {
  title: "إدارة الدورات",
};

const dateFormatter = new Intl.DateTimeFormat("ar", {
  dateStyle: "medium",
});

/**
 * Phase 5 — administrative course directory. SUPER_ADMIN sees the whole
 * platform; office managers are structurally scoped to their own school
 * by the service layer. Rows and counts come from persisted data.
 */
export default async function CourseManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAdminContext();

  const params = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? (value[0] ?? "") : (value ?? ""),
    ])
  );

  const result = await listCoursesForManage(ctx, {
    q: flat.q,
    status: flat.status,
    category: flat.category,
    programId: flat.programId,
    page: Number.parseInt(flat.page || "1", 10) || 1,
  });
  const programOptions = await listProgramOptionsForManage(ctx);

  function pageHref(page: number): string {
    const sp = new URLSearchParams(
      Object.entries(flat).filter(([, v]) => v !== "" && v !== undefined)
    );
    sp.set("page", String(page));
    return `/academy/manage?${sp.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="إدارة الدورات"
        description={
          ctx.role === "SUPER_ADMIN"
            ? "جميع دورات المنصة عبر المدارس والمحتوى المشترك — إنشاء وبناء محتوى ونشر وأرشفة."
            : "دورات مدرستك — إنشاء وبناء محتوى ونشر وأرشفة داخل نطاقك فقط."
        }
        breadcrumbs={[{ label: "إدارة الدورات" }]}
        actions={
          <>
            <Link
              href="/academy/programs"
              className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent"
            >
              <GraduationCap className="size-4" aria-hidden="true" />
              البرامج التدريبية
            </Link>
            <Link
              href="/academy/manage/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-700"
            >
              <FolderPlus className="size-4" aria-hidden="true" />
              دورة جديدة
            </Link>
          </>
        }
      />

      <div className="space-y-6">
        <CatalogFilters
          action="/academy/manage"
          q={flat.q}
          category={flat.category}
          programId={flat.programId}
          programs={programOptions}
          status={flat.status}
          showStatus
        />

        {result.ok ? (
          <div className="overflow-hidden rounded-xl border bg-card">
            {result.data.rows.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="لا توجد دورات مطابقة"
                description="جرّب تعديل الفلاتر — أو أنشئ دورة جديدة وابدأ ببناء محتواها."
                action={
                  <Link
                    href="/academy/manage/new"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-700"
                  >
                    <FolderPlus className="size-4" aria-hidden="true" />
                    إنشاء دورة
                  </Link>
                }
                className="rounded-none border-0 bg-transparent"
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <th className="px-4 py-3 text-start font-bold">الدورة</th>
                        <th className="px-4 py-3 text-start font-bold">المدرسة</th>
                        <th className="px-4 py-3 text-start font-bold">المحتوى</th>
                        <th className="px-4 py-3 text-start font-bold">الحالة</th>
                        <th className="px-4 py-3 text-start font-bold">آخر تحديث</th>
                        <th className="px-4 py-3 text-start font-bold" aria-label="إجراءات" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.data.rows.map((course) => (
                        <tr key={course.id} className="transition-colors hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-50">
                                {course.coverAttachmentId ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={`/api/files/${course.coverAttachmentId}`}
                                    alt=""
                                    className="size-full object-cover"
                                  />
                                ) : (
                                  <BookOpen
                                    className="size-5 text-brand-300"
                                    aria-hidden="true"
                                  />
                                )}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-bold">
                                  {course.titleAr}
                                </span>
                                <span className="block text-[11px] text-muted-foreground">
                                  {course.programName
                                    ? `ضمن برنامج: ${course.programName}`
                                    : "بدون برنامج"}
                                  {" · "}
                                  {trainingCategoryLabel(course.category)}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {course.schoolName ?? (
                              <span className="font-bold text-brand-700">منصة مشتركة</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Layers className="size-3.5" aria-hidden="true" />
                              {course.sectionsCount} قسم · {course.lessonsCount} درس
                            </span>
                          </td>
                          <td>
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
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {dateFormatter.format(course.updatedAt)}
                          </td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/academy/manage/${course.id}`}
                                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-50"
                              >
                                <MonitorPlay className="size-3.5" aria-hidden="true" />
                                بناء المحتوى
                              </Link>
                              {course.status === "PUBLISHED" && (
                                <Link
                                  href={`/academy/courses/${course.id}`}
                                  className="rounded-lg border px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent"
                                >
                                  عرض
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {result.data.pageCount > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
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
            )}
          </div>
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
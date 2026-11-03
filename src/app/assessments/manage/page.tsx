import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { AssessmentFilters } from "@/components/assessments/assessment-filters";
import { EmptyState } from "@/components/platform/empty-state";
import { StatusBadge } from "@/components/platform/status-badge";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { assessmentStatusLabel } from "@/config/assessment";
import { listAssessmentsForManage } from "@/lib/assessment/service";

export const metadata = {
  title: "إدارة الاختبارات",
};

const dateFormatter = new Intl.DateTimeFormat("ar", {
  dateStyle: "medium",
});

/**
 * Phase 6 — administrative assessment directory. SUPER_ADMIN sees the
 * whole platform; office managers are structurally scoped to their own
 * school by the service layer. Rows and counts come from persisted data.
 */
export default async function AssessmentManagePage({
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

  const result = await listAssessmentsForManage(ctx, {
    q: flat.q,
    status: flat.status,
    page: Number.parseInt(flat.page || "1", 10) || 1,
  });

  function pageHref(page: number): string {
    const sp = new URLSearchParams(
      Object.entries(flat).filter(([, v]) => v !== "" && v !== undefined)
    );
    sp.set("page", String(page));
    return `/assessments/manage?${sp.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="إدارة الاختبارات"
        description={
          ctx.role === "SUPER_ADMIN"
            ? "جميع اختبارات المنصة عبر المدارس والمحتوى المشترك — إنشاء وبناء أسئلة ونشر وأرشفة."
            : "اختبارات مدرستك — إنشاء وبناء أسئلة ونشر وأرشفة داخل نطاقك فقط."
        }
        breadcrumbs={[{ label: "الاختبارات والتقييم" }, { label: "إدارة الاختبارات" }]}
        actions={
          <Link
            href="/assessments/manage/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-700"
          >
            <FilePlus2 className="size-4" aria-hidden="true" />
            اختبار جديد
          </Link>
        }
      />

      <div className="space-y-6">
        <AssessmentFilters action="/assessments/manage" q={flat.q} status={flat.status} />

        {result.ok ? (
          <div className="overflow-hidden rounded-xl border bg-card">
            {result.data.rows.length === 0 ? (
              <EmptyState
                icon={ClipboardCheck}
                title="لا توجد اختبارات مطابقة"
                description="جرّب تعديل الفلاتر — أو أنشئ اختبارًا جديدًا وابدأ بإضافة الأسئلة."
                action={
                  <Link
                    href="/assessments/manage/new"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-700"
                  >
                    <FilePlus2 className="size-4" aria-hidden="true" />
                    إنشاء اختبار
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
                        <th className="px-4 py-3 text-start font-bold">الاختبار</th>
                        <th className="px-4 py-3 text-start font-bold">النطاق</th>
                        <th className="px-4 py-3 text-start font-bold">الأسئلة والدرجات</th>
                        <th className="px-4 py-3 text-start font-bold">المحاولات</th>
                        <th className="px-4 py-3 text-start font-bold">الحالة</th>
                        <th className="px-4 py-3 text-start font-bold">آخر تحديث</th>
                        <th className="px-4 py-3 text-start font-bold" aria-label="إجراءات" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.data.rows.map((assessment) => (
                        <tr
                          key={assessment.id}
                          className="transition-colors hover:bg-muted/20"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                                <ClipboardCheck
                                  className="size-5 text-brand-600"
                                  aria-hidden="true"
                                />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-bold">
                                  {assessment.titleAr}
                                </span>
                                <span className="block text-[11px] text-muted-foreground">
                                  {assessment.courseTitle
                                    ? `مرتبط بدورة: ${assessment.courseTitle}`
                                    : "بدون ربط بدورة"}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {assessment.schoolName ?? (
                              <span className="font-bold text-brand-700">منصة مشتركة</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {assessment.questionsCount} سؤال · {assessment.maxScore} نقطة ·
                            نجاح {assessment.passingScore}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <ClipboardList className="size-3.5" aria-hidden="true" />
                              {assessment.attemptsCount}
                            </span>
                          </td>
                          <td>
                            <StatusBadge
                              tone={
                                assessment.status === "PUBLISHED"
                                  ? "success"
                                  : assessment.status === "ARCHIVED"
                                    ? "neutral"
                                    : "warning"
                              }
                            >
                              {assessmentStatusLabel(assessment.status)}
                            </StatusBadge>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {dateFormatter.format(assessment.updatedAt)}
                          </td>
                          <td>
                            <Link
                              href={`/assessments/manage/${assessment.id}`}
                              className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-50"
                            >
                              بناء ومراجعة
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {result.data.pageCount > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
                    <p className="text-xs text-muted-foreground">
                      الإجمالي: {result.data.total} اختبار — صفحة {result.data.page} من{" "}
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
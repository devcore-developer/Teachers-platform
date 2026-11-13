import Link from "next/link";
import { FolderPlus, MonitorPlay, Plus } from "lucide-react";

import {
  EmptyHint,
  Pill,
  formatDate,
  statusLabel,
  statusTone,
} from "@/app/supervision/supervisor-ui";
import { DeleteTrainingButton } from "@/app/supervision/training/unified/delete-training-dialog";
import {
  listSupervisorCourses,
  requireSupervisorContext,
} from "@/lib/supervision/training";

export const metadata = { title: "إدارة التدريب — تدريبات مدرستك" };

/**
 * Supervisor training directory. Creation happens through the ONE
 * unified page (/supervision/training/new); every row opens the SAME
 * unified page for editing — draft or published. The tenant fence
 * (own school only) is structural in the service layer.
 */
export default async function SupervisorTrainingPage() {
  const ctx = await requireSupervisorContext();

  const courses = await listSupervisorCourses(ctx, { page: 1 });
  const rows = courses.ok ? courses.data.rows : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-foreground">إدارة التدريب</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            تدريبات مدرستك — أنشئ تدريبًا كاملًا من صفحة واحدة (المعلومات
            والفيديوهات والمرفقات والاختبار وقياس الأثر) ثم انشره لمعلميك.
          </p>
        </div>
        <Link
          href="/supervision/training/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700"
        >
          <Plus className="size-4" aria-hidden="true" />
          إنشاء تدريب جديد
        </Link>
      </header>

      <section className="rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-black text-foreground">
            تدريبات مدرستك ({rows.length})
          </h2>
        </div>
        <div className="p-4">
          {rows.length === 0 ? (
            <EmptyHint
              title="لا توجد تدريبات بعد"
              description="أنشئ أول تدريب من زر «إنشاء تدريب جديد» — يبدأ مسودة حتى نشره."
            />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {rows.map((course) => (
                <li key={course.id} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-foreground">
                        {course.titleAr}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {course.programName ? `${course.programName} · ` : ""}
                        آخر تحديث {formatDate(course.updatedAt)}
                      </p>
                    </div>
                    <Pill tone={statusTone(course.status)}>
                      {statusLabel(course.status)}
                    </Pill>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      {course.sectionsCount} أقسام
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      {course.lessonsCount} دروس
                    </span>
                    {course.estimatedHours && (
                      <span className="rounded-full bg-muted px-2 py-0.5">
                        {course.estimatedHours} ساعات
                      </span>
                    )}
                  </div>
                  {/* Edit (blue, brand) and Delete (red, destructive) sit
                      side by side — clicking Delete NEVER deletes directly,
                      it opens the secure confirmation dialog first. */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/supervision/training/${course.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700"
                    >
                      <MonitorPlay className="size-3.5" aria-hidden="true" />
                      فتح الصفحة الموحدة
                    </Link>
                    <DeleteTrainingButton
                      courseId={course.id}
                      courseTitle={course.titleAr}
                      lessonsCount={course.lessonsCount}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FolderPlus className="size-3.5 shrink-0" aria-hidden="true" />
        النشر يتطلب عنصر محتوى واحدًا على الأقل — والاختبار وأداة قياس الأثر
        يُضبطان من داخل الصفحة الموحدة نفسها.
      </p>
    </div>
  );
}
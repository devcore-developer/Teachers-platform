import Link from "next/link";
import { FolderPlus, MonitorPlay } from "lucide-react";

import {
  EmptyHint,
  Pill,
  formatDate,
  statusLabel,
  statusTone,
} from "@/app/supervision/supervisor-ui";
import { SupervisorCourseForm } from "@/app/supervision/training/course-form";
import {
  listSupervisorCategoryOptions,
  listSupervisorCourses,
  listSupervisorProgramOptions,
  requireSupervisorContext,
} from "@/lib/supervision/training";

export const metadata = { title: "إدارة التدريب — دورات مدرستك" };

/**
 * Supervisor course directory + creation. Same service layer the admin
 * trio uses — the tenant fence (own school only) is structural.
 */
export default async function SupervisorTrainingPage() {
  const ctx = await requireSupervisorContext();

  const [courses, programs, categories] = await Promise.all([
    listSupervisorCourses(ctx, { page: 1 }),
    listSupervisorProgramOptions(ctx),
    listSupervisorCategoryOptions(ctx),
  ]);

  const rows = courses.ok ? courses.data.rows : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-foreground">إدارة التدريب</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            دورات مدرستك — أنشئ دورة، ابنِ أقسامها ودروسها وفيديوهاتها، ثم انشرها
            لمعلميك. المحتوى المشترك على مستوى المنصة يظل من صلاحيات مدير المنصة.
          </p>
        </div>
      </header>

      <SupervisorCourseForm
        categories={categories}
        programs={programs.map((program) => ({
          id: program.id,
          nameAr: program.nameAr,
          platformWide: program.platformWide,
        }))}
      />

      <section className="rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-black text-foreground">
            دورات مدرستك ({rows.length})
          </h2>
        </div>
        <div className="p-4">
          {rows.length === 0 ? (
            <EmptyHint
              title="لا توجد دورات بعد"
              description="أنشئ أول دورة من النموذج أعلاه — ستبدأ مسودة حتى نشرها."
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
                  <Link
                    href={`/supervision/training/${course.id}`}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700"
                  >
                    <MonitorPlay className="size-3.5" aria-hidden="true" />
                    بناء المحتوى
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FolderPlus className="size-3.5 shrink-0" aria-hidden="true" />
        النشر يتطلب قسمًا ودرسًا واحدًا على الأقل — ويمكنك إسناد الدورة المنشورة
        لمعلميك من داخل شاشة البناء.
      </p>
    </div>
  );
}
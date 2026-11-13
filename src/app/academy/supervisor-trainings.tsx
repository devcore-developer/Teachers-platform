import Link from "next/link";
import {
  ClipboardCheck,
  GraduationCap,
  MonitorPlay,
  Pencil,
  Plus,
  Search,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

import {
  EmptyHint,
  Pill,
  formatDate,
  statusLabel,
  statusTone,
} from "@/app/supervision/supervisor-ui";
import { DeleteTrainingButton } from "@/app/supervision/training/unified/delete-training-dialog";
import { TRAINING_DOMAINS } from "@/config/training-domains";
import { requireUser } from "@/lib/auth/session";
import {
  listSupervisorAcademyTrainings,
  type SupervisorAcademyTrainingRow,
} from "@/lib/supervision/training";

/* ------------------------------------------------------------------ */
/* Training Academy — the Educational Supervisor's ONE unified          */
/* training listing.                                                    */
/*                                                                      */
/* This section IS the supervisor's Training Academy: every training    */
/* they created (any status — drafts included) appears here EXACTLY     */
/* ONCE. The public published-course catalog below the page is NOT      */
/* rendered for supervisors anymore (see academy/page.tsx) — it was     */
/* the second listing that re-showed their own published trainings and  */
/* made the same training appear twice.                                 */
/*                                                                      */
/* ONE data path only: the same tenant-fenced supervision service       */
/* (listSupervisorAcademyTrainings). The URL-driven search/filters      */
/* narrow THAT list for display — no second query, no second dataset,  */
/* no parallel rendering logic.                                         */
/*                                                                      */
/* Every card carries the full management set WITHOUT opening the       */
/* training first:                                                     */
/*   • Open/Manage — the unified workspace (/supervision/training/id),  */
/*   • Edit        — the SAME unified page deep-linked straight to the  */
/*                   editable info form (#training-info anchor),        */
/*   • Delete      — the EXISTING secure confirmation dialog reused     */
/*                   (same action, same service, same DELETE word;      */
/*                   redirectTo keeps the supervisor on /academy after  */
/*                   the deletion commits).                             */
/* Rendered on /academy; every other role never sees this section.      */
/* ------------------------------------------------------------------ */

/** Same field styling as the shared catalog filters (blue brand). */
const selectClass =
  "h-9 w-full appearance-none rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 pe-8 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

export async function AcademySupervisorTrainings({
  q = "",
  category = "",
}: {
  q?: string;
  category?: string;
}) {
  const user = await requireUser();
  if (user.role !== "EDUCATIONAL_SUPERVISOR" || !user.schoolId) return null;

  // Same shape requireSupervisorContext builds — already role-guarded above.
  const ctx = {
    id: user.id,
    name: user.name,
    role: "EDUCATIONAL_SUPERVISOR" as const,
    schoolId: user.schoolId,
  };

  const allTrainings = await listSupervisorAcademyTrainings(ctx);

  /* URL-driven narrowing of the ONE listing (display-level filter on
   * an already school-fenced, ownership-scoped read). */
  const qTrim = q.trim();
  const categoryTrim = category.trim();
  const trainings = allTrainings.filter((training) => {
    const matchesQ = qTrim.length === 0 || training.titleAr.includes(qTrim);
    const matchesCategory =
      categoryTrim.length === 0 || training.category === categoryTrim;
    return matchesQ && matchesCategory;
  });
  const isFiltered = qTrim.length > 0 || categoryTrim.length > 0;

  return (
    <section
      aria-labelledby="my-trainings-heading"
      className="rounded-xl border-2 border-brand-600/30 bg-brand-600/[0.04]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-brand-600/20 px-4 py-3">
        <div className="min-w-0">
          <h2
            id="my-trainings-heading"
            className="flex flex-wrap items-center gap-2 text-sm font-black text-foreground"
          >
            <MonitorPlay className="size-4 text-brand-600" aria-hidden="true" />
            تدريباتي — مساحة إدارة التدريب
            <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[10px] font-bold text-brand-600">
              {trainings.length}
            </span>
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            كل تدريب أنشأته في مكان واحد وبمرة واحدة فقط: افتح أي تدريب
            للوصول إلى مساحة إدارته الكاملة — المحتوى والفيديوهات والمرفقات
            والاختبار وقياس الأثر وإسناد المعلمين والنتائج والشهادات
            والنشر — أو حرّره أو احذفه مباشرة من البطاقة.
          </p>
        </div>
        <Link
          href="/supervision/training/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700"
        >
          <Plus className="size-4" aria-hidden="true" />
          إنشاء تدريب جديد
        </Link>
      </div>

      {/* Search + filters — URL-driven GET form, same pattern as the
          catalog filters (works without client JS, stateless). The
          category options are the supervisor training domains actually
          stored in Course.category for trainings created here. */}
      <form
        action="/academy"
        method="get"
        className="flex flex-wrap items-end gap-2 border-b border-brand-600/20 px-4 py-3"
      >
        <label className="min-w-0 flex-1 basis-56 space-y-1">
          <span className="block text-[11px] font-bold text-muted-foreground">
            بحث بالعنوان
          </span>
          <div className="relative">
            <Search
              className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="اكتب عنوان التدريب…"
              className={inputClass}
            />
          </div>
        </label>
        <label className="w-full max-w-60 space-y-1">
          <span className="block text-[11px] font-bold text-muted-foreground">
            المجال التدريبي
          </span>
          <select name="category" defaultValue={category} className={selectClass}>
            <option value="">كل المجالات</option>
            {TRAINING_DOMAINS.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 text-xs font-bold text-white transition-colors hover:bg-brand-700"
        >
          <Search className="size-3.5" aria-hidden="true" />
          تطبيق
        </button>
        {isFiltered && (
          <a
            href="/academy"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="size-3.5" aria-hidden="true" />
            مسح
          </a>
        )}
      </form>

      <div className="p-4">
        {trainings.length === 0 ? (
          isFiltered ? (
            <EmptyHint
              title="لا توجد تدريبات مطابقة للبحث"
              description="جرّب تعديل كلمة البحث أو المجال التدريبي — أو اضغط «مسح» لعرض كل تدريباتك."
            />
          ) : (
            <EmptyHint
              title="لم تنشئ تدريبات بعد"
              description="اضغط «إنشاء تدريب جديد» — الصفحة تفتح فورًا بكل أقسامها جاهزة للتعديل، ويبقى تدريبك مسودة حتى تنشره."
            />
          )
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {trainings.map((training) => (
              <TrainingCard key={training.id} training={training} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TrainingCard({ training }: { training: SupervisorAcademyTrainingRow }) {
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-foreground">
            {training.titleAr}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            آخر تحديث {formatDate(new Date(training.updatedAt))}
            {training.estimatedHours ? ` · ${training.estimatedHours} ساعات` : ""}
          </p>
        </div>
        <Pill tone={statusTone(training.status)}>
          {statusLabel(training.status)}
        </Pill>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5">
          {training.sectionsCount} أقسام
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5">
          {training.lessonsCount} عناصر محتوى
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
          <Users className="size-3" aria-hidden="true" />
          {training.enrollmentsCount} معلم
        </span>
        {training.hasAssessment && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2 py-0.5 font-bold text-brand-600">
            <ClipboardCheck className="size-3" aria-hidden="true" />
            اختبار
          </span>
        )}
        {training.hasSurvey && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2 py-0.5 font-bold text-brand-600">
            <TrendingUp className="size-3" aria-hidden="true" />
            قياس أثر
          </span>
        )}
      </div>

      {/* Open/Manage (blue) + Edit (blue outline, jumps straight to the
          editable info form) + Delete (red outline) sit side by side.
          Delete NEVER deletes directly — it opens the SAME secure
          confirmation dialog used in Training Management, and after the
          deletion commits the supervisor stays HERE on /academy. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/supervision/training/${training.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700"
        >
          <GraduationCap className="size-3.5" aria-hidden="true" />
          فتح مساحة إدارة التدريب
        </Link>
        <Link
          href={`/supervision/training/${training.id}#training-info`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-600/40 bg-card px-3 py-1.5 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-50"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          تحرير التدريب
        </Link>
        <DeleteTrainingButton
          courseId={training.id}
          courseTitle={training.titleAr}
          lessonsCount={training.lessonsCount}
          redirectTo="/academy"
        />
      </div>
    </li>
  );
}
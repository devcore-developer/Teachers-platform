import Link from "next/link";
import {
  ClipboardCheck,
  GraduationCap,
  MonitorPlay,
  Plus,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  EmptyHint,
  Pill,
  formatDate,
  statusLabel,
  statusTone,
} from "@/app/supervision/supervisor-ui";
import { requireUser } from "@/lib/auth/session";
import {
  listSupervisorAcademyTrainings,
  type SupervisorAcademyTrainingRow,
} from "@/lib/supervision/training";

/**
 * Training Academy — the Educational Supervisor's central training
 * workspace section.
 *
 * Lists EVERY training the current supervisor created (any status —
 * drafts included) and opens each one's own management page
 * (/supervision/training/[courseId]) where the full workspace lives:
 * content, videos, attachments, exam, impact measurement, enrollment,
 * results and publishing. Reuses the SAME supervision service and
 * tenant fences — no parallel data path.
 *
 * Rendered above the public catalog on /academy; the catalog itself is
 * untouched for every role.
 */
export async function AcademySupervisorTrainings() {
  const user = await requireUser();
  if (user.role !== "EDUCATIONAL_SUPERVISOR" || !user.schoolId) return null;

  // Same shape requireSupervisorContext builds — already role-guarded above.
  const ctx = {
    id: user.id,
    name: user.name,
    role: "EDUCATIONAL_SUPERVISOR" as const,
    schoolId: user.schoolId,
  };
  const trainings = await listSupervisorAcademyTrainings(ctx);

  return (
    <section
      aria-labelledby="my-trainings-heading"
      className="rounded-xl border-2 border-brand-600/30 bg-brand-600/[0.04]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-brand-600/20 px-4 py-3">
        <div className="min-w-0">
          <h2
            id="my-trainings-heading"
            className="flex items-center gap-2 text-sm font-black text-foreground"
          >
            <MonitorPlay className="size-4 text-brand-600" aria-hidden="true" />
            تدريباتي — مساحة إدارة التدريب
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            كل تدريب أنشأته في مكان واحد: افتح أي تدريب للوصول إلى مساحة
            إدارته الكاملة — المحتوى والفيديوهات والمرفقات والاختبار وقياس
            الأثر وإسناد المعلمين والنتائج والشهادات والنشر.
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

      <div className="p-4">
        {trainings.length === 0 ? (
          <EmptyHint
            title="لم تنشئ تدريبات بعد"
            description="اضغط «إنشاء تدريب جديد» — الصفحة تفتح فورًا بكل أقسامها جاهزة للتعديل، ويبقى تدريبك مسودة حتى تنشره."
          />
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

      <Link
        href={`/supervision/training/${training.id}`}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-brand-700"
      >
        <GraduationCap className="size-3.5" aria-hidden="true" />
        فتح مساحة إدارة التدريب
      </Link>
    </li>
  );
}
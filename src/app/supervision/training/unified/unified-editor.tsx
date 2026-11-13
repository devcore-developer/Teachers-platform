"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  CloudUpload,
  FileUp,
  GraduationCap,
  Loader2,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";

import { FileInput } from "@/components/media/file-input";
import {
  deleteSupervisorTrainingAttachmentAction,
  enrollSupervisorTeachersAction,
  publishSupervisorTrainingAction,
  saveSupervisorTrainingAction,
  setSupervisorCourseStatusAction,
} from "@/app/actions/supervision-training";
import {
  TRAINING_DOMAINS,
  TRAINING_SUBCATEGORIES,
  TRAINING_TYPES,
} from "@/config/training-domains";
import type {
  SupervisorTrainingProgress,
  TrainingWorkspace,
} from "@/lib/supervision/training";

import { TrainingAssessmentSection } from "./unified-assessment";
import { TrainingImpactSection } from "./unified-impact";
import { TrainingProgressSection } from "./unified-progress";
import { TrainingVideosSection } from "./unified-content";

/* ------------------------------------------------------------------ */
/* Unified training editor — ONE page for creating/editing a complete   */
/* professional training and publishing it.                             */
/*                                                                      */
/* NO SEQUENTIAL GATES: the page always renders on top of a persisted   */
/* DRAFT course (auto-created the moment the creation page opens), so   */
/* every section below is editable IMMEDIATELY and independently:       */
/*                                                                      */
/*   1. معلومات التدريب (العنوان، النوع، المجال، التصنيف، الوصف…)        */
/*   2. المدرب والمدرسة (مشتقة من الجلسة — للعرض فقط)                    */
/*   3. الجدول والروابط (التاريخ، المدة، رابط الاجتماع، يوتيوب)          */
/*   4. فيديوهات التدريب (رفع مباشر + ترتيب + حذف)                       */
/*   5. مرفقات التدريب (PDF/Word/صوت/صور…)                               */
/*   6. الاختبار النهائي (بناة الأسئلة المدمج + نسبة النجاح)             */
/*   7. قياس أثر التدريب (+ إضافة أداة قياس)                             */
/*   8. إسناد المعلمين                                                   */
/*   9. متابعة المعلمين والنتائج (التقدم + الاختبار + التصحيح + الشهادات) */
/*  10. شريط النشر (نشر التدريب) في أسفل الصفحة                          */
/*                                                                      */
/* Each section saves ITSELF through its own action and never touches   */
/* another section's fields — saving one never overwrites unsaved       */
/* edits elsewhere.                                                     */
/*                                                                      */
/* Every mutation re-verified server-side (requireSupervisorContext +   */
/* tenant fence); the form never sends a schoolId.                      */
/* ------------------------------------------------------------------ */

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: {
    id?: string;
    created?: boolean;
    enrolled?: number;
    courseId?: string;
    lessonsPublished?: number;
    assessmentPublished?: boolean;
    surveyPublished?: boolean;
  };
}

export const inputClass =
  "h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors focus:border-brand-600";

export function Feedback({ bad, text }: { bad: boolean; text: string }) {
  return (
    <p
      className={`flex items-start gap-1 text-xs font-semibold ${
        bad ? "text-destructive" : "text-success"
      }`}
      role={bad ? "alert" : "status"}
    >
      {bad ? (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0">{text}</span>
    </p>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span className="mt-1 block text-[11px] font-semibold text-destructive">
      {message}
    </span>
  );
}

export function SectionCard({
  icon,
  title,
  description,
  optional,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600/10 text-brand-600">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-black text-foreground">
            {title}
            {optional && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                اختياري
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function statusMeta(status: string): { label: string; className: string } {
  if (status === "PUBLISHED") {
    return { label: "منشور لمعلمي المدرسة", className: "text-success" };
  }
  if (status === "ARCHIVED") {
    return { label: "مؤرشف", className: "text-muted-foreground" };
  }
  return { label: "مسودة", className: "text-amber-600" };
}

/* ----------------------------- Editor ------------------------------ */

export function UnifiedTrainingEditor({
  workspace,
  progress,
}: {
  /** Always backed by a persisted DRAFT course — no locked state. */
  workspace: TrainingWorkspace;
  /** Per-teacher participation/results read model (loaded server-side). */
  progress?: SupervisorTrainingProgress | null;
}) {
  const router = useRouter();
  const courseId = workspace.course.id;
  const status = workspace.course.status;

  const [metaPending, setMetaPending] = React.useState(false);
  const [metaFeedback, setMetaFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);
  const [metaErrors, setMetaErrors] = React.useState<Record<string, string>>({});

  const course = workspace.course;

  async function handleMetaSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (metaPending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setMetaPending(true);
    setMetaFeedback(null);
    setMetaErrors({});

    const scheduledRaw = String(data.get("scheduledAt") ?? "").trim();
    const result = (await saveSupervisorTrainingAction({
      courseId,
      titleAr: String(data.get("titleAr") ?? ""),
      titleEn: String(data.get("titleEn") ?? "") || undefined,
      descriptionAr: String(data.get("descriptionAr") ?? ""),
      descriptionEn: String(data.get("descriptionEn") ?? "") || undefined,
      category: String(data.get("category") ?? ""),
      subcategory: String(data.get("subcategory") ?? "") || undefined,
      trainingType: String(data.get("trainingType") ?? "") || undefined,
      level: String(data.get("level") ?? "") || undefined,
      estimatedHours: data.get("estimatedHours")
        ? Number(data.get("estimatedHours"))
        : undefined,
      scheduledAt: scheduledRaw || undefined,
      meetingUrl: String(data.get("meetingUrl") ?? "").trim() || undefined,
      youtubeUrl: String(data.get("youtubeUrl") ?? "").trim() || undefined,
      supervisorInstructionsAr:
        String(data.get("supervisorInstructionsAr") ?? "").trim() || undefined,
    })) as ActionResult;

    setMetaPending(false);
    if (!result.ok) {
      setMetaErrors(result.fieldErrors ?? {});
      setMetaFeedback({ bad: true, text: result.message ?? "تعذر حفظ بيانات التدريب." });
      return;
    }

    // The course already exists (draft-first) — this is a pure update of
    // the meta section only; no other section is touched by this action.
    setMetaFeedback({
      bad: false,
      text: result.data?.created
        ? "تم إنشاء التدريب كمسودة — أكمل باقي الأقسام ثم انشره."
        : "تم حفظ بيانات التدريب.",
    });
    router.refresh();
  }

  const trainingType = course.trainingType ?? "";
  const isLiveType = trainingType === "" || trainingType === "VIRTUAL_LIVE";
  // Must match SUPERVISOR_DRAFT_TITLE in lib/supervision/training.ts
  // (kept as a literal here — server modules cannot cross the RSC
  // boundary into this client component).
  const isPlaceholderTitle = course.titleAr === "تدريب بدون عنوان";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      {/* Header */}
      <header className="rounded-xl border bg-card p-4">
        <Link
          href="/supervision/training"
          className="text-[11px] font-bold text-brand-600 hover:underline"
        >
          ← إدارة التدريب
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-black text-foreground">
              {isPlaceholderTitle ? "إنشاء تدريب احترافي جديد" : course.titleAr}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              كل الأقسام متاحة فورًا وفي أي ترتيب — لكل قسم زر حفظ خاص به،
              وحفظ قسم لا يمس تعديلات قسم آخر. عند الجاهزية اضغط «نشر
              التدريب» في أسفل الصفحة.
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-bold ${statusMeta(status).className}`}>
            {statusMeta(status).label}
          </span>
        </div>
      </header>

      {/* 1+2+3 — training info, trainer/school, schedule & links */}
      <SectionCard
        icon={<Save className="size-4" aria-hidden="true" />}
        title="معلومات التدريب"
        description="البيانات الأساسية والتصنيف والجدول والروابط ورسالتك للمعلمين — تُحفظ معًا."
      >
        <form onSubmit={handleMetaSave} className="space-y-4" noValidate>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                عنوان التدريب *
              </span>
              <input
                name="titleAr"
                defaultValue={course?.titleAr ?? ""}
                className={inputClass}
                maxLength={150}
                required
              />
              <FieldError message={metaErrors.titleAr} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                العنوان بالإنجليزية (اختياري)
              </span>
              <input
                name="titleEn"
                defaultValue={course?.titleEn ?? ""}
                className={inputClass}
                maxLength={150}
                dir="ltr"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                نوع التدريب *
              </span>
              <select
                name="trainingType"
                defaultValue={course?.trainingType ?? "VIRTUAL_LIVE"}
                className={inputClass}
              >
                {TRAINING_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                «افتراضي مباشر» يُظهر رابط الاجتماع للمعلمين؛ المسجّل والحضوري لا
                يتطلبان رابط اجتماع.
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                المجال الرئيسي *
              </span>
              <select name="category" defaultValue={course?.category ?? ""} className={inputClass} required>
                <option value="" disabled>
                  — اختر المجال —
                </option>
                {course?.category &&
                  !(TRAINING_DOMAINS as readonly string[]).includes(course.category) && (
                    <option value={course.category}>{course.category} (تصنيف حالي)</option>
                  )}
                {TRAINING_DOMAINS.map((domain) => (
                  <option key={domain} value={domain}>
                    {domain}
                  </option>
                ))}
              </select>
              <FieldError message={metaErrors.category} />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                التصنيف الفرعي
              </span>
              <select
                name="subcategory"
                defaultValue={course?.subcategory ?? "عام"}
                className={inputClass}
              >
                {TRAINING_SUBCATEGORIES.map((subcategory) => (
                  <option key={subcategory} value={subcategory}>
                    {subcategory}
                  </option>
                ))}
              </select>
              <FieldError message={metaErrors.subcategory} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                المستوى
              </span>
              <select name="level" defaultValue={course?.level ?? ""} className={inputClass}>
                <option value="">— بدون —</option>
                <option value="BEGINNER">مبتدئ</option>
                <option value="INTERMEDIATE">متوسط</option>
                <option value="ADVANCED">متقدم</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                الساعات التدريبية
              </span>
              <input
                name="estimatedHours"
                type="number"
                min={1}
                max={200}
                defaultValue={course?.estimatedHours ?? ""}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                تاريخ التدريب
              </span>
              <input
                name="scheduledAt"
                type="date"
                defaultValue={course?.scheduledAt ? course.scheduledAt.slice(0, 10) : ""}
                className={inputClass}
              />
              <FieldError message={metaErrors.scheduledAt} />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                رابط الاجتماع (Zoom / Google Meet)
              </span>
              <input
                name="meetingUrl"
                type="url"
                dir="ltr"
                defaultValue={course?.meetingUrl ?? ""}
                placeholder="https://zoom.us/j/…"
                className={inputClass}
              />
              <FieldError message={metaErrors.meetingUrl} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                رابط يوتيوب (اختياري)
              </span>
              <input
                name="youtubeUrl"
                type="url"
                dir="ltr"
                defaultValue={course?.youtubeUrl ?? ""}
                placeholder="https://www.youtube.com/watch?v=…"
                className={inputClass}
              />
              <FieldError message={metaErrors.youtubeUrl} />
            </label>

            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs font-bold text-foreground">
                وصف التدريب *
              </span>
              <textarea
                name="descriptionAr"
                rows={3}
                defaultValue={course?.descriptionAr ?? ""}
                className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-brand-600"
                maxLength={4000}
                required
              />
              <FieldError message={metaErrors.descriptionAr} />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs font-bold text-foreground">
                رسالة المشرف وتعليماته للمعلمين
              </span>
              <textarea
                name="supervisorInstructionsAr"
                rows={2}
                defaultValue={course?.supervisorInstructionsAr ?? ""}
                placeholder="مثال: يرجى مشاهدة جميع الفيديوهات بالكامل قبل الاختبار، وتحميل المرفقات ومراجعتها."
                className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-brand-600"
                maxLength={4000}
              />
              <span className="mt-1 block text-[11px] text-muted-foreground">
                تظهر للمعلمين في أعلى صفحة التدريب.
              </span>
              <FieldError message={metaErrors.supervisorInstructionsAr} />
            </label>
          </div>

          {/* Trainer + school — derived from the session, read-only */}
          <div className="grid gap-3 rounded-lg border border-dashed bg-muted/20 p-3 md:grid-cols-2">
            <div className="flex items-center gap-2">
              <UserRound className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-muted-foreground">المدرب / المشرف</p>
                <p className="truncate text-xs font-bold text-foreground">
                  {course?.instructorName ?? "حسابك الحالي (تُضبط تلقائيًا بعد الحفظ)"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-muted-foreground">المدرسة</p>
                <p className="truncate text-xs font-bold text-foreground">
                  {course?.schoolName ?? "مدرستك (تُشتق من حسابك تلقائيًا)"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={metaPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {metaPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              حفظ بيانات التدريب
            </button>
            {metaFeedback && <Feedback {...metaFeedback} />}
          </div>
        </form>
      </SectionCard>

      {/* 4 — training videos (available immediately — draft-first) */}
      <TrainingVideosSection courseId={courseId} workspace={workspace} />

      {/* 5 — training attachments (available immediately) */}
      <TrainingAttachmentsSection courseId={courseId} workspace={workspace} />

      {/* 6 — final assessment (available immediately) */}
      <TrainingAssessmentSection courseId={courseId} workspace={workspace} />

      {/* 7 — impact measurement (available immediately) */}
      <TrainingImpactSection courseId={courseId} workspace={workspace} />

      {/* 8 — teacher assignment */}
      <TrainingEnrollmentSection workspace={workspace} />

      {/* 9 — teacher participation, exam results, essay grading,
           certificates and impact responses — all in one place. */}
      <TrainingProgressSection courseId={courseId} workspace={workspace} progress={progress ?? null} />

      {/* 10 — publish bar */}
      <PublishBar courseId={courseId} status={status} lessonsCount={countLessons(workspace)} />

      {isLiveType && course?.meetingUrl === null && status === "PUBLISHED" && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-relaxed text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          التدريب من نوع «افتراضي مباشر» ولم تُضف رابط اجتماع بعد — أضف رابط
          Zoom أو Google Meet أعلاه ليصل المعلمون إلى الاجتماع.
        </p>
      )}
    </div>
  );
}

function countLessons(workspace: TrainingWorkspace): number {
  return workspace.sections.reduce(
    (sum, section) => sum + section.lessons.length,
    0
  );
}

/* -------------------------- Attachments ---------------------------- */

function TrainingAttachmentsSection({
  courseId,
  workspace,
}: {
  courseId: string;
  workspace: TrainingWorkspace;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  async function removeAttachment(attachmentId: string) {
    if (!window.confirm("حذف هذا المرفق نهائيًا — متابعة؟")) return;
    setPendingId(attachmentId);
    const result = await deleteSupervisorTrainingAttachmentAction(attachmentId);
    setPendingId(null);
    if (!result.ok) {
      window.alert(result.message);
      return;
    }
    router.refresh();
  }

  function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return (
    <SectionCard
      icon={<FileUp className="size-4" aria-hidden="true" />}
      title="مرفقات التدريب"
      description="ملفات PDF وWord وExcel وPowerPoint وصوت وصور — يراها المعلمون قابلة للتنزيل بعد النشر."
      optional
    >
      {workspace.attachments.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-4 text-center text-[11px] text-muted-foreground">
          لا مرفقات بعد — أضف أول ملف من أداة الرفع أدناه.
        </p>
      ) : (
        <ul className="mb-4 space-y-2">
          {workspace.attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-foreground">
                  {attachment.originalName}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {attachment.mimeType} · {formatBytes(attachment.sizeBytes)}
                </p>
              </div>
              <button
                type="button"
                disabled={pendingId === attachment.id}
                onClick={() => removeAttachment(attachment.id)}
                className="inline-flex size-7 items-center justify-center rounded-lg border bg-card text-destructive transition-colors hover:bg-accent disabled:opacity-40"
                aria-label="حذف المرفق"
                title="حذف المرفق"
              >
                {pendingId === attachment.id ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-3.5" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <FileInput
        onChange={() => router.refresh()}
        attachTo={{ type: "course-attachment", courseId }}
        label="إضافة مرفق من جهازك"
        hint="PDF / Word / Excel / PowerPoint / MP3 وWAV / صور / نص — حتى 25 ميجابايت"
      />
    </SectionCard>
  );
}

/* -------------------------- Enrollment ----------------------------- */

function TrainingEnrollmentSection({ workspace }: { workspace: TrainingWorkspace }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  const enrolledIds = new Set(workspace.enrollments.map((row) => row.userId));
  const available = workspace.teachers.filter((teacher) => !enrolledIds.has(teacher.id));
  const published = workspace.course.status === "PUBLISHED";

  async function assign() {
    if (pending || selected.length === 0) return;
    setPending(true);
    setFeedback(null);
    const result = (await enrollSupervisorTeachersAction(
      workspace.course.id,
      selected
    )) as ActionResult;
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذر الإسناد." });
      return;
    }
    setSelected([]);
    setFeedback({
      bad: false,
      text: `تم إسناد التدريب إلى ${result.data?.enrolled ?? selected.length} معلمًا.`,
    });
    router.refresh();
  }

  return (
    <SectionCard
      icon={<GraduationCap className="size-4" aria-hidden="true" />}
      title="إسناد المعلمين"
      description={
        published
          ? "أسند التدريب لمعلميك المسندَين إليك — أو يسجلون بأنفسهم من الأكاديمية."
          : "انشر التدريب أولًا لتتمكن من إسناده إلى معلميك."
      }
    >
      {feedback && (
        <div className="mb-3">
          <Feedback {...feedback} />
        </div>
      )}

      {workspace.enrollments.length > 0 && (
        <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto">
          {workspace.enrollments.map((row) => (
            <li
              key={row.userId}
              className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5"
            >
              <span className="min-w-0 truncate text-xs font-bold">{row.name}</span>
              {row.completedAt ? (
                <span className="shrink-0 text-[10px] font-bold text-success">أتم التدريب ✓</span>
              ) : (
                <span className="shrink-0 text-[10px] text-muted-foreground">مسجل</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!published ? (
        <p className="text-[11px] text-muted-foreground">
          الإسناد متاح بعد النشر — أكمل بناء التدريب ثم اضغط «نشر التدريب».
        </p>
      ) : available.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          كل معلميك المسندون مسجلون في هذا التدريب — أو لا يوجد معلمون مسندون بعد.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
            {available.map((teacher) => (
              <label
                key={teacher.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(teacher.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, teacher.id]
                        : current.filter((id) => id !== teacher.id)
                    )
                  }
                  className="size-3.5 accent-[var(--brand-600)]"
                />
                {teacher.name}
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={assign}
            disabled={pending || selected.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            إسناد ({selected.length})
          </button>
        </div>
      )}
    </SectionCard>
  );
}

/* -------------------------- Publish bar ---------------------------- */

function PublishBar({
  courseId,
  status,
  lessonsCount,
}: {
  courseId: string;
  status: string;
  lessonsCount: number;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  async function run(
    action: () => Promise<ActionResult>,
    confirmText: string | null,
    successText: string
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setPending(true);
    setFeedback(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذرت العملية." });
      return;
    }
    setFeedback({ bad: false, text: successText });
    router.refresh();
  }

  return (
    <section
      id="publish"
      className="rounded-xl border-2 border-brand-600/40 bg-brand-600/5 px-4 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-foreground">
            <ClipboardCheck className="me-1.5 inline size-4 text-brand-600" aria-hidden="true" />
            نشر التدريب
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            يتحقق الخادم من المحتوى والاختبار وأداة القياس ثم ينشرها جميعًا معًا
            داخل معاملة واحدة — {lessonsCount} عنصر محتوى جاهز.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status !== "PUBLISHED" && status !== "ARCHIVED" && (
            <button
              type="button"
              disabled={pending || lessonsCount === 0}
              onClick={() =>
                run(
                  () => publishSupervisorTrainingAction({ courseId }),
                  "النشر يجعل التدريب متاحًا لمعلمي المدرسة ويفتح الرحلة الإلزامية — متابعة؟",
                  "تم نشر التدريب بنجاح — أصبح متاحًا في قائمة معلمي المدرسة."
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <CloudUpload className="size-4" aria-hidden="true" />
              )}
              نشر التدريب
            </button>
          )}
          {status === "PUBLISHED" && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => setSupervisorCourseStatusAction({ courseId, status: "DRAFT" }),
                  "إلغاء النشر يخفي التدريب عن المعلمين — متابعة؟",
                  "تم إلغاء النشر — التدريب عاد إلى مسودة."
                )
              }
              className="rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-muted-foreground hover:bg-accent disabled:opacity-60"
            >
              إلغاء النشر
            </button>
          )}
          {status !== "ARCHIVED" && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => setSupervisorCourseStatusAction({ courseId, status: "ARCHIVED" }),
                  "أرشفة التدريب؟ يمكن إعادته من الأرشيف لاحقًا.",
                  "تم أرشفة التدريب."
                )
              }
              className="rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-destructive hover:bg-accent disabled:opacity-60"
            >
              أرشفة
            </button>
          )}
        </div>
      </div>
      {feedback && (
        <div className="mt-3">
          <Feedback {...feedback} />
        </div>
      )}
    </section>
  );
}
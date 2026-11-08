"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

import { ImageInput } from "@/components/media/image-input";
import { VideoInput } from "@/components/media/video-input";
import {
  deleteSupervisorLessonAction,
  deleteSupervisorSectionAction,
  enrollSupervisorTeachersAction,
  moveSupervisorLessonAction,
  moveSupervisorSectionAction,
  saveSupervisorCoursePolicyAction,
  saveSupervisorLessonAction,
  saveSupervisorSectionAction,
  setSupervisorCourseStatusAction as setStatusAction,
  setSupervisorLessonPublishedAction,
  updateSupervisorCourseAction,
} from "@/app/actions/supervision-training";

/* ------------------------------------------------------------------ */
/* Supervisor course builder — sections, lessons, dual-mode videos      */
/* (رفع مباشر إلى R2 أو رابط خارجي), cover upload, publish workflow,    */
/* and teacher assignment. Every mutation re-verified server-side.      */
/* ------------------------------------------------------------------ */

interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: { id?: string; enrolled?: number };
}

export interface BuilderSection {
  id: string;
  titleAr: string;
  description: string | null;
  orderIndex: number;
  lessons: {
    id: string;
    titleAr: string;
    description: string | null;
    type: string;
    content: string | null;
    videoUrl: string | null;
    isPublished: boolean;
    orderIndex: number;
  }[];
}

interface CourseBuilderProps {
  course: {
    id: string;
    titleAr: string;
    titleEn: string | null;
    descriptionAr: string;
    descriptionEn: string | null;
    category: string;
    level: string | null;
    estimatedHours: number | null;
    status: string;
    programId: string | null;
  };
  coverUrl: string | null;
  sections: BuilderSection[];
  teachers: Array<{ id: string; name: string }>;
  enrollments: Array<{ userId: string; name: string; completedAt: string | null }>;
  assessments: Array<{
    id: string;
    titleAr: string;
    status: string;
    questionsCount: number;
  }>;
  programs: Array<{ id: string; nameAr: string; platformWide: boolean }>;
  categories: string[];
  /** Mandatory-learning policy (sequential unlocking + watch threshold). */
  policy: {
    requireSequentialLessons: boolean;
    lessonCompletionThreshold: number;
  };
}

const LESSON_TYPES = [
  { value: "TEXT", label: "درس نصي" },
  { value: "VIDEO", label: "فيديو (رفع أو رابط)" },
  { value: "EXTERNAL_VIDEO", label: "فيديو خارجي" },
];

const LEVELS = [
  { value: "BEGINNER", label: "مبتدئ" },
  { value: "INTERMEDIATE", label: "متوسط" },
  { value: "ADVANCED", label: "متقدم" },
];

const inputClass =
  "h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors focus:border-brand-600";

function Feedback({ bad, text }: { bad: boolean; text: string }) {
  return (
    <p
      className={`flex items-center gap-1 text-xs font-semibold ${
        bad ? "text-destructive" : "text-success"
      }`}
      role={bad ? "alert" : "status"}
    >
      {bad ? (
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      {text}
    </p>
  );
}

/**
 * Read the real duration of a video URL in the instructor's browser
 * (metadata only, 8s timeout). The value is stored on the lesson and
 * becomes the server-side basis of the mandatory watch threshold —
 * students can never influence it.
 */
async function probeVideoDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !url) {
      resolve(null);
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);
    function cleanup() {
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // Ignore — element is detached.
      }
    }
    video.onloadedmetadata = () => {
      const value = video.duration;
      cleanup();
      resolve(Number.isFinite(value) && value > 0 ? Math.round(value) : null);
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
    video.src = url;
  });
}

export function CourseBuilder(props: CourseBuilderProps) {
  const router = useRouter();
  const { course } = props;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/supervision/training"
            className="text-[11px] font-bold text-brand-600 hover:underline"
          >
            ← دورات مدرستك
          </Link>
          <h1 className="mt-1 truncate text-xl font-black text-foreground">
            {course.titleAr}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            الحالة:{" "}
            <span
              className={`font-bold ${
                course.status === "PUBLISHED" ? "text-success" : "text-amber-600"
              }`}
            >
              {course.status === "PUBLISHED"
                ? "منشورة لمعلمي المدرسة"
                : course.status === "ARCHIVED"
                  ? "مؤرشفة"
                  : "مسودة"}
            </span>
          </p>
        </div>
        <PublishControls courseId={course.id} status={course.status} />
      </header>

      <CourseMetaEditor {...props} />

      <LearningPolicyEditor courseId={course.id} policy={props.policy} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionsPanel sections={props.sections} courseId={course.id} />
        </div>
        <div className="space-y-4">
          <EnrollmentPanel {...props} />
          <AssessmentsPanel assessments={props.assessments} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Publish ---------------------------- */

function PublishControls({ courseId, status }: { courseId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  async function run(next: "PUBLISHED" | "DRAFT" | "ARCHIVED", confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setPending(true);
    setFeedback(null);
    const result = (await setStatusAction({ courseId, status: next }));
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذر تغيير الحالة." });
      return;
    }
    setFeedback({ bad: false, text: "تم تحديث حالة الدورة." });
    router.refresh();
  }

  return (
    <div className="space-y-2 text-start">
      <div className="flex flex-wrap gap-2">
        {status !== "PUBLISHED" && status !== "ARCHIVED" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("PUBLISHED", "نشر الدورة يجعلها متاحة لمعلمي المدرسة — متابعة؟")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            نشر الدورة
          </button>
        )}
        {status === "PUBLISHED" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("DRAFT", "إلغاء النشر يخفي الدورة عن المعلمين — متابعة؟")}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-muted-foreground hover:bg-accent disabled:opacity-60"
          >
            إلغاء النشر
          </button>
        )}
        {status !== "ARCHIVED" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("ARCHIVED", "أرشفة الدورة؟ يمكن إعادتها من الأرشيف لاحقًا.")}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-destructive hover:bg-accent disabled:opacity-60"
          >
            أرشفة
          </button>
        )}
      </div>
      {feedback && <Feedback {...feedback} />}
    </div>
  );
}

/* --------------------------- Course meta --------------------------- */

function CourseMetaEditor(props: CourseBuilderProps) {
  const router = useRouter();
  const { course } = props;
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setFeedback(null);
    setFieldErrors({});
    const result = (await updateSupervisorCourseAction({
      courseId: course.id,
      titleAr: String(data.get("titleAr") ?? ""),
      titleEn: String(data.get("titleEn") ?? "") || undefined,
      descriptionAr: String(data.get("descriptionAr") ?? ""),
      descriptionEn: String(data.get("descriptionEn") ?? "") || undefined,
      category: String(data.get("category") ?? ""),
      level: String(data.get("level") ?? "") || undefined,
      estimatedHours: data.get("estimatedHours") ? Number(data.get("estimatedHours")) : undefined,
      programId: String(data.get("programId") ?? "") || undefined,
    }));
    setPending(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      setFeedback({ bad: true, text: result.message ?? "تعذر حفظ بيانات الدورة." });
      return;
    }
    setFeedback({ bad: false, text: "تم حفظ بيانات الدورة." });
    router.refresh();
  }

  return (
    <section className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-start"
      >
        <span className="text-sm font-black text-foreground">
          بيانات الدورة وصورة الغلاف
        </span>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="space-y-4 border-t p-4">
          <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-2" noValidate>
            <label className="block">
              <span className="mb-1 block text-xs font-bold">العنوان بالعربية *</span>
              <input name="titleAr" defaultValue={course.titleAr} className={inputClass} required />
              {fieldErrors.titleAr && (
                <span className="mt-1 block text-[11px] font-semibold text-destructive">
                  {fieldErrors.titleAr}
                </span>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold">العنوان بالإنجليزية</span>
              <input name="titleEn" defaultValue={course.titleEn ?? ""} className={inputClass} dir="ltr" />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs font-bold">الوصف بالعربية *</span>
              <textarea
                name="descriptionAr"
                defaultValue={course.descriptionAr}
                rows={3}
                className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-brand-600"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold">التصنيف *</span>
              <input
                name="category"
                defaultValue={course.category}
                className={inputClass}
                list="builder-course-categories"
                required
              />
              <datalist id="builder-course-categories">
                {props.categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold">المستوى</span>
              <select name="level" defaultValue={course.level ?? ""} className={inputClass}>
                <option value="">— بدون —</option>
                {LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold">الساعات المتوقعة</span>
              <input
                name="estimatedHours"
                type="number"
                min={1}
                max={200}
                defaultValue={course.estimatedHours ?? ""}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold">البرنامج التدريبي</span>
              <select name="programId" defaultValue={course.programId ?? ""} className={inputClass}>
                <option value="">— بدون برنامج —</option>
                {props.programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.nameAr}
                    {program.platformWide ? " (مشترك)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-3 md:col-span-2">
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                حفظ البيانات
              </button>
              {feedback && <Feedback {...feedback} />}
            </div>
          </form>

          <div className="border-t pt-4">
            <ImageInput
              value={props.coverUrl}
              onChange={() => router.refresh()}
              label="صورة غلاف الدورة"
              hint="رابط خارجي أو رفع مباشر — PNG/JPG/WEBP/GIF حتى 5MB"
              attachTo={{ type: "course-cover", courseId: course.id }}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              عند الرفع يتم تسجيل الغلاف على الخادم وربطه بالدورة تلقائيًا.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/* ----------------------------- Sections ---------------------------- */

function SectionsPanel({
  sections,
  courseId,
}: {
  sections: BuilderSection[];
  courseId: string;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);

  async function addSection(event: React.FormEvent) {
    event.preventDefault();
    if (pending || title.trim().length < 2) return;
    setPending(true);
    setFeedback(null);
    const result = (await saveSupervisorSectionAction({
      courseId,
      titleAr: title.trim(),
    }));
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذر إضافة القسم." });
      return;
    }
    setTitle("");
    router.refresh();
  }

  async function act(action: () => ActionResult | Promise<ActionResult>) {
    setFeedback(null);
    const result = await action();
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذرت العملية." });
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <Panel title="الأقسام والدروس">
      <form onSubmit={addSection} className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="اسم القسم الجديد — مثال: الوحدة الأولى"
          className={`${inputClass} min-w-0 flex-1`}
          maxLength={120}
        />
        <button
          type="submit"
          disabled={pending || title.trim().length < 2}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-3.5" aria-hidden="true" />
          )}
          إضافة قسم
        </button>
      </form>
      {feedback && (
        <div className="mt-2">
          <Feedback {...feedback} />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {sections.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
            لا أقسام بعد — أضف أول قسم ثم ابدأ بإضافة الدروس داخله.
          </p>
        ) : (
          sections.map((section, index) => (
            <div key={section.id} className="rounded-xl border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                {renaming === section.id ? (
                  <SectionRename
                    section={section}
                    onDone={async (newTitle) => {
                      setRenaming(null);
                      if (!newTitle) return;
                      await act(() =>
                        saveSupervisorSectionAction({
                          courseId,
                          sectionId: section.id,
                          titleAr: newTitle,
                        })
                      );
                    }}
                  />
                ) : (
                  <p className="text-sm font-bold text-foreground">
                    {index + 1}. {section.titleAr}
                  </p>
                )}
                <div className="flex items-center gap-1">
                  <IconButton
                    label="تحريك لأعلى"
                    disabled={index === 0}
                    onClick={() =>
                      act(() => moveSupervisorSectionAction(section.id, "up"))
                    }
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label="تحريك لأسفل"
                    disabled={index === sections.length - 1}
                    onClick={() =>
                      act(() => moveSupervisorSectionAction(section.id, "down"))
                    }
                  >
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </IconButton>
                  <IconButton label="إعادة تسمية" onClick={() => setRenaming(section.id)}>
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label="حذف القسم ودروسه"
                    destructive
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "حذف القسم سيحذف كل دروسه ومقاطع الفيديو المرتبطة به — متابعة؟"
                        )
                      ) {
                        return;
                      }
                      await act(() => deleteSupervisorSectionAction(section.id));
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
              <LessonsList section={section} />
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-black text-foreground">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
  destructive,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex size-7 items-center justify-center rounded-lg border bg-card transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 ${
        destructive ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SectionRename({
  section,
  onDone,
}: {
  section: BuilderSection;
  onDone: (newTitle: string | null) => void;
}) {
  const [value, setValue] = React.useState(section.titleAr);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={`${inputClass} h-8 min-w-0 flex-1`}
        maxLength={120}
        autoFocus
      />
      <IconButton label="حفظ" onClick={() => onDone(value.trim())}>
        <Save className="size-3.5" aria-hidden="true" />
      </IconButton>
      <IconButton label="إلغاء" onClick={() => onDone(null)}>
        <X className="size-3.5" aria-hidden="true" />
      </IconButton>
    </span>
  );
}

/* ------------------------------ Lessons ---------------------------- */

function LessonsList({ section }: { section: BuilderSection }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  async function act(action: () => ActionResult | Promise<ActionResult>) {
    setFeedback(null);
    const result = await action();
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذرت العملية." });
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="p-3">
      {feedback && (
        <div className="mb-2">
          <Feedback {...feedback} />
        </div>
      )}
      {section.lessons.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-center text-[11px] text-muted-foreground">
          لا دروس في هذا القسم بعد.
        </p>
      )}
      <ul className="space-y-2">
        {section.lessons.map((lesson, index) =>
          editingId === lesson.id ? (
            <li key={lesson.id}>
              <LessonForm
                sectionId={section.id}
                lesson={lesson}
                onDone={async (payload) => {
                  setEditingId(null);
                  if (!payload) return;
                  await act(() => saveSupervisorLessonAction(payload));
                }}
              />
            </li>
          ) : (
            <li
              key={lesson.id}
              className="rounded-lg border bg-muted/20 px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-foreground">
                    {index + 1}. {lesson.titleAr}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {lesson.type === "TEXT"
                      ? "درس نصي"
                      : lesson.type === "VIDEO"
                        ? "فيديو مرفوع أو مُدار"
                        : "فيديو خارجي"}
                    {lesson.videoUrl ? " · فيه فيديو" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      act(() =>
                        setSupervisorLessonPublishedAction(lesson.id, !lesson.isPublished)
                      )
                    }
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      lesson.isPublished
                        ? "bg-success-soft text-success"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {lesson.isPublished ? "منشور للمعلمين" : "مسودة"}
                  </button>
                  <IconButton
                    label="تحريك لأعلى"
                    disabled={index === 0}
                    onClick={() =>
                      act(() => moveSupervisorLessonAction(lesson.id, "up"))
                    }
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label="تحريك لأسفل"
                    disabled={index === section.lessons.length - 1}
                    onClick={() =>
                      act(() => moveSupervisorLessonAction(lesson.id, "down"))
                    }
                  >
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </IconButton>
                  <IconButton label="تعديل الدرس" onClick={() => setEditingId(lesson.id)}>
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label="حذف الدرس"
                    destructive
                    onClick={async () => {
                      if (!window.confirm("حذف هذا الدرس نهائيًا — متابعة؟")) return;
                      await act(() => deleteSupervisorLessonAction(lesson.id));
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            </li>
          )
        )}
      </ul>

      {adding ? (
        <div className="mt-3">
          <LessonForm
            sectionId={section.id}
            lesson={null}
            onDone={async (payload) => {
              setAdding(false);
              if (!payload) return;
              await act(() => saveSupervisorLessonAction(payload));
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-bold text-brand-600 hover:bg-accent"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          إضافة درس
        </button>
      )}
    </div>
  );
}

interface LessonFormPayload {
  sectionId: string;
  lessonId?: string;
  titleAr: string;
  description?: string;
  type: "TEXT" | "VIDEO" | "EXTERNAL_VIDEO";
  content?: string;
  videoUrl?: string;
  isPublished?: boolean;
  /** Media length in seconds (instructor-browser metadata). */
  durationSeconds?: number;
}

function LessonForm({
  sectionId,
  lesson,
  onDone,
}: {
  sectionId: string;
  lesson: BuilderSection["lessons"][number] | null;
  onDone: (payload: LessonFormPayload | null) => void;
}) {
  const [title, setTitle] = React.useState(lesson?.titleAr ?? "");
  const [description, setDescription] = React.useState(lesson?.description ?? "");
  const [type, setType] = React.useState<"TEXT" | "VIDEO" | "EXTERNAL_VIDEO">(
    (lesson?.type as "TEXT" | "VIDEO" | "EXTERNAL_VIDEO") ?? "VIDEO"
  );
  const [content, setContent] = React.useState(lesson?.content ?? "");
  const [videoUrl, setVideoUrl] = React.useState(lesson?.videoUrl ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = React.useState<number | null>(null);
  const [probing, setProbing] = React.useState(false);

  // Probe the video duration whenever the URL is set — the value is
  // stored with the lesson and powers the server-side completion check.
  React.useEffect(() => {
    let cancelled = false;
    if (type === "TEXT" || !videoUrl.trim()) {
      setDurationSeconds(null);
      setProbing(false);
      return;
    }
    setProbing(true);
    void probeVideoDuration(videoUrl.trim()).then((value) => {
      if (cancelled) return;
      setDurationSeconds(value);
      setProbing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [type, videoUrl]);

  async function submit() {
    if (title.trim().length < 2) {
      setError("عنوان الدرس مطلوب (حرفان على الأقل).");
      return;
    }
    if (type === "TEXT" && content.trim().length === 0) {
      setError("محتوى الدرس النصي مطلوب.");
      return;
    }
    if (type !== "TEXT" && videoUrl.trim().length === 0) {
      setError("أضف الفيديو أولًا — ارفع ملفًا أو أدخل رابطًا خارجيًا ثم اضغط تعيين الرابط.");
      return;
    }
    setError(null);
    onDone({
      sectionId,
      lessonId: lesson?.id,
      titleAr: title.trim(),
      description: description.trim() || undefined,
      type,
      content: type === "TEXT" ? content.trim() : undefined,
      videoUrl: type === "TEXT" ? undefined : videoUrl.trim(),
      isPublished: lesson?.isPublished ?? false,
      durationSeconds: type === "TEXT" ? undefined : (durationSeconds ?? undefined),
    });
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold">عنوان الدرس *</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
            maxLength={150}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">وصف مختصر</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={inputClass}
            maxLength={500}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold">نوع الدرس *</span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
            className={inputClass}
          >
            {LESSON_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {type === "TEXT" ? (
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-bold">محتوى الدرس *</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={5}
            maxLength={20000}
            className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-brand-600"
          />
        </label>
      ) : (
        <div className="mt-3">
          <VideoInput
            value={videoUrl}
            onChange={(url) => setVideoUrl(url ?? "")}
            label="فيديو الدرس"
            hint={
              type === "EXTERNAL_VIDEO"
                ? "ألصق رابطًا خارجيًا يبدأ بـ https://"
                : "رابط خارجي أو رفع مباشر — MP4/WEBM حتى 512MB"
            }
            attachTo={lesson?.id ? { type: "lesson-media", lessonId: lesson.id } : undefined}
          />
        </div>
      )}

      {type !== "TEXT" && videoUrl.trim() && (
        <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
          {probing
            ? "جارٍ قراءة مدة الفيديو…"
            : durationSeconds
              ? `مدة الفيديو: ${Math.floor(durationSeconds / 60)} دقيقة و${durationSeconds % 60} ثانية — تُستخدم لحساب نسبة الإتمام على الخادم.`
              : "لم تُقرأ مدة الفيديو — سيُعتمد التقدير من مشغّل الطالب (الأفضل إعادة حفظ الفيديو لالتقاط المدة)."}
        </p>
      )}

      {error && (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
        >
          <Save className="size-3.5" aria-hidden="true" />
          {lesson ? "حفظ التعديلات" : "إضافة الدرس"}
        </button>
        <button
          type="button"
          onClick={() => onDone(null)}
          className="rounded-lg border bg-card px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-accent"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

/* --------------------------- Enrollments --------------------------- */

function EnrollmentPanel({
  course,
  teachers,
  enrollments,
}: CourseBuilderProps) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  const enrolledIds = new Set(enrollments.map((row) => row.userId));
  const available = teachers.filter((teacher) => !enrolledIds.has(teacher.id));

  async function assign() {
    if (pending || selected.length === 0) return;
    setPending(true);
    setFeedback(null);
    const result = (await enrollSupervisorTeachersAction(
      course.id,
      selected
    ));
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذر الإسناد." });
      return;
    }
    setSelected([]);
    setFeedback({
      bad: false,
      text: `تم إسناد الدورة إلى ${result.data?.enrolled ?? selected.length} معلمًا.`,
    });
    router.refresh();
  }

  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-black text-foreground">
          الإسناد والتسجيل ({enrollments.length})
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {course.status === "PUBLISHED"
            ? "أسند الدورة لمعلميك المسندَين إليك — أو سجلوا بأنفسهم من الأكاديمية."
            : "انشر الدورة أولًا لتتمكن من إسنادها."}
        </p>
      </div>
      <div className="p-4">
        {feedback && (
          <div className="mb-2">
            <Feedback {...feedback} />
          </div>
        )}

        {enrollments.length > 0 && (
          <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto">
            {enrollments.map((row) => (
              <li
                key={row.userId}
                className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate text-xs font-bold">{row.name}</span>
                {row.completedAt ? (
                  <span className="shrink-0 text-[10px] font-bold text-success">أتمها ✓</span>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground">مسجل</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {available.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            كل معلميك المسندون مسجلون في هذه الدورة — أو لا يوجد معلمون مسندون بعد.
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
      </div>
    </section>
  );
}

/* --------------------------- Assessments --------------------------- */

function AssessmentsPanel({
  assessments,
}: {
  assessments: CourseBuilderProps["assessments"];
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-black text-foreground">اختبارات الدورة</h2>
      </div>
      <div className="p-4">
        {assessments.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            لا اختبارات مرتبطة بهذه الدورة — أنشئ اختبارًا من صفحة «الأسئلة
            والاختبارات» واربطه بهذه الدورة.
          </p>
        ) : (
          <ul className="space-y-2">
            {assessments.map((assessment) => (
              <li
                key={assessment.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-2.5 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold">{assessment.titleAr}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {assessment.questionsCount} سؤالًا
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    assessment.status === "PUBLISHED"
                      ? "bg-success-soft text-success"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {assessment.status === "PUBLISHED" ? "منشور" : "مسودة"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/supervision/assessments"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-bold text-brand-600 hover:bg-accent"
        >
          إدارة الاختبارات
        </Link>
      </div>
    </section>
  );
}

/* ------------------- Mandatory learning policy --------------------- */

function LearningPolicyEditor({
  courseId,
  policy,
}: {
  courseId: string;
  policy: { requireSequentialLessons: boolean; lessonCompletionThreshold: number };
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [sequential, setSequential] = React.useState(policy.requireSequentialLessons);
  const [threshold, setThreshold] = React.useState(policy.lessonCompletionThreshold);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);

  async function handleSave() {
    if (pending) return;
    setPending(true);
    setFeedback(null);
    const result = (await saveSupervisorCoursePolicyAction({
      courseId,
      requireSequentialLessons: sequential,
      lessonCompletionThreshold: threshold,
    }));
    setPending(false);
    if (!result.ok) {
      setFeedback({
        bad: true,
        text: result.message ?? "تعذر حفظ إعدادات التعلم الإلزامي.",
      });
      return;
    }
    setFeedback({ bad: false, text: "تم حفظ إعدادات التعلم الإلزامي." });
    router.refresh();
  }

  return (
    <section className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-start"
      >
        <span className="text-sm font-black text-foreground">
          إعدادات التعلم الإلزامي — التسلسل ونسبة المشاهدة
        </span>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t p-4">
          <label className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
            <input
              type="checkbox"
              checked={sequential}
              onChange={(event) => setSequential(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[#1D5BD6]"
            />
            <span>
              <span className="font-bold">فتح الدروس بالترتيب:</span> يُفتح كل
              درس فقط بعد إكمال ما قبله (التقييمات تبقى مقفلة حتى إكمال كل
              الدروس). الإيقاف يتيح للمعلمين فتح أي درس بحرية.
            </span>
          </label>
          <label className="block max-w-64">
            <span className="mb-1 block text-xs font-bold">
              نسبة المشاهدة المطلوبة لإتمام درس الفيديو (%)
            </span>
            <input
              type="number"
              min={50}
              max={100}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
              className={inputClass}
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
              من 50 إلى 100 — الافتراضي 95%. يُحتسب الإتمام على الخادم من وقت
              المشاهدة الفعلي، ولا يمكن للطالب تعديله أو تخطيه.
            </span>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              حفظ الإعدادات
            </button>
            {feedback && <Feedback {...feedback} />}
          </div>
        </div>
      )}
    </section>
  );
}
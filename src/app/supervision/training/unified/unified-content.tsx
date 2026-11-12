"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { VideoInput } from "@/components/media/video-input";
import { parseYouTubeUrl } from "@/lib/media/video-url";
import {
  deleteSupervisorLessonAction,
  moveSupervisorLessonAction,
  saveSupervisorLessonAction,
  saveSupervisorSectionAction,
} from "@/app/actions/supervision-training";
import type { TrainingWorkspace } from "@/lib/supervision/training";

import { Feedback, SectionCard } from "./unified-editor";

/* ------------------------------------------------------------------ */
/* Training Videos section — upload from the device, multiple videos,   */
/* ordered list, remove/reorder, title + upload status + progress.      */
/*                                                                      */
/* Reuses the existing lesson architecture: every video is a            */
/* CourseLesson(type VIDEO) inside the course's content section, with   */
/* the R2 presigned upload pipeline and the server-side watch-duration  */
/* capture. Nothing new is stored.                                      */
/* ------------------------------------------------------------------ */

interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: { id?: string };
}

const inputClass =
  "h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-colors focus:border-brand-600";

/**
 * Read the real duration of a video URL in the supervisor's browser
 * (metadata only, 8s timeout) — stored on the lesson and powers the
 * server-side mandatory-watch threshold. YouTube links are exempt: the
 * governed IFrame player reports their duration to the same ledger.
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

export interface VideoRow {
  id: string;
  titleAr: string;
  description: string | null;
  videoUrl: string | null;
  durationSeconds: number | null;
  isPublished: boolean;
}

export function TrainingVideosSection({
  courseId,
  workspace,
}: {
  courseId: string;
  workspace: TrainingWorkspace;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{ bad: boolean; text: string } | null>(null);
  const [pending, setPending] = React.useState(false);

  // Videos live in the FIRST content section (created lazily on the
  // first video of a new training; existing courses keep their section).
  const contentSection = workspace.sections[0] ?? null;
  const videoRows: VideoRow[] = (workspace.sections ?? [])
    .flatMap((section) => section.lessons)
    .filter((lesson) => lesson.type === "VIDEO" || lesson.type === "EXTERNAL_VIDEO")
    .map((lesson) => ({
      id: lesson.id,
      titleAr: lesson.titleAr,
      description: lesson.description,
      videoUrl: lesson.videoUrl,
      durationSeconds: lesson.durationSeconds,
      isPublished: lesson.isPublished,
    }));

  async function ensureSection(): Promise<string | null> {
    if (contentSection) return contentSection.id;
    const created = (await saveSupervisorSectionAction({
      courseId,
      titleAr: "محتوى التدريب",
    })) as ActionResult;
    if (!created.ok) {
      setFeedback({ bad: true, text: created.message ?? "تعذر إنشاء قسم المحتوى." });
      return null;
    }
    return created.data?.id ?? null;
  }

  async function act(action: () => Promise<ActionResult>): Promise<boolean> {
    setPending(true);
    setFeedback(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setFeedback({ bad: true, text: result.message ?? "تعذرت العملية." });
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <SectionCard
      icon={<Plus className="size-4" aria-hidden="true" />}
      title="فيديوهات التدريب"
      description="ارفع الفيديوهات من جهازك مباشرة أو ألصق رابط يوتيوب — تُعرض للمعلمين بالترتيب مع مشغّل إلزامي يحتسب المشاهدة على الخادم."
    >
      {feedback && (
        <div className="mb-3">
          <Feedback {...feedback} />
        </div>
      )}

      {videoRows.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-5 text-center text-[11px] text-muted-foreground">
          لا فيديوهات بعد — أضف أول فيديو من الأسفل.
        </p>
      )}

      <ul className="space-y-2">
        {videoRows.map((video, index) =>
          editingId === video.id ? (
            <li key={video.id}>
              <VideoForm
                video={video}
                onDone={async (payload) => {
                  setEditingId(null);
                  if (!payload) return;
                  await act(() => saveSupervisorLessonAction(payload));
                }}
              />
            </li>
          ) : (
            <li key={video.id} className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-foreground">
                    {index + 1}. {video.titleAr}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {video.videoUrl
                      ? parseYouTubeUrl(video.videoUrl)
                        ? "رابط يوتيوب"
                        : "فيديو مرفوع"
                      : "بدون فيديو"}
                    {video.durationSeconds
                      ? ` · ${Math.floor(video.durationSeconds / 60)}:${String(
                          video.durationSeconds % 60
                        ).padStart(2, "0")} دقيقة`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      video.isPublished
                        ? "bg-success-soft text-success"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {video.isPublished ? "جاهز" : "مسودة"}
                  </span>
                  <SmallIconButton
                    label="تحريك لأعلى"
                    disabled={pending || index === 0}
                    onClick={() =>
                      act(() => moveSupervisorLessonAction(video.id, "up"))
                    }
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </SmallIconButton>
                  <SmallIconButton
                    label="تحريك لأسفل"
                    disabled={pending || index === videoRows.length - 1}
                    onClick={() =>
                      act(() => moveSupervisorLessonAction(video.id, "down"))
                    }
                  >
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </SmallIconButton>
                  <SmallIconButton label="تعديل" onClick={() => setEditingId(video.id)}>
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </SmallIconButton>
                  <SmallIconButton
                    label="حذف الفيديو"
                    destructive
                    disabled={pending}
                    onClick={async () => {
                      if (!window.confirm("حذف هذا الفيديو نهائيًا — متابعة؟")) return;
                      await act(() => deleteSupervisorLessonAction(video.id));
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </SmallIconButton>
                </div>
              </div>
            </li>
          )
        )}
      </ul>

      {adding ? (
        <div className="mt-3">
          <VideoForm
            video={null}
            onDone={async (payload) => {
              setAdding(false);
              if (!payload) return;
              const sectionId = await ensureSection();
              if (!sectionId) return;
              await act(() => saveSupervisorLessonAction({ ...payload, sectionId }));
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
          إضافة فيديو
        </button>
      )}
    </SectionCard>
  );
}

export function SmallIconButton({
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

interface VideoFormPayload {
  lessonId?: string;
  titleAr: string;
  description?: string;
  type: "VIDEO" | "EXTERNAL_VIDEO";
  videoUrl: string;
  isPublished?: boolean;
  durationSeconds?: number;
}

function VideoForm({
  video,
  onDone,
}: {
  video: VideoRow | null;
  onDone: (payload: VideoFormPayload | null) => void;
}) {
  const [title, setTitle] = React.useState(video?.titleAr ?? "");
  const [description, setDescription] = React.useState(video?.description ?? "");
  const [videoUrl, setVideoUrl] = React.useState(video?.videoUrl ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = React.useState<number | null>(
    video?.durationSeconds ?? null
  );
  const [probing, setProbing] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    if (!videoUrl.trim()) {
      setDurationSeconds(null);
      setProbing(false);
      return;
    }
    if (parseYouTubeUrl(videoUrl.trim())) {
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
  }, [videoUrl]);

  function submit() {
    if (title.trim().length < 2) {
      setError("عنوان الفيديو مطلوب (حرفان على الأقل).");
      return;
    }
    if (videoUrl.trim().length === 0) {
      setError("أضف الفيديو أولًا — ارفع ملفًا أو أدخل رابطًا ثم اضغط تعيين الرابط.");
      return;
    }
    setError(null);
    onDone({
      lessonId: video?.id,
      titleAr: title.trim(),
      description: description.trim() || undefined,
      type: parseYouTubeUrl(videoUrl.trim()) ? "EXTERNAL_VIDEO" : "VIDEO",
      videoUrl: videoUrl.trim(),
      isPublished: video?.isPublished ?? true,
      durationSeconds: durationSeconds ?? undefined,
    });
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold">عنوان الفيديو *</span>
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
      </div>

      <div className="mt-3">
        <VideoInput
          value={videoUrl}
          onChange={(url) => setVideoUrl(url ?? "")}
          label="الفيديو — رفع مباشر أو رابط يوتيوب"
          hint="رابط يوتيوب (watch / youtu.be / shorts / embed) أو رفع مباشر — MP4/WEBM حتى 512MB"
          attachTo={video?.id ? { type: "lesson-media", lessonId: video.id } : undefined}
        />
      </div>

      {videoUrl.trim() && (
        <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
          {parseYouTubeUrl(videoUrl.trim())
            ? "رابط يوتيوب صحيح — تُقرأ مدته تلقائيًا من المشغّل لحساب نسبة الإتمام على الخادم."
            : probing
              ? "جارٍ قراءة مدة الفيديو…"
              : durationSeconds
                ? `مدة الفيديو: ${Math.floor(durationSeconds / 60)} دقيقة و${durationSeconds % 60} ثانية — تُحتسب على الخادم.`
                : "لم تُقرأ مدة الفيديو — سيُعتمد التقدير من مشغّل المعلم."}
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
          {video ? "حفظ التعديلات" : "إضافة الفيديو"}
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
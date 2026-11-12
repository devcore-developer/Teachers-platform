"use client";

/* ------------------------------------------------------------------ */
/* MediaInput — the unified image/video field used across the platform. */
/*                                                                      */
/* TWO input modes behind a segmented control (Arabic RTL):             */
/*   • «رابط خارجي» — paste an existing https URL (zero configuration,  */
/*     validated + previewed, saved as-is, never copied into R2).       */
/*   • «رفع ملف» — direct device upload to Cloudflare R2 through a      */
/*     presigned PUT (progress bar via XHR), then server-side HEAD      */
/*     verification + optional Attachment registration.                 */
/*                                                                      */
/* Honest state: when the server lacks the R2 environment variables,    */
/* the upload attempt returns a clear Arabic notice and this component  */
/* renders it — it never fakes success. URL mode always works.          */
/*                                                                      */
/* Reusable everywhere: school logos, course/program covers, lesson     */
/* videos — via the thin <ImageInput> / <VideoInput> wrappers.          */
/* ------------------------------------------------------------------ */

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Link2,
  Loader2,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmbeddedVideoFrame } from "@/components/training/embedded-video-frame";
import { cn } from "@/lib/utils";
import { parseEmbeddableVideoUrl } from "@/lib/media/video-url";
import {
  confirmMediaUploadAction,
  removeMediaAction,
  requestMediaUploadAction,
  type AttachTarget,
} from "@/app/actions/media";

export type MediaKind = "image" | "video" | "document";

const ACCEPT_FOR_KIND: Record<MediaKind, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif",
  video: "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov",
  document:
    "application/pdf,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,audio/mpeg,audio/mp4,audio/wav,audio/ogg,.mp3,.m4a,.wav,.ogg,.txt,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/png,image/jpeg,image/webp",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  txt: "text/plain",
};

/** Client-side ceilings (the server re-validates authoritatively). */
const DEFAULT_MAX_BYTES: Record<MediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 512 * 1024 * 1024,
  document: 25 * 1024 * 1024,
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`;
}

function mimeForFile(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] ?? "";
}

function isManagedUrl(url: string): boolean {
  // R2_PUBLIC_URL-hosted URLs are also managed, but the client cannot
  // see the configured base — the /api/media proxy path is the reliable
  // client-side signal; the badge is cosmetic either way.
  return url.startsWith("/api/media/");
}

export interface MediaInputProps {
  kind: MediaKind;
  /** Current stored value — an external URL, a managed URL, or empty. */
  value?: string | null | undefined;
  onChange: (url: string | null) => void;
  label?: string;
  hint?: string;
  /** Client-side size ceiling override (server limits still apply). */
  maxBytes?: number;
  disabled?: boolean;
  /** Fires when a file is chosen (before upload) — palette analysis etc. */
  onFileSelected?: (file: File | null) => void;
  /** Also delete the stored R2 object when removing (reference-safe). */
  deleteOnRemove?: boolean;
  /** Course-builder registration target (cover / lesson primary media). */
  attachTo?: AttachTarget;
  className?: string;
}

type Phase = "idle" | "requesting" | "uploading" | "confirming";

export function MediaInput({
  kind,
  value,
  onChange,
  label,
  hint,
  maxBytes,
  disabled = false,
  onFileSelected,
  deleteOnRemove = false,
  attachTo,
  className,
}: MediaInputProps) {
  const [mode, setMode] = React.useState<"url" | "upload">(() =>
    value && isManagedUrl(value) ? "upload" : "url"
  );
  const [urlDraft, setUrlDraft] = React.useState(value ?? "");
  const [urlError, setUrlError] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [progress, setProgress] = React.useState(0);
  const [notice, setNotice] = React.useState<{ bad: boolean; text: string } | null>(
    null
  );

  const inputId = React.useId();
  const busy = phase !== "idle";
  const effectiveMax = maxBytes ?? DEFAULT_MAX_BYTES[kind];
  const kindLabel =
    kind === "image" ? "صورة" : kind === "document" ? "مرفق" : "فيديو";

  // Keep the draft in sync when the value changes from the outside.
  React.useEffect(() => {
    setUrlDraft(value ?? "");
  }, [value]);

  function switchMode(next: "url" | "upload") {
    if (busy) return;
    setMode(next);
    setNotice(null);
    setUrlError(null);
  }

  /* ---------------- URL mode ---------------- */

  function applyExternalUrl() {
    const draft = urlDraft.trim();
    if (!draft) {
      setUrlError("أدخل رابطًا أولًا.");
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(draft);
    } catch {
      setUrlError("الرابط غير صالح — مثال صحيح: https://example.com/file");
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      setUrlError("الرابط يجب أن يبدأ بـ https:// أو http://");
      return;
    }
    setUrlError(null);
    setNotice({ bad: false, text: "تم تعيين الرابط — يُحفظ مع النموذج." });
    onChange(draft);
  }

  /* ---------------- Upload mode ---------------- */

  function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setNotice(null);
    setFile(null);
    if (!chosen) {
      onFileSelected?.(null);
      return;
    }
    const mime = mimeForFile(chosen);
    const validMime =
      kind === "image"
        ? mime.startsWith("image/")
        : kind === "video"
          ? mime.startsWith("video/")
          : mime.startsWith("application/") ||
            mime.startsWith("audio/") ||
            mime.startsWith("text/") ||
            mime.startsWith("image/");
    if (!validMime) {
      setNotice({
        bad: true,
        text:
          kind === "image"
            ? "صيغة الصورة غير مدعومة — المسموح: PNG أو JPG أو WEBP أو GIF."
            : kind === "document"
              ? "صيغة المرفق غير مدعومة — المسموح: PDF أو Word أو Excel أو PowerPoint أو صوت أو صورة أو نص."
              : "صيغة الفيديو غير مدعومة — المسموح: MP4 أو WEBM أو MOV.",
      });
      onFileSelected?.(null);
      return;
    }
    if (chosen.size > effectiveMax) {
      setNotice({
        bad: true,
        text: `حجم الملف ${formatBytes(chosen.size)} ويتجاوز الحد الأقصى ${formatBytes(effectiveMax)}.`,
      });
      onFileSelected?.(null);
      return;
    }
    setFile(chosen);
    onFileSelected?.(chosen);
  }

  /** Direct browser → R2 PUT with real progress events. */
  function putWithProgress(
    uploadUrl: string,
    contentType: string,
    target: File
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setProgress(event.loaded / event.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`R2_REJECTED_${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("NETWORK"));
      xhr.onabort = () => reject(new Error("ABORTED"));
      xhr.send(target);
    });
  }

  async function handleUpload() {
    if (!file || busy) return;
    const mimeType = mimeForFile(file);
    // Images ride the dedicated "image" pipeline even from the document
    // field — the server allow-lists are kind-specific, so request and
    // confirmation must both carry the matching kind.
    const serverKind: MediaKind =
      kind === "document" && mimeType.startsWith("image/") ? "image" : kind;
    setNotice(null);
    setProgress(0);
    try {
      setPhase("requesting");
      const request = await requestMediaUploadAction({
        kind: serverKind,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
      });
      if (!request.ok) {
        setNotice({ bad: true, text: request.message });
        setPhase("idle");
        return;
      }

      setPhase("uploading");
      await putWithProgress(request.uploadUrl, mimeType, file);

      setPhase("confirming");
      const confirmed = await confirmMediaUploadAction({
        key: request.key,
        publicUrl: request.publicUrl,
        originalName: file.name,
        mimeType,
        kind: serverKind,
        attachTo,
      });
      if (!confirmed.ok) {
        setNotice({ bad: true, text: confirmed.message });
        setPhase("idle");
        return;
      }

      onChange(confirmed.url);
      setFile(null);
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      if (input) input.value = "";
      setNotice({ bad: false, text: "تم الرفع بنجاح واحتساب الرابط النهائي." });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      setNotice({
        bad: true,
        text: raw.startsWith("R2_REJECTED_")
          ? "رفض التخزين السحابي الملف — تحقق من إعدادات الـ bucket والصيغة."
          : raw === "NETWORK"
            ? "تعذّر الوصول للتخزين السحابي من المتصفح — الأغلب أن سياسة CORS غير مضبوطة على bucket في Cloudflare (bucket ← Settings ← CORS policy: أضف نطاق الموقع مع الطريقة PUT). جرّب مرة أخرى بعد ضبطها."
            : "انقطع الاتصال أثناء الرفع — حاول مرة أخرى.",
      });
    } finally {
      setPhase("idle");
      setProgress(0);
    }
  }

  /* ---------------- Remove ---------------- */

  function handleRemove() {
    if (busy) return;
    const previous = value;
    onChange(null);
    setUrlDraft("");
    setFile(null);
    setNotice(null);
    onFileSelected?.(null);
    if (previous && deleteOnRemove && isManagedUrl(previous)) {
      void removeMediaAction(previous).catch(() => undefined);
    }
  }

  /* ---------------- Render ---------------- */

  const showPreview = Boolean(value);
  /** YouTube/Vimeo links preview through the provider embed, not <video>. */
  const embeddable = kind === "video" && typeof value === "string" && parseEmbeddableVideoUrl(value) !== null;
  const phaseText =
    phase === "requesting"
      ? "تجهيز الرفع…"
      : phase === "uploading"
        ? `جارٍ الرفع… ${Math.round(progress * 100)}%`
        : "تأكيد الملف على التخزين…";

  return (
    <div className={className}>
      {(label || hint) && (
        <div className="mb-2">
          {label && (
            <span className="block text-sm font-bold">{label}</span>
          )}
          {hint && (
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {hint}
            </span>
          )}
        </div>
      )}

      {/* Segmented control — the two input modes */}
      <div
        role="tablist"
        aria-label={`مصدر ${kindLabel}`}
        className="inline-flex max-w-full rounded-xl bg-muted p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "url"}
          disabled={disabled || busy}
          onClick={() => switchMode("url")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-60",
            mode === "url"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Link2 className="size-3.5" aria-hidden="true" />
          رابط خارجي
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "upload"}
          disabled={disabled || busy}
          onClick={() => switchMode("upload")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-60",
            mode === "upload"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <CloudUpload className="size-3.5" aria-hidden="true" />
          رفع ملف
        </button>
      </div>

      <div className="mt-3">
        {mode === "url" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                dir="ltr"
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyExternalUrl();
                  }
                }}
                placeholder={
                  kind === "image"
                    ? "https://example.com/image.png"
                    : kind === "document"
                      ? "https://example.com/file.pdf"
                      : "https://example.com/video.mp4 أو رابط يوتيوب"
                }
                disabled={disabled || busy}
                aria-invalid={Boolean(urlError)}
                className="min-w-0 flex-1 font-mono text-xs"
                aria-label={`رابط ${kindLabel} خارجي`}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={applyExternalUrl}
                disabled={disabled || busy}
              >
                تعيين الرابط
              </Button>
            </div>
            {urlError && (
              <p className="flex items-center gap-1 text-xs font-semibold text-destructive">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                {urlError}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              الروابط الخارجية تُحفظ كما هي — لا تُنسخ إلى التخزين السحابي، وروابط
              يوتيوب (watch و youtu.be و shorts و embed) تُشغَّل مدمجةً داخل صفحة الدرس.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor={inputId}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-semibold transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CloudUpload className="size-4" aria-hidden="true" />
                {file ? "تغيير الملف" : `اختر ملف ${kindLabel}`}
              </label>
              <input
                id={inputId}
                type="file"
                accept={ACCEPT_FOR_KIND[kind]}
                className="sr-only"
                onChange={handleFileChosen}
                disabled={disabled || busy}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => void handleUpload()}
                disabled={disabled || !file || busy}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CloudUpload className="size-4" aria-hidden="true" />
                )}
                {busy ? phaseText : "رفع وحفظ"}
              </Button>
              {file && !busy && (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {file.name} — {formatBytes(file.size)}
                </span>
              )}
            </div>

            {/* Upload progress */}
            {phase === "uploading" && (
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={Math.round(progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-brand-600 transition-[width] duration-200"
                  style={{ width: `${Math.max(4, progress * 100)}%` }}
                />
              </div>
            )}
            {phase === "requesting" && (
              <p className="text-xs text-muted-foreground">{phaseText}</p>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              الرفع المباشر يتطلب تهيئة التخزين السحابي (Cloudflare R2) على
              الخادم — بدون التهيئة سيظهر تنبيه عند محاولة الرفع، وإدخال
              الروابط الخارجية يعمل دائمًا. الحد الأقصى:{" "}
              {formatBytes(effectiveMax)}.
            </p>
          </div>
        )}
      </div>

      {/* Status notices */}
      {notice && (
        <p
          className={cn(
            "mt-2 flex items-start gap-1 text-xs font-semibold",
            notice.bad ? "text-destructive" : "text-success"
          )}
          role={notice.bad ? "alert" : "status"}
        >
          {notice.bad ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0">{notice.text}</span>
        </p>
      )}

      {/* Preview + remove */}
      {showPreview && value && (
        <div className="mt-3 rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full bg-card px-2 py-0.5 text-[10px] font-bold text-muted-foreground ring-1 ring-border">
              {isManagedUrl(value)
                ? "مخزَّن سحابيًا (R2)"
                : kind === "video" && embeddable
                  ? "فيديو مدمج (YouTube/Vimeo)"
                  : "رابط خارجي"}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
              onClick={handleRemove}
              disabled={disabled || busy}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              إزالة
            </Button>
          </div>
          <div className="mt-2">
            {kind === "document" ? (
              <p className="rounded-lg border border-dashed bg-background px-3 py-2 text-xs font-semibold text-muted-foreground">
                <span className="block truncate font-mono text-[11px]" dir="ltr">
                  {value}
                </span>
                <span className="mt-0.5 block text-[10px] font-normal">
                  سيظهر هذا المرفق للمعلمين كملف قابل للتنزيل في صفحة التدريب.
                </span>
              </p>
            ) : kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value}
                alt="معاينة الصورة"
                className="mx-auto max-h-44 w-auto max-w-full rounded-lg border bg-white object-contain p-1"
                draggable={false}
                onError={() =>
                  setNotice({ bad: true, text: "تعذر تحميل الصورة من الرابط المحفوظ." })
                }
              />
            ) : embeddable ? (
              /* YouTube/Vimeo — the provider iframe previews the saved
                 link (a native <video> tag cannot read a watch page). */
              <>
                <EmbeddedVideoFrame
                  src={value}
                  title="معاينة الفيديو المدمج"
                  className="aspect-video max-h-60 w-full overflow-hidden rounded-lg border bg-black"
                />
                <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                  معاينة مدمجة داخل المنصة — سيُشغَّل الفيديو داخل صفحة الدرس مباشرة دون إعادة توجيه.
                </p>
              </>
            ) : (
              <video
                src={value}
                controls
                preload="metadata"
                className="max-h-60 w-full rounded-lg border bg-black"
                onError={() =>
                  setNotice({
                    bad: true,
                    text:
                      "تعذر تحميل الفيديو من الرابط المحفوظ — تأكد أنه ملف فيديو مباشر (MP4/WEBM) أو رابط يوتيوب صحيح.",
                  })
                }
              />
            )}
          </div>
          <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground" dir="ltr">
            {value}
          </p>
        </div>
      )}
    </div>
  );
}
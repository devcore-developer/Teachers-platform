"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

import { reportWatchProgressAction } from "@/app/actions/lesson-watch";

/* ------------------------------------------------------------------ */
/* Mandatory video player — no forward seeking, speed locked to 1x.     */
/*                                                                      */
/* Client guards (desktop + mobile):                                    */
/*   - every forward jump (progress bar, keyboard, native gestures) is  */
/*     clamped back to the highest honestly-reached position,           */
/*   - playbackRate is forced back to 1 whenever anything touches it,   */
/*   - forward keyboard shortcuts are swallowed.                        */
/* Server enforcement (the real gate): a 10s heartbeat ledger — the     */
/* server caps every report by real elapsed wall clock, keeps the       */
/* max position bounded by accumulated watch time, and is the only      */
/* writer of completion. Refreshing, replaying from the DB or calling   */
/* the action directly cannot skip ahead.                               */
/* ------------------------------------------------------------------ */

export interface MandatoryPlayerInitial {
  lastPositionSeconds: number;
  maxPositionSeconds: number;
  watchSeconds: number;
  completed: boolean;
}

interface MandatoryVideoPlayerProps {
  courseId: string;
  lessonId: string;
  /** Playable media URL (/api/media/… proxy path or a direct file URL). */
  src: string;
  title: string;
  /** Instructor-captured duration when known (seconds). */
  durationSeconds: number | null;
  thresholdPercent: number;
  initial: MandatoryPlayerInitial;
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, "0")}`
    : `${mm}:${String(s).padStart(2, "0")}`;
}

/** Keys that would seek forward or change speed — always swallowed. */
const FORWARD_KEYS = new Set([
  "ArrowRight",
  "ArrowUp",
  "l",
  "L",
  ">",
  ".",
  "+",
  "=",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
]);

export function MandatoryVideoPlayer({
  courseId,
  lessonId,
  src,
  title,
  durationSeconds,
  thresholdPercent,
  initial,
}: MandatoryVideoPlayerProps) {
  const router = useRouter();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const clampingRef = React.useRef(false);
  const localMaxWatchedRef = React.useRef(initial.maxPositionSeconds);
  const beatInFlightRef = React.useRef(false);

  const [duration, setDuration] = React.useState(durationSeconds ?? 0);
  const [current, setCurrent] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [completed, setCompleted] = React.useState(initial.completed);
  const [watchSeconds, setWatchSeconds] = React.useState(initial.watchSeconds);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [justCompleted, setJustCompleted] = React.useState(false);

  // The ceiling the viewer may seek to: everything up to the furthest
  // honestly-watched point. After completion the lesson is fully free.
  const allowedMax = completed
    ? duration
    : Math.max(initial.maxPositionSeconds, localMaxWatchedRef.current);

  /* ------------------------- server heartbeat ------------------------ */

  const sendHeartbeat = React.useCallback(
    async (positionSeconds: number, ended = false) => {
      if (beatInFlightRef.current) return;
      beatInFlightRef.current = true;
      try {
        const result = await reportWatchProgressAction({
          courseId,
          lessonId,
          positionSeconds,
          durationSeconds:
            durationSeconds ?? (duration > 0 ? Math.round(duration) : null),
          ended,
        });
        if (result.ok && result.data) {
          setWatchSeconds(result.data.watchSeconds ?? watchSeconds);
          if (result.data.completed) setCompleted(true);
          if (result.data.justCompleted) {
            setJustCompleted(true);
            router.refresh();
          }
        }
      } catch {
        // Transient network issues are fine — the next beat re-syncs.
      } finally {
        beatInFlightRef.current = false;
      }
    },
    [courseId, lessonId, durationSeconds, duration, watchSeconds, router]
  );

  /* --------------------------- media guards -------------------------- */

  function clampForward(attempted: number): number {
    if (completed) return attempted;
    if (attempted > allowedMax + 0.25) {
      setNotice("التخطي للأمام معطّل — أكمل المشاهدة بالترتيب.");
      return allowedMax;
    }
    return attempted;
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setDuration(video.duration);
    }
    video.playbackRate = 1;
    // Resume from the last server-known position (progress restore).
    const safeDuration = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : Infinity;
    const resumeAt = Math.min(initial.lastPositionSeconds, safeDuration);
    if (!initial.completed && resumeAt > 3 && resumeAt < safeDuration - 2) {
      video.currentTime = resumeAt;
    }
  }

  function handleRateChange() {
    const video = videoRef.current;
    if (!video) return;
    if (video.playbackRate !== 1) {
      video.playbackRate = 1;
      setNotice("سرعة التشغيل مقفلة على 1x في الدورات الإلزامية.");
    }
  }

  function handleSeeking() {
    const video = videoRef.current;
    if (!video || clampingRef.current) return;
    const target = clampForward(video.currentTime);
    if (target !== video.currentTime) {
      clampingRef.current = true;
      video.currentTime = target;
      requestAnimationFrame(() => {
        clampingRef.current = false;
      });
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    if (!completed && t > localMaxWatchedRef.current) {
      localMaxWatchedRef.current = t;
    }
    const clamped = clampForward(t);
    if (clamped !== t) {
      clampingRef.current = true;
      video.currentTime = clamped;
      requestAnimationFrame(() => {
        clampingRef.current = false;
      });
    }
    setCurrent(clamped);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const key = event.key;
    if (FORWARD_KEYS.has(key)) {
      // Percent jumps, arrow-forward and speed shortcuts are all blocked.
      event.preventDefault();
      event.stopPropagation();
      setNotice("التخطي للأمام واختصارات السرعة معطّلة — المشاهدة بالترتيب إلزامية.");
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (key === " " || key === "k" || key === "K") {
      event.preventDefault();
      if (video.paused) void video.play();
      else video.pause();
    } else if (key === "ArrowLeft" || key === "j" || key === "J") {
      event.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 10);
    } else if (key === "m" || key === "M") {
      event.preventDefault();
      video.muted = !video.muted;
      setMuted(video.muted);
    }
  }

  /* --------------------------- beats wiring -------------------------- */

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended) return;
      void sendHeartbeat(video.currentTime);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [sendHeartbeat]);

  React.useEffect(() => {
    function onHidden() {
      const video = videoRef.current;
      if (document.hidden && video && !video.paused) {
        video.pause();
        void sendHeartbeat(video.currentTime);
      }
    }
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [sendHeartbeat]);

  /* ------------------------------ controls --------------------------- */

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
      void sendHeartbeat(video.currentTime);
    }
  }

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    const target = clampForward(Math.max(0, Math.min(seconds, duration)));
    video.currentTime = target;
    setCurrent(target);
  }

  function handleBarPointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    // LTR geometry regardless of document direction.
    const ratio = (event.clientX - rect.left) / rect.width;
    seekTo(Math.min(1, Math.max(0, ratio)) * duration);
  }

  function toggleFullscreen() {
    const node = containerRef.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen?.();
  }

  const watchedPercent =
    duration > 0 ? Math.min(100, Math.round((watchSeconds / duration) * 100)) : 0;

  return (
    <div className="space-y-2" dir="rtl">
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="relative overflow-hidden rounded-xl border border-slate-200 bg-black outline-none focus:ring-2 focus:ring-[#1D5BD6]/40"
      >
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          playsInline
          className="aspect-video w-full"
          onLoadedMetadata={handleLoadedMetadata}
          onRateChange={handleRateChange}
          onSeeking={handleSeeking}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            void sendHeartbeat(videoRef.current?.duration ?? current, true);
          }}
          onError={() =>
            setError(
              "تعذر تشغيل الفيديو داخل الصفحة — تحقق من الاتصال أو من صيغة الملف."
            )
          }
          // Disable the native context menu (download/save-as shortcuts).
          onContextMenu={(event) => event.preventDefault()}
        />

        {/* Controls — custom so speed/seeking stay fully governed. */}
        <div
          dir="ltr"
          className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-8"
        >
          {/* Seek bar — clicks past the ceiling snap back. */}
          <div
            role="slider"
            aria-label="شريط تقدم الفيديو"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
            tabIndex={-1}
            onPointerDown={handleBarPointer}
            onPointerMove={(event) => {
              if (event.buttons === 1) handleBarPointer(event);
            }}
            className="relative h-2 w-full cursor-pointer rounded-full bg-white/25"
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#1D5BD6]"
              style={{ width: `${duration > 0 ? (current / duration) * 100 : 0}%` }}
            />
            {!completed && duration > 0 && (
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/30"
                style={{ width: `${Math.min(100, (allowedMax / duration) * 100)}%` }}
                aria-hidden="true"
              />
            )}
          </div>

          <div className="flex items-center gap-2 text-white">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "إيقاف مؤقت" : "تشغيل"}
              className="rounded-full bg-white/15 p-2 transition hover:bg-white/25"
            >
              {playing ? (
                <Pause className="size-4" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() => seekTo(Math.max(0, current - 10))}
              aria-label="إعادة آخر ١٠ ثوانٍ"
              className="rounded-full bg-white/15 p-2 transition hover:bg-white/25"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
            </button>
            <span className="min-w-24 text-center text-xs font-bold tabular-nums">
              {formatTime(current)} / {formatTime(duration)}
            </span>
            <span
              className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-black"
              title="سرعة التشغيل مقفلة على 1x"
            >
              1x
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                video.muted = !video.muted;
                setMuted(video.muted);
              }}
              aria-label={muted ? "إلغاء الكتم" : "كتم الصوت"}
              className="rounded-full bg-white/15 p-2 transition hover:bg-white/25"
            >
              {muted ? (
                <VolumeX className="size-4" aria-hidden="true" />
              ) : (
                <Volume2 className="size-4" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="ملء الشاشة"
              className="rounded-full bg-white/15 p-2 transition hover:bg-white/25"
            >
              <Maximize2 className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Status strip */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold text-slate-700">{title}</p>
          {completed ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              تم إتمام الدرس
            </span>
          ) : (
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-[#1D5BD6]">
              المشاهدة: {watchedPercent}% — الإتمام عند {thresholdPercent}%
            </span>
          )}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-[#1D5BD6] transition-all"
            style={{ width: `${watchedPercent}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          مشاهدة إلزامية: لا يمكن التخطي للأمام، والسرعة ثابتة على 1x. يمكنك
          الإيقاف والعودة وإعادة أي جزء شاهدته — ويُحفظ موقفك تلقائيًا.
        </p>
        {justCompleted && (
          <p className="mt-2 flex items-center gap-1 text-xs font-bold text-emerald-700">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            أكملت هذا الدرس — فُتح ما بعده في القائمة.
          </p>
        )}
        {notice && (
          <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-700">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            {notice}
          </p>
        )}
        {error && (
          <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
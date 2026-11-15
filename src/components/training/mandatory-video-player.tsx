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
import { isYouTubeUrl, parseYouTubeUrl } from "@/lib/media/video-url";

/* ------------------------------------------------------------------ */
/* Mandatory video player — no forward seeking, speed locked to 1x.     */
/*                                                                      */
/* TWO provider branches behind ONE governed contract:                  */
/*   • uploaded R2 videos and direct files → native <video> element     */
/*     (unchanged behavior).                                            */
/*   • YouTube URLs (watch / youtu.be / embed / shorts, with extra      */
/*     query params) → the official IFrame Player API embedded INSIDE   */
/*     the lesson page: native YT controls are disabled, the governed   */
/*     seek bar + keyboard guards + 1x lock run on top of the player    */
/*     API, and playback progress feeds the SAME server heartbeat       */
/*     ledger (reportWatchProgressAction) — completion is still decided */
/*     by the server only, never by the iframe having loaded.           */
/*                                                                      */
/* Client guards (desktop + mobile, both branches):                     */
/*   - every forward jump (progress bar, keyboard, in-frame seeks) is   */
/*     clamped back to the highest honestly-reached position,           */
/*   - playbackRate is forced back to 1 whenever anything touches it,   */
/*   - forward keyboard shortcuts are swallowed.                        */
/* Server enforcement (the real gate): a 10s heartbeat ledger — the     */
/* server caps every report by real elapsed wall clock, keeps the       */
/* max position bounded by accumulated watch time, and is the only      */
/* writer of completion. Refreshing, replaying from the DB or calling   */
/* the action directly cannot skip ahead.                               */
/*                                                                      */
/* Honest limitation: for embedded third-party players the anti-cheat   */
/* is best-effort on the client and AUTHORITATIVE on the server (the    */
/* wall-clock cap makes any speed-up or forged report worthless).       */
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
  /** Playable media URL (/api/media/… proxy path, direct file, or a YouTube link). */
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

/* ------------------------------------------------------------------ */
/* Shared server heartbeat                                              */
/* ------------------------------------------------------------------ */

function useWatchHeartbeat(
  courseId: string,
  lessonId: string,
  /**
   * MEASURED duration provider — the live metadata length from the
   * player itself (YouTube getDuration() / <video>.duration), falling
   * back to the instructor-captured prop. The player must REPORT the
   * duration it plays: YouTube lessons have no DB-captured length, and
   * without this report the server can never evaluate the completion
   * threshold (the old player sent a hardcoded null here — the root
   * cause of YouTube lessons never completing). The server keeps its
   * own hierarchy: instructor DB value wins, client metadata is only a
   * clamped, position-floored, sticky fallback — never trusted for
   * storage when an authoritative value exists.
   */
  getDurationSeconds: () => number | null,
  onSnapshot: (data: {
    watchSeconds?: number;
    watchedPercent?: number;
    completed?: boolean;
    justCompleted?: boolean;
  }) => void
) {
  const onSnapshotRef = React.useRef(onSnapshot);
  React.useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  });
  const getDurationRef = React.useRef(getDurationSeconds);
  React.useEffect(() => {
    getDurationRef.current = getDurationSeconds;
  });
  const beatInFlightRef = React.useRef(false);
  /**
   * Latest-wins slot — a beat that fires while another request is still
   * in flight is QUEUED here (never silently dropped) and re-sent as
   * soon as the in-flight one settles. This is what makes the
   * finalize-beat path lossless: ENDED / pause / tab-hide can land a
   * moment after a periodic beat, and the old drop-on-in-flight
   * behavior discarded exactly those final reports — after ENDED the
   * periodic interval stops, so the dropped position was never sent
   * again and short lessons froze below the threshold.
   */
  const pendingBeatRef = React.useRef<{
    positionSeconds: number;
    ended: boolean;
  } | null>(null);

  const sendHeartbeat = React.useCallback(
    async (positionSeconds: number, ended = false) => {
      if (beatInFlightRef.current) {
        // Coalesce, latest wins: the finalize beat supersedes whatever
        // periodic report is still on the wire.
        pendingBeatRef.current = { positionSeconds, ended };
        return;
      }
      beatInFlightRef.current = true;
      try {
        const result = await reportWatchProgressAction({
          courseId,
          lessonId,
          positionSeconds,
          durationSeconds: getDurationRef.current(),
          ended,
        });
        if (result.ok && result.data) {
          onSnapshotRef.current(result.data);
          // NOTE: justCompleted no longer refreshes the page here. The
          // completion is already recorded on the SERVER; refreshing
          // immediately used to swap the checklist branch (done) and
          // UNMOUNT the still-playing video at the threshold moment.
          // Each player branch refreshes once playback is no longer
          // active (see the deferred-refresh effect).
        }
      } catch {
        // Transient network issues are fine — the next beat re-syncs.
      } finally {
        beatInFlightRef.current = false;
        const pending = pendingBeatRef.current;
        if (pending) {
          pendingBeatRef.current = null;
          void sendHeartbeat(pending.positionSeconds, pending.ended);
        }
      }
    },
    [courseId, lessonId]
  );
  return sendHeartbeat;
}

/* ------------------------------------------------------------------ */
/* Shared status strip                                                  */
/* ------------------------------------------------------------------ */

interface StatusStripProps {
  title: string;
  providerLabel: string;
  completed: boolean;
  watchedPercent: number;
  thresholdPercent: number;
  justCompleted: boolean;
  notice: string | null;
  error: string | null;
  guidance: string;
}

function StatusStrip({
  title,
  providerLabel,
  completed,
  watchedPercent,
  thresholdPercent,
  justCompleted,
  notice,
  error,
  guidance,
}: StatusStripProps) {
  return (
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
        <span className="font-bold">{providerLabel}:</span> {guidance}
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
  );
}

/* ------------------------------------------------------------------ */
/* Shared governed seek bar                                             */
/* ------------------------------------------------------------------ */

interface SeekBarProps {
  current: number;
  duration: number;
  allowedMax: number;
  completed: boolean;
  onSeek: (seconds: number) => void;
}

function SeekBar({ current, duration, allowedMax, completed, onSeek }: SeekBarProps) {
  function handleBarPointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    // LTR geometry regardless of document direction.
    const ratio = (event.clientX - rect.left) / rect.width;
    onSeek(Math.min(1, Math.max(0, ratio)) * duration);
  }
  return (
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
  );
}

/* ------------------------------------------------------------------ */
/* Branch A — native <video> (R2 uploads + direct files), unchanged     */
/* ------------------------------------------------------------------ */

function NativeGovernedPlayer({
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
  /** Video position at the previous timeupdate tick (safety-net anchor). */
  const lastTickTimeRef = React.useRef(initial.lastPositionSeconds);

  const [duration, setDuration] = React.useState(durationSeconds ?? 0);
  const [current, setCurrent] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [completed, setCompleted] = React.useState(initial.completed);
  const [watchSeconds, setWatchSeconds] = React.useState(initial.watchSeconds);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [justCompleted, setJustCompleted] = React.useState(false);
  /** Server-verified percent (from the heartbeat ack) once known. */
  const [serverPercent, setServerPercent] = React.useState(0);

  const sendHeartbeat = useWatchHeartbeat(
    courseId,
    lessonId,
    // MEASURED duration from the element itself (falls back to the
    // instructor-captured prop before metadata loads).
    () => {
      const video = videoRef.current;
      return video && Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : (durationSeconds ?? null);
    },
    (data) => {
      if (typeof data.watchSeconds === "number") {
        setWatchSeconds(data.watchSeconds);
      }
      if (typeof data.watchedPercent === "number" && data.watchedPercent > 0) {
        setServerPercent(data.watchedPercent);
      }
      if (data.completed) setCompleted(true);
      if (data.justCompleted) setJustCompleted(true);
    }
  );

  // The ceiling the viewer may seek to: everything up to the furthest
  // honestly-watched point. After completion the lesson is fully free.
  const allowedMax = completed
    ? duration
    : Math.max(initial.maxPositionSeconds, localMaxWatchedRef.current);

  /* --------------------------- media guards -------------------------- */

  /**
   * Forward-seek clamp — reads the LIVE ceiling (the honest max is a ref
   * that advances with every tick). The previous version compared against
   * a RENDER-TIME snapshot with the same 0.25s tolerance: any timeupdate
   * gap above ~250ms — normal cadence jitter, GC pauses, deferred React
   * commits — then read as a "forward seek" and rewound the video,
   * producing the first-playback stutter (the anti-seeking MECHANISM was
   * sound; its anchor was stale). The 0.25s tolerance here only has to
   * absorb rounding on REAL seeks, which always announce themselves via
   * the `seeking` event, where this function is invoked.
   */
  function clampForward(attempted: number): number {
    if (completed) return attempted;
    const ceiling = Math.max(
      initial.maxPositionSeconds,
      localMaxWatchedRef.current
    );
    if (attempted > ceiling + 0.25) {
      setNotice("التخطي للأمام معطّل — أكمل المشاهدة بالترتيب.");
      return ceiling;
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

  /**
   * TRACKING ONLY during continuous playback — this handler never judges
   * normal playback. A playing video's position cannot jump on its own:
   * stalls and pauses freeze it, hidden tabs are paused by the
   * visibilitychange guard, and every real seek fires `seeking` (clamped
   * above). The only tolerated correction is a WIDE video-time safety
   * net: a jump beyond the last tick + 2.5s can only be a seek that
   * somehow bypassed the `seeking` event (exotic embed paths). The old
   * version clamped EVERY tick against the stale render snapshot — that
   * is the stutter bug fixed here.
   */
  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    if (!completed && t - lastTickTimeRef.current > 2.5) {
      const target = clampForward(t);
      if (target !== t) {
        clampingRef.current = true;
        video.currentTime = target;
        requestAnimationFrame(() => {
          clampingRef.current = false;
        });
        setCurrent(target);
        lastTickTimeRef.current = target;
        return;
      }
    }
    if (!completed && t > localMaxWatchedRef.current) {
      localMaxWatchedRef.current = t;
    }
    lastTickTimeRef.current = t;
    setCurrent(t);
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

  // The heartbeat completes the lesson on the SERVER at the threshold;
  // the page refresh that reveals the unlocked checklist entry is
  // DEFERRED until playback is no longer active. Refreshing mid-playback
  // used to swap the checklist branch (done -> collapsed replay details)
  // and unmount the still-playing video — a jolt at the completion point
  // of the first viewing. The video element now stays stable throughout
  // playback; the refresh lands on the next pause / ended event.
  React.useEffect(() => {
    if (justCompleted && !playing) router.refresh();
  }, [justCompleted, playing, router]);

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

  function toggleFullscreen() {
    const node = containerRef.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen?.();
  }

  // Prefer the SERVER-verified percent (watch ledger ÷ server-resolved
  // duration) over the local watchSeconds ÷ player-duration division —
  // the completion verdict is computed against the server numbers, so
  // the strip must display exactly what the server validated.
  const localWatchedPercent =
    duration > 0 ? Math.min(100, Math.round((watchSeconds / duration) * 100)) : 0;
  const watchedPercent =
    serverPercent > 0 ? Math.min(100, serverPercent) : localWatchedPercent;

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
          <SeekBar
            current={current}
            duration={duration}
            allowedMax={allowedMax}
            completed={completed}
            onSeek={seekTo}
          />

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

      <StatusStrip
        title={title}
        providerLabel="مشاهدة إلزامية"
        completed={completed}
        watchedPercent={watchedPercent}
        thresholdPercent={thresholdPercent}
        justCompleted={justCompleted}
        notice={notice}
        error={error}
        guidance="لا يمكن التخطي للأمام، والسرعة ثابتة على 1x. يمكنك الإيقاف والعودة وإعادة أي جزء شاهدته — ويُحفظ موقفك تلقائيًا."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* YouTube IFrame API — minimal local typings (no external dependency)  */
/* ------------------------------------------------------------------ */

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

interface YTPlayerEvent {
  target: YTPlayer;
  data: number;
}

interface YTErrorEvent {
  data: number;
}

interface YTPlayerOptions {
  videoId: string;
  host?: string;
  width?: number | string;
  height?: number | string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YTPlayerEvent) => void;
    onStateChange?: (event: YTPlayerEvent) => void;
    onError?: (event: YTErrorEvent) => void;
  };
}

interface YTNamespace {
  Player: new (element: HTMLElement | string, options: YTPlayerOptions) => YTPlayer;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

/** Loads the official IFrame API once per page (singleton). */
function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("NO_WINDOW"));
  }
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!ytApiPromise) {
    ytApiPromise = new Promise<YTNamespace>((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === "function") previous();
        if (window.YT) resolve(window.YT);
      };
      if (!document.querySelector("script[data-manara-yt-api]")) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        script.dataset.manaraYtApi = "true";
        document.head.appendChild(script);
      }
      // Safety poll: covers the case where the API finished loading
      // before this component attached the global callback.
      const poll = window.setInterval(() => {
        if (window.YT && window.YT.Player) {
          window.clearInterval(poll);
          resolve(window.YT);
        }
      }, 200);
    });
  }
  return ytApiPromise;
}

/** Maps YouTube player error codes to meaningful Arabic messages. */
function youTubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return "رابط الفيديو غير صالح — اطلب من المدرب حفظ الرابط من جديد.";
    case 5:
      return "تعذر تشغيل الفيديو داخل المشغّل — حاول تحديث الصفحة.";
    case 100:
      return "الفيديو غير متاح — حُذف أو أصبح خاصًا على يوتيوب.";
    case 101:
    case 150:
      return "منع صاحب الفيديو التضمين داخل الصفحات — اطلب من المدرب اختيار فيديو يسمح بالتضمين.";
    default:
      return "تعذر تشغيل فيديو يوتيوب — حاول تحديث الصفحة.";
  }
}

/* ------------------------------------------------------------------ */
/* Branch B — governed YouTube player (embedded, same ledger)           */
/* ------------------------------------------------------------------ */

function YouTubeGovernedPlayer({
  courseId,
  lessonId,
  src,
  title,
  durationSeconds,
  thresholdPercent,
  initial,
  videoId,
}: MandatoryVideoPlayerProps & {
  videoId: string;
  /** Kept for future start-offset handling; resume uses playerVars.start. */
  startAt: number;
}) {
  const router = useRouter();
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  // React-owned wrapper; the YT API mount node is created manually
  // inside it so provider DOM swaps never fight the reconciler.
  const mountHostRef = React.useRef<HTMLDivElement | null>(null);
  const playerRef = React.useRef<YTPlayer | null>(null);
  const clampingRef = React.useRef(false);
  const localMaxWatchedRef = React.useRef(initial.maxPositionSeconds);
  // The last honest playback position — anything jumping beyond it is
  // an in-frame seek attempt and gets clamped back.
  const lastHonestTimeRef = React.useRef(initial.lastPositionSeconds);
  /** Set while the IFrame API reports BUFFERING (its own transitions). */
  const bufferingRef = React.useRef(false);
  const durationRef = React.useRef(durationSeconds ?? 0);
  const completedRef = React.useRef(initial.completed);

  const [ready, setReady] = React.useState(false);
  const [duration, setDuration] = React.useState(durationSeconds ?? 0);
  const [current, setCurrent] = React.useState(initial.lastPositionSeconds);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [completed, setCompleted] = React.useState(initial.completed);
  const [watchSeconds, setWatchSeconds] = React.useState(initial.watchSeconds);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [justCompleted, setJustCompleted] = React.useState(false);
  /** Server-verified percent (from the heartbeat ack) once known. */
  const [serverPercent, setServerPercent] = React.useState(0);

  React.useEffect(() => {
    completedRef.current = completed;
  }, [completed]);
  React.useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const sendHeartbeat = useWatchHeartbeat(
    courseId,
    lessonId,
    // MEASURED duration straight from the IFrame API. This is THE fix
    // for YouTube completion: the ledger previously never received any
    // duration for YouTube lessons (no DB capture, hardcoded-null prop),
    // so the server could never evaluate the 95% threshold. The server
    // keeps its hierarchy — an instructor-captured DB duration always
    // wins; this value only fills the gap, clamped and floored.
    () => {
      const player = playerRef.current;
      if (player) {
        const measured = player.getDuration();
        if (Number.isFinite(measured) && measured > 0) return measured;
      }
      return durationSeconds ?? null;
    },
    (data) => {
      if (typeof data.watchSeconds === "number") {
        setWatchSeconds(data.watchSeconds);
      }
      if (typeof data.watchedPercent === "number" && data.watchedPercent > 0) {
        setServerPercent(data.watchedPercent);
      }
      if (data.completed) setCompleted(true);
      if (data.justCompleted) setJustCompleted(true);
    }
  );

  const allowedMax = completed
    ? duration
    : Math.max(initial.maxPositionSeconds, localMaxWatchedRef.current);

  /* ----------------------- player construction ----------------------- */

  React.useEffect(() => {
    let disposed = false;
    const mountHost = mountHostRef.current;
    if (!mountHost) return;
    // A detached, React-invisible node for the YT API to replace with
    // its iframe — cleanup can then destroy the player and clear the
    // wrapper without touching React-owned nodes.
    const mountNode = document.createElement("div");
    mountNode.style.width = "100%";
    mountNode.style.height = "100%";
    mountHost.appendChild(mountNode);

    const resumeAt = Math.max(0, Math.floor(initial.lastPositionSeconds));

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (disposed || !mountNode.isConnected) return;
        const player = new YT.Player(mountNode, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            start: !initial.completed && resumeAt > 3 ? resumeAt : 0,
          },
          events: {
            onReady: (event) => {
              if (disposed) return;
              playerRef.current = event.target;
              const iframe = event.target.getIframe();
              iframe.style.width = "100%";
              iframe.style.height = "100%";
              event.target.setPlaybackRate(1);
              setMuted(event.target.isMuted());
              setReady(true);
            },
            onStateChange: (event) => {
              if (disposed) return;
              const state = event.data;
              const YT = window.YT;
              if (!YT) return;
              if (state === YT.PlayerState.PLAYING) {
                setPlaying(true);
                setError(null);
                // Metadata is fully available in the PLAYING state.
                const d = event.target.getDuration();
                if (Number.isFinite(d) && d > 0) setDuration(d);
                if (event.target.getPlaybackRate() !== 1) {
                  event.target.setPlaybackRate(1);
                  setNotice("سرعة التشغيل مقفلة على 1x في الدورات الإلزامية.");
                }
              } else if (state === YT.PlayerState.PAUSED) {
                setPlaying(false);
                void sendHeartbeat(event.target.getCurrentTime());
              } else if (state === YT.PlayerState.ENDED) {
                setPlaying(false);
                // Finalize: capture the ACTUAL final playback position
                // and the real metadata duration, then persist the final
                // beat (ended=true). The latest-wins queue guarantees it
                // lands even if a periodic beat is still on the wire —
                // after ENDED the periodic interval stops, so a dropped
                // final beat used to freeze the lesson below threshold.
                const finalPosition = Math.max(event.target.getCurrentTime(), 0);
                const measured = event.target.getDuration();
                void sendHeartbeat(
                  finalPosition > 0
                    ? finalPosition
                    : measured > 0
                      ? measured
                      : 0,
                  true
                );
                if (Number.isFinite(measured) && measured > 0) setDuration(measured);
                setCurrent(measured > 0 ? measured : finalPosition);
              }
            },
            onError: (event) => {
              if (disposed) return;
              setError(youTubeErrorMessage(event.data));
            },
          },
        });
        playerRef.current = player;
      })
      .catch(() => {
        if (!disposed) {
          setError("تعذر تحميل مشغّل يوتيوب — تحقق من الاتصال ثم أعد تحديث الصفحة.");
        }
      });

    return () => {
      disposed = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // The player may already be gone during fast unmounts.
      }
      playerRef.current = null;
      if (mountHostRef.current) mountHostRef.current.innerHTML = "";
    };
    // The player is created exactly once per mount — initial values are
    // intentionally captured at construction time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, lessonId, videoId]);

  /* --------------------- governed playback loop ---------------------- */

  React.useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || completedRef.current) return;
      const state = player.getPlayerState();
      // Judge ONLY the PLAYING state. While BUFFERING the IFrame API can
      // report a jumped position for its OWN transitions (quality switch,
      // ad roll) — the old poll clamped those and stuttered playback. A
      // genuine forward seek cannot hide behind this: in-frame seeks are
      // impossible (controls disabled, cross-origin iframe) and the
      // governed bar clamps BEFORE seeking, so any real jump surfaces in
      // the PLAYING state below and is still caught.
      if (state === 3) {
        bufferingRef.current = true;
        return;
      }
      if (state !== 1) return;
      const t = player.getCurrentTime();
      const d = player.getDuration();
      if (Number.isFinite(d) && d > 0 && durationRef.current !== d) {
        setDuration(d);
      }
      // Re-baseline after YouTube's own buffering transition: a small
      // drift is the API's, not the user's. Larger jumps are NOT
      // accepted here — they fall through to the clamp below.
      if (bufferingRef.current) {
        bufferingRef.current = false;
        if (t > lastHonestTimeRef.current && t - lastHonestTimeRef.current <= 3) {
          lastHonestTimeRef.current = t;
          if (t > localMaxWatchedRef.current) {
            localMaxWatchedRef.current = t;
          }
        }
      }
      // Forward-seek detection: at 1x the position advances a little per
      // tick; a jump beyond the honest position + tolerance is a seek.
      const honest = lastHonestTimeRef.current;
      if (t > honest + 1.2 && t > localMaxWatchedRef.current + 0.25) {
        clampingRef.current = true;
        player.seekTo(honest, true);
        window.setTimeout(() => {
          clampingRef.current = false;
        }, 150);
        setNotice("التخطي للأمام معطّل — أكمل المشاهدة بالترتيب.");
        setCurrent(honest);
        return;
      }
      if (t < honest) {
        // Rewatching backwards is allowed — track the new position.
        lastHonestTimeRef.current = t;
      }
      if (t > localMaxWatchedRef.current) {
        localMaxWatchedRef.current = t;
      }
      lastHonestTimeRef.current = t;
      setCurrent(t);
    }, 250);
    return () => window.clearInterval(interval);
  }, [ready]);

  /* --------------------------- beats wiring -------------------------- */

  React.useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || completedRef.current) return;
      const state = player.getPlayerState();
      if (state !== 1) return;
      void sendHeartbeat(player.getCurrentTime());
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [ready, sendHeartbeat]);

  React.useEffect(() => {
    function onHidden() {
      const player = playerRef.current;
      if (document.hidden && player && player.getPlayerState() === 1) {
        player.pauseVideo();
        void sendHeartbeat(player.getCurrentTime());
      }
    }
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [sendHeartbeat]);

  // Deferred completion refresh — same contract as the native branch:
  // the checklist refresh lands only once playback is no longer active,
  // so the playing iframe is never unmounted mid-playback.
  React.useEffect(() => {
    if (justCompleted && !playing) router.refresh();
  }, [justCompleted, playing, router]);

  /* ------------------------------ controls --------------------------- */

  function clampForward(attempted: number): number {
    if (completed) return attempted;
    // LIVE ceiling — same rule as the native branch (the render-time
    // snapshot lags one poll tick behind the honest position).
    const ceiling = Math.max(
      initial.maxPositionSeconds,
      localMaxWatchedRef.current
    );
    if (attempted > ceiling + 0.25) {
      setNotice("التخطي للأمام معطّل — أكمل المشاهدة بالترتيب.");
      return ceiling;
    }
    return attempted;
  }

  function togglePlay() {
    const player = playerRef.current;
    if (!player) return;
    if (player.getPlayerState() === 1) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }

  function seekTo(seconds: number) {
    const player = playerRef.current;
    if (!player || clampingRef.current) return;
    const target = clampForward(Math.max(0, Math.min(seconds, duration)));
    player.seekTo(target, true);
    setCurrent(target);
    lastHonestTimeRef.current = target;
  }

  function toggleFullscreen() {
    const node = hostRef.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen?.();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const key = event.key;
    if (FORWARD_KEYS.has(key)) {
      event.preventDefault();
      event.stopPropagation();
      setNotice("التخطي للأمام واختصارات السرعة معطّلة — المشاهدة بالترتيب إلزامية.");
      return;
    }
    const player = playerRef.current;
    if (!player) return;
    if (key === " " || key === "k" || key === "K") {
      event.preventDefault();
      togglePlay();
    } else if (key === "ArrowLeft" || key === "j" || key === "J") {
      event.preventDefault();
      seekTo(Math.max(0, lastHonestTimeRef.current - 10));
    } else if (key === "m" || key === "M") {
      event.preventDefault();
      if (player.isMuted()) {
        player.unMute();
        setMuted(false);
      } else {
        player.mute();
        setMuted(true);
      }
    }
  }

  // Same verified-percent rule as the native branch: the strip shows the
  // SERVER's watch-ledger percent (what completion is judged against),
  // falling back to the local division only before the first ack.
  const localWatchedPercent =
    duration > 0 ? Math.min(100, Math.round((watchSeconds / duration) * 100)) : 0;
  const watchedPercent =
    serverPercent > 0 ? Math.min(100, serverPercent) : localWatchedPercent;

  return (
    <div className="space-y-2" dir="rtl">
      <div
        ref={hostRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="relative overflow-hidden rounded-xl border border-slate-200 bg-black outline-none focus:ring-2 focus:ring-[#1D5BD6]/40"
      >
        {/* The YT API mounts its iframe inside this wrapper. */}
        <div ref={mountHostRef} className="aspect-video w-full" />

        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <p className="text-xs font-semibold text-white/70">جارٍ تحميل مشغّل الفيديو…</p>
          </div>
        )}

        {/* Governed controls — identical contract to the native branch. */}
        <div
          dir="ltr"
          className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-8"
        >
          <SeekBar
            current={current}
            duration={duration}
            allowedMax={allowedMax}
            completed={completed}
            onSeek={seekTo}
          />

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
              onClick={() => seekTo(Math.max(0, lastHonestTimeRef.current - 10))}
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
                const player = playerRef.current;
                if (!player) return;
                if (player.isMuted()) {
                  player.unMute();
                  setMuted(false);
                } else {
                  player.mute();
                  setMuted(true);
                }
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

      <StatusStrip
        title={title}
        providerLabel="مشاهدة إلزامية — فيديو يوتيوب مدمج"
        completed={completed}
        watchedPercent={watchedPercent}
        thresholdPercent={thresholdPercent}
        justCompleted={justCompleted}
        notice={notice}
        error={error}
        guidance="يعمل الفيديو داخل صفحة المنصة مباشرة: لا توجد إعادة توجيه إلى يوتيوب، لا يمكن التخطي للأمام، والسرعة ثابتة على 1x — ويُحتسب التقدم من نفس سجل المشاهدة على الخادم."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Public component — same props/signature as before this revision      */
/* ------------------------------------------------------------------ */

export function MandatoryVideoPlayer(props: MandatoryVideoPlayerProps) {
  const youtube = isYouTubeUrl(props.src) ? parseYouTubeUrl(props.src) : null;
  if (youtube) {
    return (
      <YouTubeGovernedPlayer
        {...props}
        videoId={youtube.videoId}
        startAt={youtube.startSeconds}
      />
    );
  }
  return <NativeGovernedPlayer {...props} />;
}
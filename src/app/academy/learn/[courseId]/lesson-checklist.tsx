"use client";

import { useActionState } from "react";
import {
  CheckCircle2,
  Circle,
  PlayCircle,
  FileText,
  Lock,
  Paperclip,
  ExternalLink,
} from "lucide-react";

import { MandatoryVideoPlayer } from "@/components/training/mandatory-video-player";
import {
  markLessonCompleteAction,
  type LearningActionState,
} from "@/app/actions/learning";
import { cn } from "@/lib/utils";

/**
 * Batch 1 — the lesson checklist of the learning page.
 *
 * Mandatory-learning edition:
 *   - VIDEO lessons render the server-gated mandatory player; the manual
 *     إتمام toggle is gone for them (completion happens only in the
 *     heartbeat ledger on the server).
 *   - Locked lessons render a clear Arabic lock card — the server enforces
 *     the same rule on every action and on the media proxy, so this is
 *     presentation of a server decision, not the enforcement itself.
 *   - TEXT / EXTERNAL_VIDEO / RESOURCE lessons keep the manual toggle
 *     (nothing watchable to measure) but respect the sequence.
 */

interface WatchSnapshot {
  lastPositionSeconds: number;
  maxPositionSeconds: number;
  watchSeconds: number;
}

export interface ChecklistLesson {
  id: string;
  titleAr: string;
  type: string;
  typeLabel: string;
  description: string | null;
  content: string | null;
  videoUrl: string | null;
  attachmentName: string | null;
  durationSeconds: number | null;
  /** Server-computed sequential lock. */
  locked: boolean;
  lockedByTitle: string | null;
  /** The first not-yet-completed lesson in the whole course order. */
  current: boolean;
  watch: WatchSnapshot | null;
}

interface LessonChecklistProps {
  courseId: string;
  isTeacher: boolean;
  thresholdPercent: number;
  completedIds: string[];
  lessons: ChecklistLesson[];
}

const initialState: LearningActionState = { ok: false };

export function LessonChecklist({
  courseId,
  isTeacher,
  thresholdPercent,
  completedIds,
  lessons,
}: LessonChecklistProps) {
  const [state, formAction, pending] = useActionState(
    markLessonCompleteAction,
    initialState
  );
  // After each successful mark the server action revalidates this
  // route, so the fresh completedIds prop replaces the list render.
  const completed = new Set(completedIds);

  return (
    <ul className="divide-y divide-slate-100">
      {lessons.map((lesson) => {
        const done = completed.has(lesson.id);
        const isManagedVideo = lesson.type === "VIDEO" && Boolean(lesson.videoUrl);
        const canPlayVideo = isManagedVideo && !lesson.locked;
        const manualCompletionAllowed =
          isTeacher && !done && !lesson.locked && lesson.type !== "VIDEO";

        return (
          <li
            key={lesson.id}
            className={cn(
              "px-5 py-4",
              lesson.current && !done && "bg-blue-50/40"
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 shrink-0",
                    done
                      ? "text-emerald-600"
                      : lesson.locked
                        ? "text-slate-300"
                        : "text-[#1D5BD6]"
                  )}
                  aria-hidden="true"
                >
                  {done ? (
                    <CheckCircle2 className="size-5" />
                  ) : lesson.locked ? (
                    <Lock className="size-5" />
                  ) : (
                    <Circle className="size-5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800">
                    {lesson.titleAr}
                    <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {lesson.typeLabel}
                    </span>
                    {lesson.current && !done && (
                      <span className="ms-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-[#1D5BD6]">
                        الدرس الحالي
                      </span>
                    )}
                  </p>
                  {lesson.description && (
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      {lesson.description}
                    </p>
                  )}

                  {/* Locked — server-enforced; this card only explains. */}
                  {lesson.locked ? (
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>
                        هذا الدرس مقفل حاليًا — أكمل درس
                        {lesson.lockedByTitle ? (
                          <span className="font-extrabold"> «{lesson.lockedByTitle}» </span>
                        ) : (
                          " ما قبله "
                        )}
                        أولًا ليُفتح بالترتيب.
                      </span>
                    </div>
                  ) : (
                    <>
                      {lesson.content && (
                        <p className="mt-2 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                          {lesson.content}
                        </p>
                      )}

                      {/* Uploaded video — mandatory player for teachers. */}
                      {canPlayVideo && lesson.videoUrl && (
                        <div className="mt-3">
                          {isTeacher ? (
                            done ? (
                              <details className="group">
                                <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-[#1D5BD6] transition hover:bg-blue-50">
                                  <PlayCircle className="size-4" aria-hidden="true" />
                                  إعادة مشاهدة الدرس
                                </summary>
                                <div className="mt-3">
                                  <MandatoryVideoPlayer
                                    courseId={courseId}
                                    lessonId={lesson.id}
                                    src={lesson.videoUrl}
                                    title={lesson.titleAr}
                                    durationSeconds={lesson.durationSeconds}
                                    thresholdPercent={thresholdPercent}
                                    initial={{
                                      lastPositionSeconds: lesson.watch?.lastPositionSeconds ?? 0,
                                      maxPositionSeconds: lesson.watch?.maxPositionSeconds ?? 0,
                                      watchSeconds: lesson.watch?.watchSeconds ?? 0,
                                      completed: true,
                                    }}
                                  />
                                </div>
                              </details>
                            ) : (
                              <MandatoryVideoPlayer
                                courseId={courseId}
                                lessonId={lesson.id}
                                src={lesson.videoUrl}
                                title={lesson.titleAr}
                                durationSeconds={lesson.durationSeconds}
                                thresholdPercent={thresholdPercent}
                                initial={{
                                  lastPositionSeconds: lesson.watch?.lastPositionSeconds ?? 0,
                                  maxPositionSeconds: lesson.watch?.maxPositionSeconds ?? 0,
                                  watchSeconds: lesson.watch?.watchSeconds ?? 0,
                                  completed: false,
                                }}
                              />
                            )
                          ) : (
                            /* Staff preview — free playback, no ledger. */
                            <video
                              controls
                              preload="metadata"
                              playsInline
                              src={lesson.videoUrl}
                              className="mt-2 aspect-video w-full rounded-xl border border-slate-200 bg-black"
                            />
                          )}
                        </div>
                      )}

                      {/* External video — link out (cannot be measured). */}
                      {lesson.type === "EXTERNAL_VIDEO" && lesson.videoUrl && (
                        <div className="mt-2">
                          <a
                            href={lesson.videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1D5BD6] hover:text-[#174aa8]"
                          >
                            <PlayCircle className="size-4" aria-hidden="true" />
                            فتح الفيديو
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </a>
                        </div>
                      )}

                      {lesson.attachmentName && (
                        <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
                          <Paperclip className="size-3.5" aria-hidden="true" />
                          <FileText className="size-3.5" aria-hidden="true" />
                          {lesson.attachmentName}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {manualCompletionAllowed && (
                <form action={formAction} className="shrink-0">
                  <input type="hidden" name="courseId" value={courseId} />
                  <input type="hidden" name="lessonId" value={lesson.id} />
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-lg bg-[#1D5BD6] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#174aa8] disabled:opacity-60"
                  >
                    {pending ? "جارٍ التسجيل…" : "إتمام الدرس"}
                  </button>
                </form>
              )}
              {done && (
                <span className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
                  تم الإنجاز ✓
                </span>
              )}
            </div>
          </li>
        );
      })}
      {state.ok && state.message && (
        <li className="border-t border-slate-100 bg-blue-50/60 px-5 py-2 text-xs font-semibold text-[#1D5BD6]">
          {state.message}
        </li>
      )}
      {!state.ok && state.message && (
        <li className="border-t border-slate-100 bg-red-50/60 px-5 py-2 text-xs font-semibold text-red-700">
          {state.message}
        </li>
      )}
    </ul>
  );
}
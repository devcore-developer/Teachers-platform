"use client";

import { useActionState } from "react";
import { CheckCircle2, Circle, PlayCircle, FileText, Paperclip, ExternalLink } from "lucide-react";

import {
  markLessonCompleteAction,
  type LearningActionState,
} from "@/app/actions/learning";
import { cn } from "@/lib/utils";

/**
 * Batch 1 — the lesson checklist of the learning page.
 *
 * Each published lesson renders its content inline (text, external
 * video embed, resource chip) plus an إتمام toggle that writes real
 * CourseLessonProgress rows through the server action — the Next.js
 * equivalent of the original HTML v11 video player + v11NextVideo
 * gating, minus the client-trusted state.
 */

interface LessonItem {
  id: string;
  titleAr: string;
  type: string;
  typeLabel: string;
  description: string | null;
  content: string | null;
  videoUrl: string | null;
  attachmentName: string | null;
}

interface LessonChecklistProps {
  courseId: string;
  isTeacher: boolean;
  completedIds: string[];
  lessons: LessonItem[];
}

const initialState: LearningActionState = { ok: false };

export function LessonChecklist({
  courseId,
  isTeacher,
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
        return (
          <li key={lesson.id} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 shrink-0",
                    done ? "text-emerald-600" : "text-slate-300"
                  )}
                  aria-hidden="true"
                >
                  {done ? (
                    <CheckCircle2 className="size-5" />
                  ) : (
                    <Circle className="size-5" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">
                    {lesson.titleAr}
                    <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {lesson.typeLabel}
                    </span>
                  </p>
                  {lesson.description && (
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      {lesson.description}
                    </p>
                  )}
                  {lesson.content && (
                    <p className="mt-2 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                      {lesson.content}
                    </p>
                  )}
                  {lesson.videoUrl && (
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
                </div>
              </div>

              {isTeacher && (
                <form action={formAction} className="shrink-0">
                  <input type="hidden" name="courseId" value={courseId} />
                  <input type="hidden" name="lessonId" value={lesson.id} />
                  <button
                    type="submit"
                    disabled={pending || done}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-bold transition",
                      done
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "bg-[#1D5BD6] text-white hover:bg-[#174aa8] disabled:opacity-60"
                    )}
                  >
                    {pending
                      ? "جارٍ التسجيل…"
                      : done
                        ? "تم الإنجاز ✓"
                        : "إتمام الدرس"}
                  </button>
                </form>
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
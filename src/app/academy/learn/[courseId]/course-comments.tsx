"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  addCourseCommentAction,
  type LearningActionState,
} from "@/app/actions/learning";

/**
 * Batch 1 — حائط الدورة (course wall comments).
 *
 * The course-scoped dialogue between the teacher and the training team,
 * bound to real user ids (the Next.js replacement for the original
 * HTML v14/v15 comment flows). Posts through the server action; the
 * action revalidates the route so fresh rows arrive with the render.
 */

interface CommentRow {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorRole: string;
}

const initialState: LearningActionState = { ok: false };

const ROLE_LABELS: Record<string, string> = {
  TEACHER: "معلم",
  EDUCATIONAL_SUPERVISOR: "المشرف التربوي",
  EDUCATIONAL_DEPUTY: "الوكيل التعليمي",
  DEVELOPMENT_OFFICE_MANAGER: "مدير مكتب التطوير",
  SCHOOL_MANAGER: "مدير المدرسة",
  SUPER_ADMIN: "إدارة المنصة",
  IT_COORDINATOR: "تقنية المعلومات",
};

export function CourseComments({
  courseId,
  initialComments,
}: {
  courseId: string;
  initialComments: Array<{
    id: string;
    body: string;
    createdAt: Date | string;
    authorId: string;
    authorName: string;
    authorRole: string;
  }>;
  canComment: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    addCourseCommentAction,
    initialState
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the textarea after a successful post.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  const rows: CommentRow[] = initialComments.map((row) => ({
    ...row,
    createdAt:
      typeof row.createdAt === "string"
        ? row.createdAt
        : row.createdAt.toISOString(),
  }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-extrabold text-slate-800">نقاش الدورة</h2>
      <p className="mt-1 text-xs text-slate-500">
        تواصل مع فريق التدريب وزملائك حول هذا التدريب — تُسجَّل المشاركات بأسماء حساباتها.
      </p>

      <form ref={formRef} action={formAction} className="mt-4">
        <input type="hidden" name="courseId" value={courseId} />
        <textarea
          name="body"
          rows={3}
          maxLength={2000}
          required
          placeholder="اكتب مشاركتك أو سؤالك…"
          className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          {!state.ok && state.message ? (
            <p className="text-xs font-semibold text-red-600">{state.message}</p>
          ) : (
            <p className="text-xs text-slate-400">
              {state.ok ? "تمت إضافة مشاركتك." : "بحد أقصى 2000 حرف."}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#174aa8] disabled:opacity-60"
          >
            {pending ? "جارٍ النشر…" : "نشر المشاركة"}
          </button>
        </div>
      </form>

      {rows.length > 0 && (
        <ul className="mt-5 space-y-3 border-t border-slate-100 pt-4">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg bg-slate-50 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold text-slate-800">
                  {row.authorName}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#1D5BD6] ring-1 ring-blue-100">
                  {ROLE_LABELS[row.authorRole] ?? row.authorRole}
                </span>
                <span className="text-[10px] text-slate-400">
                  {new Date(row.createdAt).toLocaleString("ar-SA", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                {row.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
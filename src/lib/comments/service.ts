import type { ViewerIdentity } from "@/lib/training/access";
import { canManageTraining } from "@/lib/training/access";
import { db } from "@/lib/db";

/* ------------------------------------------------------------------ */
/* Batch 1 — course comments (the course wall).                        */
/*                                                                     */
/* Restores the original HTML platform's teacher/supervisor dialogue   */
/* (v14/v15 comment sections + v40 messages) as course-scoped comments */
/* bound to REAL user ids — no name-string matching, no fake           */
/* recipients. Visibility follows the learning-view fence: published   */
/* platform-wide or own-school courses for everyone; managers may      */
/* also comment on their school's draft previews.                      */
/* ------------------------------------------------------------------ */

export type CommentErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION";

export type CommentResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      message: string;
      code?: CommentErrorCode;
      fieldErrors?: Record<string, string>;
    };

function commentFail<T>(
  message: string,
  code: CommentErrorCode,
  fieldErrors?: Record<string, string>
): CommentResult<T> {
  return { ok: false, message, code, fieldErrors };
}

const MAX_COMMENT_LENGTH = 2000;
const COMMENTS_PAGE_SIZE = 30;

export interface CourseCommentRow {
  id: string;
  body: string;
  createdAt: Date;
  authorId: string;
  authorName: string;
  authorRole: string;
}

/** Can this viewer read (and write on) the course wall? */
async function courseWallAccess(
  viewer: ViewerIdentity,
  courseId: string
): Promise<{ ok: true } | { ok: false; message: string; code: CommentErrorCode }> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, status: true, schoolId: true },
  });
  if (!course) {
    return { ok: false, message: "الدورة غير موجودة", code: "NOT_FOUND" };
  }
  const managerPreview =
    canManageTraining(viewer.role) &&
    (viewer.role === "SUPER_ADMIN" || course.schoolId === viewer.schoolId);
  const allowed =
    managerPreview ||
    (course.status === "PUBLISHED" &&
      (course.schoolId === null || course.schoolId === viewer.schoolId));
  if (!allowed) {
    return {
      ok: false,
      message: "هذه الدورة غير متاحة لك",
      code: "FORBIDDEN",
    };
  }
  return { ok: true };
}

/** Latest comments of one course wall (oldest-last for chat reading). */
export async function listCourseComments(
  viewer: ViewerIdentity,
  courseId: string,
  page = 1
): Promise<CommentResult<{ rows: CourseCommentRow[]; total: number; page: number; pageCount: number }>> {
  const access = await courseWallAccess(viewer, courseId);
  if (!access.ok) return commentFail(access.message, access.code);

  const total = await db.courseComment.count({ where: { courseId } });
  const pageCount = Math.max(1, Math.ceil(total / COMMENTS_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);

  const rows = await db.courseComment.findMany({
    where: { courseId },
    include: { author: { select: { name: true, role: true } } },
    orderBy: { createdAt: "desc" },
    skip: (current - 1) * COMMENTS_PAGE_SIZE,
    take: COMMENTS_PAGE_SIZE,
  });

  return {
    ok: true,
    data: {
      rows: rows
        .map((row) => ({
          id: row.id,
          body: row.body,
          createdAt: row.createdAt,
          authorId: row.authorId,
          authorName: row.author.name,
          authorRole: row.author.role,
        }))
        .reverse(),
      total,
      page: current,
      pageCount,
    },
  };
}

/** Add a comment to the course wall (author = session user). */
export async function addCourseComment(
  viewer: ViewerIdentity,
  courseId: string,
  body: string
): Promise<CommentResult<CourseCommentRow>> {
  const access = await courseWallAccess(viewer, courseId);
  if (!access.ok) return commentFail(access.message, access.code);

  const text = body.trim();
  if (!text) {
    return commentFail("اكتب تعليقًا قبل الإرسال", "VALIDATION", {
      body: "التعليق فارغ",
    });
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    return commentFail(
      `التعليق أطول من الحد المسموح (${MAX_COMMENT_LENGTH} حرفًا)`,
      "VALIDATION",
      { body: "التعليق طويل جدًا" }
    );
  }

  const author = await db.user.findUnique({
    where: { id: viewer.id },
    select: { name: true, role: true },
  });
  if (!author) return commentFail("الحساب غير متاح", "FORBIDDEN");

  const created = await db.courseComment.create({
    data: {
      courseId,
      schoolId: null,
      authorId: viewer.id,
      body: text,
    },
    include: { author: { select: { name: true, role: true } } },
  });

  return {
    ok: true,
    data: {
      id: created.id,
      body: created.body,
      createdAt: created.createdAt,
      authorId: created.authorId,
      authorName: created.author.name,
      authorRole: created.author.role,
    },
  };
}
import { db } from "@/lib/db";

import type { ViewerIdentity } from "@/lib/training/access";
import { canManageTraining } from "@/lib/training/access";

/* ------------------------------------------------------------------ */
/* Mandatory learning — sequential unlocking & watch heartbeat.         */
/*                                                                      */
/* SERVER-SIDE ONLY enforcement:                                        */
/*   1. A published lesson is locked until every published lesson       */
/*      BEFORE it (sections by orderIndex, lessons by orderIndex) is    */
/*      completed — for TEACHER learners when the course's              */
/*      requireSequentialLessons policy is on. Managers preview freely. */
/*   2. Watch progress is a heartbeat ledger (LessonWatchState): the    */
/*      client can only REPORT a position; the server decides how much  */
/*      watch time that report is worth (capped by real elapsed wall   */
/*      clock — playback speed above 1x buys nothing), keeps the        */
/*      monotonic max position bounded by accumulated watch time, and   */
/*      is the ONLY writer of lesson completion for VIDEO lessons.      */
/* ------------------------------------------------------------------ */

/* ------------------------------ types ----------------------------- */

export interface SequenceLockInfo {
  locked: boolean;
  /** Title of the first incomplete lesson blocking this one (null when free). */
  lockedByTitle: string | null;
  /** The first not-yet-completed lesson in order (the "current" one). */
  current: boolean;
}

export interface LessonWatchSnapshot {
  watchSeconds: number;
  maxPositionSeconds: number;
  lastPositionSeconds: number;
  watchedPercent: number;
  completed: boolean;
}

export type WatchHeartbeatCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "LESSON_LOCKED"
  | "LESSON_NOT_PUBLISHED"
  | "ROLE_FORBIDDEN"
  | "VALIDATION"
  | "UNKNOWN";

export type WatchHeartbeatResult =
  | {
      ok: true;
      data: {
        watchSeconds: number;
        maxPositionSeconds: number;
        lastPositionSeconds: number;
        watchedPercent: number;
        completed: boolean;
        justCompleted: boolean;
        thresholdPercent: number;
        skipped: boolean;
      };
    }
  | { ok: false; message: string; code?: WatchHeartbeatCode };

/* -------------------------- pure helpers -------------------------- */

/**
 * Compute per-lesson lock state from the flat published order and the
 * completion set. Pure — no DB, trivially testable. When sequential
 * learning is disabled every lesson is free; the first incomplete
 * lesson is still flagged as "current" for the UI.
 */
export function computeSequentialLocks(
  ordered: Array<{ id: string; titleAr: string }>,
  completedIds: readonly string[],
  requireSequential: boolean
): Map<string, SequenceLockInfo> {
  const completed = new Set(completedIds);
  const titleById = new Map(ordered.map((entry) => [entry.id, entry.titleAr]));
  const result = new Map<string, SequenceLockInfo>();
  let firstIncompleteId: string | null = null;
  for (const lesson of ordered) {
    const isCompleted = completed.has(lesson.id);
    const current = firstIncompleteId === null && !isCompleted;
    if (current) firstIncompleteId = lesson.id;
    const blockedBy =
      requireSequential && !isCompleted && firstIncompleteId !== null;
    result.set(lesson.id, {
      locked: blockedBy && lesson.id !== firstIncompleteId,
      lockedByTitle:
        blockedBy && lesson.id !== firstIncompleteId
          ? (titleById.get(firstIncompleteId as string) ?? null)
          : null,
      current,
    });
  }
  return result;
}

/* ------------------------------ reads ----------------------------- */

export interface CourseLearningPolicy {
  requireSequentialLessons: boolean;
  lessonCompletionThreshold: number;
}

/** The mandatory-learning policy of one course (defaults when missing row). */
export async function getCourseLearningPolicy(
  courseId: string
): Promise<CourseLearningPolicy> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: {
      requireSequentialLessons: true,
      lessonCompletionThreshold: true,
    },
  });
  return {
    requireSequentialLessons: course?.requireSequentialLessons ?? true,
    lessonCompletionThreshold: course?.lessonCompletionThreshold ?? 95,
  };
}

/**
 * Flat published-lesson order of one course — the canonical sequence
 * (sections by orderIndex, then lessons by orderIndex).
 */
export async function getOrderedPublishedLessons(courseId: string): Promise<
  Array<{ id: string; titleAr: string; type: string; durationSeconds: number | null }>
> {
  const sections = await db.courseSection.findMany({
    where: { courseId },
    orderBy: { orderIndex: "asc" },
    select: {
      lessons: {
        where: { isPublished: true },
        orderBy: { orderIndex: "asc" },
        select: { id: true, titleAr: true, type: true, durationSeconds: true },
      },
    },
  });
  return sections.flatMap((section) => section.lessons);
}

/**
 * Server-side sequential gate for ONE lesson: is this viewer allowed to
 * open/play it right now? Enforces visibility + publication + the
 * sequential policy (managers bypass — preview mode). Used by the
 * heartbeat, the media proxy and (transitively) completion writes.
 */
export async function assertLessonPlayable(
  viewer: ViewerIdentity,
  courseId: string,
  lessonId: string
): Promise<{ ok: true } | { ok: false; message: string; code: WatchHeartbeatCode }> {
  const lesson = await db.courseLesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      isPublished: true,
      section: {
        select: {
          courseId: true,
          course: {
            select: {
              id: true,
              status: true,
              schoolId: true,
              requireSequentialLessons: true,
            },
          },
        },
      },
    },
  });
  if (!lesson || lesson.section.courseId !== courseId) {
    return { ok: false, message: "الدرس غير موجود في هذه الدورة", code: "NOT_FOUND" };
  }
  const course = lesson.section.course;
  const managerPreview =
    canManageTraining(viewer.role) &&
    (viewer.role === "SUPER_ADMIN" || course.schoolId === viewer.schoolId);
  const visible =
    managerPreview ||
    (course.status === "PUBLISHED" &&
      (course.schoolId === null || course.schoolId === viewer.schoolId));
  if (!visible) {
    return { ok: false, message: "هذه الدورة غير متاحة لك", code: "FORBIDDEN" };
  }
  if (!lesson.isPublished) {
    return { ok: false, message: "هذا الدرس غير منشور بعد", code: "LESSON_NOT_PUBLISHED" };
  }
  if (!course.requireSequentialLessons || managerPreview || viewer.role !== "TEACHER") {
    return { ok: true };
  }

  const ordered = await getOrderedPublishedLessons(course.id);
  const index = ordered.findIndex((entry) => entry.id === lesson.id);
  if (index <= 0) return { ok: true };

  const previousIds = ordered.slice(0, index).map((entry) => entry.id);
  const completedRows = await db.courseLessonProgress.findMany({
    where: { userId: viewer.id, lessonId: { in: previousIds } },
    select: { lessonId: true },
  });
  const completed = new Set(completedRows.map((row) => row.lessonId));
  if (completed.size < previousIds.length) {
    const firstIncomplete = ordered
      .slice(0, index)
      .find((entry) => !completed.has(entry.id));
    return {
      ok: false,
      message: `هذا الدرس مقفل — أكمل درس «${firstIncomplete?.titleAr ?? "الدرس السابق"}» أولًا بالترتيب`,
      code: "LESSON_LOCKED",
    };
  }
  return { ok: true };
}

/* ---------------------------- heartbeats --------------------------- */

/** Minimum gap between accepted heartbeats (rate limit, ms). */
const HEARTBEAT_MIN_GAP_MS = 1500;
/** Wall-clock grace added to each delta cap (network/scheduling jitter). */
const HEARTBEAT_GRACE_SECONDS = 5;
/** Cap for the very first heartbeat of a lesson (resume warm-up). */
const FIRST_BEAT_CAP_SECONDS = 30;

/**
 * One playback heartbeat from the mandatory player. The client reports
 * its current position; the server alone decides how much watch time
 * that is worth and whether the lesson is completed. Anti-cheat:
 *   - delta is capped by REAL elapsed wall clock (+grace) — speeding up
 *     or hammering the action cannot inflate watchSeconds;
 *   - maxPosition can never exceed accumulated watch time;
 *   - completion fires only here, against the course threshold.
 */
export async function recordWatchHeartbeat(
  viewer: ViewerIdentity,
  courseId: string,
  lessonId: string,
  input: {
    positionSeconds: number;
    durationSeconds?: number | null;
    ended?: boolean;
  }
): Promise<WatchHeartbeatResult> {
  const gate = await assertLessonPlayable(viewer, courseId, lessonId);
  if (!gate.ok) return gate;

  if (viewer.role !== "TEACHER") {
    return {
      ok: false,
      message: "متابعة تقدم المشاهدة متاحة للمعلمين فقط",
      code: "ROLE_FORBIDDEN",
    };
  }

  if (
    !Number.isFinite(input.positionSeconds) ||
    input.positionSeconds < 0 ||
    input.positionSeconds > 24 * 3600
  ) {
    return { ok: false, message: "قيمة تقدم غير صالحة", code: "VALIDATION" };
  }

  const [lesson, policy] = await Promise.all([
    db.courseLesson.findUnique({
      where: { id: lessonId },
      select: { id: true, durationSeconds: true },
    }),
    getCourseLearningPolicy(courseId),
  ]);
  if (!lesson) {
    return { ok: false, message: "الدرس غير موجود", code: "NOT_FOUND" };
  }

  const now = new Date();
  const existing = await db.lessonWatchState.findUnique({
    where: { lessonId_userId: { lessonId, userId: viewer.id } },
  });

  const isFirstBeat = !existing;
  const elapsedSeconds = existing
    ? Math.max(0, (now.getTime() - existing.lastHeartbeatAt.getTime()) / 1000)
    : 0;

  // Rate limit: sub-1.5s repeated calls gain nothing — return the
  // current snapshot untouched so a spam loop cannot inflate watch time.
  if (existing && elapsedSeconds < HEARTBEAT_MIN_GAP_MS / 1000) {
    return {
      ok: true,
      data: {
        watchSeconds: existing.watchSeconds,
        maxPositionSeconds: existing.maxPositionSeconds,
        lastPositionSeconds: existing.lastPositionSeconds,
        watchedPercent: existing.reportedDurationSeconds
          ? Math.min(
              100,
              Math.round((existing.watchSeconds / existing.reportedDurationSeconds) * 100)
            )
          : 0,
        completed: await db.courseLessonProgress
          .findUnique({
            where: { lessonId_userId: { lessonId, userId: viewer.id } },
            select: { id: true },
          })
          .then((row) => row !== null),
        justCompleted: false,
        thresholdPercent: policy.lessonCompletionThreshold,
        skipped: true,
      },
    };
  }

  const prev = existing ?? {
    watchSeconds: 0,
    maxPositionSeconds: 0,
    lastPositionSeconds: 0,
    reportedDurationSeconds: null as number | null,
  };

  // Effective duration: instructor-captured value wins; otherwise the
  // client metadata (best-effort fallback, never trusted for storage).
  const duration =
    lesson.durationSeconds ??
    prev.reportedDurationSeconds ??
    (input.durationSeconds && Number.isFinite(input.durationSeconds)
      ? Math.min(Math.max(1, Math.floor(input.durationSeconds)), 24 * 3600)
      : null);

  const position = Math.min(input.positionSeconds, duration ?? input.positionSeconds);
  const delta = position - prev.lastPositionSeconds;

  let watchSeconds = prev.watchSeconds;
  if (delta > 0) {
    // A played second can advance the position by at most one second at
    // 1x — the cap below makes faster "progress" worthless.
    const cap = isFirstBeat ? FIRST_BEAT_CAP_SECONDS : elapsedSeconds + HEARTBEAT_GRACE_SECONDS;
    watchSeconds += Math.min(delta, cap);
  }
  if (duration !== null) {
    watchSeconds = Math.min(watchSeconds, duration);
  }

  // Monotonic ceiling bounded by honest watch accumulation.
  const maxPositionSeconds = Math.min(
    Math.max(prev.maxPositionSeconds, position),
    Math.max(watchSeconds, prev.maxPositionSeconds)
  );

  const thresholdRatio = Math.min(100, Math.max(50, policy.lessonCompletionThreshold)) / 100;
  const watchedPercent =
    duration && duration > 0
      ? Math.min(100, Math.round((watchSeconds / duration) * 100))
      : 0;

  const meetsThreshold =
    duration !== null && watchSeconds >= thresholdRatio * duration;
  const alreadyCompletedRow = await db.courseLessonProgress.findUnique({
    where: { lessonId_userId: { lessonId, userId: viewer.id } },
    select: { id: true },
  });
  const completed = Boolean(alreadyCompletedRow);
  const justCompleted = meetsThreshold && !completed;

  await db.lessonWatchState.upsert({
    where: { lessonId_userId: { lessonId, userId: viewer.id } },
    create: {
      courseId,
      lessonId,
      userId: viewer.id,
      watchSeconds,
      maxPositionSeconds,
      lastPositionSeconds: position,
      reportedDurationSeconds:
        lesson.durationSeconds === null && duration !== null ? duration : null,
      lastHeartbeatAt: now,
    },
    update: {
      watchSeconds,
      maxPositionSeconds,
      lastPositionSeconds: position,
      reportedDurationSeconds:
        lesson.durationSeconds === null && duration !== null ? duration : undefined,
      lastHeartbeatAt: now,
    },
  });

  let courseCompleted = false;
  if (justCompleted) {
    // The ONLY completion path for VIDEO lessons — full server checks,
    // auto-enrollment, notifications and course completion live inside.
    const { markLessonComplete } = await import("@/lib/training/progress");
    const outcome = await markLessonComplete(viewer, courseId, lessonId, {
      source: "watch",
    });
    courseCompleted = outcome.ok && (outcome.data.courseCompleted?.created === true);
  }

  return {
    ok: true,
    data: {
      watchSeconds: Math.round(watchSeconds * 10) / 10,
      maxPositionSeconds: Math.round(maxPositionSeconds * 10) / 10,
      lastPositionSeconds: Math.round(position * 10) / 10,
      watchedPercent,
      completed: completed || justCompleted,
      justCompleted,
      thresholdPercent: policy.lessonCompletionThreshold,
      skipped: false,
    },
  };
}

/** Watch snapshot for the learning page (resume + progress restore). */
export async function listLessonWatchSnapshots(
  userId: string,
  courseId: string
): Promise<Map<string, LessonWatchSnapshot>> {
  const rows = await db.lessonWatchState.findMany({
    where: { userId, courseId },
    select: {
      lessonId: true,
      watchSeconds: true,
      maxPositionSeconds: true,
      lastPositionSeconds: true,
    },
  });
  const map = new Map<string, LessonWatchSnapshot>();
  for (const row of rows) {
    map.set(row.lessonId, {
      watchSeconds: row.watchSeconds,
      maxPositionSeconds: row.maxPositionSeconds,
      lastPositionSeconds: row.lastPositionSeconds,
      watchedPercent: 0,
      completed: false,
    });
  }
  return map;
}
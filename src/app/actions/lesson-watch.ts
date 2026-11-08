"use server";

/**
 * Mandatory video playback — thin "use server" wrapper for the watch
 * heartbeat. The actor always comes from the SESSION; the heavy
 * anti-cheat and sequential gating live in
 * src/lib/training/sequence.ts (recordWatchHeartbeat).
 */

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import { recordWatchHeartbeat } from "@/lib/training/sequence";

export interface WatchActionState {
  ok: boolean;
  message?: string;
  code?: string;
  data?: {
    watchSeconds?: number;
    maxPositionSeconds?: number;
    lastPositionSeconds?: number;
    watchedPercent?: number;
    completed?: boolean;
    justCompleted?: boolean;
    thresholdPercent?: number;
    skipped?: boolean;
  };
}

/**
 * One playback heartbeat: { courseId, lessonId, positionSeconds,
 * durationSeconds?, ended? }. Called by the mandatory player every
 * ~10s while playing, plus on pause/ended/tab-hide. The client can
 * never declare completion — the server decides.
 */
export async function reportWatchProgressAction(
  input: unknown
): Promise<WatchActionState> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isActive) {
      return { ok: false, message: "انتهت الجلسة — سجّل الدخول من جديد.", code: "FORBIDDEN" };
    }
    if (typeof input !== "object" || input === null) {
      return { ok: false, message: "بيانات ناقصة.", code: "VALIDATION" };
    }
    const raw = input as Record<string, unknown>;
    const courseId = typeof raw.courseId === "string" ? raw.courseId : "";
    const lessonId = typeof raw.lessonId === "string" ? raw.lessonId : "";
    const positionSeconds =
      typeof raw.positionSeconds === "number" && Number.isFinite(raw.positionSeconds)
        ? raw.positionSeconds
        : NaN;
    const durationSeconds =
      typeof raw.durationSeconds === "number" && Number.isFinite(raw.durationSeconds)
        ? raw.durationSeconds
        : null;
    const ended = raw.ended === true;

    if (!courseId || !lessonId || !Number.isFinite(positionSeconds)) {
      return { ok: false, message: "بيانات التقدم غير صالحة.", code: "VALIDATION" };
    }

    const result = await recordWatchHeartbeat(
      { id: user.id, role: user.role, schoolId: user.schoolId },
      courseId,
      lessonId,
      { positionSeconds, durationSeconds, ended }
    );
    if (!result.ok) {
      return { ok: false, message: result.message, code: result.code };
    }

    if (result.data.justCompleted) {
      // Refresh the learning page so the next lesson unlocks in place.
      revalidatePath(`/academy/learn/${courseId}`);
    }

    return { ok: true, data: result.data };
  } catch {
    return { ok: false, message: "تعذر تسجيل تقدم المشاهدة — أعد المحاولة.", code: "UNKNOWN" };
  }
}
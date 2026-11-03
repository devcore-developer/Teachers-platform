/**
 * Phase 11 — optional in-process scheduler (FALLBACK ONLY).
 *
 * Production deployments should drive background work through an EXTERNAL
 * scheduler calling the secured POST /api/cron/dispatch endpoint with the
 * CRON_SECRET header — an in-memory timer cannot be relied upon for
 * production scheduling (process restarts, multi-instance deployments).
 *
 * This instrumentation only runs when ENABLE_INTERNAL_SCHEDULER=true,
 * never registers twice, and unrefs its timer so it never keeps the
 * process alive. Every tick is the same idempotent code path the cron
 * endpoint uses.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if ((process.env.ENABLE_INTERNAL_SCHEDULER ?? "").trim() !== "true") return;

  const globalRef = globalThis as typeof globalThis & {
    __mqPhase11SchedulerTimer?: NodeJS.Timeout;
  };
  if (globalRef.__mqPhase11SchedulerTimer) return;

  const { INTERNAL_SCHEDULER_INTERVAL_SECONDS } = await import("@/config/notifications");
  const { scanAssignmentDeadlineReminders, scanCourseCompletions } = await import(
    "@/lib/notifications/reminders"
  );
  const { processEmailOutbox } = await import("@/lib/notifications/dispatcher");

  const tick = async (): Promise<void> => {
    try {
      await scanAssignmentDeadlineReminders();
    } catch (error) {
      // Logged but never fatal — the next tick retries idempotently.
      console.error(
        "[scheduler] deadline scan failed:",
        error instanceof Error ? error.message : error
      );
    }
    try {
      await scanCourseCompletions();
    } catch (error) {
      console.error(
        "[scheduler] course-completion scan failed:",
        error instanceof Error ? error.message : error
      );
    }
    try {
      await processEmailOutbox();
    } catch (error) {
      console.error(
        "[scheduler] email dispatch failed:",
        error instanceof Error ? error.message : error
      );
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, Math.max(30, INTERNAL_SCHEDULER_INTERVAL_SECONDS) * 1000);
  timer.unref?.();
  globalRef.__mqPhase11SchedulerTimer = timer;
}
/**
 * Phase 11 — secured scheduled-job trigger: POST|GET /api/cron/dispatch
 *
 * Production scheduling contract (documented in docs/notifications.md):
 *   - An EXTERNAL scheduler (system crontab, Vercel Cron, GitHub Actions,
 *     Cloud Scheduler…) calls this endpoint every minute (or any interval)
 *     with the shared secret.
 *   - Secret is supplied via `x-cron-secret` header OR
 *     `Authorization: Bearer <CRON_SECRET>`; compared in constant time.
 *     (Phase 12: the URL query-parameter channel was REMOVED — secrets in
 *     URLs leak into access logs and browser history.)
 *   - If CRON_SECRET is not configured the endpoint responds 503 and runs
 *     NOTHING — it never silently processes unauthenticated work.
 *   - Phase 12: any step that THROWS turns the response into HTTP 500
 *     (body still carries the honest per-step report) so status-code
 *     based monitoring can alert; handled per-item delivery failures
 *     remain a 200 with their counts — they are tracked in EmailDelivery
 *     and visible in /integrations.
 *
 * Per tick (each step reports honestly and independently):
 *   1. Assignment-deadline reminder scan (idempotent per UTC day).
 *   2. Course-completion scan (idempotent per teacher+course lifetime).
 *   3. Email outbox dispatch (bounded retries, no provider → honest no-op).
 */

import { NextResponse } from "next/server";
import { safeSecretEquals } from "@/lib/auth/tokens";
import { scanAssignmentDeadlineReminders, scanCourseCompletions } from "@/lib/notifications/reminders";
import { processEmailOutbox } from "@/lib/notifications/dispatcher";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "UNAUTHORIZED", message: "سر المجدول غير صحيح أو مفقود" },
    { status: 401 },
  );
}

async function handle(request: Request) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_NOT_CONFIGURED",
        message:
          "لم يتم ضبط CRON_SECRET على هذا النشر — نقطة المجدول معطّلة عمدًا وتشغيل المهام غير مسموح بدون مصادقة",
      },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get("x-cron-secret")?.trim() ||
    (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim() ||
    "";
  if (!provided || !safeSecretEquals(provided, secret)) return unauthorized();

  const startedAt = new Date();
  const errors: string[] = [];

  let deadlineScan: Awaited<ReturnType<typeof scanAssignmentDeadlineReminders>> | null = null;
  let courseScan: Awaited<ReturnType<typeof scanCourseCompletions>> | null = null;
  let dispatch: Awaited<ReturnType<typeof processEmailOutbox>> | null = null;

  try {
    deadlineScan = await scanAssignmentDeadlineReminders();
  } catch (error) {
    errors.push("deadline-scan");
    console.error("[cron] deadline scan failed:", error instanceof Error ? error.message : error);
  }
  try {
    courseScan = await scanCourseCompletions();
  } catch (error) {
    errors.push("course-scan");
    console.error("[cron] course scan failed:", error instanceof Error ? error.message : error);
  }
  try {
    dispatch = await processEmailOutbox();
  } catch (error) {
    errors.push("email-dispatch");
    console.error("[cron] email dispatch failed:", error instanceof Error ? error.message : error);
  }

  const failed = errors.length > 0;
  return NextResponse.json(
    {
      ok: !failed,
      ranAt: startedAt.toISOString(),
      deadlineScan,
      courseScan,
      dispatch,
      ...(failed ? { errors } : {}),
    },
    // 500 keeps status-code monitoring honest: a thrown step is a real
    // infrastructure failure, not a normal empty tick.
    { status: failed ? 500 : 200 }
  );
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
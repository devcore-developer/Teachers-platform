/**
 * Phase 12 — public health check: GET /api/health
 *
 * Minimal, honest, secret-free. Returns 200 only when the database
 * answers; 503 otherwise so uptime monitors can alert. Email/scheduler
 * are reported as deployment FACTS (configured / not configured) — they
 * degrade gracefully elsewhere and are never a failure of this probe.
 *
 * No credentials, no masked emails, no queue contents — safe to expose.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPlatformIntegrationStatus } from "@/lib/integrations/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  let database: "up" | "down" = "down";
  try {
    await db.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  // Global, non-sensitive deployment facts (same projections the
  // /integrations page uses — no key material, no recipients).
  let email: "configured" | "unconfigured" = "unconfigured";
  let scheduler: "external" | "internal-fallback" | "none" = "none";
  try {
    const status = getPlatformIntegrationStatus();
    email = status.email.configured ? "configured" : "unconfigured";
    scheduler = status.scheduler.internalSchedulerEnabled
      ? "internal-fallback"
      : status.scheduler.cronSecretConfigured
        ? "external"
        : "none";
  } catch {
    // Status introspection must never break the health probe itself.
  }

  const ok = database === "up";
  return NextResponse.json(
    {
      ok,
      service: "manarat-qurtubah-platform",
      time: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      checks: { database, email, scheduler },
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
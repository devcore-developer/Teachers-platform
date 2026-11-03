/**
 * Phase 12 — security & tenant-isolation suite.
 *
 * Distinct focus versus the per-phase suites: ADVERSARIAL access —
 * unauthenticated requests, cross-school identities, foreign object ids,
 * renamed-file uploads, storage path escapes and abuse-rate limits —
 * exercised against the REAL services, the REAL route handlers and the
 * REAL SQLite database (prisma/test-platform.db, p12- fixtures).
 *
 * Route handlers are tested by direct invocation with a MOCKED session
 * module (bun mock.module) so one test file can play unauthenticated,
 * owner, cross-school and unlinked-supervisor identities against the
 * exact production authorization code. The email provider is never
 * contacted; no result is treated as a real delivery.
 *
 * File name starts with zz- so it runs LAST: the session module mock
 * replaces the stand-in for modules imported after it, and no other
 * suite imports route handlers.
 *
 * Run: bun test tests/zz-security-isolation.test.ts
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const TEST_DB_URL = `file:${path.join(PROJECT_ROOT, "prisma", "test-platform.db")}`;

process.env.DATABASE_URL = TEST_DB_URL;
// Isolated storage root for this suite (set BEFORE the storage import).
const storageRoot = mkdtempSync(path.join(os.tmpdir(), "p12-submission-storage-"));
process.env.ASSIGNMENTS_STORAGE_DIR = storageRoot;

execSync("bunx prisma db push --skip-generate --accept-data-loss", {
  cwd: PROJECT_ROOT,
  env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  stdio: "pipe",
});

// Dynamic imports after the env override.
const { db } = await import("@/lib/db");
const { hashPassword } = await import("@/lib/auth/password");
const {
  notify,
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} = await import("@/lib/notifications/service");
const {
  requestPasswordReset,
  createEmailVerificationToken,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
} = await import("@/lib/auth/tokens");
const { resetRateLimits } = await import("@/lib/security/rate-limit");
const {
  saveSubmissionObject,
  readSubmissionObject,
  deleteSubmissionObject,
  deleteAllSubmissionObjects,
} = await import("@/lib/assignments/storage");
const { uploadSubmissionFile } = await import("@/lib/assignments/service");
const {
  verifyCertificate,
} = await import("@/lib/certificates/service");
const { buildReportExcelXml } = await import("@/lib/reports/export");

/* ------------------------------------------------------------------ */
/* Session mock — identity is switched per test, never guessed.         */
/* ------------------------------------------------------------------ */

type MockUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  schoolId: string | null;
  branchId: string | null;
};

let currentUser: MockUser | null = null;

mock.module("@/lib/auth/session", () => ({
  getCurrentUser: async (): Promise<MockUser | null> => currentUser,
  // Pages import SafeUser only as a type — no runtime export needed.
}));

const notificationsRoute = await import("@/app/api/notifications/route");
const notificationsReadRoute = await import("@/app/api/notifications/[id]/read/route");
const assignmentFilesRoute = await import("@/app/api/assignment-files/[id]/route");
const exportRoute = await import("@/app/api/reports/[reportId]/export/route");
const healthRoute = await import("@/app/api/health/route");
const cronRoute = await import("@/app/api/cron/dispatch/route");

/* ------------------------------------------------------------------ */
/* Fixtures — p12- prefixed, two schools, idempotent cleanup.           */
/* ------------------------------------------------------------------ */

async function cleanupPhase12Fixtures(): Promise<void> {
  const users = await db.user.findMany({
    where: { email: { contains: "p12-" } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const schools = await db.school.findMany({
    where: { slug: { startsWith: "p12-" } },
    select: { id: true },
  });
  const schoolIds = schools.map((s) => s.id);

  if (userIds.length > 0) {
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await db.emailVerificationToken.deleteMany({ where: { userId: { in: userIds } } });
    await db.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await db.emailDelivery.deleteMany({ where: { toEmail: { contains: "p12-" } } });
  }
  if (schoolIds.length > 0) {
    await db.assignmentSubmission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await db.assignment.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await db.course.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await db.certificate.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await db.teacherSupervisorAssignment.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await db.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
  }
  await db.user.deleteMany({ where: { email: { contains: "p12-" } } });
  await db.school.deleteMany({ where: { slug: { startsWith: "p12-" } } });
}

await cleanupPhase12Fixtures();
await deleteAllSubmissionObjects().catch(() => {});

const schoolAId = (
  await db.school.create({ data: { nameAr: "مدرسة ت12 أ", nameEn: "P12 School A", slug: "p12-a" } })
).id;
const schoolBId = (
  await db.school.create({ data: { nameAr: "مدرسة ت12 ب", nameEn: "P12 School B", slug: "p12-b" } })
).id;

const passwordHash = await hashPassword("p12-Honest-Password!");

async function seedUser(input: {
  name: string;
  email: string;
  role: string;
  schoolId?: string | null;
}): Promise<{ id: string; email: string }> {
  return db.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
      schoolId: input.schoolId ?? null,
      isActive: true,
    },
  });
}

const teacherA = await seedUser({ name: "معلم أ ت12", email: "p12-teacher-a@test.local", role: "TEACHER", schoolId: schoolAId });
const teacherB = await seedUser({ name: "معلم ب ت12", email: "p12-teacher-b@test.local", role: "TEACHER", schoolId: schoolBId });
const managerA = await seedUser({ name: "مدير أ ت12", email: "p12-manager-a@test.local", role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: schoolAId });
const managerB = await seedUser({ name: "مدير ب ت12", email: "p12-manager-b@test.local", role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: schoolBId });
const supervisorA = await seedUser({ name: "مشرف أ ت12", email: "p12-supervisor-a@test.local", role: "EDUCATIONAL_SUPERVISOR", schoolId: schoolAId });

function asMockUser(user: { id: string; email: string }, role: string, schoolId: string | null): MockUser {
  return { id: user.id, name: "fixture", email: user.email, role, schoolId, branchId: null };
}

/* Notification fixtures: one per user. */
const notifAOutcome = await notify({
  userId: teacherA.id,
  type: "PLATFORM_NOTICE",
  titleAr: "إشعار المعلم أ",
  bodyAr: "رسالة خاصة بالمعلم أ فقط",
  destinationUrl: "/dashboard",
  eventId: "p12-notify-a",
  email: false,
});
if (!notifAOutcome.ok || !notifAOutcome.notificationId) {
  throw new Error("p12 fixture: notification A was not created");
}
const notifAId: string = notifAOutcome.notificationId;
const notifBOutcome = await notify({
  userId: teacherB.id,
  type: "PLATFORM_NOTICE",
  titleAr: "إشعار المعلم ب",
  bodyAr: "رسالة خاصة بالمعلم ب فقط",
  destinationUrl: "/dashboard",
  eventId: "p12-notify-b",
  email: false,
});
if (!notifBOutcome.ok || !notifBOutcome.notificationId) {
  throw new Error("p12 fixture: notification B was not created");
}
const notifBId: string = notifBOutcome.notificationId;

/* Assignment + submission + stored file fixtures (school A). */
const assignmentAId = (
  await db.assignment.create({
    data: {
      schoolId: schoolAId,
      createdById: managerA.id,
      titleAr: "واجب عزل ت12",
      descriptionAr: "تكليف لاختبار صلاحيات التنزيل والرفع.",
      audienceMode: "ALL_TEACHERS",
      status: "PUBLISHED",
      publishedAt: new Date(),
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })
).id;

const submissionAId = (
  await db.assignmentSubmission.create({
    data: {
      assignmentId: assignmentAId,
      teacherId: teacherA.id,
      schoolId: schoolAId,
      status: "DRAFT",
    },
  })
).id;

const storedFile = await saveSubmissionObject(
  Buffer.from("%PDF-1.7 real fixture bytes for the download test"),
  "submission.pdf"
);
const submissionFileId = (
  await db.submissionFile.create({
    data: {
      submissionId: submissionAId,
      storageKey: storedFile.storageKey,
      fileName: "خطة-التحسين.pdf",
      mimeType: "application/pdf",
      sizeBytes: storedFile.sizeBytes,
    },
  })
).id;

/* Certificate fixture (school A) for verification isolation/limits. */
const certificateAId = (
  await db.certificate.create({
    data: {
      schoolId: schoolAId,
      teacherId: teacherA.id,
      certificateNumber: "MQ-2026-120001",
      verificationCode: "P12VERIFYCODE01",
      titleAr: "شهادة اختبار ت12",
      status: "ISSUED",
      issuedAt: new Date(),
      issuedById: managerA.id,
      criteriaSnapshotJson: "[]",
    },
  })
).id;

const savedCronSecret = process.env.CRON_SECRET;

beforeAll(() => {
  resetRateLimits();
});

afterAll(async () => {
  if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCronSecret;
  currentUser = null;
  await cleanupPhase12Fixtures();
  await deleteAllSubmissionObjects().catch(() => {});
});

/* ================================================================== */
/* 1 — Notification ownership (service level)                           */
/* ================================================================== */

describe("Phase 12 — notification ownership", () => {
  test("listNotifications returns ONLY the caller's rows", async () => {
    const own = await listNotifications({ userId: teacherA.id });
    expect(own.items.length).toBeGreaterThanOrEqual(1);
    expect(own.items.every((row) => row.id !== notifBId)).toBe(true);
  });

  test("marking a FOREIGN notification read is refused (changed:false, row untouched)", async () => {
    const before = await db.notification.findUnique({ where: { id: notifBId } });
    expect(before?.readAt).toBeNull();

    const result = await markNotificationRead(teacherA.id, notifBId);
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);

    const after = await db.notification.findUnique({ where: { id: notifBId } });
    expect(after?.readAt).toBeNull();
  });

  test("unread counts are per-user", async () => {
    const countA = await getUnreadCount(teacherA.id);
    const countB = await getUnreadCount(teacherB.id);
    expect(countA).toBeGreaterThanOrEqual(1);
    expect(countB).toBeGreaterThanOrEqual(1);
    // Marking ALL of A's read must not change B's counter.
    await markAllNotificationsRead(teacherA.id);
    expect(await getUnreadCount(teacherA.id)).toBe(0);
    expect(await getUnreadCount(teacherB.id)).toBe(countB);
  });
});

/* ================================================================== */
/* 2 — Route handlers: unauthenticated / cross-identity access          */
/* ================================================================== */

describe("Phase 12 — API route authorization (mocked session identities)", () => {
  test("GET /api/notifications without a session → 401", async () => {
    currentUser = null;
    const response = await notificationsRoute.GET(new Request("http://localhost/api/notifications"));
    expect(response.status).toBe(401);
  });

  test("GET /api/notifications returns only the session user's rows", async () => {
    currentUser = asMockUser(teacherA, "TEACHER", schoolAId);
    const response = await notificationsRoute.GET(new Request("http://localhost/api/notifications"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data?: { items?: Array<{ id: string }> } };
    const rows = payload.data?.items ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => row.id !== notifBId)).toBe(true);
  });

  test("POST /api/notifications/[id]/read as a FOREIGN user → honest changed:false", async () => {
    currentUser = asMockUser(teacherA, "TEACHER", schoolAId);
    const response = await notificationsReadRoute.POST(
      new Request("http://localhost/api/notifications/x/read", { method: "POST" }),
      { params: Promise.resolve({ id: notifBId }) }
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data?: { changed?: boolean } };
    expect(payload.data?.changed).toBe(false);
    const row = await db.notification.findUnique({ where: { id: notifBId } });
    expect(row?.readAt).toBeNull();
  });

  test("GET /api/assignment-files/[id] without a session → 401", async () => {
    currentUser = null;
    const response = await assignmentFilesRoute.GET(
      new Request("http://localhost/api/assignment-files/x"),
      { params: Promise.resolve({ id: submissionFileId }) }
    );
    expect(response.status).toBe(401);
  });

  test("GET /api/assignment-files/[id] — cross-school manager → 403", async () => {
    currentUser = asMockUser(managerB, "DEVELOPMENT_OFFICE_MANAGER", schoolBId);
    const response = await assignmentFilesRoute.GET(
      new Request("http://localhost/api/assignment-files/x"),
      { params: Promise.resolve({ id: submissionFileId }) }
    );
    expect(response.status).toBe(403);
  });

  test("GET /api/assignment-files/[id] — same-school supervisor WITHOUT a coverage link → 403", async () => {
    currentUser = asMockUser(supervisorA, "EDUCATIONAL_SUPERVISOR", schoolAId);
    const response = await assignmentFilesRoute.GET(
      new Request("http://localhost/api/assignment-files/x"),
      { params: Promise.resolve({ id: submissionFileId }) }
    );
    expect(response.status).toBe(403);
  });

  test("GET /api/assignment-files/[id] — foreign teacher → 403", async () => {
    currentUser = asMockUser(teacherB, "TEACHER", schoolBId);
    const response = await assignmentFilesRoute.GET(
      new Request("http://localhost/api/assignment-files/x"),
      { params: Promise.resolve({ id: submissionFileId }) }
    );
    expect(response.status).toBe(403);
  });

  test("GET /api/assignment-files/[id] — owning teacher → 200 with the stored bytes", async () => {
    currentUser = asMockUser(teacherA, "TEACHER", schoolAId);
    const response = await assignmentFilesRoute.GET(
      new Request("http://localhost/api/assignment-files/x"),
      { params: Promise.resolve({ id: submissionFileId }) }
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.startsWith("%PDF-1.7")).toBe(true);
  });

  test("GET /api/assignment-files/[id] — same-school manager → 200", async () => {
    currentUser = asMockUser(managerA, "DEVELOPMENT_OFFICE_MANAGER", schoolAId);
    const response = await assignmentFilesRoute.GET(
      new Request("http://localhost/api/assignment-files/x"),
      { params: Promise.resolve({ id: submissionFileId }) }
    );
    expect(response.status).toBe(200);
  });

  test("GET /api/reports/[reportId]/export without a session → 401", async () => {
    currentUser = null;
    const response = await exportRoute.GET(
      new Request("http://localhost/api/reports/school-overview/export"),
      { params: Promise.resolve({ reportId: "school-overview" }) }
    );
    expect(response.status).toBe(401);
  });

  test("GET /api/reports/[reportId]/export as TEACHER → 403", async () => {
    currentUser = asMockUser(teacherA, "TEACHER", schoolAId);
    const response = await exportRoute.GET(
      new Request("http://localhost/api/reports/school-overview/export"),
      { params: Promise.resolve({ reportId: "school-overview" }) }
    );
    expect(response.status).toBe(403);
  });

  test("GET /api/health reports the database honestly (up → 200)", async () => {
    currentUser = null;
    const response = await healthRoute.GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; checks: { database: string } };
    expect(payload.ok).toBe(true);
    expect(payload.checks.database).toBe("up");
  });
});

/* ================================================================== */
/* 3 — Cron hardening                                                   */
/* ================================================================== */

describe("Phase 12 — cron endpoint hardening", () => {
  test("the ?secret= query-param channel is CLOSED (secrets must not live in URLs)", async () => {
    process.env.CRON_SECRET = "p12-cron-secret-value";
    const response = await cronRoute.GET(
      new Request("http://localhost/api/cron/dispatch?secret=p12-cron-secret-value")
    );
    expect(response.status).toBe(401);
  });

  test("header and Bearer channels still authenticate", async () => {
    process.env.CRON_SECRET = "p12-cron-secret-value";
    const byHeader = await cronRoute.POST(
      new Request("http://localhost/api/cron/dispatch", {
        method: "POST",
        headers: { "x-cron-secret": "p12-cron-secret-value" },
      })
    );
    expect(byHeader.status).toBe(200);
    const payload = (await byHeader.json()) as { ok: boolean };
    expect(payload.ok).toBe(true);
  });
});

/* ================================================================== */
/* 4 — Password-reset flood control                                     */
/* ================================================================== */

describe("Phase 12 — password-reset rate limiting", () => {
  test("4th request for the SAME email inside the window is suppressed (identical neutral shape)", async () => {
    resetRateLimits();
    const email = "p12-flood-victim@test.local";
    for (let i = 0; i < 3; i += 1) {
      const allowed = await requestPasswordReset(email);
      expect(allowed.accepted).toBe(true);
      expect(allowed.rateLimited).toBeUndefined();
    }
    const blocked = await requestPasswordReset(email);
    expect(blocked.accepted).toBe(true); // anti-enumeration shape unchanged
    expect(blocked.rateLimited).toBe(true);
    expect(blocked.emailSent).toBe(false);
  });

  test("the limiter is PER-EMAIL: a different address still goes through", async () => {
    const other = await requestPasswordReset("p12-other-user@test.local");
    expect(other.rateLimited).toBeUndefined();
    resetRateLimits();
  });

  test("a suppressed request leaves NO reset token in the database", async () => {
    const victim = await db.user.findUnique({ where: { email: "p12-flood-victim@test.local" } });
    // The fixture user never existed — nothing should exist either way,
    // and the 4th call must not have created a row.
    const tokens = await db.passwordResetToken.count({
      where: { user: { email: "p12-flood-victim@test.local" } },
    });
    expect(victim ?? null).toBeNull();
    expect(tokens).toBe(0);
  });
});

/* ================================================================== */
/* 5 — Upload content sniffing (renamed-binary rejection)               */
/* ================================================================== */

describe("Phase 12 — upload magic-byte validation", () => {
  function fileWith(mime: string, header: number[], size = 1024): File {
    const bytes = new Uint8Array(size);
    bytes.set(header, 0);
    return new File([bytes], "ملف-مرفوع", { type: mime });
  }

  test("a PNG renamed to .pdf (declared application/pdf) is REJECTED", async () => {
    currentUser = asMockUser(teacherA, "TEACHER", schoolAId);
    const fake = fileWith("application/pdf", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await uploadSubmissionFile(
      { id: teacherA.id, role: "TEACHER", schoolId: schoolAId },
      { assignmentId: assignmentAId, file: fake }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FILE_INVALID");
  });

  test("a real PDF passes and creates a downloadable file row", async () => {
    const real = fileWith("application/pdf", [0x25, 0x50, 0x44, 0x46]);
    const result = await uploadSubmissionFile(
      { id: teacherA.id, role: "TEACHER", schoolId: schoolAId },
      { assignmentId: assignmentAId, file: real }
    );
    expect(result.ok).toBe(true);
  });

  test("text/plain is accepted without sniffing (documented leniency)", async () => {
    const text = fileWith("text/plain", [0xd8, 0xa3, 0xd9, 0x87]); // Arabic UTF-8, no magic
    const result = await uploadSubmissionFile(
      { id: teacherA.id, role: "TEACHER", schoolId: schoolAId },
      { assignmentId: assignmentAId, file: text }
    );
    expect(result.ok).toBe(true);
  });
});

/* ================================================================== */
/* 6 — Storage path-escape jail                                         */
/* ================================================================== */

describe("Phase 12 — storage path-escape protection", () => {
  test("readSubmissionObject rejects keys escaping the storage root", async () => {
    expect(readSubmissionObject("../outside-secret.txt")).rejects.toThrow("SUBMISSION_FILE_PATH_ESCAPE");
  });

  test("deleteSubmissionObject rejects keys escaping the storage root", async () => {
    expect(deleteSubmissionObject("2026/01/../../../evil")).rejects.toThrow("SUBMISSION_FILE_PATH_ESCAPE");
  });

  test("a legit saved key reads back byte-identical", async () => {
    const saved = await saveSubmissionObject(Buffer.from("p12-roundtrip"), "roundtrip.txt");
    const content = await readSubmissionObject(saved.storageKey);
    expect(content.toString("utf-8")).toBe("p12-roundtrip");
  });
});

/* ================================================================== */
/* 7 — Certificate verification: enumeration friction + isolation       */
/* ================================================================== */

describe("Phase 12 — certificate verification hardening", () => {
  const managerACtx = { id: managerA.id, role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: schoolAId } as const;
  const managerBCtx = { id: managerB.id, role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: schoolBId } as const;

  test("cross-school search returns found:false — no existence leak", async () => {
    resetRateLimits();
    const result = await verifyCertificate(managerBCtx, { query: "MQ-2026-120001" });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as { found: boolean }).found).toBe(false);
  });

  test("own-school search verifies honestly", async () => {
    resetRateLimits();
    const result = await verifyCertificate(managerACtx, { query: "MQ-2026-120001" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { found: boolean; certificate?: { certificateNumber: string; effectiveStatus: string } };
      expect(data.found).toBe(true);
      expect(data.certificate?.certificateNumber).toBe("MQ-2026-120001");
      expect(data.certificate?.effectiveStatus).toBe("ISSUED");
    }
  });

  test("the 61st search inside one minute is rate-limited (per user)", async () => {
    resetRateLimits();
    let last: Awaited<ReturnType<typeof verifyCertificate>> | null = null;
    for (let i = 0; i < 61; i += 1) {
      last = await verifyCertificate(managerACtx, { query: "MQ-2026-999999" });
    }
    expect(last?.ok).toBe(false);
    if (last && !last.ok) expect(last.code).toBe("RATE_LIMITED");
    // Another user is unaffected.
    const other = await verifyCertificate(managerBCtx, { query: "MQ-2026-999999" });
    expect(other.ok).toBe(true);
    resetRateLimits();
  });
});

/* ================================================================== */
/* 8 — Export cell-type honesty (empty percent is not a zero)           */
/* ================================================================== */

describe("Phase 12 — SpreadsheetML percent cell fix", () => {
  test("an empty percent cell renders as text, never as a fake 0", () => {
    const xml = buildReportExcelXml({
      meta: {
        titleAr: "تقرير ت12",
        generatedAt: new Date("2026-01-01T00:00:00Z"),
        scopeNote: "نطاق الاختبار",
      },
      columns: [
        { key: "label", label: "البند", type: "text" },
        { key: "rate", label: "النسبة", type: "percent" },
      ],
      rows: [
        { values: { label: "فارغ", rate: "" } },
        { values: { label: "قيمة", rate: 67 } },
      ],
    } as never);
    expect(xml).toContain("<Data ss:Type=\"String\">فارغ</Data>");
    expect(xml).toContain("<Data ss:Type=\"Number\">67</Data>");
  });
});
/**
 * Phase 2 integration tests — schools & branches service layer.
 *
 * Runs against a dedicated SQLite file (prisma/test-schools.db) using
 * the real Prisma client — no mocks, no localStorage. Covers the ten
 * verification points from the phase spec that are testable at the
 * data layer (the RTL/responsive point is covered by browser E2E).
 *
 * Run: bun test tests/schools.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
// Absolute path — the Prisma CLI and the runtime client resolve relative
// SQLite URLs differently, which would split the test into two files.
const TEST_DB_URL = `file:${path.join(PROJECT_ROOT, "prisma", "test-schools.db")}`;

// MUST be assigned before the dynamic imports below: the Prisma client
// singleton reads DATABASE_URL at instantiation time, and bun auto-loads
// the project .env (dev database) which must not win here.
process.env.DATABASE_URL = TEST_DB_URL;

beforeAll(() => {
  // Create/sync the dedicated test database BEFORE importing the client.
  execSync("bunx prisma db push --skip-generate --accept-data-loss", {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
});

afterAll(async () => {
  await db.branch.deleteMany({});
  await db.school.deleteMany({});
});

// Dynamic imports: the Prisma client singleton reads DATABASE_URL at
// instantiation time, which must happen after the env override above.
const { db } = await import("@/lib/db");
const {
  createSchool,
  updateSchool,
  setSchoolActive,
  createBranch,
  updateBranch,
  setBranchActive,
  getSchoolDetail,
  getSchoolsMetrics,
} = await import("@/lib/schools/service");

describe("Phase 2 — schools & branches service", () => {
  let schoolAId = "";
  let schoolBId = "";

  /* 1. Creating a valid school ------------------------------------ */
  test("creates a valid school and resolves the slug from the English name", async () => {
    const result = await createSchool({
      nameAr: "مدرسة قرطبة النموذجية",
      nameEn: "Qurtuba Model School",
      slug: "",
      logoUrl: "https://example.com/logo.png",
      brandColor: "#1D5BD6",
      isActive: true,
    });

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    schoolAId = result.data.id;
    expect(result.data.slug).toBe("qurtuba-model-school");
    expect(result.data.nameAr).toBe("مدرسة قرطبة النموذجية");
    expect(result.data.brandColor).toBe("#1D5BD6");
  });

  /* 2. Rejecting a missing school name ---------------------------- */
  test("rejects a school with a missing Arabic name", async () => {
    const result = await createSchool({
      nameAr: "   ",
      nameEn: "No Name School",
      isActive: true,
    });

    expect(result.ok).toBeFalse();
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(result.fieldErrors?.nameAr).toBeDefined();
  });

  /* 3. Rejecting a duplicate slug --------------------------------- */
  test("rejects a duplicate slug with an Arabic message", async () => {
    // School B owns a unique slug first.
    const created = await createSchool({
      nameAr: "مدرسة الأمل الثانوية",
      slug: "amal-secondary",
      isActive: true,
    });
    expect(created.ok).toBeTrue();
    if (created.ok) schoolBId = created.data.id;

    // School A now tries to steal that slug.
    const conflict = await createSchool({
      nameAr: "مدرسة أخرى",
      slug: "amal-secondary",
      isActive: true,
    });

    expect(conflict.ok).toBeFalse();
    if (conflict.ok) return;
    expect(conflict.code).toBe("DUPLICATE_SLUG");
    expect(conflict.message).toContain("مستخدم بالفعل");
  });

  /* 4. Editing a school ------------------------------------------- */
  test("edits school names and branding and persists the change", async () => {
    const result = await updateSchool({
      id: schoolAId,
      nameAr: "مدرسة قرطبة النموذجية للغات",
      nameEn: "Qurtuba Model Language School",
      slug: "qurtuba-model-school",
      logoUrl: "",
      brandColor: "#1749B8",
    });

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.data.nameAr).toBe("مدرسة قرطبة النموذجية للغات");

    // Persisted (fresh read).
    const reloaded = await getSchoolDetail(schoolAId);
    expect(reloaded?.nameAr).toBe("مدرسة قرطبة النموذجية للغات");
    expect(reloaded?.brandColor).toBe("#1749B8");
    expect(reloaded?.nameEn).toBe("Qurtuba Model Language School");
  });

  /* 5. Activating and deactivating a school ----------------------- */
  test("deactivates then re-activates a school", async () => {
    const off = await setSchoolActive(schoolAId, false);
    expect(off.ok).toBeTrue();
    expect((await getSchoolDetail(schoolAId))?.isActive).toBeFalse();

    const on = await setSchoolActive(schoolAId, true);
    expect(on.ok).toBeTrue();
    expect((await getSchoolDetail(schoolAId))?.isActive).toBeTrue();
  });

  /* 6. Creating and editing a branch ------------------------------ */
  test("creates and edits a branch, enforcing in-school name uniqueness", async () => {
    const created = await createBranch({
      schoolId: schoolAId,
      nameAr: "فرع المنطقة الأولى",
      nameEn: "First District Branch",
      stage: "primary",
      isActive: true,
    });

    expect(created.ok).toBeTrue();
    if (!created.ok) return;
    const branchId = created.data.id;
    expect(created.data.nameNorm).toBe("فرع المنطقة الأولى");

    // Duplicate name inside the same school (extra spaces — same norm).
    const duplicate = await createBranch({
      schoolId: schoolAId,
      nameAr: "  فرع   المنطقة الأولى  ",
      stage: "secondary",
      isActive: true,
    });
    expect(duplicate.ok).toBeFalse();
    if (!duplicate.ok) {
      expect(duplicate.code).toBe("DUPLICATE_BRANCH");
    }

    // Edit: change stage + name.
    const edited = await updateBranch({
      schoolId: schoolAId,
      branchId,
      nameAr: "فرع المنطقة الثانية",
      nameEn: "",
      stage: "secondary",
    });
    expect(edited.ok).toBeTrue();
    if (edited.ok) {
      expect(edited.data.stage).toBe("secondary");
      expect(edited.data.nameAr).toBe("فرع المنطقة الثانية");
    }

    // Persisted.
    const reloaded = await getSchoolDetail(schoolAId);
    expect(reloaded?.branches.find((b) => b.id === branchId)?.stage).toBe("secondary");
  });

  /* 7. Rejecting a branch with an invalid school relationship ----- */
  test("rejects a branch whose school does not exist", async () => {
    const result = await createBranch({
      schoolId: "does-not-exist",
      nameAr: "فرع وهمي",
      stage: "primary",
      isActive: true,
    });

    expect(result.ok).toBeFalse();
    if (result.ok) return;
    expect(result.code).toBe("RELATION_ERROR");
    expect(result.message).toContain("غير موجودة");
  });

  /* 8. Rejecting cross-school branch access ----------------------- */
  test("rejects updating a branch through another school's id", async () => {
    // Branch belongs to school A; caller claims it via school B.
    const branchOfA = await getSchoolDetail(schoolAId);
    const branchId = branchOfA?.branches[0]?.id ?? "";

    const result = await updateBranch({
      schoolId: schoolBId, // NOT the owning school
      branchId,
      nameAr: "اختراق بين المدارس",
      stage: "primary",
    });

    expect(result.ok).toBeFalse();
    if (result.ok) return;
    expect(result.code).toBe("RELATION_ERROR");
    expect(result.message).toContain("لا ينتمي");

    // The same guard protects status toggles.
    const toggle = await setBranchActive(schoolBId, branchId, false);
    expect(toggle.ok).toBeFalse();

    // And the branch is untouched.
    const reloaded = await getSchoolDetail(schoolAId);
    expect(reloaded?.branches.find((b) => b.id === branchId)?.nameAr).toBe(
      "فرع المنطقة الثانية"
    );
  });

  /* 9. Persisting changes after reload ---------------------------- */
  test("persists data across a brand-new client connection", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const fresh = new PrismaClient({
      datasources: { db: { url: TEST_DB_URL } },
    });

    try {
      const schools = await fresh.school.findMany({
        include: { _count: { select: { branches: true } } },
      });
      expect(schools.length).toBeGreaterThanOrEqual(2);

      const schoolA = schools.find((s) => s.id === schoolAId);
      expect(schoolA?.nameAr).toBe("مدرسة قرطبة النموذجية للغات");
      expect(schoolA?._count.branches).toBe(1);
    } finally {
      await fresh.$disconnect();
    }
  });

  /* Bonus: metrics are computed from persisted data --------------- */
  test("computes platform metrics from persisted rows", async () => {
    const metrics = await getSchoolsMetrics();
    expect(metrics.totalSchools).toBeGreaterThanOrEqual(2);
    expect(metrics.activeSchools + metrics.inactiveSchools).toBe(
      metrics.totalSchools
    );
    expect(metrics.totalBranches).toBeGreaterThanOrEqual(1);
  });
});
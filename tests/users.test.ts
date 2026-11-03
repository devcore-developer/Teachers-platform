/**
 * Phase 4 integration tests — user directory, assignments & role workspaces.
 *
 * Runs against the shared dedicated SQLite file (prisma/test-platform.db)
 * using the real Prisma client — no mocks for the data layer. Actor
 * contexts are injected exactly like tests/auth.test.ts does.
 *
 * Covers the 13 verification points from the Phase 4 spec that are
 * testable at the service/navigation layer. Route redirects and RTL
 * layout are covered by browser E2E (documented in the delivery).
 *
 * Run: bun test tests/users.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import path from "node:path";
/* Type-only import — erased at runtime, never loads the module before env setup. */
import type { MailSender } from "@/lib/mail/mailer";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
// Shared dedicated test database for ALL suites: bun runs every test
// file in one process, so the Prisma client singleton (and its
// DATABASE_URL captured at first import) must be identical across files.
const TEST_DB_URL = `file:${path.join(PROJECT_ROOT, "prisma", "test-platform.db")}`;

// MUST be assigned before the dynamic imports below.
process.env.DATABASE_URL = TEST_DB_URL;
process.env.AUTH_SECRET = "test-secret-for-auth-suite-0123456789abcdef0123456789";

beforeAll(() => {
  execSync("bunx prisma db push --skip-generate --accept-data-loss", {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
});

afterAll(async () => {
  await db.teacherSupervisorAssignment.deleteMany({});
  await db.supervisorAssignment.deleteMany({});
  await db.deputyGrant.deleteMany({});
  await db.emailVerificationToken.deleteMany({});
  await db.passwordResetToken.deleteMany({});
  await db.user.deleteMany({});
  await db.branch.deleteMany({});
  await db.school.deleteMany({});
});

// Dynamic imports AFTER the env override.
const { db } = await import("@/lib/db");
const { createSessionToken } = await import("@/lib/auth/token");
const {
  authenticateCredentials,
  registerTeacher,
  verifyEmailToken,
  setAccountActive,
  listTeachersForSupervisor,
} = await import("@/lib/users/service");
const {
  listUsersForDirectory,
  getUserDetailForAdmin,
  createStaffAccount,
  updateUserProfileByAdmin,
  updateOwnProfile,
  setSupervisorBranches,
  assignTeacherSupervisor,
  removeTeacherSupervisor,
  setDeputyScope,
  getSupervisorWorkspace,
  getDeputyOverview,
  getPlatformUsersMetrics,
  getSchoolUsersMetrics,
} = await import("@/lib/users/directory");
const {
  createSchool,
  createBranch,
  updateBranch,
} = await import("@/lib/schools/service");
const { navIdsForRole } = await import("@/lib/auth/roles");

const SUPER_CTX = {
  id: "ctx-super-p4",
  name: "مدير المنصة",
  role: "SUPER_ADMIN" as const,
  schoolId: null,
};

const failingMailer = (async () => ({
  ok: false,
  error: "smtp_down",
})) as MailSender;

const BASE = "http://localhost:3000";

let schoolDId = "";
let schoolEId = "";
let branchD1Id = "";
let branchD2Id = "";
let branchE1Id = "";
let officeManagerDId = "";
let supervisorD1Id = "";
let supervisorD2Id = "";
let deputyDId = "";
let teacherD1Id = "";
let teacherD2Id = "";
let teacherD3Id = "";
let teacherE1Id = "";

function officeCtx() {
  return {
    id: officeManagerDId,
    name: "مدير مكتب أ",
    role: "DEVELOPMENT_OFFICE_MANAGER" as const,
    schoolId: schoolDId,
  };
}

function deputyCtx() {
  return {
    id: deputyDId,
    name: "الوكيل",
    role: "EDUCATIONAL_DEPUTY" as const,
    schoolId: schoolDId,
  };
}

async function createUser(data: {
  name: string;
  email: string;
  role: string;
  schoolId?: string | null;
  branchId?: string | null;
}) {
  return db.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: "$2b$12$C6UzMDM.H6dfI/f/IKcEe.5bTzDcZZowT8mSD2Fz.CbA9O7eO8fZu",
      role: data.role,
      schoolId: data.schoolId ?? null,
      branchId: data.branchId ?? null,
      emailVerifiedAt: new Date(),
    },
  });
}

describe("Phase 4 — users, assignments & workspaces", () => {
  test("fixtures: two schools, branches and role users are provisioned", async () => {
    const schoolD = await createSchool(
      { nameAr: "مدرسة المستخدمين أ", slug: "users-school-d", isActive: true },
      SUPER_CTX
    );
    expect(schoolD.ok).toBeTrue();
    if (schoolD.ok) schoolDId = schoolD.data.id;

    const schoolE = await createSchool(
      { nameAr: "مدرسة المستخدمين ب", slug: "users-school-e", isActive: true },
      SUPER_CTX
    );
    expect(schoolE.ok).toBeTrue();
    if (schoolE.ok) schoolEId = schoolE.data.id;

    const branchD1 = await createBranch(
      { schoolId: schoolDId, nameAr: "فرع أ1", stage: "primary", isActive: true },
      SUPER_CTX
    );
    expect(branchD1.ok).toBeTrue();
    if (branchD1.ok) branchD1Id = branchD1.data.id;

    const branchD2 = await createBranch(
      { schoolId: schoolDId, nameAr: "فرع أ2", stage: "secondary", isActive: true },
      SUPER_CTX
    );
    expect(branchD2.ok).toBeTrue();
    if (branchD2.ok) branchD2Id = branchD2.data.id;

    const branchE1 = await createBranch(
      { schoolId: schoolEId, nameAr: "فرع ب1", stage: "intermediate", isActive: true },
      SUPER_CTX
    );
    expect(branchE1.ok).toBeTrue();
    if (branchE1.ok) branchE1Id = branchE1.data.id;

    const manager = await createUser({
      name: "مدير مكتب أ",
      email: "p4.office@test.local",
      role: "DEVELOPMENT_OFFICE_MANAGER",
      schoolId: schoolDId,
    });
    officeManagerDId = manager.id;

    supervisorD1Id = (
      await createUser({
        name: "المشرف الأول",
        email: "p4.sup1@test.local",
        role: "EDUCATIONAL_SUPERVISOR",
        schoolId: schoolDId,
      })
    ).id;
    supervisorD2Id = (
      await createUser({
        name: "المشرف الثاني",
        email: "p4.sup2@test.local",
        role: "EDUCATIONAL_SUPERVISOR",
        schoolId: schoolDId,
      })
    ).id;
    deputyDId = (
      await createUser({
        name: "الوكيل التعليمي",
        email: "p4.deputy@test.local",
        role: "EDUCATIONAL_DEPUTY",
        schoolId: schoolDId,
      })
    ).id;
    teacherD1Id = (
      await createUser({
        name: "المعلم الأول",
        email: "p4.t1@test.local",
        role: "TEACHER",
        schoolId: schoolDId,
        branchId: branchD1Id,
      })
    ).id;
    teacherD2Id = (
      await createUser({
        name: "المعلم الثاني",
        email: "p4.t2@test.local",
        role: "TEACHER",
        schoolId: schoolDId,
        branchId: branchD2Id,
      })
    ).id;
    teacherD3Id = (
      await createUser({
        name: "المعلم الثالث",
        email: "p4.t3@test.local",
        role: "TEACHER",
        schoolId: schoolDId,
        branchId: null,
      })
    ).id;
    teacherE1Id = (
      await createUser({
        name: "معلم المدرسة الأخرى",
        email: "p4.te1@test.local",
        role: "TEACHER",
        schoolId: schoolEId,
        branchId: branchE1Id,
      })
    ).id;

    expect(officeManagerDId).toBeTruthy();
  });

  /* 1. Office manager lists their OWN school's users ----------------- */
  test("1. school manager lists users from their own school only", async () => {
    const ctx = officeCtx();
    const result = await listUsersForDirectory(ctx, {});
    expect(result.ok).toBeTrue();
    if (!result.ok) return;

    const expected = await db.user.count({ where: { schoolId: schoolDId } });
    expect(result.data.total).toBe(expected);
    for (const row of result.data.rows) {
      expect(row.schoolName).toBe("مدرسة المستخدمين أ");
    }

    // Detail of an own-school teacher works.
    const detail = await getUserDetailForAdmin(ctx, teacherD1Id);
    expect(detail.ok).toBeTrue();
    if (detail.ok) {
      expect(detail.data.school?.id).toBe(schoolDId);
      expect(detail.data.branch?.id).toBe(branchD1Id);
      // No secrets in the projection.
      expect(JSON.stringify(detail.data)).not.toContain("passwordHash");
    }
  });

  /* 2. Office manager cannot reach another school's users ------------ */
  test("2. school manager cannot access another school's users", async () => {
    const ctx = officeCtx();

    // Detail — rejected.
    const detail = await getUserDetailForAdmin(ctx, teacherE1Id);
    expect(detail.ok).toBeFalse();
    if (!detail.ok) expect(detail.code).toBe("FORBIDDEN");

    // Directory schoolId filter is IGNORED for office managers — the
    // forced session scope wins (no cross-school leak).
    const forced = await listUsersForDirectory(ctx, { schoolId: schoolEId });
    expect(forced.ok).toBeTrue();
    if (forced.ok) {
      for (const row of forced.data.rows) {
        expect(row.schoolName).toBe("مدرسة المستخدمين أ");
      }
    }

    // Mutations across schools — rejected.
    const toggle = await setAccountActive(teacherE1Id, false, ctx);
    expect(toggle.ok).toBeFalse();

    const edit = await updateUserProfileByAdmin(
      { userId: teacherE1Id, name: "اختراق" },
      ctx
    );
    expect(edit.ok).toBeFalse();
    if (!edit.ok) expect(edit.code).toBe("FORBIDDEN");

    const assign = await assignTeacherSupervisor(
      { teacherId: teacherD1Id, supervisorId: supervisorD1Id },
      {
        id: "ctx-office-e",
        name: "مدير مكتب ب",
        role: "DEVELOPMENT_OFFICE_MANAGER" as const,
        schoolId: schoolEId,
      }
    );
    expect(assign.ok).toBeFalse();
  });

  /* 3. No path to SUPER_ADMIN through school-level management -------- */
  test("3. school manager cannot promote anyone to SUPER_ADMIN", async () => {
    const before = await db.user.count({ where: { role: "SUPER_ADMIN" } });

    // The role is NOT part of the creatable whitelist — Zod rejects it.
    const staff = await createStaffAccount(
      {
        name: "محاولة ترقية",
        email: "p4.escalate@test.local",
        password: "Escalate1",
        role: "SUPER_ADMIN",
        schoolId: schoolDId,
      },
      officeCtx(),
      { appBaseUrl: BASE, mailer: failingMailer }
    );
    expect(staff.ok).toBeFalse();
    if (!staff.ok) expect(staff.code).toBe("VALIDATION_ERROR");

    // Profile edit carries no role/school fields — they are stripped.
    const edit = await updateUserProfileByAdmin(
      {
        userId: teacherD1Id,
        name: "المعلم الأول المعدل",
        role: "SUPER_ADMIN",
        schoolId: schoolEId,
      } as never,
      officeCtx()
    );
    expect(edit.ok).toBeTrue();
    const afterEdit = await db.user.findUnique({ where: { id: teacherD1Id } });
    expect(afterEdit?.role).toBe("TEACHER");
    expect(afterEdit?.schoolId).toBe(schoolDId);
    expect(afterEdit?.name).toBe("المعلم الأول المعدل");

    // Office managers cannot create other office managers either.
    const manager = await createStaffAccount(
      {
        name: "مدير غير مصرح",
        email: "p4.newmanager@test.local",
        password: "Manager11",
        role: "DEVELOPMENT_OFFICE_MANAGER",
        schoolId: schoolDId,
      } as never,
      officeCtx(),
      { appBaseUrl: BASE, mailer: failingMailer }
    );
    expect(manager.ok).toBeFalse();

    const after = await db.user.count({ where: { role: "SUPER_ADMIN" } });
    expect(after).toBe(before);
  });

  /* 4. Super admin lists users across schools ------------------------ */
  test("4. super admin lists users across schools with a school filter", async () => {
    const all = await listUsersForDirectory(SUPER_CTX, {});
    expect(all.ok).toBeTrue();
    if (!all.ok) return;

    const [countD, countE] = await Promise.all([
      db.user.count({ where: { schoolId: schoolDId } }),
      db.user.count({ where: { schoolId: schoolEId } }),
    ]);
    // Platform users (no school) are included too.
    expect(all.data.total).toBeGreaterThanOrEqual(countD + countE);

    const scoped = await listUsersForDirectory(SUPER_CTX, { schoolId: schoolEId });
    expect(scoped.ok).toBeTrue();
    if (scoped.ok) {
      expect(scoped.data.total).toBe(countE);
      for (const row of scoped.data.rows) {
        expect(row.schoolName).toBe("مدرسة المستخدمين ب");
      }
    }

    // Platform metrics are real persisted counts.
    const metrics = await getPlatformUsersMetrics();
    expect(metrics.totalUsers).toBeGreaterThanOrEqual(countD + countE);
    expect(metrics.teachersCount).toBeGreaterThanOrEqual(4);
    const schoolMetrics = await getSchoolUsersMetrics(schoolDId);
    expect(schoolMetrics.totalUsers).toBe(countD);
    expect(schoolMetrics.teachersCount).toBeGreaterThanOrEqual(3);
  });

  /* 5. Deputy access is read-only ------------------------------------ */
  test("5. deputy context is rejected by every mutation path", async () => {
    /* Negative test: a deputy is NOT an AdminContext — the cast documents
       the deliberate type-level bypass; every mutation re-validates the
       role at runtime and must answer FORBIDDEN. */
    const ctx = deputyCtx() as unknown as Parameters<
      typeof setSupervisorBranches
    >[1];

    const branches = await setSupervisorBranches(
      { supervisorId: supervisorD1Id, branchIds: [branchD1Id] },
      ctx
    );
    expect(branches.ok).toBeFalse();
    if (!branches.ok) expect(branches.code).toBe("FORBIDDEN");

    const assign = await assignTeacherSupervisor(
      { teacherId: teacherD1Id, supervisorId: supervisorD1Id },
      ctx
    );
    expect(assign.ok).toBeFalse();

    const scope = await setDeputyScope(
      { deputyId: deputyDId, mode: "school", branchIds: [] },
      ctx
    );
    expect(scope.ok).toBeFalse();

    const edit = await updateUserProfileByAdmin(
      { userId: teacherD1Id, name: "اختراق الوكيل" },
      ctx
    );
    expect(edit.ok).toBeFalse();

    const staff = await createStaffAccount(
      {
        name: "حساب وكيل",
        email: "p4.deputy-staff@test.local",
        password: "Deputy11",
        role: "TEACHER",
      },
      ctx,
      { appBaseUrl: BASE, mailer: failingMailer }
    );
    expect(staff.ok).toBeFalse();

    const toggle = await setAccountActive(teacherD2Id, false, ctx);
    expect(toggle.ok).toBeFalse();

    // Deputy grants are read-widening only; the overview reflects them.
    const granted = await setDeputyScope(
      { deputyId: deputyDId, mode: "branches", branchIds: [branchD1Id] },
      SUPER_CTX
    );
    expect(granted.ok).toBeTrue();

    const overview = await getDeputyOverview(deputyDId);
    expect(overview).not.toBeNull();
    expect(overview?.schools).toHaveLength(1);
    expect(overview?.schools[0]?.branches.map((b) => b.id)).toEqual([branchD1Id]);
    expect(overview?.schools[0]?.branches[0]?.teachersCount).toBe(1);
  });

  /* 6. Supervisor sees only assigned teachers ------------------------ */
  test("6. supervisor visibility = branch coverage + explicit assignments", async () => {
    // Initially no scope, no assignments -> nothing.
    expect(await listTeachersForSupervisor(supervisorD1Id)).toHaveLength(0);

    // Branch scope D1 -> teacher D1 becomes visible (branch-derived).
    const scoped = await setSupervisorBranches(
      { supervisorId: supervisorD1Id, branchIds: [branchD1Id] },
      SUPER_CTX
    );
    expect(scoped.ok).toBeTrue();

    let visible = await listTeachersForSupervisor(supervisorD1Id);
    expect(visible.map((t) => t.id)).toEqual([teacherD1Id]);

    // Explicit assignment of teacher D2 (branch D2 NOT covered) widens.
    const assigned = await assignTeacherSupervisor(
      { teacherId: teacherD2Id, supervisorId: supervisorD1Id },
      officeCtx()
    );
    expect(assigned.ok).toBeTrue();

    visible = await listTeachersForSupervisor(supervisorD1Id);
    expect(visible.map((t) => t.id).sort()).toEqual([teacherD1Id, teacherD2Id].sort());

    const workspace = await getSupervisorWorkspace(supervisorD1Id);
    const sources = new Map(workspace?.teachers.map((t) => [t.id, t.source]));
    expect(sources.get(teacherD1Id)).toBe("branch");
    expect(sources.get(teacherD2Id)).toBe("explicit");
    expect(sources.has(teacherD3Id)).toBeFalse(); // no branch, no assignment
    expect(sources.has(teacherE1Id)).toBeFalse(); // never cross-school

    // Reassign teacher D2 to supervisor D2: D1 loses them (no other
    // valid grant), D2 gains them.
    const moved = await assignTeacherSupervisor(
      { teacherId: teacherD2Id, supervisorId: supervisorD2Id },
      officeCtx()
    );
    expect(moved.ok).toBeTrue();

    const d1After = await listTeachersForSupervisor(supervisorD1Id);
    expect(d1After.map((t) => t.id)).toEqual([teacherD1Id]);
    const d2After = await listTeachersForSupervisor(supervisorD2Id);
    expect(d2After.map((t) => t.id)).toEqual([teacherD2Id]);

    // Removing the assignment removes access there too.
    const removed = await removeTeacherSupervisor({ teacherId: teacherD2Id }, officeCtx());
    expect(removed.ok).toBeTrue();
    expect(await listTeachersForSupervisor(supervisorD2Id)).toHaveLength(0);
  });

  /* 7. Cross-school relationships are rejected ----------------------- */
  test("7. cross-school supervisor and scope assignments are rejected", async () => {
    // Teacher in school D, supervisor must not cover school E teacher.
    const crossAssign = await assignTeacherSupervisor(
      { teacherId: teacherE1Id, supervisorId: supervisorD1Id },
      SUPER_CTX
    );
    expect(crossAssign.ok).toBeFalse();
    if (!crossAssign.ok) expect(crossAssign.code).toBe("RELATION_ERROR");

    // Foreign branch in a supervisor scope — rejected wholesale.
    const foreignScope = await setSupervisorBranches(
      { supervisorId: supervisorD1Id, branchIds: [branchD1Id, branchE1Id] },
      SUPER_CTX
    );
    expect(foreignScope.ok).toBeFalse();
    if (!foreignScope.ok) expect(foreignScope.code).toBe("RELATION_ERROR");
    // Existing scope untouched by the failed replace.
    const scope = await db.supervisorAssignment.findMany({
      where: { supervisorId: supervisorD1Id },
    });
    expect(scope.map((s) => s.branchId)).toEqual([branchD1Id]);

    // Non-teacher/non-supervisor targets — rejected.
    const notTeacher = await assignTeacherSupervisor(
      { teacherId: deputyDId, supervisorId: supervisorD1Id },
      SUPER_CTX
    );
    expect(notTeacher.ok).toBeFalse();
  });

  /* 8. Teacher cannot modify role or school -------------------------- */
  test("8. teacher self-profile edit cannot change role or school", async () => {
    const before = await db.user.findUnique({ where: { id: teacherD3Id } });
    expect(before?.role).toBe("TEACHER");
    expect(before?.schoolId).toBe(schoolDId);

    const result = await updateOwnProfile(
      {
        name: "المعلم الثالث المحدث",
        role: "SUPER_ADMIN",
        schoolId: schoolEId,
        branchId: branchE1Id,
        isActive: false,
      } as never,
      teacherD3Id
    );
    expect(result.ok).toBeTrue();

    const after = await db.user.findUnique({ where: { id: teacherD3Id } });
    expect(after?.name).toBe("المعلم الثالث المحدث"); // name changed
    expect(after?.role).toBe("TEACHER"); // unchanged
    expect(after?.schoolId).toBe(schoolDId); // unchanged
    expect(after?.branchId).toBeNull(); // unchanged
    expect(after?.isActive).toBeTrue(); // unchanged
  });

  /* 9. Deactivated users lose access immediately --------------------- */
  test("9. deactivation blocks sign-in, sessions and protected operations", async () => {
    const { hashPassword } = await import("@/lib/auth/password");

    // Give the teacher a real password and sign in — lastLoginAt must
    // be persisted (Phase 4 field).
    await db.user.update({
      where: { id: teacherD1Id },
      data: { passwordHash: await hashPassword("TeacherPass1") },
    });

    const before = await db.user.findUnique({ where: { id: teacherD1Id } });
    expect(before?.lastLoginAt).toBeNull(); // never signed in yet

    const login = await authenticateCredentials("p4.t1@test.local", "TeacherPass1");
    expect(login.ok).toBeTrue();
    const afterLogin = await db.user.findUnique({ where: { id: teacherD1Id } });
    expect(afterLogin?.lastLoginAt).not.toBeNull();

    // A session issued before deactivation...
    const token = await createSessionToken({
      sub: teacherD1Id,
      tv: login.ok ? login.tokenVersion : 0,
    });

    // Deactivate by the office manager (own school) — allowed in Phase 4.
    const off = await setAccountActive(teacherD1Id, false, officeCtx());
    expect(off.ok).toBeTrue();

    const afterOff = await db.user.findUnique({ where: { id: teacherD1Id } });
    expect(afterOff?.isActive).toBeFalse();
    // tokenVersion bumped on deactivation -> live sessions die immediately.
    expect(afterOff?.tokenVersion).toBeGreaterThan(
      login.ok ? login.tokenVersion : 0
    );

    const claims = await (await import("@/lib/auth/token")).verifySessionToken(token);
    expect(claims).not.toBeNull(); // JWT still parses...
    expect(claims?.tv === afterOff?.tokenVersion).toBeFalse(); // ...but the session is rejected

    // Sign-in rejected as INACTIVE.
    const auth = await authenticateCredentials("p4.t1@test.local", "TeacherPass1");
    expect(auth.ok).toBeFalse();
    if (!auth.ok) expect(auth.code).toBe("INACTIVE");

    // Supervisor no longer sees the deactivated teacher.
    const visible = await listTeachersForSupervisor(supervisorD1Id);
    expect(visible.some((t) => t.id === teacherD1Id)).toBeFalse();

    // Self-profile edit blocked for inactive accounts.
    const selfEdit = await updateOwnProfile({ name: "حاول معطوب" }, teacherD1Id);
    expect(selfEdit.ok).toBeFalse();

    // Reactivate for the remaining suites.
    const backOn = await setAccountActive(teacherD1Id, true, officeCtx());
    expect(backOn.ok).toBeTrue();
  });

  /* 10. Teacher self-registration + verification still work ---------- */
  test("10. teacher self-registration and email verification still work", async () => {
    const register = await registerTeacher(
      {
        slug: "users-school-d",
        name: "معلم التسجيل الذاتي",
        email: "p4.selfreg@test.local",
        password: "SelfReg1",
        confirmPassword: "SelfReg1",
        branchId: branchD1Id,
      },
      { appBaseUrl: BASE, mailer: failingMailer }
    );
    expect(register.ok).toBeTrue();
    if (!register.ok) return;
    // Provider is down in this suite — honest emailSent:false, still
    // unverified; the flow itself works.
    expect(register.emailSent).toBeFalse();

    // Issue a fresh token directly and consume it (Phase 3 pipeline).
    const user = await db.user.findUnique({ where: { email: "p4.selfreg@test.local" } });
    expect(user?.emailVerifiedAt).toBeNull();
    const { issueEmailVerificationToken } = await import("@/lib/auth/one-time-tokens");
    const raw = await issueEmailVerificationToken(user!.id);
    const verified = await verifyEmailToken(raw);
    expect(verified.status).toBe("ok");
    expect(
      (await db.user.findUnique({ where: { id: user!.id } }))?.emailVerifiedAt
    ).not.toBeNull();
  });

  /* 11. Phase 2 school & branch management still works --------------- */
  test("11. school and branch management keeps working", async () => {
    const renamed = await updateBranch(
      {
        schoolId: schoolDId,
        branchId: branchD2Id,
        nameAr: "فرع أ2 المحدث",
        stage: "secondary",
      },
      SUPER_CTX
    );
    expect(renamed.ok).toBeTrue();
    if (renamed.ok) expect(renamed.data.nameAr).toBe("فرع أ2 المحدث");
  });

  /* 12. Records survive the additive migration ----------------------- */
  test("12. existing school/branch/user records remain intact", async () => {
    const school = await db.school.findUnique({
      where: { id: schoolDId },
      include: { _count: { select: { branches: true } } },
    });
    expect(school?.nameAr).toBe("مدرسة المستخدمين أ");
    expect(school?._count.branches).toBe(2);

    const branch = await db.branch.findUnique({ where: { id: branchD1Id } });
    expect(branch?.nameAr).toBe("فرع أ1");
    expect(branch?.stage).toBe("primary");

    const manager = await db.user.findUnique({ where: { id: officeManagerDId } });
    expect(manager?.role).toBe("DEVELOPMENT_OFFICE_MANAGER");
    expect(manager?.schoolId).toBe(schoolDId);
  });

  /* 13. Role-specific navigation matches server permissions ---------- */
  test("13. role-specific navigation matches the server boundaries", async () => {
    const superNav = navIdsForRole("SUPER_ADMIN");
    const managerNav = navIdsForRole("DEVELOPMENT_OFFICE_MANAGER");
    const supervisorNav = navIdsForRole("EDUCATIONAL_SUPERVISOR");
    const deputyNav = navIdsForRole("EDUCATIONAL_DEPUTY");
    const teacherNav = navIdsForRole("TEACHER");

    // Directory: administrative pair only.
    expect(superNav).toContain("users");
    expect(managerNav).toContain("users");
    expect(supervisorNav).not.toContain("users");
    expect(deputyNav).not.toContain("users");
    expect(teacherNav).not.toContain("users");

    // Supervisor workspace: supervisor only; branch-derived placeholder
    // "teachers" no longer shown to supervisors.
    expect(supervisorNav).toContain("supervision");
    expect(supervisorNav).not.toContain("teachers");
    expect(managerNav).not.toContain("supervision");

    // Deputy read-only overview: deputy only.
    expect(deputyNav).toContain("deputy-overview");
    expect(teacherNav).not.toContain("deputy-overview");
    expect(deputyNav).not.toContain("schools"); // no admin area
    expect(deputyNav).not.toContain("settings");

    // Self profile: every role.
    for (const nav of [superNav, managerNav, supervisorNav, deputyNav, teacherNav]) {
      expect(nav).toContain("my-profile");
      expect(nav).toContain("home");
    }

    // Teachers never see administrative menus.
    expect(teacherNav).not.toContain("schools");
    expect(teacherNav).not.toContain("settings");
    expect(teacherNav).not.toContain("programs");
  });

  /* Bonus: directory pagination + search are real --------------------- */
  test("pagination and search work on persisted rows", async () => {
    // Seed 12 extra teachers in school E (passwordHash placeholder —
    // they are directory rows, not sign-in fixtures).
    for (let i = 0; i < 12; i++) {
      await createUser({
        name: `معلم ترقيم ${i + 1}`,
        email: `p4.page${i}@test.local`,
        role: "TEACHER",
        schoolId: schoolEId,
      });
    }

    const page1 = await listUsersForDirectory(SUPER_CTX, { schoolId: schoolEId, page: 1 });
    expect(page1.ok).toBeTrue();
    if (!page1.ok) return;
    expect(page1.data.total).toBe(13); // teacherE1 + 12 seeded
    expect(page1.data.rows).toHaveLength(10);
    expect(page1.data.pageCount).toBe(2);

    const page2 = await listUsersForDirectory(SUPER_CTX, { schoolId: schoolEId, page: 2 });
    expect(page2.ok).toBeTrue();
    if (page2.ok) expect(page2.data.rows).toHaveLength(3);

    const search = await listUsersForDirectory(SUPER_CTX, {
      schoolId: schoolEId,
      q: "p4.page3",
    });
    expect(search.ok).toBeTrue();
    if (search.ok) {
      expect(search.data.total).toBe(1);
      expect(search.data.rows[0]?.email).toBe("p4.page3@test.local");
    }

    const roleFilter = await listUsersForDirectory(SUPER_CTX, {
      schoolId: schoolDId,
      role: "EDUCATIONAL_SUPERVISOR",
    });
    expect(roleFilter.ok).toBeTrue();
    if (roleFilter.ok) expect(roleFilter.data.total).toBe(2);
  });
});
/* ------------------------------------------------------------------ */
/* Manarat Qurtubah — development bootstrap seed.                       */
/*                                                                      */
/* The database ships EMPTY: /admin/accounts (which creates staff       */
/* accounts) is itself protected, so the first SUPER_ADMIN must come    */
/* from here. This script seeds one school tenant plus one account      */
/* per platform role so every phase can be explored immediately.        */
/*                                                                      */
/* Plain CommonJS on purpose: run it with `node prisma/seed.js` —       */
/* it needs NOTHING beyond the existing dependencies (@prisma/client    */
/* + bcryptjs, which is pure JS and builds natively nowhere).           */
/*                                                                      */
/* Idempotent: every record is an upsert (or checked before insert),   */
/* so re-running resets the demo accounts to the exact credentials      */
/* documented below without duplicating any rows.                       */
/*                                                                      */
/* These are DEVELOPMENT credentials — rotate them before any real      */
/* deployment.                                                          */
/* ------------------------------------------------------------------ */

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const db = new PrismaClient();

/* Same cost as src/lib/auth/password.ts (BCRYPT_COST = 12). */
const BCRYPT_COST = 12;

const SCHOOL_SLUG = "al-nahda";
const BRANCH_NAME = "قسم البنين";

/** Demo accounts — re-running the seed resets these passwords. */
const ACCOUNTS = [
  {
    name: "مدير المنصة",
    email: "admin@manarat.local",
    password: "Admin@1234",
    role: "SUPER_ADMIN",
    school: false,
    branch: false,
  },
  {
    name: "مدير مكتب التطوير",
    email: "office@manarat.local",
    password: "Office@1234",
    role: "DEVELOPMENT_OFFICE_MANAGER",
    school: true,
    branch: false,
  },
  {
    name: "مدير المدرسة",
    email: "manager@manarat.local",
    password: "Manager@1234",
    role: "SCHOOL_MANAGER",
    school: true,
    branch: false,
  },
  {
    name: "مسؤول تقنية المعلومات",
    email: "itcoordinator@manarat.local",
    password: "ItCoord@1234",
    role: "IT_COORDINATOR",
    school: true,
    branch: false,
  },
  {
    name: "الوكيل التعليمي",
    email: "deputy@manarat.local",
    password: "Deputy@1234",
    role: "EDUCATIONAL_DEPUTY",
    school: true,
    branch: false,
  },
  {
    name: "المشرف التربوي",
    email: "supervisor@manarat.local",
    password: "Supervisor@1234",
    role: "EDUCATIONAL_SUPERVISOR",
    school: true,
    branch: true,
  },
  {
    name: "معلم تجريبي",
    email: "teacher@manarat.local",
    password: "Teacher@1234",
    role: "TEACHER",
    school: true,
    branch: true,
  },
];

async function main() {
  console.log("Hashing passwords (bcrypt, cost 12)...");
  const seeded = [];
  for (const account of ACCOUNTS) {
    seeded.push({
      ...account,
      passwordHash: await bcrypt.hash(account.password, BCRYPT_COST),
    });
  }

  /* 1) School tenant ------------------------------------------------ */
  const school = await db.school.upsert({
    where: { slug: SCHOOL_SLUG },
    update: {},
    create: {
      nameAr: "مدرسة النهضة النموذجية",
      nameEn: "Al-Nahda Model School",
      slug: SCHOOL_SLUG,
    },
  });
  console.log(`School ready: ${school.nameAr} (${school.slug})`);

  /* 2) Home branch. nameNorm mirrors the service-layer normalization
     (trim + lowercase) required by the @@unique([schoolId, nameNorm]). */
  const nameNorm = BRANCH_NAME.trim().toLowerCase();
  const branch = await db.branch.upsert({
    where: { schoolId_nameNorm: { schoolId: school.id, nameNorm } },
    update: {},
    create: {
      schoolId: school.id,
      nameAr: BRANCH_NAME,
      nameEn: "Boys Section",
      nameNorm,
      stage: "primary",
    },
  });
  console.log(`Branch ready: ${branch.nameAr}`);

  /* 3) Users — one per role. Provisioned accounts arrive pre-verified
     (same policy as createStaffAccount); only self-registered teachers
     go through the email-verification flow. */
  const ids = {};
  for (const account of seeded) {
    const scoped = {
      schoolId: account.school ? school.id : null,
      branchId: account.branch ? branch.id : null,
    };
    const user = await db.user.upsert({
      where: { email: account.email },
      update: {
        name: account.name,
        passwordHash: account.passwordHash,
        role: account.role,
        ...scoped,
        isActive: true,
        emailVerifiedAt: new Date(),
      },
      create: {
        name: account.name,
        email: account.email,
        passwordHash: account.passwordHash,
        role: account.role,
        ...scoped,
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    ids[account.role] = user.id;
    console.log(`Account ready: ${account.email} -> ${account.role}`);
  }

  /* 4) Supervisor branch scope — what the supervisor may see. -------- */
  await db.supervisorAssignment.upsert({
    where: {
      supervisorId_branchId: {
        supervisorId: ids.EDUCATIONAL_SUPERVISOR,
        branchId: branch.id,
      },
    },
    update: {},
    create: {
      supervisorId: ids.EDUCATIONAL_SUPERVISOR,
      schoolId: school.id,
      branchId: branch.id,
    },
  });

  /* 5) Deputy read-only grant over the WHOLE school (branchId null).
     DeputyGrant has no unique constraint — check before inserting. --- */
  const existingGrant = await db.deputyGrant.findFirst({
    where: { userId: ids.EDUCATIONAL_DEPUTY, schoolId: school.id, branchId: null },
  });
  if (!existingGrant) {
    await db.deputyGrant.create({
      data: {
        userId: ids.EDUCATIONAL_DEPUTY,
        schoolId: school.id,
        branchId: null,
      },
    });
  }

  /* 6) Teacher -> supervisor assignment (@@unique on teacherId:
     one current supervisor at a time). ------------------------------- */
  await db.teacherSupervisorAssignment.upsert({
    where: { teacherId: ids.TEACHER },
    update: { supervisorId: ids.EDUCATIONAL_SUPERVISOR },
    create: {
      teacherId: ids.TEACHER,
      supervisorId: ids.EDUCATIONAL_SUPERVISOR,
      schoolId: school.id,
    },
  });

  console.log("\nSeed complete — sign in at /login with:");
  console.table(
    ACCOUNTS.map((account) => ({
      email: account.email,
      password: account.password,
      role: account.role,
    }))
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
/**
 * Batch 2 — migrate the ORIGINAL HTML platform's preserved data into
 * the Next.js database (gap-analysis item: data preservation).
 *
 * What it preserves, idempotently (re-running never duplicates):
 *   1. The ACTIVE ACADEMIC YEAR system setting (1448هـ — the original
 *      platform's year) in SystemSetting.
 *   2. academicYear backfill: every CourseCompletion without a year is
 *      stamped with the active year (the annual hours / 35-hour target
 *      / archive need the year on every row).
 *   3. Supervisor + educational-deputy mappings from the original
 *      205-teacher roster (scripts/html-roster.json): for every roster
 *      teacher that exists as a User, the TeacherSupervisorAssignment
 *      row is upserted with the resolved supervisor/deputy ids
 *      (matched by the same name-key the platform uses everywhere).
 *      Unresolved names are reported, never invented.
 *
 * Usage (from the project root):
 *   node scripts/migrate-batch2-data.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));

const ACADEMIC_YEAR_SETTING_KEY = "academicYear.active";
const DEFAULT_ACADEMIC_YEAR = "1448هـ";

/** HTML name-key normalization: trim, collapse spaces, strip "أ. ". */
function nameKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^أ\.\s*/, "")
    .replace(/^ا\.\s*/, "")
    .toLowerCase();
}

function loadRoster() {
  const rosterPath = join(__dirname, "html-roster.json");
  const raw = JSON.parse(readFileSync(rosterPath, "utf8"));
  if (!Array.isArray(raw)) throw new Error("html-roster.json: صيغة غير صحيحة");
  return raw.filter((row) => row && typeof row.name === "string" && row.name.trim());
}

async function main() {
  console.log("== Batch 2 — data preservation migration ==");

  // 1) Active academic year ------------------------------------------------
  const existingSetting = await prisma.systemSetting.findUnique({
    where: { key: ACADEMIC_YEAR_SETTING_KEY },
  });
  if (!existingSetting) {
    await prisma.systemSetting.create({
      data: { key: ACADEMIC_YEAR_SETTING_KEY, value: DEFAULT_ACADEMIC_YEAR },
    });
    console.log(`[1] تم اعتماد العام الدراسي ${DEFAULT_ACADEMIC_YEAR} كسنة العمل الحالية.`);
  } else {
    console.log(`[1] العام الدراسي الحالي موجود مسبقًا: ${existingSetting.value}`);
  }
  const activeYear = existingSetting?.value ?? DEFAULT_ACADEMIC_YEAR;

  // 2) academicYear backfill ------------------------------------------------
  const missingYear = await prisma.courseCompletion.count({
    where: { academicYear: null },
  });
  if (missingYear > 0) {
    const result = await prisma.courseCompletion.updateMany({
      where: { academicYear: null },
      data: { academicYear: activeYear },
    });
    console.log(`[2] تم ختم ${result.count} سجل إكمال بالعام الدراسي ${activeYear}.`);
  } else {
    console.log("[2] كل سجلات الإكمال مسمة بالعام الدراسي — لا شيء لعمله.");
  }

  // 3) Supervisor + deputy mappings from the original roster ----------------
  let roster;
  try {
    roster = loadRoster();
  } catch {
    console.log("[3] تعذر قراءة html-roster.json — تم تخطي استيراد الإسنادات.");
    roster = null;
  }

  if (roster) {
    const [teachers, supervisors, deputies, assignments] = await Promise.all([
      prisma.user.findMany({
        where: { role: "TEACHER" },
        select: { id: true, name: true, schoolId: true },
        take: 20000,
      }),
      prisma.user.findMany({
        where: { role: "EDUCATIONAL_SUPERVISOR", isActive: true },
        select: { id: true, name: true },
        take: 5000,
      }),
      prisma.user.findMany({
        where: { role: "EDUCATIONAL_DEPUTY", isActive: true },
        select: { id: true, name: true },
        take: 5000,
      }),
      prisma.teacherSupervisorAssignment.findMany({
        select: { teacherId: true, supervisorId: true, deputyId: true },
        take: 20000,
      }),
    ]);

    const teacherByKey = new Map(teachers.map((t) => [nameKey(t.name), t]));
    const supervisorByKey = new Map(supervisors.map((s) => [nameKey(s.name), s]));
    const deputyByKey = new Map(deputies.map((d) => [nameKey(d.name), d]));
    const assignmentByTeacher = new Map(assignments.map((a) => [a.teacherId, a]));

    let matchedTeachers = 0;
    let createdAssignments = 0;
    let updatedAssignments = 0;
    const unresolvedSupervisors = new Set();
    const unresolvedDeputies = new Set();

    for (const row of roster) {
      const teacher = teacherByKey.get(nameKey(row.name));
      if (!teacher) continue; // roster-only name (account not created) — skip
      matchedTeachers += 1;

      const supervisor = row.supervisor
        ? supervisorByKey.get(nameKey(row.supervisor)) ?? null
        : null;
      if (row.supervisor && !supervisor) unresolvedSupervisors.add(row.supervisor);
      const deputy = row.deputy ? deputyByKey.get(nameKey(row.deputy)) ?? null : null;
      if (row.deputy && !deputy) unresolvedDeputies.add(row.deputy);
      if (!supervisor) continue; // never invent a supervisor

      const existing = assignmentByTeacher.get(teacher.id);
      if (!existing) {
        if (!teacher.schoolId) continue; // the row is school-scoped by design
        await prisma.teacherSupervisorAssignment.create({
          data: {
            teacherId: teacher.id,
            supervisorId: supervisor.id,
            deputyId: deputy?.id ?? null,
            schoolId: teacher.schoolId,
          },
        });
        assignmentByTeacher.set(teacher.id, {
          teacherId: teacher.id,
          supervisorId: supervisor.id,
          deputyId: deputy?.id ?? null,
        });
        createdAssignments += 1;
      } else if (!existing.supervisorId || !existing.deputyId) {
        // Fill gaps only — never overwrite an explicit manual assignment.
        await prisma.teacherSupervisorAssignment.update({
          where: { teacherId: teacher.id },
          data: {
            supervisorId: existing.supervisorId || supervisor.id,
            deputyId: existing.deputyId ?? deputy?.id ?? null,
          },
        });
        updatedAssignments += 1;
      }
    }

    console.log(
      `[3] السجل الأصلي: ${roster.length} معلمًا — مطابقون في المنصة: ${matchedTeachers}.` +
        ` إسنادات مُنشأة: ${createdAssignments}، مُكملة: ${updatedAssignments}.`
    );
    if (unresolvedSupervisors.size > 0) {
      console.log(
        `    أسماء مشرفين لم تُطابق حسابات المنصة (لم تُخترع): ${[...unresolvedSupervisors].slice(0, 10).join("، ")}${unresolvedSupervisors.size > 10 ? " …" : ""}`
      );
    }
    if (unresolvedDeputies.size > 0) {
      console.log(
        `    أسماء وكلاء لم تُطابق حسابات المنصة (لم تُخترع): ${[...unresolvedDeputies].slice(0, 10).join("، ")}${unresolvedDeputies.size > 10 ? " …" : ""}`
      );
    }
  }

  // 4) Growth levels default ------------------------------------------------
  const teachersWithoutLevel = await prisma.user.count({
    where: { role: "TEACHER", growthLevel: { equals: "" } },
  });
  if (teachersWithoutLevel > 0) {
    await prisma.user.updateMany({
      where: { role: "TEACHER", growthLevel: { equals: "" } },
      data: { growthLevel: "T0" },
    });
    console.log(`[4] تم ضبط T0 لـ ${teachersWithoutLevel} معلمًا بلا تصنيف.`);
  } else {
    console.log("[4] التصنيفات المهنية سليمة (T0 الافتراضي من السكيما).");
  }

  console.log("== Batch 2 migration DONE ==");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
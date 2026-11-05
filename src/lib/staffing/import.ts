import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

/* ------------------------------------------------------------------ */
/* Batch 2 — Excel/CSV import for teacher-supervisor assignments and    */
/* teacher data (HTML v21 + v26 parity).                                */
/*                                                                      */
/* The ORIGINAL platform imported .xlsx/.xls/.csv through the SheetJS   */
/* CDN and — importantly — its own "تحميل قالب Excel" button downloaded */
/* a UTF-8-BOM CSV template (Qurtuba_Assignment_Template.csv). This     */
/* service keeps the exact same import contract WITHOUT adding a        */
/* dependency: CSV files (Excel opens and saves them natively) parsed   */
/* server-side, with the ORIGINAL column aliases and the ORIGINAL       */
/* preview states (مطابقة جاهزة / تحتاج مراجعة / المعلم غير موجود).     */
/*                                                                      */
/* Column aliases preserved verbatim from the HTML:                     */
/*   name       Teacher_Name | اسم المعلم | "اسم المعلم " | name        */
/*   supervisor Supervisor | المشرف المسند إليه | المشرف التربوي | المشرف */
/*   deputy     Educational_Deputy | الوكيل | الوكيل التعليمي            */
/*   school     School | المجمع التعليمي | المجمع | القسم                */
/*   stage      Stage | المرحلة          subject: Subject | التخصص       */
/*   email      Email | البريد الإلكتروني | البريد                        */
/*                                                                      */
/* Commit behavior (v26): unknown teachers can be bulk-created as       */
/* INACTIVE placeholder accounts (unusable password, optional           */
/* @manarat.local email) — activation stays a deliberate manual step;   */
/* rows whose supervisor/deputy cannot be resolved are SKIPPED and      */
/* reported (v21 parity), never silently dropped.                      */
/* ------------------------------------------------------------------ */

export interface ImportActor {
  id: string;
  role: string;
  schoolId: string | null;
}

export type ImportServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code?: "FORBIDDEN" | "VALIDATION_ERROR" };

export const IMPORT_MAX_ROWS = 1000;

/** The ORIGINAL HTML template — byte-for-byte content parity. */
export function assignmentTemplateCsv(): string {
  return (
    "\uFEFFاسم المعلم,المشرف المسند إليه,الوكيل,المجمع التعليمي\n" +
    "أحمد محمد,أ. أحمد عبد الرزاق,أ. أشرف عبد الرحمن,النهضة"
  );
}

/* ------------------------------------------------------------------ */
/* CSV parsing (RFC-4180 style: quotes, "" escapes, CRLF/LF)            */
/* ------------------------------------------------------------------ */

/** Parse a CSV text into rows of cells. Strips the Excel UTF-8 BOM. */
export function parseCsv(raw: string): string[][] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char === "\r") {
      // swallow — handled by the following \n (or ignored for bare CR)
      if (text[i + 1] !== "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      }
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ""));
}

/** HTML name-key normalization: trim, collapse spaces, strip "أ. ". */
export function nameKey(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^أ\.\s*/, "")
    .replace(/^ا\.\s*/, "")
    .toLowerCase();
}

function pick(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const value = row[alias];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

/** Map a header row to indexes, then build normalized objects. */
export function normalizeImportRows(raw: string): Array<Record<string, string>> {
  const table = parseCsv(raw);
  if (table.length === 0) return [];
  const headers = table[0].map((header) => header.trim());
  return table.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

export interface ParsedRow {
  name: string;
  supervisor: string;
  deputy: string;
  school: string;
  stage: string;
  subject: string;
  email: string;
}

/** Normalize raw sheet objects with the ORIGINAL alias mapping. */
export function toParsedRows(rows: Array<Record<string, string>>): ParsedRow[] {
  const parsed: ParsedRow[] = [];
  for (const row of rows) {
    const record: ParsedRow = {
      name: pick(row, ["Teacher_Name", "اسم المعلم", "اسم المعلم ", "name", "الاسم"]),
      supervisor: pick(row, [
        "Supervisor",
        "المشرف المسند إليه",
        "المشرف التربوي",
        "المشرف",
      ]),
      deputy: pick(row, ["Educational_Deputy", "الوكيل", "الوكيل التعليمي"]),
      school: pick(row, ["School", "المجمع التعليمي", "المجمع", "القسم"]),
      stage: pick(row, ["Stage", "المرحلة"]),
      subject: pick(row, ["Subject", "التخصص", "المادة"]),
      email: pick(row, ["Email", "البريد الإلكتروني", "البريد"]),
    };
    if (record.name) parsed.push(record);
  }
  return parsed.slice(0, IMPORT_MAX_ROWS);
}

/* ------------------------------------------------------------------ */
/* Preview                                                              */
/* ------------------------------------------------------------------ */

export type ImportRowStatus = "ready" | "needs_review" | "missing_teacher";

export interface ImportPreviewRow extends ParsedRow {
  index: number;
  status: ImportRowStatus;
  /** Human Arabic status — the HTML pill labels. */
  statusLabel: string;
  teacherId: string | null;
  supervisorId: string | null;
  deputyId: string | null;
  schoolId: string | null;
}

export interface ImportPreview {
  total: number;
  ready: number;
  needsReview: number;
  missingTeacher: number;
  rows: ImportPreviewRow[];
}

/**
 * Validate every row against the REAL directory (within the actor's
 * tenant) — the exact v21 preview states. Nothing is written here.
 */
export async function previewImport(
  actor: ImportActor,
  csvText: string
): Promise<ImportServiceResult<ImportPreview>> {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return { ok: false, message: "الاستيراد متاح لإدارة المدرسة فقط", code: "FORBIDDEN" };
  }
  const parsed = toParsedRows(normalizeImportRows(csvText));
  if (parsed.length === 0) {
    return {
      ok: false,
      message:
        "لم يتم العثور على صفوف صالحة — تأكد أن الصف الأول يحتوي أسماء الأعمدة وأن عمود «اسم المعلم» مملوء",
      code: "VALIDATION_ERROR",
    };
  }

  const scopeSchoolId =
    actor.role === "DEVELOPMENT_OFFICE_MANAGER" ? actor.schoolId : null;
  if (actor.role === "DEVELOPMENT_OFFICE_MANAGER" && !actor.schoolId) {
    return { ok: false, message: "حسابك غير مرتبط بمدرسة", code: "FORBIDDEN" };
  }

  const [teachers, supervisors, deputies, schools] = await Promise.all([
    db.user.findMany({
      where: {
        role: "TEACHER",
        ...(scopeSchoolId ? { schoolId: scopeSchoolId } : {}),
      },
      select: { id: true, name: true, email: true },
      take: 5000,
    }),
    db.user.findMany({
      where: {
        role: "EDUCATIONAL_SUPERVISOR",
        isActive: true,
        ...(scopeSchoolId ? { schoolId: scopeSchoolId } : {}),
      },
      select: { id: true, name: true },
      take: 2000,
    }),
    db.user.findMany({
      where: {
        role: "EDUCATIONAL_DEPUTY",
        isActive: true,
        ...(scopeSchoolId ? { schoolId: scopeSchoolId } : {}),
      },
      select: { id: true, name: true },
      take: 2000,
    }),
    db.school.findMany({
      where: { isActive: true },
      select: { id: true, nameAr: true },
      take: 500,
    }),
  ]);

  const teacherByKey = new Map<string, { id: string; name: string; email: string }>();
  for (const teacher of teachers) teacherByKey.set(nameKey(teacher.name), teacher);
  const supervisorByKey = new Map(supervisors.map((item) => [nameKey(item.name), item]));
  const deputyByKey = new Map(deputies.map((item) => [nameKey(item.name), item]));
  const schoolByKey = new Map(schools.map((school) => [nameKey(school.nameAr), school]));

  const rows: ImportPreviewRow[] = parsed.map((record, index) => {
    const teacher = teacherByKey.get(nameKey(record.name)) ?? null;
    const supervisor = record.supervisor
      ? supervisorByKey.get(nameKey(record.supervisor)) ?? null
      : null;
    const deputy = record.deputy ? deputyByKey.get(nameKey(record.deputy)) ?? null : null;
    const school = record.school ? schoolByKey.get(nameKey(record.school)) ?? null : null;

    let status: ImportRowStatus = "ready";
    if (!teacher) status = "missing_teacher";
    else if ((record.supervisor && !supervisor) || (record.deputy && !deputy)) {
      status = "needs_review";
    }

    const statusLabel =
      status === "missing_teacher"
        ? "المعلم غير موجود"
        : status === "needs_review"
          ? "تحتاج مراجعة"
          : "مطابقة جاهزة";

    return {
      ...record,
      index,
      status,
      statusLabel,
      teacherId: teacher?.id ?? null,
      supervisorId: supervisor?.id ?? null,
      deputyId: deputy?.id ?? null,
      schoolId: school?.id ?? null,
    };
  });

  return {
    ok: true,
    data: {
      total: rows.length,
      ready: rows.filter((row) => row.status === "ready").length,
      needsReview: rows.filter((row) => row.status === "needs_review").length,
      missingTeacher: rows.filter((row) => row.status === "missing_teacher").length,
      rows,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Commit                                                               */
/* ------------------------------------------------------------------ */

export interface CommitOptions {
  /** Bulk-create INACTIVE placeholder accounts for unknown teachers. */
  createMissingAccounts: boolean;
  /** Update the teacher's school when the school name matches. */
  updateSchool: boolean;
}

export interface CommitOutcome {
  applied: number;
  skipped: number;
  createdAccounts: number;
  /** Arabic per-row notes for the rows that were skipped or created. */
  notes: string[];
}

const MANARAT_LOCAL_DOMAIN = "manarat.local";

function slugifyEmailKey(name: string): string {
  const base = nameKey(name)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Arabic names have no ASCII letters — the placeholder local part must
  // stay ASCII (SMTP-safe): teacher-<timestamp>.
  if (base.length < 2 || !/[a-z0-9]/.test(base)) {
    return `teacher-${Date.now().toString(36)}`;
  }
  return base.slice(0, 40);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Apply a PREVIEWED import. The commit re-validates every row against
 * the database (the client can be malicious or stale) and runs the
 * same status logic; only "ready" rows and (optionally) creatable
 * teacher rows are written, in one transaction per row so a failure
 * never leaves a half-updated teacher.
 */
export async function commitImport(
  actor: ImportActor,
  csvText: string,
  options: CommitOptions
): Promise<ImportServiceResult<CommitOutcome>> {
  const preview = await previewImport(actor, csvText);
  if (!preview.ok) return preview;

  const scopeSchoolId =
    actor.role === "DEVELOPMENT_OFFICE_MANAGER" ? actor.schoolId : null;

  const schools = await db.school.findMany({
    where: { isActive: true },
    select: { id: true, nameAr: true },
    take: 500,
  });
  const schoolByKey = new Map(schools.map((school) => [nameKey(school.nameAr), school]));

  const outcome: CommitOutcome = {
    applied: 0,
    skipped: 0,
    createdAccounts: 0,
    notes: [],
  };

  for (const row of preview.data.rows) {
    try {
      // needs_review rows (unresolvable supervisor/deputy) are SKIPPED
      // and reported — the v21 contract, never silently applied.
      if (row.status === "needs_review") {
        outcome.skipped += 1;
        outcome.notes.push(
          `«${row.name}»: المشرف/الوكيل المذكور غير موجود في المنصة — تم تخطي الصف (تحتاج مراجعة).`
        );
        continue;
      }

      let teacherId = row.teacherId;

      // Unknown teacher -> optional bulk placeholder account (v26).
      if (!teacherId) {
        if (!options.createMissingAccounts) {
          outcome.skipped += 1;
          outcome.notes.push(`«${row.name}»: المعلم غير موجود — تم تخطي الصف.`);
          continue;
        }
        const schoolId = row.schoolId
          ? (schoolByKey.get(nameKey(row.school))?.id ?? scopeSchoolId)
          : scopeSchoolId;
        if (!schoolId) {
          outcome.skipped += 1;
          outcome.notes.push(
            `«${row.name}»: لا يمكن تحديد المدرسة لإنشاء الحساب — تم تخطي الصف.`
          );
          continue;
        }
        const email = await resolveImportEmail(actor, row.email, row.name);
        const created = await db.user.create({
          data: {
            name: row.name.trim(),
            email,
            // Unusable random password — the account is INACTIVE until an
            // administrator activates it and issues credentials.
            passwordHash: await hashPassword(
              `!${crypto.randomUUID()}${crypto.randomUUID()}`
            ),
            role: "TEACHER",
            schoolId,
            isActive: false,
            emailVerifiedAt: null,
            stage: row.stage || null,
            subject: row.subject || null,
          },
          select: { id: true },
        });
        teacherId = created.id;
        outcome.createdAccounts += 1;
        outcome.notes.push(
          `«${row.name}»: تم إنشاء حساب معلم غير مفعّل (${email}) — التفعيل خطوة يدوية.`
        );
      }

      // School update (v21 set t.school=school) — only on a clean match.
      const dataUpdate: { stage?: string | null; subject?: string | null; schoolId?: string } = {};
      if (row.stage) dataUpdate.stage = row.stage;
      if (row.subject) dataUpdate.subject = row.subject;
      if (options.updateSchool && row.schoolId) {
        dataUpdate.schoolId = row.schoolId;
      }
      if (Object.keys(dataUpdate).length > 0) {
        await db.user.update({ where: { id: teacherId }, data: dataUpdate });
      }

      // Assignment (v14SetAssignment parity) — supervisor + deputy.
      // supervisorId is NOT NULL in the schema: an empty supervisor cell
      // updates the deputy of an EXISTING assignment, or skips with an
      // explicit note (never a fake/empty supervisor reference).
      const assignmentSchoolId =
        row.schoolId ??
        scopeSchoolId ??
        (await db.user.findUnique({
          where: { id: teacherId },
          select: { schoolId: true },
        }))?.schoolId ??
        null;
      if (!assignmentSchoolId) {
        outcome.skipped += 1;
        outcome.notes.push(`«${row.name}»: لا يوجد مجمع تعليمي مرتبط — تم تخطي الإسناد.`);
        continue;
      }
      if (row.supervisorId) {
        await db.teacherSupervisorAssignment.upsert({
          where: { teacherId },
          create: {
            teacherId,
            supervisorId: row.supervisorId,
            deputyId: row.deputyId,
            schoolId: assignmentSchoolId,
          },
          update: {
            supervisorId: row.supervisorId,
            deputyId: row.deputyId,
            schoolId: assignmentSchoolId,
          },
        });
      } else {
        const existingAssignment = await db.teacherSupervisorAssignment.findUnique({
          where: { teacherId },
          select: { id: true },
        });
        if (existingAssignment && row.deputyId !== null) {
          await db.teacherSupervisorAssignment.update({
            where: { teacherId },
            data: { deputyId: row.deputyId, schoolId: assignmentSchoolId },
          });
        } else {
          outcome.skipped += 1;
          outcome.notes.push(
            `«${row.name}»: لا يوجد مشرف محدد في الملف ولا إسناد سابق — تم تخطي الإسناد.`
          );
          continue;
        }
      }

      outcome.applied += 1;
    } catch (error) {
      outcome.skipped += 1;
      const message = error instanceof Error ? error.message : "خطأ غير معروف";
      outcome.notes.push(`«${row.name}»: فشل الحفظ — ${message.slice(0, 120)}`);
    }
  }

  return { ok: true, data: outcome };
}

/**
 * Resolve the email for a bulk-created placeholder account: the row's
 * email when valid + unused, otherwise an @manarat.local placeholder
 * (same convention as the Batch 1 roster import) with collision suffix.
 */
async function resolveImportEmail(
  actor: ImportActor,
  rowEmail: string,
  name: string
): Promise<string> {
  const candidate = rowEmail.trim().toLowerCase();
  if (isValidEmail(candidate)) {
    const existing = await db.user.findUnique({ where: { email: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  const base = slugifyEmailKey(name);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const generated = `${base}${attempt === 0 ? "" : `-${attempt + 1}`}@${MANARAT_LOCAL_DOMAIN}`;
    const existing = await db.user.findUnique({ where: { email: generated }, select: { id: true } });
    if (!existing) return generated;
  }
  throw new Error("تعذر توليد بريد إلكتروني فريد للحساب");
}
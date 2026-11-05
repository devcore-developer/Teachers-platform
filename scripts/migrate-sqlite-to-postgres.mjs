/**
 * SQLite → PostgreSQL data transfer — منارة — مكتب التطوير التربوي
 * ================================================================
 * One-shot, NON-DESTRUCTIVE, all-or-nothing migration of every record
 * from the legacy SQLite database (prisma/dev.db) into PostgreSQL
 * (Neon in production).
 *
 * Guarantees
 * ----------
 * 1. NEVER deletes, truncates or resets anything. If the target is not
 *    empty the script ABORTS with an explanation instead of writing.
 * 2. All-or-nothing: the whole load runs inside ONE interactive
 *    transaction — a failure anywhere rolls back everything, so a
 *    re-run always starts from a clean, consistent state (this is the
 *    resumability model: a failed run leaves zero partial rows).
 * 3. Preserves IDs, foreign keys, dates, booleans, nullables and the
 *    JSON-in-text payloads byte-for-byte:
 *       - SQLite DateTime  → stored as epoch-ms INTEGER (or ISO TEXT in
 *         older rows)  → converted to real Date objects for PostgreSQL.
 *       - SQLite BOOLEAN   → stored as 0/1 → converted to true/false.
 *       - Strings (incl. Arabic, long text, JSON strings) → copied
 *         verbatim (PostgreSQL TEXT is unlimited, same as SQLite).
 * 4. Insert order is computed from the Prisma schema (topological by
 *    foreign keys). The only FK cycle — Attachment ↔ Course /
 *    CourseLesson / TrainingProgram cover references — is broken via a
 *    two-phase load: the cover/owner columns are inserted as NULL and
 *    patched right after, inside the same transaction.
 * 5. Validates record counts per table after the load and refuses to
 *    report success unless source and target agree everywhere.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * - No seeding. No demo data. No password re-hashing (bcrypt hashes are
 *   opaque strings and migrate untouched, so existing logins keep
 *   working).
 * - No sequence repairs: every primary key in this schema is a TEXT
 *   cuid() — there are no autoincrement sequences to advance.
 *
 * Usage (from the project root)
 * -----------------------------
 *   # target connection comes from the environment only
 *   DATABASE_URL=... DIRECT_DATABASE_URL=... node scripts/migrate-sqlite-to-postgres.mjs
 *
 *   SQLITE_SOURCE   source file   (default: prisma/dev.db)
 *   --skip-existing only fill tables that are still empty in the target
 *                   (use when Neon already holds SOME data you must
 *                   keep; tables with existing rows are reported and
 *                   skipped — run counts afterwards to reconcile)
 *   --verify-only   do not write; only compare source/target counts
 *
 * SQLite driver: uses the built-in node:sqlite (Node.js ≥ 22.5) when
 * available, otherwise falls back to better-sqlite3
 * (npm i -D better-sqlite3) for older Node versions.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const prisma = new PrismaClient();

/* ------------------------- configuration ------------------------- */

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const SKIP_EXISTING = args.has("--skip-existing");
const VERIFY_ONLY = args.has("--verify-only");
const SQLITE_SOURCE = process.env.SQLITE_SOURCE
  ? resolve(process.cwd(), process.env.SQLITE_SOURCE)
  : join(resolve(process.cwd(), "prisma"), "dev.db");

/**
 * FK edges removed from the ordering graph because BOTH endpoints are
 * nullable and they are the only cycle in the schema (cover-image
 * references). They are patched in phase 2 inside the same transaction.
 * Any OTHER future cycle aborts the script with a clear message.
 */
const DEFERRED_FKS = {
  Attachment: ["courseId", "lessonId", "programId"], // → courses / course_lessons / training_programs
  Course: ["coverAttachmentId"],                      // → attachments
  CourseLesson: ["attachmentId"],                     // → attachments
  TrainingProgram: ["coverAttachmentId"],             // → attachments
};

/* --------------------------- sqlite side -------------------------- */

async function openSqlite(file) {
  if (!existsSync(file)) {
    console.error(`\n✗ لم يتم العثور على قاعدة SQLite المصدر:\n  ${file}\n`);
    console.error(
      "نقل البيانات لا يمكن إتمامه بدون ملف المصدر. المطلوب:\n" +
      "  1) ملف prisma/dev.db من مشروعك (D:\\DevCore\\Teachers-platform\\prisma\\dev.db)\n" +
      "  2) أو أي نسخة احتياطية حديثة منه — ثم شغّل السكربت مع:\n" +
      '     SQLITE_SOURCE="المسار/إلى/dev.db" node scripts/migrate-sqlite-to-postgres.mjs\n'
    );
    process.exit(1);
  }
  if (!statSync(file).isFile()) {
    console.error(`✗ المسار المصدر ليس ملفًا: ${file}`);
    process.exit(1);
  }
  // 1) Built-in driver (Node ≥ 22.5) — zero dependencies.
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const conn = new DatabaseSync(file);
    return {
      name: "node:sqlite",
      tables: () =>
        conn
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table'
             AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'`
          )
          .all()
          .map((r) => r.name),
      count: (t) => Number(conn.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c),
      rows: (t) => conn.prepare(`SELECT * FROM "${t}"`).all(),
    };
  } catch (e) {
    if (e?.code !== "ERR_UNKNOWN_BUILTIN_MODULE" && !String(e).includes("node:sqlite")) {
      // A real error while opening (corrupt file…) — surface it.
      console.error("✗ فشل فتح قاعدة SQLite عبر node:sqlite:", e.message);
    }
  }
  // 2) better-sqlite3 fallback (older Node versions).
  try {
    const { default: BetterSqlite3 } = await import("better-sqlite3");
    const conn = new BetterSqlite3(file, { readonly: true, fileMustExist: true });
    return {
      name: "better-sqlite3",
      tables: () =>
        conn
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table'
             AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'`
          )
          .all()
          .map((r) => r.name),
      count: (t) => conn.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c,
      rows: (t) => conn.prepare(`SELECT * FROM "${t}"`).all(),
    };
  } catch {
    console.error(
      "✗ لا يوجد مشغل SQLite متاح.\n" +
      "  إما ترقية Node.js إلى 22.5 أو أحدث، أو تثبيت المشغّل الاختياري:\n" +
      "     npm i -D better-sqlite3\n"
    );
    process.exit(1);
  }
}

/* --------------------- schema-driven ordering ---------------------- */

function buildPlan() {
  const models = prismaRuntimeModels();
  const byTable = new Map(); // table name → { model, deps:Set<table>, deferred:string[] }
  for (const m of models) {
    const table = m.dbName ?? m.name;
    const deps = new Set();
    const deferred = [];
    for (const f of m.fields) {
      if (f.kind !== "object") continue; // relation fields (FK owners carry relationFromFields)
      const from = f.relationFromFields;
      if (!from || from.length === 0) continue; // back-relation only
      const targetTable = m.modelNameOf(f.type)?.dbName ?? f.type;
      const deferredHere = (DEFERRED_FKS[m.name] ?? []).filter((x) => from.includes(x));
      if (deferredHere.length === from.length) {
        deferred.push(...from); // whole edge deferred → not an ordering constraint
        continue;
      }
      deps.add(targetTable);
    }
    byTable.set(table, { model: m, deps, deferred });
  }
  // Kahn's algorithm — dependencies first.
  const order = [];
  const remaining = new Map(byTable);
  while (remaining.size > 0) {
    const ready = [...remaining.entries()].filter(([, v]) =>
      [...v.deps].every((d) => !remaining.has(d))
    );
    if (ready.length === 0) {
      const cycle = [...remaining.keys()].join(", ");
      throw new Error(
        `دورة في المفاتيح الأجنبية غير مُعالَجة بين: ${cycle}\n` +
        `أضف الحقول إلى DEFERRED_FKS في scripts/migrate-sqlite-to-postgres.mjs ثم أعد المحاولة.`
      );
    }
    for (const [t] of ready.sort(([a], [b]) => a.localeCompare(b))) {
      order.push(t);
      remaining.delete(t);
    }
  }
  return { byTable, order };
}

/** datamodel models, with a helper to resolve referenced model meta. */
function prismaRuntimeModels() {
  const models = Prisma.dmmf.datamodel.models;
  const byName = new Map(models.map((m) => [m.name, m]));
  for (const m of models) {
    m.modelNameOf = (name) => byName.get(name);
  }
  return models;
}

/* --------------------- value type conversion ----------------------- */

function convertRow(model, row, table) {
  const out = {};
  for (const f of model.fields) {
    if (f.kind !== "scalar") continue; // relations are set via their FK scalar columns
    const v = row[f.name];
    if (v === undefined) continue;    // column absent in this legacy file
    if (v === null) { out[f.name] = null; continue; }
    switch (f.type) {
      case "DateTime": {
        // Prisma/SQLite stores epoch-ms integers; older exports may hold
        // ISO strings. Accept both, refuse anything unparsable.
        let d;
        if (typeof v === "number") d = new Date(v);
        else if (typeof v === "string" && /^\d+$/.test(v.trim())) d = new Date(Number(v));
        else d = new Date(v);
        if (Number.isNaN(d.getTime()))
          throw new Error(`قيمة تاريخ غير صالحة في ${table}.${f.name}: ${JSON.stringify(v)}`);
        out[f.name] = d;
        break;
      }
      case "Boolean": {
        if (v === 1 || v === "1" || v === true) out[f.name] = true;
        else if (v === 0 || v === "0" || v === false) out[f.name] = false;
        else throw new Error(`قيمة منطقية غير صالحة في ${table}.${f.name}: ${JSON.stringify(v)}`);
        break;
      }
      case "Int":
      case "BigInt": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) throw new Error(`قيمة رقمية غير صالحة في ${table}.${f.name}: ${JSON.stringify(v)}`);
        out[f.name] = f.type === "BigInt" ? BigInt(n) : Math.trunc(n);
        break;
      }
      case "Float":
      case "Decimal": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) throw new Error(`قيمة عشرية غير صالحة في ${table}.${f.name}: ${JSON.stringify(v)}`);
        out[f.name] = n;
        break;
      }
      default: {
        // String — includes the *Json text columns; copied verbatim.
        if (Buffer.isBuffer(v)) out[f.name] = v.toString("utf8");
        else if (typeof v === "string") out[f.name] = v;
        else out[f.name] = String(v);
      }
    }
  }
  return out;
}

/* ------------------------------ main ------------------------------ */

async function main() {
  console.log("== نقل البيانات: SQLite → PostgreSQL ==");
  const target =
    process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!target && !VERIFY_ONLY) {
    console.error("✗ DATABASE_URL (ويفضَّل DIRECT_DATABASE_URL) غير مضبوط في البيئة.");
    process.exit(1);
  }

  const src = await openSqlite(SQLITE_SOURCE);
  console.log(`المصدر: ${SQLITE_SOURCE} (مشغّل: ${src.name})`);
  console.log("الهدف: PostgreSQL (من متغيرات البيئة — لا تُطبع بيانات الاتصال)\n");

  const { byTable, order } = buildPlan();
  const srcTables = new Set(src.tables());

  // Source snapshot (counts first — cheap consistency baseline).
  const plan = [];
  for (const table of order) {
    const entry = byTable.get(table);
    const exists = srcTables.has(table);
    const count = exists ? src.count(table) : 0;
    plan.push({ table, entry, exists, count });
  }
  const srcTotal = plan.reduce((s, p) => s + p.count, 0);
  console.log(`جداول المخطط: ${plan.length} — إجمالي الصفوف في المصدر: ${srcTotal}\n`);

  const missing = plan.filter((p) => !p.exists).map((p) => p.table);
  if (missing.length > 0)
    console.warn(`⚠ جداول غائبة عن ملف SQLite (قديم؟) وستُتجاهل: ${missing.join(", ")}\n`);

  // Target snapshot.
  const tgtCount = {};
  for (const p of plan) {
    if (!p.exists) continue;
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${p.table}"`);
    tgtCount[p.table] = rows[0].c;
  }

  if (VERIFY_ONLY) {
    let bad = 0;
    console.log("جدول                          مصدر  هدف  الحالة");
    for (const p of plan) {
      if (!p.exists) continue;
      const ok = tgtCount[p.table] === p.count;
      if (!ok) bad++;
      console.log(
        `${p.table.padEnd(30)}${String(p.count).padStart(5)}${String(tgtCount[p.table]).padStart(6)}  ${ok ? "✓" : "✗"}`
      );
    }
    console.log(bad === 0 ? "\n✓ التحقق ناجح — الأعداد متطابقة." : `\n✗ ${bad} جدولًا غير متطابق.`);
    process.exit(bad === 0 ? 0 : 2);
  }

  // Safety gates — never assume the target is empty.
  if (!SKIP_EXISTING) {
    const nonEmpty = plan.filter((p) => p.exists && tgtCount[p.table] > 0);
    const fullyDone =
      nonEmpty.length > 0 &&
      nonEmpty.length === plan.filter((p) => p.exists).length &&
      nonEmpty.every((p) => tgtCount[p.table] === p.count);
    if (fullyDone) {
      console.log("✓ الهدف يحتوي أصلًا على نفس أعداد المصدر — يبدو أن النقل أُنجز سابقًا. لا شيء للفعله.");
      process.exit(0);
    }
    if (nonEmpty.length > 0) {
      console.error("✗ الهدف ليس فارغًا — إيقاف للحفاظ على البيانات الموجودة. الجداول غير الفارغة:");
      for (const p of nonEmpty) console.error(`   ${p.table}: ${tgtCount[p.table]} صف (المصدر: ${p.count})`);
      console.error(
        "\nالخيارات:\n" +
        "  • إن كانت هذه بيانات فعلية يجب إبقاؤها: أعد التشغيل مع --skip-existing\n" +
        "    (سينقل الجداول الفارغة فقط ويعرض تقرير فروق الأعداد).\n" +
        "  • إن كانت بقايا تجربة سابقة: أفرغها عمدًا وبقرار بشري، ثم أعد التشغيل.\n" +
        "    هذا السكربت لا يحذف ولا يفرغ أبدًا.\n"
      );
      process.exit(1);
    }
  }

  const emptySource = srcTotal === 0;
  if (emptySource) {
    console.error("✗ المصدر فارغ تمامًا (0 صف) — تحقق من SQLITE_SOURCE قبل المتابعة.");
    process.exit(1);
  }

  // ---------------- the load: one transaction, all-or-nothing --------
  const CHUNK = 200;
  let phase2Patches = 0;

  await prisma.$transaction(
    async (tx) => {
      const patches = []; // cycle repairs, applied after ALL inserts
      for (const p of plan) {
        if (!p.exists) continue;
        if (SKIP_EXISTING && tgtCount[p.table] > 0) {
          console.log(`↷ تخطّى ${p.table} (يحتوي ${tgtCount[p.table]} صفًا)`);
          continue;
        }
        const { model, deferred } = p.entry;
        const rows = src.rows(p.table).map((r) => convertRow(model, r, p.table));
        if (rows.length === 0) {
          console.log(`✓ ${p.table}: 0 صف (لا شيء للنقل)`);
          continue;
        }

        // Phase 1 — insert with the deferred (cycle) columns nulled.
        const prepared = deferred.length
          ? rows.map((r) => {
              const c = { ...r };
              for (const f of deferred) delete c[f];
              return c;
            })
          : rows;

        const delegate = tx[delegateName(p.table)];
        for (let i = 0; i < prepared.length; i += CHUNK) {
          await delegate.createMany({ data: prepared.slice(i, i + CHUNK) });
        }

        if (deferred.length) patches.push({ delegate, rows, deferred });
        console.log(`✓ ${p.table}: ${rows.length} صف`);
      }

      // Phase 2 — every table now exists, so the deferred cover/owner
      // references can be re-applied (still inside the transaction).
      for (const { delegate, rows, deferred } of patches) {
        for (const row of rows) {
          const patch = {};
          for (const f of deferred) if (row[f] !== undefined) patch[f] = row[f];
          if (Object.keys(patch).length === 0) continue;
          await delegate.update({ where: { id: row.id }, data: patch });
          phase2Patches++;
        }
      }
    },
    { maxWait: 20_000, timeout: 900_000 } // 15 min ceiling for large files
  );

  // ---------------------------- validation ---------------------------
  console.log("\n== التحقق بعد النقل ==");
  let mismatches = 0;
  for (const p of plan) {
    if (!p.exists) continue;
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${p.table}"`);
    const ok = rows[0].c === p.count;
    if (!ok) mismatches++;
    console.log(`${ok ? "✓" : "✗"} ${p.table}: المصدر ${p.count} / الهدف ${rows[0].c}`);
  }
  if (phase2Patches > 0) console.log(`(تمت إعادة ربط ${phase2Patches} مرجع غلاف/ملحق في الطور الثاني)`);

  if (mismatches > 0) {
    console.error(`\n✗ فشل التحقق: ${mismatches} جدولًا غير متطابق — راجع السجل أعلاه. (لم يُبلَّغ بنجاح)`);
    process.exit(2);
  }
  console.log("\n✅ تم نقل جميع السجلات بنجاح والتحقق من الأعداد. المفاتيح الأجنبية مفروضة من PostgreSQL نفسه أثناء الإدراج.");
}

/** Prisma client delegate name for a mapped table (e.g. "schools" → prisma.school,
 *  "CourseSection" → prisma.courseSection): model name with a lowercased first letter. */
function delegateName(table) {
  const models = Prisma.dmmf.datamodel.models;
  const m = models.find((x) => (x.dbName ?? x.name) === table);
  if (!m) throw new Error(`لا يوجد موديل للجدول ${table}`);
  return m.name.charAt(0).toLowerCase() + m.name.slice(1);
}

main()
  .catch((e) => {
    console.error("\n✗ فشل النقل — لم يُكتب أي شيء (كل العمليات داخل معاملة واحدة تراجع تلقائيًا):");
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
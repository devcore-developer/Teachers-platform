#!/usr/bin/env node
/**
 * Provision the FIRST SUPER_ADMIN (platform administrator) safely.
 *
 * Usage (Windows PowerShell):
 *   node scripts/provision-super-admin.mjs --email "admin@manara.local" --name "مدير المنصة" --password "Str0ngPass123"
 *
 * Or via environment variables:
 *   $env:SUPER_ADMIN_EMAIL="..."; $env:SUPER_ADMIN_NAME="..."; $env:SUPER_ADMIN_PASSWORD="..."
 *   node scripts/provision-super-admin.mjs
 *
 * Safety guarantees (per the phase spec):
 *   - No public endpoint can create administrators — this controlled CLI
 *     is the only provisioning path.
 *   - If a SUPER_ADMIN already exists the script REFUSES to run unless
 *     --force is passed (which still never modifies the existing admin —
 *     it only allows provisioning an additional one).
 *   - If the email already belongs to ANY user the script aborts — it
 *     never overwrites an existing account or resets a password.
 *   - The password is accepted as a CLI/env argument (documented, local,
 *     one-off) and immediately hashed with bcrypt — plaintext is never
 *     stored, echoed or logged.
 *   - No production credentials are hardcoded here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Minimal .env loader (Node does not auto-load .env for scripts). */
function loadEnvFile() {
  try {
    const raw = readFileSync(path.join(PROJECT_ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env is optional — DATABASE_URL may come from the real environment.
  }
}
loadEnvFile();

/* ----------------------------- Args ------------------------------ */

const args = process.argv.slice(2);
function argValue(name) {
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : undefined;
}
const force = args.includes("--force");

const email = (argValue("--email") ?? process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
const name = (argValue("--name") ?? process.env.SUPER_ADMIN_NAME ?? "").trim();
const password = argValue("--password") ?? process.env.SUPER_ADMIN_PASSWORD ?? "";

if (!process.env.DATABASE_URL) {
  console.error("✗ DATABASE_URL غير معرف — أضفه إلى .env ثم أعد المحاولة.");
  process.exit(1);
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("✗ بريد إلكتروني غير صالح — استخدم --email \"admin@example.com\".");
  process.exit(1);
}
if (!name || name.length < 2) {
  console.error('✗ الاسم مطلوب — استخدم --name "مدير المنصة".');
  process.exit(1);
}
if (password.length < 8 || !/\p{L}/u.test(password) || !/\d/.test(password)) {
  console.error(
    "✗ كلمة المرور ضعيفة — 8 أحرف على الأقل وتحتوي على حرف ورقم واحد على الأقل."
  );
  process.exit(1);
}

/* --------------------------- Provision --------------------------- */

const { PrismaClient } = await import("@prisma/client");
const bcrypt = (await import("bcryptjs")).default;
const db = new PrismaClient();

try {
  const existingSuperAdmin = await db.user.findFirst({
    where: { role: "SUPER_ADMIN" },
  });

  if (existingSuperAdmin && !force) {
    console.error(
      "✗ يوجد مدير منصة بالفعل (" +
        existingSuperAdmin.email +
        ") — لن يتغير أي شيء.\n" +
        "  لتوفير مدير منصة إضافي شغّل الأمر نفسه مع --force (لن يُعدّل الحساب القائم)."
    );
    process.exit(1);
  }

  const emailOwner = await db.user.findUnique({ where: { email } });
  if (emailOwner) {
    console.error(
      "✗ البريد الإلكتروني مستخدم بالفعل لحساب قائم (" +
        emailOwner.role +
        ") — الإلغاء. لا يتم استبدال أو إعادة تعيين حساب موجود أبدًا."
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await db.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: "SUPER_ADMIN",
      schoolId: null,
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  console.log("✓ تم إنشاء حساب مدير المنصة بنجاح.");
  console.log("  المعرف: " + admin.id);
  console.log("  البريد: " + admin.email);
  console.log("  سجّل الدخول من /login — كلمة المرور محفوظة مشفّرة (bcrypt) ولن تُعرض مرة أخرى.");
} finally {
  await db.$disconnect();
}
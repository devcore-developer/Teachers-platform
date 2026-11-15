/* logo-dump.mjs — collects everything needed to diagnose the
   school-logo upload failure into ONE file (logo-dump.txt).
   Run:  node logo-dump.mjs
   Note: never reads .env files (secrets stay safe). */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "logo-dump.txt");
const MAX_BYTES_PER_FILE = 600_000;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build", "coverage"]);
const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".prisma", ".md"]);

/* Arabic keywords written as unicode escapes so the script works
   no matter what encoding it was saved with. */
const CONTENT_RE = /\u0627\u0644\u0634\u0639\u0627\u0631|\u0644\u0648\u062c\u0648|logo/i; // الشعار | لوجو | logo
const PATH_RE = /logo|school|setting|brand|principal|upload/i;
const ALWAYS = [
  "package.json",
  "prisma/schema.prisma",
  "next.config.ts",
  "next.config.mjs",
  "next.config.js",
];

function walk(dir) {
  let out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out = out.concat(walk(join(dir, e.name)));
    } else if (e.isFile() && TEXT_EXTS.has(extname(e.name).toLowerCase())) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

function publicTree() {
  const pub = join(ROOT, "public");
  if (!existsSync(pub)) return "public/ does not exist at project root!";
  const lines = [];
  function rec(dir, depth) {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = relative(pub, join(dir, e.name));
      if (e.isDirectory()) {
        lines.push(`  [DIR]  ${rel}/`);
        rec(join(dir, e.name), depth + 1);
      } else {
        let size = 0;
        try { size = statSync(join(dir, e.name)).size; } catch {}
        lines.push(`  ${rel}  (${size} bytes)`);
      }
    }
  }
  rec(pub, 0);
  return lines.join("\n");
}

const srcFiles = walk(join(ROOT, "src"));
const hot = [];
const pathMatches = [];

for (const f of srcFiles) {
  let content;
  try { content = readFileSync(f, "utf8"); } catch { continue; }
  if (CONTENT_RE.test(content)) hot.push(f);
  else if (PATH_RE.test(relative(ROOT, f))) pathMatches.push(f);
}
hot.sort();
pathMatches.sort();

const configFiles = ALWAYS.filter((p) => existsSync(join(ROOT, p)));
const groups = [
  { tag: "HOT — code contains a logo keyword (priority)", files: hot },
  { tag: "PATH — filename points to school/settings/upload", files: pathMatches },
  { tag: "CONFIG — project configuration", files: configFiles },
];

const parts = [];
const SEP = "=".repeat(70);

parts.push(SEP);
parts.push("logo-dump — school logo upload diagnosis");
parts.push(`ROOT: ${ROOT}`);
parts.push(`Generated: ${new Date().toISOString()}`);
parts.push(`node ${process.version} | platform ${process.platform}`);
parts.push(SEP);
parts.push("");
parts.push("--- public/ tree (names only, to spot the uploads folder) ---");
parts.push(publicTree());

let total = 0;
for (const group of groups) {
  parts.push("");
  parts.push(SEP);
  parts.push(`### ${group.tag} — ${group.files.length} file(s)`);
  parts.push(SEP);
  for (const f of group.files) {
    total += 1;
    const rel = relative(ROOT, f);
    let body = "";
    let note = "";
    try {
      const buf = readFileSync(f);
      const lines = buf.toString("utf8").split(/\r?\n/);
      if (buf.length > MAX_BYTES_PER_FILE) {
        body = lines.slice(0, 2000).map((l, i) => `${String(i + 1).padStart(5)} | ${l}`).join("\n");
        note = `  [TRUNCATED — original has ${lines.length} lines]`;
      } else {
        body = lines.map((l, i) => `${String(i + 1).padStart(5)} | ${l}`).join("\n");
      }
    } catch (err) {
      note = `  [READ FAILED: ${err?.message ?? err}]`;
    }
    parts.push("");
    parts.push(SEP);
    parts.push(`### FILE: ${rel}${note}`);
    parts.push(SEP);
    parts.push(body);
  }
}

parts.push("");
parts.push(SEP);
parts.push(`Collected files: ${total}`);
parts.push("Please ALSO send me (1) the last lines of the SERVER terminal");
parts.push("at the moment the failure message appears, (2) how the production");
parts.push("server is run (next start / pm2 / Docker / IIS / Vercel),");
parts.push("(3) the size of the logo image file you tried to upload.");
parts.push(SEP);

writeFileSync(OUT, parts.join("\n"), "utf8");
console.log(`Done — collected ${total} file(s) into: ${OUT}`);
console.log("Send logo-dump.txt to the chat as an attachment.");
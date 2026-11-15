/**
 * patch-confirms.mjs — one-shot patcher for batch 2 of the confirm()
 * → styled-dialog migration (the four literal delete-confirmation sites).
 *
 * Run from the project root (D:\DevCore\Teachers-platform):
 *   node patch-confirms.mjs
 *
 * Patches (anchor-safe: matches the whole call by its stable Arabic
 * prefix, so small wording differences don't break it):
 *   assessments-editor.tsx  : "حذف هذا السؤال نهائيًا — متابعة؟"
 *   unified-assessment.tsx  : "حذف هذا السؤال نهائيًا — متابعة؟"
 *   unified-content.tsx     : "حذف هذا الفيديو نهائيًا — متابعة؟"
 *   unified-editor.tsx      : "حذف هذا المرفق نهائيًا — متابعة؟"
 *
 * The four variable-confirmText sites are intentionally NOT touched
 * here — their tone (publish vs delete) needs the real texts and is
 * handled in the next full-file pass.
 *
 * After running:  npx tsc --noEmit
 */
import { readFileSync, writeFileSync } from "node:fs";

const IMPORT_LINE =
  'import { confirmDialog } from "@/components/platform/confirm-dialog";';

const FILES = [
  "src/app/supervision/assessments/[assessmentId]/assessments-editor.tsx",
  "src/app/supervision/training/unified/unified-assessment.tsx",
  "src/app/supervision/training/unified/unified-content.tsx",
  "src/app/supervision/training/unified/unified-editor.tsx",
];

const REPLACEMENTS = [
  {
    id: "delete-question",
    pattern: /if \(!window\.confirm\("حذف هذا السؤال[^"]*"\)\) return;/g,
    replacement:
      'if (!(await confirmDialog({ title: "حذف السؤال؟", description: "سيتم حذف هذا السؤال نهائيًا من الاختبار.", tone: "danger" }))) return;',
  },
  {
    id: "delete-video",
    pattern: /if \(!window\.confirm\("حذف هذا الفيديو[^"]*"\)\) return;/g,
    replacement:
      'if (!(await confirmDialog({ title: "حذف الفيديو؟", description: "سيتم حذف هذا الفيديو نهائيًا من الدرس.", tone: "danger" }))) return;',
  },
  {
    id: "delete-attachment",
    pattern: /if \(!window\.confirm\("حذف هذا المرفق[^"]*"\)\) return;/g,
    replacement:
      'if (!(await confirmDialog({ title: "حذف المرفق؟", description: "سيتم حذف هذا المرفق نهائيًا.", tone: "danger" }))) return;',
  },
];

let totalPatched = 0;

for (const file of FILES) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    console.log(`SKIP  ${file} — not found`);
    continue;
  }
  const original = content;

  // 1) Import — inserted right after the "use client" directive line.
  if (!content.includes("confirm-dialog")) {
    const directiveIdx = content.indexOf('"use client"');
    if (directiveIdx !== -1) {
      const lineEnd = content.indexOf("\n", directiveIdx);
      if (lineEnd !== -1) {
        const eol = content[lineEnd - 1] === "\r" ? "\r\n" : "\n";
        content =
          content.slice(0, lineEnd + 1) + IMPORT_LINE + eol + content.slice(lineEnd + 1);
      }
    }
  }

  // 2) Confirm swaps.
  const counts = {};
  for (const { id, pattern, replacement } of REPLACEMENTS) {
    const hits = content.match(pattern);
    counts[id] = hits ? hits.length : 0;
    if (hits) content = content.replace(pattern, replacement);
  }

  if (content === original) {
    console.log(`NONE  ${file} — nothing matched (check the wording)`);
    continue;
  }
  writeFileSync(file, content, "utf8");
  const patched = Object.entries(counts).filter(([, n]) => n > 0);
  totalPatched += patched.reduce((sum, [, n]) => sum + n, 0);
  const remaining = (content.match(/window\.confirm/g) || []).length;
  console.log(
    `PATCH ${file} — ${patched.map(([id, n]) => `${id} x${n}`).join(", ")} | window.confirm left: ${remaining}`
  );
}

console.log(
  `\nDone — ${totalPatched} site(s) patched.` +
    `\nNext: npx tsc --noEmit` +
    `\n(If you get "await expressions are only allowed within async functions" at a patched` +
    `\n line, add async to that handler and re-run.)`
);
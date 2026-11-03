// fix-styles.mjs — Run ONCE from the project root: node fix-styles.mjs — then delete this file.
// Fixes the 2 real gaps found by check-styles.mjs:
//   1) layout.tsx missing  import "./globals.css";
//   2) globals.css -> clean minimal Tailwind v4 entry (old file backed up as globals.css.bak)
// It does NOT install packages — if tailwind v4 is missing it prints the npm command to run.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";

const R = existsSync("package.json") ? "" : "D:/DevCore/Teachers-platform/";
let changed = 0;
const read = (p) => { try { return readFileSync(R + p, "utf8"); } catch { return null; } };

// 1) what is actually installed?
const ver = (m) => { try { return JSON.parse(readFileSync(R + "node_modules/" + m + "/package.json", "utf8")).version; } catch { return "(NOT INSTALLED)"; } };
const tw = ver("tailwindcss");
const twp = ver("@tailwindcss/postcss");
console.log(`tailwindcss installed         : ${tw}`);
console.log(`@tailwindcss/postcss installed: ${twp}`);
const needInstall = !tw.startsWith("4.") || !twp.startsWith("4.");
if (needInstall) {
  console.log("");
  console.log(">>> RUN THIS FIRST (then re-run: node fix-styles.mjs):");
  console.log(">>>   npm install -D tailwindcss@^4 @tailwindcss/postcss@^4");
  console.log("");
}

// 2) layout.tsx — add the missing globals.css import
const layPath = existsSync(R + "src/app/layout.tsx") ? "src/app/layout.tsx" : existsSync(R + "app/layout.tsx") ? "app/layout.tsx" : null;
if (!layPath) {
  console.log("layout.tsx  : NOT FOUND (expected src/app/layout.tsx) - nothing patched");
} else {
  const lay = read(layPath);
  if (lay.includes("globals.css")) {
    console.log("layout.tsx  : already imports globals.css - untouched");
  } else {
    const lines = lay.split("\n");
    let at = lines.findIndex((l) => l.startsWith("import"));
    if (at === -1) at = 0;
    lines.splice(at, 0, 'import "./globals.css";');
    writeFileSync(R + layPath, lines.join("\n"), "utf8");
    changed++;
    console.log(`layout.tsx  : PATCHED - inserted 'import "./globals.css";' as line ${at + 1}`);
  }
}

// 3) globals.css — clean minimal v4 entry (no scaffold leftovers)
const gPath = existsSync(R + "src/app/globals.css") ? "src/app/globals.css" : existsSync(R + "app/globals.css") ? "app/globals.css" : null;
const CLEAN = '/* Tailwind v4 entry (manarat-qurtubah) */\n@import "tailwindcss";\n';
if (!gPath) {
  writeFileSync(R + "src/app/globals.css", CLEAN, "utf8");
  changed++;
  console.log("globals.css : CREATED (src/app/globals.css)");
} else {
  const css = read(gPath) ?? "";
  const clean = css.includes('@import "tailwindcss"') && !css.includes(":root") && !css.includes("@theme") && !css.includes("prefers-color-scheme");
  if (clean) {
    console.log("globals.css : already clean - untouched");
  } else {
    copyFileSync(R + gPath, R + gPath + ".bak");
    writeFileSync(R + gPath, CLEAN, "utf8");
    changed++;
    console.log(`globals.css : REPLACED with minimal v4 entry (old file kept as ${gPath}.bak)`);
  }
}

console.log("");
if (needInstall) {
  console.log("NEXT: run the npm install command above, re-run node fix-styles.mjs, then restart dev + hard refresh.");
} else if (changed > 0) {
  console.log(`DONE: ${changed} file(s) changed. Now: Ctrl+C the dev server, run: npm run dev, then hard refresh Ctrl+Shift+R`);
} else {
  console.log("NOTHING TO CHANGE - files already OK. If styles are still broken: restart dev + Ctrl+Shift+R, else paste check-styles output.");
}
"use client";

import Link from "next/link";
import { Download, FileJson, Printer } from "lucide-react";

/**
 * Batch 2 — export/print controls of the reports hub. Pure links to the
 * owner-scoped export API + the printable supervisor report.
 */
export function ReportsExportButtons({
  supervisorMode = false,
  printHref,
}: {
  supervisorMode?: boolean;
  printHref?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {supervisorMode && (
        <a
          href="/api/reports/export?type=supervisor"
          className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100"
        >
          <Download className="size-4" aria-hidden="true" />
          تصدير CSV
        </a>
      )}
      {supervisorMode && printHref && (
        <Link
          href={printHref}
          className="inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-bold transition-colors hover:bg-accent"
        >
          <Printer className="size-4" aria-hidden="true" />
          نسخة للطباعة
        </Link>
      )}
      {!supervisorMode && (
        <a
          href="/api/reports/export?type=bundle"
          className="inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-bold transition-colors hover:bg-accent"
        >
          <FileJson className="size-4" aria-hidden="true" />
          حزمة JSON
        </a>
      )}
    </div>
  );
}
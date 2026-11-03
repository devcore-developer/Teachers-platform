"use client";

/**
 * Phase 10 — print trigger: opens the browser print dialog for the
 * print-optimized report view (the browser's PDF engine preserves
 * Arabic shaping natively — "حفظ كـ PDF" produces the PDF report).
 */
export function PrintButton({ label = "طباعة / حفظ PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-xs font-bold text-white hover:bg-[#174bb3]"
    >
      {label}
    </button>
  );
}
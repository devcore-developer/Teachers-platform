"use client";

/**
 * Phase 8 — print trigger for the certificate sheet. The browser's
 * print dialog doubles as the PDF flow ("حفظ كـ PDF") — no extra
 * PDF dependency is needed. Print styles live on the certificate page.
 */
export function PrintButton({ label = "طباعة / حفظ PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
    >
      {label}
    </button>
  );
}
"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

/** One-tap print + auto-print on first render (after paint). */
export function PrintTrigger() {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="mb-6 flex justify-start print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700"
      >
        <Printer className="size-4" aria-hidden="true" />
        طباعة التقرير
      </button>
    </div>
  );
}
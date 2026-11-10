"use client";

/**
 * Auto-print trigger for the dedicated certificate print route.
 *
 * Fires the browser print dialog once the sheet has settled (fonts +
 * QR image decoded). Falls back to a visible manual button when the
 * automatic trigger is delayed or blocked — the user is never stuck.
 * The whole control is marked .no-print and never appears on paper.
 */
import * as React from "react";
import { Printer } from "lucide-react";

export function AutoPrint({ certificateNumber }: { certificateNumber: string }) {
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setArmed(true);
      // Double rAF: guarantees a painted frame (incl. the QR <img>) exists
      // before the print snapshot is taken.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.print());
      });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-slate-800">
          صفحة طباعة الشهادة — نسخة A4 أفقية واحدة
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          في نافذة الطباعة اختر «حفظ كـ PDF» مع الاتجاه الأفقي (Landscape)
          وهو مضبوط تلقائيًا — رقم الشهادة{" "}
          <span dir="ltr" className="font-mono font-bold text-slate-700">
            {certificateNumber}
          </span>
          .
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D5BD6] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#174aa8]"
      >
        <Printer className="size-4" aria-hidden="true" />
        {armed ? "طباعة / حفظ PDF" : "إعادة فتح نافذة الطباعة"}
      </button>
    </div>
  );
}

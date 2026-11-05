"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

/**
 * Batch 1 — the public verification search box (GET form). The lookup
 * itself runs in the server component from the ?code= param, so the
 * result is shareable/bookmarkable — exactly what a printed QR needs.
 */
export function VerifyForm({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  return (
    <form
      className="mt-6 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const code = value.trim();
        router.push(code ? `/verify?code=${encodeURIComponent(code)}` : "/verify");
      }}
    >
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="مثال: MQ-2026-AB12CD أو رمز التحقق المكوّن من 16 خانة"
          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pe-3 ps-10 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
          aria-label="رقم الشهادة أو رمز التحقق"
        />
      </div>
      <button
        type="submit"
        className="rounded-lg bg-[#1D5BD6] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#174aa8]"
      >
        تحقق الآن
      </button>
    </form>
  );
}
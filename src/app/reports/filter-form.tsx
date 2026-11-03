"use client";

/**
 * Phase 10 — report filter form (client). Builds a URL query from the
 * selects and lets the server page re-validate everything — the form
 * can never grant access to out-of-scope data, it can only ask.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterField {
  key: string;
  label: string;
  type: "select" | "date";
  options?: FilterOption[];
  placeholder?: string;
}

export function ReportFilterForm({
  reportId,
  fields,
  current,
}: {
  reportId: string;
  fields: FilterField[];
  current: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(current);

  function submit() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value && value.trim() !== "") params.set(key, value.trim());
    }
    startTransition(() => {
      router.push(`/reports/${reportId}?${params.toString()}`);
    });
  }

  function reset() {
    setValues({});
    startTransition(() => {
      router.push(`/reports/${reportId}`);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((field) => (
          <label key={field.key} className="block text-xs">
            <span className="mb-1 block font-semibold text-slate-600">{field.label}</span>
            {field.type === "select" ? (
              <select
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#1D5BD6] focus:outline-none"
              >
                <option value="">{field.placeholder ?? "الكل"}</option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="date"
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#1D5BD6] focus:outline-none"
              />
            )}
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-xs font-bold text-white hover:bg-[#174bb3] disabled:opacity-60"
        >
          {pending ? "جارٍ التحديث…" : "تطبيق المرشحات"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          إعادة تعيين
        </button>
      </div>
    </div>
  );
}
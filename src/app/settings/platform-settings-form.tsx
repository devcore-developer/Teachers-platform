"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  updatePlatformSettings,
  type PlatformSettingsState,
} from "@/app/actions/platform-settings";
import type { PlatformSettings } from "@/lib/platform-settings";

const INITIAL_STATE: PlatformSettingsState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[#1D5BD6] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
    </button>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-red-600">{message}</p>;
}

/**
 * Platform identity + global controls form (SUPER_ADMIN). Values persist
 * in the SystemSetting table and apply immediately after saving.
 */
export function PlatformSettingsForm({
  initial,
}: {
  initial: PlatformSettings;
}) {
  const [state, formAction] = useActionState(
    updatePlatformSettings,
    INITIAL_STATE
  );

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100";

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="platformName">
            اسم المنصة
          </label>
          <input
            id="platformName"
            name="platformName"
            defaultValue={initial.platformName}
            maxLength={60}
            required
            className={inputClass}
          />
          <FieldError message={state.fieldErrors?.platformName} />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="platformTagline">
            العنوان الوصفي
          </label>
          <input
            id="platformTagline"
            name="platformTagline"
            defaultValue={initial.platformTagline}
            maxLength={120}
            placeholder="مكتب التطوير التربوي"
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="supportEmail">
            بريد الدعم (اختياري)
          </label>
          <input
            id="supportEmail"
            name="supportEmail"
            type="email"
            dir="ltr"
            defaultValue={initial.supportEmail}
            placeholder="support@example.com"
            className={inputClass}
          />
          <FieldError message={state.fieldErrors?.supportEmail} />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="activeAcademicYear">
            العام الدراسي النشط
          </label>
          <input
            id="activeAcademicYear"
            name="activeAcademicYear"
            defaultValue={initial.activeAcademicYear}
            maxLength={20}
            placeholder="مثال: 1448هـ"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-400">
            يستخدمه السجل التدريبي السنوي والأرشفة السنوية في كل المدارس.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <SubmitButton />
        {state.message ? (
          <span
            className={
              state.ok
                ? "text-sm font-medium text-emerald-600"
                : "text-sm font-medium text-red-600"
            }
            role="status"
          >
            {state.ok ? "✓ " : "✕ "}
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
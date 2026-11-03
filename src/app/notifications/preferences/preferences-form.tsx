"use client";

/**
 * Phase 11 — notification preferences form (client).
 * Checkbox toggles with the hidden-false input pattern so the server
 * action receives explicit on/off values for every key.
 */

import { useActionState } from "react";
import {
  updateNotificationPreferencesAction,
  type NotificationActionState,
} from "@/app/actions/notifications";
import type { NotificationPreferenceView } from "@/lib/notifications/service";

const initialState: NotificationActionState = { ok: false };

const CATEGORY_ROWS: { key: keyof NotificationPreferenceView; label: string; hint: string }[] = [
  { key: "assignments", label: "الواجبات", hint: "نشر الواجبات، تذكير المواعيد، استلام التسليمات، الإرجاع والتقييم" },
  { key: "assessments", label: "الاختبارات", hint: "إتاحة الاختبارات وإعلان النتائج" },
  { key: "courses", label: "المقررات التدريبية", hint: "إكمال المقررات وتحديثات التقدم" },
  { key: "surveys", label: "الاستبيانات", hint: "دعوات الاستبيانات الصادرة لك" },
  { key: "followups", label: "المتابعات الميدانية", hint: "جدولة الزيارات وتحديثاتها ومشاركتها" },
  { key: "certificates", label: "الشهادات", hint: "إصدار الشهادات وإلغاؤها" },
  { key: "platform", label: "إشعارات المنصة", hint: "الأخبار والإعلانات على مستوى المنصة" },
];

function Toggle({
  name,
  checked,
  label,
  hint,
  locked,
}: {
  name: string;
  checked: boolean;
  label: string;
  hint?: string;
  locked?: boolean;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-3 rounded-xl border p-3 transition ${
        locked ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white hover:border-[#1D5BD6]/40"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {locked ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
            مُفعّل دائمًا
          </span>
        ) : (
          <>
            <input type="hidden" name={name} value="false" />
            <input
              type="checkbox"
              name={name}
              defaultChecked={checked}
              className="h-5 w-5 rounded border-slate-300 accent-[#1D5BD6]"
            />
          </>
        )}
      </span>
    </label>
  );
}

export function PreferencesForm({ preferences }: { preferences: NotificationPreferenceView }) {
  const [state, formAction, pending] = useActionState(
    async (prev: NotificationActionState, formData: FormData) =>
      updateNotificationPreferencesAction(prev, formData),
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          name="inAppEnabled"
          checked={preferences.inAppEnabled}
          label="الإشعارات داخل التطبيق"
          hint="إيقاف أي فئة أدناه يوقف إشعاراتها داخل التطبيق وبريدها معًا"
        />
        <Toggle
          name="emailEnabled"
          checked={preferences.emailEnabled}
          label="الإشعارات بالبريد الإلكتروني"
          hint="رسائل بريد اختيارية مرفقة بالإشعارات المفعّلة — رسائل الأمان تصل دائمًا"
        />
      </div>

      <div className="rounded-xl border border-slate-200">
        <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs font-bold text-slate-600">
          الفئات
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {CATEGORY_ROWS.map((row) => (
            <Toggle
              key={row.key}
              name={row.key}
              checked={Boolean(preferences[row.key])}
              label={row.label}
              hint={row.hint}
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
        <p className="text-sm font-bold text-emerald-800">رسائل الحساب والأمان</p>
        <p className="mt-1 text-xs leading-relaxed text-emerald-700">
          تأكيد البريد، إعادة تعيين كلمة المرور، وتنبيه تغيّر كلمة المرور — تُرسل دائمًا ولا يمكن تعطيلها
          لأنها مطلوبة لعمل الحساب بأمان.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#174aa8] disabled:opacity-60"
        >
          {pending ? "جارٍ الحفظ…" : "حفظ التفضيلات"}
        </button>
        {state.ok && state.message && (
          <p className="text-xs font-semibold text-emerald-600">{state.message}</p>
        )}
        {!state.ok && state.message && (
          <p className="text-xs font-semibold text-red-600">{state.message}</p>
        )}
      </div>
    </form>
  );
}
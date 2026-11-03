/**
 * Phase 11 — notification UI primitives (server-safe presentational).
 * Follows the project design system: slate neutrals + brand blue #1D5BD6,
 * RTL-first Arabic labels.
 */

import { NOTIFICATION_CATEGORY_CLASSES, NOTIFICATION_CATEGORY_LABELS, type NotificationCategory } from "@/config/notifications";

export function formatNotificationDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    numberingSystem: "latn",
  }).format(value);
}

export function CategoryChip({ category }: { category: string }) {
  const key = (Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[]).includes(
    category as NotificationCategory,
  )
    ? (category as NotificationCategory)
    : null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        key ? NOTIFICATION_CATEGORY_CLASSES[key] : "bg-slate-100 text-slate-600 border-slate-200"
      }`}
    >
      {key ? NOTIFICATION_CATEGORY_LABELS[key] : "إشعار"}
    </span>
  );
}

const EMAIL_CHIP_CLASSES: Record<string, string> = {
  QUEUED: "bg-amber-50 text-amber-700 border-amber-200",
  SENT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  DISABLED: "bg-slate-50 text-slate-500 border-slate-200",
};

const EMAIL_CHIP_LABELS: Record<string, string> = {
  QUEUED: "البريد: في الانتظار",
  SENT: "البريد: تم الإرسال",
  FAILED: "البريد: فشل الإرسال",
  DISABLED: "البريد: غير مطلوب",
};

/** Honest per-notification email status chip (null = no email involved). */
export function EmailStatusChip({ status }: { status: string | null }) {
  if (!status) return null;
  const classes = EMAIL_CHIP_CLASSES[status] ?? "bg-slate-100 text-slate-600 border-slate-200";
  const label = EMAIL_CHIP_LABELS[status] ?? "البريد";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${classes}`}>
      {label}
    </span>
  );
}
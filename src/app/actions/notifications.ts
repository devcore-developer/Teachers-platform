"use server";

/**
 * Phase 11 — notification server actions.
 *
 * Session-derived identity only (never payload-trusted); ownership is
 * re-enforced inside the service layer on every call. All actions return
 * a serializable state object for useActionState consumers.
 */

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import {
  markAllNotificationsRead,
  markNotificationRead,
  updatePreferences,
  type PreferencePatch,
} from "@/lib/notifications/service";

export interface NotificationActionState {
  ok: boolean;
  message?: string;
  changed?: number;
}

export async function markNotificationReadAction(
  _prev: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" };

  const notificationId = String(formData.get("notificationId") ?? "").trim();
  if (!notificationId) return { ok: false, message: "معرّف الإشعار مفقود" };

  const result = await markNotificationRead(user.id, notificationId);
  revalidatePath("/notifications");
  return {
    ok: true,
    changed: result.changed ? 1 : 0,
    message: result.changed ? "تم تحديد الإشعار كمقروء" : "الإشعار مقروء مسبقًا",
  };
}

export async function markAllNotificationsReadAction(
  _prev: NotificationActionState,
): Promise<NotificationActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" };

  const changed = await markAllNotificationsRead(user.id);
  revalidatePath("/notifications");
  return { ok: true, changed, message: changed > 0 ? `تم تحديد ${changed} إشعارًا كمقروء` : "لا توجد إشعارات غير مقروءة" };
}

const PREFERENCE_KEYS = [
  "inAppEnabled",
  "emailEnabled",
  "assignments",
  "assessments",
  "courses",
  "surveys",
  "followups",
  "certificates",
  "platform",
] as const;

export async function updateNotificationPreferencesAction(
  _prev: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "الجلسة منتهية — سجّل الدخول من جديد" };

  const patch: PreferencePatch = {};
  for (const key of PREFERENCE_KEYS) {
    const raw = formData.get(key);
    if (raw === "on" || raw === "true") patch[key] = true;
    else if (raw === "false" || raw === "off" || raw === "") patch[key] = false;
    // Absent checkboxes mean "off" for unchecked booleans — handled by
    // the hidden false input pattern in the form.
  }
  // Checkbox pattern: each toggle ships a hidden "false" input followed by
  // the checkbox; formData.getAll returns both — checkbox wins when on.
  for (const key of PREFERENCE_KEYS) {
    const values = formData.getAll(key).map(String);
    if (values.includes("on")) patch[key] = true;
    else if (values.length > 0) patch[key] = false;
  }

  await updatePreferences(user.id, patch);
  revalidatePath("/notifications/preferences");
  return { ok: true, message: "تم حفظ تفضيلات الإشعارات" };
}
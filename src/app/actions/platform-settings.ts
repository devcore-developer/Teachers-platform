"use server";

/**
 * Batch 3 — platform settings mutation (SUPER_ADMIN only).
 *
 * The acting user is always re-read from the session on the server; a
 * client can never widen its role. Values are validated with Zod before
 * touching SystemSetting, and credentials/tokens never pass through
 * this action.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import {
  PLATFORM_SETTING_KEYS,
  savePlatformSetting,
} from "@/lib/platform-settings";

const platformSettingsSchema = z.object({
  platformName: z.string().trim().min(2, "اسم المنصة مطلوب (حرفان على الأقل)").max(60),
  platformTagline: z.string().trim().max(120).optional(),
  supportEmail: z
    .union([z.literal(""), z.string().email("صيغة البريد الإلكتروني غير صحيحة")])
    .optional(),
  activeAcademicYear: z.string().trim().max(20).optional(),
});

export interface PlatformSettingsState {
  ok: boolean;
  message?: string;
  fieldErrors?: Partial<Record<"platformName" | "supportEmail", string>>;
}

export async function updatePlatformSettings(
  _prevState: PlatformSettingsState,
  formData: FormData
): Promise<PlatformSettingsState> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") {
    return {
      ok: false,
      message: "إعدادات المنصة متاحة لمدير المنصة فقط",
    };
  }

  const parsed = platformSettingsSchema.safeParse({
    platformName: formData.get("platformName") ?? "",
    platformTagline: formData.get("platformTagline") ?? "",
    supportEmail: formData.get("supportEmail") ?? "",
    activeAcademicYear: formData.get("activeAcademicYear") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: PlatformSettingsState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "platformName" || field === "supportEmail") {
        fieldErrors[field] = issue.message;
      }
    }
    return { ok: false, message: "تحقق من الحقول المطلوبة", fieldErrors };
  }

  try {
    await savePlatformSetting(
      PLATFORM_SETTING_KEYS.platformName,
      parsed.data.platformName
    );
    await savePlatformSetting(
      PLATFORM_SETTING_KEYS.platformTagline,
      parsed.data.platformTagline ?? ""
    );
    await savePlatformSetting(
      PLATFORM_SETTING_KEYS.supportEmail,
      parsed.data.supportEmail ?? ""
    );
    await savePlatformSetting(
      PLATFORM_SETTING_KEYS.activeAcademicYear,
      parsed.data.activeAcademicYear ?? ""
    );
  } catch {
    return { ok: false, message: "تعذر حفظ الإعدادات — أعد المحاولة" };
  }

  revalidatePath("/settings");
  return { ok: true, message: "تم حفظ إعدادات المنصة وتطبيقها" };
}
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared field rules for user-related schemas.                        */
/* Kept identical to the rules in validation/auth.ts so behavior is    */
/* uniform across the authentication and user-management modules.      */
/* ------------------------------------------------------------------ */

/** Normalize an email address for storage and lookups. */
export function normalizeUserEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function emailFieldRules() {
  return z
    .string({ message: "البريد الإلكتروني مطلوب" })
    .trim()
    .min(3, "البريد الإلكتروني مطلوب")
    .max(254, "البريد الإلكتروني طويل جدًا")
    .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: "صيغة البريد الإلكتروني غير صحيحة",
    })
    .transform(normalizeUserEmail);
}

export function nameFieldRules() {
  return z
    .string({ message: "الاسم مطلوب" })
    .trim()
    .min(2, "الاسم يجب ألا يقل عن حرفين")
    .max(120, "الاسم طويل جدًا (الحد الأقصى 120 حرفًا)");
}

/** Shared password policy: 8+ chars, at least one letter and one digit. */
export function passwordFieldRules() {
  return z
    .string({ message: "كلمة المرور مطلوبة" })
    .min(8, "كلمة المرور يجب ألا تقل عن 8 أحرف")
    .max(128, "كلمة المرور طويلة جدًا (الحد الأقصى 128 حرفًا)")
    .refine((v) => /\p{L}/u.test(v) && /\d/.test(v), {
      message: "كلمة المرور يجب أن تحتوي على حرف واحد ورقم واحد على الأقل",
    });
}
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Authentication & account validation schemas (Zod v4, same style as   */
/* src/lib/validation/schools.ts). All server-side entry points parse   */
/* their input through these schemas — never trust the client.          */
/* ------------------------------------------------------------------ */

/** Normalize an email address for storage and lookups. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const emailField = z
  .string({ message: "البريد الإلكتروني مطلوب" })
  .trim()
  .min(3, "البريد الإلكتروني مطلوب")
  .max(254, "البريد الإلكتروني طويل جدًا")
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: "صيغة البريد الإلكتروني غير صحيحة",
  })
  .transform(normalizeEmail);

const nameField = z
  .string({ message: "الاسم مطلوب" })
  .trim()
  .min(2, "الاسم يجب ألا يقل عن حرفين")
  .max(120, "الاسم طويل جدًا (الحد الأقصى 120 حرفًا)");

/** Shared password policy: 8+ chars, at least one letter and one digit. */
const passwordField = z
  .string({ message: "كلمة المرور مطلوبة" })
  .min(8, "كلمة المرور يجب ألا تقل عن 8 أحرف")
  .max(128, "كلمة المرور طويلة جدًا (الحد الأقصى 128 حرفًا)")
  .refine((v) => /\p{L}/u.test(v) && /\d/.test(v), {
    message: "كلمة المرور يجب أن تحتوي على حرف واحد ورقم واحد على الأقل",
  });

/* ------------------------------- Login ---------------------------- */

export const loginSchema = z.object({
  email: emailField,
  password: z.string({ message: "كلمة المرور مطلوبة" }).min(1, "كلمة المرور مطلوبة"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/* -------------------- Teacher self-registration ------------------- */

export const teacherRegistrationSchema = z
  .object({
    /** The registration link's school slug — re-validated on the server. */
    slug: z.string().trim().min(1, "رابط التسجيل غير صالح"),
    name: nameField,
    email: emailField,
    password: passwordField,
    confirmPassword: z.string({ message: "تأكيد كلمة المرور مطلوب" }),
    /** Optional home branch — must belong to the registration school. */
    branchId: z
      .string()
      .trim()
      .max(64)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "كلمتا المرور غير متطابقتين",
    path: ["confirmPassword"],
  });

export type TeacherRegistrationInput = z.infer<typeof teacherRegistrationSchema>;

/* --------------------------- Password reset ----------------------- */

export const forgotPasswordSchema = z.object({ email: emailField });

export const passwordResetSchema = z
  .object({
    token: z.string().trim().min(1, "رابط إعادة التعيين غير صالح"),
    password: passwordField,
    confirmPassword: z.string({ message: "تأكيد كلمة المرور مطلوب" }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "كلمتا المرور غير متطابقتين",
    path: ["confirmPassword"],
  });

export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

/* ------------------ Platform account management ------------------- */

/**
 * Office-manager provisioning schema. NOTE: the role is intentionally
 * ABSENT from the input — the service layer forces it to
 * DEVELOPMENT_OFFICE_MANAGER so no public or admin form can ever create
 * a SUPER_ADMIN or choose a role.
 */
export const createOfficeManagerSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
  schoolId: z.string().trim().min(1, "يجب اختيار المدرسة"),
});

export type CreateOfficeManagerInput = z.infer<typeof createOfficeManagerSchema>;

/* --------------------------- Result helper ------------------------ */

/** Same uniform shape as the schools module ServiceResult. */
export type AuthResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** Arabic, user-facing error message. */
      message: string;
      fieldErrors?: Record<string, string>;
      code?:
        | "VALIDATION_ERROR"
        | "INVALID_CREDENTIALS"
        | "INACTIVE"
        | "EMAIL_NOT_VERIFIED"
        | "RATE_LIMITED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "REGISTRATION_CLOSED"
        | "TOKEN_INVALID"
        | "TOKEN_USED"
        | "TOKEN_EXPIRED";
    };

export function zodAuthFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}
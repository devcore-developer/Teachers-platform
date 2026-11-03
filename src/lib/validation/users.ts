import { z } from "zod";

import {
  emailFieldRules,
  nameFieldRules,
  passwordFieldRules,
} from "@/lib/validation/user-fields";

/* ------------------------------------------------------------------ */
/* Phase 4 — user directory, assignments & account management schemas. */
/* Same conventions as validation/auth.ts and validation/schools.ts.    */
/* All server-side entry points parse input through these schemas —    */
/* never trust the client.                                             */
/* ------------------------------------------------------------------ */

/** Rows per page for the user directory (server-enforced). */
export const USERS_PAGE_SIZE = 10;

/** Roles that can be filtered on in the directory (all five). */
export const DIRECTORY_ROLE_FILTER = [
  "SUPER_ADMIN",
  "DEVELOPMENT_OFFICE_MANAGER",
  "EDUCATIONAL_DEPUTY",
  "EDUCATIONAL_SUPERVISOR",
  "TEACHER",
] as const;

/**
 * Roles an administrative actor may create via the staff-account flow.
 * SUPER_ADMIN and DEVELOPMENT_OFFICE_MANAGER are intentionally ABSENT:
 *   - no public or school-level form can create a SUPER_ADMIN;
 *   - office managers are provisioned exclusively by the SUPER_ADMIN
 *     through the existing /admin/accounts flow.
 */
export const STAFF_CREATABLE_ROLES = [
  "EDUCATIONAL_SUPERVISOR",
  "EDUCATIONAL_DEPUTY",
  "TEACHER",
] as const;

export type StaffCreatableRole = (typeof STAFF_CREATABLE_ROLES)[number];

/* ----------------------------- Directory --------------------------- */

export const directoryQuerySchema = z.object({
  /** Free-text search over name and email (server applies contains). */
  q: z
    .string()
    .trim()
    .max(120, "نص البحث طويل جدًا")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  role: z
    .enum([...DIRECTORY_ROLE_FILTER, "ALL"], { message: "تصفية الدور غير صالحة" })
    .optional()
    .transform((v) => (v && v !== "ALL" ? v : undefined)),
  schoolId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  branchId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  status: z
    .enum(["ALL", "ACTIVE", "INACTIVE"], { message: "تصفية الحالة غير صالحة" })
    .optional()
    .transform((v) => (v && v !== "ALL" ? v : undefined)),
  page: z.coerce
    .number({ message: "رقم الصفحة غير صالح" })
    .int()
    .min(1, "رقم الصفحة غير صالح")
    .max(100000)
    .default(1),
});

export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;

/* ------------------------- Staff account creation ------------------ */

/**
 * School staff account creation. The school is FORCED server-side from
 * the actor's context (office manager) or an explicit validated param
 * (SUPER_ADMIN) — the client never decides the tenant. The role comes
 * from a strict whitelist that excludes SUPER_ADMIN entirely.
 */
export const staffAccountSchema = z.object({
  name: nameFieldRules(),
  email: emailFieldRules(),
  password: passwordFieldRules(),
  role: z.enum(STAFF_CREATABLE_ROLES, {
    message: "اختر دورًا من الأدوار المتاحة",
  }),
  /** Optional home branch — validated against the target school. */
  branchId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  /** Only used (and re-validated) when the actor is SUPER_ADMIN. */
  schoolId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export type StaffAccountInput = z.infer<typeof staffAccountSchema>;

/* --------------------------- Profile updates ----------------------- */

/** Administrative profile edit: display name + branch assignment ONLY. */
export const adminProfileUpdateSchema = z.object({
  userId: z.string().trim().min(1, "معرّف المستخدم مطلوب"),
  name: nameFieldRules(),
  /**
   * undefined = keep the current branch (field not sent);
   * ""       = clear the branch assignment;
   * id        = assign this branch (validated against the user's school).
   * Preserving the assignment when the field is absent protects records
   * from accidental data loss on partial updates.
   */
  branchId: z.string().trim().max(64).optional(),
});

/**
 * Self-service profile edit. The schema physically contains ONLY the
 * display name — role, school, branch, supervisor and account state are
 * structurally impossible to change through this path.
 */
export const ownProfileUpdateSchema = z.object({
  name: nameFieldRules(),
});

/* ----------------------------- Assignments ------------------------- */

/** Replace a supervisor's branch scope (whole-list replace, transactional). */
export const supervisorBranchesSchema = z.object({
  supervisorId: z.string().trim().min(1, "معرّف المشرف مطلوب"),
  branchIds: z
    .array(z.string().trim().min(1))
    .max(100, "عدد الفروع كبير جدًا")
    .default([]),
});

/** Assign (or re-assign) a teacher's current supervisor. */
export const teacherSupervisorSchema = z.object({
  teacherId: z.string().trim().min(1, "معرّف المعلم مطلوب"),
  supervisorId: z.string().trim().min(1, "معرّف المشرف مطلوب"),
});

export const removeTeacherSupervisorSchema = z.object({
  teacherId: z.string().trim().min(1, "معرّف المعلم مطلوب"),
});

/**
 * Deputy read scope: either the whole school or an explicit branch list.
 * The school is always derived from the deputy's own account server-side.
 */
export const deputyScopeSchema = z.object({
  deputyId: z.string().trim().min(1, "معرّف الوكيل مطلوب"),
  mode: z.enum(["school", "branches"], {
    message: "اختر نطاق الاطلاع",
  }),
  branchIds: z
    .array(z.string().trim().min(1))
    .max(100, "عدد الفروع كبير جدًا")
    .default([]),
});

/* --------------------------- Result helper ------------------------- */

/** Same uniform shape as the schools module ServiceResult. */
export type UsersServiceResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** Arabic, user-facing error message. */
      message: string;
      fieldErrors?: Record<string, string>;
      code?:
        | "VALIDATION_ERROR"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "RELATION_ERROR"
        | "DUPLICATE_EMAIL";
    };

export function zodUsersFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}
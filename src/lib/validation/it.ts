import { z } from "zod";

import {
  zodUsersFieldErrors,
  type UsersServiceResult,
} from "@/lib/validation/users";

/* ------------------------------------------------------------------ */
/* IT_COORDINATOR workspace schemas.                                    */
/*                                                                      */
/* The coordinator has exactly TWO capabilities — teacher→supervisor    */
/* assignments and teacher account recovery — both structurally         */
/* confined to the coordinator's own school by the service layer.       */
/* These schemas follow the same conventions as validation/users.ts.    */
/* ------------------------------------------------------------------ */

/** Rows per page for the IT assignment table (server-enforced). */
export const IT_PAGE_SIZE = 12;

/** Assignment-status filter for the IT teacher list. */
export const IT_ASSIGNMENT_STATUS_FILTER = ["ALL", "ASSIGNED", "UNASSIGNED"] as const;

export const itTeacherQuerySchema = z.object({
  /** Free-text search over teacher name and email (server applies contains). */
  q: z
    .string()
    .trim()
    .max(120, "نص البحث طويل جدًا")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  branchId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  status: z
    .enum(IT_ASSIGNMENT_STATUS_FILTER, { message: "تصفية الإسناد غير صالحة" })
    .optional()
    .transform((v) => (v && v !== "ALL" ? v : undefined)),
  page: z.coerce
    .number({ message: "رقم الصفحة غير صالح" })
    .int()
    .min(1, "رقم الصفحة غير صالح")
    .max(100000)
    .default(1),
});

export type ItTeacherQuery = z.infer<typeof itTeacherQuerySchema>;

/**
 * Assign (or transfer) a teacher's supervisor. Same shape as the admin
 * directory schema — intentionally reused so both entry points validate
 * identically.
 */
export const itAssignTeacherSchema = z.object({
  teacherId: z.string().trim().min(1, "معرّف المعلم مطلوب"),
  supervisorId: z.string().trim().min(1, "معرّف المشرف مطلوب"),
});

/** Remove a teacher's current supervisor. */
export const itRemoveTeacherSchema = z.object({
  teacherId: z.string().trim().min(1, "معرّف المعلم مطلوب"),
});

/** Issue a recovery link for one teacher of the coordinator's school. */
export const itRecoverySchema = z.object({
  teacherId: z.string().trim().min(1, "معرّف المعلم مطلوب"),
});

export type ItServiceResult<T> = UsersServiceResult<T>;

export { zodUsersFieldErrors };
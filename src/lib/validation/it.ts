
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* IT coordinator workspace validation schemas (Zod v4, same style as   */
/* src/lib/validation/auth.ts). Every IT server entry point parses its  */
/* input here first — the DB is always re-verified for existence and    */
/* school scope inside the service layer.                               */
/* ------------------------------------------------------------------ */

/** Internal record id (cuid) — length-bounded; existence is DB-checked. */
const idField = z
  .string({ message: "المعرّف مطلوب" })
  .trim()
  .min(10, "معرّف غير صالح")
  .max(64, "معرّف غير صالح");

/** Teacher list filters for the IT support views. */
export const itTeacherQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["all", "assigned", "unassigned"]).default("all"),
});

export type ItTeacherQuery = z.infer<typeof itTeacherQuerySchema>;

/** Assign (or reassign) a teacher of the IT coordinator's school. */
export const assignTeacherSchema = z.object({
  teacherId: idField,
  supervisorId: idField,
});

export type AssignTeacherInput = z.infer<typeof assignTeacherSchema>;

/** Remove a teacher's current assignment (same school only). */
export const unassignTeacherSchema = z.object({
  teacherId: idField,
});

export type UnassignTeacherInput = z.infer<typeof unassignTeacherSchema>;

/** Initiate the secure recovery flow for one teacher of the school. */
export const initiateRecoverySchema = z.object({
  teacherId: idField,
});

export type InitiateRecoveryInput = z.infer<typeof initiateRecoverySchema>;

/* --------------------------- Result helper ------------------------ */

/** Same uniform shape as the auth module's ServiceResult. */
export type ItResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** Arabic, user-facing error message. */
      message: string;
      fieldErrors?: Record<string, string>;
      code?: "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND";
    };
import { z } from "zod";

import {
  zodUsersFieldErrors,
  type UsersServiceResult,
} from "@/lib/validation/users";

/* ------------------------------------------------------------------ */
/* Registration-link management schemas (Development Office Manager).   */
/* Same conventions as the other validation modules: every server entry  */
/* point parses its input here — never trust the client.                 */
/* ------------------------------------------------------------------ */

/**
 * Optional expiry for a registration link, in days. Null/undefined means
 * "valid until revoked" — the default product behavior.
 */
export const REGISTRATION_LINK_EXPIRY_OPTIONS = [7, 30, 90] as const;

export const registrationLinkCreateSchema = z.object({
  /**
   * SUPER_ADMIN may target an explicit school; office/school managers
   * have their school forced from the session and this field is ignored.
   */
  schoolId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  expiresInDays: z
    .union([
      z.literal(""),
      z.coerce
        .number()
        .int()
        .refine(
          (v) => (REGISTRATION_LINK_EXPIRY_OPTIONS as readonly number[]).includes(v),
          { message: "مدة صلاحية الرابط غير مدعومة" }
        ),
    ])
    .optional()
    .transform((v) => (typeof v === "number" ? v : undefined)),
});

export type RegistrationLinkCreateInput = z.infer<
  typeof registrationLinkCreateSchema
>;

export const registrationLinkRevokeSchema = z.object({
  linkId: z.string().trim().min(1, "معرّف الرابط مطلوب"),
});

export type RegistrationLinkRevokeInput = z.infer<
  typeof registrationLinkRevokeSchema
>;

/** Reuse the platform's uniform service-result shape. */
export type RegistrationLinkServiceResult<T> = UsersServiceResult<T>;

export { zodUsersFieldErrors };
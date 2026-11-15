"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { requireAdminContext, type AdminContext } from "@/lib/auth/dev-admin";
import {
  createRegistrationLink,
  registrationLinkUrl,
  revokeRegistrationLink,
} from "@/lib/registration-links/service";

/* ------------------------------------------------------------------ */
/* Registration-link management actions (Development Office Manager).   */
/* Thin wrappers: context comes from the session, tenant scope and all  */
/* rules live in the service layer. The raw token appears ONLY in the   */
/* creation response — it is never logged and never stored in clear.    */
/* ------------------------------------------------------------------ */

export interface RegistrationLinkActionState {
  ok: boolean;
  message?: string;
  /** Creation only — the copyable URL, shown exactly once. */
  linkUrl?: string;
  expiresAt?: string | null;
  code?: string;
}

/** Absolute app base URL from request headers (no env needed). */
async function appBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

async function actor(): Promise<AdminContext> {
  return requireAdminContext();
}

export async function createRegistrationLinkAction(
  _prevState: RegistrationLinkActionState | null,
  formData: FormData
): Promise<RegistrationLinkActionState> {
  const ctx = await actor();

  const result = await createRegistrationLink(ctx, {
    schoolId: String(formData.get("schoolId") ?? ""),
    expiresInDays: String(formData.get("expiresInDays") ?? ""),
  });

  if (!result.ok) {
    return { ok: false, message: result.message, code: result.code };
  }

  revalidatePath("/registration-links");

  return {
    ok: true,
    message: "تم توليد رابط التسجيل — انسخه الآن، فلن يُعرض مرة أخرى",
    linkUrl: registrationLinkUrl(await appBaseUrl(), result.data.rawToken),
    expiresAt: result.data.expiresAt?.toISOString() ?? null,
  };
}

export async function revokeRegistrationLinkAction(
  _prevState: RegistrationLinkActionState | null,
  formData: FormData
): Promise<RegistrationLinkActionState> {
  const ctx = await actor();

  const result = await revokeRegistrationLink(ctx, {
    linkId: String(formData.get("linkId") ?? ""),
  });

  if (!result.ok) {
    return { ok: false, message: result.message, code: result.code };
  }

  revalidatePath("/registration-links");

  return {
    ok: true,
    message:
      "تم إلغاء الرابط — لن يُقبل أي تسجيل جديد عبره، وحسابات المعلمين المسجلة سابقًا لم تتأثر",
  };
}
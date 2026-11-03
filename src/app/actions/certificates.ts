"use server";

/**
 * Phase 8 — thin "use server" wrappers around the certificate service.
 *
 * Every wrapper resolves the actor from the SESSION (never from the
 * payload): the current user is narrowed to an explicit role literal
 * before it is passed on as a CertificateActor. The service
 * re-validates role/tenant/eligibility again on its own — these
 * wrappers only adapt FormData payloads and trigger revalidation.
 */
import { revalidatePath } from "next/cache";

import type { CertificateActor, CertificateViewer } from "@/lib/certificates/access";
import { issueCertificate, revokeCertificate } from "@/lib/certificates/service";
import { getCurrentUser } from "@/lib/auth/session";

/* ------------------------------------------------------------------ */
/* Serializable action state (no Dates cross the RSC boundary)          */
/* ------------------------------------------------------------------ */

export interface CertificateActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  code?: string;
  data?: {
    id?: string;
    status?: string;
    certificateNumber?: string;
    verificationCode?: string;
  };
}

function failure(
  message: string,
  code: string,
  fieldErrors?: Record<string, string>
): CertificateActionState {
  return { ok: false, message, code, fieldErrors };
}

/* ------------------------------------------------------------------ */
/* FormData helpers                                                     */
/* ------------------------------------------------------------------ */

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Office-manager actor for issuance/revocation. Built ONLY from the
 * session user after an explicit role check — client payloads can
 * never widen it.
 */
async function officeActor(): Promise<CertificateActor | null> {
  const user = await getCurrentUser();
  if (!user || user.role !== "DEVELOPMENT_OFFICE_MANAGER" || !user.schoolId) {
    return null;
  }
  return { id: user.id, role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: user.schoolId };
}

/**
 * Full viewer projection (any authenticated role incl. TEACHER) for
 * pages/actions whose authorization is ownership-or-scope based and is
 * re-enforced inside the service.
 */
export async function certificateViewer(): Promise<CertificateViewer | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, role: user.role, schoolId: user.schoolId };
}

function revalidateCertificates(certificateId?: string): void {
  revalidatePath("/certificates");
  revalidatePath("/certificates/issue");
  revalidatePath("/my-certificates");
  if (certificateId) revalidatePath(`/certificates/${certificateId}`);
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

export async function issueCertificateAction(
  _prev: CertificateActionState,
  formData: FormData
): Promise<CertificateActionState> {
  try {
    const ctx = await officeActor();
    if (!ctx) {
      return failure("إصدار الشهادات متاح لمديري مكاتب التطوير فقط", "FORBIDDEN");
    }
    const result = await issueCertificate(ctx, {
      teacherId: str(formData, "teacherId"),
      contentType: str(formData, "contentType"),
      contentId: str(formData, "contentId"),
      titleAr: str(formData, "titleAr"),
      titleEn: str(formData, "titleEn"),
      descriptionAr: str(formData, "descriptionAr"),
      descriptionEn: str(formData, "descriptionEn"),
      expiresAt: str(formData, "expiresAt"),
    });
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateCertificates(result.data.id);
    return {
      ok: true,
      data: {
        id: result.data.id,
        status: result.data.status,
        certificateNumber: result.data.certificateNumber,
        verificationCode: result.data.verificationCode,
      },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function revokeCertificateAction(
  _prev: CertificateActionState,
  formData: FormData
): Promise<CertificateActionState> {
  try {
    const ctx = await officeActor();
    if (!ctx) {
      return failure("إلغاء الشهادات متاح لمديري مكاتب التطوير فقط", "FORBIDDEN");
    }
    const result = await revokeCertificate(ctx, {
      certificateId: str(formData, "certificateId"),
      reason: str(formData, "reason"),
    });
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateCertificates(result.data.id);
    return { ok: true, data: { id: result.data.id, status: result.data.status } };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}
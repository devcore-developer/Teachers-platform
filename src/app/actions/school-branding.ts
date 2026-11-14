"use server";

import { revalidatePath } from "next/cache";
import { promises as fs } from "fs";
import path from "path";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveManageableSchoolId } from "@/lib/branding";
import {
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  logoExtensionFor,
  schoolBrandingSchema,
} from "@/lib/branding/validation";
import {
  PRESIGN_PUT_EXPIRES_SECONDS,
  readR2Config,
} from "@/lib/media/config";
import {
  headObject,
  MediaStorageError,
  presignedPutUrl,
  publicUrlFor,
} from "@/lib/media/r2";
import { releaseMediaIfUnreferenced } from "@/lib/media/references";

/* ------------------------------------------------------------------ */
/* Server actions for school branding management.                       */
/*                                                                      */
/* Authorization is resolved from the SESSION on every call:            */
/*   • SUPER_ADMIN  → any school (explicit schoolId allowed).           */
/*   • DEVELOPMENT_OFFICE_MANAGER → their own school ONLY; a client     */
/*     hint pointing at another tenant is a hard rejection.             */
/*   • everyone else → fail-closed rejection.                           */
/*                                                                      */
/* Logo storage — two honest paths:                                     */
/*   1. CLOUD (production): when the R2 environment is configured the   */
/*      logo rides the SAME presigned direct-upload pipeline as every   */
/*      other media file (request URL → browser PUT → server-side HEAD  */
/*      verification → DB commit). File bytes never pass through a      */
/*      server action, so the 1MB action-body limit stops mattering.    */
/*      The object lives under media/school-<id>/branding/ — inside the */
/*      tenant scope the media system already owns.                     */
/*   2. LOCAL (dev / no R2 yet): the legacy public/uploads write.       */
/*      requestSchoolLogoUploadAction reports mode:"local" and the      */
/*      client falls back to uploadSchoolLogoAction. On a read-only     */
/*      production filesystem that fallback fails HONESTLY and the      */
/*      real error is logged server-side instead of being swallowed.    */
/* ------------------------------------------------------------------ */

export interface BrandingActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Updated logo URL after a successful upload (upload action). */
  logoUrl?: string | null;
}

/** Refresh every route that renders branding (the shell reads it at the
 * root layout, so a layout-level revalidate reaches the whole app). */
function revalidateBrandingPaths(schoolId?: string | null) {
  revalidatePath("/", "layout");
  revalidatePath("/login");
  revalidatePath("/schools/branding");
  if (schoolId) revalidatePath(`/schools/${schoolId}`);
}

/* ------------------------------------------------------------------ */
/* Shared branding auth — resolves the actionable school or rejects.    */
/* ------------------------------------------------------------------ */

async function resolveBrandingTarget(requested: string) {
  const user = await getCurrentUser();
  const target = resolveManageableSchoolId(
    user ? { role: user.role, schoolId: user.schoolId } : null,
    requested
  );
  if (!target.ok) {
    return {
      ok: false as const,
      message:
        target.code === "TENANT_MISMATCH"
          ? "لا يمكنك تعديل هوية مدرسة أخرى."
          : "لا تملك صلاحية إدارة هوية المدرسة.",
    };
  }
  if (!target.schoolId) {
    return { ok: false as const, message: "اختر المدرسة أولًا ثم ارفع الشعار." };
  }
  return { ok: true as const, schoolId: target.schoolId };
}

function logoMimeTypeOk(mimeType: string): boolean {
  return (LOGO_MIME_TYPES as readonly string[]).includes(mimeType);
}

/* ------------------------------------------------------------------ */
/* Logo upload — step 1: request a presigned URL (or report local).     */
/* ------------------------------------------------------------------ */

export type RequestSchoolLogoResult =
  | {
      ok: true;
      mode: "cloud";
      uploadUrl: string;
      key: string;
      publicUrl: string;
      expiresIn: number;
    }
  | { ok: true; mode: "local" }
  | { ok: false; message: string };

export async function requestSchoolLogoUploadAction(
  schoolIdHint: string,
  mimeType: string,
  sizeBytes: number
): Promise<RequestSchoolLogoResult> {
  const target = await resolveBrandingTarget(schoolIdHint);
  if (!target.ok) return { ok: false, message: target.message };
  const schoolId = target.schoolId;

  if (!logoMimeTypeOk(mimeType)) {
    return {
      ok: false,
      message: "الصيغ المدعومة: PNG أو JPG أو WEBP (لا يُسمح بـ SVG).",
    };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, message: "اختر ملف شعار صالحًا." };
  }
  if (sizeBytes > LOGO_MAX_BYTES) {
    return { ok: false, message: "الحد الأقصى لحجم الشعار 2 ميجابايت." };
  }

  // No R2 environment yet — report the local disk path so development
  // keeps working unchanged. The caller falls back to the legacy action.
  const cfg = readR2Config();
  if (!cfg) return { ok: true, mode: "local" };

  const ext = logoExtensionFor(mimeType);
  if (!ext) return { ok: false, message: "صيغة الملف غير مدعومة." };

  // Tenant-scoped branding key — same media/school-<id>/ scope the media
  // system owns, so reference-counted cleanup sees it as managed media.
  const key = `media/school-${schoolId}/branding/logo-${Date.now()}.${ext}`;

  try {
    const uploadUrl = await presignedPutUrl(key, mimeType);
    return {
      ok: true,
      mode: "cloud",
      uploadUrl,
      key,
      publicUrl: publicUrlFor(key),
      expiresIn: PRESIGN_PUT_EXPIRES_SECONDS,
    };
  } catch (error) {
    if (error instanceof MediaStorageError) {
      return { ok: false, message: "تعذر الاتصال بخدمة التخزين — حاول لاحقًا." };
    }
    return { ok: false, message: "تعذر تجهيز الرفع — حاول مرة أخرى." };
  }
}

/* ------------------------------------------------------------------ */
/* Logo upload — step 2: verify on storage and commit to the school.    */
/* ------------------------------------------------------------------ */

export interface CommitSchoolLogoInput {
  schoolIdHint: string;
  key: string;
  mimeType: string;
}

export async function commitSchoolLogoUploadAction(
  input: CommitSchoolLogoInput
): Promise<BrandingActionState> {
  const target = await resolveBrandingTarget(input.schoolIdHint);
  if (!target.ok) return { ok: false, message: target.message };
  const schoolId = target.schoolId;

  // The key must be a branding object of THE resolved school — a client
  // pointing at another tenant's key (or any non-branding key) is rejected.
  const key = String(input.key ?? "");
  if (!key.startsWith(`media/school-${schoolId}/branding/logo-`)) {
    return { ok: false, message: "لا تملك صلاحية تأكيد هذا الملف." };
  }
  if (!logoMimeTypeOk(input.mimeType)) {
    return { ok: false, message: "صيغة الملف غير مدعومة على الخادم." };
  }

  try {
    // Never trust the client's word that the upload happened: HEAD the
    // object and enforce the size ceiling server-side.
    let info;
    try {
      info = await headObject(key);
    } catch (error) {
      if (error instanceof MediaStorageError && error.code === "R2_NOT_CONFIGURED") {
        return {
          ok: false,
          message:
            "خدمة الرفع السحابي غير مُهيأة على الخادم — أضف متغيرات Cloudflare R2 (R2_ACCOUNT_ID وR2_ACCESS_KEY_ID وR2_SECRET_ACCESS_KEY وR2_BUCKET_NAME) ثم أعد النشر.",
        };
      }
      return { ok: false, message: "تعذر التحقق من الشعار على التخزين." };
    }
    if (!info) {
      return { ok: false, message: "لم نجد الشعار على التخزين — أعد المحاولة." };
    }
    if (info.sizeBytes > LOGO_MAX_BYTES) {
      return { ok: false, message: "حجم الشعار الفعلي يتجاوز الحد الأقصى (2 ميجابايت)." };
    }

    const publicUrl = publicUrlFor(key);

    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { logoUrl: true },
    });

    await db.school.update({ where: { id: schoolId }, data: { logoUrl: publicUrl } });

    // Best-effort cleanup of the replaced logo — legacy disk files are
    // unlinked, old R2 objects go through reference-safe release.
    const previous = school?.logoUrl;
    if (previous && previous.startsWith(`/uploads/schools/${schoolId}/`)) {
      try {
        await fs.unlink(path.join(process.cwd(), "public", previous));
      } catch {
        // the old file may already be gone — never fail the upload for it
      }
    }
    try {
      await releaseMediaIfUnreferenced(previous);
    } catch {
      // Orphan cleanup is retried by maintenance; never block the save.
    }

    revalidateBrandingPaths(schoolId);
    return { ok: true, logoUrl: publicUrl, message: "تم رفع الشعار وحفظه." };
  } catch (error) {
    console.error("[school-branding] logo commit failed:", error);
    return { ok: false, message: "تعذر حفظ الشعار على الخادم — حاول مرة أخرى." };
  }
}

/* ------------------------------------------------------------------ */
/* Logo upload — legacy local-disk fallback (dev / no R2 configured).   */
/* ------------------------------------------------------------------ */

export async function uploadSchoolLogoAction(
  _prevState: BrandingActionState | null,
  formData: FormData
): Promise<BrandingActionState> {
  const user = await getCurrentUser();
  const requested = String(formData.get("schoolId") ?? "");
  const target = resolveManageableSchoolId(
    user ? { role: user.role, schoolId: user.schoolId } : null,
    requested
  );
  if (!target.ok) {
    return {
      ok: false,
      message:
        target.code === "TENANT_MISMATCH"
          ? "لا يمكنك تعديل هوية مدرسة أخرى."
          : "لا تملك صلاحية إدارة هوية المدرسة.",
    };
  }
  if (!target.schoolId) {
    return { ok: false, message: "اختر المدرسة أولًا ثم ارفع الشعار." };
  }
  const schoolId = target.schoolId;

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, fieldErrors: { logo: "اختر ملف شعار صالحًا." } };
  }
  if (!logoMimeTypeOk(file.type)) {
    return {
      ok: false,
      fieldErrors: { logo: "الصيغ المدعومة: PNG أو JPG أو WEBP (لا يُسمح بـ SVG)." },
    };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { ok: false, fieldErrors: { logo: "الحد الأقصى لحجم الشعار 2 ميجابايت." } };
  }

  const ext = logoExtensionFor(file.type);
  if (!ext) return { ok: false, fieldErrors: { logo: "صيغة الملف غير مدعومة." } };

  try {
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { logoUrl: true },
    });

    const dir = path.join(process.cwd(), "public", "uploads", "schools", schoolId);
    await fs.mkdir(dir, { recursive: true });
    const fileName = `logo-${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(dir, fileName), buffer);

    const logoUrl = `/uploads/schools/${schoolId}/${fileName}`;

    // Best-effort cleanup of the previous locally-stored logo.
    const previous = school?.logoUrl;
    if (previous && previous.startsWith(`/uploads/schools/${schoolId}/`)) {
      try {
        await fs.unlink(path.join(process.cwd(), "public", previous));
      } catch {
        // the old file may already be gone — never fail the upload for it
      }
    }

    await db.school.update({ where: { id: schoolId }, data: { logoUrl } });
    revalidateBrandingPaths(schoolId);
    return { ok: true, logoUrl, message: "تم رفع الشعار وحفظه." };
  } catch (error) {
    // The real cause (permissions / read-only FS / DB) is now visible in
    // the server terminal instead of being swallowed by a bare catch.
    console.error("[school-branding] local logo save failed:", error);
    return { ok: false, message: "تعذر حفظ الشعار على الخادم — حاول مرة أخرى." };
  }
}

/* ------------------------------------------------------------------ */
/* Save branding (name, tagline, palette)                               */
/* ------------------------------------------------------------------ */

export async function saveSchoolBrandingAction(
  _prevState: BrandingActionState | null,
  formData: FormData
): Promise<BrandingActionState> {
  const user = await getCurrentUser();

  const parsed = schoolBrandingSchema.safeParse({
    schoolId: String(formData.get("schoolId") ?? "") || undefined,
    nameAr: String(formData.get("nameAr") ?? "").trim() || undefined,
    tagline: String(formData.get("tagline") ?? "").trim(),
    primary: String(formData.get("primary") ?? ""),
    secondary: String(formData.get("secondary") ?? ""),
    accent: String(formData.get("accent") ?? ""),
    neutral: String(formData.get("neutral") ?? ""),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, message: "تحقق من القيم المدخلة.", fieldErrors };
  }
  const input = parsed.data;

  const target = resolveManageableSchoolId(
    user ? { role: user.role, schoolId: user.schoolId } : null,
    input.schoolId ?? null
  );
  if (!target.ok) {
    return {
      ok: false,
      message:
        target.code === "TENANT_MISMATCH"
          ? "لا يمكنك تعديل هوية مدرسة أخرى."
          : "لا تملك صلاحية إدارة هوية المدرسة.",
    };
  }
  if (!target.schoolId) {
    return { ok: false, message: "اختر المدرسة المراد تعديل هويتها." };
  }
  const schoolId = target.schoolId;

  try {
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { isActive: true },
    });
    if (!school || !school.isActive) {
      return { ok: false, message: "المدرسة غير موجودة أو غير مفعلة." };
    }

    await db.school.update({
      where: { id: schoolId },
      data: {
        ...(input.nameAr ? { nameAr: input.nameAr } : {}),
        brandTagline: input.tagline === "" ? null : (input.tagline ?? null),
        ...(input.primary ? { brandColor: input.primary } : {}),
        ...(input.secondary ? { brandColorSecondary: input.secondary } : {}),
        ...(input.accent ? { brandColorAccent: input.accent } : {}),
        ...(input.neutral ? { brandColorNeutral: input.neutral } : {}),
      },
    });

    revalidateBrandingPaths(schoolId);
    return { ok: true, message: "تم حفظ هوية المدرسة — التغييرات ظاهرة الآن." };
  } catch {
    return { ok: false, message: "تعذر حفظ الهوية — حاول مرة أخرى." };
  }
}

/* ------------------------------------------------------------------ */
/* Reset to the platform-default palette (keeps logo and name).         */
/* ------------------------------------------------------------------ */

export async function resetSchoolBrandingAction(
  _prevState: BrandingActionState | null,
  formData: FormData
): Promise<BrandingActionState> {
  const user = await getCurrentUser();
  const requested = String(formData.get("schoolId") ?? "");
  const target = resolveManageableSchoolId(
    user ? { role: user.role, schoolId: user.schoolId } : null,
    requested
  );
  if (!target.ok) {
    return {
      ok: false,
      message:
        target.code === "TENANT_MISMATCH"
          ? "لا يمكنك تعديل هوية مدرسة أخرى."
          : "لا تملك صلاحية إدارة هوية المدرسة.",
    };
  }
  if (!target.schoolId) {
    return { ok: false, message: "اختر المدرسة المراد استعادة هويتها." };
  }
  const schoolId = target.schoolId;

  try {
    await db.school.update({
      where: { id: schoolId },
      data: {
        brandColor: "#1D5BD6",
        brandColorSecondary: null,
        brandColorAccent: null,
        brandColorNeutral: null,
        brandTagline: null,
      },
    });
    revalidateBrandingPaths(schoolId);
    return { ok: true, message: "تمت استعادة الألوان الافتراضية." };
  } catch {
    return { ok: false, message: "تعذر استعادة الألوان — حاول مرة أخرى." };
  }
}

/* ------------------------------------------------------------------ */
/* Remove the logo (keeps everything else).                             */
/* ------------------------------------------------------------------ */

export async function removeSchoolLogoAction(
  _prevState: BrandingActionState | null,
  formData: FormData
): Promise<BrandingActionState> {
  const user = await getCurrentUser();
  const requested = String(formData.get("schoolId") ?? "");
  const target = resolveManageableSchoolId(
    user ? { role: user.role, schoolId: user.schoolId } : null,
    requested
  );
  if (!target.ok || !target.schoolId) {
    return { ok: false, message: "لا تملك صلاحية إدارة هوية المدرسة." };
  }

  try {
    const school = await db.school.findUnique({
      where: { id: target.schoolId },
      select: { logoUrl: true },
    });
    await db.school.update({
      where: { id: target.schoolId },
      data: { logoUrl: null },
    });

    // Cleanup AFTER the reference is gone: legacy disk files are unlinked,
    // R2 objects only when nothing else in the DB still points at them.
    const previous = school?.logoUrl;
    if (previous && previous.startsWith(`/uploads/schools/${target.schoolId}/`)) {
      try {
        await fs.unlink(path.join(process.cwd(), "public", previous));
      } catch {
        // best-effort cleanup
      }
    }
    try {
      await releaseMediaIfUnreferenced(previous);
    } catch {
      // best-effort cleanup — maintenance retries orphans
    }

    revalidateBrandingPaths(target.schoolId);
    return { ok: true, logoUrl: null, message: "تم حذف الشعار." };
  } catch (error) {
    console.error("[school-branding] logo remove failed:", error);
    return { ok: false, message: "تعذر حذف الشعار — حاول مرة أخرى." };
  }
}
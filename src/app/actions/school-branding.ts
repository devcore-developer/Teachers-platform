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

/* ------------------------------------------------------------------ */
/* Server actions for school branding management.                       */
/*                                                                      */
/* Authorization is resolved from the SESSION on every call:            */
/*   • SUPER_ADMIN  → any school (explicit schoolId allowed).           */
/*   • DEVELOPMENT_OFFICE_MANAGER → their own school ONLY; a client     */
/*     hint pointing at another tenant is a hard rejection.             */
/*   • everyone else → fail-closed rejection.                           */
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
/* Logo upload                                                          */
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
  if (!LOGO_MIME_TYPES.includes(file.type as (typeof LOGO_MIME_TYPES)[number])) {
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
  } catch {
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
    const previous = school?.logoUrl;
    if (previous && previous.startsWith(`/uploads/schools/${target.schoolId}/`)) {
      try {
        await fs.unlink(path.join(process.cwd(), "public", previous));
      } catch {
        // best-effort cleanup
      }
    }
    revalidateBrandingPaths(target.schoolId);
    return { ok: true, logoUrl: null, message: "تم حذف الشعار." };
  } catch {
    return { ok: false, message: "تعذر حذف الشعار — حاول مرة أخرى." };
  }
}
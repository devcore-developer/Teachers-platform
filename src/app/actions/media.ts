"use server";

/* ------------------------------------------------------------------ */
/* Media server actions — the ONLY gateway to Cloudflare R2 uploads.    */
/*                                                                      */
/* Flow (presigned direct upload — large videos never cross Next.js):   */
/*   1. requestMediaUploadAction — session + kind + MIME + size checks, */
/*      then a presigned PUT URL scoped to the caller's tenant.         */
/*   2. The browser PUTs the file straight to R2 (XHR progress).        */
/*   3. confirmMediaUploadAction — HEAD-verifies the object, then       */
/*      (optionally) registers an Attachment row and wires it to a      */
/*      course cover / program cover / lesson primary media.            */
/*                                                                      */
/* Every step fails CLOSED with honest Arabic copy. When the R2 env is  */
/* missing, uploads are refused with the exact missing variables — the  */
/* platform NEVER claims uploads work while they cannot.               */
/* ------------------------------------------------------------------ */

import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  isAllowedMimeType,
  maxBytesFor,
  missingR2Env,
  readR2Config,
} from "@/lib/media/config";
import {
  buildMediaKey,
  headObject,
  MediaStorageError,
  presignedPutUrl,
  publicUrlFor,
} from "@/lib/media/r2";
import { releaseMediaIfUnreferenced } from "@/lib/media/references";

/* ------------------------------------------------------------------ */
/* Shared types                                                         */
/* ------------------------------------------------------------------ */

export interface RequestMediaUploadSuccess {
  ok: true;
  uploadUrl: string;
  key: string;
  /** Final DB-ready URL (public CDN base or /api/media proxy path). */
  publicUrl: string;
  expiresIn: number;
}

export interface MediaFailure {
  ok: false;
  message: string;
  /** Present only when the failure is missing R2 configuration. */
  missingEnv?: string[];
}

export type RequestMediaUploadResult = RequestMediaUploadSuccess | MediaFailure;

const MANAGER_ROLES = [
  "SUPER_ADMIN",
  "DEVELOPMENT_OFFICE_MANAGER",
  "SCHOOL_MANAGER",
] as const;

function isManager(user: { role: string }): boolean {
  return (MANAGER_ROLES as readonly string[]).includes(user.role);
}

/* ------------------------------------------------------------------ */
/* 1) Request a presigned direct-upload URL                             */
/* ------------------------------------------------------------------ */

const requestSchema = z.object({
  kind: z.enum(["image", "video"]),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().positive(),
});

export async function requestMediaUploadAction(
  input: unknown
): Promise<RequestMediaUploadResult> {
  const user = await getCurrentUser();
  if (!user || !user.isActive) {
    return { ok: false, message: "يجب تسجيل الدخول قبل رفع الملفات." };
  }

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "بيانات الرفع غير صالحة." };
  }
  const { kind, fileName, mimeType, sizeBytes } = parsed.data;

  if (!isAllowedMimeType(kind, mimeType)) {
    return {
      ok: false,
      message:
        kind === "image"
          ? "صيغ الصور المدعومة: PNG أو JPG أو WEBP أو GIF."
          : "صيغ الفيديو المدعومة: MP4 أو WEBM أو MOV.",
    };
  }
  if (sizeBytes > maxBytesFor(kind)) {
    const limitMb = Math.round(maxBytesFor(kind) / (1024 * 1024));
    return {
      ok: false,
      message: `حجم الملف يتجاوز الحد الأقصى (${limitMb} ميجابايت).`,
    };
  }

  const cfg = readR2Config();
  if (!cfg) {
    return {
      ok: false,
      message:
        "خدمة الرفع السحابي غير مُهيأة على الخادم بعد — أضف متغيرات Cloudflare R2 (R2_ACCOUNT_ID وR2_ACCESS_KEY_ID وR2_SECRET_ACCESS_KEY وR2_BUCKET_NAME) ثم أعد النشر. إدخال الروابط الخارجية يعمل بشكل طبيعي.",
      missingEnv: missingR2Env(),
    };
  }

  // Tenant-scoped keys: school users upload under their school; only
  // SUPER_ADMIN may write platform-level media. A user bound to no
  // school (rare office account) cannot upload — fail closed.
  let scopeSchoolId: string | null = null;
  if (user.schoolId) {
    scopeSchoolId = user.schoolId;
  } else if (user.role === "SUPER_ADMIN") {
    scopeSchoolId = null;
  } else {
    return {
      ok: false,
      message: "حسابك غير مرتبط بمدرسة — تواصل مع مدير المنصة.",
    };
  }

  try {
    const key = buildMediaKey({
      kind,
      mimeType,
      originalName: fileName,
      schoolId: scopeSchoolId,
    });
    const uploadUrl = await presignedPutUrl(key, mimeType);
    return {
      ok: true,
      uploadUrl,
      key,
      publicUrl: publicUrlFor(key),
      expiresIn: 600,
    };
  } catch (error) {
    if (error instanceof MediaStorageError) {
      return { ok: false, message: "تعذر الاتصال بخدمة التخزين — حاول لاحقًا." };
    }
    return { ok: false, message: "تعذر تجهيز الرفع — حاول مرة أخرى." };
  }
}

/* ------------------------------------------------------------------ */
/* 2) Confirm + (optionally) register the uploaded object               */
/* ------------------------------------------------------------------ */

export type AttachTarget =
  | { type: "course-cover"; courseId: string }
  | { type: "program-cover"; programId: string }
  | { type: "lesson-media"; lessonId: string };

export interface ConfirmMediaUploadInput {
  key: string;
  publicUrl: string;
  originalName: string;
  mimeType: string;
  kind: "image" | "video";
  /** When set, the object is registered as the owner's primary media. */
  attachTo?: AttachTarget;
}

export type ConfirmMediaUploadResult =
  | { ok: true; url: string; attachmentId?: string }
  | MediaFailure;

const confirmSchema = z.object({
  key: z.string().trim().min(3).max(400),
  publicUrl: z.string().trim().min(1).max(2048),
  originalName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(3).max(120),
  kind: z.enum(["image", "video"]),
  attachTo: z
    .union([
      z.object({ type: z.literal("course-cover"), courseId: z.string().trim().min(1).max(64) }),
      z.object({ type: z.literal("program-cover"), programId: z.string().trim().min(1).max(64) }),
      z.object({ type: z.literal("lesson-media"), lessonId: z.string().trim().min(1).max(64) }),
    ])
    .optional(),
});

export async function confirmMediaUploadAction(
  input: ConfirmMediaUploadInput
): Promise<ConfirmMediaUploadResult> {
  const user = await getCurrentUser();
  if (!user || !user.isActive) {
    return { ok: false, message: "انتهت الجلسة — سجّل الدخول من جديد." };
  }

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "بيانات التأكيد غير صالحة." };
  }
  const { key, publicUrl, originalName, mimeType, kind, attachTo } = parsed.data;

  if (!isAllowedMimeType(kind, mimeType)) {
    return {
      ok: false,
      message: "صيغة الملف غير مدعومة على الخادم.",
    };
  }

  // The key must belong to the caller's scope (no cross-tenant writes).
  const ownsScope =
    key.startsWith(`media/school-${user.schoolId ?? "-"}/`) ||
    (user.role === "SUPER_ADMIN" && key.startsWith("media/platform/"));
  if (!ownsScope) {
    return { ok: false, message: "لا تملك صلاحية تأكيد هذا الملف." };
  }

  // Server-side verification — never trust the client's word that the
  // upload happened: HEAD the object and enforce the size ceiling.
  let info;
  try {
    info = await headObject(key);
  } catch (error) {
    if (error instanceof MediaStorageError && error.code === "R2_NOT_CONFIGURED") {
      return {
        ok: false,
        message: "خدمة التخزين غير مُهيأة على الخادم.",
        missingEnv: missingR2Env(),
      };
    }
    return { ok: false, message: "تعذر التحقق من الملف على التخزين." };
  }
  if (!info) {
    return {
      ok: false,
      message: "لم نجد الملف على التخزين — أعد المحاولة أو أعد اختيار الملف.",
    };
  }
  if (info.sizeBytes > maxBytesFor(kind)) {
    return {
      ok: false,
      message: `حجم الملف الفعلي يتجاوز الحد الأقصى (${Math.round(
        maxBytesFor(kind) / (1024 * 1024)
      )} ميجابايت).`,
    };
  }

  if (!attachTo) {
    // Plain media (e.g. school logo flow) — the URL alone is enough.
    return { ok: true, url: publicUrl };
  }

  // Registration paths are manager-only and school-checked below.
  if (!isManager(user)) {
    return { ok: false, message: "هذه العملية متاحة لمديري المدرسة فقط." };
  }

  try {
    if (attachTo.type === "course-cover") {
      const course = await db.course.findUnique({
        where: { id: attachTo.courseId },
        select: { schoolId: true, coverAttachmentId: true },
      });
      if (!course) return { ok: false, message: "الدورة غير موجودة." };
      if (user.role !== "SUPER_ADMIN" && course.schoolId !== user.schoolId) {
        return { ok: false, message: "لا تملك صلاحية التعديل على هذه الدورة." };
      }
      const oldUrl = await urlOfAttachment(course.coverAttachmentId);
      const attachment = await db.attachment.create({
        data: {
          originalName,
          storageKey: key,
          mimeType,
          sizeBytes: info.sizeBytes,
          kind: "COVER",
          courseId: attachTo.courseId,
          uploadedById: user.id,
          provider: "R2",
        },
      });
      await db.course.update({
        where: { id: attachTo.courseId },
        data: { coverAttachmentId: attachment.id },
      });
      await releaseAttachmentObject(oldUrl);
      return { ok: true, url: publicUrl, attachmentId: attachment.id };
    }

    if (attachTo.type === "program-cover") {
      const program = await db.trainingProgram.findUnique({
        where: { id: attachTo.programId },
        select: { schoolId: true, coverAttachmentId: true },
      });
      if (!program) return { ok: false, message: "البرنامج غير موجود." };
      if (user.role !== "SUPER_ADMIN" && program.schoolId !== user.schoolId) {
        return { ok: false, message: "لا تملك صلاحية التعديل على هذا البرنامج." };
      }
      const oldUrl = await urlOfAttachment(program.coverAttachmentId);
      const attachment = await db.attachment.create({
        data: {
          originalName,
          storageKey: key,
          mimeType,
          sizeBytes: info.sizeBytes,
          kind: "COVER",
          programId: attachTo.programId,
          uploadedById: user.id,
          provider: "R2",
        },
      });
      await db.trainingProgram.update({
        where: { id: attachTo.programId },
        data: { coverAttachmentId: attachment.id },
      });
      await releaseAttachmentObject(oldUrl);
      return { ok: true, url: publicUrl, attachmentId: attachment.id };
    }

    // lesson-media
    const lesson = await db.courseLesson.findUnique({
      where: { id: attachTo.lessonId },
      select: {
        attachmentId: true,
        section: { select: { course: { select: { schoolId: true } } } },
      },
    });
    if (!lesson) return { ok: false, message: "الدرس غير موجود." };
    const courseSchoolId = lesson.section?.course?.schoolId ?? null;
    if (user.role !== "SUPER_ADMIN" && courseSchoolId !== user.schoolId) {
      return { ok: false, message: "لا تملك صلاحية التعديل على هذا الدرس." };
    }
    const oldUrl = await urlOfAttachment(lesson.attachmentId);
    const attachment = await db.attachment.create({
      data: {
        originalName,
        storageKey: key,
        mimeType,
        sizeBytes: info.sizeBytes,
        kind: "RESOURCE",
        lessonId: attachTo.lessonId,
        uploadedById: user.id,
        provider: "R2",
      },
    });
    await db.courseLesson.update({
      where: { id: attachTo.lessonId },
      data: { attachmentId: attachment.id },
    });
    await releaseAttachmentObject(oldUrl);
    return { ok: true, url: publicUrl, attachmentId: attachment.id };
  } catch {
    return { ok: false, message: "تعذر ربط الملف بالسجل — حاول مرة أخرى." };
  }
}

async function urlOfAttachment(attachmentId: string | null): Promise<string | null> {
  if (!attachmentId) return null;
  const row = await db.attachment.findUnique({
    where: { id: attachmentId },
    select: { storageKey: true, provider: true },
  });
  if (!row || row.provider !== "R2") return null;
  return publicUrlFor(row.storageKey);
}

/** Best-effort release of a replaced R2 object (never throws). */
async function releaseAttachmentObject(url: string | null): Promise<void> {
  if (!url) return;
  try {
    await releaseMediaIfUnreferenced(url);
  } catch {
    // Orphan cleanup is retried by maintenance; never block the save.
  }
}

/* ------------------------------------------------------------------ */
/* 3) Remove a managed media object (reference-safe)                    */
/* ------------------------------------------------------------------ */

export async function removeMediaAction(url: string): Promise<
  | { ok: true }
  | { ok: false; message: string }
> {
  const user = await getCurrentUser();
  if (!user || !user.isActive) {
    return { ok: false, message: "انتهت الجلسة — سجّل الدخول من جديد." };
  }
  try {
    const result = await releaseMediaIfUnreferenced(url);
    if (!result.released && result.reason === "STILL_REFERENCED") {
      // The file stays — something else still uses it. Not an error:
      // the caller's record simply stops pointing at it.
      return { ok: true };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof MediaStorageError && error.code === "R2_NOT_CONFIGURED") {
      return { ok: false, message: "خدمة التخزين غير مُهيأة على الخادم." };
    }
    return { ok: false, message: "تعذر حذف الملف من التخزين — سيُنظّف تلقائيًا لاحقًا." };
  }
}
/* ------------------------------------------------------------------ */
/* Private media proxy — GET /api/media/<key…>                          */
/*                                                                      */
/* Used when R2_PUBLIC_URL is NOT configured: stored URLs point here    */
/* and this route 302-redirects authorized, signed-in users to a short- */
/* lived presigned GET on the bucket. The bucket itself stays fully     */
/* private — no public object access is ever required.                  */
/*                                                                      */
/* When R2_PUBLIC_URL IS configured, uploaded URLs point straight at    */
/* the public base and this route simply is not used for them.          */
/*                                                                      */
/* Mandatory learning enforcement: the attachment is resolved back to   */
/* its owning course/lesson and the request is rejected unless the      */
/* viewer may access that content — including the sequential lesson     */
/* lock, so locked lesson media cannot be pulled by URL manipulation.   */
/* ------------------------------------------------------------------ */

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import {
  PRESIGN_GET_EXPIRES_SECONDS,
  readR2Config,
} from "@/lib/media/config";
import {
  headObject,
  MediaStorageError,
  presignedGetUrl,
} from "@/lib/media/r2";
import {
  canAccessAttachment,
  type ViewerIdentity,
} from "@/lib/training/access";
import { assertLessonPlayable } from "@/lib/training/sequence";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function jsonError(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ key: string[] }> }
) {
  const user = await getCurrentUser();
  if (!user || !user.isActive) {
    return jsonError(401, "يجب تسجيل الدخول لعرض الملفات.");
  }
  const viewer: ViewerIdentity = {
    id: user.id,
    role: user.role,
    schoolId: user.schoolId,
  };

  const { key: segments } = await context.params;
  if (!segments || segments.length === 0) {
    return jsonError(400, "مسار ملف غير صالح.");
  }

  let key: string;
  try {
    key = segments.map((segment) => decodeURIComponent(segment)).join("/");
  } catch {
    return jsonError(400, "مسار ملف غير صالح.");
  }

  // Path traversal + scope guard: only well-formed media/… keys.
  if (!key.startsWith("media/") || key.includes("..") || key.includes("\\")) {
    return jsonError(400, "مسار ملف غير صالح.");
  }

  const cfg = readR2Config();
  if (!cfg) {
    return jsonError(
      503,
      "خدمة التخزين غير مُهيأة على الخادم — أضف متغيرات Cloudflare R2."
    );
  }

  // Content-level authorization: resolve the object back to its owning
  // attachment (storage keys are server-generated, so this map is
  // authoritative), then enforce course/program visibility AND the
  // sequential lesson lock for lesson-bound media.
  const attachment = await db.attachment.findUnique({
    where: { storageKey: key },
    select: { lessonId: true, courseId: true, programId: true },
  });
  if (attachment) {
    let scopeOk = viewer.role === "SUPER_ADMIN";
    if (!scopeOk) {
      if (attachment.courseId) {
        const course = await db.course.findUnique({
          where: { id: attachment.courseId },
          select: { status: true, schoolId: true },
        });
        scopeOk = canAccessAttachment(
          viewer,
          { courseId: attachment.courseId, programId: null },
          course,
          null
        );
      } else if (attachment.programId) {
        const program = await db.trainingProgram.findUnique({
          where: { id: attachment.programId },
          select: { status: true, schoolId: true },
        });
        scopeOk = canAccessAttachment(
          viewer,
          { courseId: null, programId: attachment.programId },
          null,
          program
        );
      }
    }
    if (!scopeOk) {
      return jsonError(403, "هذا الملف تابع لمحتوى غير متاح لك.");
    }

    if (attachment.lessonId) {
      const lesson = await db.courseLesson.findUnique({
        where: { id: attachment.lessonId },
        select: { section: { select: { courseId: true } } },
      });
      const courseId = lesson?.section.courseId ?? attachment.courseId;
      if (courseId) {
        const gate = await assertLessonPlayable(viewer, courseId, attachment.lessonId);
        if (!gate.ok) {
          return jsonError(403, gate.message);
        }
      }
    }
  }

  try {
    const info = await headObject(key);
    if (!info) return jsonError(404, "الملف غير موجود.");

    const signed = await presignedGetUrl(key);
    return NextResponse.redirect(signed, {
      status: 302,
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    if (error instanceof MediaStorageError && error.code === "OBJECT_NOT_FOUND") {
      return jsonError(404, "الملف غير موجود.");
    }
    return jsonError(502, "تعذر الوصول إلى التخزين — حاول لاحقًا.");
  }
}
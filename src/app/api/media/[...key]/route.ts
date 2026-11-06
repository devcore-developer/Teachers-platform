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
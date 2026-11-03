import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { canAccessAttachment } from "@/lib/training/access";
import { getAttachmentForAccess } from "@/lib/training/content";
import { getStorage } from "@/lib/storage";

/* ------------------------------------------------------------------ */
/* Authenticated attachment delivery.                                   */
/*                                                                      */
/* Files stored by the academy never live under /public — every byte    */
/* passes through this route, which re-checks session + school scope +  */
/* publication status on EVERY request. Supports HTTP Range requests    */
/* so uploaded videos can seek in the browser player.                   */
/* ------------------------------------------------------------------ */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const attachment = await getAttachmentForAccess(id);
  if (!attachment) {
    return new NextResponse("Not found", { status: 404 });
  }

  const allowed = canAccessAttachment(
    { id: user.id, role: user.role, schoolId: user.schoolId },
    { courseId: attachment.courseId, programId: attachment.programId },
    attachment.courseId ? attachment.course : null,
    attachment.programId ? attachment.program : null
  );
  if (!allowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const data = await getStorage().get(attachment.storageKey);
  if (!data) {
    // The metadata row exists but the file is gone from the backend —
    // report honestly instead of pretending.
    return new NextResponse("File unavailable", { status: 404 });
  }

  const total = data.byteLength;

  /** BodyInit wants a concrete ArrayBuffer in this TS lib — copy once. */
  function toBody(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }

  const contentType = attachment.mimeType || "application/octet-stream";
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
      attachment.originalName
    )}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
  };

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match) {
      let start = match[1] === "" ? undefined : Number.parseInt(match[1], 10);
      let end = match[2] === "" ? undefined : Number.parseInt(match[2], 10);

      // Suffix range: bytes=-N (last N bytes).
      if (start === undefined && end !== undefined) {
        start = Math.max(0, total - end);
        end = total - 1;
      }
      if (start === undefined) start = 0;
      if (end === undefined || end >= total) end = total - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }

      const chunk = data.slice(start, end + 1);
      return new NextResponse(toBody(chunk), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(chunk.byteLength),
        },
      });
    }
  }

  return new NextResponse(toBody(data), {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(total) },
  });
}
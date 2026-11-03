/**
 * Phase 7 — authenticated download endpoint for submission attachments.
 *
 * Access is decided SERVER-SIDE per request:
 *   - the owning teacher,
 *   - the school's development-office manager,
 *   - an educational supervisor whose persisted TeacherSupervisorAssignment
 *     covers this exact teacher (same school).
 * Deputies get summaries only — no file access. Anonymous requests get 401.
 */
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { readSubmissionObject } from "@/lib/assignments/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return new Response("غير مصرّح", { status: 401 });
  }

  const file = await db.submissionFile.findUnique({
    where: { id },
    include: {
      submission: {
        select: {
          teacherId: true,
          schoolId: true,
          assignment: { select: { id: true, titleAr: true } },
        },
      },
    },
  });
  if (!file) {
    return new Response("المرفق غير موجود", { status: 404 });
  }

  const submission = file.submission;
  let allowed = user.id === submission.teacherId;

  if (!allowed && user.role === "DEVELOPMENT_OFFICE_MANAGER" && user.schoolId === submission.schoolId) {
    allowed = true;
  }

  if (!allowed && user.role === "EDUCATIONAL_SUPERVISOR" && user.schoolId === submission.schoolId) {
    const link = await db.teacherSupervisorAssignment.findUnique({
      where: { teacherId: submission.teacherId },
      select: { supervisorId: true, schoolId: true },
    });
    allowed = link?.supervisorId === user.id && link.schoolId === user.schoolId;
  }

  if (!allowed) {
    return new Response("لا تملك صلاحية الاطلاع على هذا المرفق", { status: 403 });
  }

  let bytes: Buffer;
  try {
    bytes = await readSubmissionObject(file.storageKey);
  } catch {
    return new Response("تعذر قراءة الملف المخزّن", { status: 500 });
  }

  const encodedName = encodeURIComponent(file.fileName);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="submission-file"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
    },
  });
}
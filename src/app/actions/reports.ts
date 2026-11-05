"use server";

/**
 * Batch 2 — yearly training archive actions (HTML v26ArchiveYear /
 * v26StartYear). Writes are gated server-side to canAdministerSchool.
 */
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import { archiveYear, startAcademicYear, type ArchiveActor } from "@/lib/training/archive";

export interface ArchiveActionState {
  ok: boolean;
  message?: string;
  code?: string;
  data?: { year?: string; previousYear?: string };
}

function failure(message: string, code?: string): ArchiveActionState {
  return { ok: false, message, code };
}

async function actor(): Promise<ArchiveActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, role: user.role, schoolId: user.schoolId };
}

export async function archiveYearAction(
  _prev: ArchiveActionState,
  formData: FormData
): Promise<ArchiveActionState> {
  try {
    const context = await actor();
    if (!context) return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    const year = String(formData.get("year") ?? "").trim();
    if (!year) return failure("حدد العام الدراسي", "VALIDATION_ERROR");
    const result = await archiveYear(context, year);
    if (!result.ok) return failure(result.message, result.code);
    revalidatePath("/training-archive");
    revalidatePath("/reports");
    return {
      ok: true,
      message: `تمت أرشفة بيانات التدريب للعام الدراسي ${year} ويمكن الرجوع إليها لاحقًا.`,
      data: { year },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function startAcademicYearAction(
  _prev: ArchiveActionState,
  formData: FormData
): Promise<ArchiveActionState> {
  try {
    const context = await actor();
    if (!context) return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    const year = String(formData.get("year") ?? "").trim();
    if (!year) return failure("أدخل العام الدراسي — مثال 1449هـ", "VALIDATION_ERROR");
    const result = await startAcademicYear(context, year);
    if (!result.ok) return failure(result.message, result.code);
    revalidatePath("/training-archive");
    revalidatePath("/reports");
    return {
      ok: true,
      message: `تم اعتماد العام الدراسي ${result.data.year} كسنة العمل الحالية (كان ${result.data.previousYear}).`,
      data: { year: result.data.year, previousYear: result.data.previousYear },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}
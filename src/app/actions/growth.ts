"use server";

/**
 * Batch 2 — growth ladder actions (HTML v48SetTeacherLevel /
 * v48CheckPromotion). The actor is ALWAYS resolved from the session;
 * the 60% promotion gate is re-checked server-side by the service.
 */
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import {
  approvePromotion,
  setTeacherLevel,
  type GrowthActor,
} from "@/lib/growth/service";

export interface GrowthActionState {
  ok: boolean;
  message?: string;
  code?: string;
  data?: {
    changed?: boolean;
    promoted?: boolean;
    from?: string;
    to?: string;
    completed?: number;
    assigned?: number;
    percent?: number;
  };
}

function failure(message: string, code?: string): GrowthActionState {
  return { ok: false, message, code };
}

async function actor(): Promise<GrowthActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, role: user.role, schoolId: user.schoolId };
}

function revalidateGrowth(teacherId: string): void {
  revalidatePath("/supervision/growth");
  revalidatePath("/teachers");
  revalidatePath(`/teachers/${teacherId}`);
  revalidatePath("/reports");
  // Part 2/2 — the new growth surfaces also read these rows.
  revalidatePath("/growth");
  revalidatePath("/my-growth");
  revalidatePath(`/growth/${teacherId}`);
}

export async function setTeacherLevelAction(
  _prev: GrowthActionState,
  formData: FormData
): Promise<GrowthActionState> {
  try {
    const context = await actor();
    if (!context) return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    const teacherId = String(formData.get("teacherId") ?? "");
    const level = String(formData.get("level") ?? "");
    const note = String(formData.get("note") ?? "");
    if (!teacherId || !level) {
      return failure("بيانات ناقصة — حدّث الصفحة وأعد المحاولة", "VALIDATION_ERROR");
    }
    const result = await setTeacherLevel(context, teacherId, level, note);
    if (!result.ok) return failure(result.message, result.code);
    revalidateGrowth(teacherId);
    return {
      ok: true,
      message: result.data.changed
        ? "تم تحديث تصنيف المعلم"
        : "التصنيف الحالي مطابق — لا تغيير",
      data: {
        changed: result.data.changed,
        from: result.data.from,
        to: result.data.to,
      },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function approvePromotionAction(
  _prev: GrowthActionState,
  formData: FormData
): Promise<GrowthActionState> {
  try {
    const context = await actor();
    if (!context) return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    const teacherId = String(formData.get("teacherId") ?? "");
    if (!teacherId) {
      return failure("بيانات ناقصة — حدّث الصفحة وأعد المحاولة", "VALIDATION_ERROR");
    }
    const result = await approvePromotion(context, teacherId);
    if (!result.ok) return failure(result.message, result.code);
    revalidateGrowth(teacherId);
    if (!result.data.promoted) {
      return {
        ok: true,
        message: result.data.message,
        data: {
          promoted: false,
          completed: result.data.completed,
          assigned: result.data.assigned,
          percent: result.data.percent,
        },
      };
    }
    return {
      ok: true,
      message: `تم اعتماد انتقال المعلم إلى ${result.data.to}`,
      data: { promoted: true, from: result.data.from, to: result.data.to },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}
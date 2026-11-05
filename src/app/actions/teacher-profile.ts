"use server";

/**
 * Batch 2 — administrative teacher profile actions:
 *   - professional data edit (name/stage/subject/school/supervisor/deputy)
 *   - secure temporary-password reset (shown ONCE to the admin)
 *   - secure email change (uniqueness + re-verification)
 * The actor is resolved from the session; school scope is enforced
 * server-side (office managers never leave their own school).
 */
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { nameFieldRules } from "@/lib/validation/user-fields";
import { z } from "zod";
import {
  adminSetTemporaryPassword,
  adminUpdateEmail,
} from "@/lib/account-security/service";

export interface TeacherAdminActionState {
  ok: boolean;
  message?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
  data?: {
    /** One-time display of the generated temporary password. */
    temporaryPassword?: string;
    newEmail?: string;
    verificationEmailSent?: boolean;
  };
}

function failure(
  message: string,
  code?: string,
  fieldErrors?: Record<string, string>
): TeacherAdminActionState {
  return { ok: false, message, code, fieldErrors };
}

type AdminActor = {
  id: string;
  name: string;
  role: string;
  schoolId: string | null;
};

async function adminActor(): Promise<AdminActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "SUPER_ADMIN" && user.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return null;
  }
  return { id: user.id, name: user.name, role: user.role, schoolId: user.schoolId };
}

function revalidateTeacher(teacherId: string): void {
  revalidatePath("/teachers");
  revalidatePath(`/teachers/${teacherId}`);
  revalidatePath("/supervision/growth");
  revalidatePath("/reports");
}

const profileSchema = z.object({
  name: nameFieldRules(),
  stage: z
    .string()
    .trim()
    .max(60, "المرحلة طويلة جدًا")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
  subject: z
    .string()
    .trim()
    .max(60, "التخصص طويل جدًا")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
  supervisorId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
  deputyId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

/** Administrative teacher profile edit (extends the existing Phase 4 edit). */
export async function updateTeacherProfileAction(
  _prev: TeacherAdminActionState,
  formData: FormData
): Promise<TeacherAdminActionState> {
  try {
    const actorContext = await adminActor();
    if (!actorContext) return failure("هذه العملية متاحة للإدارة فقط", "FORBIDDEN");
    const teacherId = String(formData.get("teacherId") ?? "");
    if (!teacherId) return failure("بيانات ناقصة", "VALIDATION_ERROR");

    const teacher = await db.user.findUnique({
      where: { id: teacherId },
      select: { id: true, role: true, schoolId: true, teacherSupervision: { select: { id: true } } },
    });
    if (!teacher || teacher.role !== "TEACHER") {
      return failure("المعلم غير موجود", "NOT_FOUND");
    }
    if (
      actorContext.role === "DEVELOPMENT_OFFICE_MANAGER" &&
      teacher.schoolId !== actorContext.schoolId
    ) {
      return failure("هذا المعلم خارج نطاق مدرستك", "FORBIDDEN");
    }

    const parsed = profileSchema.safeParse({
      name: String(formData.get("name") ?? ""),
      stage: String(formData.get("stage") ?? ""),
      subject: String(formData.get("subject") ?? ""),
      supervisorId: String(formData.get("supervisorId") ?? ""),
      deputyId: String(formData.get("deputyId") ?? ""),
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "_form");
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return failure("راجع الحقول المطلوبة", "VALIDATION_ERROR", fieldErrors);
    }
    const input = parsed.data;

    // Supervisor/deputy must be ACTIVE staff of the teacher's school.
    const staffSchoolId = teacher.schoolId;
    if (input.supervisorId) {
      const supervisor = await db.user.findUnique({
        where: { id: input.supervisorId },
        select: { role: true, isActive: true, schoolId: true },
      });
      if (
        !supervisor ||
        supervisor.role !== "EDUCATIONAL_SUPERVISOR" ||
        !supervisor.isActive ||
        (staffSchoolId && supervisor.schoolId !== staffSchoolId)
      ) {
        return failure("المشرف المحدد غير صالح لهذا المعلم", "VALIDATION_ERROR", {
          supervisorId: "المشرف غير صالح",
        });
      }
    }
    if (input.deputyId) {
      const deputy = await db.user.findUnique({
        where: { id: input.deputyId },
        select: { role: true, isActive: true, schoolId: true },
      });
      if (
        !deputy ||
        deputy.role !== "EDUCATIONAL_DEPUTY" ||
        !deputy.isActive ||
        (staffSchoolId && deputy.schoolId !== staffSchoolId)
      ) {
        return failure("الوكيل المحدد غير صالح لهذا المعلم", "VALIDATION_ERROR", {
          deputyId: "الوكيل غير صالح",
        });
      }
    }

    await db.user.update({
      where: { id: teacherId },
      data: {
        name: input.name,
        stage: input.stage,
        subject: input.subject,
      },
    });

    // The teacher -> supervisor row is UNIQUE per teacher. supervisorId
    // is NOT NULL in the schema: a cleared supervisor only updates the
    // deputy of an EXISTING row; without any row AND without a supervisor
    // the write is rejected with a clear Arabic message.
    if (!staffSchoolId) {
      return failure("المعلم غير مرتبط بمجمع تعليمي — حدّد مدرسته أولًا", "VALIDATION_ERROR");
    }
    if (input.supervisorId) {
      await db.teacherSupervisorAssignment.upsert({
        where: { teacherId },
        create: {
          teacherId,
          supervisorId: input.supervisorId,
          deputyId: input.deputyId,
          schoolId: staffSchoolId,
        },
        update: {
          supervisorId: input.supervisorId,
          deputyId: input.deputyId,
        },
      });
    } else {
      const existingAssignment = await db.teacherSupervisorAssignment.findUnique({
        where: { teacherId },
        select: { id: true },
      });
      if (existingAssignment) {
        await db.teacherSupervisorAssignment.update({
          where: { teacherId },
          data: { deputyId: input.deputyId },
        });
      } else {
        return failure(
          "اختر مشرفًا تربويًا — لا يمكن إنشاء إسناد بدون مشرف",
          "VALIDATION_ERROR",
          { supervisorId: "المشرف مطلوب لإنشاء الإسناد" }
        );
      }
    }

    revalidateTeacher(teacherId);
    return { ok: true, message: "تم حفظ بيانات المعلم" };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/** Secure temporary-password reset — the secret is returned ONCE. */
export async function adminResetPasswordAction(
  _prev: TeacherAdminActionState,
  formData: FormData
): Promise<TeacherAdminActionState> {
  try {
    const actorContext = await adminActor();
    if (!actorContext) return failure("هذه العملية متاحة للإدارة فقط", "FORBIDDEN");
    const teacherId = String(formData.get("teacherId") ?? "");
    if (!teacherId) return failure("بيانات ناقصة", "VALIDATION_ERROR");
    const result = await adminSetTemporaryPassword(actorContext, teacherId);
    if (!result.ok) return failure(result.message, result.code);
    revalidateTeacher(teacherId);
    return {
      ok: true,
      message:
        "تم تعيين كلمة مرور مؤقتة وإلغاء جميع جلسات الحساب — انسخها الآن، لن تُعرض مرة أخرى.",
      data: { temporaryPassword: result.data.temporaryPassword },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

/** Administrative email update (uniqueness + re-verification). */
export async function adminUpdateEmailAction(
  _prev: TeacherAdminActionState,
  formData: FormData
): Promise<TeacherAdminActionState> {
  try {
    const actorContext = await adminActor();
    if (!actorContext) return failure("هذه العملية متاحة للإدارة فقط", "FORBIDDEN");
    const teacherId = String(formData.get("teacherId") ?? "");
    const newEmail = String(formData.get("newEmail") ?? "");
    if (!teacherId || !newEmail.trim()) {
      return failure("أدخل البريد الإلكتروني الجديد", "VALIDATION_ERROR");
    }
    const result = await adminUpdateEmail(actorContext, teacherId, newEmail);
    if (!result.ok) {
      return failure(result.message, result.code, result.fieldErrors);
    }
    revalidateTeacher(teacherId);
    return {
      ok: true,
      message: result.data.verificationEmailSent
        ? `تم تحديث البريد إلى ${result.data.email} وأُرسلت رسالة توثيق — يجب توثيق البريد قبل الدخول.`
        : `تم تحديث البريد إلى ${result.data.email} — يجب توثيق البريد قبل الدخول (تعذر إرسال رسالة التوثيق الآن).`,
      data: {
        newEmail: result.data.email,
        verificationEmailSent: result.data.verificationEmailSent,
      },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}
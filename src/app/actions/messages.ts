"use server";

/**
 * Batch 2 — supervisor->teacher messaging actions (HTML v38/v40).
 * Recipients are validated server-side against the sender's scope;
 * delivery persists a TeacherMessage row and notifies the recipient.
 */
import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import {
  markMessageRead,
  sendMessage,
  type MessageActor,
} from "@/lib/messages/service";

export interface MessageActionState {
  ok: boolean;
  message?: string;
  code?: string;
  data?: { messageId?: string };
}

function failure(message: string, code?: string): MessageActionState {
  return { ok: false, message, code };
}

async function actor(): Promise<MessageActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { id: user.id, role: user.role, schoolId: user.schoolId };
}

export async function sendMessageAction(
  _prev: MessageActionState,
  formData: FormData
): Promise<MessageActionState> {
  try {
    const context = await actor();
    if (!context) return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    const recipientId = String(formData.get("recipientId") ?? "");
    const type = String(formData.get("type") ?? "");
    const body = String(formData.get("body") ?? "");
    if (!recipientId || !type || !body.trim()) {
      return failure("اختر المعلم واكتب نص الرسالة أولًا", "VALIDATION_ERROR");
    }
    const result = await sendMessage(context, { recipientId, type, body });
    if (!result.ok) return failure(result.message, result.code);
    revalidatePath("/messages");
    revalidatePath("/notifications");
    return {
      ok: true,
      message: "تم إرسال الرسالة إلى حساب المعلم داخل المنصة",
      data: { messageId: result.data.id },
    };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}

export async function markMessageReadAction(
  _prev: MessageActionState,
  formData: FormData
): Promise<MessageActionState> {
  try {
    const user = await getCurrentUser();
    if (!user) return failure("يجب تسجيل الدخول أولًا", "FORBIDDEN");
    const messageId = String(formData.get("messageId") ?? "");
    if (!messageId) return failure("بيانات ناقصة", "VALIDATION_ERROR");
    const marked = await markMessageRead(user.id, messageId);
    revalidatePath("/messages");
    return { ok: true, message: marked ? "تم" : "لا تغيير" };
  } catch {
    return failure("حدث خطأ غير متوقع — أعد المحاولة", "UNKNOWN");
  }
}
import { db } from "@/lib/db";
import {
  MESSAGE_TYPE_LABELS,
  isMessageType,
  type MessageType,
} from "@/config/growth";
import { notifyMessageReceived } from "@/lib/notifications/center";
import { supervisorScopedTeacherRecords } from "@/lib/growth/service";

/* ------------------------------------------------------------------ */
/* Batch 2 — supervisor -> teacher platform messaging                   */
/* (HTML v38/v40 parity: نوع الرسالة + نص الرسالة، إرسال عبر المنصة).   */
/*                                                                      */
/* Every message is a persisted TeacherMessage row bound to real user   */
/* ids and ALSO flows through the notification center (category         */
/* MESSAGES) so the teacher's bell lights up. Scope rules (fail-closed):*/
/*   - EDUCATIONAL_SUPERVISOR: only teachers inside their own scope     */
/*     (explicit assignment ∪ branch coverage, own school).             */
/*   - DEVELOPMENT_OFFICE_MANAGER: only teachers of their own school.   */
/*   - SUPER_ADMIN: any teacher.                                        */
/*   - TEACHER / EDUCATIONAL_DEPUTY: never send (read-only roles).      */
/* ------------------------------------------------------------------ */

export interface MessageActor {
  id: string;
  role: string;
  schoolId: string | null;
}

export type MessageServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code?: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" };

export interface MessageRow {
  id: string;
  type: MessageType;
  typeLabel: string;
  body: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  readAt: Date | null;
  createdAt: Date;
}

const MAX_BODY_LENGTH = 2000;

/** The row shape shared by inbox and sent views. */
const messageSelect = {
  id: true,
  type: true,
  body: true,
  readAt: true,
  createdAt: true,
  sender: { select: { id: true, name: true } },
  recipient: { select: { id: true, name: true } },
} as const;

type MessageDbRow = {
  id: string;
  type: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
  sender: { id: string; name: string };
  recipient: { id: string; name: string };
};

function toRow(message: MessageDbRow): MessageRow {
  const type: MessageType = isMessageType(message.type) ? message.type : "FOLLOW_UP";
  return {
    id: message.id,
    type,
    typeLabel: MESSAGE_TYPE_LABELS[type],
    body: message.body,
    senderId: message.sender.id,
    senderName: message.sender.name,
    recipientId: message.recipient.id,
    recipientName: message.recipient.name,
    readAt: message.readAt,
    createdAt: message.createdAt,
  };
}

/** Can this actor message this teacher? (scope + recipient sanity) */
async function canSendTo(actor: MessageActor, recipientId: string): Promise<boolean> {
  const recipient = await db.user.findUnique({
    where: { id: recipientId },
    select: { role: true, isActive: true, schoolId: true },
  });
  if (!recipient || recipient.role !== "TEACHER" || !recipient.isActive) return false;

  switch (actor.role) {
    case "EDUCATIONAL_SUPERVISOR": {
      const scoped = await supervisorScopedTeacherRecords(actor.id);
      return scoped.ok && scoped.data.some((teacher) => teacher.id === recipientId);
    }
    case "DEVELOPMENT_OFFICE_MANAGER":
      return Boolean(actor.schoolId) && recipient.schoolId === actor.schoolId;
    case "SUPER_ADMIN":
      return true;
    default:
      return false;
  }
}

export interface SendMessageInput {
  recipientId: string;
  type: string;
  body: string;
}

/** Compose + deliver one message (persisted + notified). */
export async function sendMessage(
  actor: MessageActor,
  input: SendMessageInput
): Promise<MessageServiceResult<MessageRow>> {
  const body = input.body.trim();
  if (!isMessageType(input.type)) {
    return { ok: false, message: "نوع الرسالة غير صالح", code: "VALIDATION_ERROR" };
  }
  if (body.length < 2 || body.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      message: `نص الرسالة مطلوب (حتى ${MAX_BODY_LENGTH} حرفًا)`,
      code: "VALIDATION_ERROR",
    };
  }
  if (!(await canSendTo(actor, input.recipientId))) {
    return {
      ok: false,
      message: "لا تملك صلاحية مراسلة هذا المعلم",
      code: "FORBIDDEN",
    };
  }

  const created = await db.teacherMessage.create({
    data: {
      senderId: actor.id,
      recipientId: input.recipientId,
      type: input.type,
      body,
    },
    select: messageSelect,
  });

  await notifyMessageReceived({
    recipientId: input.recipientId,
    messageId: created.id,
    senderName: created.sender.name,
    typeLabel: MESSAGE_TYPE_LABELS[isMessageType(created.type) ? created.type : "FOLLOW_UP"],
    preview: body.length > 140 ? `${body.slice(0, 139)}…` : body,
  });

  return { ok: true, data: toRow(created) };
}

/** The actor's inbox (received messages, newest first). */
export async function listInbox(userId: string): Promise<MessageRow[]> {
  const rows = await db.teacherMessage.findMany({
    where: { recipientId: userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: messageSelect,
  });
  return rows.map(toRow);
}

/** Messages the actor has sent (newest first). */
export async function listSent(senderId: string): Promise<MessageRow[]> {
  const rows = await db.teacherMessage.findMany({
    where: { senderId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: messageSelect,
  });
  return rows.map(toRow);
}

/** Ownership-safe mark-read (a foreign id matches nothing). */
export async function markMessageRead(
  userId: string,
  messageId: string
): Promise<boolean> {
  const result = await db.teacherMessage.updateMany({
    where: { id: messageId, recipientId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count > 0;
}

export async function unreadMessagesCount(userId: string): Promise<number> {
  return db.teacherMessage.count({ where: { recipientId: userId, readAt: null } });
}

export interface MessageRecipient {
  id: string;
  name: string;
  schoolName: string | null;
}

/**
 * The teachers this actor may message — the compose dialog list. The
 * list is resolved server-side from the actor's session scope.
 */
export async function composeRecipients(
  actor: MessageActor
): Promise<MessageRecipient[]> {
  switch (actor.role) {
    case "EDUCATIONAL_SUPERVISOR": {
      const scoped = await supervisorScopedTeacherRecords(actor.id);
      if (!scoped.ok) return [];
      return scoped.data
        .filter((teacher) => teacher.isActive)
        .map((teacher) => ({
          id: teacher.id,
          name: teacher.name,
          schoolName: teacher.school?.nameAr ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "ar"));
    }
    case "DEVELOPMENT_OFFICE_MANAGER": {
      if (!actor.schoolId) return [];
      const teachers = await db.user.findMany({
        where: { role: "TEACHER", isActive: true, schoolId: actor.schoolId },
        select: { id: true, name: true, school: { select: { nameAr: true } } },
        orderBy: { name: "asc" },
        take: 500,
      });
      return teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        schoolName: teacher.school?.nameAr ?? null,
      }));
    }
    case "SUPER_ADMIN": {
      const teachers = await db.user.findMany({
        where: { role: "TEACHER", isActive: true },
        select: { id: true, name: true, school: { select: { nameAr: true } } },
        orderBy: { name: "asc" },
        take: 500,
      });
      return teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        schoolName: teacher.school?.nameAr ?? null,
      }));
    }
    default:
      return [];
  }
}
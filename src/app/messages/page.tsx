import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";
import {
  composeRecipients,
  listInbox,
  listSent,
} from "@/lib/messages/service";
import { MessagesClient } from "@/app/messages/messages-client";

export const metadata = {
  title: "الرسائل | منارة قرطبة",
};

/**
 * Batch 2 — supervisor/office -> teacher messaging (HTML v38/v40
 * parity): the teacher inbox with the six original message types, the
 * sent view for senders, and the compose dialog limited to the actor's
 * real scope (resolved server-side).
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const user = await requireUser();
  const { to } = await searchParams;

  const canCompose =
    user.role === "EDUCATIONAL_SUPERVISOR" ||
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    user.role === "SUPER_ADMIN";

  const [inbox, sent, recipients] = await Promise.all([
    listInbox(user.id),
    canCompose ? listSent(user.id) : Promise.resolve([]),
    canCompose
      ? composeRecipients({
          id: user.id,
          role: user.role,
          schoolId: user.schoolId,
        })
      : Promise.resolve([]),
  ]);

  if (!canCompose && to) redirect("/messages");

  return (
    <div>
      <PageHeader
        title="الرسائل"
        description={
          canCompose
            ? "رسائل المعلمين إليك، وتوجيهاتك المهنية المرسلة — إرسال عبر المنصة بحسابات حقيقية."
            : "رسائلك من المشرف التربوي والمكتب — تظهر أيضًا في جرس الإشعارات."
        }
        breadcrumbs={[{ label: "الرئيسية" }, { label: "الرسائل" }]}
      />
      <MessagesClient
        inbox={inbox}
        sent={sent}
        recipients={recipients}
        canCompose={canCompose}
        prefillRecipientId={to ?? null}
      />
    </div>
  );
}
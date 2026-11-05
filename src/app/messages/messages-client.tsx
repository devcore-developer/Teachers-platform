"use client";

import * as React from "react";
import { CheckCheck, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/platform/empty-state";
import { MESSAGE_TYPES, MESSAGE_TYPE_LABELS } from "@/config/growth";
import type { MessageRecipient, MessageRow } from "@/lib/messages/service";
import {
  markMessageReadAction,
  sendMessageAction,
  type MessageActionState,
} from "@/app/actions/messages";

const initialState: MessageActionState = { ok: false };

function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("ar-EG", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Batch 2 — the messages surface: inbox + sent tabs, ownership-safe
 * mark-read, and the compose dialog (recipients resolved server-side;
 * the six original message types preserved verbatim).
 */
export function MessagesClient({
  inbox,
  sent,
  recipients,
  canCompose,
  prefillRecipientId,
}: {
  inbox: MessageRow[];
  sent: MessageRow[];
  recipients: MessageRecipient[];
  canCompose: boolean;
  prefillRecipientId: string | null;
}) {
  const { toast } = useToast();
  const [tab, setTab] = React.useState<"inbox" | "sent">("inbox");
  const [composeOpen, setComposeOpen] = React.useState(Boolean(prefillRecipientId));
  const [state, action, pending] = React.useActionState(sendMessageAction, initialState);
  const [readState, readAction, readPending] = React.useActionState(
    markMessageReadAction,
    initialState
  );

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast({ title: "أُرسلت ✅", description: state.message });
      setComposeOpen(false);
    }
  }, [state, toast]);

  const unread = inbox.filter((message) => message.readAt === null).length;
  const list = tab === "inbox" ? inbox : sent;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "inbox"}
            onClick={() => setTab("inbox")}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
              tab === "inbox" ? "bg-brand-600 text-white" : "border hover:bg-accent"
            }`}
          >
            الوارد {unread > 0 && `(${unread})`}
          </button>
          {canCompose && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "sent"}
              onClick={() => setTab("sent")}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
                tab === "sent" ? "bg-brand-600 text-white" : "border hover:bg-accent"
              }`}
            >
              المرسلة ({sent.length})
            </button>
          )}
        </div>
        {canCompose && (
          <Button
            type="button"
            onClick={() => setComposeOpen((open) => !open)}
            className="rounded-xl"
          >
            <Send className="size-4" aria-hidden="true" />
            رسالة جديدة
          </Button>
        )}
      </div>

      {canCompose && composeOpen && (
        <form
          action={action}
          className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm"
        >
          <p className="text-sm font-black">✉ رسالة إلى المعلم</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="recipientId">المعلم</Label>
              <select
                id="recipientId"
                name="recipientId"
                defaultValue={prefillRecipientId ?? ""}
                required
                className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  اختر المعلم…
                </option>
                {recipients.map((recipient) => (
                  <option key={recipient.id} value={recipient.id}>
                    {recipient.name}
                    {recipient.schoolName ? ` — ${recipient.schoolName}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type">نوع الرسالة</Label>
              <select
                id="type"
                name="type"
                defaultValue="FOLLOW_UP"
                className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
              >
                {MESSAGE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {MESSAGE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="body">نص الرسالة</Label>
            <textarea
              id="body"
              name="body"
              required
              minLength={2}
              maxLength={2000}
              rows={4}
              placeholder="اكتب الرسالة للمعلم…"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
            />
          </div>
          {state.message && !state.ok && (
            <p className="rounded-lg bg-error-soft px-3 py-2 text-sm text-error">
              {state.message}
            </p>
          )}
          <Button type="submit" disabled={pending} className="rounded-xl">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            ✓ إرسال عبر المنصة
          </Button>
        </form>
      )}

      <div className="rounded-2xl border bg-card shadow-sm">
        {list.length === 0 ? (
          <EmptyState
            icon={Send}
            title={tab === "inbox" ? "لا توجد رسائل واردة" : "لم ترسل رسائل بعد"}
            description={
              tab === "inbox"
                ? "ستظهر رسائل المشرف التربوي والمكتب هنا وتصلك إشعارات فورية."
                : "اختر «رسالة جديدة» وأرسل توجيهًا مهنيًا لأحد معلميك."
            }
          />
        ) : (
          <ul className="divide-y" role="list">
            {list.map((message) => (
              <li
                key={message.id}
                className={
                  tab === "inbox" && message.readAt === null
                    ? "bg-brand-50/60 p-4"
                    : "p-4"
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black">
                      <span className="rounded-lg bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">
                        {message.typeLabel}
                      </span>
                      <span className="ms-2">
                        {tab === "inbox" ? `من: ${message.senderName}` : `إلى: ${message.recipientName}`}
                      </span>
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                      {message.body}
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {formatDate(message.createdAt)}
                      {message.readAt ? " · تمت القراءة" : " · غير مقروءة"}
                    </p>
                  </div>
                  {tab === "inbox" && message.readAt === null && (
                    <form action={readAction}>
                      <input type="hidden" name="messageId" value={message.id} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        disabled={readPending}
                        className="rounded-xl"
                      >
                        {readPending ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <CheckCheck className="size-3.5" aria-hidden="true" />
                        )}
                        تحديد كمقروءة
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
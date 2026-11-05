"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Batch 1 — real, persisted notification bell.
 *
 * Replaces the demo topbar data: reads the session-scoped notifications
 * API (GET /api/notifications), polls while mounted, marks rows read
 * through the same owner-scoped API, and navigates each notification to
 * its server-built internal destination (course deep links carry the
 * REAL course id — the original HTML passed unrelated values).
 */

interface BellNotification {
  id: string;
  title: string;
  description?: string;
  time: string;
  read: boolean;
  url: string | null;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<BellNotification[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        unread: number;
        items: BellNotification[];
      };
      setItems(payload.items ?? []);
      setUnread(payload.unread ?? 0);
      setLoaded(true);
    } catch {
      // Network hiccup — keep the previous list; the poll retries.
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function post(action: "markAll" | "markRead", id?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      await load();
      router.refresh();
    } catch {
      // ignore — the next poll re-syncs
    } finally {
      setBusy(false);
    }
  }

  function openNotification(notification: BellNotification) {
    if (!notification.read) {
      void post("markRead", notification.id);
    }
    setOpen(false);
    if (notification.url && notification.url.startsWith("/")) {
      router.push(notification.url);
    } else {
      router.push("/notifications");
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`الإشعارات${unread > 0 ? ` (${unread} غير مقروءة)` : ""}`}
          onClick={() => void load()}
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span
              className="absolute end-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-error text-[10px] font-bold text-white"
              aria-hidden="true"
            >
              {unread > 9 ? "٩+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,92vw)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-bold">الإشعارات</p>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void post("markAll")}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50"
            >
              <CheckCheck className="size-3.5" aria-hidden="true" />
              تحديد الكل كمقروء
            </button>
          )}
        </div>
        <ul className="scrollbar-thin max-h-80 overflow-y-auto" role="list">
          {!loaded ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              جارٍ تحميل الإشعارات…
            </li>
          ) : items.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              لا توجد إشعارات حالياً
            </li>
          ) : (
            items.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={cn(
                    "flex w-full items-start gap-2.5 border-b px-4 py-3 text-start transition-colors last:border-b-0 hover:bg-accent",
                    !notification.read && "bg-brand-50/70"
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      notification.read ? "bg-muted" : "bg-brand-600"
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug">
                      {notification.title}
                    </span>
                    {notification.description && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {notification.description}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-muted-foreground/70">
                      {notification.time}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t px-4 py-2.5 text-center">
          <Link
            href="/notifications"
            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
            onClick={() => setOpen(false)}
          >
            عرض جميع الإشعارات
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
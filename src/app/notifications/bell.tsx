"use client";

/**
 * Phase 11 — notification bell with dropdown (client component).
 *
 * - Polls the unread count every 60 seconds and on window focus.
 * - Fetches the latest items when opened; mark-read on click then
 *   navigates to the notification's validated internal destination.
 * - Mark-all-as-read available in the dropdown header.
 * - Explicit loading / empty / error states (never a fake list).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface BellItem {
  id: string;
  titleAr: string;
  bodyAr: string;
  destinationUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSeconds = Math.floor((Date.now() - then) / 1000);
  if (diffSeconds < 60) return "الآن";
  if (diffSeconds < 3600) return `قبل ${Math.floor(diffSeconds / 60)} دقيقة`;
  if (diffSeconds < 86400) return `قبل ${Math.floor(diffSeconds / 3600)} ساعة`;
  return `قبل ${Math.floor(diffSeconds / 86400)} يوم`;
}

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BellItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshUnread = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/unread-count", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { ok: boolean; data?: { count: number } };
      if (payload.ok && payload.data) setUnread(payload.data.count);
    } catch {
      // Silent for background polling — the UI keeps the last honest value.
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/notifications?limit=8", { cache: "no-store" });
      if (response.status === 401) {
        setError("الجلسة منتهية — سجّل الدخول من جديد");
        setItems(null);
        return;
      }
      if (!response.ok) throw new Error("failed");
      const payload = (await response.json()) as { ok: boolean; data?: { items: BellItem[] } };
      if (payload.ok && payload.data) {
        setItems(payload.data.items);
      } else {
        throw new Error("failed");
      }
    } catch {
      setError("تعذّر تحميل الإشعارات — تحقق من الاتصال وأعد المحاولة");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refreshUnread, 60_000);
    const onFocus = () => refreshUnread();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshUnread]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setItems(null);
      loadItems();
      refreshUnread();
    }
  };

  const markReadAndNavigate = async (item: BellItem) => {
    setBusyId(item.id);
    try {
      if (!item.readAt) {
        await fetch(`/api/notifications/${item.id}/read`, { method: "POST" });
        setUnread((value) => Math.max(0, value - 1));
      }
      setOpen(false);
      if (item.destinationUrl) {
        router.push(item.destinationUrl);
      } else {
        router.push("/notifications");
      }
    } finally {
      setBusyId(null);
    }
  };

  const markAll = async () => {
    setBusyId("*");
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
      setUnread(0);
      await loadItems();
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={`الإشعارات — ${unread} غير مقروءة`}
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-[#1D5BD6] hover:text-[#1D5BD6]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -left-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1D5BD6] px-1 text-[10px] font-bold text-white" dir="ltr">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            <div className="text-sm font-bold text-slate-800">الإشعارات</div>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={markAll}
                disabled={busyId !== null || unread === 0}
                className="font-semibold text-[#1D5BD6] hover:underline disabled:text-slate-400 disabled:no-underline"
              >
                تحديد الكل كمقروء
              </button>
              <Link href="/notifications" className="font-semibold text-slate-500 hover:text-[#1D5BD6]">
                جميع الإشعارات
              </Link>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="animate-pulse rounded-lg bg-slate-100 p-3">
                    <div className="h-3 w-2/3 rounded bg-slate-200" />
                    <div className="mt-2 h-3 w-full rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            )}

            {!loading && error && (
              <div className="p-4">
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
                <button
                  type="button"
                  onClick={loadItems}
                  className="mt-2 text-xs font-semibold text-[#1D5BD6] hover:underline"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}

            {!loading && !error && items !== null && items.length === 0 && (
              <div className="p-6 text-center">
                <p className="text-sm font-semibold text-slate-600">لا توجد إشعارات بعد</p>
                <p className="mt-1 text-xs text-slate-400">ستظهر هنا تحديثات الواجبات والاختبارات والشهادات والمتابعات</p>
              </div>
            )}

            {!loading && !error && items !== null && items.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => markReadAndNavigate(item)}
                      disabled={busyId !== null}
                      className={`flex w-full items-start gap-2 px-4 py-3 text-right transition hover:bg-slate-50 disabled:opacity-60 ${
                        item.readAt ? "" : "bg-blue-50/40"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-slate-200" : "bg-[#1D5BD6]"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-800">{item.titleAr}</span>
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-slate-500">{item.bodyAr}</span>
                        <span className="mt-1 block text-[10px] text-slate-400">{timeAgo(item.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-center">
            <Link href="/notifications/preferences" className="text-[11px] font-semibold text-slate-500 hover:text-[#1D5BD6]">
              تفضيلات الإشعارات
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
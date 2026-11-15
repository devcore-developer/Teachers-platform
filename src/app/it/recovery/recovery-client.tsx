"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { KeyRound, Loader2, Search, Send } from "lucide-react";

import { issueRecoveryLinkAction, type ItActionState } from "@/app/actions/it";
import type { ItWorkspaceData } from "@/lib/it/service";
import { StatusBadge } from "@/components/platform/status-badge";

function RecoveryButton({ teacherName }: { teacherName: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
      aria-label={`إرسال رابط استعادة للمعلم ${teacherName}`}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Send className="size-3.5" aria-hidden="true" />
      )}
      {pending ? "جارٍ الإرسال…" : "إرسال رابط الاستعادة"}
    </button>
  );
}

function RecoveryRow({
  teacherId,
  teacherName,
  teacherEmail,
  isActive,
}: {
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = React.useActionState<ItActionState | null, FormData>(
    issueRecoveryLinkAction,
    null
  );

  React.useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, router]);

  return (
    <li className="border-b p-4 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold">
            {teacherName}
            <StatusBadge tone={isActive ? "success" : "neutral"}>
              {isActive ? "نشط" : "موقوف"}
            </StatusBadge>
          </p>
          <p className="text-xs text-muted-foreground" dir="ltr">
            {teacherEmail}
          </p>
        </div>
        <form action={formAction}>
          <input type="hidden" name="teacherId" value={teacherId} />
          <RecoveryButton teacherName={teacherName} />
        </form>
      </div>
      {state?.message && (
        <p
          role="status"
          className={
            state.ok
              ? "mt-3 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-xs font-semibold text-success"
              : "mt-3 rounded-lg border border-error/30 bg-error-soft px-3 py-2 text-xs font-semibold text-error"
          }
        >
          {state.message}
          {state.ok && state.emailSent && state.maskedEmail && (
            <span className="ms-1" dir="ltr">
              ({state.maskedEmail})
            </span>
          )}
        </p>
      )}
    </li>
  );
}

export function RecoveryClient({
  data,
  initialQuery,
}: {
  data: ItWorkspaceData | null;
  initialQuery: { q: string };
}) {
  if (!data) {
    return (
      <p className="rounded-xl border border-error/30 bg-error-soft px-4 py-3 text-sm font-semibold text-error">
        تعذّر تحميل قائمة المعلمين — تحقق من معايير البحث ثم أعد المحاولة.
      </p>
    );
  }

  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (initialQuery.q) params.set("q", initialQuery.q);
    params.set("page", String(page));
    return `/it/recovery?${params.toString()}`;
  };

  return (
    <div className="space-y-5">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label
            htmlFor="it-recovery-q"
            className="mb-1 block text-xs font-semibold text-muted-foreground"
          >
            بحث بالاسم أو البريد
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="it-recovery-q"
              name="q"
              defaultValue={initialQuery.q}
              placeholder="اسم المعلم أو بريده…"
              className="h-10 w-full rounded-xl border border-input bg-background ps-9 text-sm outline-none focus-visible:border-ring"
            />
          </div>
        </div>
        <button
          type="submit"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white transition-colors hover:bg-brand-700"
        >
          <Search className="size-4" aria-hidden="true" />
          بحث
        </button>
      </form>

      <div className="rounded-xl border">
        <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm font-bold">
            <KeyRound className="size-4 text-brand-600" aria-hidden="true" />
            معلمو مدرستك ({data.total})
          </p>
          <p className="text-xs text-muted-foreground">
            صفحة {data.page} من {data.pageCount}
          </p>
        </div>
        {data.rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            لا توجد نتائج مطابقة — جرّب تعديل البحث.
          </p>
        ) : (
          <ul className="divide-y-0" role="list">
            {data.rows.map((teacher) => (
              <RecoveryRow
                key={teacher.id}
                teacherId={teacher.id}
                teacherName={teacher.name}
                teacherEmail={teacher.email}
                isActive={teacher.isActive}
              />
            ))}
          </ul>
        )}
      </div>

      {data.pageCount > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="تنقل الصفحات">
          {data.page > 1 && (
            <Link
              href={pageHref(data.page - 1)}
              className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-accent"
            >
              السابق
            </Link>
          )}
          <span className="text-xs text-muted-foreground">
            {data.page} / {data.pageCount}
          </span>
          {data.page < data.pageCount && (
            <Link
              href={pageHref(data.page + 1)}
              className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-accent"
            >
              التالي
            </Link>
          )}
        </nav>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        الروابط تُرسل حصريًا إلى بريد المعلم المسجل — لا تُعرض أي كلمات مرور
        أو روابط في هذه الشاشة. الحساب الموقوف يتطلب تفعيله من إدارة المدرسة
        أولًا قبل إصدار روابط الاستعادة.
      </p>
    </div>
  );
}
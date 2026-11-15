"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  Copy,
  History,
  Link2,
  Loader2,
  Plus,
  ShieldAlert,
  UserCheck,
  UserRoundCheck,
  XCircle,
} from "lucide-react";

import {
  createRegistrationLinkAction,
  revokeRegistrationLinkAction,
  type RegistrationLinkActionState,
} from "@/app/actions/registration-links";
import type {
  RegistrationLinksView,
  RegistrationStats,
} from "@/lib/registration-links/service";
import { StatusBadge } from "@/components/platform/status-badge";

/* ------------------------------------------------------------------ */
/* Registration-link manager (client presentation only).                */
/* The raw link URL exists ONLY in the creation response — shown in a   */
/* copy-once panel; the DB stores its SHA-256 hash exclusively.         */
/* ------------------------------------------------------------------ */

function CreateButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Plus className="size-4" aria-hidden="true" />
      )}
      {pending ? "جارٍ التوليد…" : label}
    </button>
  );
}

function CopyPanel({ linkUrl }: { linkUrl: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(linkUrl);
    } catch {
      // Clipboard API can be unavailable (permissions / non-secure
      // contexts) — fall back to the classic selection method.
      const el = document.createElement("textarea");
      el.value = linkUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="rounded-xl border border-brand-300 bg-brand-50/70 p-4">
      <p className="flex items-center gap-2 text-sm font-extrabold text-brand-800">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        تم توليد رابط التسجيل — انسخه الآن
      </p>
      <p className="mt-1 text-xs leading-relaxed text-brand-700">
        لأسباب أمنية يُعرض الرابط مرة واحدة فقط ولا يُخزن إلا مشفّرًا. إذا
        فقدته، ولّد رابطًا جديدًا (سيُلغى الرابط الحالي تلقائيًا).
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code
          dir="ltr"
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border bg-white px-3 py-2 text-xs text-slate-700"
        >
          {linkUrl}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white transition-colors hover:bg-brand-700"
        >
          {copied ? (
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copied ? "تم النسخ" : "نسخ"}
        </button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
  icon,
}: {
  label: string;
  value: number;
  tone?: "default" | "warn" | "good" | "info";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "warn"
      ? "text-amber-600"
      : tone === "good"
        ? "text-emerald-600"
        : tone === "info"
          ? "text-brand-700"
          : "";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon && <span className="text-brand-600">{icon}</span>}
        {label}
      </div>
      <p className={`mt-1.5 text-2xl font-extrabold tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}

function linkStateLabel(row: {
  isActive: boolean;
  expiresAt: Date | null;
}): { label: string; tone: "success" | "neutral" | "warning" } {
  const expired =
    row.expiresAt !== null && row.expiresAt.getTime() <= Date.now();
  if (row.isActive && !expired) return { label: "نشط", tone: "success" };
  if (row.isActive && expired) return { label: "منتهي الصلاحية", tone: "warning" };
  return { label: "ملغى", tone: "neutral" };
}

const formatDate = (d: Date | null | undefined) =>
  d
    ? d.toLocaleDateString("ar-EG", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

export function LinkManager({
  view,
  stats,
}: {
  view: RegistrationLinksView;
  stats: RegistrationStats;
}) {
  const router = useRouter();
  const [createState, createAction] = React.useActionState<
    RegistrationLinkActionState | null,
    FormData
  >(createRegistrationLinkAction, null);
  const [revokeState, revokeAction] = React.useActionState<
    RegistrationLinkActionState | null,
    FormData
  >(revokeRegistrationLinkAction, null);

  React.useEffect(() => {
    if (createState?.ok || revokeState?.ok) router.refresh();
  }, [createState?.ok, revokeState?.ok, router]);

  const activeLink = view.links.find((l) => l.isActive) ?? null;
  const activeExpired =
    activeLink?.expiresAt !== undefined &&
    activeLink?.expiresAt !== null &&
    (activeLink?.expiresAt?.getTime() ?? 0) <= Date.now();

  return (
    <div className="space-y-6">
      {/* Registration stats — Phase 6 school-level visibility */}
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-5"
        aria-label="إحصائيات تسجيل المعلمين"
      >
        <StatCard
          label="إجمالي المعلمين"
          value={stats.totalTeachers}
          icon={<UserRoundCheck className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="عبر روابط التسجيل"
          value={stats.viaLinks}
          tone="info"
          icon={<Link2 className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="بانتظار توثيق البريد"
          value={stats.awaitingVerification}
          tone="warn"
          icon={<ShieldAlert className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="بانتظار إسناد المشرف"
          value={stats.verifiedUnassigned}
          tone="warn"
          icon={<UserCheck className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="مُسنَدون لمشرف"
          value={stats.assigned}
          tone="good"
          icon={<BadgeCheck className="size-4" aria-hidden="true" />}
        />
      </div>

      {!view.schoolIsActive && (
        <p className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          المدرسة غير مفعّلة حاليًا — التفعيل شرط لقبول أي تسجيلات جديدة حتى
          مع وجود رابط نشط.
        </p>
      )}

      {/* Active link card */}
      <div className="rounded-2xl border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-extrabold">
              <Link2 className="size-4 text-brand-600" aria-hidden="true" />
              رابط التسجيل الحالي — {view.schoolName}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              رابط واحد نشط لكل مدرسة. توليد رابط جديد يُلغي الرابط السابق
              تلقائيًا دون أي تأثير على المعلمين المسجلين سابقًا.
            </p>
          </div>
          {activeLink && (
            <StatusBadge tone={activeExpired ? "warning" : "success"}>
              {activeExpired ? "منتهي الصلاحية" : "نشط — يقبل التسجيلات"}
            </StatusBadge>
          )}
        </div>

        <div className="mt-4">
          {activeLink ? (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <p>
                <span className="text-muted-foreground">أنشئ في: </span>
                <span className="font-bold">{formatDate(activeLink.createdAt)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">الصلاحية: </span>
                <span className="font-bold">
                  {activeLink.expiresAt
                    ? `حتى ${formatDate(activeLink.expiresAt)}`
                    : "ساري حتى الإلغاء"}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">مسجلون عبره: </span>
                <span className="font-bold tabular-nums">
                  {activeLink.registrationsCount}
                </span>
              </p>
              <form action={revokeAction}>
                <input type="hidden" name="linkId" value={activeLink.id} />
                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-error/40 px-3 text-xs font-bold text-error transition-colors hover:bg-error-soft disabled:opacity-60"
                >
                  <Ban className="size-3.5" aria-hidden="true" />
                  إلغاء الرابط
                </button>
              </form>
            </div>
          ) : (
            <p className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              لا يوجد رابط نشط حاليًا — ولّد رابطًا لمشاركته مع المعلمين الجدد.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
          <form action={createAction} className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              مدة الصلاحية
              <select
                name="expiresInDays"
                defaultValue=""
                className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
              >
                <option value="">حتى الإلغاء</option>
                <option value="7">أسبوع</option>
                <option value="30">30 يومًا</option>
                <option value="90">90 يومًا</option>
              </select>
            </label>
            <CreateButton
              label={activeLink ? "توليد رابط جديد (يلغي الحالي)" : "توليد رابط تسجيل"}
            />
          </form>
        </div>

        {revokeState?.message && !revokeState.ok && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-error/30 bg-error-soft px-4 py-3 text-sm font-semibold text-error"
          >
            {revokeState.message}
          </p>
        )}
        {revokeState?.ok && (
          <p
            role="status"
            className="mt-3 rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold text-success"
          >
            {revokeState.message}
          </p>
        )}
        {createState?.ok && createState.linkUrl ? (
          <div className="mt-3">
            <CopyPanel linkUrl={createState.linkUrl} />
          </div>
        ) : createState && !createState.ok ? (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-error/30 bg-error-soft px-4 py-3 text-sm font-semibold text-error"
          >
            {createState.message}
          </p>
        ) : null}
      </div>

      {/* Link history */}
      <div className="rounded-2xl border bg-card shadow-xs">
        <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
          <History className="size-4 text-brand-600" aria-hidden="true" />
          <h2 className="text-sm font-extrabold">سجل الروابط</h2>
        </div>
        {view.links.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            لم تُنشأ روابط تسجيل لهذه المدرسة بعد.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-start font-semibold">الحالة</th>
                  <th className="px-4 py-2.5 text-start font-semibold">تاريخ الإنشاء</th>
                  <th className="px-4 py-2.5 text-start font-semibold">الصلاحية</th>
                  <th className="px-4 py-2.5 text-start font-semibold">مسجلون عبره</th>
                  <th className="px-4 py-2.5 text-start font-semibold">آخر تسجيل</th>
                  <th className="px-4 py-2.5 text-start font-semibold">بواسطة</th>
                </tr>
              </thead>
              <tbody>
                {view.links.map((row) => {
                  const state = linkStateLabel(row);
                  return (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-xs">{formatDate(row.createdAt)}</td>
                      <td className="px-4 py-3 text-xs">
                        {row.expiresAt ? formatDate(row.expiresAt) : "حتى الإلغاء"}
                      </td>
                      <td className="px-4 py-3 text-xs font-bold tabular-nums">
                        {row.registrationsCount}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {formatDate(row.lastRegistrationAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.createdByName ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        تدفق العمل: ولّد الرابط ← شاركه مع المعلمين الجدد ← يسجّل المعلم عبره
        ويُربط بمدرستك تلقائيًا ← يؤكد بريده ← يُسند إليه المشرف التربوي من
        تقنية المعلومات ← يصبح مؤهلًا لاستخدام المنصة وفق قواعد الإسناد.
      </p>
    </div>
  );
}
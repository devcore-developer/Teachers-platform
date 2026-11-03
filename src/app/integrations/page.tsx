/**
 * Phase 11 — /integrations — حالة التكاملات (role-scoped, secret-free).
 *
 * SUPER_ADMIN: provider configuration state (booleans + non-secret
 * from-address + documented env-var names) and PLATFORM-wide delivery
 * health. DEVELOPMENT_OFFICE_MANAGER: delivery health for their school
 * only. EDUCATIONAL_DEPUTY: read-only aggregate for granted schools.
 * Supervisors/Teachers: access denied (they have preferences instead).
 *
 * Nothing here can expose a secret: keys are rendered as
 * configured/not-configured, emails are masked, and delivery rows carry
 * sanitized error categories only.
 */

import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { toAnalyticsActor } from "@/lib/analytics/access";
import {
  getDeliveryHealth,
  getPlatformIntegrationStatus,
  type PlatformIntegrationStatus,
} from "@/lib/integrations/status";
import { AccessDenied, Card, EmptyState, PageHeader, StatTile } from "@/app/assignments/ui";
import { DataTable } from "@/app/dashboard/ui";
import { formatNotificationDate } from "@/app/notifications/ui";

export const dynamic = "force-dynamic";

function StatusPill({ ok, okLabel, failLabel }: { ok: boolean; okLabel: string; failLabel: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${
        ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {ok ? okLabel : failLabel}
    </span>
  );
}

function ProviderCards({ status }: { status: PlatformIntegrationStatus }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="إعدادات البريد الإلكتروني">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-600">مزوّد الإرسال</span>
            <StatusPill
              ok={status.email.configured}
              okLabel="مُهيأ — Resend"
              failLabel="غير مُهيأ"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-600">عنوان المُرسل</span>
            <span className="text-xs font-semibold text-slate-700" dir="ltr">
              {status.email.fromAddress ?? "—"}
            </span>
          </div>
          {status.email.configured ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-700">
              مفتاح الواجهة البرمجية محفوظ في متغيرات البيئة على الخادم ولا يُعرض أبدًا. حالات
              الإرسال تُسجَّل بصدق بعد كل محاولة.
            </p>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
              <p>
                لتفعيل الإرسال أضف متغيّري البيئة: <code dir="ltr" className="font-bold">RESEND_API_KEY</code> و{" "}
                <code dir="ltr" className="font-bold">EMAIL_FROM</code> (واختياريًا{" "}
                <code dir="ltr" className="font-bold">EMAIL_REPLY_TO</code>) ثم أعد تشغيل الخدمة.
              </p>
              <p className="mt-1">التفاصيل في <code dir="ltr">docs/notifications.md</code>. لن تُرسل أي رسائل فعلية قبل التهيئة — وستظهر ذلك بصدق.</p>
            </div>
          )}
        </div>
      </Card>

      <Card title="المجدول والمهام الخلفية">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-600">سر نقطة المجدول</span>
            <StatusPill ok={status.scheduler.cronSecretConfigured} okLabel="مُضبوط" failLabel="غير مُضبوط" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-600">عنوان النشر العام (روابط البريد)</span>
            <StatusPill ok={status.scheduler.appOriginConfigured} okLabel="مُضبوط" failLabel="غير مُضبوط" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-600">المجدول الداخلي (احتياطي)</span>
            <StatusPill
              ok={status.scheduler.internalSchedulerEnabled}
              okLabel="مُفعّل"
              failLabel="معطّل (يُوصى بمجدول خارجي)"
            />
          </div>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            التشغيل الموثوق: جدول خارجي يستدعي <code dir="ltr" className="font-bold">POST /api/cron/dispatch</code> مع الترويسة{" "}
            <code dir="ltr" className="font-bold">x-cron-secret</code>. بدون CRON_SECRET ترفض النقطة العمل بخطأ 503.
          </p>
        </div>
      </Card>
    </div>
  );
}

export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  const actor = user ? toAnalyticsActor(user) : null;
  if (!user || !actor) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد" />;
  }

  const health = await getDeliveryHealth(actor);
  const platformStatus = getPlatformIntegrationStatus();

  if (!health.ok) {
    return <AccessDenied hint={health.message} />;
  }

  const canSeeProviderConfig = actor.role === "SUPER_ADMIN";
  const totals = health.data.totals;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader
        title="حالة التكاملات"
        subtitle={
          health.data.scope === "PLATFORM"
            ? "حالة تكاملات المنصة ومؤشرات تسليم البريد — بيانات مجمّعة دون الاطلاع على محتوى الرسائل"
            : "مؤشرات تسليم البريد داخل نطاق مدرستك — دون إظهار بيانات مدارس أخرى"
        }
        actions={
          <Link
            href="/notifications"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#1D5BD6] hover:text-[#1D5BD6]"
          >
            الإشعارات
          </Link>
        }
      />

      {canSeeProviderConfig ? (
        <div className="mb-4">
          <ProviderCards status={platformStatus} />
        </div>
      ) : (
        <p className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-600">
          إعدادات مزوّد البريد على مستوى المنصة تديرها إدارة المنصة (المدير الأعلى) — هذه الصفحة تعرض
          مؤشرات التسليم داخل نطاقك فقط.
        </p>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="تم الإرسال" value={totals.SENT ?? 0} tone="success" hint="رسائل أكدها المزوّد" />
        <StatTile label="في قائمة الانتظار" value={totals.QUEUED ?? 0} tone="brand" hint="بانتظار محاولة إرسال" />
        <StatTile label="قيد المعالجة" value={totals.PROCESSING ?? 0} hint="محاولة جارية الآن" />
        <StatTile label="فشل الإرسال" value={totals.FAILED ?? 0} tone="warning" hint="بعد استنفاد المحاولات أو خطأ دائم" />
      </div>

      <Card title="أحدث حالات الفشل (لأغراض التشخيص المصرّح به)">
        {health.data.recentFailures.length === 0 ? (
          <EmptyState title="لا توجد حالات فشل" hint="لم يُسجَّل أي فشل تسليم في النطاق المعروض حتى الآن." />
        ) : (
          <DataTable headers={["الرسالة", "المستلم", "التصنيف", "المحاولات", "المعرّف لدى المزوّد", "آخر محاولة"]}>
            {health.data.recentFailures.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2">
                  <span className="block max-w-60 truncate font-semibold text-slate-700">{row.subject}</span>
                  <span className="text-[10px] text-slate-400" dir="ltr">{row.template}</span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600" dir="ltr">{row.toEmailMasked}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                    {row.errorCategoryLabel ?? row.errorCategory ?? "—"}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600" dir="ltr">{row.attemptCount}/{row.maxAttempts}</td>
                <td className="px-3 py-2 text-[10px] text-slate-400" dir="ltr">
                  {row.providerMessageId ? `${row.provider} · ${row.providerMessageId}` : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500" dir="ltr">
                  {formatNotificationDate(row.lastAttemptAt)}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
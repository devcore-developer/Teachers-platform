/**
 * Phase 11 — /notifications/preferences — user preference management.
 * Preferences are persisted and enforced server-side; this page only
 * edits them. The email-provider configuration state is shown HONESTLY:
 * when no provider is configured the user is told clearly instead of
 * being led to believe emails will arrive.
 */

import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getOrCreatePreferences } from "@/lib/notifications/service";
import { getPlatformIntegrationStatus } from "@/lib/integrations/status";
import { AccessDenied, Card, PageHeader } from "@/app/assignments/ui";
import { PreferencesForm } from "@/app/notifications/preferences/preferences-form";

export const dynamic = "force-dynamic";

export default async function NotificationPreferencesPage() {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد لإدارة تفضيلاتك" />;
  }

  const [preferences, platformStatus] = await Promise.all([
    getOrCreatePreferences(user.id),
    Promise.resolve(getPlatformIntegrationStatus()),
  ]);
  const emailConfigured = platformStatus.email.configured;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <PageHeader
        title="تفضيلات الإشعارات"
        subtitle="اختر ما يصلك وكيف — تُطبَّق اختياراتك على الخادم فورًا"
        actions={
          <Link
            href="/notifications"
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#1D5BD6] hover:text-[#1D5BD6]"
          >
            جميع الإشعارات
          </Link>
        }
      />

      {!emailConfigured && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-800">إعدادات البريد الإلكتروني</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-700">
            خدمة إرسال البريد غير مُهيأة حاليًا على هذا النشر (لم يُضبط مزوّد البريد). تفضيلاتك
            تُحفظ وتُطبَّق عند تهيئة الخدمة، لكن لن تصل رسائل بريد فعلية في الوقت الراهن. رسائل
            الأمان كذلك ستظهر حالتها بصدق في صفحة حالة التكاملات.
          </p>
        </div>
      )}

      <Card>
        <PreferencesForm preferences={preferences} />
      </Card>
    </div>
  );
}
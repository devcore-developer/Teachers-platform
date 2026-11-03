/**
 * Phase 11 — /account/reset-password — public single-use reset flow.
 * Consuming the token rotates the password, bumps tokenVersion (all
 * sessions invalidated) and fires the PASSWORD_CHANGED security notice.
 */

import { Card } from "@/app/assignments/ui";
import { ResetPasswordForm } from "@/app/account/reset-password/reset-password-form";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = (params.token ?? "").trim();

  return (
    <div className="mx-auto max-w-md p-6">
      <Card title="إعادة تعيين كلمة المرور">
        {token ? (
          <>
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              اختر كلمة مرور جديدة (8 أحرف على الأقل). سيتم إنهاء جميع الجلسات النشطة تلقائيًا
              بعد التغيير حفاظًا على أمان حسابك.
            </p>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700">
            لا يوجد رابط إعادة تعيين صالح في هذه الصفحة. افتح الرابط كما وصلك في بريدك الإلكتروني.
          </p>
        )}
      </Card>
    </div>
  );
}
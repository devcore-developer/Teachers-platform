/**
 * Phase 11 — /account/forgot-password — public password-reset request.
 * Anti-enumeration: identical response for existing/unknown emails, with
 * an explicit honest note when the email provider is not configured.
 */

import { Card } from "@/app/assignments/ui";
import { ForgotPasswordForm } from "@/app/account/forgot-password/forgot-password-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-md p-6">
      <Card title="استعادة كلمة المرور">
        <p className="mb-4 text-xs leading-relaxed text-slate-500">
          أدخل بريدك الإلكتروني المسجل في المنصة وسنرسل لك رابطًا صالحًا لساعة واحدة ولمرة واحدة
          فقط. لن يخبرك النظام أبدًا إن كان البريد مسجلًا أم لا — حفاظًا على خصوصية الحسابات.
        </p>
        <ForgotPasswordForm />
      </Card>
    </div>
  );
}
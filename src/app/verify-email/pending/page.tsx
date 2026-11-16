import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ShieldAlert } from "lucide-react";

import { AuthCard } from "@/components/auth/auth-card";
import { resolvePublicBranding } from "@/lib/branding";
import { ResendVerificationForm } from "./resend-form";

export const metadata = {
  title: "بانتظار توثيق البريد | منارة قرطبة",
};

export const dynamic = "force-dynamic";

/**
 * Post-registration pending-verification screen — the redirect target
 * of `registerAction` (/verify-email/pending?email=…&sent=1|0). Generic
 * by design: the `sent=0` variant never discloses whether an account
 * exists (duplicate-suppressed registrations land on the same screen),
 * and the resend action answers with the same no-existence-leak
 * message for every address.
 */
export default async function VerifyEmailPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; sent?: string; school?: string }>;
}) {
  const { email: rawEmail, sent, school } = await searchParams;
  const resolved = await resolvePublicBranding(school);
  const wrapperStyle = resolved.cssVars as CSSProperties;

  const email = (rawEmail ?? "").trim().slice(0, 200);
  const wasSent = sent === "1";

  return (
    <div style={wrapperStyle}>
      <AuthCard
        branding={resolved.branding}
        className="max-w-md"
        compact
        title="بانتظار توثيق بريدك الإلكتروني"
        description="توثيق البريد شرط تفعيل الدخول — خطوة واحدة وتصبح جاهزًا للانطلاق."
      >
        {wasSent ? (
          <div className="rounded-xl border border-brand-300/60 bg-brand-50 p-5 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
              <CheckCircle2 className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-extrabold text-brand-800">
              أنشئنا حسابك — أرسلنا رسالة توثيق إلى بريدك
            </p>
            {email && (
              <p className="mt-1 text-xs font-bold text-brand-700" dir="ltr">
                {email}
              </p>
            )}
            <p className="mt-1.5 text-xs leading-relaxed text-brand-700">
              افتح الرسالة واضغط زر تأكيد البريد، ثم عد إلى صفحة تسجيل الدخول.
              إن لم تجد الرسالة فتفقّد مجلد الرسائل غير المرغوبة.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-5 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <ShieldAlert className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-extrabold text-amber-800">
              لم نتمكن من إرسال رسالة التوثيق الآن
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-amber-700">
              قد يكون هذا البريد مسجلًا لدينا مسبقًا أو تعذر الإرسال مؤقتًا —
              استخدم زر إعادة الإرسال أدناه، أو تواصل مع إدارة مدرستك إن تكرر
              الأمر.
            </p>
          </div>
        )}

        {email && <ResendVerificationForm email={email} />}

        <Link
          href="/login"
          className="block rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-center text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100"
        >
          الانتقال إلى تسجيل الدخول
        </Link>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          بعد توثيق بريدك سجّل الدخول، ثم يُسندك مشرفك التربوي من تقنية
          المعلومات لتصبح مؤهلًا لاستخدام المنصة وفق قواعد الإسناد.
        </p>
      </AuthCard>
    </div>
  );
}
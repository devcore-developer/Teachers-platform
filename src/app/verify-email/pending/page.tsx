import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerificationForm } from "./resend-form";

export const dynamic = "force-dynamic";

interface PendingPageProps {
  /** registerAction redirects here: ?email=...&sent=1|0 */
  searchParams: Promise<{ email?: string; sent?: string }>;
}

/**
 * Post-registration pending screen — the redirect target of
 * registerAction. Reached ONLY right after a (possibly
 * duplicate-suppressed) registration attempt, so its copy never
 * confirms whether an account exists: the same screen is shown either
 * way. Re-sending the verification email goes through the existing
 * generic resendVerificationAction.
 */
export default async function VerifyEmailPendingPage({
  searchParams,
}: PendingPageProps) {
  const { email, sent } = await searchParams;
  const initialEmail = (email ?? "").trim();
  const deliveryFailed = sent === "0";

  return (
    <AuthCard
      compact
      title="بانتظار تأكيد بريدك الإلكتروني"
      description={
        deliveryFailed
          ? "تم استلام طلب التسجيل، لكن تعذر إرسال رسالة التفعيل عبر مزوّد البريد حاليًا — استخدم زر إعادة الإرسال بالأسفل."
          : "إذا كان هذا البريد غير مسجل مسبقًا فستصلك رسالة تفعيل خلال دقائق. افتح الرسالة واضغط زر التأكيد ليصبح حسابك جاهزًا لتسجيل الدخول."
      }
      footer={
        <span>
          أكّدت بريدك بالفعل؟{" "}
          <Link
            href="/login"
            className="font-semibold text-brand-600 transition-colors hover:text-brand-700 hover:underline"
          >
            انتقل إلى تسجيل الدخول
          </Link>
        </span>
      }
    >
      {deliveryFailed && (
        <div
          className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"
          role="status"
        >
          تعذر الإرسال الآن — حاول إعادة إرسال الرسالة بعد قليل، وإن استمرت
          المشكلة تواصل مع مكتب التطوير في مدرستك.
        </div>
      )}

      <ol className="mb-6 space-y-2 rounded-xl border border-border/60 bg-muted/40 p-4 text-sm leading-7 text-muted-foreground">
        <li>1. افتح رسالة «تفعيل حسابك» في صندوق بريدك (وتحقق من البريد غير الهام).</li>
        <li>2. اضغط زر التأكيد داخل الرسالة — الرابط يُستخدم مرة واحدة وينتهي بعد مدة.</li>
        <li>3. بعد التأكيد سجّل الدخول بكلمة المرور التي اخترتها أثناء التسجيل.</li>
      </ol>

      <ResendVerificationForm initialEmail={initialEmail} />

      <p className="mt-5 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
        ملاحظة: إنشاء الحساب وتأكيد البريد خطوة أولى، أما إسنادك إلى المشرف
        التربوي فخطوة لاحقة يتمتها مكتب التطوير في مدرستك بعد اكتمال
        تفعيل حسابك.
      </p>
    </AuthCard>
  );
}
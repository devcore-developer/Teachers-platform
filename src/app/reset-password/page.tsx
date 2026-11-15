import type { CSSProperties } from "react";
import Link from "next/link";
import { CircleOff, Clock, Link2Off } from "lucide-react";

import { AuthCard } from "@/components/auth/auth-card";
import { resolvePublicBranding } from "@/lib/branding";
import { peekPasswordResetToken } from "@/lib/auth/one-time-tokens";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = {
  title: "إعادة تعيين كلمة المرور | منارة قرطبة",
};

export const dynamic = "force-dynamic";

/**
 * Public "reset password" gate — the target of the single-use expiring
 * reset link emailed by the public forgot-password flow AND by the IT
 * coordinator's recovery action (both build /reset-password?token=…).
 * This page was previously missing, so emailed recovery links landed on
 * a 404 — the token is now peeked SERVER-SIDE (never consumed by this
 * render) and the form only renders for a valid, unused, unexpired link.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; school?: string }>;
}) {
  const { token: rawToken, school } = await searchParams;
  const resolved = await resolvePublicBranding(school);
  const wrapperStyle = resolved.cssVars as CSSProperties;

  const forgotHref = resolved.school
    ? `/forgot-password?school=${encodeURIComponent(resolved.school.slug)}`
    : "/forgot-password";

  const status = rawToken ? await peekPasswordResetToken(rawToken) : "invalid";

  if (status !== "ok") {
    const headline =
      status === "expired"
        ? "انتهت صلاحية رابط إعادة التعيين"
        : status === "used"
          ? "تم استخدام رابط إعادة التعيين من قبل"
          : "رابط إعادة التعيين غير صالح";
    const hint =
      status === "expired"
        ? "روابط إعادة التعيين صالحة لمدة ساعة واحدة فقط من لحظة الإرسال — اطلب رابطًا جديدًا ثم أكمل الإعادة خلال مدته."
        : status === "used"
          ? "كل رابط يُستخدم مرة واحدة فقط لأمان حسابك — إذا كنت تحتاج لتغيير كلمة المرور مرة أخرى فاطلب رابطًا جديدًا."
          : "تأكد من فتح الرابط الكامل كما وصلك في الرسالة، دون تعديل أو حذف أي جزء منه.";

    return (
      <div style={wrapperStyle}>
        <AuthCard
          branding={resolved.branding}
          className="max-w-md"
          title="إعادة تعيين كلمة المرور"
          description="روابط إعادة التعيين آمنة ومؤقتة: استعمال واحد، وانتهاء بعد ساعة."
          compact
        >
          <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-5 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              {status === "expired" ? (
                <Clock className="size-5" aria-hidden="true" />
              ) : status === "used" ? (
                <CircleOff className="size-5" aria-hidden="true" />
              ) : (
                <Link2Off className="size-5" aria-hidden="true" />
              )}
            </span>
            <p className="mt-3 text-sm font-extrabold text-amber-800">{headline}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-amber-700">{hint}</p>
          </div>
          <Link
            href={forgotHref}
            className="mt-4 block rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-center text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100"
          >
            اطلب رابطًا جديدًا
          </Link>
        </AuthCard>
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      <AuthCard
        branding={resolved.branding}
        className="max-w-md"
        title="إعادة تعيين كلمة المرور"
        description="اختر كلمة مرور جديدة لحسابك — 8 أحرف على الأقل مع رقم واحد. بعد التغيير ستُغلق كل الجلسات المفتوحة تلقائيًا."
      >
        {/* peek() above validated the link WITHOUT consuming it — the
        atomic single-use consume happens inside the server action. */}
        <ResetPasswordForm token={rawToken!} />
      </AuthCard>
    </div>
  );
}
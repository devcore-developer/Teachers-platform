import type { CSSProperties } from "react";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { resolvePublicBranding } from "@/lib/branding";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = {
  title: "استعادة كلمة المرور | منارة قرطبة",
};

/**
 * Public "forgot password" gate — the page the login screen links to
 * (this route was previously dangling: the action existed, the login
 * link pointed here, but no page rendered it).
 *
 * The optional ?school={slug|id} context (carried by the login footer
 * link) only resolves PUBLIC branding fields — same contract as the
 * login page — so the recovery screen keeps the school's identity
 * without exposing any tenant data.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const { school } = await searchParams;
  const resolved = await resolvePublicBranding(school);
  const wrapperStyle = resolved.cssVars as CSSProperties;

  const loginHref = resolved.school
    ? `/login?school=${encodeURIComponent(resolved.school.slug)}`
    : "/login";

  return (
    <div style={wrapperStyle}>
      <AuthCard
        branding={resolved.branding}
        className="max-w-md"
        title="استعادة كلمة المرور"
        description="أدخل بريدك الإلكتروني وسنرسل لك رابطًا آمنًا لإعادة تعيين كلمة المرور — يُستخدم مرة واحدة وينتهي بعد ساعة."
      >
        <ForgotPasswordForm />
      </AuthCard>

      <p className="text-center text-sm text-muted-foreground">
        تذكرت كلمة المرور؟{" "}
        <Link
          href={loginHref}
          className="font-semibold text-brand-600 transition-colors hover:text-brand-700 hover:underline"
        >
          سجّل الدخول
        </Link>
      </p>
    </div>
  );
}
import type { CSSProperties } from "react";
import type { Metadata } from "next";

import { AuthCard, GATE_DISPLAY_NAME } from "@/components/auth/auth-card";
import { resolvePublicBranding } from "@/lib/branding";
import { LoginForm } from "./login-form";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}): Promise<Metadata> {
  const { school } = await searchParams;
  const resolved = await resolvePublicBranding(school);
  // Platform scope: the standalone display name (no «منارة»); a school
  // context keeps its own resolved name.
  const displayName = resolved.school
    ? resolved.branding.productName
    : GATE_DISPLAY_NAME;
  return { title: `تسجيل الدخول — ${displayName}` };
}

interface LoginPageProps {
  searchParams: Promise<{ next?: string; reset?: string; school?: string }>;
}

/**
 * Unified login gate with DYNAMIC school identity.
 *
 * The school context arrives as ?school={slug|id} (carried by school
 * links). Only PUBLIC branding fields are ever resolved from it — name,
 * logo and colors — so a manipulated parameter cannot leak or mutate
 * tenant data; authentication itself stays school-agnostic (email +
 * password). Without the parameter the gate header renders the platform
 * display name «منصة التنمية المهنية» alone (the former «منارة»
 * wordmark and its subtitle line are gone — see AuthCard).
 *
 * The premium composition (identity header, decorated background,
 * elevated card and platform footer) lives in the shared AuthCard so
 * every gate screen stays consistent. The footer is school-agnostic by
 * design: self-registration runs ONLY through the school's dedicated
 * registration link (a hashed token URL generated from
 * /registration-links), so there is intentionally no clickable
 * /register/{slug} shortcut here — the old slug links landed on the
 * "school_closed" screen and are gone from this page.
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, reset, school } = await searchParams;
  const resolved = await resolvePublicBranding(school);
  const wrapperStyle = resolved.cssVars as CSSProperties;

  // Card copy addresses the workspace by the same identity the header
  // renders: the school's name when a school is resolved, otherwise the
  // platform display name (never the old «منارة» wordmark).
  const displayName = resolved.school
    ? resolved.branding.productName
    : GATE_DISPLAY_NAME;

  // Keep the school context attached to the recovery link so related
  // authentication pages can resolve the same identity.
  const forgotHref = resolved.school
    ? `/forgot-password?school=${encodeURIComponent(resolved.school.slug)}`
    : "/forgot-password";

  const footer = (
    <span>
      معلم جديد؟ التسجيل يتم عبر رابط مدرستك المخصص — اطلب الرابط من مكتب
      التطوير في مدرستك ثم افتحه لإنشاء حسابك والدخول مباشرة.
    </span>
  );

  return (
    <div style={wrapperStyle}>
      <AuthCard
        branding={resolved.branding}
        className="max-w-md"
        title="تسجيل الدخول"
        description={`ادخل بيانات حسابك للوصول إلى مساحة عملك في ${displayName}.`}
        footer={footer}
      >
        {reset === "1" && (
          <div
            className="mb-5 rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold text-success"
            role="status"
          >
            تم تغيير كلمة المرور بنجاح — سجّل الدخول بكلمة المرور الجديدة.
          </div>
        )}
        <LoginForm nextPath={next} forgotHref={forgotHref} />
      </AuthCard>
    </div>
  );
}
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/components/auth/auth-card";
import { resolvePublicBranding } from "@/lib/branding";
import { LoginForm } from "./login-form";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}): Promise<Metadata> {
  const { school } = await searchParams;
  const resolved = await resolvePublicBranding(school);
  return { title: `تسجيل الدخول — ${resolved.branding.productName}` };
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
 * password). Without the parameter the platform identity renders
 * («منارة — مكتب التطوير التربوي»).
 *
 * The premium composition (identity header, decorated background,
 * elevated card and platform footer) lives in the shared AuthCard so
 * every gate screen stays consistent. The footer call-to-action adapts:
 * with a school context it links to that school's registration page,
 * otherwise it keeps the generic hint — never a hardcoded school name.
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, reset, school } = await searchParams;
  const resolved = await resolvePublicBranding(school);
  const wrapperStyle = resolved.cssVars as CSSProperties;

  // Keep the school context attached to the recovery link so related
  // authentication pages can resolve the same identity.
  const forgotHref = resolved.school
    ? `/forgot-password?school=${encodeURIComponent(resolved.school.slug)}`
    : "/forgot-password";

  const footer = resolved.school ? (
    <>
      معلم جديد في {resolved.branding.productName}؟{" "}
      <Link
        href={`/register/${encodeURIComponent(resolved.school.slug)}`}
        className="font-semibold text-brand-600 transition-colors hover:text-brand-700 hover:underline"
      >
        أنشئ حسابك الآن
      </Link>
    </>
  ) : (
    <span>
      معلم جديد؟ التسجيل يتم عبر رابط مدرستك —
      <span className="mx-1 text-muted-foreground/70" dir="ltr">
        /register/اسم-المدرسة
      </span>
    </span>
  );

  return (
    <div style={wrapperStyle}>
      <AuthCard
        branding={resolved.branding}
        className="max-w-md"
        title="تسجيل الدخول"
        description={`ادخل بيانات حسابك للوصول إلى مساحة عملك في ${resolved.branding.productName}.`}
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
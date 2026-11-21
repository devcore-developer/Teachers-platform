import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Hourglass } from "lucide-react";

import { AuthCard } from "@/components/auth/auth-card";
import { resolvePublicBranding } from "@/lib/branding";

export const metadata: Metadata = {
  title: "حسابك قيد التفعيل",
};

/**
 * Dedicated PENDING ACTIVATION screen — the post-registration landing
 * for self-registered teachers (registerAction redirects here).
 *
 * The freshly created account is INACTIVE by design: it holds no
 * platform access — no dashboard, sidebar, courses, lessons,
 * assessments, certificates, reports or any internal page/action —
 * because getCurrentUser() returns null for inactive users on EVERY
 * server surface. This screen renders with the shared gate shell
 * (AuthCard — no application shell, no internal data) and communicates
 * exactly one thing: wait for the IT coordinator's supervisor
 * assignment, which is the act that activates the account.
 */
export default async function PendingActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; school?: string }>;
}) {
  const { email: rawEmail, school } = await searchParams;
  // The school context (when the registration link carried one) keeps
  // the same identity/colors the teacher just registered under.
  const resolved = await resolvePublicBranding(school ?? null);
  const wrapperStyle = resolved.cssVars as CSSProperties;

  // Echo back ONLY the address the teacher just typed (bounded) —
  // never account status details beyond the pending message itself.
  const email = (rawEmail ?? "").trim().slice(0, 120);

  return (
    <div style={wrapperStyle}>
      <AuthCard
        branding={resolved.branding}
        className="max-w-md"
        compact
        title="حسابك قيد التفعيل"
        description="تم إنشاء حسابك بنجاح، ولكن حسابك لم يتم تفعيله بعد. يرجى الانتظار حتى يقوم منسق تقنية المعلومات بإسناد المشرف التربوي إليك واستكمال تفعيل حسابك."
      >
        <div className="rounded-xl border border-brand-200/70 bg-brand-50/70 p-5 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <Hourglass className="size-6" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-extrabold text-brand-800">
            الحالة: بانتظار التفعيل من إدارة المدرسة
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-brand-700/90">
            بعد إسنادك إلى المشرف التربوي وتفعيل حسابك سجّل الدخول بشكل
            طبيعي بالبريد وكلمة المرور الذين أنشأتَهما.
          </p>
          {email ? (
            <p className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-bold text-brand-700">
              بريدك المسجّل:{" "}
              <span dir="ltr" className="truncate font-mono">
                {email}
              </span>
            </p>
          ) : null}
        </div>
        <Link
          href="/login"
          className="mt-4 block rounded-xl border border-brand-200 bg-white px-4 py-2.5 text-center text-sm font-bold text-brand-700 transition-colors hover:bg-brand-50"
        >
          العودة إلى شاشة تسجيل الدخول
        </Link>
      </AuthCard>
    </div>
  );
}
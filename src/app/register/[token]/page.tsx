import type { CSSProperties } from "react";
import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/auth-card";
import {
  resolveRegisterBranding,
  resolveRegisterEntry,
} from "@/lib/registration-links/service";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

interface RegisterPageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({
  params,
}: RegisterPageProps): Promise<Metadata> {
  const { token } = await params;
  const resolved = await resolveRegisterBranding(token);
  return { title: `إنشاء حساب معلم — ${resolved.branding.productName}` };
}

/** Gregorian + Latin digits — deterministic server-rendered Arabic date. */
function formatDate(date: Date): string {
  return date.toLocaleDateString("ar", {
    year: "numeric",
    month: "long",
    day: "numeric",
    calendar: "gregory",
    numberingSystem: "latn",
  });
}

/**
 * Failure gate — the platform identity only. A bad/revoked/expired
 * token must never disclose that any school exists behind it.
 */
function GateScreen({ title, description }: { title: string; description: string }) {
  return (
    <AuthCard compact title={title} description={description}>
      <div
        className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
        role="alert"
      >
        اطلب رابط تسجيل جديدًا من مكتب التطوير في مدرستك، ثم افتحه لإكمال إنشاء حسابك.
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        روابط التسجيل تُصدر لكل مدرسة على حدة، وتُقبل لإنشاء حسابات معلمي
        تلك المدرسة فقط خلال مدة صلاحيتها.
      </p>
    </AuthCard>
  );
}

export default async function RegisterPage({ params }: RegisterPageProps) {
  const { token } = await params;
  const entry = await resolveRegisterEntry(token);

  if (entry.kind === "invalid") {
    return (
      <GateScreen
        title="رابط تسجيل غير صالح"
        description="الرابط الذي فتحته غير صحيح أو غير مكتمل. تأكد من نسخ الرابط كاملًا كما شاركه معك مكتب التطوير في مدرستك."
      />
    );
  }

  if (entry.kind === "school_closed") {
    return (
      <GateScreen
        title="التسجيل يتم عبر رابط مدرستك المخصص"
        description="هذه المدرسة تستقبل تسجيل معلميها عبر رابط تسجيل خاص يُصدره مكتب التطوير في المدرسة. اطلب الرابط منهم ثم افتحه لإنشاء حسابك."
      />
    );
  }

  const resolution = entry.resolution;
  if (resolution.status !== "valid") {
    const screens: Record<
      "invalid" | "revoked" | "expired",
      { title: string; description: string }
    > = {
      invalid: {
        title: "رابط تسجيل غير صالح",
        description:
          "الرابط الذي فتحته غير صحيح أو غير مكتمل. تأكد من نسخ الرابط كاملًا كما شاركه معك مكتب التطوير في مدرستك.",
      },
      revoked: {
        title: "تم إلغاء رابط التسجيل",
        description:
          "أُلغي رابط التسجيل هذا ولن يقبل تسجيلات جديدة. الحسابات التي أُنشئت عبره سابقًا لم تتأثر. اطلب رابطًا جديدًا من مكتب التطوير في مدرستك.",
      },
      expired: {
        title: "انتهت صلاحية رابط التسجيل",
        description:
          "انتهت المدة المحددة لرابط التسجيل هذا. اطلب رابطًا جديدًا من مكتب التطوير في مدرستك ثم أعد المحاولة.",
      },
    };
    const screen = screens[resolution.status];
    return <GateScreen title={screen.title} description={screen.description} />;
  }

  // Valid token — the school identity (name, logo, palette) comes from
  // the link's school only; the form cannot target any other school.
  const resolved = await resolveRegisterBranding(token);
  const wrapperStyle = resolved.cssVars as CSSProperties;
  const { expiresAt, school, branches } = resolution;

  return (
    <div style={wrapperStyle}>
      <AuthCard
        branding={resolved.branding}
        title="إنشاء حساب معلم جديد"
        description={`تسجيل معلم في ${school.nameAr}${
          expiresAt ? ` — الرابط ساري حتى ${formatDate(expiresAt)}` : ""
        }.`}
        footer={
          <span>
            بعد إنشاء الحساب أكّد بريدك الإلكتروني من رسالة التفعيل، ثم
            يُسندك المشرف التربوي من مكتب التطوير في مدرستك لاحقًا.
          </span>
        }
      >
        <RegisterForm
          token={token}
          schoolName={school.nameAr}
          branches={branches}
        />
      </AuthCard>
    </div>
  );
}
import { ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { requireUser } from "@/lib/auth/session";
import { AccountSecurityForms } from "@/app/account-security/account-security-forms";

export const metadata = {
  title: "أمان الحساب | منارة قرطبة",
};

/**
 * Batch 2 — self-service account security (HTML v27 parity, hardened):
 * password change and email change, both behind current-password
 * re-authentication, with the platform's existing session/verification
 * mechanisms preserved.
 */
export default async function AccountSecurityPage() {
  const user = await requireUser();

  const security = await (async () => {
    const { db } = await import("@/lib/db");
    return db.user.findUnique({
      where: { id: user.id },
      select: {
        email: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        passwordUpdatedAt: true,
      },
    });
  })();

  return (
    <div>
      <PageHeader
        title="أمان الحساب"
        description="غيّر كلمة مرورك أو بريدك الإلكتروني بحماية كاملة — التحقق من كلمة المرور الحالية يتم خادميًا."
        breadcrumbs={[{ label: "الرئيسية" }, { label: "أمان الحساب" }]}
        meta={
          <StatusBadge tone={security?.emailVerifiedAt ? "success" : "warning"} withDot={false}>
            {security?.emailVerifiedAt ? "بريدك موثق ✅" : "بريدك غير موثق"}
          </StatusBadge>
        }
      />

      <div className="mb-6 rounded-xl border bg-muted/40 p-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-2 text-sm font-bold text-foreground">
          <ShieldCheck className="size-4 text-brand-600" aria-hidden="true" />
          حماية الجلسات
        </p>
        <p className="mt-1 leading-relaxed">
          عند تغيير كلمة المرور تُنهى جميع الجلسات الأخرى تلقائيًا وتُصدر جلستك الحالية من جديد.
          عند تغيير البريد يبدأ البريد الجديد غير موثق ويجب توثيقه قبل الدخول القادم.
        </p>
        <p className="mt-1">
          آخر دخول: {security?.lastLoginAt ? new Date(security.lastLoginAt).toLocaleString("ar-EG") : "—"} · آخر
          تغيير لكلمة المرور:{" "}
          {security?.passwordUpdatedAt
            ? new Date(security.passwordUpdatedAt).toLocaleString("ar-EG")
            : "لم يُسجل"}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="تغيير كلمة المرور"
          description="8 أحرف على الأقل مع حرف ورقم — نفس قواعد المنصة."
        >
          <AccountSecurityForms mode="password" />
        </SectionCard>

        <SectionCard
          title="تغيير البريد الإلكتروني"
          description={`بريدك الحالي: ${security?.email ?? "—"} — سيطلب النظام كلمة مرورك الحالية للتأكيد.`}
        >
          <AccountSecurityForms mode="email" />
        </SectionCard>
      </div>
    </div>
  );
}
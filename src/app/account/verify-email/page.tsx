/**
 * Phase 11/12 — /account/verify-email — public single-use email
 * verification with POST-only consumption.
 *
 * Phase 12 change: the page NO LONGER consumes the token during GET
 * render. The emailed URL (?token=...) now renders an explicit
 * confirmation form; the single-use token is consumed only when the
 * user presses the button (server action POST). This closes the
 * prefetch/scanner token-burning hole (mail clients and messaging
 * apps commonly pre-fetch links).
 */

import Link from "next/link";
import { VerifyEmailForm } from "./verify-email-form";
import { Card } from "@/app/assignments/ui";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = (params.token ?? "").trim();

  if (!token) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card title="تأكيد البريد الإلكتروني">
          <p className="text-sm leading-relaxed text-slate-600">
            هذه الصفحة مخصصة لتأكيد بريدك الإلكتروني عبر الرابط الوارد في رسالة التفعيل. افتح
            الرابط من بريدك كما وصلك — لا حاجة لإدخال أي بيانات هنا.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            إن لم تصلك رسالة التفعيل فتواصل مع مدير مكتب التطوير في مدرستك لإعادة إرسالها.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex text-xs font-semibold text-[#1D5BD6] hover:underline"
          >
            العودة إلى الصفحة الرئيسية
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <VerifyEmailForm token={token} />
    </div>
  );
}
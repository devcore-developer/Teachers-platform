import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata = {
  title: "الحساب جاهز للدخول",
};

/**
 * كانت هذه الصفحة تعرض رسالة «بانتظار تفعيل الحساب / تحقق من بريدك» —
 * رسالة مضللة: التفعيل الفوري أصبح ساريًا على كل الحسابات ولا يوجد
 * أي خطوة تفعيل بالبريد إطلاقًا. الصفحة الآن تعرض الحقيقة فقط.
 */
export default function VerifyEmailPendingPage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden="true" />
        <div className="space-y-2">
          <h1 className="text-xl font-bold">لا توجد خطوات تفعيل — حسابك جاهز</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            كل الحسابات في المنصة تُنشأ مفعّلة مباشرة وبدون تأكيد بريد إلكتروني.
            إذا كانت لديك رسالة قديمة تطلب «تفعيل الحساب» فتجاوزها وسجّل الدخول مباشرة.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">الذهاب إلى تسجيل الدخول</Link>
        </Button>
      </div>
    </main>
  );
}
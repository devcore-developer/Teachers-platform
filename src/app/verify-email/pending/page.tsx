import Link from "next/link";

export const metadata = {
  title: "الحساب جاهز للدخول",
};

/**
 * Post-registration landing (registerAction redirects here). Under the
 * immediate-activation policy the new teacher account signs in right
 * away — this screen only points them to the login gate.
 */
export default function VerifyEmailPendingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="text-xl font-bold">الحساب جاهز للدخول</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          تم إنشاء حسابك وتفعيله بالفعل — لم نعد نطلب تأكيد البريد
          الإلكتروني. سجّل الدخول مباشرة باستخدام بريدك الإلكتروني وكلمة
          المرور.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          الانتقال إلى تسجيل الدخول
        </Link>
      </div>
    </main>
  );
}
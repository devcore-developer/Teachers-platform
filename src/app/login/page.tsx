import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "تسجيل الدخول",
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string; reset?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, reset } = await searchParams;

  return (
    <AuthCard
      title="تسجيل الدخول"
      description="ادخل بيانات حسابك للوصول إلى مساحة عملك في منصة منارة قرطبة."
      footer={
        <span>
          معلم جديد؟ التسجيل يتم عبر رابط مدرستك —
          <span className="mx-1 text-muted-foreground/70" dir="ltr">
            /register/اسم-المدرسة
          </span>
        </span>
      }
    >
      {reset === "1" && (
        <div
          className="mb-4 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold text-success"
          role="status"
        >
          تم تغيير كلمة المرور بنجاح — سجّل الدخول بكلمة المرور الجديدة.
        </div>
      )}
      <LoginForm nextPath={next} />
    </AuthCard>
  );
}
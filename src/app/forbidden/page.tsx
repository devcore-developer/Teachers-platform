import Link from "next/link";
import { ShieldAlert, Home, LifeBuoy } from "lucide-react";

export const metadata = {
  title: "صلاحية غير كافية",
};

/**
 * Arabic forbidden page — the redirect target of every server-side
 * guard (`redirect("/forbidden")` in dev-admin and the role-scoped
 * services). Rendered inside the authenticated shell; it never leaks
 * which role the visitor has, only that the area belongs to another
 * role.
 */
export default function ForbiddenPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 py-10 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
        <ShieldAlert className="size-8" aria-hidden="true" />
      </span>

      <h1 className="mt-5 text-2xl font-extrabold tracking-tight">
        لا تملك صلاحية الوصول إلى هذه الصفحة
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        هذه المنطقة مخصّصة لدور إداري آخر داخل المنصة. صلاحياتك محفوظة
        ومحصورة بنطاقك — إن كنت تظن أن هذا خطأ فتواصل مع مدير مدرستك أو
        مدير مكتب التطوير لمراجعة دورك.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-700"
        >
          <Home className="size-4" aria-hidden="true" />
          العودة إلى الرئيسية
        </Link>
        <Link
          href="/my-profile"
          className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-4 py-2.5 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent"
        >
          <LifeBuoy className="size-4" aria-hidden="true" />
          ملفي الشخصي
        </Link>
      </div>
    </div>
  );
}
/**
 * Batch 3 — "الإعدادات" is now a REAL role-aware page:
 *
 *   SUPER_ADMIN → platform settings: identity (name/tagline/support
 *     email) + the active academic year, persisted in SystemSetting and
 *     applied immediately. No "under development" placeholder anywhere.
 *   DEVELOPMENT_OFFICE_MANAGER / SCHOOL_MANAGER → their school
 *     workspace hub: live identity summary plus working links to the
 *     existing school modules (branding, users, branches, archives).
 *
 * School-specific settings stay in the school workspace — platform and
 * school scopes are never mixed on one screen.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { Landmark, Palette, Settings, Users } from "lucide-react";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { roleLabel } from "@/lib/auth/roles";
import { getPlatformSettings } from "@/lib/platform-settings";
import { Card, PageHeader } from "@/app/assignments/ui";
import { PlatformSettingsForm } from "./platform-settings-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "الإعدادات",
};

export default async function SettingsPage() {
  const user = await requireUser();

  if (
    user.role !== "SUPER_ADMIN" &&
    user.role !== "DEVELOPMENT_OFFICE_MANAGER" &&
    user.role !== "SCHOOL_MANAGER"
  ) {
    redirect("/forbidden");
  }

  /* ---------------------------------------------------------------- */
  /* SUPER_ADMIN — real platform settings                               */
  /* ---------------------------------------------------------------- */
  if (user.role === "SUPER_ADMIN") {
    const settings = await getPlatformSettings();

    return (
      <div>
        <PageHeader
          title="إعدادات المنصة"
          subtitle="الهوية العامة للمنصة والعام الدراسي النشط — تُطبق على كل المدارس فور الحفظ"
        />

        <Card>
          <PlatformSettingsForm initial={settings} />
        </Card>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Card>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800">
              <Settings className="size-4 text-[#1D5BD6]" aria-hidden="true" />
              نطاق إعدادات المنصة
            </h3>
            <p className="text-sm leading-relaxed text-slate-600">
              هذه الشاشة تدير الهوية العامة للمنصة فقط. هوية كل مدرسة
              (الشعار والاسم والألوان) إعداد مدرسي مستقل يُدار من مساحة
              عمل المدرسة نفسها، ولا تتأثر بأي تغيير هنا.
            </p>
          </Card>
          <Card>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800">
              <Users className="size-4 text-[#1D5BD6]" aria-hidden="true" />
              إدارة الحسابات والصلاحيات
            </h3>
            <p className="mb-3 text-sm leading-relaxed text-slate-600">
              إنشاء حسابات المدارس وتعيين الأدوار يتم من إدارة الحسابات،
              ودليل المستخدمين يعرض كل حسابات المنصة.
            </p>
            <Link
              href="/admin/accounts"
              className="text-sm font-semibold text-[#1D5BD6] hover:underline"
            >
              الانتقال إلى إدارة الحسابات →
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* School administrators — live school workspace hub                  */
  /* ---------------------------------------------------------------- */
  const school = user.schoolId
    ? await db.school.findUnique({
        where: { id: user.schoolId },
        select: {
          nameAr: true,
          nameEn: true,
          logoUrl: true,
          brandColor: true,
          isActive: true,
          _count: { select: { users: true, branches: true } },
        },
      })
    : null;

  const links = [
    {
      href: "/schools/branding",
      title: "هوية المدرسة",
      description: "الشعار والاسم المعروض والألوان — تُطبق فورًا على كل المنصة.",
      icon: Palette,
    },
    {
      href: "/users",
      title: "دليل المستخدمين",
      description: "حسابات مدرستك: الأدوار والحالات وإنشاء الحسابات الجديدة.",
      icon: Users,
    },
    {
      href: "/schools",
      title: "الفروع والمراحل التعليمية",
      description: "إدارة فروع مدرستك ومراحلها التعليمية وإسنادات المشرفين.",
      icon: Landmark,
    },
  ];

  return (
    <div>
      <PageHeader
        title="إعدادات المدرسة"
        subtitle={`${roleLabel(user.role)} — إدارة هوية مدرستك ومستخدميها وهيكلها التعليمي`}
      />

      {school ? (
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            {school.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={school.logoUrl}
                alt=""
                className="size-14 rounded-xl bg-white object-contain p-1 ring-1 ring-slate-200"
                draggable={false}
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-200">
                <Landmark className="size-6 text-[#1D5BD6]" aria-hidden="true" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold text-slate-800">
                {school.nameAr}
              </p>
              {school.nameEn ? (
                <p className="truncate text-sm text-slate-400" dir="ltr">
                  {school.nameEn}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-4 text-sm text-slate-600">
              <span>
                <strong className="text-slate-800">{school._count.users}</strong> حسابًا
              </span>
              <span>
                <strong className="text-slate-800">{school._count.branches}</strong> فرعًا
              </span>
              <span
                className="inline-block size-6 rounded-full ring-2 ring-white ring-offset-1 ring-offset-slate-100"
                style={{ backgroundColor: school.brandColor || "#1D5BD6" }}
                title={school.brandColor || "#1D5BD6"}
                aria-hidden="true"
              />
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-slate-600">
            حسابك غير مرتبط بمدرسة حاليًا — تواصل مع مدير المنصة لربط حسابك
            بمدرستك.
          </p>
        </Card>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-[#1D5BD6]/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D5BD6]"
            >
              <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-[#1D5BD6]/10 text-[#1D5BD6] transition group-hover:bg-[#1D5BD6] group-hover:text-white">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mb-1 text-sm font-bold text-slate-800">{link.title}</h3>
              <p className="text-sm leading-relaxed text-slate-500">
                {link.description}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
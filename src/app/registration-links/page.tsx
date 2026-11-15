import { PageHeader } from "@/components/layout/page-header";
import { db } from "@/lib/db";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import {
  getSchoolRegistrationStats,
  listRegistrationLinks,
} from "@/lib/registration-links/service";
import { LinkManager } from "./link-manager";

export const metadata = {
  title: "إدارة روابط تسجيل المعلمين | منارة قرطبة",
};

export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

/**
 * Registration-link management for the Development Office Manager
 * (school managers share the identical page through the admin-trio
 * context; SUPER_ADMIN picks the target school explicitly — the service
 * re-checks the tenant scope server-side either way).
 */
export default async function RegistrationLinksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAdminContext();
  const params = await searchParams;

  // School-scoped managers are pinned to their own school; the platform
  // owner picks a target explicitly (validated again by the service).
  const targetSchoolId = ctx.role === "SUPER_ADMIN" ? first(params.school) : ctx.schoolId;

  const schools =
    ctx.role === "SUPER_ADMIN"
      ? await db.school.findMany({
          where: { isActive: true },
          select: { id: true, nameAr: true },
          orderBy: { nameAr: "asc" },
        })
      : [];

  if (!targetSchoolId) {
    return (
      <div>
        <PageHeader
          title="إدارة روابط تسجيل المعلمين"
          description="اختر المدرسة التي تدير روابط تسجيل معلميها."
          breadcrumbs={[
            { label: "الرئيسية" },
            { label: "روابط التسجيل" },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {schools.length === 0 && (
            <p className="text-sm text-muted-foreground">لا توجد مدارس مفعّلة.</p>
          )}
          {schools.map((school) => (
            <a
              key={school.id}
              href={`/registration-links?school=${encodeURIComponent(school.id)}`}
              className="rounded-xl border bg-card p-4 font-bold transition-colors hover:border-brand-300 hover:bg-brand-50/50"
            >
              {school.nameAr}
            </a>
          ))}
        </div>
      </div>
    );
  }

  const [view, stats] = await Promise.all([
    listRegistrationLinks(ctx, targetSchoolId),
    getSchoolRegistrationStats(targetSchoolId),
  ]);

  if (!view.ok) {
    return (
      <div>
        <PageHeader
          title="إدارة روابط تسجيل المعلمين"
          breadcrumbs={[{ label: "الرئيسية" }, { label: "روابط التسجيل" }]}
        />
        <p className="rounded-xl border border-error/30 bg-error-soft px-4 py-3 text-sm font-semibold text-error">
          {view.message}
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="إدارة روابط تسجيل المعلمين"
        description="ولّد رابطًا مخصصًا لمدرستك وشاركه مع المعلمين الجدد — التسجيل عبره يربط كل معلم بمدرستك تلقائيًا، ويُوثَّق بريده، ثم يُسند إليه المشرف التربوي من تقنية المعلومات."
        breadcrumbs={[{ label: "الرئيسية" }, { label: "روابط التسجيل" }]}
      />
      <LinkManager view={view.data} stats={stats} />
    </div>
  );
}
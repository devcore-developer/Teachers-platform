import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { canManageSchoolBranding } from "@/lib/auth/roles";
import {
  getActiveSchoolBrandingById,
  resolveManageableSchoolId,
} from "@/lib/branding";
import { BrandingManager } from "./branding-manager";

export const metadata: Metadata = { title: "هوية المدرسة" };
export const dynamic = "force-dynamic";

interface BrandingPageProps {
  searchParams: Promise<{ school?: string }>;
}

/**
 * School branding manager (multi-school identity).
 *
 * Authorization (server-side, fail-closed):
 *  - SUPER_ADMIN: manages any school — a picker lists all schools and
 *    ?school={id} selects the target;
 *  - DEVELOPMENT_OFFICE_MANAGER: locked to their OWN school — a client
 *    hint for another tenant is rejected before any read/write.
 */
export default async function SchoolBrandingPage({
  searchParams,
}: BrandingPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fschools%2Fbranding");
  if (!canManageSchoolBranding(user.role)) redirect("/forbidden");

  const { school: schoolParam } = await searchParams;
  const target = resolveManageableSchoolId(
    { role: user.role, schoolId: user.schoolId },
    schoolParam ?? null
  );
  if (!target.ok) redirect("/forbidden");

  // Super admin without a selected school yet → load their default (or
  // none) and show the picker; office managers are already locked.
  const resolved = await getActiveSchoolBrandingById(target.schoolId);

  const schools =
    user.role === "SUPER_ADMIN"
      ? await db.school.findMany({
          where: { isActive: true },
          select: { id: true, nameAr: true },
          orderBy: { nameAr: "asc" },
        })
      : [];

  return (
    <BrandingManager
      initialBranding={{
        scope: resolved.scope,
        schoolId: resolved.school?.id ?? null,
        schoolName: resolved.school?.name ?? "",
        slug: resolved.school?.slug ?? "",
        logoUrl: resolved.branding.logoUrl ?? null,
        nameAr: resolved.school?.name ?? "",
        colors: resolved.colors,
        tagline: resolved.tagline,
      }}
      schools={schools}
      isSuperAdmin={user.role === "SUPER_ADMIN"}
      hasOwnSchool={Boolean(user.schoolId)}
    />
  );
}
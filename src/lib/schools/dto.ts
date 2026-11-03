import type { Branch, Prisma } from "@prisma/client";

/* ------------------------------------------------------------------ */
/* Serializable DTOs passed from server pages to client components.    */
/* Dates are pre-formatted server-side (ar-EG) to avoid hydration      */
/* mismatches between Node and browser ICU data.                       */
/* ------------------------------------------------------------------ */

export interface SchoolListItem {
  id: string;
  nameAr: string;
  nameEn: string | null;
  slug: string;
  logoUrl: string | null;
  brandColor: string;
  isActive: boolean;
  branchesCount: number;
  createdAtLabel: string;
  updatedAtLabel: string;
}

export interface BranchListItem {
  id: string;
  nameAr: string;
  nameEn: string | null;
  stage: string;
  isActive: boolean;
  createdAtLabel: string;
}

const arabicDate = new Intl.DateTimeFormat("ar-EG", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatDateLabel(date: Date | string): string {
  return arabicDate.format(new Date(date));
}

/**
 * Either service payload shape: directory rows carry `_count`, detail
 * rows carry the full `branches` array.
 */
type SchoolSource =
  | Prisma.SchoolGetPayload<{ include: { _count: { select: { branches: true } } } }>
  | Prisma.SchoolGetPayload<{ include: { branches: true } }>;

export function toSchoolListItem(school: SchoolSource): SchoolListItem {
  const branchesCount =
    "_count" in school
      ? school._count.branches
      : school.branches.length;

  return {
    id: school.id,
    nameAr: school.nameAr,
    nameEn: school.nameEn,
    slug: school.slug,
    logoUrl: school.logoUrl,
    brandColor: school.brandColor,
    isActive: school.isActive,
    branchesCount,
    createdAtLabel: formatDateLabel(school.createdAt),
    updatedAtLabel: formatDateLabel(school.updatedAt),
  };
}

export function toBranchListItem(branch: Branch): BranchListItem {
  return {
    id: branch.id,
    nameAr: branch.nameAr,
    nameEn: branch.nameEn,
    stage: branch.stage,
    isActive: branch.isActive,
    createdAtLabel: formatDateLabel(branch.createdAt),
  };
}

/** Extract the Arabic initials used by the fallback school avatar. */
export function schoolInitials(nameAr: string): string {
  const cleaned = nameAr.replace(/^(مدرسة|م\.)\s*/, "").trim();
  const words = cleaned.split(/\s+/).slice(0, 2);
  return words.map((word) => word.charAt(0)).join("") || "م";
}
import type { CSSProperties } from "react";

import { getActiveSchoolBrandingBySlug } from "@/lib/branding";

/**
 * ADDITIVE layout for /register/{slug} — it does NOT replace the
 * registration page; it wraps it with the school's dynamic identity:
 *
 *  - resolves the ACTIVE school from the URL slug (server-side, DB
 *    checked — an unknown or closed slug renders the page untouched);
 *  - injects the school's palette as CSS variables so the page and the
 *    shared AuthCard render the school colors automatically;
 *  - never displays another school's identity: the slug in the URL is
 *    the single source of the school context, exactly like the
 *    registration server action binds schoolId from the same slug.
 *
 * Only PUBLIC branding fields (name, logo, colors) are read here, so
 * the layout cannot leak tenant data.
 */
export default async function RegisterSchoolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let decodedSlug = slug;
  try {
    decodedSlug = decodeURIComponent(slug);
  } catch {
    // keep the raw slug — resolution below fails safe to platform
  }

  const resolved = await getActiveSchoolBrandingBySlug(decodedSlug);

  if (resolved.scope !== "school") {
    // Unknown / inactive school: render the page unchanged — the page
    // (and its server action) handle the invalid registration link.
    return <>{children}</>;
  }

  return <div style={resolved.cssVars as CSSProperties}>{children}</div>;
}
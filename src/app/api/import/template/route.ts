import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { assignmentTemplateCsv } from "@/lib/staffing/import";
import { downloadHeaders } from "@/lib/reports/csv";

/**
 * Batch 2 — the ORIGINAL Excel/CSV import template
 * (Qurtuba_Assignment_Template.csv — UTF-8 BOM, exact original headers
 * and the original demo row). Excel opens and saves this natively.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (user.role !== "SUPER_ADMIN" && user.role !== "DEVELOPMENT_OFFICE_MANAGER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return new NextResponse(assignmentTemplateCsv(), {
    headers: downloadHeaders("Qurtuba_Assignment_Template.csv", "text/csv"),
  });
}
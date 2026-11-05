import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import {
  buildAccountsReport,
  buildBundleReport,
  buildCoursesReport,
  buildSupervisorAnalytics,
  buildTeachersReport,
  buildTrainingReport,
  type ReportActor,
} from "@/lib/reports/datasets";
import { downloadHeaders } from "@/lib/reports/csv";

/**
 * Batch 2 — real-data report exports (CSV/JSON downloads).
 *
 * GET /api/reports/export?type=<type>[&format=json]
 *
 * Types (original HTML file names preserved):
 *   training   -> Qurtuba_Training_Report.csv
 *   teachers   -> Qurtuba_Teachers.csv
 *   courses    -> Qurtuba_Courses.csv
 *   supervisor -> Qurtuba_Supervisor_Teachers_Analytics.csv (supervisor scope)
 *   accounts   -> Qurtuba_User_Accounts.csv (WITHOUT passwords — hardened)
 *   bundle     -> Qurtuba_Manara_Report.json (format=json forced)
 *
 * Tenant rules: the office manager is ALWAYS confined to its own school;
 * the supervisor gets only its own scope analytics; SUPER_ADMIN covers
 * the platform (and passes an optional schoolId filter).
 */

export const dynamic = "force-dynamic";

const VALID_TYPES = ["training", "teachers", "courses", "supervisor", "accounts", "bundle"] as const;
type ReportType = (typeof VALID_TYPES)[number];

function isReportType(value: string): value is ReportType {
  return (VALID_TYPES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  if (!isReportType(type)) {
    return NextResponse.json({ error: "UNKNOWN_REPORT_TYPE" }, { status: 400 });
  }

  if (user.role !== "SUPER_ADMIN" && user.role !== "DEVELOPMENT_OFFICE_MANAGER" && user.role !== "EDUCATIONAL_SUPERVISOR") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const actor: ReportActor =
    user.role === "SUPER_ADMIN"
      ? { role: "SUPER_ADMIN", id: user.id, schoolId: user.schoolId }
      : user.role === "DEVELOPMENT_OFFICE_MANAGER"
        ? {
            role: "DEVELOPMENT_OFFICE_MANAGER",
            id: user.id,
            schoolId: user.schoolId ?? "",
          }
        : { role: "EDUCATIONAL_SUPERVISOR", id: user.id, schoolId: user.schoolId };

  try {
    if (type === "supervisor") {
      if (actor.role !== "EDUCATIONAL_SUPERVISOR" && actor.role !== "DEVELOPMENT_OFFICE_MANAGER") {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      const report = await buildSupervisorAnalytics({
        role: "EDUCATIONAL_SUPERVISOR",
        id: user.id,
        schoolId: user.schoolId,
      });
      return new NextResponse(report.body, {
        headers: downloadHeaders(report.filename, report.mime),
      });
    }

    if (actor.role === "EDUCATIONAL_SUPERVISOR") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    let file;
    switch (type) {
      case "training":
        file = await buildTrainingReport(actor);
        break;
      case "teachers":
        file = await buildTeachersReport(actor);
        break;
      case "courses":
        file = await buildCoursesReport(actor);
        break;
      case "accounts":
        file = await buildAccountsReport(actor);
        break;
      case "bundle":
        file = await buildBundleReport(actor);
        break;
      default:
        return NextResponse.json({ error: "UNKNOWN_REPORT_TYPE" }, { status: 400 });
    }

    return new NextResponse(file.body, {
      headers: downloadHeaders(file.filename, file.mime),
    });
  } catch (error) {
    console.error("[reports/export] failed", error);
    return NextResponse.json({ error: "REPORT_FAILED" }, { status: 500 });
  }
}
import { redirect } from "next/navigation";

/**
 * /teachers — legacy Phase-1 placeholder route.
 *
 * The audit showed the dedicated page rendered only a "قريباً"
 * placeholder while the actual teacher-management capability already
 * lives in the users directory (teacher accounts, professional data,
 * activation/deactivation, supervisor assignments, school/branch
 * filters). Any legacy link or bookmark lands there directly — no
 * duplicate module is created.
 */
export default function TeachersPage() {
  redirect("/users");
}
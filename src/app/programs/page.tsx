import { redirect } from "next/navigation";

/**
 * /programs — legacy Phase-1 placeholder route.
 *
 * The real programs module is implemented at /academy/programs
 * (program manager: create, publish, archive). This keeps any stale
 * link from landing on an outdated "قريباً" screen.
 */
export default function ProgramsPage() {
  redirect("/academy/programs");
}
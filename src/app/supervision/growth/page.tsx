import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth/session";
import { supervisorGrowthBoard } from "@/lib/growth/service";
import { GrowthBoard } from "@/app/supervision/growth/growth-board";

export const metadata = {
  title: "النمو المهني | منارة قرطبة",
};

/**
 * Batch 2 — the supervisor's growth board (HTML v48Page parity):
 * per-teacher classification T0..T5, the 60% promotion gate with
 * one-level approved transitions, and the message entry point.
 */
export default async function SupervisionGrowthPage() {
  const user = await requireUser();
  if (user.role !== "EDUCATIONAL_SUPERVISOR") redirect("/forbidden");

  const board = await supervisorGrowthBoard(user.id);
  if (!board.ok) redirect("/forbidden");

  const eligible = board.data.filter((row) => row.eligible).length;

  return (
    <div>
      <PageHeader
        title="متابعة المعلمين — النمو المهني"
        description={`تصنيف المعلمين ومسار الانتقال المهني — ${user.name}`}
        breadcrumbs={[
          { label: "الرئيسية" },
          { label: "النمو المهني" },
        ]}
        meta={
          <span className="rounded-xl border bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">
            مستحقون للانتقال: {eligible}
          </span>
        }
      />
      <GrowthBoard rows={board.data} />
    </div>
  );
}
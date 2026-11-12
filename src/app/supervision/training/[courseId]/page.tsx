import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";

import { UnifiedTrainingEditor } from "@/app/supervision/training/unified/unified-editor";
import {
  getSupervisorTrainingWorkspace,
  requireSupervisorContext,
} from "@/lib/supervision/training";

export const metadata = { title: "بناء ونشر التدريب — الصفحة الموحدة" };

/**
 * Unified training editor — draft AND published trainings are opened
 * here for editing (no separate builder page). Everything the editor
 * renders comes from getSupervisorTrainingWorkspace (tenant-fenced);
 * every mutation re-verifies scope server-side.
 */
export default async function SupervisorTrainingEditorPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const ctx = await requireSupervisorContext();
  const workspace = await getSupervisorTrainingWorkspace(ctx, courseId);

  if (!workspace.ok) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-8 text-center">
        <TriangleAlert className="mx-auto size-8 text-destructive" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-black text-foreground">
          التدريب غير متاح
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{workspace.message}</p>
        <Link
          href="/supervision/training"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
          العودة إلى إدارة التدريب
        </Link>
      </div>
    );
  }

  return <UnifiedTrainingEditor workspace={workspace.data} />;
}
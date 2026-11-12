import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";

import { UnifiedTrainingEditor } from "@/app/supervision/training/unified/unified-editor";
import {
  getSupervisorTrainingProgress,
  getSupervisorTrainingWorkspace,
  requireSupervisorContext,
} from "@/lib/supervision/training";

export const metadata = { title: "بناء ونشر التدريب — الصفحة الموحدة" };

/**
 * Unified training workspace — the ONE management page per training
 * (draft AND published). Everything the editor renders comes from
 * getSupervisorTrainingWorkspace (tenant-fenced); the progress read
 * model adds teacher participation, exam results, essay-review needs,
 * certificates and impact responses — all from the existing models.
 * Every mutation re-verifies scope server-side.
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

  // Read-only participation/results aggregation — a failure here must
  // never block editing, so the editor simply renders without it.
  const progress = await getSupervisorTrainingProgress(ctx, courseId);

  return (
    <UnifiedTrainingEditor
      workspace={workspace.data}
      progress={progress.ok ? progress.data : null}
    />
  );
}
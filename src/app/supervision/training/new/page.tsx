import Link from "next/link";
import { redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import {
  ensureSupervisorTrainingDraft,
  requireSupervisorContext,
} from "@/lib/supervision/training";

export const metadata = { title: "إنشاء تدريب احترافي جديد" };

/**
 * Unified training creation — ONE page for the complete professional
 * training.
 *
 * DRAFT-FIRST (no sequential gates): opening this page GET-OR-CREATES
 * the supervisor's scratch DRAFT course server-side and redirects to its
 * unified workspace, where EVERY section (basic info, videos, PDF
 * attachments, exam, impact measurement, publish) is editable
 * immediately and independently — no section requires saving another
 * first. Repeatedly opening the creation page reuses the same untouched
 * scratch draft instead of piling up empty rows; a draft that already
 * carries content is never merged or overwritten.
 */
export default async function NewSupervisorTrainingPage() {
  const ctx = await requireSupervisorContext();
  const draft = await ensureSupervisorTrainingDraft(ctx);

  if (!draft.ok) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-8 text-center">
        <TriangleAlert className="mx-auto size-8 text-destructive" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-black text-foreground">
          تعذر بدء إنشاء التدريب
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{draft.message}</p>
        <Link
          href="/supervision/training"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
        >
          العودة إلى إدارة التدريب
        </Link>
      </div>
    );
  }

  // The workspace page IS the creation page: the draft is persisted, all
  // sections unlocked, and the URL is now the training's canonical
  // management address (survives refresh/share/bookmark).
  redirect(`/supervision/training/${draft.data.id}`);
}
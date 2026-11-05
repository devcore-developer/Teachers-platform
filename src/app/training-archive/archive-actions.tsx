"use client";

import * as React from "react";
import { Archive, Loader2, PlusCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  archiveYearAction,
  startAcademicYearAction,
  type ArchiveActionState,
} from "@/app/actions/reports";

const initialState: ArchiveActionState = { ok: false };

/**
 * Batch 2 — the archive page controls (HTML v26ArchiveYear /
 * v26StartYear): archive the current year in place, or adopt a new
 * academic year (1449هـ style) so future completions count in it.
 */
export function ArchiveActions({ activeYear }: { activeYear: string }) {
  const { toast } = useToast();
  const [archiveState, archiveFormAction, archivePending] = React.useActionState(
    archiveYearAction,
    initialState
  );
  const [startState, startFormAction, startPending] = React.useActionState(
    startAcademicYearAction,
    initialState
  );
  const [newYear, setNewYear] = React.useState("");

  React.useEffect(() => {
    if (archiveState.ok && archiveState.message) {
      toast({ title: "تمت الأرشفة 📦", description: archiveState.message });
    }
  }, [archiveState, toast]);

  React.useEffect(() => {
    if (startState.ok && startState.message) {
      toast({ title: "تم الاعتماد ✅", description: startState.message });
      setNewYear("");
    }
  }, [startState, toast]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4">
      <form action={archiveFormAction}>
        <input type="hidden" name="year" value={activeYear} />
        <Button type="submit" disabled={archivePending} className="rounded-xl">
          {archivePending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Archive className="size-4" aria-hidden="true" />
          )}
          أرشفة {activeYear}
        </Button>
      </form>

      <form action={startFormAction} className="flex flex-wrap items-center gap-2">
        <Input
          name="year"
          value={newYear}
          onChange={(event) => setNewYear(event.target.value)}
          placeholder="أدخل العام الدراسي، مثال 1449هـ"
          className="w-64"
          required
        />
        <Button type="submit" variant="outline" disabled={startPending || !newYear.trim()} className="rounded-xl">
          {startPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          <PlusCircle className="size-4" aria-hidden="true" />
          عام دراسي جديد
        </Button>
      </form>

      {(archiveState.message || startState.message) && (
        <p
          className={`w-full rounded-lg px-3 py-2 text-sm ${
            archiveState.ok || startState.ok
              ? "bg-brand-50 text-brand-800"
              : "bg-error-soft text-error"
          }`}
        >
          {archiveState.ok || startState.ok
            ? archiveState.ok
              ? archiveState.message
              : startState.message
            : archiveState.message || startState.message}
        </p>
      )}
    </div>
  );
}
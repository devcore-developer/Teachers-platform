"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, MessageSquare, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/platform/empty-state";
import {
  GROWTH_LEVELS,
  PROMOTION_THRESHOLD_PERCENT,
  growthLevelLabel,
} from "@/config/growth";
import type { GrowthTeacherRow } from "@/lib/growth/service";
import {
  approvePromotionAction,
  setTeacherLevelAction,
  type GrowthActionState,
} from "@/app/actions/growth";

const initialState: GrowthActionState = { ok: false };

/**
 * Batch 2 — the v48 board (client): current level, the 60% progress,
 * eligibility, one-tap approval, direct classification select, and the
 * message link — everything the original page had, on real data.
 */
export function GrowthBoard({ rows }: { rows: GrowthTeacherRow[] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm leading-relaxed">
        <b>آلية التصنيف:</b> يحدد المشرف المستوى الحالي لكل معلم من T0 إلى T5. وعند إكمال المعلم{" "}
        <b>{PROMOTION_THRESHOLD_PERCENT}%</b> من الدورات المنشورة المتاحة له، يصبح مستحقًا للانتقال{" "}
        <b>مستوى واحد فقط</b> إلى التصنيف الأعلى. بعد الاعتماد ينتقل المستوى ويبدأ احتساب المرحلة
        التالية.
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="لا يوجد معلمون مسندون لهذا المشرف"
          description="سيظهر المعلمون هنا بعد إسنادهم من إدارة المعلمين أو استيراد الإسنادات."
        />
      ) : (
        rows.map((row) => (
          <GrowthCard key={row.teacher.id} row={row} />
        ))
      )}
    </div>
  );
}

function GrowthCard({ row }: { row: GrowthTeacherRow }) {
  const { toast } = useToast();
  const [levelState, levelAction, levelPending] = React.useActionState(
    setTeacherLevelAction,
    initialState
  );
  const [promoteState, promoteAction, promotePending] = React.useActionState(
    approvePromotionAction,
    initialState
  );

  React.useEffect(() => {
    if (levelState.message) {
      toast({ title: levelState.ok ? "تم" : "تنبيه", description: levelState.message });
    }
  }, [levelState, toast]);

  React.useEffect(() => {
    if (promoteState.message) {
      toast({ title: promoteState.ok ? "تم" : "تنبيه", description: promoteState.message });
    }
  }, [promoteState, toast]);

  const status = (() => {
    if (row.currentLevel === "T5") return "🏅 أعلى مستوى";
    if (row.eligible) return "✅ مستحق للانتقال";
    if (row.stats.assigned > 0)
      return `المكتمل ${row.stats.completed} من ${row.stats.assigned} — ${row.stats.percent}%`;
    return "لا توجد دورات منشورة كافية";
  })();

  return (
    <article className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-black">{row.teacher.name}</p>
          <p className="text-xs text-muted-foreground">
            {row.teacher.schoolName ?? "—"} · {row.teacher.stage ?? "—"} ·{" "}
            {row.teacher.subject ?? "—"}
          </p>
        </div>
        <Link
          href={`/messages?to=${row.teacher.id}`}
          className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors hover:bg-accent"
        >
          <MessageSquare className="size-3.5" aria-hidden="true" />
          رسالة للمعلم
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniKpi label="التصنيف الحالي" value={growthLevelLabel(row.currentLevel)} />
        <MiniKpi label="الدورات المكتملة" value={String(row.stats.completed)} />
        <MiniKpi
          label="التصنيف التالي"
          value={row.nextLevel ? growthLevelLabel(row.nextLevel) : "—"}
        />
        <MiniKpi label="نسبة الإنجاز" value={`${row.stats.percent}%`} />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span>{status}</span>
          <span>شرط الانتقال: {PROMOTION_THRESHOLD_PERCENT}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${Math.min(100, row.stats.percent)}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          المستوى المقترح من بياناتك: {growthLevelLabel(row.suggestedLevel)} · الساعات:{" "}
          {row.stats.hours} · الشهادات: {row.stats.certificates}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <form action={levelAction} className="min-w-56 flex-1">
          <input type="hidden" name="teacherId" value={row.teacher.id} />
          <label className="block text-xs font-bold" htmlFor={`level-${row.teacher.id}`}>
            تصنيف المعلم بواسطة المشرف
          </label>
          <select
            id={`level-${row.teacher.id}`}
            name="level"
            defaultValue={row.currentLevel}
            className="mt-1.5 h-10 w-full rounded-xl border bg-background px-3 text-sm"
          >
            {GROWTH_LEVELS.map((level) => (
              <option key={level.id} value={level.id}>
                {level.id} — {level.nameAr}
              </option>
            ))}
          </select>
        </form>

        <form action={promoteAction}>
          <input type="hidden" name="teacherId" value={row.teacher.id} />
          <Button type="submit" disabled={promotePending} className="rounded-xl">
            {promotePending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {row.eligible ? "اعتماد الانتقال" : "فحص الانتقال"}
          </Button>
        </form>
      </div>
    </article>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background/60 p-2.5">
      <p className="truncate text-sm font-black">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
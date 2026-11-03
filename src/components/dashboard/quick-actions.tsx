"use client";

import { ChevronLeft } from "lucide-react";

import { mockQuickActions } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { QuickAction } from "@/lib/types";

interface QuickActionsProps {
  onNavigate: (moduleId: string) => void;
}

/**
 * Quick professional-development actions. Each action navigates to its
 * related module — real navigation behavior, no fake flows.
 */
export function QuickActions({ onNavigate }: QuickActionsProps) {
  function handleAction(action: QuickAction) {
    onNavigate(action.targetModuleId);
  }

  return (
    <section aria-labelledby="quick-actions-title">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="quick-actions-title" className="text-base font-bold text-foreground">
          إجراءات سريعة
        </h2>
        <p className="text-xs text-muted-foreground">الانتقال المباشر لأقسام العمل</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {mockQuickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => handleAction(action)}
              className={cn(
                "group flex items-center gap-3.5 rounded-xl border bg-card p-4 text-start shadow-xs transition-all",
                "hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700 transition-colors group-hover:bg-brand-600 group-hover:text-white"
                aria-hidden="true"
              >
                <Icon className="size-5" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-foreground">{action.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {action.description}
                </span>
              </span>
              <ChevronLeft
                className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:-translate-x-0.5 group-hover:text-brand-600"
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
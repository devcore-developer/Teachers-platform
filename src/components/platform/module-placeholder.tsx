"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Construction } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/types";

interface ModulePlaceholderProps {
  module: NavItem;
  className?: string;
}

/**
 * Honest placeholder for modules scheduled in later phases. It explains
 * exactly what the module will offer (from the navigation config) — it
 * never simulates the real functionality.
 */
export function ModulePlaceholder({
  module,
  className,
}: ModulePlaceholderProps) {
  const router = useRouter();
  const Icon = module.icon;

  return (
    <div className={className}>
      <PageHeader module={module} title={module.label} description={module.description} />

      <div className="rounded-xl border bg-card shadow-xs">
        <div className="flex flex-col items-center px-6 py-12 text-center sm:py-16">
          <div
            className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-lg shadow-brand-600/25"
            aria-hidden="true"
          >
            <Icon className="size-8" strokeWidth={1.7} />
            <span className="absolute -bottom-1.5 -end-1.5 flex size-6 items-center justify-center rounded-full border-2 border-card bg-warning text-warning-foreground">
              <Construction className="size-3.5" />
            </span>
          </div>

          <span className="mb-3 inline-flex items-center rounded-full bg-warning-soft px-3 py-1 text-xs font-bold text-warning">
            قيد التطوير — مرحلة قادمة
          </span>

          <h2 className="text-lg font-extrabold text-foreground sm:text-xl">
            وحدة «{module.label}» لم تُفعَّل بعد
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            هذه الواجهة مخصصة كأساس هيكلي فقط ضمن المرحلة الأولى من المشروع،
            وسيتم بناء الوظائف الفعلية لهذه الوحدة في مرحلة لاحقة من خطة
            التطوير دون تغيير هيكل التنقل أو التصميم.
          </p>

          {module.plannedFeatures.length > 0 && (
            <div className="mt-6 w-full max-w-md rounded-lg border bg-muted/40 p-4 text-start">
              <p className="mb-2.5 text-xs font-bold text-foreground">
                ما الذي سيتوفر في هذه الوحدة؟
              </p>
              <ul className="space-y-2" role="list">
                {module.plannedFeatures.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500"
                      aria-hidden="true"
                    />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            variant="outline"
            onClick={() => router.push("/")}
            className="mt-8 border-brand-200 text-brand-700 hover:bg-brand-50 hover:text-brand-800"
          >
            <ArrowRight className="size-4" aria-hidden="true" />
            العودة إلى لوحة المعلومات
          </Button>
        </div>
      </div>
    </div>
  );
}
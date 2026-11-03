import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CONTENT_STATUSES,
  CONTENT_STATUS_LABELS,
  TRAINING_CATEGORIES,
  TRAINING_CATEGORY_LABELS,
} from "@/config/training";

/* ------------------------------------------------------------------ */
/* Shared GET-form filters for the academy catalogs. Deliberately a     */
/* server component (native form + native selects): filtering works    */
/* without client JS and stays stateless/URL-driven like the users     */
/* directory.                                                          */
/* ------------------------------------------------------------------ */

interface CatalogFiltersProps {
  /** Route the GET form submits to. */
  action: string;
  q?: string;
  category?: string;
  programId?: string;
  programs?: { id: string; nameAr: string; platformWide?: boolean }[];
  status?: string;
  showStatus?: boolean;
  showMine?: boolean;
  mine?: boolean;
}

const selectClass =
  "h-9 w-full appearance-none rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

export function CatalogFilters({
  action,
  q = "",
  category = "",
  programId = "",
  programs,
  status = "",
  showStatus = false,
  showMine = false,
  mine = false,
}: CatalogFiltersProps) {
  return (
    <form
      action={action}
      method="get"
      className="rounded-xl border bg-card p-4 shadow-xs"
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${action}-q`}>البحث بالعنوان</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id={`${action}-q`}
              name="q"
              defaultValue={q}
              placeholder="ابحث بعنوان الدورة…"
              className="pe-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${action}-category`}>التصنيف</Label>
          <select
            id={`${action}-category`}
            name="category"
            defaultValue={category}
            className={selectClass}
          >
            <option value="">كل التصنيفات</option>
            {TRAINING_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {TRAINING_CATEGORY_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        {programs && programs.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${action}-program`}>البرنامج</Label>
            <select
              id={`${action}-program`}
              name="programId"
              defaultValue={programId}
              className={selectClass}
            >
              <option value="">كل البرامج</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.nameAr}
                  {program.platformWide ? " — مشترك" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span />
        )}

        {showStatus ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${action}-status`}>حالة النشر</Label>
            <select
              id={`${action}-status`}
              name="status"
              defaultValue={status}
              className={selectClass}
            >
              <option value="">كل الحالات</option>
              {CONTENT_STATUSES.map((key) => (
                <option key={key} value={key}>
                  {CONTENT_STATUS_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        ) : showMine ? (
          <div className="flex items-end">
            <label className="flex h-9 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                name="mine"
                value="1"
                defaultChecked={mine}
                className="size-4 rounded border-input accent-brand-600"
              />
              دوراتي المسجّل بها فقط
            </label>
          </div>
        ) : (
          <span />
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" size="sm">
          <Search className="size-4" aria-hidden="true" />
          تطبيق الفلاتر
        </Button>
        <a
          href={action}
          className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent"
        >
          <X className="size-3.5" aria-hidden="true" />
          مسح
        </a>
      </div>
    </form>
  );
}
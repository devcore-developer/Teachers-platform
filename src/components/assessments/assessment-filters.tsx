import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASSESSMENT_STATUS_LABELS, ASSESSMENT_STATUSES } from "@/config/assessment";

interface AssessmentFiltersProps {
  action: string;
  q?: string;
  status?: string;
}

/**
 * GET-form filters for the management directory — server-rendered,
 * no client JS: submitting navigates with the query string.
 */
export function AssessmentFilters({ action, q, status }: AssessmentFiltersProps) {
  return (
    <form
      action={action}
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4"
    >
      <div className="min-w-52 flex-1 space-y-1.5">
        <label
          htmlFor="assessments-q"
          className="block text-xs font-bold text-muted-foreground"
        >
          بحث بالعنوان
        </label>
        <Input
          id="assessments-q"
          name="q"
          defaultValue={q ?? ""}
          placeholder="اكتب جزءًا من عنوان الاختبار…"
        />
      </div>

      <div className="w-44 space-y-1.5">
        <label
          htmlFor="assessments-status"
          className="block text-xs font-bold text-muted-foreground"
        >
          الحالة
        </label>
        <Select name="status" defaultValue={status || "all"}>
          <SelectTrigger id="assessments-status">
            <SelectValue placeholder="كل الحالات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {ASSESSMENT_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {ASSESSMENT_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" variant="outline">
        <Search className="size-4" aria-hidden="true" />
        تطبيق
      </Button>
    </form>
  );
}
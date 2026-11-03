import Link from "next/link";
import { School } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/platform/empty-state";

/** Arabic 404 for unknown school ids (/schools/{id}). */
export default function SchoolNotFound() {
  return (
    <div className="mx-auto max-w-2xl pt-10">
      <div className="rounded-xl border bg-card shadow-xs">
        <EmptyState
          icon={School}
          title="المدرسة غير موجودة"
          description="الرابط الذي فتحته يشير إلى مدرسة غير مسجلة أو تم إزالتها من المنصة."
          action={
            <Button asChild>
              <Link href="/schools">العودة إلى دليل المدارس</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
"use client";

import * as React from "react";
import { Loader2, Power } from "lucide-react";

import { setSchoolActiveAction } from "@/app/actions/schools";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface SchoolStatusToggleProps {
  schoolId: string;
  schoolName: string;
  isActive: boolean;
}

/**
 * Activate/deactivate a school. Permanent deletion is deliberately not
 * offered — schools may own branches (and future teacher/program
 * records), so deactivation preserves history and referential integrity.
 */
export function SchoolStatusToggle({
  schoolId,
  schoolName,
  isActive,
}: SchoolStatusToggleProps) {
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  function handleToggle() {
    const next = !isActive;
    startTransition(async () => {
      const result = await setSchoolActiveAction(schoolId, next);
      if (result?.ok) {
        toast({
          title: next ? "تم تفعيل المدرسة" : "تم إيقاف المدرسة",
          description: next
            ? `«${schoolName}» نشطة الآن ويمكن التشغيل عليها.`
            : `«${schoolName}» موقوفة مؤقتاً — لم يتم حذف أي بيانات.`,
        });
      } else {
        toast({
          title: "تعذر تغيير الحالة",
          description: result?.message ?? "حدث خطأ غير متوقع — أعد المحاولة.",
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Button
      variant={isActive ? "outline" : "default"}
      onClick={handleToggle}
      disabled={pending}
      className={isActive ? "border-warning/40 text-warning hover:bg-warning-soft hover:text-warning" : ""}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Power className="size-4" aria-hidden="true" />
      )}
      {isActive ? "إيقاف المدرسة" : "إعادة تفعيل المدرسة"}
    </Button>
  );
}
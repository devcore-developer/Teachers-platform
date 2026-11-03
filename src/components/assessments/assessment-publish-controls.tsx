import { Archive, Rocket, Undo2 } from "lucide-react";

import {
  setAssessmentStatusAction,
} from "@/app/actions/assessment";
import { Button } from "@/components/ui/button";
import { assessmentStatusLabel } from "@/config/assessment";

interface AssessmentPublishControlsProps {
  assessmentId: string;
  status: string;
}

/**
 * Lifecycle controls for one assessment (DRAFT -> PUBLISHED ->
 * ARCHIVED). The publish guard (questions + passing score) lives in the
 * service layer; failures surface through the editor notice area.
 */
export function AssessmentPublishControls({
  assessmentId,
  status,
}: AssessmentPublishControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && (
        <form action={setAssessmentStatusAction}>
          <input type="hidden" name="assessmentId" value={assessmentId} />
          <input type="hidden" name="status" value="PUBLISHED" />
          <Button type="submit" size="sm">
            <Rocket className="size-4" aria-hidden="true" />
            نشر الاختبار
          </Button>
        </form>
      )}
      {status === "PUBLISHED" && (
        <>
          <form action={setAssessmentStatusAction}>
            <input type="hidden" name="assessmentId" value={assessmentId} />
            <input type="hidden" name="status" value="DRAFT" />
            <Button type="submit" size="sm" variant="outline">
              <Undo2 className="size-4" aria-hidden="true" />
              إرجاع إلى مسودة
            </Button>
          </form>
          <form action={setAssessmentStatusAction}>
            <input type="hidden" name="assessmentId" value={assessmentId} />
            <input type="hidden" name="status" value="ARCHIVED" />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="text-destructive hover:bg-destructive/10"
            >
              <Archive className="size-4" aria-hidden="true" />
              أرشفة
            </Button>
          </form>
        </>
      )}
      {status === "ARCHIVED" && (
        <span className="text-xs font-bold text-muted-foreground">
          الحالة الحالية: {assessmentStatusLabel(status)} — لا يمكن التعديل بعد الأرشفة.
        </span>
      )}
    </div>
  );
}
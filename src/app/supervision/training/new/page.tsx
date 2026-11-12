import { UnifiedTrainingEditor } from "@/app/supervision/training/unified/unified-editor";
import { requireSupervisorContext } from "@/lib/supervision/training";

export const metadata = { title: "إنشاء تدريب احترافي جديد" };

/**
 * Unified training creation — ONE page for the complete professional
 * training. The school scope comes from the supervisor session; the
 * form never sends a schoolId, and the first save creates the DRAFT
 * course in the supervisor's school then swaps this URL to the editor.
 */
export default async function NewSupervisorTrainingPage() {
  await requireSupervisorContext();
  return <UnifiedTrainingEditor workspace={null} />;
}
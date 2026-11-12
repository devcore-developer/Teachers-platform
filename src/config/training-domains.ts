/* ------------------------------------------------------------------ */
/* Unified training creation — canonical option lists.                  */
/*                                                                      */
/* Pure constants only (no server imports) so both the supervisor       */
/* service and the client editor import the SAME source of truth.       */
/* Values are the canonical Arabic labels stored directly in the        */
/* existing Course.category / Course.subcategory columns — every        */
/* listing, filter and report keeps rendering them unchanged.           */
/* ------------------------------------------------------------------ */

/** Training delivery types (canonical keys, Arabic labels). */
export const TRAINING_TYPES = [
  { value: "VIRTUAL_LIVE", label: "افتراضي مباشر" },
  { value: "RECORDED", label: "تدريب مسجّل" },
  { value: "IN_PERSON", label: "حضوري" },
  { value: "OTHER", label: "أخرى" },
] as const;

export type TrainingTypeKey = (typeof TRAINING_TYPES)[number]["value"];

/** Main training domains — stored in the existing Course.category. */
export const TRAINING_DOMAINS = [
  "تطوير الذات",
  "التقويم التربوي",
  "استراتيجيات التدريس",
  "إدارة الصف",
  "المنهج وتصميم التعلم",
  "الذكاء الاصطناعي والتقنية",
  "القيادة التربوية",
  "الجودة والاعتماد",
  "البحث والابتكار",
  "مهارات القرن الحادي والعشرين",
] as const;

/** Training subcategories — stored in the new Course.subcategory. */
export const TRAINING_SUBCATEGORIES = [
  "عام",
  "التخطيط",
  "التنفيذ",
  "التقويم التكويني",
  "التقويم الختامي",
  "التطوير المهني",
  "التواصل",
  "التعلم النشط",
  "التعلم المتمايز",
  "إدارة بيئة الصف",
  "الأدوات الرقمية",
  "الذكاء الاصطناعي",
] as const;

/** Default pass percentage of the final assessment (unified page). */
export const DEFAULT_PASSING_PERCENT = 60;

/** Arabic label of a training type key (fallback: the key itself). */
export function trainingTypeLabel(value: string | null | undefined): string {
  if (!value) return "غير محدد";
  return (
    TRAINING_TYPES.find((option) => option.value === value)?.label ?? value
  );
}
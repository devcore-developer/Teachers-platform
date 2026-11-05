/* ------------------------------------------------------------------ */
/* Batch 2 — the professional growth ladder (HTML v48 + v13 parity).    */
/*                                                                      */
/* Two rules from the ORIGINAL platform live here and nowhere else:      */
/*   1. v48 — the supervisor classifies each teacher T0..T5 and may      */
/*      approve ONE-level promotions when the teacher completed at       */
/*      least PROMOTION_THRESHOLD_PERCENT of the published courses       */
/*      assigned to them ("شرط الانتقال: 60%").                          */
/*   2. v13 — a SUGGESTED level computed from real training stats        */
/*      (hours + completion percentage). The suggestion is advisory;     */
/*      the persisted level only changes through the v48 controls.       */
/*                                                                      */
/* The annual target (35 hours) is also defined here — it appears in     */
/* the teacher home stats, the hours report and the yearly archive.      */
/* ------------------------------------------------------------------ */

export interface GrowthLevel {
  id: "T0" | "T1" | "T2" | "T3" | "T4" | "T5";
  nameAr: string;
  descriptionAr: string;
}

/** The exact original ladder: T0 معلم جديد → T5 باحث تربوي. */
export const GROWTH_LEVELS: readonly GrowthLevel[] = [
  { id: "T0", nameAr: "معلم جديد", descriptionAr: "بداية المسار المهني" },
  { id: "T1", nameAr: "متمكن", descriptionAr: "إتقان الأساسيات وتطبيقها" },
  { id: "T2", nameAr: "ممارس متميز", descriptionAr: "ممارسة صفية مؤثرة" },
  { id: "T3", nameAr: "معلم قائد", descriptionAr: "قيادة وتأثير داخل المدرسة" },
  { id: "T4", nameAr: "مدرب معلم", descriptionAr: "تدريب الزملاء ونقل الخبرة" },
  { id: "T5", nameAr: "باحث تربوي", descriptionAr: "أعلى مستوى — بحث وممارسة تجريبية" },
] as const;

export const GROWTH_LEVEL_IDS = GROWTH_LEVELS.map((level) => level.id);

export type GrowthLevelId = (typeof GROWTH_LEVELS)[number]["id"];

export function isGrowthLevelId(value: string): value is GrowthLevelId {
  return (GROWTH_LEVEL_IDS as string[]).includes(value);
}

/** "T2" -> "T2 — ممارس متميز" (the label format the HTML used). */
export function growthLevelLabel(id: string): string {
  const level = GROWTH_LEVELS.find((item) => item.id === id);
  return level ? `${level.id} — ${level.nameAr}` : id;
}

export function growthLevelName(id: string): string {
  return GROWTH_LEVELS.find((item) => item.id === id)?.nameAr ?? id;
}

/** The one-level-up step (null already at the top). */
export function nextGrowthLevel(id: string): GrowthLevelId | null {
  const index = GROWTH_LEVELS.findIndex((level) => level.id === id);
  if (index < 0 || index >= GROWTH_LEVELS.length - 1) return null;
  return GROWTH_LEVELS[index + 1].id;
}

/**
 * v48 — a teacher becomes eligible to move exactly ONE level up when
 * they complete at least this percentage of the published courses
 * assigned to them ("وعند إكمال المعلم 60% من الدورات المنشورة
 * المتاحة له، يصبح مستحقًا للانتقال مستوى واحد فقط").
 */
export const PROMOTION_THRESHOLD_PERCENT = 60;

/** The annual professional-learning target ("هدف الساعات السنوي"). */
export const ANNUAL_HOURS_TARGET = 35;

/** Percent progress toward the 35-hour target, capped at 100. */
export function annualHoursPercent(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.min(100, Math.round((hours / ANNUAL_HOURS_TARGET) * 100));
}

export interface GrowthStatsInput {
  /** Accumulated completed-course hours (the HTML suggestion used the
   * teacher's totals, independent of the academic year). */
  hours: number;
  /** Completion percentage over the teacher's assigned published courses. */
  assignedPercent: number;
}

/**
 * v13 — the SUGGESTED level from real stats. Exact original thresholds:
 *   hours>=35 && pct>=80 -> T5; 30/70 -> T4; 25/60 -> T3; 15/45 -> T2;
 *   hours>=5 || pct>=20 -> T1; else T0.
 */
export function suggestedGrowthLevel(stats: GrowthStatsInput): GrowthLevelId {
  const { hours, assignedPercent } = stats;
  if (hours >= 35 && assignedPercent >= 80) return "T5";
  if (hours >= 30 && assignedPercent >= 70) return "T4";
  if (hours >= 25 && assignedPercent >= 60) return "T3";
  if (hours >= 15 && assignedPercent >= 45) return "T2";
  if (hours >= 5 || assignedPercent >= 20) return "T1";
  return "T0";
}

/* ------------------------------------------------------------------ */
/* Supervisor -> teacher message types (HTML v38 modal — same six).     */
/* ------------------------------------------------------------------ */

export const MESSAGE_TYPES = [
  "FOLLOW_UP",
  "PRAISE",
  "GUIDANCE",
  "ALERT",
  "TASK",
  "EVALUATION",
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  FOLLOW_UP: "ملاحظة متابعة",
  PRAISE: "إشادة",
  GUIDANCE: "توجيه مهني",
  ALERT: "تنبيه",
  TASK: "تكليف تدريبي",
  EVALUATION: "تقييم",
};

export function isMessageType(value: string): value is MessageType {
  return (MESSAGE_TYPES as readonly string[]).includes(value);
}
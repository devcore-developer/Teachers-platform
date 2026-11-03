import {
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  FileBarChart2,
  GraduationCap,
  Upload,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import type {
  AppNotification,
  CurrentUser,
  OverviewStat,
  QuickAction,
  RecentActivity,
  StageDistributionPoint,
  TrainingProgressPoint,
  UpcomingEvent,
} from "@/lib/types";

/* ================================================================== */
/* MOCK DATA — Phase 1 only                                            */
/*                                                                     */
/* Every record below is clearly-identified sample data used to build  */
/* and verify the interface. No real school records are used here, and */
/* the teacher roster embedded in the original HTML file is NOT        */
/* imported. Later phases replace this file with real API/data layers. */
/* ================================================================== */

/** Mock signed-in user. Real authentication arrives in a later phase. */
export const mockCurrentUser: CurrentUser = {
  id: "user-demo-001",
  name: "أ. محمد عبدالله",
  role: "منسق التنمية المهنية",
  email: "coordinator@demo-school.edu",
  initials: "م.ع",
};

/** Dashboard overview statistics. */
export const mockOverviewStats: OverviewStat[] = [
  {
    id: "stat-teachers",
    label: "إجمالي المعلمين",
    value: 128,
    icon: UserPlus,
    accent: "primary",
    trend: { value: 8, direction: "up", label: "مقارنة بالفصل السابق" },
    targetModuleId: "teachers",
  },
  {
    id: "stat-programs",
    label: "البرامج التدريبية المتاحة",
    value: 24,
    icon: GraduationCap,
    accent: "info",
    trend: { value: 4, direction: "up", label: "برامج جديدة هذا الشهر" },
    targetModuleId: "programs",
  },
  {
    id: "stat-completed",
    label: "أنشطة تدريبية مكتملة",
    value: 156,
    icon: CheckCircle2,
    accent: "success",
    trend: { value: 12, direction: "up", label: "منذ بداية الفصل" },
    targetModuleId: "programs",
  },
  {
    id: "stat-pending",
    label: "متابعات تربوية معلقة",
    value: 9,
    icon: Clock,
    accent: "warning",
    trend: { value: 3, direction: "down", label: "تحتاج إجراء هذا الأسبوع" },
    targetModuleId: "assignments",
  },
];

/** Monthly training progress (hours) — consumed by the bar chart. */
export const mockTrainingProgress: TrainingProgressPoint[] = [
  { month: "سبتمبر", completed: 42, target: 60 },
  { month: "أكتوبر", completed: 58, target: 60 },
  { month: "نوفمبر", completed: 47, target: 60 },
  { month: "ديسمبر", completed: 65, target: 60 },
  { month: "يناير", completed: 72, target: 75 },
  { month: "فبراير", completed: 61, target: 75 },
];

/** Teacher distribution across educational stages — sums to 128. */
export const mockTeachersByStage: StageDistributionPoint[] = [
  { stage: "المرحلة الابتدائية", count: 54 },
  { stage: "المرحلة الإعدادية", count: 41 },
  { stage: "المرحلة الثانوية", count: 33 },
];

export const mockRecentActivities: RecentActivity[] = [
  {
    id: "act-1",
    type: "completed",
    title: "أكملت برنامج «استراتيجيات التدريس الحديث»",
    actor: "سارة أحمد",
    time: "قبل ساعتين",
  },
  {
    id: "act-2",
    type: "assessment",
    title: "تم اعتماد نتائج اختبار «قياس فهم المنهج المطوَّر»",
    actor: "لجنة التقييم",
    time: "قبل 4 ساعات",
  },
  {
    id: "act-3",
    type: "enrolled",
    title: "انضمت إلى برنامج «إدارة الصف بفاعلية»",
    actor: "فاطمة محمود",
    time: "أمس",
  },
  {
    id: "act-4",
    type: "certificate",
    title: "صدرت 12 شهادة لبرنامج «مهارات التواصل الفعّال»",
    actor: "النظام",
    time: "أمس",
  },
  {
    id: "act-5",
    type: "followup",
    title: "رفع تكليف «خطة التحسين الذاتي» للمتابعة",
    actor: "خالد سعيد",
    time: "قبل يومين",
  },
];

export const mockUpcomingEvents: UpcomingEvent[] = [
  {
    id: "evt-1",
    title: "ورشة «التقويم الحديث وأدواته»",
    day: "الأحد",
    date: "25 أكتوبر",
    time: "10:00 ص",
    location: "قاعة التدريب الرئيسية",
    type: "workshop",
    status: "upcoming",
    seatsLeft: 14,
  },
  {
    id: "evt-2",
    title: "دورة «التحول الرقمي في التعليم»",
    day: "الثلاثاء",
    date: "27 أكتوبر",
    time: "9:00 ص",
    location: "عن بُعد — منصة منارة",
    type: "course",
    status: "upcoming",
    seatsLeft: 32,
  },
  {
    id: "evt-3",
    title: "اجتماع منسقي المراحل الدراسية",
    day: "الخميس",
    date: "29 أكتوبر",
    time: "12:00 م",
    location: "غرفة الاجتماعات",
    type: "meeting",
    status: "upcoming",
  },
];

export const mockNotifications: AppNotification[] = [
  {
    id: "notif-1",
    title: "برنامج تدريبي جديد متاح",
    description: "«مهارات القيادة الأكاديمية» — التسجيل مفتوح حتى الخميس.",
    time: "قبل ساعة",
    read: false,
  },
  {
    id: "notif-2",
    title: "تذكير بموعد تسليم",
    description: "خطط المتابعة التربوية تُستلم قبل نهاية الأسبوع.",
    time: "قبل 3 ساعات",
    read: false,
  },
  {
    id: "notif-3",
    title: "تم اعتماد التقرير الشهري",
    description: "تقرير التدريب لشهر يناير أصبح متاحاً في قسم التقارير.",
    time: "أمس",
    read: true,
  },
];

/** Quick actions — each navigates to its related module (no fake flows). */
export const mockQuickActions: QuickAction[] = [
  {
    id: "qa-add-teacher",
    label: "إضافة معلم جديد",
    description: "تسجيل معلم في سجل المنصة",
    icon: UserPlus,
    targetModuleId: "teachers",
  },
  {
    id: "qa-browse-programs",
    label: "استعراض البرامج",
    description: "البرامج التدريبية المتاحة",
    icon: BookOpen,
    targetModuleId: "programs",
  },
  {
    id: "qa-upload-assignment",
    label: "رفع تكليف",
    description: "تكليف تربوي للمتابعة",
    icon: Upload,
    targetModuleId: "assignments",
  },
  {
    id: "qa-open-reports",
    label: "إصدار تقرير",
    description: "تقارير الإنجاز والمشاركة",
    icon: FileBarChart2,
    targetModuleId: "reports",
  },
];

/** Icon registry for activity rows (kept out of the data itself). */
export const activityIcons: Record<RecentActivity["type"], LucideIcon> = {
  completed: CheckCircle2,
  enrolled: GraduationCap,
  certificate: Award,
  assessment: FileBarChart2,
  followup: Clock,
};
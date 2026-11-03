import {
  Award,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Eye,
  GraduationCap,
  Landmark,
  LayoutDashboard,
  MonitorPlay,
  Settings,
  UserCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { NavItem } from "@/lib/types";

/**
 * Central navigation configuration.
 *
 * Every item below resolves to a real, implemented module route
 * (audited against src/app/**). Teacher management lives inside the
 * users directory (roles, statuses, supervisor assignments, school and
 * branch filters) — the dedicated /teachers placeholder route now
 * redirects there, so no duplicate sidebar entry is kept for it.
 *
 * The only intentionally-incomplete module left is "settings", which
 * keeps its honest "قريباً" badge until its phase begins.
 */
export const navItems: NavItem[] = [
  {
    id: "home",
    label: "الرئيسية",
    href: "/",
    description: "نظرة عامة على حالة التنمية المهنية ومؤشرات الأداء الرئيسية.",
    icon: LayoutDashboard,
    plannedFeatures: [],
  },
  {
    id: "academy",
    label: "الأكاديمية التدريبية",
    href: "/academy",
    description: "الدورات التدريبية المنشورة والمتاحة لك — تصفّح، سجّل، وابدأ التعلّم.",
    icon: BookOpen,
    plannedFeatures: [],
  },
  {
    id: "schools",
    label: "المدارس والفروع",
    href: "/schools",
    description: "إدارة المدارس المسجلة في المنصة وفروعها ومراحلها التعليمية.",
    icon: Landmark,
    plannedFeatures: [],
  },
  {
    id: "users",
    label: "دليل المستخدمين",
    href: "/users",
    description: "حسابات المنصة: الأدوار والحالات والإسنادات داخل نطاق صلاحيتك.",
    icon: Users,
    plannedFeatures: [],
  },
  {
    id: "supervision",
    label: "معلموّي",
    href: "/supervision",
    description: "المعلمون المسندون إليك وفروعك المصرّح بها — داخل نطاقك فقط.",
    icon: UserCheck,
    plannedFeatures: [],
  },
  {
    id: "programs",
    label: "البرامج التدريبية",
    href: "/academy/programs",
    description: "البرامج التي تُنظّم الدورات التدريبية — إنشاء ونشر وأرشفة.",
    icon: GraduationCap,
    plannedFeatures: [],
  },
  {
    id: "course-management",
    label: "إدارة الدورات",
    href: "/academy/manage",
    description: "إنشاء الدورات وبناء محتواها ونشرها لجمهورها المصرح له.",
    icon: MonitorPlay,
    plannedFeatures: [],
  },
  {
    id: "assessments",
    label: "الاختبارات والتقييم",
    href: "/assessments",
    description: "اختبارات مرتبطة بالدورات التدريبية — أدِ الاختبار وتابع نتائجك، أو أدر اختبارات مدرستك.",
    icon: ClipboardCheck,
    plannedFeatures: [],
  },
  {
    id: "deputy-overview",
    label: "نطاق اطلاعي",
    href: "/deputy-overview",
    description: "المدارس والفروع الممنوحة لك للاطلاع فقط مع مؤشراتها.",
    icon: Eye,
    plannedFeatures: [],
  },
  {
    id: "assignments",
    label: "التكليفات والمتابعة",
    href: "/assignments",
    description: "التكليفات التربوية والمتابعات المعلقة وحالتها.",
    icon: ClipboardList,
    plannedFeatures: [],
  },
  {
    id: "certificates",
    label: "الشهادات",
    href: "/certificates",
    description: "إصدار الشهادات للمشاركين والتحقق من صحتها.",
    icon: Award,
    plannedFeatures: [],
  },
  {
    id: "reports",
    label: "التقارير",
    href: "/reports",
    description: "تقارير تحليلية عن التدريب والمشاركة وأثرها.",
    icon: BarChart3,
    plannedFeatures: [],
  },
  {
    id: "my-profile",
    label: "ملفي الشخصي",
    href: "/my-profile",
    description: "بيانات حسابك ومدرستك وحالة توثيق بريدك.",
    icon: UserRound,
    plannedFeatures: [],
  },
  {
    id: "settings",
    label: "الإعدادات",
    href: "/settings",
    description: "إعدادات المنصة وهوية المدرسة والصلاحيات.",
    icon: Settings,
    badge: "قريباً",
    plannedFeatures: [
      "تخصيص هوية المدرسة والشعار والمراحل التعليمية",
      "إدارة الصلاحيات والأدوار",
      "الإعدادات العامة للمنصة",
    ],
  },
];

/** Find a nav item by its stable id. */
export function getNavItemId(id: string): NavItem | undefined {
  return navItems.find((item) => item.id === id);
}

/**
 * Route-aware active state for the sidebar/mobile navigation.
 * The dashboard matches exactly; module roots also match their
 * sub-routes (e.g. /schools matches /schools/new and /schools/{id}).
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Single best-matching item id for a pathname: the longest href wins.
 * Prevents double highlighting on nested routes — e.g. inside
 * /academy/manage/12 only "course-management" is active, not its
 * parent "academy" too. Returns null when nothing matches.
 */
export function activeNavItemId(pathname: string, items: NavItem[]): string | null {
  let bestId: string | null = null;
  let bestLength = -1;
  for (const item of items) {
    if (!isNavItemActive(pathname, item.href)) continue;
    if (item.href.length > bestLength) {
      bestId = item.id;
      bestLength = item.href.length;
    }
  }
  return bestId;
}
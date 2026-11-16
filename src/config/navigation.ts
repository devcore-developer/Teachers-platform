import {
  Archive,
  Award,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Eye,
  GraduationCap,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Link2,
  MessageSquare,
  MonitorPlay,
  Palette,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { NavItem } from "@/lib/types";

/**
 * Central navigation configuration.
 *
 * Every item resolves to a real page. "الإعدادات" is role-aware since
 * Batch 3: platform settings for SUPER_ADMIN, school workspace hub for
 * the school-administration pair. The stale "قريباً" badges on
 * التكليفات and الشهادات are gone — both modules are live.
 *
 * The supervisor dashboard ("لوحة المشرف") is intentionally NOT a nav
 * module anymore: it merged into the Home page (/) — the supervisor's
 * "الرئيسية" — and /supervision/dashboard now redirects there, so the
 * dashboard lives in exactly one place.
 *
 * IT_COORDINATOR workspace items (it / it-assignments / it-recovery)
 * resolve to their real server-guarded pages; NAV_ROLES already
 * restricted them to the IT role, so no other role ever receives them
 * from the server.
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
    description:
      "الدورات التدريبية المنشورة والمتاحة لك — تصفّح، سجّل، وابدأ التعلّم؛ ولمشرفي التدريب: مساحة تدريباتك الكاملة وإدارتها من مكان واحد.",
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
    id: "school-branding",
    label: "هوية المدرسة",
    href: "/schools/branding",
    description:
      "شعار مدرستك واسمها المعروض وألوان هويتها البصرية — تُطبق فورًا على كل المنصة.",
    icon: Palette,
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
    id: "school-users",
    label: "مستخدمو المدرسة",
    href: "/school-users",
    description:
      "عرض للقراءة فقط: معلمو المدرسة والمشرفون وأدوارهم داخل نطاق الاطلاع الممنوح لك.",
    icon: Users,
    plannedFeatures: [],
  },
  {
    id: "registration-links",
    label: "روابط تسجيل المعلمين",
    href: "/registration-links",
    description:
      "ولّد رابط تسجيل ذاتي لمعلمي مدرستك وانسخه وشاركه، وأدر الروابط النشطة مع متابعة من سجّل عبرها.",
    icon: Link2,
    plannedFeatures: [],
  },
  {
    id: "teachers",
    label: "إدارة المعلمين",
    href: "/teachers",
    description:
      "السجل المهني للمعلمين: التصنيف والساعات والشهادات، التعديل الإداري، واستيراد الإسنادات من Excel.",
    icon: Users,
    plannedFeatures: [],
  },
  {
    id: "supervision",
    label: "المعلمون",
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
    id: "supervisor-training",
    label: "إدارة التدريب",
    href: "/supervision/training",
    description:
      "أنشئ تدريبًا كاملًا من صفحة واحدة — المعلومات والفيديوهات والمرفقات والاختبار وقياس الأثر — وعدّل تدريباتك الحالية في أي وقت.",
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
    description: "إنشاء التكليفات التربوية ونشرها للمعلمين ومتابعة التسليمات والتصحيح.",
    icon: ClipboardList,
    plannedFeatures: [],
  },
  {
    id: "certificates",
    label: "الشهادات",
    href: "/certificates",
    description: "إصدار شهادات إتمام البرامج وإدارتها والتحقق من صحتها برمز فريد.",
    icon: Award,
    plannedFeatures: [],
  },
  {
    id: "reports",
    label: "التقارير",
    href: "/reports",
    description:
      "تقارير حقيقية من قاعدة البيانات: الساعات السنوية وهدف 35 ساعة، النمو المهني، الشهادات — مع تصدير CSV/JSON وطباعة.",
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
    description: "إعدادات المنصة لمدير المنصة، ومساحة إعدادات مدرستك للإدارة المدرسية.",
    icon: Settings,
    plannedFeatures: [],
  },
  {
    id: "messages",
    label: "الرسائل",
    href: "/messages",
    description:
      "رسائل المشرفين والمكتب — استلم رسائلك، وأرسل توجيهاتك المهنية للمعلمين داخل المنصة.",
    icon: MessageSquare,
    plannedFeatures: [],
  },
  {
    id: "account-security",
    label: "أمان الحساب",
    href: "/account-security",
    description: "تغيير كلمة المرور والبريد الإلكتروني بحماية كاملة وجلسات آمنة.",
    icon: ShieldCheck,
    plannedFeatures: [],
  },
  {
    id: "it",
    label: "لوحة تقنية المعلومات",
    href: "/it",
    description:
      "مركز منسق تقنية المعلومات: مؤشرات مدرستك الفعلية ومدخل سريع لإسناد المعلمين واستعادة حساباتهم.",
    icon: Wrench,
    plannedFeatures: [],
  },
  {
    id: "it-assignments",
    label: "إسناد المشرفين",
    href: "/it/assignments",
    description:
      "مساحة منسق تقنية المعلومات: إسناد معلمي مدرستك إلى المشرفين التربويين، ونقل الإسناد أو إزالته — كل عملية تتحقق على الخادم داخل مدرستك فقط.",
    icon: UserCheck,
    plannedFeatures: [],
  },
  {
    id: "it-recovery",
    label: "استعادة الحسابات",
    href: "/it/recovery",
    description:
      "إرسال رابط آمن لإعادة تعيين كلمة مرور المعلم إلى بريده المسجّل — يُستخدم مرة واحدة وينتهي بعد ساعة، مع حد أقصى للمحاولات.",
    icon: KeyRound,
    plannedFeatures: [],
  },
  {
    id: "training-archive",
    label: "السجل التدريبي السنوي",
    href: "/training-archive",
    description:
      "بيانات التدريب للعام الدراسي الحالي مع هدف 35 ساعة والأرشفة السنوية دون فقد أي بيانات.",
    icon: Archive,
    plannedFeatures: [],
  },
  {
    id: "growth",
    label: "النمو المهني",
    href: "/supervision/growth",
    description:
      "تصنيف معلميك من T0 إلى T5 واعتماد انتقالاتهم المهنية وفق شرط 60% — وإرسال رسالة للمعلم.",
    icon: TrendingUp,
    plannedFeatures: [],
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
 * Resolves the ONE active nav item for a pathname (longest href wins).
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

/* ------------------------------------------------------------------ */
/* Sidebar grouping — presentation only, shared by the desktop rail     */
/* and the mobile drawer so the two can never drift apart.              */
/*                                                                      */
/* Grouping NEVER adds, removes or re-orders modules: items still       */
/* arrive role-filtered from the server (navIdsForRole), and any id     */
/* that is not listed in the active profile falls back to an unlabeled  */
/* trailing group, so a future module can never disappear from the UI   */
/* by accident.                                                         */
/*                                                                      */
/* Three profiles (deterministic, data-driven, role-invisible):         */
/*   • IT_COORDINATOR — selected whenever the role-filtered set         */
/*     contains "it-assignments" (IT-only module): the coordinator's    */
/*     hub (/it) plus its two server-enforced capabilities + the        */
/*     communication/account group.                                     */
/*   • SUPERVISOR — the approved supervisor information architecture    */
/*     (الرئيسية / التدريب والتطوير / المتابعة والنتائج / التواصل       */
/*     والحساب). Selected whenever the set contains "supervisor-        */
/*     training".                                                       */
/*   • DEFAULT — the classic grouping, byte-for-byte identical output   */
/*     to the previous sidebar for all other roles.                     */
/* ------------------------------------------------------------------ */

export interface NavGroupDef {
  label: string;
  members: string[];
}

export interface RenderedNavGroup {
  label: string;
  items: NavItem[];
}

const DEFAULT_NAV_GROUPS: NavGroupDef[] = [
  {
    label: "القائمة الرئيسية",
    members: [
      "home",
      "academy",
      "schools",
      "school-branding",
      "users",
      "school-users",
      "registration-links",
      "supervision",
      "deputy-overview",
    ],
  },
  {
    label: "التدريب والتقييم",
    members: [
      "programs",
      "course-management",
      "assessments",
      "assignments",
      "certificates",
      "reports",
    ],
  },
  {
    label: "حسابي",
    members: ["my-profile", "settings"],
  },
];

/** Supervisor profile — the approved 4-group information architecture. */
const SUPERVISOR_NAV_GROUPS: NavGroupDef[] = [
  {
    label: "الرئيسية",
    members: ["home", "supervision"],
  },
  {
    label: "التدريب والتطوير",
    members: ["academy", "supervisor-training"],
  },
  {
    label: "المتابعة والنتائج",
    members: ["assignments", "certificates", "reports", "growth"],
  },
  {
    label: "التواصل والحساب",
    members: ["messages", "my-profile", "account-security"],
  },
];

/**
 * IT coordinator profile — ONLY the modules the role actually owns.
 * No academy, no reports, no training-management entries: the
 * coordinator's workspace is its hub (/it) plus the exactly-two
 * server-enforced capabilities and the shared communication/account
 * group (messages / my-profile / account-security are already granted
 * to every role in NAV_ROLES).
 */
const IT_NAV_GROUPS: NavGroupDef[] = [
  {
    label: "الرئيسية",
    members: ["home"],
  },
  {
    label: "صلاحيات تقنية المعلومات",
    members: ["it", "it-assignments", "it-recovery"],
  },
  {
    label: "التواصل والحساب",
    members: ["messages", "my-profile", "account-security"],
  },
];

/**
 * Group the role-filtered items following the active profile. Items are
 * emitted in the profile's member order, unknown ids fall back to an
 * unlabeled trailing group in config order, and empty groups are
 * dropped — other roles keep exactly the groups they see today.
 */
export function navGroupsForItems(items: NavItem[]): RenderedNavGroup[] {
  const profile = items.some((item) => item.id === "it-assignments")
    ? IT_NAV_GROUPS
    : items.some((item) => item.id === "supervisor-training")
      ? SUPERVISOR_NAV_GROUPS
      : DEFAULT_NAV_GROUPS;

  const byId = new Map(items.map((item) => [item.id, item]));
  const known = new Set(profile.flatMap((group) => group.members));

  const groups: RenderedNavGroup[] = profile.map((group) => ({
    label: group.label,
    items: group.members
      .map((id) => byId.get(id))
      .filter((item): item is NavItem => item !== undefined),
  }));

  const leftovers = items.filter((item) => !known.has(item.id));
  if (leftovers.length > 0) groups.push({ label: "", items: leftovers });

  return groups.filter((group) => group.items.length > 0);
}
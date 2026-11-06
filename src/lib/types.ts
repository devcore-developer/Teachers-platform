import type { LucideIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Platform identity & multi-school readiness                          */
/* ------------------------------------------------------------------ */

/** Educational stages a school can serve (used by future school config). */
export type EducationalStage =
  | "المرحلة الابتدائية"
  | "المرحلة المتوسطة"
  | "المرحلة الثانوية";

/**
 * Identity of a single school. In later phases each school tenant will
 * provide its own identity instead of relying on the platform defaults.
 */
export interface SchoolIdentity {
  id: string;
  name: string;
  logoUrl?: string;
  branches: string[];
  stages: EducationalStage[];
}

/**
 * Branding shown in the application shell. The platform ships with
 * default branding; per-school overrides arrive with multi-tenancy.
 */
export interface PlatformBranding {
  productName: string;
  subtitle: string;
  shortName: string;
  logoUrl?: string;
  /** The school workspace currently active. Undefined until tenant config lands. */
  currentSchool?: SchoolIdentity;
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

export interface NavItem {
  /** Stable identifier used for active-state tracking. */
  id: string;
  label: string;
  /** Final route once the module is implemented in a later phase. */
  href: string;
  /** Short contextual description shown on the module page header. */
  description: string;
  icon: LucideIcon;
  /** Features planned for the module — surfaced honestly on placeholder pages. */
  plannedFeatures: string[];
  /** Optional small badge (e.g. "قريباً") rendered next to the label. */
  badge?: string;
}

/* ------------------------------------------------------------------ */
/* User & notifications                                                */
/* ------------------------------------------------------------------ */

export interface CurrentUser {
  id: string;
  name: string;
  role: string;
  email: string;
  initials: string;
}

export interface AppNotification {
  id: string;
  title: string;
  description?: string;
  time: string;
  read: boolean;
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export type TrendDirection = "up" | "down" | "flat";

export interface StatTrend {
  value: number;
  direction: TrendDirection;
  label: string;
}

export type AccentColor = "primary" | "info" | "success" | "warning";

export interface OverviewStat {
  id: string;
  label: string;
  value: number;
  suffix?: string;
  icon: LucideIcon;
  accent: AccentColor;
  trend: StatTrend;
  /** Nav item id the card navigates to. */
  targetModuleId: string;
}

export interface TrainingProgressPoint {
  month: string;
  /** Completed training hours for the month. */
  completed: number;
  /** Target training hours for the month. */
  target: number;
}

export interface StageDistributionPoint {
  stage: EducationalStage;
  count: number;
}

export type ActivityType =
  | "completed"
  | "enrolled"
  | "certificate"
  | "assessment"
  | "followup";

export interface RecentActivity {
  id: string;
  type: ActivityType;
  title: string;
  actor: string;
  time: string;
}

export type TrainingEventType = "workshop" | "course" | "meeting";

export type EventStatus = "upcoming" | "ongoing" | "completed";

export interface UpcomingEvent {
  id: string;
  title: string;
  day: string;
  date: string;
  time: string;
  location: string;
  type: TrainingEventType;
  status: EventStatus;
  seatsLeft?: number;
}

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Nav item id the action navigates to. */
  targetModuleId: string;
}
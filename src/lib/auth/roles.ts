/* ------------------------------------------------------------------ */
/* Canonical role keys — stored in the DB `User.role` column and        */
/* validated with Zod on every write. Arabic labels are UI-only and    */
/* never persisted.                                                    */
/* ------------------------------------------------------------------ */

export const ROLE_KEYS = [
  "SUPER_ADMIN",
  "DEVELOPMENT_OFFICE_MANAGER",
  "EDUCATIONAL_DEPUTY",
  "EDUCATIONAL_SUPERVISOR",
  "TEACHER",
] as const;

export type Role = (typeof ROLE_KEYS)[number];

/** User-facing Arabic role labels. */
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "مدير المنصة",
  DEVELOPMENT_OFFICE_MANAGER: "مدير مكتب التطوير",
  EDUCATIONAL_DEPUTY: "الوكيل التعليمي",
  EDUCATIONAL_SUPERVISOR: "المشرف التربوي",
  TEACHER: "معلم",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}

/* ------------------------------------------------------------------ */
/* Centralized capabilities — the single source of role semantics.      */
/* Server code must ask these functions instead of comparing role       */
/* strings ad-hoc (no scattered authorization logic).                   */
/* ------------------------------------------------------------------ */

/** Platform-wide administrative area (directory, account management). */
export function canManagePlatform(role: string): boolean {
  return role === "SUPER_ADMIN";
}

/**
 * School-level administration. Office managers are confined to their
 * own school by the service layer (their schoolId comes from the DB,
 * never from the client).
 */
export function canAdministerSchool(role: string): boolean {
  return role === "SUPER_ADMIN" || role === "DEVELOPMENT_OFFICE_MANAGER";
}

/** Read-only authorized views — never operational mutations. */
export function isReadOnlyRole(role: string): boolean {
  return role === "EDUCATIONAL_DEPUTY";
}

/** Only teachers must verify their email before first sign-in. */
export function requiresEmailVerification(role: string): boolean {
  return role === "TEACHER";
}

/* ------------------------------------------------------------------ */
/* Role-aware navigation                                                */
/* ------------------------------------------------------------------ */

/** Which nav modules each role may see. Unlisted roles see only "home". */
const NAV_ROLES: Record<string, Role[]> = {
  home: [...ROLE_KEYS],
  // Phase 5 — training academy catalog (published courses, scoped by
  // school; publishing controls live behind separate admin modules)
  academy: [...ROLE_KEYS],
  // Platform + school administration
  schools: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER"],
  // Phase 4 — user directory (school-scoped for office managers)
  users: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER"],
  // Teacher professional records module (later phase) — admins only
  teachers: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER"],
  // Phase 4 — supervisor workspace (assigned teachers only)
  supervision: ["EDUCATIONAL_SUPERVISOR"],
  // Phase 4 — deputy read-only scope overview
  "deputy-overview": ["EDUCATIONAL_DEPUTY"],
  // Phase 5 — program + course management (admin pair only)
  programs: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER"],
  "course-management": ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER"],
  // Phase 6 — assessments: teachers take them; managers administer;
  // supervisors/deputies get read-only results inside their scope
  assessments: [...ROLE_KEYS],
  assignments: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER", "EDUCATIONAL_SUPERVISOR"],
  certificates: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER", "EDUCATIONAL_SUPERVISOR"],
  reports: [...ROLE_KEYS],
  settings: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER"],
  // Phase 4 — self-service profile (every role, own data only)
  "my-profile": [...ROLE_KEYS],
  // Batch 2 — supervisor->teacher messaging inbox (everyone reads;
  // composing is scope-checked server-side per role)
  messages: [...ROLE_KEYS],
  // Batch 2 — self-service account security (password/email change)
  "account-security": [...ROLE_KEYS],
  // Batch 2 — yearly training record + archives (office/admin)
  "training-archive": ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER"],
  // Batch 2 — the professional growth board (v48 classification & promotion)
  growth: ["EDUCATIONAL_SUPERVISOR"],
};

/**
 * Module ids visible to a role, computed on the SERVER. Server
 * components pass these serializable ids to client shells, which resolve
 * the full NavItem objects (icons are component references and cannot
 * cross the RSC serialization boundary). Page-level guards remain the
 * real security boundary; this only shapes navigation.
 */
export function navIdsForRole(role: string | undefined): string[] {
  if (!role) return [];
  return Object.entries(NAV_ROLES)
    .filter(([, roles]) => (roles as string[]).includes(role as Role))
    .map(([id]) => id);
}
/* ------------------------------------------------------------------ */
/* Canonical role keys — stored in the DB `User.role` column and        */
/* validated with Zod on every write. Arabic labels are UI-only and     */
/* never persisted.                                                     */
/*                                                                      */
/* Seven canonical roles. SCHOOL_MANAGER and IT_COORDINATOR have been   */
/* part of the runtime authorization model since Batch 2 (dev-admin.ts  */
/* contexts, IT service, account creation) — they are now declared      */
/* HERE too so labels, navigation and capability checks stop falling    */
/* back to raw English keys.                                            */
/* ------------------------------------------------------------------ */

export const ROLE_KEYS = [
  "SUPER_ADMIN",
  "DEVELOPMENT_OFFICE_MANAGER",
  "SCHOOL_MANAGER",
  "IT_COORDINATOR",
  "EDUCATIONAL_DEPUTY",
  "EDUCATIONAL_SUPERVISOR",
  "TEACHER",
] as const;

export type Role = (typeof ROLE_KEYS)[number];

/** User-facing Arabic role labels. */
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "مدير المنصة",
  DEVELOPMENT_OFFICE_MANAGER: "مدير مكتب التطوير",
  SCHOOL_MANAGER: "مدير مدرسة",
  IT_COORDINATOR: "منسق تقنية المعلومات",
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
 * School-level administration. Office managers AND school managers are
 * structurally confined to their own school by the service layer (their
 * schoolId comes from the DB, never from the client); the platform
 * owner may act across schools where a module explicitly allows it.
 */
export function canAdministerSchool(role: string): boolean {
  return (
    role === "SUPER_ADMIN" ||
    role === "DEVELOPMENT_OFFICE_MANAGER" ||
    role === "SCHOOL_MANAGER"
  );
}

/**
 * School visual-identity management (logo, displayed name, palette).
 * Tenant scope is enforced again in src/lib/branding.ts.
 */
export function canManageSchoolBranding(role: string): boolean {
  return canAdministerSchool(role);
}

/** School-level user management (directory + account creation). */
export function canManageSchoolUsers(role: string): boolean {
  return canAdministerSchool(role);
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

/**
 * Which nav modules each role may see. Unlisted roles see only "home".
 *
 * SCHOOL_MANAGER deliberately mirrors DEVELOPMENT_OFFICE_MANAGER on
 * every school-operational module: the difference between the two roles
 * is TENANT SCOPE and signature identity, never missing pages.
 *
 * Read-only modules for limited roles:
 *   assignments / certificates — SUPER_ADMIN and EDUCATIONAL_SUPERVISOR
 *   get read-only registers (enforced again at page + service level).
 *   school-users — EDUCATIONAL_DEPUTY read-only directory.
 *
 * The supervisor's dashboard is the Home page itself (merged, single
 * source of truth) — there is no separate supervisor dashboard module.
 */
const NAV_ROLES: Record<string, Role[]> = {
  home: [...ROLE_KEYS],
  // Phase 5 — training academy catalog (published courses, scoped by
  // school; publishing controls live behind separate admin modules)
  academy: [...ROLE_KEYS],
  // Platform + school administration
  schools: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER", "SCHOOL_MANAGER"],
  // Multi-school branding — school identity management (logo/name/colors)
  "school-branding": ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER", "SCHOOL_MANAGER"],
  // Phase 4 — user directory (school-scoped for office/school managers)
  users: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER", "SCHOOL_MANAGER"],
  // Teacher professional records module — school administration only
  teachers: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER", "SCHOOL_MANAGER"],
  // Phase 4 — supervisor workspace (assigned teachers only)
  supervision: ["EDUCATIONAL_SUPERVISOR"],
  // Phase 4 — deputy read-only scope overview
  "deputy-overview": ["EDUCATIONAL_DEPUTY"],
  // Batch 3 — deputy read-only school users directory
  "school-users": ["EDUCATIONAL_DEPUTY"],
  // Phase 5 — program + course management (admin trio)
  programs: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER", "SCHOOL_MANAGER"],
  "course-management": ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER", "SCHOOL_MANAGER"],
  // Supervisor training workspace — a dedicated, school-scoped mirror
  // of the training lifecycle (courses+builder / assessments / impact).
  // Same service layer, same tenant fences, separate routes so the
  // admin-trio modules keep their own guards untouched. The former
  // "supervisor-dashboard" module merged into the Home page (/) — its
  // widgets render there and /supervision/dashboard redirects to /.
  "supervisor-training": ["EDUCATIONAL_SUPERVISOR"],
  "supervisor-assessments": ["EDUCATIONAL_SUPERVISOR"],
  "supervisor-impact": ["EDUCATIONAL_SUPERVISOR"],
  // Phase 6 — assessments: teachers take them; managers administer;
  // deputies get read-only results inside their scope. Supervisors are
  // intentionally NOT listed: their dedicated supervisor-assessments
  // module (create, publish, results, teacher performance) supersedes
  // the generic read-only view, so the sidebar carries no duplicate
  // entries. The /assessments route and its guards are untouched.
  assessments: [
    "SUPER_ADMIN",
    "DEVELOPMENT_OFFICE_MANAGER",
    "SCHOOL_MANAGER",
    "EDUCATIONAL_DEPUTY",
    "TEACHER",
  ],
  // Phase 7 — assignments: managers run them; supervisor sees a
  // read-only register of what targets their assigned teachers;
  // SUPER_ADMIN sees a platform-wide read-only register
  assignments: [
    "SUPER_ADMIN",
    "DEVELOPMENT_OFFICE_MANAGER",
    "SCHOOL_MANAGER",
    "EDUCATIONAL_SUPERVISOR",
  ],
  // Phase 8 — certificates: same split as assignments (managers issue;
  // supervisor + SUPER_ADMIN read-only inside their scope)
  certificates: [
    "SUPER_ADMIN",
    "DEVELOPMENT_OFFICE_MANAGER",
    "SCHOOL_MANAGER",
    "EDUCATIONAL_SUPERVISOR",
  ],
  reports: [...ROLE_KEYS],
  // Batch 3 — settings is role-aware: platform settings for
  // SUPER_ADMIN, school workspace hub for the school-admin pair
  settings: ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER", "SCHOOL_MANAGER"],
  // Phase 4 — self-service profile (every role, own data only)
  "my-profile": [...ROLE_KEYS],
  // Batch 2 — supervisor->teacher messaging inbox (everyone reads;
  // composing is scope-checked server-side per role)
  messages: [...ROLE_KEYS],
  // Batch 2 — self-service account security (password/email change)
  "account-security": [...ROLE_KEYS],
  // Batch 2 — yearly training record + archives (school administration)
  "training-archive": ["SUPER_ADMIN", "DEVELOPMENT_OFFICE_MANAGER", "SCHOOL_MANAGER"],
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
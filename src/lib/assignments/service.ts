/**
 * Phase 7 — assignment service: management, teacher workspace,
 * submission lifecycle, supervision review and metrics.
 *
 * Architecture mirrors the Phase 6 assessment service:
 *   - every mutation re-validates role, tenant and (for supervisors)
 *     persisted supervisor-to-teacher scope on the SERVER,
 *   - teacher identity/eligibility never comes from the client,
 *   - status flips use conditional updateMany inside transactions so
 *     concurrent double-submits / double-grades cannot corrupt state,
 *   - feedback and scores are RELEASED to the teacher only when the
 *     submission is GRADED (or RETURNED, which carries the revision
 *     request the teacher must see to act on).
 *
 * Audience targeting note: the platform has no Group model yet, so the
 * three supported audiences are ALL_TEACHERS / BRANCHES / TEACHERS.
 * Group targeting can be added later without touching submissions.
 */
import { Prisma } from "@prisma/client";

import {
  assignmentScopeError,
  isTeacherTargeted,
  manageGuard,
  parseJsonIds,
  reviewGuard,
  type AssignmentActor,
  type TargetingSnapshot,
  type ViewerIdentity,
} from "@/lib/assignments/access";

/**
 * Local alias: the platform's own AdminContext union is narrower than
 * the assignment actor set (it has no supervisor/deputy members), so
 * the service types every actor as the Phase 7 AssignmentActor from
 * access.ts. Values built by callers remain structurally compatible.
 */
type AdminContext = AssignmentActor;
import {
  deleteSubmissionObject,
  saveSubmissionObject,
} from "@/lib/assignments/storage";
import {
  notifyAssignmentPublished,
  notifySubmissionGraded,
  notifySubmissionReceived,
  notifySubmissionReturned,
} from "@/lib/notifications/hooks";
import { db } from "@/lib/db";
import {
  ALLOWED_FILE_TYPES,
  ASSIGNMENTS_PAGE_SIZE,
  MAX_FILES_PER_SUBMISSION,
  MAX_FILE_SIZE_BYTES,
  MAX_NO_RUBRIC_SCORE,
  MAX_TOTAL_POINTS,
  OVERVIEW_ROWS_LIMIT,
  REVIEW_QUEUE_LIMIT,
  TEACHER_EDITABLE_STATUSES,
  type AudienceMode,
  type SubmissionStatus,
} from "@/config/assignments";
import {
  assignmentFail,
  createAssignmentSchema,
  deleteSubmissionFileSchema,
  gradeSubmissionSchema,
  markUnderReviewSchema,
  returnSubmissionSchema,
  saveRubricSchema,
  saveSubmissionDraftSchema,
  setAssignmentStatusSchema,
  submitSubmissionSchema,
  updateAssignmentSchema,
  validationFail,
  type AssignmentErrorCode,
  type AssignmentResult,
} from "@/lib/validation/assignments";

export type { AssignmentErrorCode, AssignmentResult } from "@/lib/validation/assignments";

/* ------------------------------------------------------------------ */
/* Parsed + row shapes consumed by pages (RSC-serializable)             */
/* ------------------------------------------------------------------ */

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
}

export interface CriterionRow {
  id: string;
  orderIndex: number;
  titleAr: string;
  maxPoints: number;
}

export interface ManageAssignmentRow {
  id: string;
  titleAr: string;
  titleEn: string | null;
  status: string;
  audienceMode: string;
  dueAt: Date;
  publishedAt: Date | null;
  totalPoints: number;
  submissionsTotal: number;
  pendingCount: number;
  gradedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignmentSubmissionStats {
  drafts: number;
  submitted: number;
  underReview: number;
  returned: number;
  graded: number;
  lateCount: number;
  targeted: number;
}

export interface ManageAssignmentDetail {
  assignment: Omit<ManageAssignmentRow, "submissionsTotal" | "pendingCount" | "gradedCount"> & {
    descriptionAr: string;
    descriptionEn: string | null;
    allowLate: boolean;
    lateUntil: Date | null;
    programId: string | null;
    courseId: string | null;
    sectionId: string | null;
    lessonId: string | null;
    targetTeacherIds: string[];
    targetBranchIds: string[];
  };
  criteria: CriterionRow[];
  stats: AssignmentSubmissionStats;
}

export interface AudienceOptions {
  teachers: { id: string; name: string; branchId: string | null; branchName: string | null }[];
  branches: { id: string; name: string }[];
}

export interface ContentOptions {
  programs: { id: string; name: string }[];
  courses: { id: string; titleAr: string }[];
  sections: { id: string; titleAr: string; courseId: string }[];
  lessons: { id: string; titleAr: string; sectionId: string }[];
}

export interface TeacherAssignmentRow {
  id: string;
  titleAr: string;
  titleEn: string | null;
  status: string;
  dueAt: Date;
  totalPoints: number;
  windowState: "open" | "late" | "closed";
  myStatus: SubmissionStatus | null;
  myIsLate: boolean | null;
  myScoreTotal: number | null;
  courseTitle: string | null;
}

export interface TeacherSubmissionFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface TeacherSubmissionView {
  id: string;
  status: SubmissionStatus;
  responseText: string | null;
  isLate: boolean;
  submittedAt: Date | null;
  lastSubmittedAt: Date | null;
  resubmitCount: number;
  files: TeacherSubmissionFile[];
  /** Released ONLY after grading. */
  scoreTotal: number | null;
  /** Released when GRADED (score feedback) or RETURNED (revision request). */
  feedbackText: string | null;
  reviewedAt: Date | null;
  rubricScores: { criterionId: string; points: number }[] | null;
  revisions: { revisionIndex: number; createdAt: Date; note: string | null }[];
  canEdit: boolean;
}

export interface TeacherAssignmentDetail {
  assignment: {
    id: string;
    titleAr: string;
    titleEn: string | null;
    descriptionAr: string;
    descriptionEn: string | null;
    status: string;
    dueAt: Date;
    allowLate: boolean;
    lateUntil: Date | null;
    publishedAt: Date | null;
    totalPoints: number;
    programTitle: string | null;
    courseTitle: string | null;
    sectionTitle: string | null;
    lessonTitle: string | null;
  };
  windowState: "open" | "late" | "closed";
  criteria: CriterionRow[];
  mySubmission: TeacherSubmissionView | null;
}

export interface ReviewSubmissionRow {
  id: string;
  teacherId: string;
  teacherName: string;
  branchName: string | null;
  status: SubmissionStatus;
  isLate: boolean;
  submittedAt: Date | null;
  lastSubmittedAt: Date | null;
  resubmitCount: number;
  scoreTotal: number | null;
  reviewedAt: Date | null;
}

export interface ReviewQueueRow {
  submissionId: string;
  assignmentId: string;
  assignmentTitle: string;
  teacherId: string;
  teacherName: string;
  status: SubmissionStatus;
  isLate: boolean;
  lastSubmittedAt: Date | null;
  scoreTotal: number | null;
}

export interface ReviewSubmissionDetail {
  submission: {
    id: string;
    status: SubmissionStatus;
    responseText: string | null;
    isLate: boolean;
    submittedAt: Date | null;
    lastSubmittedAt: Date | null;
    resubmitCount: number;
    scoreTotal: number | null;
    feedbackText: string | null;
    reviewedAt: Date | null;
  };
  assignment: {
    id: string;
    titleAr: string;
    status: string;
    dueAt: Date;
    allowLate: boolean;
    lateUntil: Date | null;
    totalPoints: number;
    hasRubric: boolean;
  };
  teacher: {
    id: string;
    name: string;
    email: string;
    branchName: string | null;
  };
  criteria: CriterionRow[];
  rubricScores: { criterionId: string; points: number }[];
  files: TeacherSubmissionFile[];
  revisions: {
    revisionIndex: number;
    createdAt: Date;
    note: string | null;
    responseText: string | null;
  }[];
}

export interface OverviewRow {
  id: string;
  titleAr: string;
  status: string;
  dueAt: Date;
  targeted: number;
  submitted: number;
  pending: number;
  returned: number;
  graded: number;
  late: number;
  completionRate: number | null;
}

export interface SchoolBreakdownRow {
  schoolId: string;
  schoolName: string;
  assignmentsPublished: number;
  submissionsActive: number;
  gradedCount: number;
  completionRate: number | null;
}

export interface AssignmentOverview {
  scope: "school" | "deputy" | "platform";
  cards: {
    assignmentsPublished: number;
    submissionsActive: number;
    pendingReview: number;
    returnedCount: number;
    gradedCount: number;
    lateCount: number;
    targetedPairs: number;
    completionRate: number | null;
  };
  rows: OverviewRow[];
  schools: SchoolBreakdownRow[];
}

export interface AssignmentMetrics {
  assignmentsTotal: number;
  assignmentsPublished: number;
  submissionsActive: number;
  pendingReview: number;
  gradedCount: number;
  lateCount: number;
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                     */
/* ------------------------------------------------------------------ */

async function requireAdmin(): Promise<AdminContext> {
  // Services are called from server actions that already resolved the
  // context; this fallback exists for tests and keeps the signature
  // symmetric with the other services.
  const { requireAdminContext } = await import("@/lib/auth/dev-admin");
  return requireAdminContext();
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function targetingOf(row: {
  audienceMode: string;
  targetTeacherIdsJson: string | null;
  targetBranchIdsJson: string | null;
}): TargetingSnapshot {
  return {
    audienceMode: row.audienceMode,
    targetTeacherIds: parseJsonIds(row.targetTeacherIdsJson),
    targetBranchIds: parseJsonIds(row.targetBranchIdsJson),
  };
}

/** Server-side window decision — the browser clock is never consulted. */
function submissionWindow(
  assignment: { dueAt: Date; allowLate: boolean; lateUntil: Date | null },
  now: Date = new Date()
): { open: boolean; late: boolean } {
  if (now.getTime() <= assignment.dueAt.getTime()) return { open: true, late: false };
  if (
    assignment.allowLate &&
    (!assignment.lateUntil || now.getTime() <= assignment.lateUntil.getTime())
  ) {
    return { open: true, late: true };
  }
  return { open: false, late: false };
}

function windowStateOf(
  assignment: { status: string; dueAt: Date; allowLate: boolean; lateUntil: Date | null },
  now: Date = new Date()
): "open" | "late" | "closed" {
  if (assignment.status !== "PUBLISHED") return "closed";
  const window = submissionWindow(assignment, now);
  return window.open ? (window.late ? "late" : "open") : "closed";
}

/**
 * DB-verified eligible teachers for one assignment. `scope` narrows the
 * school's teachers for deputy views (branch grants) — null/undefined
 * scope fields mean "no extra narrowing".
 */
async function eligibleTeacherRows(
  schoolId: string,
  targeting: TargetingSnapshot,
  scope?: { allowedBranchIds?: string[] | null }
): Promise<{ id: string; name: string; branchId: string | null }[]> {
  const rows = await db.user.findMany({
    where: { role: "TEACHER", schoolId },
    select: { id: true, name: true, branchId: true },
  });
  const allowed = scope?.allowedBranchIds ?? null;
  return rows.filter((teacher) => {
    if (!isTeacherTargeted(targeting, teacher)) return false;
    if (allowed) {
      if (teacher.branchId === null || !allowed.includes(teacher.branchId)) return false;
    }
    return true;
  });
}

interface DeputyScope {
  schoolId: string;
  /** null = the whole school is granted */
  allowedBranchIds: string[] | null;
}

async function resolveDeputyScopes(viewer: ViewerIdentity): Promise<DeputyScope[]> {
  const grants = await db.deputyGrant.findMany({
    where: { userId: viewer.id },
    select: { schoolId: true, branchId: true },
  });
  const bySchool = new Map<string, string[] | null>();
  for (const grant of grants) {
    const current = bySchool.get(grant.schoolId);
    if (grant.branchId === null) {
      bySchool.set(grant.schoolId, null);
    } else if (current !== null) {
      bySchool.set(grant.schoolId, [...(current ?? []), grant.branchId]);
    }
  }
  return [...bySchool.entries()].map(([schoolId, allowedBranchIds]) => ({
    schoolId,
    allowedBranchIds,
  }));
}

/** Teacher identity + eligibility resolved from the DB, never the client. */
async function loadTeacherEligibility(
  assignment: {
    schoolId: string;
    audienceMode: string;
    targetTeacherIdsJson: string | null;
    targetBranchIdsJson: string | null;
  },
  viewer: ViewerIdentity
): Promise<AssignmentResult<{ id: string; branchId: string | null }>> {
  if (viewer.role !== "TEACHER") {
    return assignmentFail("التسليم متاح للمعلمين فقط", "FORBIDDEN");
  }
  const user = await db.user.findUnique({
    where: { id: viewer.id },
    select: { id: true, role: true, schoolId: true, branchId: true },
  });
  if (!user || user.role !== "TEACHER") {
    return assignmentFail("التسليم متاح للمعلمين فقط", "FORBIDDEN");
  }
  if (user.schoolId !== assignment.schoolId) {
    return assignmentFail("هذا التكليف لا ينتمي إلى مدرستك", "FORBIDDEN");
  }
  if (!isTeacherTargeted(targetingOf(assignment), user)) {
    return assignmentFail("هذا التكليف غير موجَّه إليك", "FORBIDDEN");
  }
  return { ok: true, data: { id: user.id, branchId: user.branchId } };
}

/** Supervisor reach: persisted teacher assignments inside own school. */
async function supervisorTeacherIds(
  ctx: AdminContext
): Promise<AssignmentResult<string[]>> {
  const rows = await db.teacherSupervisorAssignment.findMany({
    where: { supervisorId: ctx.id, schoolId: ctx.schoolId ?? undefined },
    select: { teacherId: true },
  });
  return { ok: true, data: rows.map((row) => row.teacherId) };
}

/**
 * Shared load-and-scope for review functions. Office managers reach the
 * whole school; supervisors only submissions of THEIR assigned teachers
 * (URL/payload manipulation cannot widen this — the set comes from
 * persisted TeacherSupervisorAssignment rows).
 */
async function loadSubmissionForReview(
  ctx: AdminContext,
  submissionId: string
): Promise<
  AssignmentResult<
    Prisma.AssignmentSubmissionGetPayload<{
      include: {
        assignment: {
          select: {
            id: true;
            titleAr: true;
            status: true;
            schoolId: true;
            dueAt: true;
            allowLate: true;
            lateUntil: true;
            totalPoints: true;
          };
        };
        teacher: {
          select: { id: true; name: true; email: true; branch: { select: { nameAr: true } } };
        };
      };
    }>
  >
> {
  const guard = reviewGuard(ctx);
  if (guard) return guard;

  const row = await db.assignmentSubmission.findUnique({
    where: { id: submissionId },
    include: {
      assignment: {
        select: {
          id: true,
          titleAr: true,
          status: true,
          schoolId: true,
          dueAt: true,
          allowLate: true,
          lateUntil: true,
          totalPoints: true,
        },
      },
      teacher: {
        select: { id: true, name: true, email: true, branch: { select: { nameAr: true } } },
      },
    },
  });
  if (!row) return assignmentFail("التسليم غير موجود", "NOT_FOUND");

  const scopeCheck = assignmentScopeError(ctx, row.assignment.schoolId);
  if (scopeCheck) return scopeCheck;

  if (ctx.role === "EDUCATIONAL_SUPERVISOR") {
    const teachers = await supervisorTeacherIds(ctx);
    if (!teachers.ok) return teachers;
    if (!teachers.data.includes(row.teacherId)) {
      return assignmentFail(
        "هذا المعلم ليس ضمن المعلمين المشرف عليهم",
        "FORBIDDEN"
      );
    }
  }
  return { ok: true, data: row };
}

/**
 * Phase 12 — content sniffing (defense in depth).
 *
 * The browser-reported MIME type is client-controlled, so a renamed
 * binary can arrive declaring itself "application/pdf". For every
 * NON-text whitelisted type we verify the file starts with the format's
 * real magic bytes before accepting it. text/plain is intentionally NOT
 * sniffed (plain text has no magic; UTF-8/UTF-16 BOMs and Arabic content
 * would create false rejections) — it is additionally safe because
 * downloads are always served with `Content-Disposition: attachment`
 * and a strict Content-Security-Policy.
 */
const FILE_MAGIC: Record<string, number[][]> = {
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]], // %PDF
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]], // PNG signature
  "image/jpeg": [[0xff, 0xd8, 0xff]], // JPEG SOI
  // Legacy Office binary formats are OLE2 compound documents.
  "application/msword": [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  "application/vnd.ms-excel": [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  "application/vnd.ms-powerpoint": [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  // OpenXML formats are ZIP containers (PK\x03\x04, empty-zip, spanned).
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ],
};

async function fileMagicMatches(
  file: File,
  mime: string
): Promise<boolean> {
  const signatures = FILE_MAGIC[mime];
  if (!signatures) return true; // text/plain (and any unlisted type) passes
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return signatures.some((signature) =>
    signature.every((byte, index) => header[index] === byte)
  );
}

async function validateUploadFile(
  file: unknown
): Promise<AssignmentResult<{ name: string; mime: string }>> {
  if (typeof File === "undefined" || !(file instanceof File)) {
    return assignmentFail("لم يُرفق ملف صالح", "FILE_INVALID");
  }
  if (file.size <= 0) {
    return assignmentFail("الملف فارغ", "FILE_INVALID");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return assignmentFail(
      `حجم الملف يتجاوز الحد الأقصى (${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))} ميغابايت)`,
      "FILE_INVALID"
    );
  }
  // Normalize the declared type before the whitelist lookup: browsers
  // (and runtimes) may append parameters — "text/plain;charset=utf-8" —
  // and the comparison must not fail on formatting, only on substance.
  const mime = (file.type || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_FILE_TYPES[mime]) {
    return assignmentFail(
      "نوع الملف غير مدعوم — الأنواع المسموحة: PDF، صور، Word، Excel، PowerPoint، نص",
      "FILE_INVALID"
    );
  }
  // Declared type must match the actual bytes (client MIME is not trusted).
  if (!(await fileMagicMatches(file, mime))) {
    return assignmentFail(
      "محتوى الملف لا يطابق نوعه المعلن — أعد رفع الملف الأصلي",
      "FILE_INVALID"
    );
  }
  // The stored name is display-only metadata — strip separators/newlines.
  const name = (file.name ?? "ملف")
    .replace(/[\\/\r\n\t]/g, "_")
    .slice(0, 200) || "ملف";
  return { ok: true, data: { name, mime } };
}

function validationFailWrap<T>(error: { issues: unknown[] }): AssignmentResult<T> {
  return validationFail(error as never);
}

/* ------------------------------------------------------------------ */
/* Manage — listing, detail, options                                    */
/* ------------------------------------------------------------------ */

export interface ManageAssignmentFilters {
  q?: string;
  status?: string;
  page?: number;
}

export async function listAssignmentsForManage(
  ctx: AdminContext,
  filters: ManageAssignmentFilters
): Promise<AssignmentResult<Paginated<ManageAssignmentRow>>> {
  const guard = manageGuard(ctx);
  if (guard) return guard;
  if (!ctx.schoolId) {
    return assignmentFail("حسابك غير مرتبط بمدرسة", "FORBIDDEN");
  }

  const where: Prisma.AssignmentWhereInput = { schoolId: ctx.schoolId };
  if (filters.status && filters.status.trim().length > 0) {
    where.status = filters.status.trim();
  }
  if (filters.q && filters.q.trim().length > 0) {
    where.titleAr = { contains: filters.q.trim() };
  }

  const total = await db.assignment.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ASSIGNMENTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  const rows = await db.assignment.findMany({
    where,
    include: { _count: { select: { submissions: true } } },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * ASSIGNMENTS_PAGE_SIZE,
    take: ASSIGNMENTS_PAGE_SIZE,
  });

  const pageIds = rows.map((row) => row.id);
  const buckets = pageIds.length
    ? await db.assignmentSubmission.groupBy({
        by: ["assignmentId", "status"],
        where: { assignmentId: { in: pageIds }, status: { not: "DRAFT" } },
        _count: { _all: true },
      })
    : [];
  const pendingByAssignment = new Map<string, number>();
  const gradedByAssignment = new Map<string, number>();
  for (const bucket of buckets) {
    if (bucket.status === "SUBMITTED" || bucket.status === "UNDER_REVIEW") {
      pendingByAssignment.set(
        bucket.assignmentId,
        (pendingByAssignment.get(bucket.assignmentId) ?? 0) + bucket._count._all
      );
    }
    if (bucket.status === "GRADED") {
      gradedByAssignment.set(
        bucket.assignmentId,
        (gradedByAssignment.get(bucket.assignmentId) ?? 0) + bucket._count._all
      );
    }
  }

  return {
    ok: true,
    data: {
      rows: rows.map((row) => ({
        id: row.id,
        titleAr: row.titleAr,
        titleEn: row.titleEn,
        status: row.status,
        audienceMode: row.audienceMode,
        dueAt: row.dueAt,
        publishedAt: row.publishedAt,
        totalPoints: row.totalPoints,
        submissionsTotal: row._count.submissions,
        pendingCount: pendingByAssignment.get(row.id) ?? 0,
        gradedCount: gradedByAssignment.get(row.id) ?? 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      total,
      page,
      pageCount,
    },
  };
}

export async function getAssignmentForManage(
  ctx: AdminContext,
  assignmentId: string
): Promise<AssignmentResult<ManageAssignmentDetail>> {
  const guard = manageGuard(ctx);
  if (guard) return guard;

  const row = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { _count: { select: { submissions: true } } },
  });
  if (!row) return assignmentFail("التكليف غير موجود", "NOT_FOUND");
  const scopeCheck = assignmentScopeError(ctx, row.schoolId);
  if (scopeCheck) return scopeCheck;

  const [criteria, statusBuckets] = await Promise.all([
    db.assignmentRubricCriterion.findMany({
      where: { assignmentId: row.id },
      orderBy: { orderIndex: "asc" },
    }),
    db.assignmentSubmission.groupBy({
      by: ["status", "isLate"],
      where: { assignmentId: row.id },
      _count: { _all: true },
    }),
  ]);

  const stats: AssignmentSubmissionStats = {
    drafts: 0,
    submitted: 0,
    underReview: 0,
    returned: 0,
    graded: 0,
    lateCount: 0,
    targeted: 0,
  };
  for (const bucket of statusBuckets) {
    const count = bucket._count._all;
    if (bucket.status === "DRAFT") stats.drafts += count;
    if (bucket.status === "SUBMITTED") stats.submitted += count;
    if (bucket.status === "UNDER_REVIEW") stats.underReview += count;
    if (bucket.status === "RETURNED") stats.returned += count;
    if (bucket.status === "GRADED") stats.graded += count;
    if (bucket.status !== "DRAFT" && bucket.isLate) stats.lateCount += count;
  }
  stats.targeted = (
    await eligibleTeacherRows(row.schoolId, targetingOf(row))
  ).length;

  return {
    ok: true,
    data: {
      assignment: {
        id: row.id,
        titleAr: row.titleAr,
        titleEn: row.titleEn,
        status: row.status,
        audienceMode: row.audienceMode,
        dueAt: row.dueAt,
        publishedAt: row.publishedAt,
        totalPoints: row.totalPoints,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        descriptionAr: row.descriptionAr,
        descriptionEn: row.descriptionEn,
        allowLate: row.allowLate,
        lateUntil: row.lateUntil,
        programId: row.programId,
        courseId: row.courseId,
        sectionId: row.sectionId,
        lessonId: row.lessonId,
        targetTeacherIds: parseJsonIds(row.targetTeacherIdsJson),
        targetBranchIds: parseJsonIds(row.targetBranchIdsJson),
      },
      criteria: criteria.map((criterion) => ({
        id: criterion.id,
        orderIndex: criterion.orderIndex,
        titleAr: criterion.titleAr,
        maxPoints: criterion.maxPoints,
      })),
      stats,
    },
  };
}

/** Audience options for the form — own school only, never cross-tenant. */
export async function listAudienceOptions(
  ctx: AdminContext
): Promise<AssignmentResult<AudienceOptions>> {
  const guard = manageGuard(ctx);
  if (guard) return guard;
  if (!ctx.schoolId) {
    return assignmentFail("حسابك غير مرتبط بمدرسة", "FORBIDDEN");
  }

  const [teachers, branches] = await Promise.all([
    db.user.findMany({
      where: { role: "TEACHER", schoolId: ctx.schoolId },
      select: { id: true, name: true, branchId: true, branch: { select: { nameAr: true } } },
      orderBy: { name: "asc" },
    }),
    db.branch.findMany({
      where: { schoolId: ctx.schoolId },
      select: { id: true, nameAr: true },
      orderBy: { nameAr: "asc" },
    }),
  ]);

  return {
    ok: true,
    data: {
      teachers: teachers.map((teacher) => ({
        id: teacher.id,
        name: teacher.name,
        branchId: teacher.branchId,
        branchName: teacher.branch?.nameAr ?? null,
      })),
      branches: branches.map((branch) => ({ id: branch.id, name: branch.nameAr })),
    },
  };
}

/** Content-binding options — same tenant, nothing archived. */
export async function listContentOptions(
  ctx: AdminContext
): Promise<AssignmentResult<ContentOptions>> {
  const guard = manageGuard(ctx);
  if (guard) return guard;
  if (!ctx.schoolId) {
    return assignmentFail("حسابك غير مرتبط بمدرسة", "FORBIDDEN");
  }

  const programWhere: Prisma.TrainingProgramWhereInput = {
    status: { not: "ARCHIVED" },
    ...(ctx.schoolId ? { schoolId: ctx.schoolId } : {}),
  };
  const courseWhere: Prisma.CourseWhereInput = {
    status: { not: "ARCHIVED" },
    OR: [
      { schoolId: ctx.schoolId },
      { schoolId: null, status: "PUBLISHED" },
    ],
  };

  const [programs, courses] = await Promise.all([
    db.trainingProgram.findMany({
      where: programWhere,
      select: { id: true, nameAr: true },
      orderBy: { nameAr: "asc" },
    }),
    db.course.findMany({
      where: courseWhere,
      select: { id: true, titleAr: true },
      orderBy: { titleAr: "asc" },
    }),
  ]);

  const courseIds = courses.map((course) => course.id);
  const [sections, lessons] = courseIds.length
    ? await Promise.all([
        db.courseSection.findMany({
          where: { courseId: { in: courseIds } },
          select: { id: true, titleAr: true, courseId: true },
          orderBy: { orderIndex: "asc" },
        }),
        db.courseLesson.findMany({
          where: { section: { courseId: { in: courseIds } } },
          select: { id: true, titleAr: true, sectionId: true },
          orderBy: { orderIndex: "asc" },
        }),
      ])
    : [[], []];

  return {
    ok: true,
    data: {
      programs: programs.map((program) => ({ id: program.id, name: program.nameAr })),
      courses,
      sections: sections.map((section) => ({
        id: section.id,
        titleAr: section.titleAr,
        courseId: section.courseId,
      })),
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        titleAr: lesson.titleAr,
        sectionId: lesson.sectionId,
      })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Manage — create / update / status / rubric                           */
/* ------------------------------------------------------------------ */

/** Every content link must belong to the owning school and be active. */
async function validateContentLinks(
  schoolId: string,
  input: {
    programId?: string;
    courseId?: string;
    sectionId?: string;
    lessonId?: string;
  }
): Promise<AssignmentResult<never> | null> {
  if (input.programId) {
    const program = await db.trainingProgram.findUnique({
      where: { id: input.programId },
      select: { schoolId: true, status: true },
    });
    if (!program) return assignmentFail("البرنامج التدريبي غير موجود", "RELATION_ERROR");
    if ((program.schoolId ?? null) !== schoolId) {
      return assignmentFail("البرنامج التدريبي لا ينتمي إلى مدرسة التكليف", "RELATION_ERROR");
    }
    if (program.status === "ARCHIVED") {
      return assignmentFail("لا يمكن ربط تكليف ببرنامج مؤرشف", "RELATION_ERROR");
    }
  }
  if (input.courseId) {
    const course = await db.course.findUnique({
      where: { id: input.courseId },
      select: { schoolId: true, status: true },
    });
    if (!course) return assignmentFail("الدورة التدريبية غير موجودة", "RELATION_ERROR");
    if ((course.schoolId ?? null) !== schoolId) {
      return assignmentFail("الدورة التدريبية لا تنتمي إلى مدرسة التكليف", "RELATION_ERROR");
    }
    if (course.status === "ARCHIVED") {
      return assignmentFail("لا يمكن ربط تكليف بدورة مؤرشفة", "RELATION_ERROR");
    }
  }
  if (input.sectionId) {
    const section = await db.courseSection.findUnique({
      where: { id: input.sectionId },
      include: { course: { select: { schoolId: true, status: true } } },
    });
    if (!section) return assignmentFail("القسم غير موجود", "RELATION_ERROR");
    if ((section.course.schoolId ?? null) !== schoolId) {
      return assignmentFail("القسم لا ينتمي إلى مدرسة التكليف", "RELATION_ERROR");
    }
    if (section.course.status === "ARCHIVED") {
      return assignmentFail("لا يمكن ربط تكليف بقسم في دورة مؤرشفة", "RELATION_ERROR");
    }
    if (input.courseId && section.courseId !== input.courseId) {
      return assignmentFail("القسم المحدد لا يتبع الدورة المحددة", "RELATION_ERROR");
    }
  }
  if (input.lessonId) {
    const lesson = await db.courseLesson.findUnique({
      where: { id: input.lessonId },
      include: {
        section: { include: { course: { select: { schoolId: true, status: true } } } },
      },
    });
    if (!lesson) return assignmentFail("الدرس غير موجود", "RELATION_ERROR");
    if ((lesson.section.course.schoolId ?? null) !== schoolId) {
      return assignmentFail("الدرس لا ينتمي إلى مدرسة التكليف", "RELATION_ERROR");
    }
    if (lesson.section.course.status === "ARCHIVED") {
      return assignmentFail("لا يمكن ربط تكليف بدرس في دورة مؤرشفة", "RELATION_ERROR");
    }
    if (input.sectionId && lesson.sectionId !== input.sectionId) {
      return assignmentFail("الدرس المحدد لا يتبع القسم المحدد", "RELATION_ERROR");
    }
    if (input.courseId && lesson.section.courseId !== input.courseId) {
      return assignmentFail("الدرس المحدد لا يتبع الدورة المحددة", "RELATION_ERROR");
    }
  }
  return null;
}

/** Audience ids must exist inside the owning school (no cross-tenant leaks). */
async function validateAudience(
  schoolId: string,
  input: { audienceMode: AudienceMode; teacherIds: string[]; branchIds: string[] }
): Promise<AssignmentResult<never> | null> {
  if (input.audienceMode === "TEACHERS" && input.teacherIds.length > 0) {
    const unique = [...new Set(input.teacherIds)];
    const count = await db.user.count({
      where: { id: { in: unique }, role: "TEACHER", schoolId },
    });
    if (count !== unique.length) {
      return assignmentFail(
        "أحد المعلمين المحددين غير موجود في هذه المدرسة",
        "RELATION_ERROR"
      );
    }
  }
  if (input.audienceMode === "BRANCHES" && input.branchIds.length > 0) {
    const unique = [...new Set(input.branchIds)];
    const count = await db.branch.count({
      where: { id: { in: unique }, schoolId },
    });
    if (count !== unique.length) {
      return assignmentFail(
        "أحد الفروع المحددة غير موجود في هذه المدرسة",
        "RELATION_ERROR"
      );
    }
  }
  return null;
}

async function replaceRubric(
  tx: Prisma.TransactionClient,
  assignmentId: string,
  criteria: { titleAr: string; maxPoints: number }[]
): Promise<number> {
  await tx.assignmentRubricCriterion.deleteMany({ where: { assignmentId } });
  const totalPoints = criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0);
  if (criteria.length > 0) {
    await tx.assignmentRubricCriterion.createMany({
      data: criteria.map((criterion, index) => ({
        assignmentId,
        orderIndex: index,
        titleAr: criterion.titleAr,
        maxPoints: criterion.maxPoints,
      })),
    });
  }
  await tx.assignment.update({
    where: { id: assignmentId },
    data: { totalPoints },
  });
  return totalPoints;
}

export async function createAssignment(
  raw: unknown,
  actor?: AdminContext
): Promise<AssignmentResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = manageGuard(ctx);
  if (guard) return guard;

  const parsed = createAssignmentSchema.safeParse(raw);
  if (!parsed.success) return validationFailWrap(parsed.error);
  const input = parsed.data;
  if (!ctx.schoolId) {
    return assignmentFail("حسابك غير مرتبط بمدرسة", "FORBIDDEN");
  }
  const schoolId = ctx.schoolId;

  if (input.dueAt.getTime() <= Date.now()) {
    return assignmentFail("تاريخ الاستحقاق يجب أن يكون في المستقبل", "VALIDATION_ERROR");
  }
  const linkError = await validateContentLinks(schoolId, input);
  if (linkError) return linkError;
  const audienceError = await validateAudience(schoolId, input);
  if (audienceError) return audienceError;

  const created = await db.assignment.create({
    data: {
      schoolId,
      createdById: ctx.id,
      titleAr: input.titleAr,
      titleEn: input.titleEn,
      descriptionAr: input.descriptionAr,
      descriptionEn: input.descriptionEn,
      programId: input.programId ?? null,
      courseId: input.courseId ?? null,
      sectionId: input.sectionId ?? null,
      lessonId: input.lessonId ?? null,
      status: "DRAFT",
      audienceMode: input.audienceMode,
      targetTeacherIdsJson:
        input.audienceMode === "TEACHERS"
          ? JSON.stringify([...new Set(input.teacherIds)])
          : null,
      targetBranchIdsJson:
        input.audienceMode === "BRANCHES"
          ? JSON.stringify([...new Set(input.branchIds)])
          : null,
      dueAt: input.dueAt,
      allowLate: input.allowLate,
      lateUntil: input.allowLate ? input.lateUntil ?? null : null,
    },
    select: { id: true },
  });
  return { ok: true, data: created };
}

/**
 * Settings update. Tenancy (schoolId) is IMMUTABLE after creation.
 * DRAFT rows accept a full edit; PUBLISHED rows allow text + deadline
 * policy only (audience/content bindings are frozen so in-flight
 * eligibility can never silently change). CLOSED/ARCHIVED reject edits.
 */
export async function updateAssignment(
  raw: unknown,
  actor?: AdminContext
): Promise<AssignmentResult<{ id: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = manageGuard(ctx);
  if (guard) return guard;

  const parsed = updateAssignmentSchema.safeParse(raw);
  if (!parsed.success) return validationFailWrap(parsed.error);
  const input = parsed.data;

  const assignment = await db.assignment.findUnique({
    where: { id: input.assignmentId },
  });
  if (!assignment) return assignmentFail("التكليف غير موجود", "NOT_FOUND");
  const scopeCheck = assignmentScopeError(ctx, assignment.schoolId);
  if (scopeCheck) return scopeCheck;

  if (assignment.status === "ARCHIVED") {
    return assignmentFail(
      "التكليف مؤرشف — لا يمكن تعديله",
      "FORBIDDEN"
    );
  }
  if (assignment.status === "CLOSED") {
    return assignmentFail(
      "التكليف مغلق — أعد فتحه أولًا قبل التعديل",
      "FORBIDDEN"
    );
  }
  if (input.dueAt.getTime() <= Date.now()) {
    return assignmentFail("تاريخ الاستحقاق يجب أن يكون في المستقبل", "VALIDATION_ERROR");
  }
  if (input.allowLate && input.lateUntil && input.lateUntil.getTime() <= Date.now()) {
    return assignmentFail(
      "نهاية القبول المتأخر يجب أن تكون في المستقبل",
      "VALIDATION_ERROR"
    );
  }

  if (assignment.status === "PUBLISHED") {
    const linkError = await validateContentLinks(assignment.schoolId, input);
    if (linkError) return linkError;
    const audienceError = await validateAudience(assignment.schoolId, {
      audienceMode: assignment.audienceMode as AudienceMode,
      teacherIds: parseJsonIds(assignment.targetTeacherIdsJson),
      branchIds: parseJsonIds(assignment.targetBranchIdsJson),
    });
    if (audienceError) return audienceError;

    const updated = await db.assignment.update({
      where: { id: assignment.id },
      data: {
        titleAr: input.titleAr,
        titleEn: input.titleEn,
        descriptionAr: input.descriptionAr,
        descriptionEn: input.descriptionEn,
        dueAt: input.dueAt,
        allowLate: input.allowLate,
        lateUntil: input.allowLate ? input.lateUntil ?? null : null,
      },
      select: { id: true },
    });
    return { ok: true, data: updated };
  }

  // DRAFT — full edit.
  const linkError = await validateContentLinks(assignment.schoolId, input);
  if (linkError) return linkError;
  const audienceError = await validateAudience(assignment.schoolId, input);
  if (audienceError) return audienceError;

  const updated = await db.assignment.update({
    where: { id: assignment.id },
    data: {
      titleAr: input.titleAr,
      titleEn: input.titleEn,
      descriptionAr: input.descriptionAr,
      descriptionEn: input.descriptionEn,
      programId: input.programId ?? null,
      courseId: input.courseId ?? null,
      sectionId: input.sectionId ?? null,
      lessonId: input.lessonId ?? null,
      audienceMode: input.audienceMode,
      targetTeacherIdsJson:
        input.audienceMode === "TEACHERS"
          ? JSON.stringify([...new Set(input.teacherIds)])
          : null,
      targetBranchIdsJson:
        input.audienceMode === "BRANCHES"
          ? JSON.stringify([...new Set(input.branchIds)])
          : null,
      dueAt: input.dueAt,
      allowLate: input.allowLate,
      lateUntil: input.allowLate ? input.lateUntil ?? null : null,
    },
    select: { id: true },
  });
  return { ok: true, data: updated };
}

/**
 * Lifecycle transitions:
 *   DRAFT -> PUBLISHED (guarded), PUBLISHED -> CLOSED,
 *   CLOSED -> PUBLISHED (re-open, same publish guards),
 *   any non-archived -> ARCHIVED (terminal).
 * SUPER_ADMIN holds NO operational transition rights — manageGuard
 * already blocks every non-office role.
 */
export async function setAssignmentStatus(
  raw: unknown,
  actor?: AdminContext
): Promise<AssignmentResult<{ id: string; status: string }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = manageGuard(ctx);
  if (guard) return guard;

  const parsed = setAssignmentStatusSchema.safeParse(raw);
  if (!parsed.success) return validationFailWrap(parsed.error);
  const input = parsed.data;

  const assignment = await db.assignment.findUnique({
    where: { id: input.assignmentId },
  });
  if (!assignment) return assignmentFail("التكليف غير موجود", "NOT_FOUND");
  const scopeCheck = assignmentScopeError(ctx, assignment.schoolId);
  if (scopeCheck) return scopeCheck;

  if (assignment.status === "ARCHIVED") {
    return assignmentFail(
      "التكليف مؤرشف — الحالة الأرشيف نهائية في هذه المرحلة",
      "FORBIDDEN"
    );
  }

  if (input.status === "PUBLISHED") {
    if (assignment.status === "PUBLISHED") {
      return { ok: true, data: { id: assignment.id, status: "PUBLISHED" } };
    }
    if (assignment.dueAt.getTime() <= Date.now()) {
      return assignmentFail(
        "لا يمكن النشر — تاريخ الاستحقاق مضى، عدّله أولًا",
        "PUBLISH_BLOCKED"
      );
    }
    const targeting = targetingOf(assignment);
    if (
      targeting.audienceMode === "TEACHERS" && targeting.targetTeacherIds.length === 0
    ) {
      return assignmentFail(
        "لا يمكن النشر — الفئة المستهدفة (معلمون محددون) فارغة",
        "PUBLISH_BLOCKED"
      );
    }
    if (
      targeting.audienceMode === "BRANCHES" && targeting.targetBranchIds.length === 0
    ) {
      return assignmentFail(
        "لا يمكن النشر — الفئة المستهدفة (فروع محددة) فارغة",
        "PUBLISH_BLOCKED"
      );
    }
    const audienceError = await validateAudience(assignment.schoolId, {
      audienceMode: targeting.audienceMode as AudienceMode,
      teacherIds: targeting.targetTeacherIds,
      branchIds: targeting.targetBranchIds,
    });
    if (audienceError) return audienceError;

    const updated = await db.assignment.update({
      where: { id: assignment.id },
      data: {
        status: "PUBLISHED",
        publishedAt: assignment.publishedAt ?? new Date(),
      },
      select: { id: true, status: true },
    });
    // Phase 11 — event notification (best-effort, post-commit).
    await notifyAssignmentPublished({
      id: assignment.id,
      schoolId: assignment.schoolId,
      titleAr: assignment.titleAr,
      dueAt: assignment.dueAt,
      audienceMode: assignment.audienceMode,
      targetTeacherIdsJson: assignment.targetTeacherIdsJson,
      targetBranchIdsJson: assignment.targetBranchIdsJson,
      publishedAt: assignment.publishedAt ?? new Date(),
    });
    return { ok: true, data: updated };
  }

  if (input.status === "CLOSED") {
    if (assignment.status !== "PUBLISHED") {
      return assignmentFail(
        "الإغلاق متاح للتكليفات المنشورة فقط",
        "FORBIDDEN"
      );
    }
    const updated = await db.assignment.update({
      where: { id: assignment.id },
      data: { status: "CLOSED" },
      select: { id: true, status: true },
    });
    return { ok: true, data: updated };
  }

  if (input.status === "DRAFT") {
    if (assignment.status !== "CLOSED") {
      return assignmentFail("إرجاع المسودة متاح للتكليفات المغلقة فقط", "FORBIDDEN");
    }
    const updated = await db.assignment.update({
      where: { id: assignment.id },
      data: { status: "DRAFT" },
      select: { id: true, status: true },
    });
    return { ok: true, data: updated };
  }

  // ARCHIVED — terminal, allowed from any non-archived state.
  const updated = await db.assignment.update({
    where: { id: assignment.id },
    data: { status: "ARCHIVED" },
    select: { id: true, status: true },
  });
  return { ok: true, data: updated };
}

/** Rubric is editable on DRAFT only — published rubrics feed real scores. */
export async function saveRubric(
  raw: unknown,
  actor?: AdminContext
): Promise<AssignmentResult<{ id: string; totalPoints: number }>> {
  const ctx = actor ?? (await requireAdmin());
  const guard = manageGuard(ctx);
  if (guard) return guard;

  const parsed = saveRubricSchema.safeParse(raw);
  if (!parsed.success) return validationFailWrap(parsed.error);
  const input = parsed.data;

  const assignment = await db.assignment.findUnique({
    where: { id: input.assignmentId },
  });
  if (!assignment) return assignmentFail("التكليف غير موجود", "NOT_FOUND");
  const scopeCheck = assignmentScopeError(ctx, assignment.schoolId);
  if (scopeCheck) return scopeCheck;

  if (assignment.status !== "DRAFT") {
    return assignmentFail(
      "سلّم التقييم قابل للتعديل على المسودة فقط — التكليفات المنشورة مرتبط بدرجات فعلية",
      "FORBIDDEN"
    );
  }
  const totalPoints = input.criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0);
  if (totalPoints > MAX_TOTAL_POINTS) {
    return assignmentFail(
      `مجموع درجات السلّم يتجاوز الحد الأقصى (${MAX_TOTAL_POINTS} نقطة)`,
      "VALIDATION_ERROR"
    );
  }

  const result = await db.$transaction(async (tx) => {
    const total = await replaceRubric(tx, assignment.id, input.criteria);
    return { id: assignment.id, totalPoints: total };
  });
  return { ok: true, data: result };
}

/* ------------------------------------------------------------------ */
/* Teacher workspace — catalog & detail                                 */
/* ------------------------------------------------------------------ */

export interface TeacherAssignmentFilters {
  q?: string;
  status?: string;
  page?: number;
}

/**
 * Teacher catalog. Only PUBLISHED and CLOSED assignments are ever
 * returned — drafts are invisible by construction — and each row is
 * filtered through the server-side targeting rule. Pagination happens
 * in JS after eligibility filtering (school-scale data).
 */
export async function listTeacherAssignments(
  viewer: ViewerIdentity,
  filters: TeacherAssignmentFilters
): Promise<AssignmentResult<Paginated<TeacherAssignmentRow>>> {
  if (viewer.role !== "TEACHER") {
    return assignmentFail("قائمة التكليفات متاحة للمعلمين فقط", "FORBIDDEN");
  }
  const user = await db.user.findUnique({
    where: { id: viewer.id },
    select: { id: true, role: true, schoolId: true, branchId: true },
  });
  if (!user || user.role !== "TEACHER" || !user.schoolId) {
    return assignmentFail("قائمة التكليفات متاحة للمعلمين فقط", "FORBIDDEN");
  }

  const where: Prisma.AssignmentWhereInput = {
    schoolId: user.schoolId,
    status: { in: ["PUBLISHED", "CLOSED"] },
  };
  if (filters.status && filters.status.trim().length > 0) {
    where.status = filters.status.trim();
  }
  if (filters.q && filters.q.trim().length > 0) {
    where.titleAr = { contains: filters.q.trim() };
  }

  const rows = await db.assignment.findMany({
    where,
    include: {
      course: { select: { titleAr: true } },
      submissions: {
        where: { teacherId: user.id },
        select: { status: true, isLate: true, scoreTotal: true },
      },
    },
    orderBy: { dueAt: "asc" },
  });

  const eligible = rows
    .filter((row) => isTeacherTargeted(targetingOf(row), user))
    .sort((a, b) => {
      const rank = (status: string) => (status === "PUBLISHED" ? 0 : 1);
      const byRank = rank(a.status) - rank(b.status);
      if (byRank !== 0) return byRank;
      return a.dueAt.getTime() - b.dueAt.getTime();
    });

  const total = eligible.length;
  const pageCount = Math.max(1, Math.ceil(total / ASSIGNMENTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);
  const pageRows = eligible.slice((page - 1) * ASSIGNMENTS_PAGE_SIZE, page * ASSIGNMENTS_PAGE_SIZE);

  return {
    ok: true,
    data: {
      rows: pageRows.map((row) => {
        const submission = row.submissions[0];
        const graded = submission?.status === "GRADED";
        return {
          id: row.id,
          titleAr: row.titleAr,
          titleEn: row.titleEn,
          status: row.status,
          dueAt: row.dueAt,
          totalPoints: row.totalPoints,
          windowState: windowStateOf(row),
          myStatus: (submission?.status as SubmissionStatus | undefined) ?? null,
          myIsLate: submission?.isLate ?? null,
          myScoreTotal: graded ? submission?.scoreTotal ?? null : null,
          courseTitle: row.course?.titleAr ?? null,
        };
      }),
      total,
      page,
      pageCount,
    },
  };
}

/**
 * Teacher detail. Feedback and scores follow the release rule:
 *   - score + rubric scores: GRADED only,
 *   - feedback: GRADED (evaluation) or RETURNED (revision request),
 *   - UNDER_REVIEW/SUBMITTED expose nothing.
 */
export async function getTeacherAssignment(
  viewer: ViewerIdentity,
  assignmentId: string
): Promise<AssignmentResult<TeacherAssignmentDetail>> {
  if (viewer.role !== "TEACHER") {
    return assignmentFail("صفحة التكليف متاحة للمعلمين فقط", "FORBIDDEN");
  }
  const row = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      program: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
      section: { select: { titleAr: true } },
      lesson: { select: { titleAr: true } },
      criteria: { orderBy: { orderIndex: "asc" } },
    },
  });
  if (!row) return assignmentFail("التكليف غير موجود", "NOT_FOUND");

  // Drafts never reach teachers; other statuses require same school.
  if (row.status === "DRAFT") {
    return assignmentFail("هذا التكليف غير متاح لك", "FORBIDDEN");
  }
  if (row.status === "ARCHIVED") {
    return assignmentFail("هذا التكليف غير متاح لك", "FORBIDDEN");
  }
  const eligibility = await loadTeacherEligibility(row, viewer);
  if (!eligibility.ok) return eligibility;

  const submission = await db.assignmentSubmission.findUnique({
    where: { assignmentId_teacherId: { assignmentId: row.id, teacherId: viewer.id } },
    include: {
      files: { orderBy: { createdAt: "asc" } },
      revisions: { orderBy: { revisionIndex: "asc" } },
      rubricScores: { select: { criterionId: true, points: true } },
    },
  });

  const status = (submission?.status as SubmissionStatus | undefined) ?? null;
  const released = status === "GRADED";
  const feedbackReleased = status === "GRADED" || status === "RETURNED";
  const windowState = windowStateOf(row);
  const canEdit =
    submission !== null &&
    (TEACHER_EDITABLE_STATUSES as readonly string[]).includes(submission.status) &&
    row.status === "PUBLISHED" &&
    windowState !== "closed";

  return {
    ok: true,
    data: {
      assignment: {
        id: row.id,
        titleAr: row.titleAr,
        titleEn: row.titleEn,
        descriptionAr: row.descriptionAr,
        descriptionEn: row.descriptionEn,
        status: row.status,
        dueAt: row.dueAt,
        allowLate: row.allowLate,
        lateUntil: row.lateUntil,
        publishedAt: row.publishedAt,
        totalPoints: row.totalPoints,
        programTitle: row.program?.nameAr ?? null,
        courseTitle: row.course?.titleAr ?? null,
        sectionTitle: row.section?.titleAr ?? null,
        lessonTitle: row.lesson?.titleAr ?? null,
      },
      windowState,
      criteria: row.criteria.map((criterion) => ({
        id: criterion.id,
        orderIndex: criterion.orderIndex,
        titleAr: criterion.titleAr,
        maxPoints: criterion.maxPoints,
      })),
      mySubmission: submission
        ? {
            id: submission.id,
            status: submission.status as SubmissionStatus,
            responseText: submission.responseText,
            isLate: submission.isLate,
            submittedAt: submission.submittedAt,
            lastSubmittedAt: submission.lastSubmittedAt,
            resubmitCount: submission.resubmitCount,
            files: submission.files.map((file) => ({
              id: file.id,
              fileName: file.fileName,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              createdAt: file.createdAt,
            })),
            scoreTotal: released ? submission.scoreTotal : null,
            feedbackText: feedbackReleased ? submission.feedbackText : null,
            reviewedAt: feedbackReleased ? submission.reviewedAt : null,
            rubricScores: released
              ? submission.rubricScores.map((score) => ({
                  criterionId: score.criterionId,
                  points: score.points,
                }))
              : null,
            revisions: submission.revisions.map((revision) => ({
              revisionIndex: revision.revisionIndex,
              createdAt: revision.createdAt,
              note: revision.note,
            })),
            canEdit,
          }
        : null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Teacher workspace — submission lifecycle                             */
/* ------------------------------------------------------------------ */

/** Eligibility + window shared by draft/save/upload/submit. */
async function loadSubmissionContext(
  viewer: ViewerIdentity,
  assignmentId: string
): Promise<
  AssignmentResult<{
    assignment: Prisma.AssignmentGetPayload<{ select: {
      id: true; schoolId: true; status: true; dueAt: true; allowLate: true;
      lateUntil: true; audienceMode: true; targetTeacherIdsJson: true;
      targetBranchIdsJson: true; titleAr: true;
    } }>;
    teacherId: string;
  }>
> {
  if (viewer.role !== "TEACHER") {
    return assignmentFail("التسليم متاح للمعلمين فقط", "FORBIDDEN");
  }
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      schoolId: true,
      status: true,
      dueAt: true,
      allowLate: true,
      lateUntil: true,
      audienceMode: true,
      targetTeacherIdsJson: true,
      targetBranchIdsJson: true,
      titleAr: true,
    },
  });
  if (!assignment) return assignmentFail("التكليف غير موجود", "NOT_FOUND");
  if (assignment.status === "DRAFT" || assignment.status === "ARCHIVED") {
    return assignmentFail("هذا التكليف غير متاح للتسليم", "FORBIDDEN");
  }
  const eligibility = await loadTeacherEligibility(assignment, viewer);
  if (!eligibility.ok) return eligibility;
  if (assignment.status === "CLOSED") {
    return assignmentFail("هذا التكليف مغلق — التسليم غير متاح", "NOT_AVAILABLE");
  }
  const window = submissionWindow(assignment);
  if (!window.open) {
    return assignmentFail(
      "انتهى موعد التسليم ولم يُفعّل القبول المتأخر لهذا التكليف",
      "DEADLINE_PASSED"
    );
  }
  return { ok: true, data: { assignment, teacherId: eligibility.data.id } };
}

/** Create-or-update the teacher's own DRAFT (or edit a RETURNED text). */
export async function saveSubmissionDraft(
  viewer: ViewerIdentity,
  raw: unknown
): Promise<AssignmentResult<{ id: string }>> {
  const parsed = saveSubmissionDraftSchema.safeParse(raw);
  if (!parsed.success) return validationFailWrap(parsed.error);
  const input = parsed.data;

  const context = await loadSubmissionContext(viewer, input.assignmentId);
  if (!context.ok) return context;

  const existing = await db.assignmentSubmission.findUnique({
    where: {
      assignmentId_teacherId: {
        assignmentId: input.assignmentId,
        teacherId: context.data.teacherId,
      },
    },
    select: { id: true, status: true },
  });

  if (!existing) {
    const created = await db.assignmentSubmission.create({
      data: {
        assignmentId: input.assignmentId,
        teacherId: context.data.teacherId,
        schoolId: context.data.assignment.schoolId,
        status: "DRAFT",
        responseText: input.responseText,
      },
      select: { id: true },
    });
    return { ok: true, data: created };
  }

  if (!(TEACHER_EDITABLE_STATUSES as readonly string[]).includes(existing.status)) {
    return assignmentFail(
      "تم تسليم هذا التكليف — لا يمكن تعديله في حالته الحالية",
      "ALREADY_SUBMITTED"
    );
  }
  const updated = await db.assignmentSubmission.update({
    where: { id: existing.id },
    data: { responseText: input.responseText },
    select: { id: true },
  });
  return { ok: true, data: updated };
}

/**
 * Submit inside ONE transaction:
 *   1. re-check eligibility, assignment status and the server clock,
 *   2. require real content (text or at least one uploaded file),
 *   3. RETURNED resubmissions snapshot the previous version into
 *      SubmissionRevision (audit trail) before the flip,
 *   4. conditional updateMany(status in DRAFT/RETURNED) guarantees two
 *      concurrent submissions cannot both apply.
 */
export async function submitSubmission(
  viewer: ViewerIdentity,
  raw: unknown
): Promise<AssignmentResult<{ id: string; status: SubmissionStatus; isLate: boolean }>> {
  const parsed = submitSubmissionSchema.safeParse(raw);
  if (!parsed.success) return validationFailWrap(parsed.error);
  const input = parsed.data;

  const context = await loadSubmissionContext(viewer, input.assignmentId);
  if (!context.ok) return context;
  const { assignment, teacherId } = context.data;

  const result = (await db.$transaction(async (tx) => {
    let submission:
      | {
          id: string;
          status: string;
          responseText: string | null;
          submittedAt: Date | null;
          resubmitCount: number;
          files: { id: string; fileName: string }[];
        }
      | null = await tx.assignmentSubmission.findUnique({
      where: {
        assignmentId_teacherId: { assignmentId: assignment.id, teacherId },
      },
      select: {
        id: true,
        status: true,
        responseText: true,
        submittedAt: true,
        resubmitCount: true,
        files: { select: { id: true, fileName: true } },
      },
    });

    if (!submission) {
      const created = await tx.assignmentSubmission.create({
        data: {
          assignmentId: assignment.id,
          teacherId,
          schoolId: assignment.schoolId,
          status: "DRAFT",
          responseText: input.responseText,
        },
        select: {
          id: true,
          status: true,
          responseText: true,
          submittedAt: true,
          resubmitCount: true,
        },
      });
      submission = { ...created, files: [] };
    }

    if (!(TEACHER_EDITABLE_STATUSES as readonly string[]).includes(submission.status)) {
      return assignmentFail(
        "تم تسليم هذا التكليف من قبل",
        "ALREADY_SUBMITTED"
      );
    }

    const hasText = (input.responseText ?? "").trim().length > 0;
    if (!hasText && submission.files.length === 0) {
      return assignmentFail(
        "أضف نصًا أو مرفقًا واحدًا على الأقل قبل التسليم",
        "VALIDATION_ERROR"
      );
    }

    const window = submissionWindow(assignment);
    if (!window.open) {
      return assignmentFail(
        "انتهى موعد التسليم ولم يُفعّل القبول المتأخر لهذا التكليف",
        "DEADLINE_PASSED"
      );
    }

    const now = new Date();
    const wasReturned = submission.status === "RETURNED";
    if (wasReturned) {
      await tx.submissionRevision.create({
        data: {
          submissionId: submission.id,
          revisionIndex: submission.resubmitCount + 1,
          responseText: submission.responseText,
          fileNamesJson: JSON.stringify(submission.files.map((file) => file.fileName)),
          note: "نسخة سابقة أعيدت للتعديل",
        },
      });
    }

    const flipped = await tx.assignmentSubmission.updateMany({
      where: { id: submission.id, status: { in: ["DRAFT", "RETURNED"] } },
      data: {
        status: "SUBMITTED",
        responseText: input.responseText,
        isLate: window.late,
        submittedAt: submission.submittedAt ?? now,
        lastSubmittedAt: now,
        resubmitCount: wasReturned ? { increment: 1 } : submission.resubmitCount,
      },
    });
    if (flipped.count !== 1) {
      return assignmentFail("تم تسليم هذا التكليف من قبل", "ALREADY_SUBMITTED");
    }

    return {
      ok: true,
      data: { id: submission.id, status: "SUBMITTED", isLate: window.late },
    };
  })) as AssignmentResult<{ id: string; status: SubmissionStatus; isLate: boolean }>;

  // Phase 11 — event notification (best-effort, post-commit).
  if (result.ok) {
    await notifySubmissionReceived({
      schoolId: assignment.schoolId,
      teacherId,
      assignmentId: assignment.id,
      assignmentTitleAr: assignment.titleAr,
      isLate: result.data.isLate,
    });
  }
  return result;
}

/**
 * Upload an attachment onto the teacher's own editable submission.
 * Storage failures reject the whole action — nothing is ever
 * "pretend-uploaded" and no orphan DB row is created.
 */
export async function uploadSubmissionFile(
  viewer: ViewerIdentity,
  input: { assignmentId: string; file: unknown }
): Promise<AssignmentResult<{ fileId: string }>> {
  const check = await validateUploadFile(input.file);
  if (!check.ok) return check;
  const file = input.file as File;

  const context = await loadSubmissionContext(viewer, input.assignmentId);
  if (!context.ok) return context;

  let submission = await db.assignmentSubmission.findUnique({
    where: {
      assignmentId_teacherId: {
        assignmentId: input.assignmentId,
        teacherId: context.data.teacherId,
      },
    },
    select: { id: true, status: true },
  });
  if (!submission) {
    submission = await db.assignmentSubmission.create({
      data: {
        assignmentId: input.assignmentId,
        teacherId: context.data.teacherId,
        schoolId: context.data.assignment.schoolId,
        status: "DRAFT",
      },
      select: { id: true, status: true },
    });
  }
  if (!(TEACHER_EDITABLE_STATUSES as readonly string[]).includes(submission.status)) {
    return assignmentFail(
      "تم تسليم هذا التكليف — لا يمكن إضافة مرفقات في حالته الحالية",
      "ALREADY_SUBMITTED"
    );
  }

  const filesCount = await db.submissionFile.count({
    where: { submissionId: submission.id },
  });
  if (filesCount >= MAX_FILES_PER_SUBMISSION) {
    return assignmentFail(
      `الحد الأقصى ${MAX_FILES_PER_SUBMISSION} ملفات لكل تسليم`,
      "FILE_INVALID"
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await saveSubmissionObject(bytes, check.data.name);
  const created = await db.submissionFile.create({
    data: {
      submissionId: submission.id,
      storageKey: stored.storageKey,
      fileName: check.data.name,
      mimeType: check.data.mime,
      sizeBytes: stored.sizeBytes,
    },
    select: { id: true },
  });
  return { ok: true, data: { fileId: created.id } };
}

/** Teacher deletes their OWN file while the submission is still editable. */
export async function deleteSubmissionFile(
  viewer: ViewerIdentity,
  raw: unknown
): Promise<AssignmentResult<{ id: string }>> {
  const parsed = deleteSubmissionFileSchema.safeParse(raw);
  if (!parsed.success) return validationFailWrap(parsed.error);

  const file = await db.submissionFile.findUnique({
    where: { id: parsed.data.fileId },
    include: {
      submission: {
        select: { id: true, teacherId: true, status: true, assignmentId: true },
      },
    },
  });
  if (!file) return assignmentFail("المرفق غير موجود", "NOT_FOUND");
  if (file.submission.teacherId !== viewer.id) {
    return assignmentFail("لا يمكن تعديل تسليم معلم آخر", "FORBIDDEN");
  }
  if (!(TEACHER_EDITABLE_STATUSES as readonly string[]).includes(file.submission.status)) {
    return assignmentFail(
      "تم تسليم هذا التكليف — لا يمكن حذف المرفقات في حالته الحالية",
      "ALREADY_SUBMITTED"
    );
  }

  await db.submissionFile.delete({ where: { id: file.id } });
  await deleteSubmissionObject(file.storageKey);
  return { ok: true, data: { id: file.id } };
}

/* ------------------------------------------------------------------ */
/* Supervision — submissions review workspace                           */
/* ------------------------------------------------------------------ */

export interface ReviewScopeFilters {
  status?: string;
}

/**
 * Review list for ONE assignment. Office managers reach their whole
 * school; supervisors are narrowed to their persisted teacher set.
 */
export async function listSubmissionsForReview(
  ctx: AdminContext,
  assignmentId: string,
  filters: ReviewScopeFilters = {}
): Promise<AssignmentResult<ReviewSubmissionRow[]>> {
  const guard = reviewGuard(ctx);
  if (guard) return guard;

  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, schoolId: true },
  });
  if (!assignment) return assignmentFail("التكليف غير موجود", "NOT_FOUND");
  const scopeCheck = assignmentScopeError(ctx, assignment.schoolId);
  if (scopeCheck) return scopeCheck;

  let teacherIds: string[] | null = null;
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") {
    const teachers = await supervisorTeacherIds(ctx);
    if (!teachers.ok) return teachers;
    teacherIds = teachers.data;
    if (teacherIds.length === 0) return { ok: true, data: [] };
  }

  const where: Prisma.AssignmentSubmissionWhereInput = {
    assignmentId,
    status: { not: "DRAFT" },
    ...(teacherIds ? { teacherId: { in: teacherIds } } : {}),
    ...(filters.status && filters.status.trim().length > 0
      ? { status: filters.status.trim() }
      : {}),
  };
  const rows = await db.assignmentSubmission.findMany({
    where,
    include: { teacher: { select: { name: true, branch: { select: { nameAr: true } } } } },
    orderBy: { lastSubmittedAt: "desc" },
    take: 200,
  });

  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      teacherId: row.teacherId,
      teacherName: row.teacher.name,
      branchName: row.teacher.branch?.nameAr ?? null,
      status: row.status as SubmissionStatus,
      isLate: row.isLate,
      submittedAt: row.submittedAt,
      lastSubmittedAt: row.lastSubmittedAt,
      resubmitCount: row.resubmitCount,
      scoreTotal: row.status === "GRADED" ? row.scoreTotal : null,
      reviewedAt: row.reviewedAt,
    })),
  };
}

/** Cross-assignment review queue for the supervisor/office home screen. */
export async function listReviewQueue(
  ctx: AdminContext,
  filters: ReviewScopeFilters = {}
): Promise<AssignmentResult<ReviewQueueRow[]>> {
  const guard = reviewGuard(ctx);
  if (guard) return guard;
  if (!ctx.schoolId) {
    return assignmentFail("حسابك غير مرتبط بمدرسة", "FORBIDDEN");
  }

  let teacherIds: string[] | null = null;
  if (ctx.role === "EDUCATIONAL_SUPERVISOR") {
    const teachers = await supervisorTeacherIds(ctx);
    if (!teachers.ok) return teachers;
    teacherIds = teachers.data;
    if (teacherIds.length === 0) return { ok: true, data: [] };
  }

  const rows = await db.assignmentSubmission.findMany({
    where: {
      schoolId: ctx.schoolId as string,
      status: { not: "DRAFT" },
      ...(teacherIds ? { teacherId: { in: teacherIds } } : {}),
      ...(filters.status && filters.status.trim().length > 0
        ? { status: filters.status.trim() }
        : {}),
    },
    include: {
      assignment: { select: { id: true, titleAr: true } },
      teacher: { select: { id: true, name: true } },
    },
    orderBy: { lastSubmittedAt: "desc" },
    take: REVIEW_QUEUE_LIMIT,
  });

  return {
    ok: true,
    data: rows.map((row) => ({
      submissionId: row.id,
      assignmentId: row.assignment.id,
      assignmentTitle: row.assignment.titleAr,
      teacherId: row.teacher.id,
      teacherName: row.teacher.name,
      status: row.status as SubmissionStatus,
      isLate: row.isLate,
      lastSubmittedAt: row.lastSubmittedAt,
      scoreTotal: row.status === "GRADED" ? row.scoreTotal : null,
    })),
  };
}

/** Full review payload: content, attachments, rubric and revision audit. */
export async function getSubmissionForReview(
  ctx: AdminContext,
  submissionId: string
): Promise<AssignmentResult<ReviewSubmissionDetail>> {
  const row = await loadSubmissionForReview(ctx, submissionId);
  if (!row.ok) return row;

  const [criteria, files, revisions, rubricScores] = await Promise.all([
    db.assignmentRubricCriterion.findMany({
      where: { assignmentId: row.data.assignmentId },
      orderBy: { orderIndex: "asc" },
    }),
    db.submissionFile.findMany({
      where: { submissionId: row.data.id },
      orderBy: { createdAt: "asc" },
    }),
    db.submissionRevision.findMany({
      where: { submissionId: row.data.id },
      orderBy: { revisionIndex: "asc" },
    }),
    db.rubricScore.findMany({
      where: { submissionId: row.data.id },
      select: { criterionId: true, points: true },
    }),
  ]);

  return {
    ok: true,
    data: {
      submission: {
        id: row.data.id,
        status: row.data.status as SubmissionStatus,
        responseText: row.data.responseText,
        isLate: row.data.isLate,
        submittedAt: row.data.submittedAt,
        lastSubmittedAt: row.data.lastSubmittedAt,
        resubmitCount: row.data.resubmitCount,
        scoreTotal: row.data.status === "GRADED" ? row.data.scoreTotal : null,
        feedbackText: row.data.feedbackText,
        reviewedAt: row.data.reviewedAt,
      },
      assignment: {
        id: row.data.assignment.id,
        titleAr: row.data.assignment.titleAr,
        status: row.data.assignment.status,
        dueAt: row.data.assignment.dueAt,
        allowLate: row.data.assignment.allowLate,
        lateUntil: row.data.assignment.lateUntil,
        totalPoints: row.data.assignment.totalPoints,
        hasRubric: criteria.length > 0,
      },
      teacher: {
        id: row.data.teacher.id,
        name: row.data.teacher.name,
        email: row.data.teacher.email,
        branchName: row.data.teacher.branch?.nameAr ?? null,
      },
      criteria: criteria.map((criterion) => ({
        id: criterion.id,
        orderIndex: criterion.orderIndex,
        titleAr: criterion.titleAr,
        maxPoints: criterion.maxPoints,
      })),
      rubricScores: rubricScores.map((score) => ({
        criterionId: score.criterionId,
        points: score.points,
      })),
      files: files.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        createdAt: file.createdAt,
      })),
      revisions: revisions.map((revision) => ({
        revisionIndex: revision.revisionIndex,
        createdAt: revision.createdAt,
        note: revision.note,
        responseText: revision.responseText,
      })),
    },
  };
}

/** SUBMITTED -> UNDER_REVIEW (explicit claim; race-safe flip). */
export async function markUnderReview(
  raw: unknown,
  actor?: AdminContext
): Promise<AssignmentResult<{ id: string; status: SubmissionStatus }>> {
  const ctx = actor ?? (await requireAdmin());
  const parsed = markUnderReviewSchema.safeParse(raw);
  if (!parsed.success) return validationFailWrap(parsed.error);

  const row = await loadSubmissionForReview(ctx, parsed.data.submissionId);
  if (!row.ok) return row;
  if (row.data.status !== "SUBMITTED") {
    return assignmentFail(
      "لا يمكن بدء المراجعة إلا للتسليمات المُسلَّمة",
      "ALREADY_SUBMITTED"
    );
  }

  const flipped = await db.assignmentSubmission.updateMany({
    where: { id: row.data.id, status: "SUBMITTED" },
    data: { status: "UNDER_REVIEW" },
  });
  if (flipped.count !== 1) {
    return assignmentFail("حالة التسليم تغيّرت — حدّث الصفحة", "ALREADY_SUBMITTED");
  }
  return { ok: true, data: { id: row.data.id, status: "UNDER_REVIEW" } };
}

/** SUBMITTED/UNDER_REVIEW -> RETURNED with a mandatory revision request. */
export async function returnSubmission(
  raw: unknown,
  actor?: AdminContext
): Promise<AssignmentResult<{ id: string; status: SubmissionStatus }>> {
  const ctx = actor ?? (await requireAdmin());
  const parsed = returnSubmissionSchema.safeParse(raw);
  if (!parsed.success) return validationFailWrap(parsed.error);

  const row = await loadSubmissionForReview(ctx, parsed.data.submissionId);
  if (!row.ok) return row;
  if (!(["SUBMITTED", "UNDER_REVIEW"] as readonly string[]).includes(row.data.status)) {
    return assignmentFail(
      "الإعادة للتعديل متاحة للتسليمات المُسلَّمة أو قيد المراجعة فقط",
      "ALREADY_SUBMITTED"
    );
  }

  const flipped = await db.assignmentSubmission.updateMany({
    where: { id: row.data.id, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
    data: {
      status: "RETURNED",
      feedbackText: parsed.data.feedbackText,
      reviewedById: ctx.id,
      reviewedAt: new Date(),
      scoreTotal: null,
    },
  });
  if (flipped.count !== 1) {
    return assignmentFail("حالة التسليم تغيّرت — حدّث الصفحة", "ALREADY_SUBMITTED");
  }
  // Phase 11 — event notification (best-effort, post-commit).
  await notifySubmissionReturned({
    teacherId: row.data.teacherId,
    assignmentId: row.data.assignment.id,
    assignmentTitleAr: row.data.assignment.titleAr,
  });
  return { ok: true, data: { id: row.data.id, status: "RETURNED" } };
}

/**
 * Grade with the rubric (or a direct score when no rubric exists).
 * The score is computed and bounded SERVER-SIDE; grading flips
 * SUBMITTED/UNDER_REVIEW -> GRADED in one conditional update, then
 * persists the per-criterion rows inside the same transaction.
 */
export async function gradeSubmission(
  raw: unknown,
  actor?: AdminContext
): Promise<AssignmentResult<{ id: string; status: SubmissionStatus; scoreTotal: number }>> {
  const ctx = actor ?? (await requireAdmin());
  const parsed = gradeSubmissionSchema.safeParse(raw);
  if (!parsed.success) return validationFailWrap(parsed.error);
  const input = parsed.data;

  const row = await loadSubmissionForReview(ctx, input.submissionId);
  if (!row.ok) return row;
  if (!(["SUBMITTED", "UNDER_REVIEW"] as readonly string[]).includes(row.data.status)) {
    return assignmentFail(
      "التقييم متاح للتسليمات المُسلَّمة أو قيد المراجعة فقط",
      "ALREADY_SUBMITTED"
    );
  }

  const criteria = await db.assignmentRubricCriterion.findMany({
    where: { assignmentId: row.data.assignmentId },
    orderBy: { orderIndex: "asc" },
  });

  let scoreTotal = 0;
  const scoreRows: { criterionId: string; points: number }[] = [];

  if (criteria.length > 0) {
    if (input.directScore !== undefined) {
      return assignmentFail(
        "هذا التكليف عليه سلّم تقييم — أدخل درجات العناصر بدلًا من الدرجة المباشرة",
        "VALIDATION_ERROR"
      );
    }
    const byCriterion = new Map(input.scores.map((score) => [score.criterionId, score.points]));
    for (const criterion of criteria) {
      if (!byCriterion.has(criterion.id)) {
        return assignmentFail(
          `لم تُدخل درجة العنصر: ${criterion.titleAr}`,
          "VALIDATION_ERROR"
        );
      }
      const points = byCriterion.get(criterion.id) as number;
      if (points > criterion.maxPoints) {
        return assignmentFail(
          `درجة العنصر «${criterion.titleAr}» أكبر من الحد الأقصى (${criterion.maxPoints})`,
          "VALIDATION_ERROR"
        );
      }
      scoreRows.push({ criterionId: criterion.id, points });
      scoreTotal += points;
    }
    if (byCriterion.size !== criteria.length) {
      return assignmentFail(
        "أحد العناصر المُدخلة لا يخص سلّم تقييم هذا التكليف",
        "VALIDATION_ERROR"
      );
    }
  } else {
    if (input.scores.length > 0) {
      return assignmentFail(
        "لا يوجد سلّم تقييم لهذا التكليف — استخدم الدرجة المباشرة",
        "VALIDATION_ERROR"
      );
    }
    if (input.directScore === undefined) {
      return assignmentFail("أدخل الدرجة المباشرة", "VALIDATION_ERROR");
    }
    if (input.directScore > MAX_NO_RUBRIC_SCORE) {
      return assignmentFail(
        `الدرجة المباشرة تتجاوز الحد الأقصى (${MAX_NO_RUBRIC_SCORE})`,
        "VALIDATION_ERROR"
      );
    }
    scoreTotal = input.directScore;
  }

  const graded = await db.$transaction(async (tx) => {
    const flipped = await tx.assignmentSubmission.updateMany({
      where: { id: row.data.id, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
      data: {
        status: "GRADED",
        scoreTotal,
        feedbackText: input.feedbackText ?? null,
        reviewedById: ctx.id,
        reviewedAt: new Date(),
      },
    });
    if (flipped.count !== 1) return null;

    await tx.rubricScore.deleteMany({ where: { submissionId: row.data.id } });
    if (scoreRows.length > 0) {
      await tx.rubricScore.createMany({
        data: scoreRows.map((score) => ({
          submissionId: row.data.id,
          criterionId: score.criterionId,
          points: score.points,
        })),
      });
    }
    return { id: row.data.id, status: "GRADED" as SubmissionStatus, scoreTotal };
  });

  if (!graded) {
    return assignmentFail("حالة التسليم تغيّرت — حدّث الصفحة", "ALREADY_SUBMITTED");
  }
  // Phase 11 — event notification (best-effort, post-commit).
  await notifySubmissionGraded({
    teacherId: row.data.teacherId,
    assignmentId: row.data.assignment.id,
    assignmentTitleAr: row.data.assignment.titleAr,
    scoreTotal: graded.scoreTotal,
    totalPoints: row.data.assignment.totalPoints,
  });
  return { ok: true, data: graded };
}

/* ------------------------------------------------------------------ */
/* Overview & metrics (office = school, deputy = granted scope,         */
/* super admin = platform stats only)                                   */
/* ------------------------------------------------------------------ */

async function buildOverviewRows(
  assignments: Prisma.AssignmentGetPayload<{ select: {
    id: true; titleAr: true; status: true; dueAt: true; schoolId: true;
    audienceMode: true; targetTeacherIdsJson: true; targetBranchIdsJson: true;
  } }>[],
  teachersBySchool: Map<string, { id: string; branchId: string | null }[]>,
  branchScopes: Map<string, string[] | null>
): Promise<OverviewRow[]> {
  const ids = assignments.map((assignment) => assignment.id);
  const [statusBuckets, lateBuckets] = ids.length
    ? await Promise.all([
        db.assignmentSubmission.groupBy({
          by: ["assignmentId", "status"],
          where: { assignmentId: { in: ids }, status: { not: "DRAFT" } },
          _count: { _all: true },
        }),
        db.assignmentSubmission.groupBy({
          by: ["assignmentId"],
          where: {
            assignmentId: { in: ids },
            status: { not: "DRAFT" },
            isLate: true,
          },
          _count: { _all: true },
        }),
      ])
    : [[], []];

  const counts = new Map<string, { submitted: number; pending: number; returned: number; graded: number }>();
  for (const bucket of statusBuckets) {
    const entry = counts.get(bucket.assignmentId) ?? { submitted: 0, pending: 0, returned: 0, graded: 0 };
    entry.submitted += bucket._count._all;
    if (bucket.status === "SUBMITTED" || bucket.status === "UNDER_REVIEW") {
      entry.pending += bucket._count._all;
    }
    if (bucket.status === "RETURNED") entry.returned += bucket._count._all;
    if (bucket.status === "GRADED") entry.graded += bucket._count._all;
    counts.set(bucket.assignmentId, entry);
  }
  const lateByAssignment = new Map(
    lateBuckets.map((bucket) => [bucket.assignmentId, bucket._count._all])
  );

  return assignments.map((assignment) => {
    const teachers = teachersBySchool.get(assignment.schoolId) ?? [];
    const allowed = branchScopes.get(assignment.schoolId) ?? null;
    const targeted = teachers.filter((teacher) => {
      if (!isTeacherTargeted(targetingOf(assignment), teacher)) return false;
      if (allowed) {
        return teacher.branchId !== null && allowed.includes(teacher.branchId);
      }
      return true;
    }).length;
    const entry = counts.get(assignment.id) ?? { submitted: 0, pending: 0, returned: 0, graded: 0 };
    return {
      id: assignment.id,
      titleAr: assignment.titleAr,
      status: assignment.status,
      dueAt: assignment.dueAt,
      targeted,
      submitted: entry.submitted,
      pending: entry.pending,
      returned: entry.returned,
      graded: entry.graded,
      late: lateByAssignment.get(assignment.id) ?? 0,
      completionRate:
        targeted > 0 ? Math.round((entry.graded / targeted) * 100) : null,
    };
  });
}

async function loadTeachersBySchool(
  schoolIds: string[]
): Promise<Map<string, { id: string; branchId: string | null }[]>> {
  const map = new Map<string, { id: string; branchId: string | null }[]>();
  if (schoolIds.length === 0) return map;
  const teachers = await db.user.findMany({
    where: { role: "TEACHER", schoolId: { in: schoolIds } },
    select: { id: true, schoolId: true, branchId: true },
  });
  for (const teacher of teachers) {
    if (!teacher.schoolId) continue;
    const list = map.get(teacher.schoolId) ?? [];
    list.push({ id: teacher.id, branchId: teacher.branchId });
    map.set(teacher.schoolId, list);
  }
  return map;
}

export async function getAssignmentsOverview(
  actor: AdminContext
): Promise<AssignmentResult<AssignmentOverview>> {
  if (actor.role === "SUPER_ADMIN") {
    const assignments = await db.assignment.findMany({
      select: {
        id: true, titleAr: true, status: true, dueAt: true, schoolId: true,
        audienceMode: true, targetTeacherIdsJson: true, targetBranchIdsJson: true,
      },
      orderBy: { updatedAt: "desc" },
      take: OVERVIEW_ROWS_LIMIT,
    });
    const schoolIds = [
      ...new Set(assignments.map((assignment) => assignment.schoolId)),
    ];
    const [teachersBySchool, schools] = await Promise.all([
      loadTeachersBySchool(schoolIds),
      db.school.findMany({
        where: { id: { in: schoolIds } },
        select: { id: true, nameAr: true },
      }),
    ]);
    const rows = await buildOverviewRows(
      assignments,
      teachersBySchool,
      new Map(schoolIds.map((id) => [id, null]))
    );
    const schoolNames = new Map(schools.map((school) => [school.id, school.nameAr]));
    const breakdown: SchoolBreakdownRow[] = schoolIds.map((schoolId) => {
      const schoolRows = rows.filter((row) => {
        const assignment = assignments.find((a) => a.id === row.id);
        return assignment?.schoolId === schoolId;
      });
      const published = schoolRows.length;
      const submitted = schoolRows.reduce((sum, row) => sum + row.submitted, 0);
      const graded = schoolRows.reduce((sum, row) => sum + row.graded, 0);
      const targeted = schoolRows.reduce((sum, row) => sum + row.targeted, 0);
      return {
        schoolId,
        schoolName: schoolNames.get(schoolId) ?? "—",
        assignmentsPublished: published,
        submissionsActive: submitted,
        gradedCount: graded,
        completionRate: targeted > 0 ? Math.round((graded / targeted) * 100) : null,
      };
    });

    const cards = summarizeCards(rows, publishedCountOf(rows));
    return { ok: true, data: { scope: "platform", cards, rows, schools: breakdown } };
  }

  if (actor.role === "EDUCATIONAL_DEPUTY") {
    const scopes = await resolveDeputyScopes({
      id: actor.id,
      role: actor.role,
      schoolId: actor.schoolId,
    });
    if (scopes.length === 0) {
      return { ok: true, data: { scope: "deputy", cards: emptyCards(), rows: [], schools: [] } };
    }
    const schoolIds = scopes.map((scope) => scope.schoolId);
    const assignments = await db.assignment.findMany({
      where: { schoolId: { in: schoolIds } },
      select: {
        id: true, titleAr: true, status: true, dueAt: true, schoolId: true,
        audienceMode: true, targetTeacherIdsJson: true, targetBranchIdsJson: true,
      },
      orderBy: { updatedAt: "desc" },
      take: OVERVIEW_ROWS_LIMIT,
    });
    const teachersBySchool = await loadTeachersBySchool(schoolIds);
    const branchScopes = new Map<string, string[] | null>(
      scopes.map((scope) => [scope.schoolId, scope.allowedBranchIds])
    );
    const rows = await buildOverviewRows(assignments, teachersBySchool, branchScopes);
    return {
      ok: true,
      data: { scope: "deputy", cards: summarizeCards(rows, publishedCountOf(rows)), rows, schools: [] },
    };
  }

  // DEVELOPMENT_OFFICE_MANAGER — own school.
  const scopeCheck = assignmentScopeError(actor, actor.schoolId);
  if (scopeCheck) return scopeCheck;
  const schoolId = actor.schoolId as string;
  const assignments = await db.assignment.findMany({
    where: { schoolId },
    select: {
      id: true, titleAr: true, status: true, dueAt: true, schoolId: true,
      audienceMode: true, targetTeacherIdsJson: true, targetBranchIdsJson: true,
    },
    orderBy: { updatedAt: "desc" },
    take: OVERVIEW_ROWS_LIMIT,
  });
  const teachersBySchool = await loadTeachersBySchool([schoolId]);
  const rows = await buildOverviewRows(
    assignments,
    teachersBySchool,
    new Map([[schoolId, null]])
  );
  return {
    ok: true,
    data: { scope: "school", cards: summarizeCards(rows, publishedCountOf(rows)), rows, schools: [] },
  };
}

function publishedCountOf(rows: OverviewRow[]): number {
  return rows.filter((row) => row.status === "PUBLISHED").length;
}

function summarizeCards(rows: OverviewRow[], published: number): AssignmentOverview["cards"] {
  const targetedPairs = rows.reduce((sum, row) => sum + row.targeted, 0);
  const graded = rows.reduce((sum, row) => sum + row.graded, 0);
  return {
    assignmentsPublished: published,
    submissionsActive: rows.reduce((sum, row) => sum + row.submitted, 0),
    pendingReview: rows.reduce((sum, row) => sum + row.pending, 0),
    returnedCount: rows.reduce((sum, row) => sum + row.returned, 0),
    gradedCount: graded,
    lateCount: rows.reduce((sum, row) => sum + row.late, 0),
    targetedPairs,
    completionRate: targetedPairs > 0 ? Math.round((graded / targetedPairs) * 100) : null,
  };
}

function emptyCards(): AssignmentOverview["cards"] {
  return {
    assignmentsPublished: 0,
    submissionsActive: 0,
    pendingReview: 0,
    returnedCount: 0,
    gradedCount: 0,
    lateCount: 0,
    targetedPairs: 0,
    completionRate: null,
  };
}

/** Dashboard metrics — real persisted counts, scoped by school (null = platform). */
export async function getAssignmentMetrics(
  schoolId: string | null
): Promise<AssignmentMetrics> {
  const assignmentWhere: Prisma.AssignmentWhereInput = schoolId ? { schoolId } : {};
  const submissionWhere: Prisma.AssignmentSubmissionWhereInput = schoolId
    ? { schoolId }
    : {};

  const [assignmentsTotal, assignmentsPublished, submissionsActive, pendingReview, gradedCount, lateCount] =
    await Promise.all([
      db.assignment.count({ where: assignmentWhere }),
      db.assignment.count({ where: { ...assignmentWhere, status: "PUBLISHED" } }),
      db.assignmentSubmission.count({
        where: { ...submissionWhere, status: { not: "DRAFT" } },
      }),
      db.assignmentSubmission.count({
        where: { ...submissionWhere, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
      }),
      db.assignmentSubmission.count({
        where: { ...submissionWhere, status: "GRADED" },
      }),
      db.assignmentSubmission.count({
        where: { ...submissionWhere, status: { not: "DRAFT" }, isLate: true },
      }),
    ]);

  return {
    assignmentsTotal,
    assignmentsPublished,
    submissionsActive,
    pendingReview,
    gradedCount,
    lateCount,
  };
}
/**
 * Phase 8 — certificate service: eligibility engine, issuance,
 * revocation, management lists, certificate view, verification and
 * dashboard metrics.
 *
 * Architecture mirrors the Phase 6/7 services:
 *   - every mutation re-validates role and tenant on the SERVER (the
 *     actor is always built from the session, never from the payload),
 *   - eligibility is RE-COMPUTED from real learning data at issuance
 *     time — the client can never assert eligibility, scores or scope,
 *   - issuance writes the certificate + its ISSUED audit event inside
 *     one transaction; revocation flips the row with a conditional
 *     updateMany (status = ISSUED) so concurrent double-revocations
 *     cannot corrupt state, then appends a REVOKED event,
 *   - identifiers (certificate number / verification code) are
 *     generated server-side from crypto randomness with unique-index
 *     collision retries.
 *
 * Eligibility rules (fixed, documented, derived ONLY from persisted
 * data — no invented completion signals):
 *   ENROLLMENT  — the teacher has an ACTIVE enrollment in the course
 *                 (course-bound) or in at least one course of the
 *                 program (program-bound).
 *   ASSESSMENTS — every PUBLISHED assessment bound to the course (or
 *                 to any course of the program) has at least one
 *                 passed attempt by the teacher. "Passed" = the
 *                 attempt row's passed flag (or PASSED status). The
 *                 minimum score is each assessment's own passingScore
 *                 — already enforced by the Phase 6 engine. When a
 *                 content has no published assessments the rule is
 *                 satisfied vacuously (enrollment remains required).
 *   Lesson-level completion tracking does not exist in the current
 *   data model (CourseEnrollment has no completion states yet), so
 *   NO lesson rule is invented here; adding one later only extends
 *   buildRequirements().
 */
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";

import {
  notifyCertificateIssued,
  notifyCertificateRevoked,
} from "@/lib/notifications/hooks";

import {
  canIssueCertificates,
  certificateScopeError,
  issueGuard,
  verifyGuard,
  type CertificateActor,
  type CertificateViewer,
} from "@/lib/certificates/access";
import { db } from "@/lib/db";
import {
  CERT_NUMBER_PREFIX,
  CERT_NUMBER_RANDOM_LENGTH,
  CERTIFICATE_CODE_ALPHABET,
  CERTIFICATES_PAGE_SIZE,
  CERT_CONTENT_TYPE_LABELS,
  IDENTIFIER_GENERATION_ATTEMPTS,
  ISSUER_ROLE_LABELS,
  METRICS_COURSES_LIMIT,
  VERIFICATION_CODE_LENGTH,
  type CertContentType,
  type CertificateEffectiveStatus,
  type EligibilityRuleKey,
} from "@/config/certificates";
import {
  certificateFail,
  issueCertificateSchema,
  normalizeVerificationQuery,
  revokeCertificateSchema,
  validationFail,
  verifyCertificateSchema,
  type CertificateErrorCode,
  type CertificateResult,
} from "@/lib/validation/certificates";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { resolveSchoolSignatory } from "@/lib/certificates/signatory";

export type { CertificateErrorCode, CertificateResult } from "@/lib/validation/certificates";

/* ------------------------------------------------------------------ */
/* Serializable shapes consumed by pages (RSC-serializable)             */
/* ------------------------------------------------------------------ */

export interface EligibilityRequirement {
  /** Stable key persisted in the criteria snapshot (ENROLLMENT | ASSESSMENTS). */
  key: EligibilityRuleKey;
  label: string;
  met: boolean;
  detail: string;
}

export interface AssessmentStanding {
  assessmentId: string;
  titleAr: string;
  passed: boolean;
  bestPercentage: number | null;
  attemptsCount: number;
}

export interface ExistingCertificateRef {
  certificateId: string;
  certificateNumber: string;
  status: string;
}

export interface TeacherEligibility {
  teacherId: string;
  teacherName: string;
  branchName: string | null;
  eligible: boolean;
  alreadyIssued: ExistingCertificateRef | null;
  requirements: EligibilityRequirement[];
  assessments: AssessmentStanding[];
}

export interface IssueContentInfo {
  type: CertContentType;
  id: string;
  titleAr: string;
  titleEn: string | null;
  /** null = platform-wide content shared with every school. */
  schoolId: string | null;
  status: string;
}

export interface IssueEligibilityData {
  content: IssueContentInfo;
  /** Teacher enrollment count used as the roster denominator. */
  teachersTotal: number;
  rows: TeacherEligibility[];
}

export interface IssueContentOptions {
  courses: { id: string; titleAr: string; scope: "school" | "platform" }[];
  programs: { id: string; nameAr: string; scope: "school" | "platform" }[];
}

export interface IssueOutcome {
  id: string;
  certificateNumber: string;
  verificationCode: string;
  status: string;
}

export interface CertificateManageRow {
  id: string;
  certificateNumber: string;
  titleAr: string;
  teacherName: string;
  contentTitle: string | null;
  contentType: CertContentType | null;
  issuedAt: Date;
  expiresAt: Date | null;
  status: string;
  effectiveStatus: CertificateEffectiveStatus;
  issuerName: string | null;
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
}

export interface CertificateSchoolInfo {
  nameAr: string;
  logoUrl: string | null;
  brandColor: string;
}

export interface CertificateAuditEvent {
  type: string;
  createdAt: Date;
  actorName: string | null;
  actorRole: string | null;
  note: string | null;
}

export interface CertificateView {
  id: string;
  certificateNumber: string;
  verificationCode: string;
  verificationCodeGrouped: string;
  titleAr: string;
  titleEn: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  status: string;
  effectiveStatus: CertificateEffectiveStatus;
  issuedAt: Date;
  expiresAt: Date | null;
  teacherId: string;
  teacherName: string;
  school: CertificateSchoolInfo;
  contentTitle: string | null;
  contentSubtitle: string | null;
  issuerName: string | null;
  issuerRoleLabel: string | null;
  /** Signatory snapshot at issuance (school manager) — never recomputed. */
  schoolSignatoryName: string | null;
  schoolSignatoryTitle: string | null;
  revocation: { at: Date; reason: string; byName: string | null } | null;
  /** Parsed criteria snapshot (null for legacy rows / parse failures). */
  snapshot: {
    rules: EligibilityRequirement[];
    assessments: AssessmentStanding[];
    generatedAt: string | null;
  } | null;
  events: CertificateAuditEvent[];
}

export interface VerificationMatch {
  certificateNumber: string;
  titleAr: string;
  teacherName: string;
  schoolName: string;
  contentTitle: string | null;
  issuedAt: Date;
  effectiveStatus: CertificateEffectiveStatus;
  /** Set only for revoked certificates (minimum necessary info). */
  revokedAt: Date | null;
}

export type VerificationResult =
  | { found: true; certificate: VerificationMatch }
  | { found: false };

export interface CertificateMetrics {
  total: number;
  active: number;
  revoked: number;
  expired: number;
  issuedLast30Days: number;
  /** Distinct teachers holding at least one certificate. */
  teachersWithCertificates: number;
  /**
   * (teacher, published course) pairs that SATISFY the eligibility
   * rules but have no certificate yet — school scope only (null for
   * platform-wide metrics).
   */
  eligibleAwaiting: number | null;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-testable)                                         */
/* ------------------------------------------------------------------ */

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CERTIFICATE_CODE_ALPHABET[bytes[i] % CERTIFICATE_CODE_ALPHABET.length];
  }
  return out;
}

/** MQ-YYYY-XXXXXX — the year guards accidental cross-year collisions. */
export function buildCertificateNumber(now = new Date()): string {
  return `${CERT_NUMBER_PREFIX}-${now.getFullYear()}-${randomCode(CERT_NUMBER_RANDOM_LENGTH)}`;
}

export function buildVerificationCode(): string {
  return randomCode(VERIFICATION_CODE_LENGTH);
}

/** "ABCD-EFGH-IJKL-MNOP" — grouped display form of the verification code. */
export function formatCodeGrouped(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join("-");
}

/**
 * Derived display status: REVOKED persists; EXPIRED is computed from
 * expiresAt (a certificate can never be both revoked and expired).
 */
export function effectiveStatusOf(
  row: { status: string; expiresAt: Date | null },
  now = new Date()
): CertificateEffectiveStatus {
  if (row.status === "REVOKED") return "REVOKED";
  if (row.expiresAt && row.expiresAt.getTime() < now.getTime()) return "EXPIRED";
  return "ISSUED";
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/**
 * Aggregates attempts per (assessment): passed = any attempt with the
 * passed flag (or PASSED status — reviewed short-answer rows). Best
 * percentage = max over attempts reporting one. Exported for the
 * growth service so the completion rule has ONE implementation.
 */
export function summarizeAssessments(
  assessments: { id: string; titleAr: string }[],
  attempts: { assessmentId: string; status: string; passed: boolean | null; percentage: number | null }[]
): AssessmentStanding[] {
  return assessments.map((assessment) => {
    const own = attempts.filter((attempt) => attempt.assessmentId === assessment.id);
    const passed = own.some(
      (attempt) => attempt.passed === true || attempt.status === "PASSED"
    );
    const percentages = own
      .map((attempt) => attempt.percentage)
      .filter((value): value is number => typeof value === "number");
    return {
      assessmentId: assessment.id,
      titleAr: assessment.titleAr,
      passed,
      bestPercentage: percentages.length > 0 ? Math.max(...percentages) : null,
      attemptsCount: own.length,
    };
  });
}

/** Stable Arabic requirement labels/details from the aggregated standings. */
export function buildRequirements(
  enrolled: boolean,
  standings: AssessmentStanding[]
): EligibilityRequirement[] {
  const enrollment: EligibilityRequirement = {
    key: "ENROLLMENT",
    label: "الالتحاق بالمحتوى التدريبي",
    met: enrolled,
    detail: enrolled
      ? "مُسجَّل في المحتوى التدريبي"
      : "غير مُسجَّل في المحتوى التدريبي",
  };

  let assessments: EligibilityRequirement;
  if (standings.length === 0) {
    assessments = {
      key: "ASSESSMENTS",
      label: "اجتياز التقييمات المرتبطة",
      met: true,
      detail: "لا توجد تقييمات منشورة مرتبطة بهذا المحتوى — يُستوفى الشرط تلقائيًا",
    };
  } else {
    const lines = standings.map((standing) =>
      standing.passed
        ? `«${standing.titleAr}» — مجتاز${standing.bestPercentage !== null ? ` (أفضل نتيجة ${standing.bestPercentage}%)` : ""}`
        : `«${standing.titleAr}» — غير مجتاز`
    );
    assessments = {
      key: "ASSESSMENTS",
      label: "اجتياز التقييمات المرتبطة",
      met: standings.every((standing) => standing.passed),
      detail: lines.join(" • "),
    };
  }

  return [enrollment, assessments];
}

/* ------------------------------------------------------------------ */
/* Content snapshot + data loading (tenant-validated)                   */
/* ------------------------------------------------------------------ */

interface ContentSnapshot {
  type: CertContentType;
  id: string;
  titleAr: string;
  titleEn: string | null;
  /** null = platform-wide content shared with every school. */
  schoolId: string | null;
  status: string;
  /** Program-bound: member course ids (enrollment + assessment scope). */
  memberCourseIds: string[];
}

async function loadContentSnapshot(
  ctx: CertificateActor,
  contentType: CertContentType,
  contentId: string
): Promise<CertificateResult<ContentSnapshot>> {
  if (contentType === "COURSE") {
    const course = await db.course.findUnique({
      where: { id: contentId },
      select: { id: true, titleAr: true, titleEn: true, schoolId: true, status: true },
    });
    if (!course) {
      return certificateFail("الدورة التدريبية غير موجودة", "NOT_FOUND");
    }
    // Platform-wide courses (schoolId null) are shared with every
    // school; school-owned courses must belong to the actor's school.
    if (course.schoolId !== null && course.schoolId !== ctx.schoolId) {
      return certificateFail("هذه الدورة لا تنتمي إلى نطاق مدرستك", "FORBIDDEN");
    }
    if (course.status === "DRAFT") {
      return certificateFail("لا يمكن إصدار شهادات لمحتوى غير منشور", "CONTENT_INVALID");
    }
    return {
      ok: true,
      data: {
        type: "COURSE",
        id: course.id,
        titleAr: course.titleAr,
        titleEn: course.titleEn,
        schoolId: course.schoolId,
        status: course.status,
        memberCourseIds: [course.id],
      },
    };
  }

  const program = await db.trainingProgram.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      nameAr: true,
      nameEn: true,
      schoolId: true,
      status: true,
      courses: { select: { id: true } },
    },
  });
  if (!program) {
    return certificateFail("البرنامج التدريبي غير موجود", "NOT_FOUND");
  }
  if (program.schoolId !== null && program.schoolId !== ctx.schoolId) {
    return certificateFail("هذا البرنامج لا ينتمي إلى نطاق مدرستك", "FORBIDDEN");
  }
  if (program.status === "DRAFT") {
    return certificateFail("لا يمكن إصدار شهادات لمحتوى غير منشور", "CONTENT_INVALID");
  }
  return {
    ok: true,
    data: {
      type: "PROGRAM",
      id: program.id,
      titleAr: program.nameAr,
      titleEn: program.nameEn,
      schoolId: program.schoolId,
      status: program.status,
      memberCourseIds: program.courses.map((course) => course.id),
    },
  };
}

async function loadPublishedAssessments(
  content: ContentSnapshot
): Promise<{ id: string; titleAr: string }[]> {
  return db.assessment.findMany({
    where:
      content.type === "COURSE"
        ? { courseId: content.id, status: "PUBLISHED" }
        : { course: { programId: content.id }, status: "PUBLISHED" },
    select: { id: true, titleAr: true },
    orderBy: { titleAr: "asc" },
  });
}

type AttemptIndex = Map<
  string,
  { assessmentId: string; status: string; passed: boolean | null; percentage: number | null }[]
>;

async function loadAttemptIndex(
  teacherIds: string[],
  assessmentIds: string[]
): Promise<AttemptIndex> {
  const index: AttemptIndex = new Map();
  if (teacherIds.length === 0 || assessmentIds.length === 0) return index;
  const attempts = await db.assessmentAttempt.findMany({
    where: { userId: { in: teacherIds }, assessmentId: { in: assessmentIds } },
    select: {
      userId: true,
      assessmentId: true,
      status: true,
      passed: true,
      percentage: true,
    },
  });
  for (const attempt of attempts) {
    const key = `${attempt.userId}:${attempt.assessmentId}`;
    const list = index.get(key);
    if (list) list.push(attempt);
    else index.set(key, [attempt]);
  }
  return index;
}

/**
 * Eligibility rows for the selected content across the school's active
 * teachers (office-manager scope). All data is fetched in batched
 * queries; every row is computed server-side.
 */
export async function getIssueEligibility(
  ctx: CertificateActor,
  contentType: CertContentType,
  contentId: string
): Promise<CertificateResult<IssueEligibilityData>> {
  if (!canIssueCertificates(ctx.role) || !ctx.schoolId) {
    return certificateFail("إصدار الشهادات متاح لمديري مكاتب التطوير فقط", "FORBIDDEN");
  }
  if (contentType !== "COURSE" && contentType !== "PROGRAM") {
    return certificateFail("نوع المحتوى غير مدعوم", "VALIDATION_ERROR");
  }

  const content = await loadContentSnapshot(ctx, contentType, contentId);
  if (!content.ok) return content;
  const snapshot = content.data;

  const teachers = await db.user.findMany({
    where: { schoolId: ctx.schoolId, role: "TEACHER", isActive: true },
    select: {
      id: true,
      name: true,
      branchId: true,
      branch: { select: { nameAr: true } },
    },
    orderBy: { name: "asc" },
    take: 500,
  });
  const teacherIds = teachers.map((teacher) => teacher.id);

  const assessments = await loadPublishedAssessments(snapshot);
  const [enrollments, attemptIndex, existingCertificates] = await Promise.all([
    db.courseEnrollment.findMany({
      where: { courseId: { in: snapshot.memberCourseIds }, userId: { in: teacherIds } },
      select: { courseId: true, userId: true },
    }),
    loadAttemptIndex(teacherIds, assessments.map((assessment) => assessment.id)),
    db.certificate.findMany({
      where: {
        schoolId: ctx.schoolId,
        teacherId: { in: teacherIds },
        ...(contentType === "COURSE"
          ? { courseId: snapshot.id }
          : { programId: snapshot.id }),
      },
      select: { id: true, teacherId: true, certificateNumber: true, status: true },
    }),
  ]);

  const enrolledTeacherIds = new Set(enrollments.map((enrollment) => enrollment.userId));
  const certificateByTeacher = new Map(
    existingCertificates.map((certificate) => [certificate.teacherId, certificate])
  );

  const rows: TeacherEligibility[] = teachers.map((teacher) => {
    // Gather this teacher's attempts across ALL content assessments.
    const ownAttempts = assessments.flatMap((assessment) => {
      const list = attemptIndex.get(`${teacher.id}:${assessment.id}`);
      return (list ?? []).map((attempt) => ({
        assessmentId: attempt.assessmentId,
        status: attempt.status,
        passed: attempt.passed,
        percentage: attempt.percentage,
      }));
    });
    const standings = summarizeAssessments(assessments, ownAttempts);
    const requirements = buildRequirements(enrolledTeacherIds.has(teacher.id), standings);
    const existing = certificateByTeacher.get(teacher.id) ?? null;
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      branchName: teacher.branch?.nameAr ?? null,
      eligible:
        requirements.every((requirement) => requirement.met) && !existing,
      alreadyIssued: existing
        ? {
            certificateId: existing.id,
            certificateNumber: existing.certificateNumber,
            status: existing.status,
          }
        : null,
      requirements,
      assessments: standings,
    };
  });

  return {
    ok: true,
    data: {
      content: {
        type: snapshot.type,
        id: snapshot.id,
        titleAr: snapshot.titleAr,
        titleEn: snapshot.titleEn,
        schoolId: snapshot.schoolId,
        status: snapshot.status,
      },
      teachersTotal: teachers.length,
      rows,
    },
  };
}

/** Selectable issuance targets: non-draft content in scope (or platform-wide). */
export async function listIssueContentOptions(
  ctx: CertificateActor
): Promise<CertificateResult<IssueContentOptions>> {
  if (!canIssueCertificates(ctx.role) || !ctx.schoolId) {
    return certificateFail("إصدار الشهادات متاح لمديري مكاتب التطوير فقط", "FORBIDDEN");
  }
  const [courses, programs] = await Promise.all([
    db.course.findMany({
      where: {
        status: { in: ["PUBLISHED", "ARCHIVED"] },
        OR: [{ schoolId: ctx.schoolId }, { schoolId: null }],
      },
      select: { id: true, titleAr: true, schoolId: true },
      orderBy: { titleAr: "asc" },
      take: 200,
    }),
    db.trainingProgram.findMany({
      where: {
        status: { in: ["PUBLISHED", "ARCHIVED"] },
        OR: [{ schoolId: ctx.schoolId }, { schoolId: null }],
      },
      select: { id: true, nameAr: true, schoolId: true },
      orderBy: { nameAr: "asc" },
      take: 100,
    }),
  ]);
  return {
    ok: true,
    data: {
      courses: courses.map((course) => ({
        id: course.id,
        titleAr: course.titleAr,
        scope: course.schoolId ? ("school" as const) : ("platform" as const),
      })),
      programs: programs.map((program) => ({
        id: program.id,
        nameAr: program.nameAr,
        scope: program.schoolId ? ("school" as const) : ("platform" as const),
      })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Issuance                                                             */
/* ------------------------------------------------------------------ */

export async function issueCertificate(
  ctx: CertificateActor,
  raw: unknown
): Promise<CertificateResult<IssueOutcome>> {
  const guard = issueGuard(ctx);
  if (guard) return guard;

  const parsed = issueCertificateSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  if (!ctx.schoolId) {
    return certificateFail("إصدار الشهادات يتطلب نطاقًا مدرسيًا محددًا", "FORBIDDEN");
  }

  // The teacher identity is validated SERVER-SIDE: role, activation and
  // school membership never come from the payload.
  const teacher = await db.user.findUnique({
    where: { id: input.teacherId },
    select: { id: true, name: true, role: true, isActive: true, schoolId: true },
  });
  if (!teacher || teacher.role !== "TEACHER" || !teacher.isActive) {
    return certificateFail("المعلم غير موجود أو غير مفعّل", "TEACHER_INVALID");
  }
  if (teacher.schoolId !== ctx.schoolId) {
    return certificateFail("المعلم لا ينتمي إلى مدرستك", "TEACHER_INVALID");
  }

  const content = await loadContentSnapshot(ctx, input.contentType, input.contentId);
  if (!content.ok) return content;
  const snapshot = content.data;

  // Duplicate check (explicit message before the DB unique constraint).
  const existing = await db.certificate.findFirst({
    where: {
      teacherId: teacher.id,
      ...(input.contentType === "COURSE"
        ? { courseId: snapshot.id }
        : { programId: snapshot.id }),
    },
    select: { id: true, certificateNumber: true, status: true },
  });
  if (existing) {
    return certificateFail(
      `سبق إصدار شهادة لهذا المعلم عن هذا المحتوى (رقم: ${existing.certificateNumber})`,
      "ALREADY_ISSUED"
    );
  }

  // Re-compute eligibility from real data — never trust the client.
  const [assessments, enrollments] = await Promise.all([
    loadPublishedAssessments(snapshot),
    db.courseEnrollment.findFirst({
      where: { courseId: { in: snapshot.memberCourseIds }, userId: teacher.id },
      select: { id: true },
    }),
  ]);
  const attemptIndex = await loadAttemptIndex([teacher.id], assessments.map((a) => a.id));
  const ownAttempts = assessments.flatMap((assessment) => {
    const list = attemptIndex.get(`${teacher.id}:${assessment.id}`);
    return (list ?? []).map((attempt) => ({
      assessmentId: attempt.assessmentId,
      status: attempt.status,
      passed: attempt.passed,
      percentage: attempt.percentage,
    }));
  });
  const standings = summarizeAssessments(assessments, ownAttempts);
  const requirements = buildRequirements(enrollments !== null, standings);
  const unmet = requirements.filter((requirement) => !requirement.met);
  if (unmet.length > 0) {
    return certificateFail(
      `لا يمكن إصدار الشهادة — متطلبات غير مستوفاة: ${unmet
        .map((requirement) => `${requirement.label} (${requirement.detail})`)
        .join("؛ ")}`,
      "NOT_ELIGIBLE"
    );
  }

  // Sensible defaults; the issuer may override via validated input.
  const typeLabel = CERT_CONTENT_TYPE_LABELS[snapshot.type];
  const titleAr = input.titleAr ?? `شهادة إتمام ${typeLabel} «${snapshot.titleAr}»`;
  const titleEn =
    input.titleEn ??
    (snapshot.titleEn ? `Certificate of Completion — ${snapshot.titleEn}` : null);
  const descriptionAr =
    input.descriptionAr ??
    `تم استيفاء متطلبات ${typeLabel} وفق سجلات التدريب والتقييم في منصة منارة.`;

  const criteriaSnapshot = JSON.stringify({
    content: { type: snapshot.type, id: snapshot.id, title: snapshot.titleAr },
    rules: requirements,
    assessments: standings,
    generatedAt: new Date().toISOString(),
  });

  /* ---------------------------------------------------------------- */
  /* Signatory snapshot (SCHOOL_MANAGER of the issuing school).        */
  /* Captured at ISSUANCE time and stored on the row — historical      */
  /* certificates never change when the manager is renamed/replaced.   */
  /* No manager -> issuance is BLOCKED (no fabricated names, no silent */
  /* fallback, no hardcoded defaults). Existing certificates keep      */
  /* whatever snapshot was taken when THEY were issued.                */
  /* ---------------------------------------------------------------- */
  const signatory = await resolveSchoolSignatory(ctx.schoolId as string);
  if (!signatory) {
    return certificateFail(
      "لا يمكن إصدار الشهادة — لا يوجد مدير مدرسة نشط لهذه المدرسة لإمضاء الشهادات. عيّن مدير مدرسة أولًا من صفحة إدارة الحسابات",
      "RELATION_ERROR"
    );
  }

  const now = new Date();
  for (let attempt = 0; attempt < IDENTIFIER_GENERATION_ATTEMPTS; attempt += 1) {
    const certificateNumber = buildCertificateNumber(now);
    const verificationCode = buildVerificationCode();
    const taken = await db.certificate.findFirst({
      where: { OR: [{ certificateNumber }, { verificationCode }] },
      select: { id: true },
    });
    if (taken) continue;

    try {
      const outcome = await db.$transaction(async (tx) => {
        const certificate = await tx.certificate.create({
          data: {
            schoolId: ctx.schoolId as string,
            teacherId: teacher.id,
            certificateNumber,
            verificationCode,
            titleAr,
            titleEn,
            descriptionAr,
            descriptionEn: input.descriptionEn,
            programId: snapshot.type === "PROGRAM" ? snapshot.id : null,
            courseId: snapshot.type === "COURSE" ? snapshot.id : null,
            status: "ISSUED",
            issuedAt: now,
            expiresAt: input.expiresAt ?? null,
            issuedById: ctx.id,
            issuerRoleLabel:
              ISSUER_ROLE_LABELS[ctx.role] ??
              (ctx.role === "SCHOOL_MANAGER" ? "مدير المدرسة" : null),
            schoolSignatoryName: signatory.name,
            schoolSignatoryTitle: signatory.title,
            criteriaSnapshotJson: criteriaSnapshot,
          },
        });
        await tx.certificateEvent.create({
          data: {
            certificateId: certificate.id,
            type: "ISSUED",
            actorId: ctx.id,
            actorRole: ctx.role,
            note: `إصدار شهادة إتمام ${typeLabel} «${snapshot.titleAr}»`,
          },
        });
        return {
          id: certificate.id,
          certificateNumber,
          verificationCode,
          status: certificate.status,
        };
      });
      // Phase 11 — event notification (best-effort, post-commit).
      await notifyCertificateIssued({
        teacherId: teacher.id,
        certificateId: outcome.id,
        titleAr,
      });
      return { ok: true, data: outcome };
    } catch (error) {
      if (isUniqueViolation(error)) continue; // regenerate + retry
      throw error;
    }
  }
  return certificateFail(
    "تعذر توليد معرّفات فريدة للشهادة — أعد المحاولة",
    "RELATION_ERROR"
  );
}

/* ------------------------------------------------------------------ */
/* Revocation                                                           */
/* ------------------------------------------------------------------ */

export async function revokeCertificate(
  ctx: CertificateActor,
  raw: unknown
): Promise<CertificateResult<{ id: string; status: string }>> {
  const guard = issueGuard(ctx);
  if (guard) return guard;

  const parsed = revokeCertificateSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);
  const input = parsed.data;

  if (!ctx.schoolId) {
    return certificateFail("إلغاء الشهادات يتطلب نطاقًا مدرسيًا محددًا", "FORBIDDEN");
  }

  // Conditional flip: only an ISSUED certificate of THIS school can be
  // revoked — concurrent double-revocations cannot double-write.
  const now = new Date();
  const flipped = await db.certificate.updateMany({
    where: { id: input.certificateId, schoolId: ctx.schoolId, status: "ISSUED" },
    data: {
      status: "REVOKED",
      revokedById: ctx.id,
      revokedAt: now,
      revocationReason: input.reason,
    },
  });
  if (flipped.count === 0) {
    const row = await db.certificate.findUnique({
      where: { id: input.certificateId },
      select: { id: true, schoolId: true, status: true },
    });
    if (!row) return certificateFail("الشهادة غير موجودة", "NOT_FOUND");
    if (row.schoolId !== ctx.schoolId) {
      return certificateFail(
        "لا تملك صلاحية إلغاء هذه الشهادة — النطاق المدرسي مختلف",
        "FORBIDDEN"
      );
    }
    return certificateFail("لا يمكن إلغاء شهادة ملغاة مسبقًا", "ALREADY_REVOKED");
  }

  await db.certificateEvent.create({
    data: {
      certificateId: input.certificateId,
      type: "REVOKED",
      actorId: ctx.id,
      actorRole: ctx.role,
      note: input.reason,
    },
  });

  // Phase 11 — event notification (best-effort, post-commit).
  const revokedRow = await db.certificate.findUnique({
    where: { id: input.certificateId },
    select: { teacherId: true, titleAr: true },
  });
  if (revokedRow) {
    await notifyCertificateRevoked({
      teacherId: revokedRow.teacherId,
      certificateId: input.certificateId,
      titleAr: revokedRow.titleAr,
      reason: input.reason,
    });
  }

  return { ok: true, data: { id: input.certificateId, status: "REVOKED" } };
}

/* ------------------------------------------------------------------ */
/* Management list                                                      */
/* ------------------------------------------------------------------ */

export interface CertificateListFilters {
  q?: string;
  status?: string;
  page?: number;
}

export async function listCertificatesForManage(
  ctx: CertificateActor,
  filters: CertificateListFilters
): Promise<CertificateResult<Paginated<CertificateManageRow>>> {
  if (!canIssueCertificates(ctx.role) || !ctx.schoolId) {
    return certificateFail("إدارة الشهادات متاحة لمديري مكاتب التطوير فقط", "FORBIDDEN");
  }

  const where: Prisma.CertificateWhereInput = { schoolId: ctx.schoolId };
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { certificateNumber: { contains: q } },
      { titleAr: { contains: q } },
      { teacher: { name: { contains: q } } },
    ];
  }
  if (filters.status === "ISSUED" || filters.status === "REVOKED") {
    where.status = filters.status;
  }

  const [total, rows] = await Promise.all([
    db.certificate.count({ where }),
    db.certificate.findMany({
      where,
      include: {
        teacher: { select: { name: true } },
        course: { select: { titleAr: true } },
        program: { select: { nameAr: true } },
        issuedBy: { select: { name: true } },
      },
      orderBy: { issuedAt: "desc" },
      skip: (Math.max(1, filters.page ?? 1) - 1) * CERTIFICATES_PAGE_SIZE,
      take: CERTIFICATES_PAGE_SIZE,
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / CERTIFICATES_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), pageCount);

  return {
    ok: true,
    data: {
      rows: rows.map((row) => ({
        id: row.id,
        certificateNumber: row.certificateNumber,
        titleAr: row.titleAr,
        teacherName: row.teacher.name,
        contentTitle: row.course?.titleAr ?? row.program?.nameAr ?? null,
        contentType:
          row.courseId !== null
            ? ("COURSE" as const)
            : row.programId !== null
              ? ("PROGRAM" as const)
              : null,
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
        status: row.status,
        effectiveStatus: effectiveStatusOf(row),
        issuerName: row.issuedBy?.name ?? null,
      })),
      total,
      page,
      pageCount,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Certificate view (owner-teacher OR authorized back-office roles)     */
/* ------------------------------------------------------------------ */

/**
 * Teacher workspace list — strictly the viewer's OWN certificates
 * (ownership enforced server-side; no other teacher's rows can ever
 * be projected through this path).
 */
export async function listCertificatesForTeacher(
  viewer: CertificateViewer
): Promise<CertificateResult<CertificateManageRow[]>> {
  if (viewer.role !== "TEACHER") {
    return certificateFail("قائمة الشهادات متاحة للمعلمين فقط", "FORBIDDEN");
  }
  const rows = await db.certificate.findMany({
    where: { teacherId: viewer.id },
    include: {
      teacher: { select: { name: true } },
      course: { select: { titleAr: true } },
      program: { select: { nameAr: true } },
      issuedBy: { select: { name: true } },
    },
    orderBy: { issuedAt: "desc" },
  });
  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      certificateNumber: row.certificateNumber,
      titleAr: row.titleAr,
      teacherName: row.teacher.name,
      contentTitle: row.course?.titleAr ?? row.program?.nameAr ?? null,
      contentType:
        row.courseId !== null
          ? ("COURSE" as const)
          : row.programId !== null
            ? ("PROGRAM" as const)
            : null,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      status: row.status,
      effectiveStatus: effectiveStatusOf(row),
      issuerName: row.issuedBy?.name ?? null,
    })),
  };
}

function parseSnapshot(raw: string | null): CertificateView["snapshot"] {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      rules?: unknown;
      assessments?: unknown;
      generatedAt?: unknown;
    };
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules.filter(
          (item): item is EligibilityRequirement =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as EligibilityRequirement).key === "string" &&
            typeof (item as EligibilityRequirement).label === "string" &&
            typeof (item as EligibilityRequirement).met === "boolean"
        )
      : [];
    const assessments = Array.isArray(parsed.assessments)
      ? parsed.assessments.filter(
          (item): item is AssessmentStanding =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as AssessmentStanding).assessmentId === "string"
        )
      : [];
    return {
      rules,
      assessments,
      generatedAt:
        typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
    };
  } catch {
    return null;
  }
}

export async function getCertificateView(
  viewer: CertificateViewer,
  certificateId: string
): Promise<CertificateResult<CertificateView>> {
  const row = await db.certificate.findUnique({
    where: { id: certificateId },
    include: {
      teacher: { select: { id: true, name: true } },
      school: {
        select: { nameAr: true, logoUrl: true, brandColor: true },
      },
      course: { select: { titleAr: true, titleEn: true } },
      program: { select: { nameAr: true, nameEn: true } },
      issuedBy: { select: { name: true } },
      revokedBy: { select: { name: true } },
      events: {
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { name: true } } },
      },
    },
  });
  if (!row) return certificateFail("الشهادة غير موجودة", "NOT_FOUND");

  // Ownership / scope enforcement (server-side, never UI-hidden-only):
  //   TEACHER   → owner only;
  //   SUPER_ADMIN → platform-wide read-only;
  //   other back-office roles → own school only.
  if (viewer.role === "TEACHER") {
    if (row.teacherId !== viewer.id) {
      return certificateFail(
        "لا تملك صلاحية الوصول إلى شهادة معلم آخر",
        "FORBIDDEN"
      );
    }
  } else if (viewer.role === "SUPER_ADMIN") {
    // read-only platform-wide access — allowed
  } else if (
    viewer.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    viewer.role === "EDUCATIONAL_SUPERVISOR" ||
    viewer.role === "EDUCATIONAL_DEPUTY"
  ) {
    const scopeError = certificateScopeError(
      { id: viewer.id, role: viewer.role, schoolId: viewer.schoolId },
      row.schoolId
    );
    if (scopeError) return scopeError;
  } else {
    return certificateFail("لا تملك صلاحية الوصول إلى هذه الصفحة", "FORBIDDEN");
  }

  const revocation =
    row.status === "REVOKED" && row.revokedAt
      ? {
          at: row.revokedAt,
          reason: row.revocationReason ?? "—",
          byName: row.revokedBy?.name ?? null,
        }
      : null;

  return {
    ok: true,
    data: {
      id: row.id,
      certificateNumber: row.certificateNumber,
      verificationCode: row.verificationCode,
      verificationCodeGrouped: formatCodeGrouped(row.verificationCode),
      titleAr: row.titleAr,
      titleEn: row.titleEn,
      descriptionAr: row.descriptionAr,
      descriptionEn: row.descriptionEn,
      status: row.status,
      effectiveStatus: effectiveStatusOf(row),
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      teacherId: row.teacher.id,
      teacherName: row.teacher.name,
      school: {
        nameAr: row.school.nameAr,
        logoUrl: row.school.logoUrl,
        brandColor: row.school.brandColor,
      },
      contentTitle: row.course?.titleAr ?? row.program?.nameAr ?? null,
      contentSubtitle:
        row.courseId !== null
          ? CERT_CONTENT_TYPE_LABELS.COURSE
          : row.programId !== null
            ? CERT_CONTENT_TYPE_LABELS.PROGRAM
            : null,
      issuerName: row.issuedBy?.name ?? null,
      issuerRoleLabel: row.issuerRoleLabel,
      schoolSignatoryName: row.schoolSignatoryName,
      schoolSignatoryTitle: row.schoolSignatoryTitle,
      revocation,
      snapshot: parseSnapshot(row.criteriaSnapshotJson),
      events: row.events.map((event) => ({
        type: event.type,
        createdAt: event.createdAt,
        actorName: event.actor?.name ?? null,
        actorRole: event.actorRole,
        note: event.note,
      })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Verification (authorized non-teacher roles ONLY)                     */
/* ------------------------------------------------------------------ */

/**
 * Searches by certificate number OR verification code (both exact).
 * Tenant semantics: back-office school roles search within their own
 * school only — a foreign or unknown code returns "not found" without
 * leaking existence. SUPER_ADMIN searches platform-wide (read-only).
 *
 * The response carries the MINIMUM information needed to establish
 * validity: number, title, teacher name, school name, content title,
 * issue date and effective status. No emails, ids, scores, notes or
 * verification codes are ever returned.
 */
export async function verifyCertificate(
  ctx: CertificateActor,
  raw: unknown
): Promise<CertificateResult<VerificationResult>> {
  const guard = verifyGuard(ctx);
  if (guard) return guard;
  // Phase 12 — brute-force friction: certificate NUMBERS carry only
  // ~30 bits of entropy (the 16-char verification code is ~80 bits), so
  // an authenticated insider hammering the search could enumerate valid
  // numbers within their scope. 60 searches / minute per user is far
  // above any legitimate verification workflow.
  const limiter = checkRateLimit("certificate-verify", ctx.id, 60, 60_000);
  if (!limiter.allowed) {
    return certificateFail(
      "عدد كبير من عمليات التحقق — أعد المحاولة بعد قليل",
      "RATE_LIMITED"
    );
  }
  const parsed = verifyCertificateSchema.safeParse(raw);
  if (!parsed.success) return validationFail(parsed.error);

  const rawUpper = parsed.data.query.toUpperCase();
  const normalized = normalizeVerificationQuery(parsed.data.query);

  const scopeFilters: Prisma.CertificateWhereInput[] =
    ctx.role === "SUPER_ADMIN" ? [] : [{ schoolId: ctx.schoolId ?? "__none__" }];

  const row = await db.certificate.findFirst({
    where: {
      AND: [
        ...scopeFilters,
        {
          OR: [
            { verificationCode: rawUpper },
            { certificateNumber: rawUpper },
            { verificationCode: normalized },
            { certificateNumber: normalized },
          ],
        },
      ],
    },
    include: {
      teacher: { select: { name: true } },
      school: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
      program: { select: { nameAr: true } },
    },
  });
  if (!row) return { ok: true, data: { found: false } };

  return {
    ok: true,
    data: {
      found: true,
      certificate: {
        certificateNumber: row.certificateNumber,
        titleAr: row.titleAr,
        teacherName: row.teacher.name,
        schoolName: row.school.nameAr,
        contentTitle: row.course?.titleAr ?? row.program?.nameAr ?? null,
        issuedAt: row.issuedAt,
        effectiveStatus: effectiveStatusOf(row),
        revokedAt: row.status === "REVOKED" ? row.revokedAt : null,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard metrics (manager = school scope, super admin = platform)   */
/* ------------------------------------------------------------------ */

export async function getCertificateMetrics(
  ctx: CertificateActor
): Promise<CertificateResult<CertificateMetrics>> {
  if (
    ctx.role !== "DEVELOPMENT_OFFICE_MANAGER" &&
    ctx.role !== "SUPER_ADMIN"
  ) {
    return certificateFail(
      "إحصاءات الشهادات متاحة لمديري مكاتب التطوير والإدارة العامة فقط",
      "FORBIDDEN"
    );
  }
  const schoolScope = ctx.role === "DEVELOPMENT_OFFICE_MANAGER" ? ctx.schoolId : null;
  if (ctx.role === "DEVELOPMENT_OFFICE_MANAGER" && !schoolScope) {
    return certificateFail("النطاق المدرسي غير محدد", "FORBIDDEN");
  }

  const where: Prisma.CertificateWhereInput = schoolScope ? { schoolId: schoolScope } : {};
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [total, issuedTotal, revoked, expired, issuedLast30Days, holderGroups] =
    await Promise.all([
      db.certificate.count({ where }),
      db.certificate.count({ where: { ...where, status: "ISSUED" } }),
      db.certificate.count({ where: { ...where, status: "REVOKED" } }),
      db.certificate.count({
        where: { ...where, status: "ISSUED", expiresAt: { lt: now } },
      }),
      db.certificate.count({ where: { ...where, issuedAt: { gte: thirtyDaysAgo } } }),
      db.certificate.groupBy({
        by: ["teacherId"],
        where,
      }),
    ]);

  let eligibleAwaiting: number | null = null;
  if (schoolScope) {
    eligibleAwaiting = await countEligibleAwaiting(schoolScope);
  }

  return {
    ok: true,
    data: {
      total,
      active: issuedTotal - expired,
      revoked,
      expired,
      issuedLast30Days,
      teachersWithCertificates: holderGroups.length,
      eligibleAwaiting,
    },
  };
}

/**
 * Counts (teacher, published course) pairs that satisfy the eligibility
 * rules but have no certificate yet — school-scope metric with a clear
 * denominator (published courses of the school + platform-wide, capped).
 */
async function countEligibleAwaiting(schoolId: string): Promise<number> {
  const [teachers, courses] = await Promise.all([
    db.user.findMany({
      where: { schoolId, role: "TEACHER", isActive: true },
      select: { id: true },
    }),
    db.course.findMany({
      where: {
        status: "PUBLISHED",
        OR: [{ schoolId }, { schoolId: null }],
      },
      select: { id: true },
      take: METRICS_COURSES_LIMIT,
    }),
  ]);
  const teacherIds = teachers.map((teacher) => teacher.id);
  if (teacherIds.length === 0 || courses.length === 0) return 0;
  const courseIds = courses.map((course) => course.id);

  const [enrollments, assessments, certificates] = await Promise.all([
    db.courseEnrollment.findMany({
      where: { courseId: { in: courseIds }, userId: { in: teacherIds } },
      select: { courseId: true, userId: true },
    }),
    db.assessment.findMany({
      where: { courseId: { in: courseIds }, status: "PUBLISHED" },
      select: { id: true, courseId: true },
    }),
    db.certificate.findMany({
      where: { schoolId, courseId: { in: courseIds } },
      select: { teacherId: true, courseId: true },
    }),
  ]);
  // The where-clause guarantees a bound course; this is a type
  // refinement only (Assessment.courseId is nullable in the schema).
  const boundAssessments = assessments.filter(
    (assessment): assessment is typeof assessment & { courseId: string } =>
      assessment.courseId !== null
  );
  if (boundAssessments.length === 0) {
    // Vacuous assessment rule: every enrolled (teacher, course) pair
    // without a certificate counts as awaiting issuance.
    const certified = new Set(certificates.map((c) => `${c.teacherId}:${c.courseId}`));
    return enrollments.filter((e) => !certified.has(`${e.userId}:${e.courseId}`)).length;
  }

  const attempts = await db.assessmentAttempt.findMany({
    where: {
      userId: { in: teacherIds },
      assessmentId: { in: boundAssessments.map((assessment) => assessment.id) },
    },
    select: { userId: true, assessmentId: true, passed: true, status: true },
  });

  const assessmentsByCourse = new Map<string, string[]>();
  for (const assessment of boundAssessments) {
    const list = assessmentsByCourse.get(assessment.courseId);
    if (list) list.push(assessment.id);
    else assessmentsByCourse.set(assessment.courseId, [assessment.id]);
  }
  const passedPairs = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.passed === true || attempt.status === "PASSED") {
      passedPairs.add(`${attempt.userId}:${attempt.assessmentId}`);
    }
  }
  const certifiedPairs = new Set(
    certificates.map((certificate) => `${certificate.teacherId}:${certificate.courseId}`)
  );

  let awaiting = 0;
  for (const enrollment of enrollments) {
    const pairKey = `${enrollment.userId}:${enrollment.courseId}`;
    if (certifiedPairs.has(pairKey)) continue;
    const requiredIds = assessmentsByCourse.get(enrollment.courseId) ?? [];
    const allPassed = requiredIds.every((assessmentId) =>
      passedPairs.has(`${enrollment.userId}:${assessmentId}`)
    );
    if (allPassed) awaiting += 1;
  }
  return awaiting;
}
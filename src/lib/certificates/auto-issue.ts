import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";

import {
  CERT_NUMBER_PREFIX,
  CERT_NUMBER_RANDOM_LENGTH,
  CERTIFICATE_CODE_ALPHABET,
  IDENTIFIER_GENERATION_ATTEMPTS,
  PLATFORM_NAME_AR,
} from "@/config/certificates";
import { resolveSchoolSignatory } from "@/lib/certificates/signatory";
import { notifyCertificateIssued } from "@/lib/notifications/hooks";
import { db } from "@/lib/db";

/* ------------------------------------------------------------------ */
/* Batch 1 — automatic course-completion certificate.                  */
/*                                                                     */
/* The original HTML platform issued the certificate the moment the    */
/* teacher passed the course test (submitTest -> showCertificate).     */
/* This module restores that behavior on real data WITHOUT weakening   */
/* any Phase 8 rule:                                                   */
/*                                                                     */
/*   - the learner identity is the SESSION user propagated by the      */
/*     completion engine — never a client payload;                     */
/*   - eligibility is re-verified here from persisted rows (active     */
/*     TEACHER of a school + real enrollment + every published course  */
/*     assessment passed) even though maybeCompleteCourse() has just   */
/*     checked the same rules — defense in depth;                      */
/*   - the school-signatory snapshot (batch 2-b) is honored: no active */
/*     SCHOOL_MANAGER -> NO certificate is fabricated; the completion  */
/*     stands and the certificate can be issued manually later;        */
/*   - identifiers use the same Crockford alphabet, the same MQ-YYYY   */
/*     serial and the same unique-collision retry budget;              */
/*   - the result is linked to the CourseCompletion row so the         */
/*     learning page and notifications can deep-link to the sheet.     */
/* ------------------------------------------------------------------ */

const CERT_TITLE_PREFIX = "شهادة إتمام دورة";
const CERT_DESCRIPTION =
  `أتمّ المعلم متطلبات الدورة التدريبية كاملة (الدروس والتقييمات) وفق ` +
  `سجلات التعلّم في منصة ${PLATFORM_NAME_AR} — إصدار آلي عند استيفاء المتطلبات.`;
/** Issuing-authority snapshot for system-issued certificates. */
const AUTO_ISSUER_LABEL = "إصدار آلي — استيفاء متطلبات الدورة";

export interface CompletionCertificateOutcome {
  /** The issued (or pre-existing) certificate id — null when blocked. */
  certificateId: string | null;
  created: boolean;
  /** Why nothing was issued (null when a certificate exists). */
  blockedReason: string | null;
}

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += CERTIFICATE_CODE_ALPHABET[bytes[index] % CERTIFICATE_CODE_ALPHABET.length];
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

export interface AutoIssueInput {
  teacherId: string;
  courseId: string;
  /** The completion row that triggered this issuance (audit note). */
  completionId: string;
}

/**
 * Issue the completion certificate for a finished course enrollment.
 * NEVER throws for business reasons — a blocked issuance returns a
 * reason so the learning journey continues either way.
 */
export async function issueCourseCompletionCertificate(
  input: AutoIssueInput
): Promise<CompletionCertificateOutcome> {
  try {
    const [teacher, course] = await Promise.all([
      db.user.findUnique({
        where: { id: input.teacherId },
        select: {
          id: true,
          name: true,
          role: true,
          isActive: true,
          schoolId: true,
        },
      }),
      db.course.findUnique({
        where: { id: input.courseId },
        select: {
          id: true,
          titleAr: true,
          titleEn: true,
          status: true,
          schoolId: true,
          assessments: {
            where: { status: "PUBLISHED" },
            select: {
              id: true,
              titleAr: true,
              passingScore: true,
              maxScore: true,
            },
          },
        },
      }),
    ]);

    if (!teacher || !course) {
      return {
        certificateId: null,
        created: false,
        blockedReason: "CONTENT_MISSING",
      };
    }

    // Hard identity rules — exactly the manual issuance rules.
    if (teacher.role !== "TEACHER" || !teacher.isActive || !teacher.schoolId) {
      return {
        certificateId: null,
        created: false,
        blockedReason: "TEACHER_INVALID",
      };
    }

    const [enrollment, attempts] = await Promise.all([
      db.courseEnrollment.findFirst({
        where: { courseId: course.id, userId: teacher.id },
        select: { id: true },
      }),
      db.assessmentAttempt.findMany({
        where: {
          userId: teacher.id,
          assessmentId: {
            in: course.assessments.map((assessment) => assessment.id),
          },
        },
        select: { assessmentId: true, status: true, passed: true, percentage: true },
      }),
    ]);
    if (!enrollment) {
      return {
        certificateId: null,
        created: false,
        blockedReason: "ENROLLMENT_MISSING",
      };
    }
    for (const assessment of course.assessments) {
      const passed = attempts.some(
        (attempt) =>
          attempt.assessmentId === assessment.id &&
          (attempt.status === "PASSED" || attempt.passed === true)
      );
      if (!passed) {
        return {
          certificateId: null,
          created: false,
          blockedReason: "ASSESSMENT_NOT_PASSED",
        };
      }
    }

    // Duplicate (per teacher per course) — return the existing row.
    const existing = await db.certificate.findFirst({
      where: { teacherId: teacher.id, courseId: course.id },
      select: { id: true },
    });
    if (existing) {
      return {
        certificateId: existing.id,
        created: false,
        blockedReason: null,
      };
    }

    // Signatory snapshot — batch 2-b rule, no fallback, no fabrication.
    const signatory = await resolveSchoolSignatory(teacher.schoolId);
    if (!signatory) {
      return {
        certificateId: null,
        created: false,
        blockedReason: "SIGNATORY_MISSING",
      };
    }

    const standings = course.assessments.map((assessment) => {
      const own = attempts.filter(
        (attempt) => attempt.assessmentId === assessment.id
      );
      const passedAttempts = own.filter(
        (attempt) => attempt.status === "PASSED" || attempt.passed === true
      );
      const best = passedAttempts.reduce<number | null>(
        (bestSoFar, attempt) =>
          attempt.percentage !== null &&
          (bestSoFar === null || attempt.percentage > bestSoFar)
            ? attempt.percentage
            : bestSoFar,
        null
      );
      return {
        assessmentId: assessment.id,
        titleAr: assessment.titleAr,
        passingScore: assessment.passingScore,
        maxScore: assessment.maxScore,
        bestPercentage: best,
        passed: true,
      };
    });

    const criteriaSnapshot = JSON.stringify({
      source: "COURSE_COMPLETION",
      completionId: input.completionId,
      content: { type: "COURSE", id: course.id, title: course.titleAr },
      rules: [
        { key: "ENROLLMENT", met: true },
        { key: "LESSONS", met: true },
        { key: "ASSESSMENTS", met: true },
      ],
      assessments: standings,
      generatedAt: new Date().toISOString(),
    });

    const titleAr = `${CERT_TITLE_PREFIX} «${course.titleAr}»`;
    const titleEn = course.titleEn
      ? `Certificate of Completion — ${course.titleEn}`
      : null;
    const now = new Date();

    for (let attempt = 0; attempt < IDENTIFIER_GENERATION_ATTEMPTS; attempt += 1) {
      const certificateNumber = `${CERT_NUMBER_PREFIX}-${now.getFullYear()}-${randomCode(
        CERT_NUMBER_RANDOM_LENGTH
      )}`;
      const verificationCode = randomCode(16);

      const taken = await db.certificate.findFirst({
        where: { OR: [{ certificateNumber }, { verificationCode }] },
        select: { id: true },
      });
      if (taken) continue;

      try {
        const outcome = await db.$transaction(async (tx) => {
          const certificate = await tx.certificate.create({
            data: {
              schoolId: teacher.schoolId as string,
              teacherId: teacher.id,
              certificateNumber,
              verificationCode,
              titleAr,
              titleEn,
              descriptionAr: CERT_DESCRIPTION,
              programId: null,
              courseId: course.id,
              status: "ISSUED",
              issuedAt: now,
              expiresAt: null,
              issuedById: teacher.id,
              issuerRoleLabel: AUTO_ISSUER_LABEL,
              criteriaSnapshotJson: criteriaSnapshot,
              schoolSignatoryName: signatory.name,
              schoolSignatoryTitle: signatory.title,
            },
            select: { id: true },
          });
          await tx.certificateEvent.create({
            data: {
              certificateId: certificate.id,
              type: "ISSUED",
              actorId: teacher.id,
              actorRole: "TEACHER",
              note: `إصدار آلي عند إتمام متطلبات الدورة «${course.titleAr}»`,
            },
          });
          return certificate.id;
        });

        // Reuse the existing Phase 11 hook (preferences + email audit).
        await notifyCertificateIssued({
          teacherId: teacher.id,
          certificateId: outcome,
          titleAr,
        });

        return { certificateId: outcome, created: true, blockedReason: null };
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Either an identifier collision (regenerate) or the
          // (teacherId, courseId) unique — check which.
          const duplicate = await db.certificate.findFirst({
            where: { teacherId: teacher.id, courseId: course.id },
            select: { id: true },
          });
          if (duplicate) {
            return {
              certificateId: duplicate.id,
              created: false,
              blockedReason: null,
            };
          }
          continue;
        }
        throw error;
      }
    }
    return {
      certificateId: null,
      created: false,
      blockedReason: "IDENTIFIER_EXHAUSTED",
    };
  } catch {
    return {
      certificateId: null,
      created: false,
      blockedReason: "UNKNOWN",
    };
  }
}
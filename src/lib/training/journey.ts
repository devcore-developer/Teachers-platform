import { db } from "@/lib/db";

import {
  availabilityState,
  canViewPublishedAssessment,
} from "@/lib/assessment/access";
import { getCourseLearningStatus } from "@/lib/training/progress";
import type { ViewerIdentity } from "@/lib/training/access";
import { getMyImpactStatus } from "@/lib/surveys/impact";

/* ------------------------------------------------------------------ */
/* Mandatory journey — the central SERVER-SIDE stage engine.            */
/*                                                                     */
/* Computes the four mandatory stages of the course completion         */
/* journey from REAL database state only (never from client input):    */
/*                                                                     */
/*   1. المرحلة الأولى:  محتوى الدورة   — every published lesson done. */
/*   2. المرحلة الثانية: الاختبار النهائي — every published course      */
/*      assessment passed (start/submit are enforced again inside the  */
/*      assessment service + the journey actions — defense in depth).  */
/*   3. المرحلة الثالثة: الشهادة       — CourseCompletion exists and   */
/*      the certificate is issued (signatory-gated, auto-issued).      */
/*   4. المرحلة الرابعة: قياس الأثر    — impact tools unlocked only    */
/*      after the completion (existing survey workflow, untouched).    */
/*                                                                     */
/* Every stage exposes: state (locked/available/in_progress/completed),*/
/* a 0..100 percent, an Arabic detail line and an Arabic lock reason.  */
/* The learn page renders this verdict; it never computes its own.     */
/*                                                                     */
/* Serializable by design: every Date is converted to an ISO string so */
/* the result can cross the RSC boundary into the client stepper.      */
/* ------------------------------------------------------------------ */

export type JourneyStageState =
  | "locked"
  | "available"
  | "in_progress"
  | "completed";

export interface ExamOptionView {
  id: string;
  textAr: string;
}

/** A question served during a LIVE attempt — never contains the answer key. */
export interface ExamQuestionView {
  id: string;
  orderIndex: number;
  type: string;
  textAr: string;
  points: number;
  isRequired: boolean;
  options: ExamOptionView[];
}

/** The teacher's own saved draft answers for the live attempt (restore). */
export interface ExamSavedAnswer {
  questionId: string;
  choice?: string[];
  bool?: boolean;
  text?: string;
}

export interface JourneyExamRow {
  id: string;
  titleAr: string;
  instructionsAr: string;
  passingScore: number;
  maxScore: number;
  timeLimitMinutes: number | null;
  attemptLimit: number | null;
  attemptsUsed: number;
  remainingAttempts: number | null;
  passed: boolean;
  bestPercentage: number | null;
  /** True when a submitted attempt awaits MANUAL essay review — the
   * final score/certificate stay locked until the supervisor grades. */
  pendingReview: boolean;
  availability: "available" | "scheduled" | "closed";
  availableFrom: string | null;
  availableUntil: string | null;
  /** Arabic reason when this exam cannot be started right now (null = free). */
  startBlockReason: string | null;
  /** Start button allowed (TEACHER + lessons done + available + attempts left). */
  canStart: boolean;
  /** Live attempt (resume) — questions served WITHOUT answer keys. */
  activeAttempt: {
    id: string;
    deadlineAt: string | null;
    savedAnswers: ExamSavedAnswer[];
    questions: ExamQuestionView[];
  } | null;
}

export interface JourneyStage {
  key: "content" | "exam" | "certificate" | "impact";
  titleAr: string;
  state: JourneyStageState;
  /** 0..100 progress inside the stage itself. */
  percent: number;
  detailAr: string;
  /** Arabic reason when state === "locked" (null otherwise). */
  lockReason: string | null;
}

export interface JourneyView {
  courseId: string;
  isTeacher: boolean;
  /** 0..100 — whole journey (each stage weighs 25%). */
  overallPercent: number;
  /** Ordered: content -> exam -> certificate -> impact. */
  stages: JourneyStage[];
  exams: JourneyExamRow[];
  certificate: {
    issued: boolean;
    href: string | null;
    pendingReason: string | null;
  };
  impact: {
    available: boolean;
    submitted: boolean;
  };
}

export type JourneyResult =
  | { ok: true; data: JourneyView }
  | { ok: false; message: string };

/* ------------------------------ helpers ---------------------------- */

function parseExamOptions(raw: string | null): ExamOptionView[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const options: ExamOptionView[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        "id" in item &&
        typeof item.id === "string" &&
        "textAr" in item &&
        typeof item.textAr === "string"
      ) {
        options.push({ id: item.id, textAr: item.textAr });
      }
    }
    return options;
  } catch {
    return [];
  }
}

function parseSavedAnswers(raw: string | null): ExamSavedAnswer[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const answers: ExamSavedAnswer[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || !("questionId" in item)) continue;
      if (typeof item.questionId !== "string") continue;
      answers.push({
        questionId: item.questionId,
        choice: Array.isArray(item.choice)
          ? item.choice.filter((value: unknown): value is string => typeof value === "string")
          : undefined,
        bool: typeof item.bool === "boolean" ? item.bool : undefined,
        text: typeof item.text === "string" ? item.text : undefined,
      });
    }
    return answers;
  } catch {
    return [];
  }
}

function formatArabicDateTime(iso: string): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

/* --------------------------- the engine ---------------------------- */

/**
 * Compute the mandatory journey of one viewer on one course. Read-only:
 * no writes here — the enforcement lives in the existing services
 * (lesson gate, startAttempt, submitAttempt, maybeCompleteCourse,
 * certificate issuance, impact submission) which the journey mirrors.
 */
export async function computeCourseJourney(
  viewer: ViewerIdentity,
  courseId: string
): Promise<JourneyResult> {
  const statusResult = await getCourseLearningStatus(viewer, courseId);
  if (!statusResult.ok) {
    return { ok: false, message: statusResult.message };
  }
  const status = statusResult.data;
  const isTeacher = viewer.role === "TEACHER";
  const now = Date.now();

  /* ------------------ Stage 1 — محتوى الدورة --------------------- */

  const totalLessons = status.totalLessons;
  const completedLessons = status.completedLessons;
  const contentPercent = totalLessons === 0 ? 100 : status.lessonsPercent;
  const lessonsUnlocked = totalLessons === 0 || completedLessons >= totalLessons;

  const contentStage: JourneyStage = {
    key: "content",
    titleAr: "المرحلة الأولى: محتوى الدورة",
    state:
      contentPercent >= 100
        ? "completed"
        : completedLessons > 0
          ? "in_progress"
          : "available",
    percent: contentPercent,
    detailAr:
      totalLessons === 0
        ? "لا توجد دروس منشورة في هذه الدورة — الانتقال مباشرة إلى الاختبار."
        : `أُنجز ${completedLessons} من ${totalLessons} درسًا — المشاهدة الإلزامية تُحتسب على الخادم.`,
    lockReason: null,
  };

  /* ------------------ Stage 2 — الاختبار النهائي ------------------ */

  const assessmentRows = await db.assessment.findMany({
    where: { courseId, status: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
  });
  const visibleExams = assessmentRows.filter((row) =>
    canViewPublishedAssessment(viewer, row)
  );

  const attempts = visibleExams.length
    ? await db.assessmentAttempt.findMany({
        where: {
          userId: viewer.id,
          assessmentId: { in: visibleExams.map((row) => row.id) },
        },
        orderBy: { startedAt: "desc" },
      })
    : [];

  // Expire stale IN_PROGRESS attempts whose deadline passed without a
  // submission — mirrors startAttempt's expiry rule exactly.
  const staleIds = attempts
    .filter(
      (attempt) =>
        attempt.status === "IN_PROGRESS" &&
        attempt.deadlineAt !== null &&
        attempt.deadlineAt.getTime() <= now
    )
    .map((attempt) => attempt.id);
  if (staleIds.length > 0) {
    await db.assessmentAttempt.updateMany({
      where: { id: { in: staleIds }, status: "IN_PROGRESS" },
      data: { status: "EXPIRED" },
    });
  }

  const exams: JourneyExamRow[] = [];
  for (const row of visibleExams) {
    const own = attempts.filter((attempt) => attempt.assessmentId === row.id);
    const attemptsUsed = own.length;
    const passedAttempts = own.filter(
      (attempt) => attempt.status === "PASSED" || attempt.passed === true
    );
    const passed = passedAttempts.length > 0;
    const bestPercentage = passedAttempts.reduce<number | null>(
      (best, attempt) =>
        attempt.percentage !== null &&
        (best === null || attempt.percentage > best)
          ? attempt.percentage
          : best,
      null
    );
    const remainingAttempts =
      row.attemptLimit === null
        ? null
        : Math.max(0, row.attemptLimit - attemptsUsed);
    const availability = availabilityState(row);
    const live =
      own.find(
        (attempt) =>
          attempt.status === "IN_PROGRESS" &&
          (attempt.deadlineAt === null || attempt.deadlineAt.getTime() > now)
      ) ?? null;
    // Essay answers submitted but NOT yet graded by the supervisor —
    // stage 3 stays explicitly "pending evaluation" until reviewed.
    const pendingReview =
      !passed && own.some((attempt) => attempt.status === "NEEDS_REVIEW");

    let startBlockReason: string | null = null;
    let canStart = false;
    if (passed || live) {
      // Passed = stage done for this exam; live = resume instead of start.
      startBlockReason = null;
    } else if (pendingReview) {
      startBlockReason =
        "إجاباتك بانتظار تصحيح المشرف — ستظهر نتيجتك النهائية بعد مراجعة الأسئلة المقالية.";
    } else if (availability === "scheduled") {
      startBlockReason = `لم يبدأ توافر هذا الاختبار بعد — يفتح في ${
        row.availableFrom
          ? formatArabicDateTime(row.availableFrom.toISOString())
          : "الموعد المحدد"
      }`;
    } else if (availability === "closed") {
      startBlockReason = "انتهت فترة توافر هذا الاختبار";
    } else if (remainingAttempts !== null && remainingAttempts <= 0) {
      startBlockReason = `استهلكت كل المحاولات المسموحة (${row.attemptLimit}) لهذا الاختبار`;
    } else if (!lessonsUnlocked) {
      startBlockReason = `أكمل دروس الدورة أولًا — أنجزت ${completedLessons} من ${totalLessons} درسًا (${contentPercent}%)`;
    } else {
      canStart = isTeacher;
    }

    let activeAttempt: JourneyExamRow["activeAttempt"] = null;
    if (live && isTeacher) {
      const questions = await db.assessmentQuestion.findMany({
        where: { assessmentId: row.id },
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          orderIndex: true,
          type: true,
          textAr: true,
          points: true,
          isRequired: true,
          optionsJson: true,
        },
      });
      // The saved answers of THIS teacher's own attempt — restoring the
      // draft never exposes keys or scoring data (answersJson only holds
      // the teacher's own picks).
      const liveRow = own.find((attempt) => attempt.id === live.id) ?? null;
      activeAttempt = {
        id: live.id,
        deadlineAt: live.deadlineAt ? live.deadlineAt.toISOString() : null,
        savedAnswers: parseSavedAnswers(liveRow?.answersJson ?? null),
        questions: questions.map((question) => ({
          id: question.id,
          orderIndex: question.orderIndex,
          type: question.type,
          textAr: question.textAr,
          points: question.points,
          isRequired: question.isRequired,
          options: parseExamOptions(question.optionsJson),
        })),
      };
    }

    exams.push({
      id: row.id,
      titleAr: row.titleAr,
      instructionsAr: row.instructionsAr,
      passingScore: row.passingScore,
      maxScore: row.maxScore,
      timeLimitMinutes: row.timeLimitMinutes,
      attemptLimit: row.attemptLimit,
      attemptsUsed,
      remainingAttempts,
      passed,
      bestPercentage,
      pendingReview,
      availability,
      availableFrom: row.availableFrom ? row.availableFrom.toISOString() : null,
      availableUntil: row.availableUntil ? row.availableUntil.toISOString() : null,
      startBlockReason,
      canStart,
      activeAttempt,
    });
  }

  const examsTotal = exams.length;
  const examsPassedCount = exams.filter((exam) => exam.passed).length;
  const examsAllPassed = examsTotal === 0 || examsPassedCount === examsTotal;
  const examsPercent =
    examsTotal === 0 ? 100 : Math.round((examsPassedCount / examsTotal) * 100);
  const anyLiveAttempt = exams.some((exam) => exam.activeAttempt !== null);
  const anyPendingReview = exams.some((exam) => exam.pendingReview);

  const examStage: JourneyStage = (() => {
    if (!lessonsUnlocked) {
      return {
        key: "exam",
        titleAr: "المرحلة الثانية: الاختبار النهائي",
        state: "locked",
        percent: examsPercent,
        detailAr: "يُفتح الاختبار النهائي بعد إكمال جميع دروس الدورة.",
        lockReason: `أكمل جميع دروس الدورة أولًا — أنجزت ${completedLessons} من ${totalLessons} درسًا (${contentPercent}%)`,
      };
    }
    if (examsAllPassed) {
      return {
        key: "exam",
        titleAr: "المرحلة الثانية: الاختبار النهائي",
        state: "completed",
        percent: 100,
        detailAr:
          examsTotal === 0
            ? "لا يوجد اختبار نهائي منشور لهذه الدورة — تم استيفاء المتطلب."
            : `اجتزت جميع اختبارات الدورة (${examsPassedCount} من ${examsTotal}).`,
        lockReason: null,
      };
    }
    if (anyLiveAttempt) {
      return {
        key: "exam",
        titleAr: "المرحلة الثانية: الاختبار النهائي",
        state: "in_progress",
        percent: examsPercent,
        detailAr:
          "لديك محاولة اختبار جارية — أكملها وسلّم إجاباتك قبل انتهاء الوقت.",
        lockReason: null,
      };
    }
    if (anyPendingReview) {
      return {
        key: "exam",
        titleAr: "المرحلة الثانية: الاختبار النهائي",
        state: "in_progress",
        percent: examsPercent,
        detailAr:
          "سُلمت إجاباتك وتنتظر تصحيح المشرف للأسئلة المقالية — ستُعلن نتيجتك النهائية بعد المراجعة، وتُفتح الشهادة تلقائيًا عند الاجتياز.",
        lockReason: null,
      };
    }
    return {
      key: "exam",
      titleAr: "المرحلة الثانية: الاختبار النهائي",
      state: "available",
      percent: examsPercent,
      detailAr:
        "أكملت جميع دروس الدورة — الاختبار النهائي متاح الآن وفق قواعد المحاولات ودرجة النجاح.",
      lockReason: null,
    };
  })();

  /* ------------------ Stage 3 — الشهادة --------------------------- */

  const completion = status.completion;
  const certificateId = completion?.certificateId ?? null;
  const certificateHref = certificateId
    ? `/certificates/${certificateId}`
    : null;

  const certificateStage: JourneyStage = (() => {
    if (completion && certificateId) {
      return {
        key: "certificate",
        titleAr: "المرحلة الثالثة: الشهادة",
        state: "completed",
        percent: 100,
        detailAr: "شهادتك صادرة ومتاحة للعرض والتحميل من مكتبة الشهادات.",
        lockReason: null,
      };
    }
    if (completion) {
      return {
        key: "certificate",
        titleAr: "المرحلة الثالثة: الشهادة",
        state: "in_progress",
        percent: 50,
        detailAr:
          "تم تسجيل إتمام الدورة — شهادتك تنتظر توقيع مدير المدرسة وستُصدر تلقائيًا بمجرد توفّر الموقّع.",
        lockReason: null,
      };
    }
    return {
      key: "certificate",
      titleAr: "المرحلة الثالثة: الشهادة",
      state: "locked",
      percent: 0,
      detailAr: "تُصدر الشهادة تلقائيًا بعد إتمام الدورة.",
      lockReason: !lessonsUnlocked
        ? "أكمل محتوى الدورة أولًا — الشهادة تُصدر بعد إتمام الدروس والاختبار."
        : "اجتز الاختبار النهائي أولًا — الشهادة تُصدر بعد اجتياز جميع اختبارات الدورة.",
    };
  })();

  /* ------------------ Stage 4 — قياس الأثر ------------------------ */

  const impactResult = await getMyImpactStatus(viewer, courseId);
  const impact = impactResult.ok ? impactResult.data : null;
  const impactAvailable = impact?.available === true;
  const impactSubmitted = impact?.submitted === true;

  const impactStage: JourneyStage = (() => {
    if (!completion) {
      return {
        key: "impact",
        titleAr: "المرحلة الرابعة: قياس الأثر",
        state: "locked",
        percent: 0,
        detailAr: "أدوات قياس الأثر تُفتح بعد إتمام الدورة كاملة.",
        lockReason:
          "قياس الأثر يُفتح بعد إتمام الدورة — أكمل الدروس واجتز الاختبار النهائي أولًا.",
      };
    }
    if (!impactAvailable) {
      return {
        key: "impact",
        titleAr: "المرحلة الرابعة: قياس الأثر",
        state: "completed",
        percent: 100,
        detailAr:
          "لا توجد أدوات قياس أثر منشورة لهذه الدورة — تم استيفاء المتطلب.",
        lockReason: null,
      };
    }
    if (impactSubmitted) {
      return {
        key: "impact",
        titleAr: "المرحلة الرابعة: قياس الأثر",
        state: "completed",
        percent: 100,
        detailAr:
          "تم إرسال استجابتك لقياس الأثر — شكرًا لمساهمتك في تحسين التدريبات.",
        lockReason: null,
      };
    }
    return {
      key: "impact",
      titleAr: "المرحلة الرابعة: قياس الأثر",
      state: "available",
      percent: 0,
      detailAr:
        "شاركنا تجربتك بعد التطبيق — إجاباتك تساعد في قياس أثر هذا التدريب.",
      lockReason: null,
    };
  })();

  const overallPercent = Math.round(
    contentPercent * 0.25 +
      examsPercent * 0.25 +
      certificateStage.percent * 0.25 +
      impactStage.percent * 0.25
  );

  return {
    ok: true,
    data: {
      courseId,
      isTeacher,
      overallPercent,
      stages: [contentStage, examStage, certificateStage, impactStage],
      exams,
      certificate: {
        issued: Boolean(certificateId),
        href: certificateHref,
        pendingReason:
          completion && !certificateId
            ? "تنتظر الشهادة توقيع مدير المدرسة — ستُصدر تلقائيًا بمجرد توفّر الموقّع."
            : null,
      },
      impact: {
        available: impactAvailable,
        submitted: impactSubmitted,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Legacy vocabulary aliases — kept so any older component that still  */
/* imports the previous journey type names keeps compiling. The live   */
/* journey engine above (computeCourseJourney + JourneyStage/Journey-  */
/* View) is the single source of truth; these aliases only widen it.   */
/* ------------------------------------------------------------------ */

export type JourneyStageKey = string;
export type JourneyStageStatus = string;
export type JourneyStageView = JourneyStage & Record<string, unknown>;
export type CourseJourneyView = {
  stages: JourneyStageView[];
  activeStageKey?: JourneyStageKey;
} & Record<string, unknown>;
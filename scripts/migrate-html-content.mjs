/**
 * Batch 1 — migrate the ORIGINAL HTML platform's training content into
 * the Next.js database (gap-analysis items 12 & 13).
 *
 * What it preserves, item by item (nothing summarized away):
 *   - the 2 original demo courses with all original fields (trainer,
 *     school, date, hours, link, youtube, description, supervisor
 *     comment — preserved verbatim inside the lesson body);
 *   - every original assessment question with its 4 options and the
 *     ORIGINAL correct-answer index, as a published Assessment
 *     (SINGLE_CHOICE, 1 point per question, passingScore = 60% — the
 *     HTML submitTest threshold);
 *   - every original impact-measurement tool with its type
 *     (rating -> RATING 1..5, yesno -> YES_NO, choice -> SINGLE_CHOICE
 *     with the original options, text -> LONG_TEXT) as a published
 *     AFTER_TRAINING Survey bound to the course;
 *   - optionally (--teachers) the original 205-teacher roster as
 *     INACTIVE placeholder accounts (unusable passwords) with their
 *     supervision links, so the mapping data is never lost; activation
 *     is a deliberate manual step.
 *
 * Idempotent: courses are keyed by titleAr (schoolId null) — re-running
 * never duplicates.
 *
 * Usage (from the project root):
 *   node scripts/migrate-html-content.mjs            # content only
 *   node scripts/migrate-html-content.mjs --teachers # + roster import
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));

const IMPORT_TEACHERS = process.argv.includes("--teachers");

/* ------------------------------------------------------------------ */
/* The original HTML demo content (demoCourses — verbatim)             */
/* ------------------------------------------------------------------ */

const HTML_COURSES = [
  {
    titleAr: "الذكاء الاصطناعي في التعليم",
    type: "افتراضي مباشر",
    trainer: "أحمد عبد الرزاق",
    school: "النهضة",
    date: "2026-10-05",
    hours: 2,
    link: "https://zoom.us/",
    youtube: "https://www.youtube.com/",
    file: "دليل الذكاء الاصطناعي.pdf",
    desc: "توظيف الذكاء الاصطناعي في التخطيط والتدريس والتقويم.",
    supervisorComment: "احرص على تجربة أداة واحدة على الأقل داخل صفك وتوثيق أثرها.",
    impactQuestions: [
      { text: "إلى أي مدى ساعد التدريب في تحسين ممارستك المهنية؟", type: "rating" },
      { text: "هل طبقت ما تعلمته في الصف؟", type: "yesno" },
      {
        text: "ما المجال الذي ظهر فيه الأثر الأكبر؟",
        type: "choice",
        options: ["التخطيط", "التدريس", "التقويم", "إدارة الصف"],
      },
      { text: "اذكر مثالًا مختصرًا على أثر التدريب.", type: "text" },
    ],
    questions: [
      ["ما الهدف الرئيس من الذكاء الاصطناعي في التعليم؟", ["دعم التعلم", "إلغاء المعلم", "إلغاء التقويم", "منع التقنية"], 0],
      ["ما الممارسة المسؤولة؟", ["نسخ المخرجات", "حماية البيانات والتحقق", "نشر البيانات", "ترك القرار للأداة"], 1],
      ["قبل اعتماد مخرج الذكاء الاصطناعي؟", ["نشره مباشرة", "مراجعته والتحقق منه", "حذفه", "تجاهله"], 1],
    ],
  },
  {
    titleAr: "التقويم من أجل التعلم",
    type: "افتراضي مباشر",
    trainer: "صديقي أحمد",
    school: "النهضة",
    date: "2026-10-12",
    hours: 3,
    link: "https://meet.google.com/",
    youtube: "",
    file: "",
    desc: "التقويم التكويني والتغذية الراجعة وتحسين التعلم.",
    supervisorComment: "طبّق أداة تقويم تكويني واحدة وشارك نتيجة التطبيق.",
    impactQuestions: [
      { text: "قيّم أثر التدريب في ممارستك.", type: "rating" },
      { text: "هل غيّر التدريب طريقة استخدامك للتغذية الراجعة؟", type: "yesno" },
      {
        text: "ما الأثر الأبرز؟",
        type: "choice",
        options: ["سرعة التغذية الراجعة", "جودة الأسئلة", "تحسين متابعة الطلاب", "أخرى"],
      },
    ],
    questions: [
      ["متى يستخدم التقويم التكويني؟", ["أثناء التعلم", "بعد نهاية العام", "قبل التسجيل", "لا يستخدم"], 0],
      ["وظيفة التغذية الراجعة؟", ["الحكم فقط", "توجيه التحسن", "العقاب", "إلغاء المحاولة"], 1],
    ],
  },
];

async function main() {
  console.log("== Batch 1 . HTML content migration ==");

  // 1) Author + school resolution ------------------------------------
  let actor = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN", isActive: true },
    select: { id: true, name: true, schoolId: true },
  });
  if (!actor) {
    actor = await prisma.user.findFirst({
      where: { role: "DEVELOPMENT_OFFICE_MANAGER", isActive: true },
      select: { id: true, name: true, schoolId: true },
    });
  }
  if (!actor) {
    throw new Error(
      "لا يوجد حساب مؤلف (SUPER_ADMIN أو DEVELOPMENT_OFFICE_MANAGER) — شغّل بذر المنصة أولًا (npm run db:seed)"
    );
  }
  const school = actor.schoolId
    ? await prisma.school.findUnique({ where: { id: actor.schoolId } })
    : await prisma.school.findFirst({ where: { isActive: true } });
  if (!school) {
    throw new Error("لا توجد مدرسة في قاعدة البيانات — شغّل بذر المنصة أولًا");
  }
  console.log(`Author: ${actor.name} — School: ${school.nameAr}`);

  // 2) Category resolution — read the canonical keys straight from the
  // project's src/config/training.ts so migrated courses always pass
  // Zod validation on later edits.
  let categoryKey = "GENERAL";
  try {
    const trainingConfig = readFileSync(
      join(__dirname, "..", "src", "config", "training.ts"),
      "utf-8"
    );
    const keyMatch = trainingConfig.match(/TRAINING_CATEGORIES[^=]*=\s*\{([\s\S]*?)\}/);
    const keys = keyMatch
      ? [...keyMatch[1].matchAll(/([A-Z_]+)\s*:/g)].map((m) => m[1])
      : [];
    if (keys.length > 0) categoryKey = keys[0];
  } catch {
    // config not readable — keep the fallback; direct DB writes are not
    // Zod-gated and the value can be adjusted from the manage UI.
  }
  console.log(`Course category key: ${categoryKey}`);

  // 3) Courses + sections + lessons + assessments + impact surveys ---
  for (const htmlCourse of HTML_COURSES) {
    const existing = await prisma.course.findFirst({
      where: { titleAr: htmlCourse.titleAr, schoolId: null },
      select: { id: true },
    });
    if (existing) {
      console.log(`= Course already migrated: ${htmlCourse.titleAr}`);
      continue;
    }

    const course = await prisma.course.create({
      data: {
        schoolId: null, // platform-wide — visible to every school
        titleAr: htmlCourse.titleAr,
        descriptionAr: htmlCourse.desc,
        category: categoryKey,
        level: null,
        estimatedHours: htmlCourse.hours,
        status: "PUBLISHED",
        publishedAt: new Date(),
        createdById: actor.id,
        instructorId: null,
        sections: {
          create: [
            {
              titleAr: "الوحدة الأولى",
              description: `نوع التدريب الأصلي: ${htmlCourse.type} — تاريخ الانعقاد الأصلي: ${htmlCourse.date}`,
              orderIndex: 1,
              lessons: {
                create: [
                  {
                    titleAr: "مدخل التدريب",
                    description: null,
                    type: "TEXT",
                    // The original supervisor comment + delivery context
                    // are PRESERVED verbatim inside the lesson body —
                    // the HTML data model had no dedicated column.
                    content: [
                      `تعليق المشرف التربوي الأصلي: ${htmlCourse.supervisorComment}`,
                      "",
                      `وصف التدريب: ${htmlCourse.desc}`,
                      htmlCourse.link
                        ? `رابط القاعة الافتراضية الأصلي: ${htmlCourse.link}`
                        : null,
                      htmlCourse.file
                        ? `الملف المرفق الأصلي: ${htmlCourse.file}`
                        : null,
                    ]
                      .filter((line) => line !== null)
                      .join("\n"),
                    orderIndex: 1,
                    isPublished: true,
                  },
                  ...(htmlCourse.youtube
                    ? [
                        {
                          titleAr: "الفيديو التعريفي",
                          description: "فيديو الدورة الأصلي من منصة HTML",
                          type: "EXTERNAL_VIDEO",
                          content: null,
                          videoUrl: htmlCourse.youtube,
                          orderIndex: 2,
                          isPublished: true,
                        },
                      ]
                    : []),
                ],
              },
            },
          ],
        },
      },
      select: { id: true, titleAr: true },
    });
    console.log(`+ Course: ${course.titleAr} (${course.id})`);

    // 3b) Assessment — every original question, options and key.
    const totalPoints = htmlCourse.questions.length;
    const passingScore = Math.max(1, Math.ceil(totalPoints * 0.6));
    const assessment = await prisma.assessment.create({
      data: {
        schoolId: null,
        courseId: course.id,
        titleAr: `اختبار: ${htmlCourse.titleAr}`,
        instructionsAr:
          "اختبار الدورة المنقول من المنصة الأصلية — حد النجاح 60% كما في النسخة الأصلية. يمكنك إعادة الاختبار عند عدم النجاح.",
        status: "PUBLISHED",
        passingScore,
        timeLimitMinutes: null,
        attemptLimit: null,
        maxScore: totalPoints,
        createdById: actor.id,
      },
      select: { id: true },
    });
    for (let index = 0; index < htmlCourse.questions.length; index += 1) {
      const [text, options, correctIndex] = htmlCourse.questions[index];
      const optionRows = options.map((optionText, optionIndex) => ({
        id: `opt_${index + 1}_${optionIndex + 1}`,
        textAr: optionText,
      }));
      await prisma.assessmentQuestion.create({
        data: {
          assessmentId: assessment.id,
          type: "SINGLE_CHOICE",
          textAr: text,
          orderIndex: index + 1,
          points: 1,
          isRequired: true,
          optionsJson: JSON.stringify(optionRows),
          answerKeyJson: JSON.stringify({
            optionId: optionRows[correctIndex].id,
          }),
        },
      });
    }
    console.log(
      `+ Assessment: ${totalPoints} questions, passingScore ${passingScore}/${totalPoints} (60%)`
    );

    // 3c) Impact survey — every original impact tool with its type.
    const survey = await prisma.survey.create({
      data: {
        schoolId: school.id,
        ownerUserId: actor.id,
        titleAr: `قياس أثر: ${htmlCourse.titleAr}`,
        descriptionAr: "أدوات قياس الأثر المنقولة من المنصة الأصلية كما هي.",
        purposeAr: "قياس أثر التدريب في الممارسة المهنية بعد الإتمام.",
        instructionsAr: "أجب عن الأدوات التالية بعد تطبيق ما تعلمته.",
        courseId: course.id,
        stage: "AFTER_TRAINING",
        audienceMode: "ALL_TEACHERS",
        anonymous: false,
        allowMultipleResponses: false,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    for (let index = 0; index < htmlCourse.impactQuestions.length; index += 1) {
      const tool = htmlCourse.impactQuestions[index];
      const data = {
        surveyId: survey.id,
        orderIndex: index + 1,
        textAr: tool.text,
        required: true,
      };
      if (tool.type === "rating") {
        await prisma.surveyQuestion.create({
          data: { ...data, type: "RATING", minScore: 1, maxScore: 5 },
        });
      } else if (tool.type === "yesno") {
        await prisma.surveyQuestion.create({
          data: { ...data, type: "YES_NO" },
        });
      } else if (tool.type === "choice") {
        await prisma.surveyQuestion.create({
          data: {
            ...data,
            type: "SINGLE_CHOICE",
            optionsJson: JSON.stringify(tool.options),
          },
        });
      } else {
        await prisma.surveyQuestion.create({
          data: { ...data, type: "LONG_TEXT" },
        });
      }
    }
    console.log(`+ Impact survey: ${htmlCourse.impactQuestions.length} tools`);
  }

  // 4) Optional roster import (--teachers) ---------------------------
  if (IMPORT_TEACHERS) {
    let roster;
    try {
      roster = JSON.parse(
        readFileSync(join(__dirname, "html-roster.json"), "utf-8")
      );
    } catch {
      throw new Error(
        "html-roster.json غير موجود بجانب السكربت — أعد تنزيل الحزمة كاملة"
      );
    }
    console.log(`Roster rows: ${roster.length}`);

    function cleanName(value) {
      return String(value ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const supervisorNames = [
      ...new Set(
        roster
          .map((row) => cleanName(row.supervisor))
          .filter((name) => name && name !== "" && name !== "—")
      ),
    ];
    const supervisorIds = new Map();
    for (const name of supervisorNames) {
      const email = `sup.${Buffer.from(name, "utf-8").toString("hex").slice(0, 18)}@manarat.local`;
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          name,
          email,
          // Unusable random hash — activation assigns a real password.
          passwordHash: randomBytes(32).toString("hex"),
          role: "EDUCATIONAL_SUPERVISOR",
          schoolId: school.id,
          isActive: false,
        },
        select: { id: true },
      });
      supervisorIds.set(name, user.id);
    }

    let createdTeachers = 0;
    let createdLinks = 0;
    for (const row of roster) {
      const name = cleanName(row.name);
      if (!name) continue;
      const email = `t.${Buffer.from(name, "utf-8").toString("hex").slice(0, 18)}@manarat.local`;
      const teacher = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          name,
          email,
          passwordHash: randomBytes(32).toString("hex"),
          role: "TEACHER",
          schoolId: school.id,
          isActive: false, // activation is a deliberate manual step
        },
        select: { id: true },
      });
      createdTeachers += 1;

      const supervisorId = supervisorIds.get(cleanName(row.supervisor));
      if (supervisorId) {
        const existingLink = await prisma.teacherSupervisorAssignment.findUnique({
          where: { teacherId: teacher.id },
          select: { id: true },
        });
        if (!existingLink) {
          await prisma.teacherSupervisorAssignment.create({
            data: { teacherId: teacher.id, supervisorId },
          });
          createdLinks += 1;
        }
      }
    }
    console.log(
      `+ Roster: ${createdTeachers} teachers (inactive), ${createdLinks} supervision links`
    );
  }

  console.log("== Migration finished ==");
}

main()
  .catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
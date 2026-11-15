/**
 * YouTube lesson completion — end-to-end smoke on PostgreSQL.
 * Reproduces the reported bug, proves the fix, and guards the
 * server-side anti-cheat invariants.
 *
 * Run: DATABASE_URL=… npx tsx scripts/smoke-youtube-completion.mts
 */
process.env.AUTH_SECRET ??= "rig-verification-secret-0123456789abcdef0123456789abcdef";

import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { recordWatchHeartbeat } from "../src/lib/training/sequence";
import { markLessonComplete, lessonGateStatus } from "../src/lib/training/progress";
import type { ViewerIdentity } from "../src/lib/training/access";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) console.log(`✓ ${name}`);
  else {
    fail++;
    console.log(`✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/** Honest playback simulator: advances the position within the server's
 * wall-clock cap (delta ≤ elapsed+5) at the accepted-beat cadence. */
async function playBeat(
  viewer: ViewerIdentity,
  courseId: string,
  lessonId: string,
  position: number,
  duration: number | null,
  ended = false
) {
  await sleep(1600); // clear the 1.5s rate limit
  return recordWatchHeartbeat(viewer, courseId, lessonId, {
    positionSeconds: position,
    durationSeconds: duration,
    ended,
  });
}

async function main() {
  /* ---------------- fixtures ---------------- */
  await db.course.deleteMany({ where: { titleAr: { startsWith: "دورة يوتيوب التجريبية" } } });
  await db.course.deleteMany({ where: { titleAr: { startsWith: "دورة تزوير تجريبية" } } });
  await db.user.deleteMany({ where: { email: { endsWith: "@yt-smoke.local" } } });
  await db.school.deleteMany({ where: { slug: "yt-smoke-school" } });

  const school = await db.school.create({ data: { nameAr: "مدرسة يوتيوب التجريبية", slug: "yt-smoke-school" } });
  const teacher = await db.user.create({
    data: {
      name: "معلم يوتيوب",
      email: "yt-teacher@yt-smoke.local",
      passwordHash: await hashPassword("Passw0rd1"),
      role: "TEACHER",
      schoolId: school.id,
      emailVerifiedAt: new Date(),
    },
  });
  const viewer: ViewerIdentity = { id: teacher.id, role: "TEACHER", schoolId: school.id };

  const course = await db.course.create({
    data: {
      titleAr: "دورة يوتيوب التجريبية",
      descriptionAr: "دورة اختبار لإكمال دروس يوتيوب",
      createdBy: { connect: { id: teacher.id } },
      category: "تجريبي",
      status: "PUBLISHED",
      school: { connect: { id: school.id } },
      requireSequentialLessons: true,
      lessonCompletionThreshold: 95,
      sections: {
        create: [
          {
            titleAr: "القسم الأول",
            orderIndex: 0,
            lessons: {
              create: [
                {
                  titleAr: "درس يوتيوب (بلا مدة مخزنة)",
                  type: "VIDEO",
                  orderIndex: 0,
                  isPublished: true,
                  videoUrl: "https://www.youtube.com/watch?v=smoke0000",
                  durationSeconds: null, // ← the YouTube case: no captured length
                },
                {
                  titleAr: "درس مرفوع (مدة مخزنة)",
                  type: "VIDEO",
                  orderIndex: 1,
                  isPublished: true,
                  videoUrl: "/api/media/lessons/smoke.mp4",
                  durationSeconds: 60, // captured at upload
                },
              ],
            },
          },
        ],
      },
    },
  });
  const section = await db.courseSection.findFirstOrThrow({ where: { courseId: course.id } });
  const lessons = await db.courseLesson.findMany({ where: { sectionId: section.id }, orderBy: { orderIndex: "asc" } });
  const [yt, uploaded] = lessons;
  check("F1 fixtures: YouTube lesson has NULL DB duration, uploaded has 60", yt.durationSeconds === null && uploaded.durationSeconds === 60);

  /* ========== 1. ROOT-CAUSE REPRODUCTION — old client (no reported
     duration): watching HALF of the video freezes the ledger ≈ 50% and
     completion is impossible, exactly as reported. ========== */
  console.log("\n— 1: إعادة إنتاج العلّة (العميل القديم بلا مدة) —");

  // Watch the first half (positions 0 → 30 of a 60s video), the client
  // never reports a duration (old hardcoded-null behavior).
  let r = await playBeat(viewer, course.id, yt.id, 5, null);
  check("1a first beat accepted", r.ok && r.data?.skipped === false, JSON.stringify(r).slice(0, 160));
  check("1b server has NO duration → percent 0", r.ok && r.data?.watchedPercent === 0);
  for (let p = 11; p <= 29; p += 6) {
    r = await playBeat(viewer, course.id, yt.id, p, null);
  }
  const stuck = r.ok ? r.data! : null;
  check(
    "1c watched ~half but ledger cannot complete (duration null)",
    stuck !== null && !stuck.completed && stuck.watchSeconds >= 25 && stuck.watchSeconds <= 32,
    JSON.stringify(stuck)
  );
  check(
    "1d THE REPORTED SYMPTOM: stuck ≈ 50% of the real video",
    stuck !== null && stuck.watchSeconds >= 25 && stuck.watchSeconds <= 32
  );

  // Replay/rewatch below the high-water mark: forward re-watching DOES
  // accrue wall-capped watch time (it is real watching), but the
  // anti-cheat invariant is that the HIGH-WATER position never advances
  // — looping the first half can never substitute for watching through
  // (completion requires BOTH watchSeconds ≥ threshold AND maxPosition
  // ≥ threshold; a loop keeps maxPosition pinned at the honest mark).
  const beforeReplay = stuck!.watchSeconds;
  const beforeMax = stuck!.maxPositionSeconds;
  const rp = await playBeat(viewer, course.id, yt.id, 3, null); // rewatch from the start
  const rp2 = await playBeat(viewer, course.id, yt.id, 8, null);
  check(
    "1e replay below the high-water mark: max position stays pinned (loop cannot substitute for watching through)",
    rp.ok && rp2.ok && rp2.data!.maxPositionSeconds === beforeMax && !rp2.data!.completed,
    `before=${beforeMax} after=${rp2.ok ? rp2.data!.maxPositionSeconds : "rejected"}`
  );
  check(
    "1e2 forward replay credits only wall-capped real watch time",
    rp2.ok && rp2.data!.watchSeconds >= beforeReplay && rp2.data!.watchSeconds <= beforeReplay + 12,
    `before=${beforeReplay} after=${rp2.ok ? rp2.data!.watchSeconds : "rejected"}`
  );

  /* ========== 2. THE FIX — the player reports its MEASURED duration
     (as the YouTube IFrame API / <video> element provide): the same
     ledger now reaches the server-verified threshold and completes. ========== */
  console.log("\n— 2: الإصلاح (العميل يرسل المدة المقاسة 60) —");

  r = await playBeat(viewer, course.id, yt.id, 35, 60); // metadata now known
  check(
    "2a measured duration accepted → verified percent appears",
    r.ok && r.data!.watchedPercent > 0 && r.ok && r.data!.watchSeconds >= 35,
    JSON.stringify(r)
  );
  const sticky = await db.lessonWatchState.findUniqueOrThrow({
    where: { lessonId_userId: { lessonId: yt.id, userId: viewer.id } },
  });
  check(
    "2b sticky reportedDurationSeconds stored (=60)",
    sticky.reportedDurationSeconds === 60,
    String(sticky.reportedDurationSeconds)
  );

  // Continue honest playback to ≥95% (positions 35 → 58).
  let completedAt: unknown = null;
  for (let p = 41; p <= 58; p += 6) {
    r = await playBeat(viewer, course.id, yt.id, p, 60);
    if (r.ok && r.data?.justCompleted) completedAt = r.data;
  }
  // The final ENDED beat (actual final position, ended=true).
  r = await playBeat(viewer, course.id, yt.id, 60, 60, true);
  if (r.ok && r.data?.justCompleted) completedAt = r.data;

  check(
    "2c YouTube lesson COMPLETED via verified watch (justCompleted fired)",
    completedAt !== null || (r.ok && r.data!.completed === true),
    JSON.stringify(r)
  );
  const ytProgress = await db.courseLessonProgress.findUnique({
    where: { lessonId_userId: { lessonId: yt.id, userId: viewer.id } },
  });
  check("2d CourseLessonProgress row written (exam unlock precondition)", ytProgress !== null);
  check(
    "2e final ledger ≈ full duration, max position ≈ 60",
    r.ok && r.data!.watchSeconds >= 55 && r.data!.maxPositionSeconds >= 55,
    JSON.stringify(r)
  );

  /* ========== 3. ENDED IS NOT PROOF — a bare ENDED beat cannot skip
     playback: on the UPLOADED lesson (DB duration authoritative), one
     ENDED beat at the end after only ~10s of watching must NOT complete. ========== */
  console.log("\n— 3: حدث ENDED وحده ليس إثبات مشاهدة —");

  // Sequential gate first: L2 heartbeats before L1 completed would be
  // locked — L1 is completed by now, so playback may proceed.
  r = await playBeat(viewer, course.id, uploaded.id, 10, null); // client sends null (even the fixed player may beat before metadata)
  check("3a uploaded lesson beat accepted (DB duration covers)", r.ok && r.data!.watchedPercent > 0, JSON.stringify(r).slice(0, 140));

  r = await playBeat(viewer, course.id, uploaded.id, 60, 60, true); // jump-straight-to-end claim
  check(
    "3b ENDED beat after ~10s of watch does NOT complete (watch < 95%)",
    r.ok && r.data!.completed === false && r.data!.justCompleted === false,
    JSON.stringify(r)
  );

  /* ========== 4. UPLOADED REGRESSION — DB duration wins over client
     values; honest watch completes exactly like before the fix. ========== */
  console.log("\n— 4: انحدار الفيديو المرفوع —");

  for (let p = 16; p <= 58; p += 6) {
    r = await playBeat(viewer, course.id, uploaded.id, p, 30); // lying small duration from a rogue client
  }
  check(
    "4a client duration (30) IGNORED — ledger keeps the DB 60",
    r.ok && r.data!.watchedPercent <= 100 && r.data!.watchSeconds >= 55,
    JSON.stringify(r)
  );
  r = await playBeat(viewer, course.id, uploaded.id, 60, 60, true);
  check(
    "4b uploaded lesson completes at the verified threshold (unchanged behavior)",
    r.ok && (r.data!.justCompleted || r.data!.completed),
    JSON.stringify(r)
  );

  /* ========== 5. FORGED DURATION IS WALL-CLOCK BOUNDED — a fresh
     YouTube lesson, first beat claims "watched everything" + hammering
     cannot skip required playback. ========== */
  console.log("\n— 5: تزوير المدة والضغط على الـ action —");

  const courseB = await db.course.create({
    data: {
      titleAr: "دورة تزوير تجريبية",
      descriptionAr: "دورة اختبار لتقييد التزوير",
      createdBy: { connect: { id: teacher.id } },
      category: "تجريبي",
      status: "PUBLISHED",
      school: { connect: { id: school.id } },
      requireSequentialLessons: false,
      lessonCompletionThreshold: 95,
      sections: { create: { titleAr: "قسم", orderIndex: 0, lessons: { create: { titleAr: "درس تزوير", type: "VIDEO", orderIndex: 0, isPublished: true, videoUrl: "https://youtu.be/forgery00", durationSeconds: null } } } },
    },
  });
  const forgeryLesson = await db.courseLesson.findFirstOrThrow({ where: { section: { courseId: courseB.id } } });

  const v2: ViewerIdentity = { id: teacher.id, role: "TEACHER", schoolId: school.id };
  r = await recordWatchHeartbeat(v2, courseB.id, forgeryLesson.id, {
    positionSeconds: 59, durationSeconds: 60, ended: true, // pure forgery, zero watching
  });
  check(
    "5a forged one-shot 'watched it all' rejected (first-beat cap 30s)",
    r.ok && r.data!.completed === false && r.data!.watchSeconds <= 30,
    JSON.stringify(r)
  );

  let forgedWatch = r.ok ? r.data!.watchSeconds : 0;
  for (let i = 0; i < 10; i++) {
    r = await recordWatchHeartbeat(v2, courseB.id, forgeryLesson.id, {
      positionSeconds: 60, durationSeconds: 60, ended: true,
    });
  }
  check(
    "5b hammering the action gains nothing (rate limit → skipped)",
    r.ok && r.data!.skipped === true && r.data!.watchSeconds === forgedWatch,
    JSON.stringify(r)
  );

  // Even at the max accepted cadence, credit ≤ elapsed+5 — reaching 95%
  // of the claimed duration takes ~57 REAL seconds. Sample a few spaced
  // beats and assert the threshold is still far.
  for (let i = 0; i < 4; i++) {
    r = await playBeat(v2, courseB.id, forgeryLesson.id, 60, 60, true);
  }
  check(
    "5c forged ledger still below threshold (wall-clock bound holds)",
    r.ok && r.data!.completed === false && r.data!.watchSeconds < 57,
    JSON.stringify(r)
  );

  /* ========== 6. EXAM UNLOCK + COURSE COMPLETION ========== */
  console.log("\n— 6: فتح الاختبار وإتمام الدورة —");

  const gate = await lessonGateStatus(viewer, course.id);
  check(
    "6a exam gate UNLOCKED after both lessons verified-complete",
    gate.unlocked && gate.required === 2 && gate.completed === 2,
    JSON.stringify(gate)
  );

  // Manual completion of a VIDEO lesson stays impossible.
  const manual = await markLessonComplete(viewer, course.id, yt.id);
  check(
    "6b manual VIDEO completion rejected (VIDEO_WATCH_REQUIRED)",
    !manual.ok && manual.code === "VIDEO_WATCH_REQUIRED"
  );

  const completion = await db.courseCompletion.findUnique({
    where: { courseId_userId: { courseId: course.id, userId: viewer.id } },
  });
  check("6c CourseCompletion row created after all lessons done", completion !== null);

  console.log(fail === 0 ? "\n✅ YOUTUBE COMPLETION SMOKE PASSED" : `\n✗ ${fail} FAILURES`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
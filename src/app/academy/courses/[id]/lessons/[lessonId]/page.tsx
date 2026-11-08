import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Video,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { requireUser } from "@/lib/auth/session";
import { getLessonForViewer } from "@/lib/training/service";

export const metadata = {
  title: "درس تدريبي",
};

const LESSON_TYPE_LABELS: Record<string, string> = {
  TEXT: "نص",
  VIDEO: "فيديو",
  EXTERNAL_VIDEO: "فيديو خارجي",
  RESOURCE: "مصدر تعلّم",
};

const LESSON_ICONS: Record<string, LucideIcon> = {
  TEXT: FileText,
  VIDEO: Video,
  EXTERNAL_VIDEO: Link2,
  RESOURCE: Download,
};

/**
 * Resolve an allow-listed external video URL into a privacy-friendly
 * embed URL. Returns null when the URL cannot be safely embedded —
 * the UI then renders a plain external link instead (no server fetch).
 */
function embedUrlFor(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === "youtube.com" || host === "www.youtube.com") {
      const id = url.searchParams.get("v");
      return id
        ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`
        : null;
    }
    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      return id
        ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`
        : null;
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^\d+$/.test(id)
        ? `https://player.vimeo.com/video/${id}`
        : null;
    }
    return null;
  } catch {
    return null;
  }
}

function navHref(courseId: string, lessonId: string | null): string | null {
  return lessonId ? `/academy/courses/${courseId}/lessons/${lessonId}` : null;
}

/**
 * Lesson player: uploaded videos are stored in lesson.videoUrl as an
 * /api/media/… proxy path (NOT in attachmentId). For teachers, VIDEO
 * lessons redirect to the learning hub — the only surface wired to the
 * mandatory player and the server heartbeat ledger that credits
 * completion. External videos render as allow-listed embeds, text
 * renders safely as plain text, and resources download through the
 * access-checked files route.
 */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>;
}) {
  const { id, lessonId } = await params;
  const user = await requireUser();
  const viewer = { id: user.id, role: user.role, schoolId: user.schoolId };

  const result = await getLessonForViewer(viewer, id, lessonId);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    redirect("/forbidden");
  }
  const { course, lesson, outline, prevLessonId, nextLessonId, sectionTitle } =
    result.data;

  // Mandatory learning enforcement: teachers never watch uploaded
  // videos through a bare <video> tag here — that would bypass the
  // server heartbeat ledger, so the watch would never count toward
  // completion and the sequential gate would stay closed. The learning
  // hub renders the governed player instead. Lessons without a saved
  // video fall through to an explanatory notice below.
  if (lesson.type === "VIDEO" && user.role === "TEACHER" && lesson.videoUrl) {
    redirect(`/academy/learn/${course.id}`);
  }

  const prevHref = navHref(course.id, prevLessonId);
  const nextHref = navHref(course.id, nextLessonId);

  return (
    <div>
      <PageHeader
        title={lesson.titleAr}
        description={lesson.description ?? undefined}
        breadcrumbs={[
          { label: "الأكاديمية التدريبية", href: "/academy" },
          { label: course.titleAr, href: `/academy/courses/${course.id}` },
          { label: sectionTitle },
        ]}
      />

      <div className="space-y-6">
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
              {LESSON_TYPE_LABELS[lesson.type] ?? lesson.type}
            </span>
            <span className="text-[11px] font-semibold text-muted-foreground">
              {sectionTitle}
            </span>
          </div>

          <div className="p-4 sm:p-6">
            {lesson.type === "VIDEO" &&
              (lesson.videoUrl ? (
                /* Reaches teachers only when redirecting is impossible
                   (no video saved); staff preview plays freely. */
                <video
                  controls
                  preload="metadata"
                  playsInline
                  src={lesson.videoUrl}
                  className="w-full rounded-lg bg-black"
                >
                  متصفحك لا يدعم تشغيل الفيديو.
                </video>
              ) : (
                <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-800">
                  لا يوجد فيديو محفوظ لهذا الدرس — غالبًا لأن الرفع فشل وقت
                  إنشائه. أعد رفع الفيديو من صفحة إدارة الدورة ثم أعد فتح هذه
                  الصفحة.
                </div>
              ))}

            {lesson.type === "EXTERNAL_VIDEO" && lesson.videoUrl && (
              <>
                {embedUrlFor(lesson.videoUrl) ? (
                  <div className="aspect-video w-full overflow-hidden rounded-lg border bg-black">
                    <iframe
                      src={embedUrlFor(lesson.videoUrl) ?? undefined}
                      title={lesson.titleAr}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                      className="size-full"
                    />
                  </div>
                ) : (
                  <a
                    href={lesson.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-50"
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                    فتح الفيديو الخارجي في نافذة جديدة
                  </a>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  الفيديو مستضاف خارجيًا على منصة مسموح بها (YouTube/Vimeo).
                </p>
              </>
            )}

            {lesson.type === "RESOURCE" && lesson.attachmentId && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed bg-muted/30 px-4 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    {lesson.attachmentName ?? "مرفق الدرس"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    ملف قابل للتنزيل — يُقدَّم عبر مسار مصادق عليه يتحقق من
                    صلاحيتك.
                  </p>
                </div>
                <a
                  href={`/api/files/${lesson.attachmentId}`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-700"
                >
                  <Download className="size-4" aria-hidden="true" />
                  تنزيل الملف
                </a>
              </div>
            )}

            {lesson.type === "TEXT" && lesson.content && (
              <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                {lesson.content}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          {prevHref ? (
            <Link
              href={prevHref}
              className="inline-flex items-center gap-1 rounded-lg border bg-card px-3.5 py-2 text-xs font-bold transition-colors hover:bg-accent"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
              الدرس السابق
            </Link>
          ) : (
            <span />
          )}
          {nextHref ? (
            <Link
              href={nextHref}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-700"
            >
              الدرس التالي
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <Link
              href={`/academy/courses/${course.id}`}
              className="inline-flex items-center gap-1 rounded-lg border bg-card px-3.5 py-2 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-50"
            >
              العودة إلى الدورة
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
          )}
        </div>

        <SectionCard
          title="خطة الدورة"
          description="جميع الدروس المنشورة — موقعك الحالي مميّز."
        >
          <div className="space-y-3">
            {outline.map((section, sectionIndex) =>
              section.lessons.length === 0 ? null : (
                <div key={section.id}>
                  <p className="mb-1 flex items-center gap-2 text-xs font-bold text-muted-foreground">
                    <span className="flex size-5 items-center justify-center rounded bg-brand-100 text-[10px] font-extrabold text-brand-700">
                      {sectionIndex + 1}
                    </span>
                    {section.titleAr}
                  </p>
                  <ul className="space-y-0.5 ps-6">
                    {section.lessons.map((item) => {
                      const Icon = LESSON_ICONS[item.type] ?? FileText;
                      const isCurrent = item.id === lesson.id;
                      return (
                        <li key={item.id}>
                          <Link
                            href={`/academy/courses/${course.id}/lessons/${item.id}`}
                            aria-current={isCurrent ? "page" : undefined}
                            className={
                              isCurrent
                                ? "flex items-center gap-2 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-bold text-brand-700"
                                : "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent"
                            }
                          >
                            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{item.titleAr}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
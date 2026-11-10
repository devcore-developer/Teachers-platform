/**
 * EmbeddedVideoFrame — the shared embeddable-video frame.
 *
 * Renders YouTube (privacy-friendly youtube-nocookie host) and Vimeo
 * links INSIDE the platform page — no redirect to the provider, no
 * download, and the URL never touches Cloudflare R2. Non-embeddable
 * URLs render nothing here (callers keep their own <video> paths).
 *
 * Server-safe: no hooks, no browser APIs. It is imported by the lesson
 * page (server) and by client components (learning checklist, media
 * preview) — both are fine since it carries no server-only imports.
 */
import { parseEmbeddableVideoUrl } from "@/lib/media/video-url";

export function EmbeddedVideoFrame({
  src,
  title,
  className,
}: {
  src: string;
  title: string;
  className?: string;
}) {
  const parsed = parseEmbeddableVideoUrl(src);
  if (!parsed) return null;

  return (
    <div
      className={
        className ??
        "aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-black"
      }
    >
      <iframe
        src={parsed.embedUrl}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="size-full"
      />
    </div>
  );
}

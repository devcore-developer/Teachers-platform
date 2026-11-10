/**
 * Media URL intelligence — shared by the course builder preview, the
 * lesson player, the learning hub and the media proxy checks.
 *
 * Responsibility: classify a saved media URL into a provider and, for
 * embeddable providers (YouTube/Vimeo), extract the canonical video id
 * and the embed URL. Pure functions only — no network, no DB, safe to
 * import from client and server components alike.
 *
 * Security: URL parsing is strict (URL constructor), ids are validated
 * against tight character sets, and the returned embed URLs are always
 * built from validated parts — never by echoing user text back.
 */

/* ------------------------------------------------------------------ */
/* Public shape                                                        */
/* ------------------------------------------------------------------ */

export interface ParsedEmbed {
  provider: "youtube" | "vimeo";
  /** Validated provider video id (safe charset only). */
  videoId: string;
  /** Start offset in seconds when the URL carries a timestamp (t= / start=). */
  startSeconds: number | null;
  /** Ready-to-iframe embed URL (privacy-friendly youtube-nocookie host). */
  embedUrl: string;
}

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

/**
 * Canonical YouTube id: exactly 11 chars of [A-Za-z0-9_-]. Everything
 * else is rejected before it can ever reach an iframe or the player API.
 */
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function parseStartSeconds(url: URL): number {
  // Both ?t=30s / ?t=1m10s (watch + shorts) and ?start=70 (embed links).
  const raw = url.searchParams.get("t") ?? url.searchParams.get("start") ?? "";
  if (!raw) return 0;
  const value = raw.trim().toLowerCase();
  if (!value) return 0;
  // Compound forms like 1h2m3s — parse unit by unit, ignore anything else.
  const compound = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (compound && (compound[1] || compound[2] || compound[3])) {
    return (
      Number(compound[1] ?? 0) * 3600 +
      Number(compound[2] ?? 0) * 60 +
      Number(compound[3] ?? 0)
    );
  }
  const plain = Number(value);
  return Number.isFinite(plain) && plain > 0 ? Math.floor(plain) : 0;
}

/**
 * Extract a YouTube video id from every format trainers actually paste:
 *   youtube.com/watch?v=ID           youtu.be/ID
 *   youtube.com/embed/ID             youtube.com/shorts/ID
 *   youtube.com/live/ID              m.youtube.com / music.youtube.com
 * plus arbitrary extra query parameters (timestamps, playlists, si=…).
 * Returns null for non-YouTube or invalid ids — never throws.
 */
export function parseYouTubeUrl(raw: string): {
  videoId: string;
  startSeconds: number;
} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) return null;

  let candidate: string | null = null;
  if (host === "youtu.be") {
    // Short links: the first path segment IS the id.
    candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (url.searchParams.get("v")) {
    // Classic watch links (and /embed?type=…&v=… variants).
    candidate = url.searchParams.get("v");
  } else {
    // Path-based forms: /embed/ID, /shorts/ID, /live/ID, /v/ID.
    const segments = url.pathname.split("/").filter(Boolean);
    const marker = segments.findIndex(
      (segment) =>
        segment === "embed" ||
        segment === "shorts" ||
        segment === "live" ||
        segment === "v"
    );
    if (marker >= 0 && segments[marker + 1]) {
      candidate = segments[marker + 1];
    }
  }

  if (!candidate) return null;
  // Strip any trailing junk (defensive; URL parsing usually did already).
  const videoId = candidate.split(/[?#]/)[0] ?? "";
  if (!YOUTUBE_ID_PATTERN.test(videoId)) return null;

  return { videoId, startSeconds: parseStartSeconds(url) };
}

/* ------------------------------------------------------------------ */
/* Vimeo                                                               */
/* ------------------------------------------------------------------ */

const VIMEO_ID_PATTERN = /^\d{6,10}$/;

export function parseVimeoUrl(raw: string): { videoId: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  // vimeo.com/76979871 — the id is the first segment; player.vimeo.com
  // wraps it: /video/76979871.
  const candidate =
    host === "player.vimeo.com" && segments[0] === "video"
      ? (segments[1] ?? "")
      : (segments[0] ?? "");
  if (!VIMEO_ID_PATTERN.test(candidate)) return null;
  return { videoId: candidate };
}

/* ------------------------------------------------------------------ */
/* Public helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Classify any saved media URL. Returns null when the URL is neither a
 * YouTube nor a Vimeo link (uploaded R2 videos and direct files are NOT
 * embeddable — they go through the real <video> players).
 */
export function parseEmbeddableVideoUrl(raw: string): ParsedEmbed | null {
  const youtube = parseYouTubeUrl(raw);
  if (youtube) {
    const params = new URLSearchParams({ rel: "0", modestbranding: "1" });
    if (youtube.startSeconds > 0) params.set("start", String(youtube.startSeconds));
    return {
      provider: "youtube",
      videoId: youtube.videoId,
      startSeconds: youtube.startSeconds > 0 ? youtube.startSeconds : null,
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtube.videoId}?${params.toString()}`,
    };
  }
  const vimeo = parseVimeoUrl(raw);
  if (vimeo) {
    return {
      provider: "vimeo",
      videoId: vimeo.videoId,
      startSeconds: null,
      embedUrl: `https://player.vimeo.com/video/${vimeo.videoId}`,
    };
  }
  return null;
}

/** True when the URL belongs to the YouTube family (any format). */
export function isYouTubeUrl(raw: string): boolean {
  return parseYouTubeUrl(raw) !== null;
}

/** True when the URL is a direct video file our <video> player can play. */
export function isDirectVideoUrl(raw: string): boolean {
  if (!raw || isYouTubeUrl(raw) || parseVimeoUrl(raw)) return false;
  return true;
}

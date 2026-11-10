import type { NextConfig } from "next";

/**
 * Phase 12 — production hardening configuration.
 *
 * Security headers are applied to every route. The Content-Security-Policy
 * is intentionally pragmatic: the App Router ships inline flight/bootstrap
 * scripts that require 'unsafe-inline', and dev mode requires 'unsafe-eval'
 * for React refresh. Everything else is locked to 'self'.
 *
 * R2 media: browser uploads (presigned PUT) and playback/images resolved
 * through the /api/media proxy redirect both talk to the R2 storage host,
 * hence it is allowed in connect-src, img-src and media-src only.
 *
 * Embedded training videos (YouTube/Vimeo): lessons may carry provider
 * links that must play INSIDE the platform page:
 *   - frame-src allows ONLY the vetted embed origins (youtube-nocookie,
 *     youtube, vimeo player) — arbitrary third-party framing stays banned;
 *   - script-src additionally allows https://www.youtube.com because the
 *     governed mandatory player loads the official IFrame Player API to
 *     enforce no-forward-seek / 1x speed and feed the server heartbeat
 *     ledger. No other third-party script origin is allowed.
 * Provider iframes manage their own internals; these directives govern
 * only what OUR document may load. X-Frame-Options DENY +
 * frame-ancestors 'none' still prevent anyone else from framing us.
 */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://www.youtube.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.r2.cloudflarestorage.com",
  "media-src 'self' https://*.r2.cloudflarestorage.com",
  "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Only meaningful over HTTPS — ignored by browsers on plain HTTP dev.
  {
    key: "Strict-Transport-Security",
    value: "max-age=15552000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // Do not advertise the framework version.
  poweredByHeader: false,
  // Explicit bound on server-action bodies (the default is already 1MB;
  // making it explicit documents the zod CVE-2026-style DoS mitigation:
  // every z.array() in the validation layer is also .max()-bounded).
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
    ];
  },
};

export default nextConfig;

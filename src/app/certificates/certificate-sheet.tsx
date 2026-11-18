/**
 * Premium revision — the printable certificate sheet (A4 landscape).
 *
 * Design contract: an official, premium institutional certificate —
 * NOT a dashboard card. Elegant double border (school primary + gold
 * accents), three-part institutional header (platform banner ·
 * development office · school identity), a dominant Arabic title with
 * gold laurels, a large recipient-name container, the completion and
 * professional-development statements, a three-cell information strip
 * (completion date · training hours · certificate number) and a
 * balanced bottom row: supervisor signature (right) · circular school
 * seal (center) · school-manager signature (center-left) · QR
 * verification (left).
 *
 * Identity rules (critical, unchanged):
 *   - Platform identity = «منارة» (PLATFORM_NAME_AR) — never a school
 *     name, and never the legacy «منارة قرطبة» compound.
 *   - School identity = the certificate's own School row (nameAr /
 *     nameEn / logoUrl / brand colors / tagline) loaded dynamically by
 *     the service layer. Nothing about any school is hardcoded here;
 *     the SAME template renders every school correctly.
 *   - Supervisor = the teacher's CURRENT explicit supervisor
 *     (supervisorName) — never fabricated; when absent the column
 *     degrades to an honest, elegant placeholder.
 *   - Manager signature = the issuance-time snapshot
 *     (schoolSignatoryName/Title) — historical certificates never
 *     change when the manager account is renamed or replaced.
 *
 * All brand colors are applied as INLINE hex styles (never CSS vars)
 * so the printed page is pixel-faithful regardless of screen theme;
 * print-color-adjust: exact keeps the banner/seal fills on paper.
 *
 * Privacy (unchanged): the sheet shows the teacher name, school name,
 * certificate number, verification code and the verification URL —
 * never emails, internal ids, scores or notes. The QR encodes the
 * public verification URL only (no sensitive data in the payload).
 */
import type { CSSProperties } from "react";
import { CalendarCheck, Clock, FileBadge } from "lucide-react";

import type { CertificateView } from "@/lib/certificates/service";
import {
  CERT_COMPLETION_STATEMENT_AR,
  CERT_GRANT_AR,
  CERT_INK,
  CERT_PD_STATEMENT_AR,
  CERT_RECIPIENT_LABEL_AR,
  CERT_TITLE_AR,
  CERTIFICATE_GOLD,
  DEFAULT_BRAND_COLOR,
  DEV_OFFICE_NAME_EN,
  PLATFORM_NAME_AR,
  PLATFORM_NAME_EN,
  PLATFORM_SUBTITLE_AR,
} from "@/config/certificates";
import { formatIssueDate } from "@/app/certificates/ui";

/**
 * Display-time brand normalization: certificates issued BEFORE the
 * platform-identity correction carry the legacy compound «منارة قرطبة»
 * inside their stored descriptionAr snapshot. The stored row is history
 * and is never rewritten — but the PRINTED sheet must always show the
 * correct platform identity «منارة» (school identity is rendered
 * separately from view.school.nameAr and is never affected).
 */
function normalizeDescriptionAr(raw: string | null): string | null {
  if (!raw) return null;
  return raw.replace(/منصة\s*منارة\s*قرطبة/g, "منصة منارة").trim();
}

/* ------------------------------------------------------------------ */
/* Decorative SVG pieces (inline so printing is pixel-identical)        */
/* ------------------------------------------------------------------ */

/** Gold laurel branch flanking the main title (mirrored via scale). */
function Laurel({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 64 36"
      aria-hidden
      className="h-6 w-10 sm:h-7 sm:w-12"
      style={{ transform: flip ? "scaleX(-1)" : undefined }}
    >
      <path
        d="M60 4 C 42 8, 26 16, 15 32"
        fill="none"
        stroke={CERTIFICATE_GOLD}
        strokeWidth="2"
        strokeLinecap="round"
      />
      {[
        "M54 5 q -7 -7 -14 -5 q 5 8 14 5",
        "M45 9 q -7 -5 -14 -2 q 6 7 14 2",
        "M37 14 q -8 -4 -14 0 q 7 6 14 0",
        "M29 20 q -8 -3 -13 2 q 8 5 13 -2",
        "M22 26 q -8 -2 -12 4 q 8 4 12 -4",
      ].map((d, i) => (
        <path key={i} d={d} fill={CERTIFICATE_GOLD} opacity={0.9} />
      ))}
    </svg>
  );
}

/**
 * The circular school seal — double ring (brand + gold hairline), the
 * school name arched around the upper perimeter and its English name
 * around the lower perimeter, with the ACTUAL school logo centered
 * (object-contain so no logo is ever stretched; letter-initial
 * fallback when unconfigured).
 */
function SchoolSeal({
  nameAr,
  nameEn,
  logoUrl,
  brand,
}: {
  nameAr: string;
  nameEn: string | null;
  logoUrl: string | null;
  brand: string;
}) {
  const initial = nameAr.trim().charAt(0) || "؟";
  return (
    <div className="cert-seal relative h-24 w-24 sm:h-28 sm:w-28" aria-label="الختم الرسمي للمدرسة">
      <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full">
        <circle cx="60" cy="60" r="58" fill="#FFFFFF" stroke={brand} strokeWidth="2.5" />
        <circle cx="60" cy="60" r="53" fill="none" stroke={CERTIFICATE_GOLD} strokeWidth="1.2" />
        <circle
          cx="60"
          cy="60"
          r="34"
          fill="none"
          stroke={brand}
          strokeWidth="1"
          strokeDasharray="2.5 3"
        />
        <defs>
          <path id="seal-arc-ar" d="M 20,62 A 40,40 0 0 1 100,62" fill="none" />
          <path id="seal-arc-en" d="M 16,60 A 44,44 0 0 0 104,60" fill="none" />
        </defs>
        <text fontSize="9" fontWeight="700" fill={brand} letterSpacing="0.4">
          <textPath href="#seal-arc-ar" startOffset="50%" textAnchor="middle">
            {nameAr}
          </textPath>
        </text>
        {nameEn ? (
          <text fontSize="6" fontWeight="600" fill={brand} opacity="0.85" letterSpacing="0.6">
            <textPath href="#seal-arc-en" startOffset="50%" textAnchor="middle">
              {nameEn}
            </textPath>
          </text>
        ) : null}
        {/* small gold stars separating the arched names */}
        <path
          d="M60 14 l1.6 4.6 4.8 0 -3.9 2.9 1.5 4.6 -4 -2.9 -4 2.9 1.5 -4.6 -3.9 -2.9 4.8 0 Z"
          fill={CERTIFICATE_GOLD}
        />
        <path
          d="M60 94 l1.3 3.8 4 0 -3.2 2.4 1.2 3.8 -3.3 -2.4 -3.3 2.4 1.2 -3.8 -3.2 -2.4 4 0 Z"
          fill={CERTIFICATE_GOLD}
        />
      </svg>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white object-contain sm:h-12 sm:w-12"
        />
      ) : (
        <div
          className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-lg font-extrabold text-white sm:h-12 sm:w-12"
          style={{ backgroundColor: brand }}
          aria-hidden
        >
          {initial}
        </div>
      )}
    </div>
  );
}

/** One signature column (role label · name · elegant signing line). */
function SignatureColumn({
  roleLabel,
  name,
  hint,
  brand,
}: {
  roleLabel: string;
  name: string | null;
  hint: string;
  brand: string;
}) {
  return (
    <div className="w-full max-w-[190px] text-center">
      <p className="text-[11px] font-bold tracking-wide" style={{ color: brand }}>
        {roleLabel}
      </p>
      {name ? (
        <p className="cert-sign-name mt-1 truncate text-sm font-extrabold" style={{ color: CERT_INK }}>
          {name}
        </p>
      ) : (
        <p className="cert-sign-name mt-1 text-xs font-semibold text-slate-400">
          يُستكمل عند الإسناد
        </p>
      )}
      <div
        className="cert-sign-line mx-auto mt-2 w-full border-t-2 border-dashed"
        style={{ borderColor: `${brand}55` }}
      />
      <p className="mt-1 text-[9px] font-medium text-slate-400">{hint}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The sheet                                                            */
/* ------------------------------------------------------------------ */

export function CertificateSheet({
  view,
  qrDataUrl,
  verifyUrl,
}: {
  view: CertificateView;
  qrDataUrl: string | null;
  verifyUrl: string;
}) {
  const brand = view.school.brandColor || DEFAULT_BRAND_COLOR;
  const secondary = view.school.brandColorSecondary ?? brand;
  const gold = view.school.brandColorAccent ?? CERTIFICATE_GOLD;
  const schoolInitial = view.school.nameAr.trim().charAt(0) || "؟";
  const descriptionText = normalizeDescriptionAr(view.descriptionAr);

  const printColors = {
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  } as CSSProperties;

  return (
    <div
      id="certificate-print-area"
      dir="rtl"
      className="cert-sheet mx-auto w-full max-w-5xl overflow-hidden rounded-xl bg-white"
      style={printColors}
    >
      {/* Outer frame — the school's primary brand border */}
      <div className="cert-frame-outer border-[3px] p-1.5" style={{ borderColor: brand }}>
        {/* Metallic gold frame */}
        <div className="cert-frame-gold border-2 p-1" style={{ borderColor: gold }}>
          {/* Inner hairline frame (complementary shade) + content */}
          <div
            className="cert-frame-inner relative overflow-hidden border px-5 py-5 sm:px-9 sm:py-7"
            style={{ borderColor: `${secondary}88`, backgroundColor: "#FFFFFF" }}
          >
            {/* flowing geometric decoration — soft brand arcs, print-safe */}
            <svg
              aria-hidden
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 opacity-[0.10]"
            >
              <circle cx="50" cy="50" r="48" fill="none" stroke={brand} strokeWidth="2" />
              <circle cx="50" cy="50" r="36" fill="none" stroke={secondary} strokeWidth="2" />
              <circle cx="50" cy="50" r="24" fill="none" stroke={gold} strokeWidth="2" />
            </svg>
            <svg
              aria-hidden
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 opacity-[0.10]"
            >
              <circle cx="50" cy="50" r="48" fill="none" stroke={brand} strokeWidth="2" />
              <circle cx="50" cy="50" r="36" fill="none" stroke={secondary} strokeWidth="2" />
              <circle cx="50" cy="50" r="24" fill="none" stroke={gold} strokeWidth="2" />
            </svg>
            {/* corner ornaments — gold diamonds on the gold frame */}
            <span aria-hidden className="absolute -top-[6px] -right-[6px] h-3 w-3 rotate-45" style={{ backgroundColor: gold }} />
            <span aria-hidden className="absolute -top-[6px] -left-[6px] h-3 w-3 rotate-45" style={{ backgroundColor: gold }} />
            <span aria-hidden className="absolute -bottom-[6px] -right-[6px] h-3 w-3 rotate-45" style={{ backgroundColor: gold }} />
            <span aria-hidden className="absolute -bottom-[6px] -left-[6px] h-3 w-3 rotate-45" style={{ backgroundColor: gold }} />

            {/* ── Header: platform banner (right) · development office (center) · school (left) ── */}
            <div
              className="cert-head relative z-10 flex flex-wrap items-center justify-between gap-3 border-b pb-4"
              style={{ borderColor: `${gold}66` }}
            >
              {/* platform banner — the school's primary brand color */}
              <div
                className="cert-banner flex items-center gap-2.5 rounded-xl px-4 py-2 text-white shadow-sm"
                style={{ backgroundColor: brand }}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/60 bg-white/15">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M12 3 2 8l10 5 10-5-10-5Z" strokeLinejoin="round" />
                    <path d="M6 10.5V15c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-extrabold leading-5">{PLATFORM_NAME_AR}</p>
                  <p dir="ltr" className="text-left text-[8.5px] font-semibold uppercase tracking-widest text-white/85">
                    {PLATFORM_NAME_EN}
                  </p>
                </div>
              </div>

              <span aria-hidden className="hidden h-12 w-px sm:block" style={{ background: `linear-gradient(to bottom, transparent, ${gold}, transparent)` }} />

              {/* development office — operator identity */}
              <div className="flex items-center gap-2.5 px-1 text-center sm:px-2">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 bg-white"
                  style={{ borderColor: gold }}
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke={brand} strokeWidth="2" aria-hidden>
                    <path d="M3 21h18M5 21V8l7-4 7 4v13" strokeLinejoin="round" />
                    <path d="M9 21v-5a3 3 0 0 1 6 0v5" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-extrabold leading-5" style={{ color: CERT_INK }}>
                    {PLATFORM_SUBTITLE_AR}
                  </p>
                  <p dir="ltr" className="text-left text-[8.5px] font-semibold uppercase tracking-wider text-slate-400">
                    {DEV_OFFICE_NAME_EN}
                  </p>
                </div>
              </div>

              <span aria-hidden className="hidden h-12 w-px sm:block" style={{ background: `linear-gradient(to bottom, transparent, ${gold}, transparent)` }} />

              {/* school identity — dynamically from the certificate's School row */}
              <div className="flex items-center gap-2.5">
                {view.school.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={view.school.logoUrl}
                    alt={view.school.nameAr}
                    className="cert-logo-fallback h-12 w-12 rounded-full border-2 bg-white object-contain p-0.5"
                    style={{ borderColor: `${brand}55` }}
                  />
                ) : (
                  <div
                    className="cert-logo-fallback flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold text-white"
                    style={{ backgroundColor: brand }}
                    aria-hidden
                  >
                    {schoolInitial}
                  </div>
                )}
                <div className="text-left">
                  <p className="text-base font-extrabold leading-5 sm:text-lg" style={{ color: CERT_INK }}>
                    {view.school.nameAr}
                  </p>
                  {view.school.nameEn ? (
                    <p dir="ltr" className="text-left text-[10px] font-semibold text-slate-500">
                      {view.school.nameEn}
                    </p>
                  ) : null}
                  {view.school.brandTagline ? (
                    <p className="text-left text-[10px] font-medium" style={{ color: brand }}>
                      {view.school.brandTagline}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            {/* ── Main title with gold laurels ── */}
            <div className="relative z-10 mt-4 flex items-center justify-center gap-3 sm:mt-5">
              <Laurel />
              <h1
                className="cert-title text-center text-3xl font-extrabold tracking-wide sm:text-4xl"
                style={{ color: brand }}
              >
                {CERT_TITLE_AR}
              </h1>
              <Laurel flip />
            </div>
            {view.titleEn ? (
              <p dir="ltr" className="cert-subtitle-en mt-1 text-center text-[10px] font-medium uppercase tracking-[0.25em] text-slate-400">
                {view.titleEn}
              </p>
            ) : null}

            {/* ── Recipient ── */}
            <p className="cert-grant mt-4 text-center text-sm font-semibold text-slate-500 sm:mt-5 sm:text-base">
              {CERT_GRANT_AR}
            </p>
            <div
              className="cert-name-box mx-auto mt-2 w-[86%] max-w-2xl rounded-2xl border-2 px-6 py-3 text-center sm:w-[80%]"
              style={{
                borderColor: `${brand}B3`,
                backgroundColor: `${brand}0A`,
                boxShadow: `inset 0 0 0 1px ${gold}55`,
              }}
            >
              <p className="text-[11px] font-bold tracking-wide text-slate-500">
                {CERT_RECIPIENT_LABEL_AR}
              </p>
              <p
                className="cert-name mt-0.5 break-words text-3xl font-extrabold leading-snug sm:text-[2.5rem]"
                style={{ color: CERT_INK }}
              >
                {view.teacherName}
              </p>
            </div>

            {/* ── Completion statement + program title ── */}
            <div className="cert-statement relative z-10 mt-4 text-center sm:mt-5">
              <p className="text-[13px] leading-7 text-slate-700 sm:text-sm">
                {CERT_COMPLETION_STATEMENT_AR}
              </p>
              <p className="mt-1 text-lg font-extrabold leading-8 sm:text-xl">
                {view.contentSubtitle ? (
                  <span className="text-slate-800">{view.contentSubtitle} </span>
                ) : null}
                {view.contentTitle ? (
                  <>
                    «<span style={{ color: brand }}>{view.contentTitle}</span>»
                  </>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </p>
              <p className="mt-1.5 text-xs leading-6 text-slate-600 sm:text-[13px]">
                {CERT_PD_STATEMENT_AR}
                <br />
                بمنصة التنمية المهنية في {view.school.nameAr}.
              </p>
              {descriptionText ? (
                <p className="cert-desc mx-auto mt-1.5 max-w-2xl text-[11px] leading-5 text-slate-400">
                  {descriptionText}
                </p>
              ) : null}
            </div>

            {/* ── Information strip: completion date · training hours · certificate number ── */}
            <div
              className="cert-info-grid relative z-10 mx-auto mt-4 grid max-w-3xl grid-cols-1 overflow-hidden rounded-2xl border sm:mt-5 sm:grid-cols-3 sm:divide-x sm:divide-x-reverse"
              style={{ borderColor: `${brand}33`, backgroundColor: "#F8FAFC" }}
            >
              <div className="flex items-center justify-center gap-3 px-4 py-3">
                <CalendarCheck className="size-6 shrink-0" style={{ color: brand }} aria-hidden />
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    تاريخ الإتمام
                  </p>
                  <p className="mt-0.5 text-sm font-extrabold" style={{ color: CERT_INK }}>
                    {formatIssueDate(view.issuedAt)}
                  </p>
                </div>
              </div>
              <div
                className="flex items-center justify-center gap-3 border-t px-4 py-3 sm:border-t-0"
                style={{ borderColor: `${brand}1A` }}
              >
                <Clock className="size-6 shrink-0" style={{ color: brand }} aria-hidden />
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    عدد الساعات التدريبية
                  </p>
                  <p className="mt-0.5 text-sm font-extrabold" style={{ color: CERT_INK }}>
                    {typeof view.trainingHours === "number" && view.trainingHours > 0
                      ? `${view.trainingHours} ساعات`
                      : "—"}
                  </p>
                </div>
              </div>
              <div
                className="flex items-center justify-center gap-3 border-t px-4 py-3 sm:border-t-0"
                style={{ borderColor: `${brand}1A` }}
              >
                <FileBadge className="size-6 shrink-0" style={{ color: brand }} aria-hidden />
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    رقم الشهادة
                  </p>
                  <p
                    dir="ltr"
                    className="mt-0.5 font-mono text-[13px] font-extrabold tracking-wider"
                    style={{ color: CERT_INK }}
                  >
                    {view.certificateNumber}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Bottom row: supervisor (right) · seal (center) · manager (center-left) · QR (left) ── */}
            <div
              className="cert-bottom relative z-10 mt-5 grid grid-cols-2 items-end gap-x-3 gap-y-4 border-t pt-4 sm:grid-cols-[1.15fr_auto_1.15fr_auto]"
              style={{ borderColor: `${gold}66` }}
            >
              <div className="flex justify-center">
                <SignatureColumn
                  roleLabel="المشرف التربوي"
                  name={view.supervisorName}
                  hint="التوقيع"
                  brand={brand}
                />
              </div>

              <div className="cert-seal-wrap flex flex-col items-center">
                <SchoolSeal
                  nameAr={view.school.nameAr}
                  nameEn={view.school.nameEn}
                  logoUrl={view.school.logoUrl}
                  brand={brand}
                />
                <p className="mt-1 text-[9px] font-semibold text-slate-400">الختم الرسمي</p>
              </div>

              <div className="flex justify-center">
                <SignatureColumn
                  roleLabel={view.schoolSignatoryTitle ?? "مدير المدرسة"}
                  name={view.schoolSignatoryName}
                  hint="التوقيع والاعتماد"
                  brand={brand}
                />
              </div>

              <div className="cert-verify flex flex-col items-center text-center">
                <div
                  className="rounded-xl border-2 bg-white p-1.5"
                  style={{ borderColor: `${brand}55` }}
                >
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrDataUrl}
                      alt="رمز الاستجابة السريعة للتحقق من الشهادة"
                      className="cert-qr h-20 w-20 sm:h-[5.25rem] sm:w-[5.25rem]"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center text-[9px] text-slate-400 sm:h-[5.25rem] sm:w-[5.25rem]">
                      {verifyUrl}
                    </div>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] font-extrabold" style={{ color: CERT_INK }}>
                  تحقق من صحة الشهادة
                </p>
                <p dir="ltr" className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                  Scan to Verify
                </p>
                <p dir="ltr" className="mt-0.5 max-w-[190px] truncate font-mono text-[9px] text-slate-400">
                  {verifyUrl}
                </p>
              </div>
            </div>

            <p className="cert-footline relative z-10 mt-3 text-center text-[9.5px] font-medium text-slate-400">
              {PLATFORM_NAME_AR} — {PLATFORM_SUBTITLE_AR} · شهادة إلكترونية قابلة للتحقق عبر رمز الاستجابة السريعة أعلاه
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
/**
 * Phase 8 (Premium revision) — the printable certificate sheet.
 *
 * Design contract: an official academic certificate, NOT a dashboard
 * card. A4-landscape, premium white paper, deep blue brand + restrained
 * gold accents, elegant double borders, an academic seal, a large
 * teacher name and a clearly structured information section with the
 * QR verification block and the authorized signature.
 *
 * Identity rules (critical):
 *   - Platform identity = «منارة» (PLATFORM_NAME_AR) — never a school
 *     name, and never the legacy «منارة قرطبة» compound.
 *   - School identity = the certificate's own School row (nameAr +
 *     logoUrl + brandColor) loaded dynamically by the service layer.
 *     Nothing about any school is hardcoded here; the SAME template
 *     renders every school correctly.
 *
 * Privacy: the sheet shows the teacher NAME, school name, certificate
 * number, verification code and the verification URL — never emails,
 * internal ids, scores or notes. The QR encodes the verification page
 * URL with the code prefilled; the page itself is auth-gated.
 */
import type { CertificateView } from "@/lib/certificates/service";
import {
  CERTIFICATE_GOLD,
  DEFAULT_BRAND_COLOR,
  PLATFORM_NAME_AR,
  PLATFORM_SUBTITLE_AR,
} from "@/config/certificates";
import { formatIssueDate } from "@/app/certificates/ui";

/** Arabic pluralization for training hours (0/1/2/3-10/11+). */
function trainingHoursLabel(hours: number): string {
  if (hours === 1) return "ساعة تدريبية واحدة";
  if (hours === 2) return "ساعتان تدريبيتان";
  if (hours >= 3 && hours <= 10) return `${hours} ساعات تدريبية`;
  return `${hours} ساعة تدريبية`;
}

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

/** The academic seal — inline SVG so it prints identically everywhere. */
function CertificateSeal({ brand, issuedAt }: { brand: string; issuedAt: Date }) {
  return (
    <svg
      viewBox="0 0 120 120"
      role="img"
      aria-label="ختم الاعتماد الأكاديمي"
      className="h-20 w-20 sm:h-24 sm:w-24"
    >
      <circle cx="60" cy="60" r="56" fill="#FFFFFF" stroke={brand} strokeWidth="2.5" />
      <circle cx="60" cy="60" r="50" fill="none" stroke={CERTIFICATE_GOLD} strokeWidth="1" />
      <circle
        cx="60"
        cy="60"
        r="45"
        fill="none"
        stroke={CERTIFICATE_GOLD}
        strokeWidth="0.75"
        strokeDasharray="2.5 3"
      />
      <defs>
        <path
          id="cert-seal-arc"
          d="M 60,60 m -36,0 a 36,36 0 1,1 72,0 a 36,36 0 1,1 -72,0"
          fill="none"
        />
      </defs>
      <text fontSize="8.5" fontWeight="700" fill={brand} letterSpacing="0.5">
        <textPath href="#cert-seal-arc" startOffset="25%" textAnchor="middle">
          منارة • مكتب التطوير التربوي
        </textPath>
      </text>
      {/* five-pointed star */}
      <path
        d="M60 38 L64.7 51.3 L78.8 51.3 L67.6 59.7 L71.9 73 L60 64.8 L48.1 73 L52.4 59.7 L41.2 51.3 L55.3 51.3 Z"
        fill={CERTIFICATE_GOLD}
        stroke={brand}
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      <text x="60" y="88" textAnchor="middle" fontSize="10" fontWeight="800" fill={brand}>
        {issuedAt.getFullYear()}
      </text>
    </svg>
  );
}

export function CertificateSheet({
  view,
  qrDataUrl,
  verifyUrl,
  trainingHours,
}: {
  view: CertificateView;
  qrDataUrl: string | null;
  verifyUrl: string;
  /** Course training hours (course.estimatedHours) — null for programs. */
  trainingHours?: number | null;
}) {
  const brand = view.school.brandColor || DEFAULT_BRAND_COLOR;
  const schoolInitial = view.school.nameAr.trim().charAt(0) || "?";
  const descriptionText = normalizeDescriptionAr(view.descriptionAr);

  return (
    <div
      id="certificate-print-area"
      dir="rtl"
      className="cert-sheet mx-auto w-full max-w-5xl overflow-hidden rounded-xl bg-white"
    >
      {/* Outer frame — deep blue double border with a gold inner hairline */}
      <div
        className="border-2 p-1.5"
        style={{ borderColor: brand, backgroundColor: "#FFFFFF" }}
      >
        <div
          className="cert-frame-inner relative border px-5 py-6 sm:px-9 sm:py-8"
          style={{ borderColor: CERTIFICATE_GOLD }}
        >
          {/* restrained corner ornaments (gold diamonds) */}
          <span aria-hidden className="absolute -top-[5px] -right-[5px] h-2.5 w-2.5 rotate-45" style={{ backgroundColor: CERTIFICATE_GOLD }} />
          <span aria-hidden className="absolute -top-[5px] -left-[5px] h-2.5 w-2.5 rotate-45" style={{ backgroundColor: CERTIFICATE_GOLD }} />
          <span aria-hidden className="absolute -bottom-[5px] -right-[5px] h-2.5 w-2.5 rotate-45" style={{ backgroundColor: CERTIFICATE_GOLD }} />
          <span aria-hidden className="absolute -bottom-[5px] -left-[5px] h-2.5 w-2.5 rotate-45" style={{ backgroundColor: CERTIFICATE_GOLD }} />

          {/* header: school identity | platform identity */}
          <div
            className="cert-head flex flex-wrap items-center justify-between gap-4 border-b pb-4"
            style={{ borderColor: `${CERTIFICATE_GOLD}66` }}
          >
            <div className="flex items-center gap-3">
              {view.school.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={view.school.logoUrl}
                  alt={view.school.nameAr}
                  className="cert-logo-fallback h-14 w-14 rounded-full border bg-white object-contain p-1"
                  style={{ borderColor: `${brand}55` }}
                />
              ) : (
                <div
                  className="cert-logo-fallback flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold text-white"
                  style={{ backgroundColor: brand }}
                  aria-hidden
                >
                  {schoolInitial}
                </div>
              )}
              <div>
                <p className="text-base font-extrabold text-slate-900 sm:text-lg">
                  {view.school.nameAr}
                </p>
                <p className="text-[11px] font-medium text-slate-500">
                  الجهة المانحة للشهادة
                </p>
              </div>
            </div>
            <div className="text-left">
              <p className="text-xl font-extrabold tracking-wide" style={{ color: brand }}>
                {PLATFORM_NAME_AR}
              </p>
              <p className="text-[11px] font-semibold text-slate-500">
                {PLATFORM_SUBTITLE_AR}
              </p>
            </div>
          </div>

          {/* title block */}
          <p className="cert-heading cert-title mt-5 text-center text-3xl font-extrabold tracking-wide sm:text-4xl" style={{ color: brand }}>
            شهادة إتمام
          </p>
          {view.titleEn ? (
            <p dir="ltr" className="cert-subtitle-en mt-1 text-center text-[11px] font-medium uppercase tracking-widest text-slate-400">
              {view.titleEn}
            </p>
          ) : null}

          <p className="cert-grant mt-6 text-center text-sm font-semibold text-slate-500 sm:text-base">
            تُمنح هذه الشهادة إلى
          </p>
          <p className="cert-name mt-2 text-center text-3xl font-extrabold text-slate-900 sm:text-[2.6rem] sm:leading-snug">
            {view.teacherName}
          </p>
          <div className="cert-underline mx-auto mt-3 h-[3px] w-48 rounded" style={{ backgroundColor: CERTIFICATE_GOLD }} />

          {/* achievement statement */}
          <div className="cert-statement mt-5 text-center">
            <p className="text-sm leading-8 text-slate-700 sm:text-[0.95rem]">
              لإتمامه/ا متطلبات{" "}
              <span className="font-bold text-slate-900">{view.contentSubtitle ?? "المحتوى التدريبي"}</span>
              {view.contentTitle ? (
                <>
                  {" "}«<span className="font-extrabold" style={{ color: brand }}>{view.contentTitle}</span>»
                </>
              ) : null}
              {typeof trainingHours === "number" && trainingHours > 0 ? (
                <> بمجموع <span className="font-bold">{trainingHoursLabel(trainingHours)}</span></>
              ) : null}
              وفق سجلات التعلّم والتقييم المعتمدة في المنصة.
            </p>
            {descriptionText ? (
              <p className="cert-desc mx-auto mt-2 max-w-2xl text-xs leading-6 text-slate-500">
                {descriptionText}
              </p>
            ) : null}
          </div>

          {/* footer: certificate data | authorized signature | verification */}
          <div
            className="cert-info-grid mt-7 grid grid-cols-1 items-start gap-6 border-t pt-5 sm:grid-cols-3"
            style={{ borderColor: `${CERTIFICATE_GOLD}66` }}
          >
            {/* certificate data */}
            <div className="text-center sm:text-right">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                بيانات الشهادة
              </p>
              <dl className="mt-2 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">تاريخ الإصدار</dt>
                  <dd className="font-bold text-slate-800">{formatIssueDate(view.issuedAt)}</dd>
                </div>
                {view.expiresAt ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">تنتهي في</dt>
                    <dd className="font-bold text-slate-800">{formatIssueDate(view.expiresAt)}</dd>
                  </div>
                ) : null}
                {typeof trainingHours === "number" && trainingHours > 0 ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">الساعات التدريبية</dt>
                    <dd className="font-bold text-slate-800">{trainingHours}</dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">رقم الشهادة</dt>
                  <dd dir="ltr" className="font-mono text-[11px] font-bold tracking-wider text-slate-800">
                    {view.certificateNumber}
                  </dd>
                </div>
              </dl>
            </div>

            {/* authorized signature */}
            <div className="text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                التوقيع والاعتماد
              </p>
              {view.schoolSignatoryName ? (
                <>
                  <p className="mt-3 text-sm font-extrabold text-slate-900">
                    {view.schoolSignatoryName}
                  </p>
                  <p className="text-[11px] font-semibold text-slate-500">
                    {view.schoolSignatoryTitle ?? "مدير المدرسة"} — {view.school.nameAr}
                  </p>
                  <div className="mx-auto mt-1 w-40 border-t border-dashed pt-1" style={{ borderColor: `${brand}66` }}>
                    <span className="text-[10px] text-slate-400">التوقيع والختم</span>
                  </div>
                </>
              ) : null}
              {view.issuerName ? (
                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                  أُصدرت بواسطة: <span className="font-bold text-slate-700">{view.issuerName}</span>
                  {view.issuerRoleLabel ? ` — ${view.issuerRoleLabel}` : ""}
                </p>
              ) : null}
            </div>

            {/* verification */}
            <div className="flex flex-col items-center gap-1.5 text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                التحقق من الشهادة
              </p>
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="رمز الاستجابة السريعة للتحقق من الشهادة"
                  className="cert-qr h-20 w-20 sm:h-[5.5rem] sm:w-[5.5rem]"
                />
              ) : null}
              <p dir="ltr" className="font-mono text-[11px] font-bold tracking-widest text-slate-800">
                {view.verificationCodeGrouped}
              </p>
              <p dir="ltr" className="max-w-[240px] truncate text-[10px] text-slate-400">
                {verifyUrl}
              </p>
            </div>
          </div>

          {/* seal — overlaps the footer rail elegantly, print-safe */}
          <div className="cert-seal-wrap pointer-events-none absolute bottom-4 left-4 hidden opacity-90 sm:block" aria-hidden>
            <CertificateSeal brand={brand} issuedAt={view.issuedAt} />
          </div>

          <p className="cert-footline mt-4 text-center text-[10px] font-medium text-slate-400">
            {PLATFORM_NAME_AR} — {PLATFORM_SUBTITLE_AR} · شهادة إلكترونية قابلة للتحقق عبر رمز الاستجابة السريعة أعلاه
          </p>
        </div>
      </div>
    </div>
  );
}

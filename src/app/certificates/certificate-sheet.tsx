/**
 * Phase 8 — the printable certificate sheet (server-safe component).
 *
 * Design contract: Arabic RTL, Manarat Qurtuba brand blue, the SCHOOL's
 * own identity (logo/name/brand color from the certificate's school
 * row — nothing is hardcoded per school), print-friendly A4-landscape
 * layout that also stacks cleanly on mobile. Print rules live on the
 * certificate page (#certificate-print-area + .no-print).
 *
 * Privacy: the sheet shows the teacher NAME, school name, certificate
 * number, verification code and the verification URL — never emails,
 * internal ids, scores or notes. The QR encodes the verification page
 * URL with the code prefilled; the page itself is auth-gated.
 */
import type { CertificateView } from "@/lib/certificates/service";
import { DEFAULT_BRAND_COLOR, PLATFORM_NAME_AR } from "@/config/certificates";
import { formatIssueDate } from "@/app/certificates/ui";

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
  const schoolInitial = view.school.nameAr.trim().charAt(0) || "م";

  return (
    <div
      id="certificate-print-area"
      dir="rtl"
      className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"
    >
      <div
        className="p-2 sm:p-3"
        style={{
          background: `linear-gradient(135deg, ${brand}1A, #FFFFFF 45%, ${brand}14)`,
        }}
      >
        <div className="rounded-xl border-2 bg-white p-1" style={{ borderColor: brand }}>
          <div
            className="relative rounded-lg border px-5 py-8 sm:px-10 sm:py-12"
            style={{ borderColor: `${brand}66` }}
          >
            {/* corner ornaments */}
            <span aria-hidden className="absolute -top-1 -right-1 h-3 w-3 rotate-45" style={{ backgroundColor: brand }} />
            <span aria-hidden className="absolute -top-1 -left-1 h-3 w-3 rotate-45" style={{ backgroundColor: brand }} />
            <span aria-hidden className="absolute -bottom-1 -right-1 h-3 w-3 rotate-45" style={{ backgroundColor: brand }} />
            <span aria-hidden className="absolute -bottom-1 -left-1 h-3 w-3 rotate-45" style={{ backgroundColor: brand }} />

            {/* header: school identity + platform name */}
            <div
              className="flex flex-wrap items-center justify-between gap-4 border-b pb-4"
              style={{ borderColor: `${brand}33` }}
            >
              <div className="flex items-center gap-3">
                {view.school.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={view.school.logoUrl}
                    alt={view.school.nameAr}
                    className="h-14 w-14 rounded-full border border-slate-200 bg-white object-contain p-1"
                  />
                ) : (
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold text-white"
                    style={{ backgroundColor: brand }}
                    aria-hidden
                  >
                    {schoolInitial}
                  </div>
                )}
                <div>
                  <p className="text-sm font-bold text-slate-800">{view.school.nameAr}</p>
                  <p className="text-xs text-slate-400">الجهة المانحة</p>
                </div>
              </div>
              <div className="text-left">
                <p className="text-lg font-extrabold" style={{ color: brand }}>
                  {PLATFORM_NAME_AR}
                </p>
                <p className="text-xs text-slate-400">منصة التطوير المهني للمعلمين</p>
              </div>
            </div>

            {/* title block */}
            <p className="mt-8 text-center text-3xl font-extrabold sm:text-4xl" style={{ color: brand }}>
              شهادة إتمام
            </p>
            <p className="mt-3 text-center text-base font-semibold text-slate-700 sm:text-lg">
              {view.titleAr}
            </p>
            {view.titleEn ? (
              <p dir="ltr" className="mt-1 text-center text-xs text-slate-400">
                {view.titleEn}
              </p>
            ) : null}

            {/* awarded to */}
            <p className="mt-8 text-center text-sm text-slate-500">تُمنح هذه الشهادة إلى</p>
            <p className="mt-2 text-center text-2xl font-bold text-slate-900 sm:text-3xl">
              {view.teacherName}
            </p>
            <div className="mx-auto mt-3 h-0.5 w-40 rounded" style={{ backgroundColor: `${brand}66` }} />

            {/* achievement statement */}
            {view.descriptionAr ? (
              <p className="mx-auto mt-6 max-w-2xl text-center text-sm leading-7 text-slate-600">
                {view.descriptionAr}
              </p>
            ) : null}
            {view.contentTitle ? (
              <p className="mt-3 text-center text-base font-semibold text-slate-800">
                {view.contentSubtitle}: «{view.contentTitle}»
              </p>
            ) : null}

            {/* footer: issue data | authority | verification */}
            <div
              className="mt-10 grid grid-cols-1 gap-6 border-t pt-6 sm:grid-cols-3"
              style={{ borderColor: `${brand}33` }}
            >
              <div className="text-center">
                <p className="text-xs text-slate-400">تاريخ الإصدار</p>
                <p className="mt-1 text-sm font-semibold text-slate-700">
                  {formatIssueDate(view.issuedAt)}
                </p>
                {view.expiresAt ? (
                  <>
                    <p className="mt-2 text-xs text-slate-400">تنتهي الصلاحية</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-700">
                      {formatIssueDate(view.expiresAt)}
                    </p>
                  </>
                ) : null}
                <p className="mt-2 text-xs text-slate-400">رقم الشهادة</p>
                <p dir="ltr" className="mt-0.5 text-sm font-semibold tracking-wider text-slate-700">
                  {view.certificateNumber}
                </p>
              </div>

              <div className="text-center">
                <p className="text-xs text-slate-400">جهة الإصدار</p>
                <p className="mt-1 text-sm font-semibold text-slate-700">{view.school.nameAr}</p>
                {view.issuerName ? (
                  <>
                    <p className="mt-2 text-xs text-slate-400">المُصدر</p>
                    <p className="text-sm font-semibold text-slate-700">{view.issuerName}</p>
                  </>
                ) : null}
                {view.issuerRoleLabel ? (
                  <p className="mt-0.5 text-xs text-slate-500">{view.issuerRoleLabel}</p>
                ) : null}
              </div>

              <div className="flex flex-col items-center gap-1">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrDataUrl} alt="رمز التحقق من الشهادة" className="h-24 w-24" />
                ) : null}
                <p className="text-xs text-slate-400">رمز التحقق</p>
                <p dir="ltr" className="text-sm font-semibold tracking-widest text-slate-700">
                  {view.verificationCodeGrouped}
                </p>
                <p dir="ltr" className="max-w-[220px] truncate text-[10px] text-slate-400">
                  {verifyUrl}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
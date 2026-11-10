/**
 * Phase 8 (Premium print revision) — certificate detail + printable
 * sheet. One route serves:
 *   - the certified TEACHER (owner-only, server-checked),
 *   - DEVELOPMENT_OFFICE_MANAGER / SCHOOL_MANAGER /
 *     EDUCATIONAL_SUPERVISOR / EDUCATIONAL_DEPUTY (own school),
 *   - SUPER_ADMIN (platform-wide read-only records).
 * Authorization is enforced inside getCertificateView — this page only
 * renders the returned result or an access panel.
 *
 * Print flow (طباعة / حفظ PDF): the browser print dialog with a
 * dedicated print layout — everything outside the sheet is removed
 * from the print flow (display:none cascade, not the old
 * visibility:hidden trick that reserved layout space and produced a
 * second blank page), the sheet fills exactly one A4 landscape page.
 * A dedicated bare print route (/certificates/<id>/print) also exists
 * for a guaranteed one-page output.
 */
import Link from "next/link";
import { headers } from "next/headers";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { roleLabel } from "@/lib/auth/roles";
import { getCertificateView } from "@/lib/certificates/service";
import { qrDataUrl } from "@/lib/certificates/qr";
import { CERTIFICATE_EVENT_TYPE_LABELS } from "@/config/certificates";
import {
  AccessDenied,
  Card,
  PageHeader,
  formatDate,
} from "@/app/assignments/ui";
import {
  EffectiveStatusBadge,
  formatIssueDate,
} from "@/app/certificates/ui";
import { CertificateSheet } from "@/app/certificates/certificate-sheet";
import { PrintButton } from "@/app/certificates/print-button";
import { RevokeForm } from "@/app/certificates/revoke-form";

export const dynamic = "force-dynamic";

export default async function CertificateViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const { id } = await params;
  const result = await getCertificateView(user, id);
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const view = result.data;

  // Training hours snapshot (course.estimatedHours) — read-only extra
  // fact for the sheet; programs and legacy rows simply show none.
  const hoursRow = await db.certificate.findUnique({
    where: { id },
    select: { course: { select: { estimatedHours: true } } },
  });
  const trainingHours = hoursRow?.course?.estimatedHours ?? null;

  // Verification URL for the QR code + printed footer (host from
  // request headers; no internal ids beyond the route the viewer is
  // already on — the code is the lookup key).
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const verifyUrl = `${proto}://${host}/verify?code=${view.verificationCode}`;
  const qr = await qrDataUrl(verifyUrl);

  // Revocation follows canRevokeCertificates: office manager OR school
  // manager (both confined to their own school by the service).
  const canRevoke =
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    user.role === "SCHOOL_MANAGER";
  const isOwner = user.role === "TEACHER" && user.id === view.teacherId;

  return (
    <div id="certificate-page-root">
      <div className="no-print">
        <PageHeader
          title={view.titleAr}
          subtitle={`رقم الشهادة: ${view.certificateNumber}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <PrintButton />
              <Link
                href={`/certificates/${id}/print`}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                صفحة الطباعة المخصصة
              </Link>
              {isOwner ? (
                <Link
                  href="/my-certificates"
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  رجوع إلى شهاداتي
                </Link>
              ) : (
                <Link
                  href="/certificates"
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  رجوع إلى الإدارة
                </Link>
              )}
            </div>
          }
        />
      </div>

      <div className="no-print mb-6 flex flex-wrap items-center gap-3">
        <EffectiveStatusBadge status={view.effectiveStatus} />
        <span className="text-xs text-slate-500">
          المعلم: <strong className="text-slate-700">{view.teacherName}</strong>
        </span>
        {view.contentTitle ? (
          <span className="text-xs text-slate-500">
            المحتوى: <strong className="text-slate-700">{view.contentTitle}</strong>
          </span>
        ) : null}
      </div>

      {/* printable sheet — the ONLY element kept in the print flow */}
      <section id="certificate-print-section">
        <CertificateSheet
          view={view}
          qrDataUrl={qr}
          verifyUrl={verifyUrl}
          trainingHours={trainingHours}
        />
      </section>

      {/* dedicated print stylesheet — scoped to this page. Removes the
          shell and every non-sheet block from the print flow entirely
          (display, NOT visibility — hidden-but-displayed elements still
          reserve layout height and used to spawn a second page). */}
      <style>{`
        @media print {
          html, body {
            background: #FFFFFF !important;
            margin: 0 !important;
          }
          /* application chrome out of the print flow */
          aside, header, nav, footer, .no-print { display: none !important; }
          /* page siblings + non-sheet page sections out of the flow */
          main > div > *:not(#certificate-page-root) { display: none !important; }
          #certificate-page-root > *:not(#certificate-print-section) { display: none !important; }
          /* collapse every wrapper around the sheet */
          main, main > div, #certificate-page-root, #certificate-print-section {
            padding: 0 !important;
            margin: 0 !important;
            max-width: none !important;
            width: 100% !important;
          }
          /* the sheet occupies EXACTLY the printable box (281×194mm at
             8mm page margins) and can never grow past it — one page. */
          /* shell wrappers may carry min-height:100vh — that alone
             re-creates a second page in print; collapse them. */
          body > div, body > div > div { min-height: 0 !important; height: auto !important; }
          #certificate-print-area {
            width: 280mm !important;
            max-width: 280mm !important;
            height: 193mm !important;
            overflow: hidden !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
          }
          #certificate-print-area > div:first-child { height: 100% !important; }
          .cert-frame-inner {
            height: 100% !important;
            padding: 10px 26px 8px !important;
            display: flex !important;
            flex-direction: column !important;
          }
          .cert-head { padding-bottom: 8px !important; gap: 12px !important; }
          .cert-head img, .cert-head .cert-logo-fallback { height: 44px !important; width: 44px !important; }
          .cert-title { margin-top: 6px !important; font-size: 30px !important; line-height: 1.25 !important; }
          .cert-subtitle-en { margin-top: 2px !important; }
          .cert-grant { margin-top: 14px !important; }
          .cert-name { margin-top: 4px !important; font-size: 34px !important; line-height: 1.3 !important; }
          .cert-underline { margin-top: 8px !important; }
          /* balance: the free vertical space splits evenly between the
     statement block and the footer rail (classic certificate rhythm) */
  .cert-statement { margin-top: auto !important; padding-top: 10px !important; }
          .cert-desc { margin-top: 4px !important; }
          .cert-info-grid { margin-top: auto !important; padding-top: 10px !important; gap: 20px !important; }
          .cert-qr { height: 66px !important; width: 66px !important; }
          .cert-seal-wrap { bottom: 12px !important; left: 14px !important; }
          .cert-seal-wrap svg { height: 80px !important; width: 80px !important; }
          .cert-footline { margin-top: 10px !important; }
        }
        @page { size: A4 landscape; margin: 8mm; }
      `}</style>

      {/* audit + management section (never printed) */}
      <div className="no-print mt-8 grid gap-6 lg:grid-cols-2">
        <Card title="بيانات الإصدار والتحقق">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">حالة الشهادة</dt>
              <dd><EffectiveStatusBadge status={view.effectiveStatus} /></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">تاريخ الإصدار</dt>
              <dd className="font-medium text-slate-700">{formatIssueDate(view.issuedAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">انتهاء الصلاحية</dt>
              <dd className="font-medium text-slate-700">
                {view.expiresAt ? formatIssueDate(view.expiresAt) : "غير محدد (سارية دائمًا)"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">رقم الشهادة</dt>
              <dd dir="ltr" className="font-mono text-xs font-semibold text-slate-700">
                {view.certificateNumber}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">رمز التحقق</dt>
              <dd dir="ltr" className="font-mono text-xs font-semibold tracking-widest text-slate-700">
                {view.verificationCodeGrouped}
              </dd>
            </div>
            {trainingHours !== null ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">الساعات التدريبية</dt>
                <dd className="font-medium text-slate-700">{trainingHours}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">المُصدر</dt>
              <dd className="font-medium text-slate-700">
                {view.issuerName ?? "—"}
                {view.issuerRoleLabel ? (
                  <span className="mr-1 text-xs text-slate-400">({view.issuerRoleLabel})</span>
                ) : null}
              </dd>
            </div>
            {view.schoolSignatoryName ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">توقيع مدير المدرسة</dt>
                <dd className="font-medium text-slate-700">
                  {view.schoolSignatoryName}
                  {view.schoolSignatoryTitle ? (
                    <span className="mr-1 text-xs text-slate-400">({view.schoolSignatoryTitle})</span>
                  ) : null}
                </dd>
              </div>
            ) : null}
            {view.revocation ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">تاريخ الإلغاء</dt>
                  <dd className="font-medium text-red-700">{formatDate(view.revocation.at)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">سبب الإلغاء</dt>
                  <dd className="max-w-64 text-left text-xs text-red-600">{view.revocation.reason}</dd>
                </div>
                {view.revocation.byName ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">أُلغيت بواسطة</dt>
                    <dd className="font-medium text-slate-700">{view.revocation.byName}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>

          {canRevoke && view.status === "ISSUED" ? (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <RevokeForm certificateId={view.id} />
            </div>
          ) : null}
        </Card>

        <Card title="سجل تدقيق الشهادة">
          {view.events.length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد أحداث مسجلة.</p>
          ) : (
            <ol className="space-y-4">
              {view.events.map((event, index) => (
                <li key={`${event.type}-${event.createdAt.toISOString()}-${index}`} className="flex gap-3">
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      event.type === "ISSUED" ? "bg-emerald-500" : "bg-red-500"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {CERTIFICATE_EVENT_TYPE_LABELS[event.type] ?? event.type}
                      {event.type === "ISSUED" ? " — إصدار الشهادة" : " — إلغاء الشهادة"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(event.createdAt)}
                      {event.actorName ? ` — ${event.actorName}` : ""}
                      {event.actorRole ? ` (${roleLabel(event.actorRole)})` : ""}
                    </p>
                    {event.note ? (
                      <p className="mt-1 text-xs text-slate-500">{event.note}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {view.snapshot ? (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold text-slate-600">
                نتائج الاستحقاق المسجلة لحظة الإصدار
              </p>
              <ul className="mt-2 space-y-2 text-xs">
                {view.snapshot.rules.map((rule) => (
                  <li key={rule.key} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                        rule.met ? "bg-emerald-500" : "bg-red-400"
                      }`}
                      aria-hidden
                    >
                      {rule.met ? "✓" : "✕"}
                    </span>
                    <span className="text-slate-600">
                      <span className="font-medium">{rule.label}:</span> {rule.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

/**
 * Dedicated certificate PRINT page — /certificates/[id]/print.
 *
 * A bare, print-optimized route: no page chrome of its own, only the
 * certificate sheet + the auto-print trigger. The application shell
 * (sidebar/topbar/footer) is still mounted by the root layout for the
 * interactive view, but the scoped print stylesheet below removes it
 * from the print flow completely, so the browser prints EXACTLY ONE
 * A4-landscape page containing the sheet alone.
 *
 * Authorization is identical to the detail page — getCertificateView
 * enforces ownership/scope server-side before anything renders.
 */
import Link from "next/link";
import { headers } from "next/headers";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getCertificateView } from "@/lib/certificates/service";
import { qrDataUrl } from "@/lib/certificates/qr";
import { AccessDenied } from "@/app/assignments/ui";
import { CertificateSheet } from "@/app/certificates/certificate-sheet";
import { AutoPrint } from "./auto-print";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "طباعة الشهادة",
};

export default async function CertificatePrintPage({
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

  const hoursRow = await db.certificate.findUnique({
    where: { id },
    select: { course: { select: { estimatedHours: true } } },
  });
  const trainingHours = hoursRow?.course?.estimatedHours ?? null;

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const verifyUrl = `${proto}://${host}/verify?code=${view.verificationCode}`;
  const qr = await qrDataUrl(verifyUrl);

  return (
    <div id="certificate-print-page-root">
      <AutoPrint certificateNumber={view.certificateNumber} />

      <CertificateSheet
        view={view}
        qrDataUrl={qr}
        verifyUrl={verifyUrl}
        trainingHours={trainingHours}
      />

      <div className="no-print mt-6 text-center">
        <Link
          href={`/certificates/${id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          العودة إلى صفحة الشهادة
        </Link>
      </div>

      <style>{`
        @media print {
          html, body { background: #FFFFFF !important; margin: 0 !important; }
          aside, header, nav, footer, .no-print { display: none !important; }
          main > div > *:not(#certificate-print-page-root) { display: none !important; }
          #certificate-print-page-root > *:not(#certificate-print-area) { display: none !important; }
          main, main > div, #certificate-print-page-root {
            padding: 0 !important;
            margin: 0 !important;
            max-width: none !important;
            width: 100% !important;
          }
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
    </div>
  );
}

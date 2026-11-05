import { Prisma } from "@prisma/client";

import { PLATFORM_NAME_AR } from "@/config/certificates";
import { db } from "@/lib/db";
import { VerifyForm } from "./verify-form";

/**
 * Batch 1 — صفحة التحقق العام من الشهادات (public certificate
 * verification).
 *
 * The QR code printed on every certificate points here
 * (/verify?code=...). Public, no session required — the page exposes
 * ONLY the printed-on-the-sheet facts (holder name, title, school,
 * issue date, effective status, signatory), the same information the
 * original HTML verifyCertificate showed, and nothing else. Lookup
 * accepts either the 16-char verification code or the MQ-YYYY-XXXXXX
 * serial, dash/space-insensitive, case-insensitive.
 */
export const dynamic = "force-dynamic";

function normalizeQuery(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

interface VerifiedCertificate {
  certificateNumber: string;
  titleAr: string;
  teacherName: string;
  schoolName: string;
  contentTitle: string | null;
  issuedAt: Date;
  status: string;
  expiresAt: Date | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
}

async function lookup(query: string): Promise<VerifiedCertificate | null> {
  const normalized = normalizeQuery(query);
  if (!normalized) return null;
  const row = await db.certificate.findFirst({
    where: {
      OR: [{ verificationCode: normalized }, { certificateNumber: normalized }],
    },
    select: {
      certificateNumber: true,
      titleAr: true,
      status: true,
      issuedAt: true,
      expiresAt: true,
      schoolSignatoryName: true,
      schoolSignatoryTitle: true,
      teacher: { select: { name: true } },
      school: { select: { nameAr: true } },
      course: { select: { titleAr: true } },
      program: { select: { nameAr: true } },
    },
  });
  if (!row) return null;
  return {
    certificateNumber: row.certificateNumber,
    titleAr: row.titleAr,
    teacherName: row.teacher.name,
    schoolName: row.school.nameAr,
    contentTitle: row.course?.titleAr ?? row.program?.nameAr ?? null,
    issuedAt: row.issuedAt,
    status: row.status,
    expiresAt: row.expiresAt,
    signatoryName: row.schoolSignatoryName,
    signatoryTitle: row.schoolSignatoryTitle,
  };
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const query = (params.code ?? "").trim();

  let result: VerifiedCertificate | null = null;
  let lookupError: string | null = null;
  if (query) {
    try {
      result = await lookup(query);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientInitializationError ||
        error instanceof Prisma.PrismaClientKnownRequestError
      ) {
        lookupError = "تعذر الاتصال بسجل الشهادات — أعد المحاولة بعد قليل";
      } else {
        lookupError = "حدث خطأ غير متوقع أثناء التحقق";
      }
    }
  }

  const expired =
    result?.expiresAt !== null &&
    result?.expiresAt !== undefined &&
    result.expiresAt.getTime() < Date.now();
  const effectiveStatus = result
    ? result.status === "REVOKED"
      ? "REVOKED"
      : expired
        ? "EXPIRED"
        : "ISSUED"
    : null;

  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-2xl">
        <header className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-[#1D5BD6]">
            {PLATFORM_NAME_AR}
          </p>
          <h1 className="mt-2 text-2xl font-extrabold text-slate-900">
            التحقق من شهادة
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            أدخل رقم الشهادة أو رمز التحقق المطبوع عليها للتأكد من صحتها في
            سجل المنصة.
          </p>
        </header>

        <VerifyForm initialQuery={query} />

        {query && (
          <section className="mt-6">
            {lookupError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center text-sm font-semibold text-red-700">
                {lookupError}
              </div>
            ) : result ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div
                  className={
                    effectiveStatus === "ISSUED"
                      ? "bg-emerald-600 px-5 py-3 text-sm font-extrabold text-white"
                      : "bg-amber-600 px-5 py-3 text-sm font-extrabold text-white"
                  }
                >
                  {effectiveStatus === "ISSUED"
                    ? "✓ شهادة صحيحة ومسجلة في المنصة"
                    : effectiveStatus === "REVOKED"
                      ? "شهادة مُلغاة — لم تعد سارية"
                      : "شهادة منتهية الصلاحية"}
                </div>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold text-slate-400">حامل الشهادة</dt>
                    <dd className="mt-0.5 font-bold text-slate-900">{result.teacherName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-400">رقم الشهادة</dt>
                    <dd className="mt-0.5 font-mono font-bold text-slate-900" dir="ltr">
                      {result.certificateNumber}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-semibold text-slate-400">عنوان الشهادة</dt>
                    <dd className="mt-0.5 font-bold text-slate-900">{result.titleAr}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-400">الجهة المانحة</dt>
                    <dd className="mt-0.5 font-semibold text-slate-800">{result.schoolName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-400">تاريخ الإصدار</dt>
                    <dd className="mt-0.5 font-semibold text-slate-800">
                      {result.issuedAt.toLocaleDateString("ar-SA")}
                    </dd>
                  </div>
                  {result.signatoryName && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-semibold text-slate-400">توقيع المدرسة</dt>
                      <dd className="mt-0.5 font-semibold text-slate-800">
                        {result.signatoryName}
                        {result.signatoryTitle ? ` — ${result.signatoryTitle}` : ""}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            ) : (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center">
                <p className="text-sm font-extrabold text-red-700">
                  لم يتم العثور على شهادة بهذا الرقم في سجل المنصة
                </p>
                <p className="mt-1 text-xs text-red-500">
                  تأكد من إدخال الرمز أو الرقم كما هو مطبوع على الشهادة.
                </p>
              </div>
            )}
          </section>
        )}

        <footer className="mt-8 text-center text-[11px] text-slate-400">
          صفحة تحقق عامة — تعرض بيانات الشهادة المطبوعة فقط دون أي بيانات حساسة.
        </footer>
      </div>
    </main>
  );
}
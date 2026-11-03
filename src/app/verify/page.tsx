/**
 * Phase 8 — certificate verification (AUTHORIZED NON-TEACHER ROLES
 * ONLY). Teachers never reach this page: the role check below and the
 * verifyGuard inside the service both reject TEACHER server-side, and
 * no teacher navigation entry exists.
 *
 * Search accepts a certificate number OR verification code. Tenant
 * semantics: school back-office roles search within their own school;
 * SUPER_ADMIN searches platform-wide (read-only). Out-of-scope and
 * unknown codes return the SAME "not found" state — no existence leak.
 *
 * The result shows the MINIMUM information needed to establish
 * validity: number, title, teacher name, school name, content title,
 * issue date, effective status. No emails, ids, scores or notes.
 */
import {
  AccessDenied,
  Card,
  PageHeader,
  formatDate,
} from "@/app/assignments/ui";
import type { CertificateActor } from "@/lib/certificates/access";
import { verifyCertificate } from "@/lib/certificates/service";
import { getCurrentUser } from "@/lib/auth/session";
import { EffectiveStatusBadge, formatIssueDate } from "@/app/certificates/ui";

export const dynamic = "force-dynamic";

const SCOPE_HINTS: Record<string, string> = {
  DEVELOPMENT_OFFICE_MANAGER: "يشمل البحث شهادات مدرستك فقط.",
  EDUCATIONAL_SUPERVISOR: "يشمل البحث شهادات مدرستك فقط.",
  EDUCATIONAL_DEPUTY: "يشمل البحث شهادات مدرستك فقط.",
  SUPER_ADMIN: "يشمل البحث شهادات جميع مدارس المنصة (قراءة فقط).",
};

function actorFrom(user: {
  id: string;
  role: string;
  schoolId: string | null;
}): CertificateActor | null {
  if (
    user.role === "DEVELOPMENT_OFFICE_MANAGER" ||
    user.role === "EDUCATIONAL_SUPERVISOR" ||
    user.role === "EDUCATIONAL_DEPUTY" ||
    user.role === "SUPER_ADMIN"
  ) {
    return { id: user.id, role: user.role, schoolId: user.schoolId };
  }
  return null;
}

export default async function VerifyCertificatePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const ctx = actorFrom(user);
  if (!ctx) {
    return (
      <AccessDenied hint="التحقق من الشهادات متاح للأدوار الإدارية المعتمدة فقط ولا يشمل حسابات المعلمين." />
    );
  }

  const params = await searchParams;
  const query = params.code?.trim() ?? "";

  let result: Awaited<ReturnType<typeof verifyCertificate>> | null = null;
  let validationMessage: string | null = null;
  if (query) {
    result = await verifyCertificate(ctx, { query });
    if (!result.ok) {
      validationMessage = result.message;
      result = null;
    }
  }

  return (
    <div>
      <PageHeader
        title="التحقق من الشهادة"
        subtitle="ابحث برقم الشهادة أو رمز التحقق المدون على وثيقة الشهادة للتأكد من صحتها"
      />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="code">
              رقم الشهادة أو رمز التحقق
            </label>
            <input
              id="code"
              name="code"
              defaultValue={query}
              dir="ltr"
              placeholder="MQ-2026-XXXXXX أو XXXX-XXXX-XXXX-XXXX"
              className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[#1D5BD6] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
          >
            تحقق
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-400">{SCOPE_HINTS[ctx.role] ?? ""}</p>

        {validationMessage ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
            {validationMessage}
          </p>
        ) : null}

        {result && result.ok && !result.data.found ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-sm font-semibold text-slate-700">
              لا توجد شهادة مطابقة لهذا الرقم أو الرمز
            </p>
            <p className="mt-1 text-xs text-slate-400">
              تأكد من إدخال الرقم كما هو مدون على الشهادة دون تغيير.
            </p>
          </div>
        ) : null}

        {result && result.ok && result.data.found ? (
          <div className="mt-6 rounded-xl border border-slate-200 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-base font-bold text-slate-900">
                {result.data.certificate.titleAr}
              </p>
              <EffectiveStatusBadge status={result.data.certificate.effectiveStatus} />
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-400">رقم الشهادة</dt>
                <dd dir="ltr" className="font-mono text-sm font-semibold text-slate-700">
                  {result.data.certificate.certificateNumber}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">المعلم</dt>
                <dd className="font-medium text-slate-700">
                  {result.data.certificate.teacherName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">المدرسة</dt>
                <dd className="font-medium text-slate-700">
                  {result.data.certificate.schoolName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">المحتوى التدريبي</dt>
                <dd className="font-medium text-slate-700">
                  {result.data.certificate.contentTitle ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">تاريخ الإصدار</dt>
                <dd className="font-medium text-slate-700">
                  {formatIssueDate(result.data.certificate.issuedAt)}
                </dd>
              </div>
              {result.data.certificate.revokedAt ? (
                <div>
                  <dt className="text-xs text-slate-400">تاريخ الإلغاء</dt>
                  <dd className="font-medium text-red-600">
                    {formatDate(result.data.certificate.revokedAt)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-4 text-xs text-slate-400">
              هذه البيانات هي الحد الأدنى اللازم للتحقق فقط — تفاصيل التقييمات والدرجات لا تُعرض عبر أداة التحقق.
            </p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
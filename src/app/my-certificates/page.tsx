/**
 * Phase 8 — "شهاداتي" teacher workspace. Teachers see ONLY their own
 * certificates (service enforces ownership), can open the printable
 * sheet and print/save-as-PDF. No issuance, editing, revocation or
 * verification controls exist for this role — by design and by
 * server-side role checks, not just hidden UI.
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import {
  effectiveStatusOf,
  listCertificatesForTeacher,
} from "@/lib/certificates/service";
import {
  AccessDenied,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
} from "@/app/assignments/ui";
import { EffectiveStatusBadge, formatIssueDate } from "@/app/certificates/ui";

export const dynamic = "force-dynamic";

export default async function MyCertificatesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "TEACHER") {
    return (
      <AccessDenied hint="قائمة الشهادات متاحة للمعلمين فقط." />
    );
  }

  const result = await listCertificatesForTeacher(user);
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const rows = result.data;
  const active = rows.filter((row) => effectiveStatusOf(row) === "ISSUED").length;

  return (
    <div>
      <PageHeader
        title="شهاداتي"
        subtitle="شهادات الإتمام الصادرة لك عن الدورات والبرامج التدريبية — يمكنك عرضها وطباعتها أو حفظها PDF"
      />

      {rows.length > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-4">
          <StatTile label="إجمالي الشهادات" value={rows.length} tone="brand" />
          <StatTile label="صادرة وسارية" value={active} tone="success" />
        </div>
      ) : null}

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="لم تصدر لك شهادات بعد"
            hint="ستظهر هنا شهادات الإتمام فور إصدارها من مكتب التطوير بمدرستك بعد استيفاء متطلبات الدورات والبرامج."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/certificates/${row.id}`}
                      className="text-sm font-semibold text-slate-800 hover:text-[#1D5BD6] hover:underline"
                    >
                      {row.titleAr}
                    </Link>
                    <EffectiveStatusBadge status={effectiveStatusOf(row)} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.contentTitle ? `${row.contentTitle} — ` : ""}
                    صدرت في {formatIssueDate(row.issuedAt)}
                    {row.expiresAt ? ` — تنتهي في ${formatIssueDate(row.expiresAt)}` : ""}
                  </p>
                  <p dir="ltr" className="mt-1 font-mono text-xs text-slate-400">
                    {row.certificateNumber}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/certificates/${row.id}`}
                    className="rounded-lg bg-[#1D5BD6] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#174aa8]"
                  >
                    عرض وطباعة
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
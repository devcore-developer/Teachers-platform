/**
 * Phase 7 — "متابعة التكليفات" completion overview:
 *   - DEVELOPMENT_OFFICE_MANAGER: own school,
 *   - EDUCATIONAL_DEPUTY: granted schools/branches (read-only),
 *   - SUPER_ADMIN: platform-level stats only (no mutations anywhere).
 * Denominators count ELIGIBLE teachers only (targeting + scope).
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import type { AssignmentActor } from "@/lib/assignments/access";
import { getAssignmentsOverview } from "@/lib/assignments/service";
import {
  AccessDenied,
  AssignmentStatusBadge,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  formatDate,
} from "@/app/assignments/ui";

export const dynamic = "force-dynamic";

export default async function AssignmentsOverviewPage() {
  const user = await getCurrentUser();
  const OVERVIEW_ROLES = ["DEVELOPMENT_OFFICE_MANAGER", "EDUCATIONAL_DEPUTY", "SUPER_ADMIN"];
  if (!user || !OVERVIEW_ROLES.includes(user.role)) {
    return <AccessDenied hint="متابعة التكليفات متاحة لمديري المكاتب والوكلاء التعليميين." />;
  }
  // Managers and deputies are school-scoped; the super admin is platform-level.
  if (user.role !== "SUPER_ADMIN" && !user.schoolId) {
    return <AccessDenied hint="حسابك غير مرتبط بمدرسة." />;
  }
  // The runtime set is exactly these three roles (checked above); the
  // literal branches keep the AssignmentActor union type intact.
  const ctx: AssignmentActor =
    user.role === "DEVELOPMENT_OFFICE_MANAGER"
      ? { id: user.id, role: "DEVELOPMENT_OFFICE_MANAGER", schoolId: user.schoolId }
      : user.role === "EDUCATIONAL_DEPUTY"
        ? { id: user.id, role: "EDUCATIONAL_DEPUTY", schoolId: user.schoolId }
        : { id: user.id, role: "SUPER_ADMIN", schoolId: user.schoolId };

  const result = await getAssignmentsOverview(ctx);
  if (!result.ok) return <AccessDenied hint={result.message} />;
  const { cards, rows, schools, scope } = result.data;

  const scopeLabel =
    scope === "platform"
      ? "إحصاءات على مستوى المنصة (قراءة فقط)"
      : scope === "deputy"
        ? "نطاق الصلاحيات الممنوحة لك (قراءة فقط)"
        : "نطاق مدرستك";

  return (
    <div>
      <PageHeader
        title="متابعة التكليفات ونسب الإنجاز"
        subtitle={scopeLabel}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        <StatTile label="تكليفات منشورة" value={cards.assignmentsPublished} tone="brand" />
        <StatTile label="أزواج مستهدف/تكليف" value={cards.targetedPairs} />
        <StatTile label="تسليمات" value={cards.submissionsActive} />
        <StatTile label="بانتظار المراجعة" value={cards.pendingReview} tone="warning" />
        <StatTile label="أُعيدت للتعديل" value={cards.returnedCount} tone="warning" />
        <StatTile label="مُقيَّمة" value={cards.gradedCount} tone="success" />
        <StatTile label="نسبة الإنجاز" value={cards.completionRate === null ? "—" : `${cards.completionRate}%`} tone="success" />
      </div>

      {schools.length > 0 ? (
        <div className="mb-6">
          <Card title="تفصيل حسب المدرسة">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">المدرسة</th>
                    <th className="px-3 py-2 font-medium">تكليفات منشورة</th>
                    <th className="px-3 py-2 font-medium">تسليمات</th>
                    <th className="px-3 py-2 font-medium">مُقيَّمة</th>
                    <th className="px-3 py-2 font-medium">نسبة الإنجاز</th>
                  </tr>
                </thead>
                <tbody>
                  {schools.map((school) => (
                    <tr key={school.schoolId} className="border-b border-slate-100">
                      <td className="px-3 py-2.5 font-medium text-slate-800">{school.schoolName}</td>
                      <td className="px-3 py-2.5 text-slate-600">{school.assignmentsPublished}</td>
                      <td className="px-3 py-2.5 text-slate-600">{school.submissionsActive}</td>
                      <td className="px-3 py-2.5 text-slate-600">{school.gradedCount}</td>
                      <td className="px-3 py-2.5 font-semibold text-[#1D5BD6]">
                        {school.completionRate === null ? "—" : `${school.completionRate}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      <Card title="التكليفات">
        {rows.length === 0 ? (
          <EmptyState title="لا توجد تكليفات في نطاقك بعد" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">العنوان</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium">الاستحقاق</th>
                  <th className="px-3 py-2 font-medium">المستهدفون</th>
                  <th className="px-3 py-2 font-medium">سَلَّم</th>
                  <th className="px-3 py-2 font-medium">قيد المراجعة</th>
                  <th className="px-3 py-2 font-medium">أُعيد</th>
                  <th className="px-3 py-2 font-medium">مُقيَّم</th>
                  <th className="px-3 py-2 font-medium">متأخر</th>
                  <th className="px-3 py-2 font-medium">الإنجاز</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 font-medium text-slate-800">{row.titleAr}</td>
                    <td className="px-3 py-2.5"><AssignmentStatusBadge status={row.status} /></td>
                    <td className="px-3 py-2.5 text-slate-600">{formatDate(row.dueAt)}</td>
                    <td className="px-3 py-2.5 text-slate-600">{row.targeted}</td>
                    <td className="px-3 py-2.5 text-slate-600">{row.submitted}</td>
                    <td className="px-3 py-2.5 text-slate-600">{row.pending}</td>
                    <td className="px-3 py-2.5 text-slate-600">{row.returned}</td>
                    <td className="px-3 py-2.5 text-slate-600">{row.graded}</td>
                    <td className="px-3 py-2.5 text-slate-600">{row.late}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-[#1D5BD6]"
                            style={{ width: `${Math.min(100, row.completionRate ?? 0)}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-600">
                          {row.completionRate === null ? "—" : `${row.completionRate}%`}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {row.status !== "DRAFT" ? (
                        <Link
                          href={`/assignments/${row.id}/submissions`}
                          className="text-xs font-medium text-[#1D5BD6] hover:underline"
                        >
                          التسليمات
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
/**
 * Batch 3 — "مستخدمو المدرسة" (EDUCATIONAL_DEPUTY, read-only).
 *
 * The deputy browses the users of the schools granted to them via
 * DeputyGrant (school-wide grant → all users; branch grant → that
 * branch's users only). Strictly read-only: this page renders NO
 * creation or editing UI, and the underlying server actions keep
 * rejecting deputies independently — the missing button is not the
 * security boundary, the role checks in the actions are.
 */
import Link from "next/link";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { roleLabel } from "@/lib/auth/roles";
import {
  Card,
  EmptyState,
  PageHeader,
  formatDate,
} from "@/app/assignments/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "مستخدمو المدرسة",
};

const DIRECTORY_ROLES = [
  "TEACHER",
  "EDUCATIONAL_SUPERVISOR",
  "EDUCATIONAL_DEPUTY",
  "DEVELOPMENT_OFFICE_MANAGER",
  "SCHOOL_MANAGER",
  "IT_COORDINATOR",
] as const;

const PAGE_SIZE = 30;

export default async function SchoolUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; page?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "EDUCATIONAL_DEPUTY") {
    return (
      <Card>
        <EmptyState
          title="غير مصرح"
          hint="هذه الصفحة متاحة للوكيل التعليمي فقط."
        />
      </Card>
    );
  }

  // The deputy's visibility scope comes from persisted DeputyGrant rows.
  const grants = await db.deputyGrant.findMany({
    where: { userId: user.id },
    select: { schoolId: true, branchId: true },
  });

  if (grants.length === 0) {
    return (
      <div>
        <PageHeader
          title="مستخدمو المدرسة"
          subtitle="عرض للقراءة فقط داخل نطاق الاطلاع الممنوح لك"
        />
        <Card>
          <EmptyState
            title="لا يوجد نطاق اطلاع ممنوح لك بعد"
            hint="تواصل مع إدارة المنصة لمنحك صلاحية الاطلاع على مدرسة أو فرع محدد."
          />
        </Card>
      </div>
    );
  }

  const schoolIds = Array.from(new Set(grants.map((grant) => grant.schoolId)));
  const wholeSchoolGrants = new Set(
    grants.filter((grant) => grant.branchId === null).map((grant) => grant.schoolId)
  );

  const params = await searchParams;
  const q = params.q?.trim();
  const roleFilter =
    params.role && (DIRECTORY_ROLES as readonly string[]).includes(params.role)
      ? params.role
      : null;
  const page = Number(params.page ?? "1") || 1;

  // Load candidates from the granted schools, then apply branch-level
  // grants in memory (a branch grant narrows the school-wide list).
  const candidates = await db.user.findMany({
    where: {
      schoolId: { in: schoolIds },
      role: { in: [...DIRECTORY_ROLES] },
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
            ],
          }
        : {}),
    },
    include: {
      branch: { select: { nameAr: true } },
      school: { select: { nameAr: true } },
    },
    orderBy: [{ name: "asc" }],
  });

  const visible = candidates.filter((candidate) => {
    if (!candidate.schoolId) return false;
    if (wholeSchoolGrants.has(candidate.schoolId)) return true;
    return grants.some(
      (grant) =>
        grant.schoolId === candidate.schoolId &&
        grant.branchId !== null &&
        grant.branchId === candidate.branchId
    );
  });

  const filtered = roleFilter
    ? visible.filter((candidate) => candidate.role === roleFilter)
    : visible;

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Current supervisor per visible teacher (from persisted assignments).
  const teacherIds = rows
    .filter((row) => row.role === "TEACHER")
    .map((row) => row.id);
  const supervisorLinks =
    teacherIds.length > 0
      ? await db.teacherSupervisorAssignment.findMany({
          where: { teacherId: { in: teacherIds } },
          select: { teacherId: true, supervisor: { select: { name: true } } },
        })
      : [];
  const supervisorByTeacher = new Map(
    supervisorLinks.map((link) => [link.teacherId, link.supervisor.name])
  );

  return (
    <div>
      <PageHeader
        title="مستخدمو المدرسة"
        subtitle="عرض للقراءة فقط — المعلمون والمشرفون وأصحاب الأدوار داخل نطاق اطلاعك"
      />

      <Card>
        <form className="mb-5 flex flex-wrap items-end gap-3" method="get">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">
              بحث بالاسم أو البريد
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q ?? ""}
              placeholder="اكتب جزءًا من الاسم أو البريد…"
              className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6] focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="role">
              الدور
            </label>
            <select
              id="role"
              name="role"
              defaultValue={roleFilter ?? ""}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1D5BD6]"
            >
              <option value="">كل الأدوار</option>
              {DIRECTORY_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            تصفية
          </button>
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title="لا توجد حسابات مطابقة"
            hint="جرّب تعديل البحث أو التصفية داخل نطاق اطلاعك الممنوح."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">الاسم</th>
                  <th className="px-3 py-2 font-medium">الدور</th>
                  <th className="px-3 py-2 font-medium">المدرسة</th>
                  <th className="px-3 py-2 font-medium">الفرع</th>
                  <th className="px-3 py-2 font-medium">المشرف المسؤول</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium">تاريخ الإضافة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-800">{row.name}</p>
                      <p className="text-xs text-slate-400" dir="ltr">{row.email}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{roleLabel(row.role)}</td>
                    <td className="px-3 py-3 text-slate-600">{row.school?.nameAr ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-600">{row.branch?.nameAr ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {row.role === "TEACHER"
                        ? supervisorByTeacher.get(row.id) ?? "—"
                        : "—"}
                    </td>
                    <td className="px-3 py-3">
                      {row.isActive ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          نشط
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                          موقوف
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-500">{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 ? (
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>
              الصفحة {currentPage} من {pageCount} — {total} حسابًا
            </span>
            <div className="flex gap-2">
              {currentPage > 1 ? (
                <Link
                  href={`/school-users?page=${currentPage - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}${roleFilter ? `&role=${roleFilter}` : ""}`}
                  className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                >
                  السابق
                </Link>
              ) : null}
              {currentPage < pageCount ? (
                <Link
                  href={`/school-users?page=${currentPage + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}${roleFilter ? `&role=${roleFilter}` : ""}`}
                  className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
                >
                  التالي
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
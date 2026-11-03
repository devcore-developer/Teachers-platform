import Link from "next/link";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { DirectoryFilters } from "@/components/users/directory-filters";
import { StaffCreateForm } from "@/components/users/staff-create-form";
import { StatusBadge } from "@/components/platform/status-badge";
import { EmptyState } from "@/components/platform/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { roleLabel } from "@/lib/auth/roles";
import { listUsersForDirectory } from "@/lib/users/directory";
import { listSchools } from "@/lib/schools/service";
import { db } from "@/lib/db";
import { DIRECTORY_ROLE_FILTER, USERS_PAGE_SIZE } from "@/lib/validation/users";

export const metadata = {
  title: "دليل المستخدمين",
};

/**
 * Phase 4 — user directory. SUPER_ADMIN browses the whole platform
 * (with an optional school filter); DEVELOPMENT_OFFICE_MANAGER is
 * structurally scoped to their own school by the service layer. All
 * rows and counts come from persisted data.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireAdminContext();

  const params = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? (value[0] ?? "") : (value ?? ""),
    ])
  );

  const result = await listUsersForDirectory(ctx, flat);

  // Filter dropdown data — office managers only ever see their school.
  const schools =
    ctx.role === "SUPER_ADMIN" ? await listSchools() : [];
  const effectiveSchoolId =
    ctx.role === "DEVELOPMENT_OFFICE_MANAGER"
      ? ctx.schoolId
      : (flat.schoolId as string | undefined) || undefined;
  const branchOptions = effectiveSchoolId
    ? await db.branch.findMany({
        where: { schoolId: effectiveSchoolId },
        select: { id: true, nameAr: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // Staff-creation dropdown data (compact: platform schools).
  const schoolsForCreate =
    ctx.role === "SUPER_ADMIN"
      ? (await listSchools()).map((school) => ({
          id: school.id,
          nameAr: school.nameAr,
          isActive: school.isActive,
        }))
      : [];

  const roleOptions = DIRECTORY_ROLE_FILTER.map((role) => ({
    value: role,
    label: roleLabel(role),
  }));

  function pageHref(page: number): string {
    const sp = new URLSearchParams(
      Object.entries(flat).filter(([, v]) => v !== "")
    );
    sp.set("page", String(page));
    return `/users?${sp.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="دليل المستخدمين"
        description={
          ctx.role === "SUPER_ADMIN"
            ? "جميع حسابات المنصة عبر المدارس: الأدوار والحالات والإسنادات — إدارة مديري مكاتب التطوير من صفحة إدارة الحسابات."
            : "حسابات مدرستك: المعلمون والمشرفون والوكلاء — الأدوار والحالات والإسنادات."
        }
        breadcrumbs={[{ label: "دليل المستخدمين" }]}
      />

      <div className="space-y-6">
        <StaffCreateForm
          actorRole={ctx.role}
          schools={schoolsForCreate}
          schoolId={ctx.role === "DEVELOPMENT_OFFICE_MANAGER" ? ctx.schoolId : undefined}
          branches={branchOptions}
        />

        <DirectoryFilters
          roleOptions={roleOptions}
          schools={schools.map((school) => ({ id: school.id, nameAr: school.nameAr }))}
          branches={branchOptions}
          showSchoolFilter={ctx.role === "SUPER_ADMIN"}
        />

        {result.ok ? (
          <div className="overflow-hidden rounded-xl border bg-card">
            {result.data.rows.length === 0 ? (
              <EmptyState
                icon={UserRound}
                title="لا توجد حسابات مطابقة"
                description="جرّب تعديل كلمات البحث أو الفلاتر — أو أنشئ حسابًا جديدًا من النموذج أعلاه."
                className="rounded-none border-0 bg-transparent"
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>المستخدم</TableHead>
                        <TableHead>الدور</TableHead>
                        <TableHead>المدرسة</TableHead>
                        <TableHead>الفرع</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead>آخر دخول</TableHead>
                        <TableHead aria-label="تفاصيل" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.data.rows.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <p className="text-sm font-bold">{user.name}</p>
                            <p className="text-xs text-muted-foreground" dir="ltr">
                              {user.email}
                            </p>
                          </TableCell>
                          <TableCell className="text-sm">{roleLabel(user.role)}</TableCell>
                          <TableCell className="text-sm">
                            {user.schoolName ?? (
                              <span className="text-muted-foreground">— منصة</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {user.branchName ?? (
                              <span className="text-muted-foreground">— بدون فرع</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <StatusBadge tone={user.isActive ? "success" : "error"}>
                                {user.isActive ? "نشط" : "موقوف"}
                              </StatusBadge>
                              <StatusBadge
                                tone={user.isVerified ? "info" : "warning"}
                                withDot={false}
                              >
                                {user.isVerified ? "بريد موثّق" : "بانتظار التأكيد"}
                              </StatusBadge>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {user.lastLoginLabel ?? "لم يسجّل بعد"}
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/users/${user.id}`}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
                            >
                              التفاصيل
                              <ChevronLeft className="size-3.5" aria-hidden="true" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination — real server-computed pages, params preserved */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    الإجمالي: {result.data.total} حساب — صفحة {result.data.page} من{" "}
                    {result.data.pageCount} ({USERS_PAGE_SIZE} لكل صفحة)
                  </p>
                  <div className="flex items-center gap-2">
                    {result.data.page > 1 ? (
                      <Link
                        href={pageHref(result.data.page - 1)}
                        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-accent"
                        aria-label="الصفحة السابقة"
                      >
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                        السابقة
                      </Link>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold text-muted-foreground/50"
                        aria-disabled="true"
                      >
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                        السابقة
                      </span>
                    )}
                    {result.data.page < result.data.pageCount ? (
                      <Link
                        href={pageHref(result.data.page + 1)}
                        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-accent"
                        aria-label="الصفحة التالية"
                      >
                        التالية
                        <ChevronLeft className="size-3.5" aria-hidden="true" />
                      </Link>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold text-muted-foreground/50"
                        aria-disabled="true"
                      >
                        التالية
                        <ChevronLeft className="size-3.5" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm font-semibold text-destructive"
          >
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}
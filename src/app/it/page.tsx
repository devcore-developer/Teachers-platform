import { redirect } from "next/navigation";
import { KeyRound, Search, UserCheck, UserRound, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
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
import { requireItCoordinatorContext } from "@/lib/auth/dev-admin";
import { getItWorkspace } from "@/lib/users/directory";

import { TeacherAssignmentControls, TeacherRecoveryForm } from "./it-forms";

export const metadata = {
  title: "مساحة تقنية المعلومات",
};

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <span className="mt-0.5 block text-xl font-extrabold">{value}</span>
      </span>
    </div>
  );
}

/**
 * IT coordinator workspace — REAL persisted data, confined to the
 * coordinator's own school: teacher→supervisor assignment (list, search,
 * filters, assign/move/remove) and secure teacher account recovery.
 */
export default async function ItWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireItCoordinatorContext();

  const params = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? (value[0] ?? "") : (value ?? ""),
    ])
  );

  const data = await getItWorkspace(ctx, {
    q: typeof flat.q === "string" && flat.q.trim() ? flat.q.trim() : undefined,
    status:
      flat.status === "ACTIVE" || flat.status === "INACTIVE" ? flat.status : "ALL",
    assignment:
      flat.assignment === "ASSIGNED" || flat.assignment === "UNASSIGNED"
        ? flat.assignment
        : "ALL",
  });
  if (!data) redirect("/forbidden");

  return (
    <div>
      <PageHeader
        title="مساحة تقنية المعلومات"
        description={`مدرستك: ${data.school.nameAr} — صلاحيتك محصورة داخلها.`}
        breadcrumbs={[{ label: "مساحة تقنية المعلومات" }]}
      />

      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard icon={Users} label="إجمالي المعلمين" value={data.stats.teachersTotal} />
          <StatCard icon={UserRound} label="معلمون نشطون" value={data.stats.activeTeachers} />
          <StatCard icon={UserCheck} label="المشرفون النشطون" value={data.stats.supervisorsTotal} />
          <StatCard icon={UserCheck} label="معلمون مُسندون" value={data.stats.assignedTeachers} />
          <StatCard icon={Users} label="بدون إسناد" value={data.stats.unassignedTeachers} />
        </div>

        <SectionCard
          title="استعادة حساب معلم"
          description="تُرسل رسالة فيها رابط استعادة صالح لاستخدام واحد ومحدد بوقت — إلى بريد المعلم المسجل. لا تُعرض كلمات المرور إطلاقًا."
        >
          <TeacherRecoveryForm />
        </SectionCard>

        <SectionCard
          title="إسناد المعلمين للمشرفين"
          description="ابحث وصفِّ القائمة، ثم أسند المعلم إلى مشرف أو انقله أو أزل إسناده — التغيير يسري فورًا."
        >
          {/* Server-side filters — plain GET form, no client state. */}
          <form method="get" action="/it" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-muted-foreground">بحث</span>
              <div className="relative">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="text"
                  name="q"
                  defaultValue={flat.q ?? ""}
                  placeholder="اسم أو بريد المعلم…"
                  className="h-10 w-64 rounded-lg border bg-background ps-8 pe-3 text-sm"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-muted-foreground">الحالة</span>
              <select
                name="status"
                defaultValue={(flat.status as string) || "ALL"}
                className="h-10 rounded-lg border bg-background px-2 text-sm"
              >
                <option value="ALL">الكل</option>
                <option value="ACTIVE">نشط</option>
                <option value="INACTIVE">موقوف</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-muted-foreground">الإسناد</span>
              <select
                name="assignment"
                defaultValue={(flat.assignment as string) || "ALL"}
                className="h-10 rounded-lg border bg-background px-2 text-sm"
              >
                <option value="ALL">الكل</option>
                <option value="ASSIGNED">مُسند</option>
                <option value="UNASSIGNED">غير مُسند</option>
              </select>
            </label>
            <button
              type="submit"
              className="h-10 rounded-lg border px-4 text-sm font-bold transition-colors hover:bg-accent"
            >
              تطبيق
            </button>
          </form>

          {data.teachers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="لا يوجد معلمون مطابقون"
              description="جرّب تعديل كلمات البحث أو الفلاتر."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المعلم</TableHead>
                    <TableHead>الفرع</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>المشرف الحالي</TableHead>
                    <TableHead>الإسناد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.teachers.map((teacher) => (
                    <TableRow key={teacher.id}>
                      <TableCell>
                        <p className="text-sm font-bold">{teacher.name}</p>
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {teacher.email}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {teacher.branchName ?? "— بدون فرع"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge tone={teacher.isActive ? "success" : "error"}>
                            {teacher.isActive ? "نشط" : "موقوف"}
                          </StatusBadge>
                          <StatusBadge
                            tone={teacher.isVerified ? "info" : "warning"}
                            withDot={false}
                          >
                            {teacher.isVerified ? "موثّق" : "غير موثّق"}
                          </StatusBadge>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {teacher.supervisor ? teacher.supervisor.name : "— لا يوجد"}
                      </TableCell>
                      <TableCell>
                        <TeacherAssignmentControls
                          teacherId={teacher.id}
                          supervisors={data.supervisors}
                          currentSupervisorId={teacher.supervisor?.id ?? null}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
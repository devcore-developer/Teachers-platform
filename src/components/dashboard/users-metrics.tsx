import { db } from "@/lib/db";

type UsersMetricsProps = {
  schoolId?: string | null;
};

type RoleGroup = {
  role: string;
  _count: {
    _all: number;
  };
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "مدير النظام",
  SCHOOL_MANAGER: "مدير مدرسة",
  DEVELOPMENT_OFFICE_MANAGER: "مدير مكتب التطوير",
  EDUCATIONAL_SUPERVISOR: "مشرف تربوي",
  IT_COORDINATOR: "منسق تقنية المعلومات",
  TEACHER: "معلم",
};

const cardClassName = "rounded-xl border border-border bg-card p-4";

export async function UsersMetricsSection({ schoolId }: UsersMetricsProps) {
  let groups: RoleGroup[] = [];
  let failed = false;

  try {
    const result = await db.user.groupBy({
      by: ["role"],
      _count: { _all: true },
      where: schoolId ? { schoolId } : undefined,
    });
    groups = result;
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <div className={cardClassName}>
        <p className="text-sm text-muted-foreground">
          تعذر تحميل إحصائيات المستخدمين حالياً. حاول تحديث الصفحة.
        </p>
      </div>
    );
  }

  const total = groups.reduce((sum: number, g) => sum + g._count._all, 0);

  if (groups.length === 0) {
    return (
      <div className={cardClassName}>
        <p className="text-sm text-muted-foreground">
          لا يوجد مستخدمون {schoolId ? "في هذه المدرسة" : "على المنصة"} بعد.
        </p>
      </div>
    );
  }

  const countsByRole = new Map<string, number>();
  for (const g of groups) {
    countsByRole.set(g.role, g._count._all);
  }

  const knownRoles = Object.keys(ROLE_LABELS);
  const extraRoles = groups.map((g) => g.role).filter((role) => !(role in ROLE_LABELS));

  return (
    <div className="space-y-4">
      <div className={cardClassName}>
        <p className="text-sm text-muted-foreground">إجمالي المستخدمين</p>
        <p className="mt-2 text-2xl font-bold">{total}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {knownRoles.map((role) => (
          <div key={role} className={cardClassName}>
            <p className="text-sm text-muted-foreground">{ROLE_LABELS[role]}</p>
            <p className="mt-2 text-2xl font-bold">{countsByRole.get(role) ?? 0}</p>
          </div>
        ))}

        {extraRoles.map((role) => (
          <div key={role} className={cardClassName}>
            <p className="text-sm text-muted-foreground">{role}</p>
            <p className="mt-2 text-2xl font-bold">{countsByRole.get(role) ?? 0}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
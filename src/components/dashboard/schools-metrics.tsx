import { db } from "@/lib/db";

type SchoolsMetricsProps = {
  schoolId: string | null;
};

type SchoolRecord = {
  nameAr: string;
  nameEn: string | null;
  slug: string;
  isActive: boolean;
  brandColor: string | null;
  createdAt: Date;
};

const cardClassName = "rounded-xl border border-border bg-card p-4";

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className={cardClassName}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

export async function SchoolsMetrics({ schoolId }: SchoolsMetricsProps) {
  if (schoolId) {
    let school: SchoolRecord | null = null;

    try {
      school = await db.school.findUnique({
        where: { id: schoolId },
        select: {
          nameAr: true,
          nameEn: true,
          slug: true,
          isActive: true,
          brandColor: true,
          createdAt: true,
        },
      });
    } catch {
      school = null;
    }

    if (!school) {
      return (
        <div className={cardClassName}>
          <p className="text-sm text-muted-foreground">
            لم يتم العثور على بيانات المدرسة المرتبطة بحسابك.
          </p>
        </div>
      );
    }

    let usersCount: number | null = null;
    try {
      usersCount = await db.user.count({ where: { schoolId } });
    } catch {
      usersCount = null;
    }

    const createdAtLabel = new Intl.DateTimeFormat("ar-EG", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(school.createdAt);

    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="inline-block h-4 w-4 rounded-full border border-border"
            style={{ backgroundColor: school.brandColor ?? "#2563eb" }}
          />
          <h3 className="text-lg font-bold">{school.nameAr}</h3>
          <span
            className={
              school.isActive
                ? "rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success"
                : "rounded-full bg-error/10 px-3 py-1 text-xs font-medium text-error"
            }
          >
            {school.isActive ? "نشطة" : "موقوفة"}
          </span>
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">الاسم بالإنجليزية</dt>
            <dd className="mt-1 text-sm font-medium" dir="ltr">
              {school.nameEn ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">المعرّف (Slug)</dt>
            <dd className="mt-1 text-sm font-medium" dir="ltr">
              {school.slug}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">عدد المستخدمين المرتبطين</dt>
            <dd className="mt-1 text-sm font-medium">
              {usersCount === null ? "—" : usersCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">تاريخ الإنشاء</dt>
            <dd className="mt-1 text-sm font-medium">{createdAtLabel}</dd>
          </div>
        </dl>
      </div>
    );
  }

  const [totalSchools, activeSchools, inactiveSchools] = await Promise.all([
    db.school.count(),
    db.school.count({ where: { isActive: true } }),
    db.school.count({ where: { isActive: false } }),
  ]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard label="إجمالي المدارس" value={totalSchools} />
      <MetricCard label="مدارس نشطة" value={activeSchools} />
      <MetricCard label="مدارس موقوفة" value={inactiveSchools} />
    </div>
  );
}
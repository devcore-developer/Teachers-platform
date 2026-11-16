import { db } from "@/lib/db";
import { getSchoolRegistrationStats } from "@/lib/registration-links/service";

type RegistrationMetricsProps = {
  schoolId?: string | null;
};

type StatsResult = Awaited<ReturnType<typeof getSchoolRegistrationStats>>;

const cardClassName = "rounded-xl border border-border bg-card p-4";

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className={cardClassName}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

export async function RegistrationMetricsSection({
  schoolId,
}: RegistrationMetricsProps) {
  if (schoolId) {
    let stats: StatsResult | null = null;

    try {
      stats = await getSchoolRegistrationStats(schoolId);
    } catch {
      stats = null;
    }

    if (!stats) {
      return (
        <div className={cardClassName}>
          <p className="text-sm text-muted-foreground">
            تعذر تحميل إحصائيات تسجيل المعلمين حالياً. حاول تحديث الصفحة.
          </p>
        </div>
      );
    }

    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="إجمالي المعلمين" value={stats.totalTeachers} />
        <MetricCard label="سجلوا عبر روابط التسجيل" value={stats.viaLinks} />
        <MetricCard label="بانتظار تفعيل البريد (حسابات قديمة)" value={stats.awaitingVerification} />
        <MetricCard label="مفعّلون بدون تعيين" value={stats.verifiedUnassigned} />
        <MetricCard label="تم تعيينهم" value={stats.assigned} />
      </div>
    );
  }

  const [totalSchools, totalTeachers, verifiedUsers] = await Promise.all([
    db.school.count(),
    db.user.count({ where: { role: "TEACHER" } }),
    db.user.count({ where: { emailVerifiedAt: { not: null } } }),
  ]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard label="إجمالي المدارس" value={totalSchools} />
      <MetricCard label="إجمالي المعلمين" value={totalTeachers} />
      <MetricCard label="حسابات موثّق بريدها" value={verifiedUsers} />
    </div>
  );
}
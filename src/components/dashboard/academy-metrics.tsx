import { BookOpen } from "lucide-react";

interface AcademyMetricsProps {
  schoolId?: string;
}

export function AcademyMetricsSection({ schoolId }: AcademyMetricsProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">
        {schoolId ? "الأكاديمية — مدرستك" : "الأكاديمية — المنصة"}
      </h2>
      <div className="rounded-xl border border-dashed bg-card p-8 text-center">
        <BookOpen className="mx-auto size-10 text-muted-foreground/40" aria-hidden="true" />
        <p className="mt-3 font-bold">لا توجد بيانات أكاديمية متاحة بعد</p>
        <p className="mt-1 text-sm text-muted-foreground">
          سيُعرض هنا إحصاءات حقيقية بمجرد ربط مصدر بيانات الأكاديمية — بدون أي بيانات تجريبية.
        </p>
      </div>
    </section>
  );
}
import Link from "next/link";
import { Archive } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { EmptyState } from "@/components/platform/empty-state";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { getActiveAcademicYear } from "@/lib/academic-year";
import {
  currentYearTable,
  getArchive,
  listArchives,
} from "@/lib/training/archive";
import { ANNUAL_HOURS_TARGET, annualHoursPercent } from "@/config/growth";
import { ArchiveActions } from "@/app/training-archive/archive-actions";

export const metadata = {
  title: "السجل التدريبي السنوي | منارة قرطبة",
};

/**
 * Batch 2 — the yearly training record (HTML v26TrainingArchivePage
 * parity): the active academic year's per-teacher hours vs the 35-hour
 * target, one-tap yearly archive, "عام دراسي جديد", and the archived
 * years with their frozen snapshots.
 */
export default async function TrainingArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const actor = await requireAdminContext();
  const { year: detailYear } = await searchParams;

  const archiveActor = { id: actor.id, role: actor.role, schoolId: actor.schoolId };
  const [{ year: activeYear, rows }, archivesResult] = await Promise.all([
    currentYearTable(archiveActor),
    listArchives(archiveActor),
  ]);
  const archives = archivesResult.ok ? archivesResult.data : [];
  const settingYear = await getActiveAcademicYear();
  void settingYear;

  const detailResult = detailYear ? await getArchive(archiveActor, detailYear) : null;
  const detail = detailResult && detailResult.ok ? detailResult.data : null;

  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
  const reachedTarget = rows.filter((row) => row.hours >= ANNUAL_HOURS_TARGET).length;

  return (
    <div>
      <PageHeader
        title="السجل التدريبي السنوي"
        description={`بيانات التدريب للعام الدراسي الحالي مع إمكانية الأرشفة السنوية — كل دورة وإكمال يُسجل بعام الدراسي دون فقد البيانات.`}
        breadcrumbs={[
          { label: "الرئيسية" },
          { label: "السجل التدريبي السنوي" },
        ]}
        meta={
          <StatusBadge tone="info" withDot={false}>
            العام الحالي: {activeYear}
          </StatusBadge>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-2xl font-black tabular-nums">{rows.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">معلمون لديهم ساعات هذا العام</p>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-2xl font-black tabular-nums">
            {Math.round(totalHours * 10) / 10}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">إجمالي الساعات ({activeYear})</p>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-2xl font-black tabular-nums">
            {reachedTarget} / {rows.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            أكملوا هدف {ANNUAL_HOURS_TARGET} ساعة
          </p>
        </div>
      </div>

      <ArchiveActions activeYear={activeYear} />

      <div className="mt-6 space-y-6">
        <SectionCard
          title={`ساعات المعلمين — ${activeYear}`}
          description="جدول السنوي الحقيقي: الدورات المكتملة والساعات لكل معلم (بيانات العام الحالي قبل الأرشفة)."
        >
          {rows.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="لا توجد ساعات مسجلة هذا العام بعد"
              description="أكملت الدورات تُحتسب تلقائيًا هنا بعامها الدراسي."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 text-start font-semibold">المعلم</th>
                    <th className="py-2 text-start font-semibold">المجمع</th>
                    <th className="py-2 text-start font-semibold">الدورات المكتملة</th>
                    <th className="py-2 text-start font-semibold">الساعات</th>
                    <th className="py-2 text-start font-semibold">من الهدف</th>
                    <th className="py-2 text-start font-semibold">العام</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.teacherId} className="border-b last:border-b-0">
                      <td className="py-2.5 font-semibold">{row.teacherName}</td>
                      <td className="py-2.5">{row.schoolName ?? "—"}</td>
                      <td className="py-2.5 tabular-nums">{row.completions}</td>
                      <td className="py-2.5 tabular-nums">{row.hours}</td>
                      <td className="py-2.5 tabular-nums">
                        {annualHoursPercent(row.hours)}%
                      </td>
                      <td className="py-2.5">{row.academicYear}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="الأعوام المؤرشفة"
          description="كل أرشفة تحفظ نسخة ثابتة من دورات وإكمالات وشهادات العام — الاعتماد مرة جديدة يستبدل نسخة نفس العام فقط."
        >
          {archives.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد أعوام مؤرشفة بعد.</p>
          ) : (
            <ul className="space-y-2" role="list">
              {archives.map((archive) => (
                <li
                  key={archive.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/60 p-3"
                >
                  <div>
                    <p className="text-sm font-black">{archive.academicYear}</p>
                    <p className="text-xs text-muted-foreground">
                      أرشيف بتاريخ {archive.archivedAt.toLocaleDateString("ar-EG")} ·{" "}
                      {archive.completionsCount} إكمال · {archive.coursesCount} دورة ·{" "}
                      {archive.certificatesCount} شهادة
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone="success" withDot={false}>
                      مؤرشف
                    </StatusBadge>
                    <Link
                      href={`/training-archive?year=${encodeURIComponent(archive.academicYear)}`}
                      className="text-xs font-bold text-brand-600 hover:text-brand-700"
                    >
                      عرض التفاصيل
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {detailYear && (
          <SectionCard
            title={`تفاصيل أرشيف ${detailYear}`}
            description={
              detail
                ? `نسخة بتاريخ ${detail.summary.archivedAt.toLocaleDateString("ar-EG")} — ${detail.snapshot.courses.length} دورة، ${detail.snapshot.completions.length} إكمال، ${detail.snapshot.certificates.length} شهادة.`
                : "لا يوجد أرشيف بهذا العام في نطاقك."
            }
          >
            {detail && (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="mb-2 font-bold">الدورات ({detail.snapshot.courses.length})</p>
                  <ul className="divide-y rounded-xl border" role="list">
                    {detail.snapshot.courses.slice(0, 20).map((course) => (
                      <li key={course.id} className="flex justify-between gap-2 px-3 py-2">
                        <span className="font-semibold">{course.titleAr}</span>
                        <span className="text-xs text-muted-foreground">
                          {course.category} · {course.hours ?? "—"} ساعة
                        </span>
                      </li>
                    ))}
                    {detail.snapshot.courses.length > 20 && (
                      <li className="px-3 py-2 text-xs text-muted-foreground">
                        … و{detail.snapshot.courses.length - 20} دورة أخرى
                      </li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 font-bold">الشهادات ({detail.snapshot.certificates.length})</p>
                  <ul className="divide-y rounded-xl border" role="list">
                    {detail.snapshot.certificates.slice(0, 20).map((certificate) => (
                      <li key={certificate.id} className="flex justify-between gap-2 px-3 py-2">
                        <span className="font-semibold">{certificate.teacherName}</span>
                        <span className="text-xs text-muted-foreground" dir="ltr">
                          {certificate.certificateNumber}
                        </span>
                      </li>
                    ))}
                    {detail.snapshot.certificates.length > 20 && (
                      <li className="px-3 py-2 text-xs text-muted-foreground">
                        … و{detail.snapshot.certificates.length - 20} شهادة أخرى
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}
/**
 * Phase 8 — shared professional-growth projection renderer. Used by
 * the teacher's own page (/my-growth) and the authorized drill-down
 * (/growth/[teacherId]) so both roles see the SAME honest projection
 * of the SAME persisted data.
 */
import Link from "next/link";

import {
  Card,
  EmptyState,
  SubmissionStatusBadge,
  formatDate,
} from "@/app/assignments/ui";
import { EffectiveStatusBadge } from "@/app/certificates/ui";
import type { TeacherGrowthProjection } from "@/lib/growth/service";
import {
  GrowthStatTile,
  GrowthTimeline,
  ProgressBar,
  RequirementChip,
} from "@/app/growth/ui";

export function GrowthProjection({ data }: { data: TeacherGrowthProjection }) {
  const { totals } = data;
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <GrowthStatTile
          label="دورات مكتملة"
          value={`${totals.coursesCompleted}/${totals.coursesEnrolled}`}
          hint="وفق متطلبات الإتمام لكل دورة"
          tone="success"
        />
        <GrowthStatTile
          label="تقييمات مجتازة"
          value={`${totals.assessmentsPassed}/${totals.assessmentsTotal}`}
          tone="brand"
        />
        <GrowthStatTile
          label="تكليفات مُقيَّمة"
          value={`${totals.assignmentsGraded}/${totals.assignmentsTargeted}`}
          hint="من إجمالي التكليفات الموجهة للمعلم"
        />
        <GrowthStatTile
          label="شهادات سارية"
          value={totals.certificatesActive}
          tone="brand"
        />
      </div>

      {/* courses */}
      <Card title="الدورات والبرامج التدريبية">
        {data.courses.length === 0 ? (
          <EmptyState
            title="لم يُسجَّل أي التحق بدورات تدريبية بعد"
            hint="الالتحاق بالدورات من الأكاديمية التدريبية سيظهر هنا تلقائيًا."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">الدورة</th>
                  <th className="px-3 py-2 font-medium">البرنامج</th>
                  <th className="px-3 py-2 font-medium">تاريخ الالتحاق</th>
                  <th className="px-3 py-2 font-medium">التقييمات المجتازة</th>
                  <th className="px-3 py-2 font-medium">التقدم</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.courses.map((course) => (
                  <tr key={course.courseId} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3 font-medium text-slate-800">{course.courseTitle}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{course.programName ?? "—"}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatDate(course.enrolledAt)}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {course.assessmentsPassed}/{course.assessmentsTotal}
                    </td>
                    <td className="px-3 py-3">
                      <ProgressBar
                        percent={
                          course.assessmentsTotal > 0
                            ? Math.round(
                                (course.assessmentsPassed / course.assessmentsTotal) * 100
                              )
                            : course.requirementsMet
                              ? 100
                              : null
                        }
                      />
                    </td>
                    <td className="px-3 py-3">
                      <RequirementChip
                        met={course.requirementsMet}
                        label={
                          course.assessmentsTotal === 0
                            ? "بدون تقييمات مرتبطة"
                            : "متطلبات الإتمام"
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* assessments */}
      <Card title="نتائج التقييمات">
        {data.assessments.length === 0 ? (
          <EmptyState
            title="لا توجد تقييمات مرتبطة بالدورات المسجلة"
            hint="نتائج التقييمات تظهر فور دخول المحاولات في اختبارات هذه الدورات."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">التقييم</th>
                  <th className="px-3 py-2 font-medium">الدورة</th>
                  <th className="px-3 py-2 font-medium">المحاولات</th>
                  <th className="px-3 py-2 font-medium">أفضل نتيجة</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.assessments.map((assessment) => (
                  <tr key={assessment.assessmentId} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-3 font-medium text-slate-800">{assessment.titleAr}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{assessment.courseTitle}</td>
                    <td className="px-3 py-3 text-slate-600">{assessment.attemptsCount}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {assessment.bestPercentage !== null ? `${assessment.bestPercentage}%` : "—"}
                    </td>
                    <td className="px-3 py-3">
                      {assessment.passed ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                          مجتاز
                        </span>
                      ) : (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                          غير مجتاز
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* assignments */}
      <Card title="التكليفات">
        {data.assignments.length === 0 ? (
          <EmptyState title="لا توجد تكليفات موجهة لهذا المعلم حاليًا" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.assignments.map((assignment) => (
              <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{assignment.titleAr}</span>
                    {assignment.myStatus ? (
                      <SubmissionStatusBadge status={assignment.myStatus} />
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    الاستحقاق: {formatDate(assignment.dueAt)}
                    {assignment.courseTitle ? ` — ${assignment.courseTitle}` : ""}
                    {assignment.scoreTotal !== null
                      ? ` — الدرجة: ${assignment.scoreTotal}/${assignment.totalPoints}`
                      : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* certificates */}
      <Card
        title="الشهادات"
        actions={
          data.certificates.length > 0 ? (
            <Link
              href="/certificates"
              className="text-xs font-medium text-[#1D5BD6] hover:underline"
            >
              إدارة الشهادات
            </Link>
          ) : undefined
        }
      >
        {data.certificates.length === 0 ? (
          <EmptyState
            title="لا توجد شهادات صادرة بعد"
            hint="تصدر الشهادات من مكتب التطوير بعد استيفاء متطلبات الإتمام وفق قواعد الاستحقاق."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.certificates.map((certificate) => (
              <li key={certificate.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/certificates/${certificate.id}`}
                      className="text-sm font-semibold text-slate-800 hover:text-[#1D5BD6] hover:underline"
                    >
                      {certificate.titleAr}
                    </Link>
                    <EffectiveStatusBadge status={certificate.effectiveStatus} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {certificate.contentTitle ? `${certificate.contentTitle} — ` : ""}
                    صدرت في {formatDate(certificate.issuedAt)}
                  </p>
                </div>
                <span dir="ltr" className="font-mono text-xs text-slate-400">
                  {certificate.certificateNumber}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* chronological history */}
      <Card title="السجل الزمني للتطور المهني">
        <GrowthTimeline events={data.history} />
      </Card>
    </div>
  );
}
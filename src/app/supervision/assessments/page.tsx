import Link from "next/link";
import { ClipboardCheck, Pencil, Plus } from "lucide-react";

import {
  EmptyHint,
  Panel,
  Pill,
  formatDate,
  statusLabel,
  statusTone,
} from "@/app/supervision/supervisor-ui";
import { AssessmentsCreateForm } from "@/app/supervision/assessments/assessments-manager";
import { listSupervisorResults } from "@/lib/assessment/service";
import {
  listSupervisorAssessments,
  listSupervisorImpactCourseOptions,
  requireSupervisorContext,
} from "@/lib/supervision/training";

export const metadata = { title: "الأسئلة والاختبارات — المشرف التربوي" };

const ATTEMPT_STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "قيد الأداء",
  PASSED: "ناجحة",
  FAILED: "راسبة",
  NEEDS_REVIEW: "بحاجة تصحيح",
  EXPIRED: "منتهية",
};

/**
 * Supervisor assessments workspace: create + manage school assessments,
 * then review their assigned teachers' real attempts (read-only rows
 * served by the existing supervisor results service).
 */
export default async function SupervisorAssessmentsPage() {
  const ctx = await requireSupervisorContext();

  const [assessments, courseOptions, attempts] = await Promise.all([
    listSupervisorAssessments(ctx, { page: 1 }),
    listSupervisorImpactCourseOptions(ctx),
    listSupervisorResults({ id: ctx.id, role: ctx.role, schoolId: ctx.schoolId }),
  ]);

  const rows = assessments.ok ? assessments.data.rows : [];
  const attemptRows = attempts.ok ? attempts.data : [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-black text-foreground">الأسئلة والاختبارات</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          أنشئ اختبارات مدرستك واربطها بالدورات، أضف الأسئلة بأنواعها (اختيار
          مفرد/متعدد، صح وخطأ، إجابة قصيرة)، وانشرها — ثم تابع نتائج معلميك هنا.
        </p>
      </header>

      <AssessmentsCreateForm
        courses={courseOptions.map((course) => ({ id: course.id, titleAr: course.titleAr }))}
      />

      <Panel
        title={`اختبارات مدرستك (${rows.length})`}
        description="أول 12 اختبارًا حسب آخر تحديث — افتح الاختبار لإدارة أسئلته."
      >
        {rows.length === 0 ? (
          <EmptyHint
            title="لا اختبارات بعد"
            description="أنشئ أول اختبار من النموذج أعلاه ثم أضف أسئلته."
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-foreground">{row.titleAr}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {row.courseTitle ? `${row.courseTitle} · ` : ""}
                      {row.questionsCount} سؤالًا · {row.attemptsCount} محاولة ·
                      مجموع {row.maxScore} نقطة
                    </p>
                  </div>
                  <Pill tone={statusTone(row.status)}>{statusLabel(row.status)}</Pill>
                </div>
                <Link
                  href={`/supervision/assessments/${row.id}`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700"
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                  إدارة الأسئلة
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="نتائج معلميك"
        description="آخر 100 محاولة لمعلميك المسندَين إليك — قراءة فقط من قاعدة البيانات."
      >
        {attemptRows.length === 0 ? (
          <EmptyHint
            title="لا محاولات بعد"
            description="ستظهر محاولات معلميك هنا فور أدائهم للاختبارات المنشورة."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-3 py-2 text-start font-bold">المعلم</th>
                  <th className="px-3 py-2 text-start font-bold">الاختبار</th>
                  <th className="px-3 py-2 text-start font-bold">النتيجة</th>
                  <th className="px-3 py-2 text-start font-bold">الحالة</th>
                  <th className="px-3 py-2 text-start font-bold">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {attemptRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-bold text-foreground">{row.teacherName}</td>
                    <td className="px-3 py-2">{row.assessmentTitle}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.earnedScore !== null && row.maxScore !== null
                        ? `${row.earnedScore}/${row.maxScore} (${row.percentage ?? 0}%)`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Pill
                        tone={
                          row.status === "PASSED"
                            ? "success"
                            : row.status === "FAILED"
                              ? "error"
                              : row.status === "NEEDS_REVIEW"
                                ? "warning"
                                : "neutral"
                        }
                      >
                        {ATTEMPT_STATUS_LABEL[row.status] ?? row.status}
                      </Pill>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.submittedAt ? formatDate(row.submittedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ClipboardCheck className="size-3.5 shrink-0" aria-hidden="true" />
        النشر يتطلب سؤالًا واحدًا على الأقل ودرجة نجاح ضمن مجموع الدرجات.
      </p>
    </div>
  );
}
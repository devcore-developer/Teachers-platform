/**
 * Phase 10 — الأرشيف: unified archive center.
 *
 * Shows archived records per entity type (scoped by role), the
 * append-only archive audit trail, and — for follow-ups, the only
 * entity without a prior archive mechanism — the archiving action.
 * Content entities (programs/courses/assessments/assignments) keep
 * their existing phase-managed archive transitions; this center adds
 * their missing RESTORE paths. Survey archiving keeps its Phase 9
 * lifecycle action (ARCHIVED is terminal there by design).
 */
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { toAnalyticsActor, canViewArchive } from "@/lib/analytics/access";
import {
  listArchivableFollowUps,
  listArchiveEvents,
  listArchivedRecords,
} from "@/lib/archive/service";
import {
  ARCHIVE_ENTITY_LABELS,
  CONTENT_STATUS_LABELS,
  type ArchiveEntityType,
} from "@/config/analytics";
import { FOLLOW_UP_STATUS_LABELS, type FollowUpStatus } from "@/config/surveys";
import { AccessDenied, Card, EmptyState, PageHeader } from "@/app/assignments/ui";
import {
  ArchiveFollowUpButton,
  RestoreAssessmentButton,
  RestoreAssignmentButton,
  RestoreCourseButton,
  RestoreFollowUpButton,
  RestoreProgramButton,
} from "@/app/archive/archive-actions";

export const dynamic = "force-dynamic";

const TAB_TYPES: (ArchiveEntityType | null)[] = [
  null,
  "PROGRAM",
  "COURSE",
  "ASSESSMENT",
  "ASSIGNMENT",
  "SURVEY",
  "FOLLOW_UP",
];

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    numberingSystem: "latn",
  }).format(date);
}

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawQuery = await searchParams;
  const rawType = Array.isArray(rawQuery.type) ? rawQuery.type[0] : rawQuery.type;
  const entityType = TAB_TYPES.includes((rawType ?? null) as ArchiveEntityType | null)
    ? ((rawType ?? null) as ArchiveEntityType | null)
    : null;

  const user = await getCurrentUser();
  if (!user) {
    return <AccessDenied hint="الجلسة منتهية — سجّل الدخول من جديد." />;
  }
  const actor = toAnalyticsActor(user);
  if (!actor || !canViewArchive(actor.role)) {
    return <AccessDenied hint="مركز الأرشيف متاح للأدوار الإدارية المدرسية والإدارة العامة فقط." />;
  }

  const [archiveResult, eventsResult, archivableResult] = await Promise.all([
    listArchivedRecords(actor, entityType, 1),
    listArchiveEvents(actor),
    canOperateArchiveLocal(actor) ? listArchivableFollowUps(actor) : Promise.resolve(null),
  ]);

  const canOperate = canOperateArchiveLocal(actor);
  const scopeNote =
    actor.role === "SUPER_ADMIN"
      ? "عرض الأرشيف العام على مستوى المنصة (المحتوى غير المرتبط بمدرسة) — للقراءة فقط"
      : actor.role === "EDUCATIONAL_DEPUTY"
        ? "عرض للقراءة فقط ضمن نطاق التفويض"
        : actor.role === "EDUCATIONAL_SUPERVISOR"
          ? "سجلات المتابعة والاستبيانات ضمن نطاق إشرافك"
          : "أرشيف مدرستك";

  return (
    <div>
      <PageHeader
        title="الأرشيف — السجلات المؤرشفة"
        subtitle={`حفظ آمن للسجلات المغلقة دون حذف — كل سجل يحتفظ بعلاقاته وتاريخه. ${scopeNote}`}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {TAB_TYPES.map((type) => (
          <Link
            key={type ?? "all"}
            href={`/archive${type ? `?type=${type}` : ""}`}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              entityType === type
                ? "border-[#1D5BD6] bg-[#1D5BD6] text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-[#1D5BD6]"
            }`}
          >
            {type === null ? "الكل" : ARCHIVE_ENTITY_LABELS[type]}
          </Link>
        ))}
      </div>

      {!archiveResult.ok ? (
        <AccessDenied hint={archiveResult.message} />
      ) : (
        <Card title={`السجلات المؤرشفة (${archiveResult.data.total})`}>
          {archiveResult.data.rows.length === 0 ? (
            <EmptyState
              title="لا توجد سجلات مؤرشفة في هذا النطاق"
              hint="الأرشفة تحدث من صفحات السجلات نفسها (تكليف/استبيان) أو من نموذج أرشفة المتابعات أدناه."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">النوع</th>
                    <th className="px-3 py-2 font-medium">السجل</th>
                    <th className="px-3 py-2 font-medium">التفاصيل</th>
                    <th className="px-3 py-2 font-medium">وقت الأرشفة</th>
                    <th className="px-3 py-2 font-medium">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {archiveResult.data.rows.map((row) => (
                    <tr key={`${row.entityType}-${row.entityId}`} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-xs font-semibold text-slate-500">
                        {ARCHIVE_ENTITY_LABELS[row.entityType]}
                        {row.workflowStatus ? (
                          <span className="mt-1 block font-normal text-slate-400">
                            الحالة: {FOLLOW_UP_STATUS_LABELS[row.workflowStatus as FollowUpStatus] ?? row.workflowStatus}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-700">{row.title}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{row.detail ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(row.archivedAt)}</td>
                      <td className="px-3 py-2">
                        {canOperate ? (
                          <RestoreControls entityType={row.entityType} entityId={row.entityId} />
                        ) : (
                          <span className="text-[11px] text-slate-400">للقراءة فقط</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {archivableResult && archivableResult.ok && archivableResult.data.length > 0 ? (
        <Card title="أرشفة سجل متابعة">
          <p className="mb-3 text-xs text-slate-500">
            الأرشفة الناعمة تحفظ حالة السجل وتاريخه كما هي وتُخرجه من قوائم العمل النشطة — ويمكن استعادته في أي وقت.
          </p>
          <div className="space-y-2">
            {archivableResult.data.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-700">{row.titleAr}</p>
                  <p className="text-xs text-slate-500">
                    {row.teacherName} — {FOLLOW_UP_STATUS_LABELS[row.status as FollowUpStatus] ?? row.status} —{" "}
                    {formatDateTime(row.followUpDate)}
                  </p>
                </div>
                <ArchiveFollowUpButton followUpId={row.id} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="سجل عمليات الأرشفة (تدقيق غير قابل للتعديل)">
        {eventsResult.ok && eventsResult.data.length > 0 ? (
          <ol className="space-y-3">
            {eventsResult.data.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
                <div>
                  <p className="text-sm text-slate-700">
                    <span
                      className={`mr-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        event.action === "ARCHIVED"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {event.action === "ARCHIVED" ? "أرشفة" : "استعادة"}
                    </span>
                    {event.entityLabel}
                    {event.entityTitle ? <span className="font-semibold"> — {event.entityTitle}</span> : null}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {event.actorName ?? "نظام"} — {formatDateTime(event.createdAt)}
                    {event.note ? <span className="mr-2">• {event.note}</span> : null}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="لا توجد عمليات أرشفة بعد" />
        )}
      </Card>

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs leading-5 text-slate-600">
        <p className="font-bold text-slate-700">سياسة الأرشفة</p>
        <ul className="mt-2 list-disc space-y-1 pr-5">
          <li>لا يُحذف أي سجل فعليًا — الأرشفة حالة أو طابع زمني، والعلاقات والتاريخ محفوظة دائمًا.</li>
          <li>الشهادات الصادرة وتاريخ تحققها، ومحاولات التقييم ودرجاتها، وسجل التسليمات لا تُؤرشف أبدًا.</li>
          <li>البرامج والدورات والتقييمات والتكليفات تُؤرشف من صفحاتها الأصلية (حالة ARCHIVED) — وهنا تُستعاد.</li>
          <li>الاستبيانات المؤرشفة حالة نهائية في دورة حياتها حفاظًا على سلامة نتائجها.</li>
        </ul>
      </div>
    </div>
  );
}

function canOperateArchiveLocal(actor: { role: string }): boolean {
  return actor.role === "DEVELOPMENT_OFFICE_MANAGER" || actor.role === "EDUCATIONAL_SUPERVISOR";
}

function RestoreControls({ entityType, entityId }: { entityType: ArchiveEntityType; entityId: string }) {
  switch (entityType) {
    case "FOLLOW_UP":
      return <RestoreFollowUpButton followUpId={entityId} />;
    case "ASSIGNMENT":
      return <RestoreAssignmentButton assignmentId={entityId} />;
    case "COURSE":
      return <RestoreCourseButton courseId={entityId} />;
    case "PROGRAM":
      return <RestoreProgramButton programId={entityId} />;
    case "ASSESSMENT":
      return <RestoreAssessmentButton assessmentId={entityId} />;
    case "SURVEY":
      return <span className="text-[11px] text-slate-400">نهائي — النتائج محفوظة</span>;
    default:
      return null;
  }
}

// CONTENT_STATUS_LABELS is re-exported for the entity-type tabs to keep
// future status columns consistent (imported above to document usage).
void CONTENT_STATUS_LABELS;
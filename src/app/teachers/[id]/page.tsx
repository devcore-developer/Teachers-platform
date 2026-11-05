import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";

import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import { requireAdminContext } from "@/lib/auth/dev-admin";
import { db } from "@/lib/db";
import { growthLevelLabel } from "@/config/growth";
import { TeacherAdminPanels } from "@/app/teachers/[id]/teacher-admin-panels";

export const metadata = {
  title: "الملف الإداري للمعلم | منارة قرطبة",
};

/**
 * Batch 2 — the administrative teacher profile: professional data edit
 * (name/stage/subject/school/supervisor/deputy), the growth controls
 * (v48 classification + promotion), the secure account panel
 * (one-time temporary password + email change) and the professional
 * stats. School scope is enforced server-side.
 */
export default async function TeacherAdminPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAdminContext();

  const teacher = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      stage: true,
      subject: true,
      growthLevel: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      passwordUpdatedAt: true,
      createdAt: true,
      schoolId: true,
      school: { select: { id: true, nameAr: true } },
      branch: { select: { nameAr: true } },
      teacherSupervision: {
        select: {
          supervisor: { select: { id: true, name: true } },
          deputy: { select: { id: true, name: true } },
        },
      },
      courseCompletions: { select: { hours: true } },
      certificates: { where: { status: "ISSUED" }, select: { id: true } },
    },
  });

  if (!teacher || teacher.role !== "TEACHER") notFound();
  if (
    actor.role === "DEVELOPMENT_OFFICE_MANAGER" &&
    teacher.schoolId !== actor.schoolId
  ) {
    redirect("/forbidden");
  }

  const [supervisors, deputies, growthHistory] = await Promise.all([
    db.user.findMany({
      where: {
        role: "EDUCATIONAL_SUPERVISOR",
        isActive: true,
        ...(teacher.schoolId ? { schoolId: teacher.schoolId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 300,
    }),
    db.user.findMany({
      where: {
        role: "EDUCATIONAL_DEPUTY",
        isActive: true,
        ...(teacher.schoolId ? { schoolId: teacher.schoolId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 300,
    }),
    db.growthEvent.findMany({
      where: { userId: teacher.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        fromLevel: true,
        toLevel: true,
        reason: true,
        actor: { select: { name: true } },
        createdAt: true,
      },
    }),
  ]);

  const hours =
    Math.round(
      teacher.courseCompletions.reduce(
        (sum, completion) => sum + Number(completion.hours ?? 0),
        0
      ) * 10
    ) / 10;

  const headerList = await headers();
  void headerList;

  return (
    <div>
      <PageHeader
        title={`الملف الإداري — ${teacher.name}`}
        description="البيانات المهنية والإسناد وتصنيف النمو وأمان الحساب — كل التعديلات تتحقق خادميًا."
        breadcrumbs={[
          { label: "الرئيسية" },
          { label: "إدارة المعلمين" },
          { label: teacher.name },
        ]}
        meta={
          <>
            <StatusBadge tone={teacher.isActive ? "success" : "warning"} withDot={false}>
              {teacher.isActive ? "نشط" : "موقوف"}
            </StatusBadge>
            <StatusBadge tone="info" withDot={false}>
              {growthLevelLabel(teacher.growthLevel)}
            </StatusBadge>
            <StatusBadge tone={teacher.emailVerifiedAt ? "success" : "warning"} withDot={false}>
              {teacher.emailVerifiedAt ? "بريد موثق" : "بريد غير موثق"}
            </StatusBadge>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-2xl font-black tabular-nums">{teacher.courseCompletions.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">دورات مكتملة</p>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-2xl font-black tabular-nums">{hours}</p>
          <p className="mt-1 text-xs text-muted-foreground">ساعات تدريب متراكمة</p>
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <p className="text-2xl font-black tabular-nums">{teacher.certificates.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">شهادات صادرة</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="البيانات المهنية والإسناد"
          description="الاسم، المرحلة، التخصص، المشرف التربوي والوكيل التعليمي — بنفس بيانات المنصة الأصلية."
        >
          <TeacherAdminPanels
            mode="profile"
            teacherId={teacher.id}
            initial={{
              name: teacher.name,
              stage: teacher.stage ?? "",
              subject: teacher.subject ?? "",
              supervisorId: teacher.teacherSupervision?.supervisor.id ?? "",
              deputyId: teacher.teacherSupervision?.deputy?.id ?? "",
            }}
            supervisors={supervisors}
            deputies={deputies}
          />
        </SectionCard>

        <SectionCard
          title="أمان الحساب"
          description="إعادة تعيين كلمة مرور مؤقتة (تُعرض مرة واحدة وتُنهي كل الجلسات) وتحديث البريد الإلكتروني."
        >
          <TeacherAdminPanels
            mode="security"
            teacherId={teacher.id}
            initial={{
              email: teacher.email,
              lastLoginAt: teacher.lastLoginAt?.toISOString() ?? null,
              passwordUpdatedAt: teacher.passwordUpdatedAt?.toISOString() ?? null,
            }}
          />
        </SectionCard>
      </div>

      <div className="mt-6">
        <SectionCard
          title="سجل النمو المهني"
          description="آخر أحداث التصنيف والانتقال — السجل كامل ولا يُحذف."
        >
          {growthHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد أحداث نمو بعد — استخدم لوحة النمو لتصنيف المعلم.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border" role="list">
              {growthHistory.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span className="font-semibold">
                    {event.fromLevel ? `${event.fromLevel} ← ` : ""}
                    {event.toLevel}
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      {event.reason === "PROMOTION_APPROVED"
                        ? "اعتماد انتقال (60%)"
                        : event.reason === "MANUAL_SUPERVISOR"
                          ? "تصنيف المشرف"
                          : event.reason}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {event.actor?.name ?? "—"} ·{" "}
                    {event.createdAt.toLocaleDateString("ar-EG")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
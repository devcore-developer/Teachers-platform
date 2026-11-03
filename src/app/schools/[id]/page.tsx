import { notFound } from "next/navigation";
import { CalendarDays, Hash, Landmark, Palette, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { BranchesManager } from "@/components/schools/branches-manager";
import { SchoolForm } from "@/components/schools/school-form";
import { SchoolStatusToggle } from "@/components/schools/school-status-toggle";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import {
  toBranchListItem,
  toSchoolListItem,
} from "@/lib/schools/dto";
import { getSchoolDetail } from "@/lib/schools/service";

export const metadata = {
  title: "تفاصيل المدرسة",
};

interface SchoolDetailsPageProps {
  params: Promise<{ id: string }>;
}

export default async function SchoolDetailsPage({
  params,
}: SchoolDetailsPageProps) {
  const { id } = await params;
  const school = await getSchoolDetail(id);

  // Never render another school's data — an unknown id is a hard 404.
  if (!school) notFound();

  const schoolDto = toSchoolListItem(school);
  const branchDtos = school.branches.map(toBranchListItem);

  const infoRows = [
    {
      id: "slug",
      icon: Hash,
      label: "الرابط المختصر",
      value: <code className="font-mono text-sm" dir="ltr">{schoolDto.slug}</code>,
    },
    {
      id: "brand",
      icon: Palette,
      label: "لون الهوية",
      value: (
        <span className="inline-flex items-center gap-2">
          <span
            className="size-4 rounded-full border"
            style={{ backgroundColor: schoolDto.brandColor }}
            aria-hidden="true"
          />
          <span className="font-mono text-sm" dir="ltr">{schoolDto.brandColor}</span>
        </span>
      ),
    },
    {
      id: "created",
      icon: CalendarDays,
      label: "أُضيفت في",
      value: <span className="tabular-nums">{schoolDto.createdAtLabel}</span>,
    },
    {
      id: "updated",
      icon: RefreshCw,
      label: "آخر تحديث",
      value: <span className="tabular-nums">{schoolDto.updatedAtLabel}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title={schoolDto.nameAr}
        description={
          schoolDto.nameEn
            ? `هوية المدرسة وإدارتها التفصيلية — ${schoolDto.nameEn}`
            : "هوية المدرسة وإدارتها التفصيلية والفروع التابعة لها."
        }
        breadcrumbs={[
          { label: "المدارس", href: "/schools" },
          { label: schoolDto.nameAr },
        ]}
        meta={
          <>
            {schoolDto.isActive ? (
              <StatusBadge tone="success">نشطة</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">موقوفة</StatusBadge>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">
              <Landmark className="size-3.5 text-brand-600" aria-hidden="true" />
              {branchDtos.length} {branchDtos.length === 1 ? "فرع" : "فروع"}
            </span>
          </>
        }
        actions={
          <SchoolStatusToggle
            schoolId={schoolDto.id}
            schoolName={schoolDto.nameAr}
            isActive={schoolDto.isActive}
          />
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Edit form */}
        <div className="xl:col-span-2">
          <SectionCard
            title="بيانات المدرسة"
            description="تعديل الاسم والهوية والرابط المختصر — تُطبَّق فوراً بعد الحفظ."
          >
            <SchoolForm mode="edit" initial={schoolDto} />
          </SectionCard>
        </div>

        {/* Info side card */}
        <div className="space-y-6">
          <SectionCard title="معلومات سريعة">
            <ul className="space-y-3.5" role="list">
              {infoRows.map((row) => {
                const Icon = row.icon;
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <Icon className="size-3.5" aria-hidden="true" />
                      {row.label}
                    </span>
                    <span className="min-w-0 truncate text-sm font-bold text-foreground">
                      {row.value}
                    </span>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          <SectionCard title="ملاحظة حول الحذف النهائي">
            <p className="text-xs leading-relaxed text-muted-foreground">
              الحذف النهائي للمدارس غير متاح عمداً: كل مدرسة مرتبطة بفروع
              وبسجلات ستتوسع في المراحل القادمة (معلمون، برامج، شهادات).
              إيقاف المدرسة يخفيها من التشغيل مع الحفاظ على سلامة السجلات
              وإمكانية استرجاعها في أي وقت.
            </p>
          </SectionCard>
        </div>
      </div>

      {/* Branches */}
      <div className="mt-6">
        <BranchesManager schoolId={schoolDto.id} branches={branchDtos} />
      </div>
    </div>
  );
}
import { Suspense } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SchoolsDirectory } from "@/components/schools/schools-directory";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listSchools } from "@/lib/schools/service";
import { toSchoolListItem } from "@/lib/schools/dto";
import { EmptyState } from "@/components/platform/empty-state";

export const metadata = {
  title: "المدارس والفروع",
};

/** Table skeleton used while the schools list loads. */
function DirectorySkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="rounded-xl border bg-card">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 border-b p-4 last:border-b-0">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ms-auto h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Data-loading wrapper — isolated so Suspense covers only the query. */
async function DirectoryContent() {
  let schools: ReturnType<typeof toSchoolListItem>[] | null = null;

  try {
    schools = (await listSchools()).map(toSchoolListItem);
  } catch (error) {
    console.error("[schools] failed to load the schools directory", error);
  }

  if (!schools) {
    return (
      <div className="rounded-xl border bg-card shadow-xs">
        <EmptyState
          icon={Building2}
          title="تعذر تحميل قائمة المدارس"
          description="حدث خطأ أثناء الاتصال بقاعدة البيانات. تحقق من تشغيل قاعدة البيانات ثم أعد تحميل الصفحة."
        />
      </div>
    );
  }

  return <SchoolsDirectory schools={schools} />;
}

export default function SchoolsPage() {
  return (
    <div>
      <PageHeader
        title="المدارس والفروع"
        description="دليل المدارس المسجلة في المنصة: الهوية، الفروع، المراحل التعليمية، وحالة التفعيل."
        breadcrumbs={[{ label: "المدارس" }]}
        actions={
          <Button asChild>
            <Link href="/schools/new">
              <Plus className="size-4" aria-hidden="true" />
              إضافة مدرسة
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<DirectorySkeleton />}>
        <DirectoryContent />
      </Suspense>
    </div>
  );
}
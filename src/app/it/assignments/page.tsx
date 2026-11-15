import { PageHeader } from "@/components/layout/page-header";
import { requireItCoordinatorContext } from "@/lib/auth/dev-admin";
import { listItWorkspace } from "@/lib/it/service";
import { itTeacherQuerySchema } from "@/lib/validation/it";
import { AssignmentsClient } from "./assignments-client";

export const metadata = {
  title: "إسناد المعلمين | منارة قرطبة",
};

export const dynamic = "force-dynamic";

/**
 * IT coordinator — teacher↔supervisor assignment workspace. The context
 * (identity + school) comes from the session; listItWorkspace FORCES the
 * school scope server-side regardless of any filter tampering. Filters
 * travel as query params so the screen works without JavaScript.
 */
export default async function ItAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireItCoordinatorContext();
  const params = await searchParams;

  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;

  const parsed = itTeacherQuerySchema.safeParse({
    q: first(params.q) ?? "",
    branchId: first(params.branchId) ?? "",
    status: first(params.status) ?? "UNASSIGNED",
    page: first(params.page) ?? "1",
  });

  const query = parsed.success
    ? parsed.data
    : { status: "UNASSIGNED" as const, page: 1 };

  const result = await listItWorkspace(ctx, query);
  const data = result.ok ? result.data : null;

  return (
    <div>
      <PageHeader
        title="إسناد المعلمين إلى المشرفين"
        description="قائمة المعلمين داخل مدرستك — إسناد ونقل وإزالة، كل عملية تتحقق من انتماء الطرفين لمدرستك على الخادم."
        breadcrumbs={[
          { label: "الرئيسية" },
          { label: "تقنية المعلومات" },
          { label: "الإسناد" },
        ]}
      />
      <AssignmentsClient
        data={data}
        initial={{
          q: query.q ?? "",
          branchId: query.branchId ?? "",
          status: query.status ?? "UNASSIGNED",
        }}
      />
    </div>
  );
}
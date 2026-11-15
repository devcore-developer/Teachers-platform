import { PageHeader } from "@/components/layout/page-header";
import { requireItCoordinatorContext } from "@/lib/auth/dev-admin";
import { listItWorkspace } from "@/lib/it/service";
import { itTeacherQuerySchema } from "@/lib/validation/it";
import { RecoveryClient } from "./recovery-client";

export const metadata = {
  title: "استعادة حسابات المعلمين | منارة قرطبة",
};

export const dynamic = "force-dynamic";

/**
 * IT coordinator — teacher account recovery. Issues the SAME single-use
 * expiring reset token as the public forgot-password flow; the raw link
 * travels only inside the email to the teacher's own address.
 */
export default async function ItRecoveryPage({
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
    page: first(params.page) ?? "1",
  });
  const query = parsed.success ? parsed.data : { page: 1 as const };

  // ALL statuses — recovery applies to assigned and unassigned teachers
  // alike; the supervisor filter is irrelevant here.
  const result = await listItWorkspace(ctx, {
    ...query,
    status: undefined,
    branchId: undefined,
  });
  const data = result.ok ? result.data : null;

  return (
    <div>
      <PageHeader
        title="استعادة حسابات المعلمين"
        description="إرسال رابط آمن لإعادة تعيين كلمة المرور يصل بريد المعلم نفسه — يُستخدم مرة واحدة وينتهي بعد ساعة، مع حد أقصى للمحاولات."
        breadcrumbs={[
          { label: "الرئيسية" },
          { label: "تقنية المعلومات" },
          { label: "الاستعادة" },
        ]}
      />
      <RecoveryClient data={data} initialQuery={{ q: query.q ?? "" }} />
    </div>
  );
}
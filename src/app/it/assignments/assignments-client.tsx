"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  CheckCircle2,
  Filter,
  Loader2,
  Search,
  UserCheck,
  UserMinus,
  XCircle,
} from "lucide-react";

import {
  assignItTeacherAction,
  removeItTeacherSupervisorAction,
  type ItActionState,
} from "@/app/actions/it";
import type { ItWorkspaceData, ItTeacherRow } from "@/lib/it/service";
import { StatusBadge } from "@/components/platform/status-badge";

const formatDate = (d: Date | null | undefined) =>
  d
    ? d.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" })
    : "—";

/* ------------------------------------------------------------------ */
/* IT assignment workspace (client presentation only).                  */
/* Filters submit as GET params (works without JS); every assign /      */
/* transfer / remove posts to the server action, which re-checks the    */
/* tenant scope and roles server-side and revalidates this path.        */
/* ------------------------------------------------------------------ */

function FilterBar({
  branches,
  initial,
}: {
  branches: { id: string; nameAr: string }[];
  initial: { q: string; branchId: string; status: string };
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <div className="min-w-52 flex-1">
        <label
          htmlFor="it-q"
          className="mb-1 block text-xs font-semibold text-muted-foreground"
        >
          بحث بالاسم أو البريد
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id="it-q"
            name="q"
            defaultValue={initial.q}
            placeholder="اسم المعلم أو بريده…"
            className="h-10 w-full rounded-xl border border-input bg-background ps-9 text-sm outline-none focus-visible:border-ring"
          />
        </div>
      </div>

      <div className="min-w-44">
        <label
          htmlFor="it-branch"
          className="mb-1 block text-xs font-semibold text-muted-foreground"
        >
          الفرع
        </label>
        <select
          id="it-branch"
          name="branchId"
          defaultValue={initial.branchId}
          className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring"
        >
          <option value="">كل الفروع</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nameAr}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-44">
        <label
          htmlFor="it-status"
          className="mb-1 block text-xs font-semibold text-muted-foreground"
        >
          حالة الإسناد
        </label>
        <select
          id="it-status"
          name="status"
          defaultValue={initial.status}
          className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring"
        >
          <option value="UNASSIGNED">غير المُسنَدين (قائمة العمل)</option>
          <option value="ASSIGNED">المُسنَدون</option>
          <option value="ALL">الكل</option>
        </select>
      </div>

      <button
        type="submit"
        className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white transition-colors hover:bg-brand-700"
      >
        <Filter className="size-4" aria-hidden="true" />
        تصفية
      </button>
    </form>
  );
}

function SubmitButton({
  label,
  pendingLabel,
  variant = "primary",
  icon,
}: {
  label: string;
  pendingLabel: string;
  variant?: "primary" | "ghost";
  icon: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        variant === "primary"
          ? "inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          : "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
      }
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
      {pending ? pendingLabel : label}
    </button>
  );
}

function AssignCell({
  teacherId,
  currentSupervisorId,
  supervisors,
}: {
  teacherId: string;
  currentSupervisorId: string | null;
  supervisors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [assignState, assignAction] = React.useActionState<
    ItActionState | null,
    FormData
  >(assignItTeacherAction, null);
  const [removeState, removeAction] = React.useActionState<
    ItActionState | null,
    FormData
  >(removeItTeacherSupervisorAction, null);

  React.useEffect(() => {
    if (assignState?.ok || removeState?.ok) router.refresh();
  }, [assignState?.ok, removeState?.ok, router]);

  const feedback = assignState && !assignState.ok
    ? { ok: false, message: assignState.message }
    : assignState?.ok
      ? { ok: true, message: assignState.message }
      : removeState && !removeState.ok
        ? { ok: false, message: removeState.message }
        : removeState?.ok
          ? { ok: true, message: removeState.message }
          : null;

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <form action={assignAction} className="flex items-center gap-2">
        <input type="hidden" name="teacherId" value={teacherId} />
        <select
          name="supervisorId"
          defaultValue={currentSupervisorId ?? ""}
          required
          className="h-9 w-52 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
          aria-label="المشرف التربوي"
        >
          <option value="" disabled>
            اختر المشرف التربوي…
          </option>
          {supervisors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <SubmitButton
          label={currentSupervisorId ? "نقل الإسناد" : "إسناد"}
          pendingLabel="جارٍ التنفيذ…"
          icon={<UserCheck className="size-3.5" aria-hidden="true" />}
        />
      </form>
      {currentSupervisorId && (
        <form action={removeAction}>
          <input type="hidden" name="teacherId" value={teacherId} />
          <SubmitButton
            label="إزالة الإسناد"
            pendingLabel="جارٍ…"
            variant="ghost"
            icon={<UserMinus className="size-3.5" aria-hidden="true" />}
          />
        </form>
      )}
      {feedback && (
        <p
          role="status"
          className={
            feedback.ok
              ? "flex items-center gap-1 text-xs font-bold text-success"
              : "flex items-center gap-1 text-xs font-bold text-error"
          }
        >
          {feedback.ok ? (
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
          ) : (
            <XCircle className="size-3.5" aria-hidden="true" />
          )}
          {feedback.message}
        </p>
      )}
    </div>
  );
}

export function AssignmentsClient({
  data,
  initial,
}: {
  data: ItWorkspaceData | null;
  initial: { q: string; branchId: string; status: string };
}) {
  if (!data) {
    return (
      <p className="rounded-xl border border-error/30 bg-error-soft px-4 py-3 text-sm font-semibold text-error">
        تعذّر تحميل قائمة المعلمين — تحقق من معايير التصفية ثم أعد المحاولة.
      </p>
    );
  }

  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (initial.q) params.set("q", initial.q);
    if (initial.branchId) params.set("branchId", initial.branchId);
    params.set("status", initial.status);
    params.set("page", String(page));
    return `/it/assignments?${params.toString()}`;
  };

  return (
    <div className="space-y-5">
      <FilterBar branches={data.branches} initial={initial} />

      <div className="rounded-xl border">
        <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2.5">
          <p className="text-sm font-bold">
            {initial.status === "UNASSIGNED"
              ? "قائمة غير المُسنَدين: "
              : initial.status === "ASSIGNED"
                ? "المُسنَدون: "
                : "النتائج: "}
            {data.total} معلم
          </p>
          <p className="text-xs text-muted-foreground">
            صفحة {data.page} من {data.pageCount}
          </p>
        </div>

        {data.rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            لا يوجد معلمون مطابقون لهذه التصفية — {initial.status === "UNASSIGNED" ? "كل معلمي مدرستك مُسنَدون إلى مشرفين 🎉" : "جرّب توسيع البحث."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-start font-semibold">المعلم</th>
                  <th className="px-4 py-2.5 text-start font-semibold">الفرع</th>
                  <th className="px-4 py-2.5 text-start font-semibold">الحالة</th>
                  <th className="px-4 py-2.5 text-start font-semibold">المشرف الحالي والإسناد</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((teacher) => (
                  <tr key={teacher.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-bold">{teacher.name}</p>
                      <p className="text-xs text-muted-foreground" dir="ltr">
                        {teacher.email}
                      </p>
                      {teacher.viaRegistrationLink && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          سُجّل ذاتيًا: {formatDate(teacher.registeredAt)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {teacher.branchName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusBadge tone={teacher.isActive ? "success" : "neutral"}>
                          {teacher.isActive ? "نشط" : "موقوف"}
                        </StatusBadge>
                        <StatusBadge tone={teacher.isVerified ? "success" : "warning"}>
                          {teacher.isVerified ? "بريد موثّق" : "بانتظار التوثيق"}
                        </StatusBadge>
                        {teacher.viaRegistrationLink && (
                          <StatusBadge tone="info">تسجيل ذاتي</StatusBadge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <AssignCell
                        teacherId={teacher.id}
                        currentSupervisorId={teacher.supervisor?.id ?? null}
                        supervisors={data.supervisors}
                      />
                      {teacher.supervisor && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          الحالي:{" "}
                          <span className="font-bold text-foreground">
                            {teacher.supervisor.name}
                          </span>
                        </p>
                      )}
                      {teacher.supervisor && teacher.supervisorAssignedBy && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          أُسند بواسطة{" "}
                          <span className="font-semibold">
                            {teacher.supervisorAssignedBy}
                          </span>
                          {teacher.supervisorAssignedAt &&
                            ` في ${formatDate(teacher.supervisorAssignedAt)}`}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.pageCount > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="تنقل الصفحات">
          {data.page > 1 && (
            <Link
              href={pageHref(data.page - 1)}
              className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-accent"
            >
              السابق
            </Link>
          )}
          <span className="text-xs text-muted-foreground">
            {data.page} / {data.pageCount}
          </span>
          {data.page < data.pageCount && (
            <Link
              href={pageHref(data.page + 1)}
              className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-accent"
            >
              التالي
            </Link>
          )}
        </nav>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        ملاحظة: الإسناد يمنح المشرف وصولًا لمعلمي مدرستك وفق قواعد النطاق
        الحالية — الإسناد لا يغيّر بيانات المعلم ولا حالة توثيق بريده.
      </p>
    </div>
  );
}
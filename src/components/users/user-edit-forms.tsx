"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Save, Trash2, UserCheck } from "lucide-react";

import {
  assignTeacherSupervisorAction,
  removeTeacherSupervisorAction,
  setDeputyScopeAction,
  setSupervisorBranchesAction,
  updateUserProfileByAdminAction,
  type UserFormState,
} from "@/app/actions/users";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { branchStageLabel } from "@/lib/validation/schools";

/* ------------------------------------------------------------------ */
/* Management forms rendered on the user-details page. Each form is     */
/* presentation only — the service layer re-validates scope, roles and  */
/* relationships on every submit. Forms receive serializable data.      */
/* ------------------------------------------------------------------ */

export interface BranchOption {
  id: string;
  nameAr: string;
  stage?: string;
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <Save className="size-4" aria-hidden="true" />
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FormFeedback({ state }: { state: UserFormState | null }) {
  if (!state?.message) return null;
  return (
    <Alert
      variant={state.ok ? "default" : "destructive"}
      role={state.ok ? "status" : "alert"}
    >
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

/* ------------------------- Name + branch form ---------------------- */

export function ProfileEditForm({
  userId,
  name,
  branchId,
  branches,
  targetSchoolName,
}: {
  userId: string;
  name: string;
  branchId: string | null;
  branches: BranchOption[];
  targetSchoolName: string | null;
}) {
  const [state, formAction] = React.useActionState<UserFormState | null, FormData>(
    updateUserProfileByAdminAction,
    null
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormFeedback state={state} />
      <input type="hidden" name="userId" value={userId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-name">الاسم</Label>
          <Input id="edit-name" name="name" defaultValue={name} required />
          {state?.fieldErrors?.name && (
            <p className="text-xs font-semibold text-destructive">
              {state.fieldErrors.name}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-branch">الفرع {targetSchoolName && `— فروع ${targetSchoolName}`}</Label>
          {branches.length > 0 ? (
            <Select name="branchId" defaultValue={branchId ?? "none"}>
              <SelectTrigger id="edit-branch" className="w-full">
                <SelectValue placeholder="بدون فرع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بدون فرع</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="edit-branch"
              disabled
              value={targetSchoolName ? "لا توجد فروع في هذه المدرسة" : "حساب غير تابع لمدرسة"}
            />
          )}
        </div>
      </div>
      <SubmitButton label="حفظ البيانات" pendingLabel="جارٍ الحفظ…" />
    </form>
  );
}

/* --------------------- Supervisor branch scope --------------------- */

export function SupervisorBranchesForm({
  supervisorId,
  assignedBranchIds,
  branches,
}: {
  supervisorId: string;
  assignedBranchIds: string[];
  branches: BranchOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string[]>(assignedBranchIds);
  const [state, setState] = React.useState<UserFormState | null>(null);
  const [pending, setPending] = React.useState(false);

  async function handleSave() {
    setPending(true);
    const result = await setSupervisorBranchesAction(supervisorId, selected);
    setState(result);
    setPending(false);
    router.refresh();
  }

  function toggleBranch(branchId: string) {
    setSelected((prev) =>
      prev.includes(branchId)
        ? prev.filter((id) => id !== branchId)
        : [...prev, branchId]
    );
  }

  return (
    <div className="space-y-4">
      <FormFeedback state={state} />
      {branches.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          لا توجد فروع في هذه المدرسة بعد — أنشئ فروعًا أولًا من صفحة المدارس.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" role="list">
          {branches.map((branch) => (
            <li
              key={branch.id}
              className="flex items-center gap-3 rounded-xl border bg-background/60 p-3"
            >
              <Checkbox
                id={`branch-${branch.id}`}
                checked={selected.includes(branch.id)}
                onCheckedChange={() => toggleBranch(branch.id)}
                aria-label={`إسناد فرع ${branch.nameAr}`}
              />
              <Label
                htmlFor={`branch-${branch.id}`}
                className="min-w-0 flex-1 cursor-pointer leading-tight"
              >
                <span className="block truncate text-sm font-bold">{branch.nameAr}</span>
                {branch.stage && (
                  <span className="block text-xs text-muted-foreground">
                    {branchStageLabel(branch.stage)}
                  </span>
                )}
              </Label>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" size="sm" onClick={handleSave} disabled={pending || branches.length === 0}>
        <Save className="size-4" aria-hidden="true" />
        {pending ? "جارٍ الحفظ…" : "حفظ نطاق الفروع"}
      </Button>
    </div>
  );
}

/* --------------------- Teacher supervisor form --------------------- */

export function TeacherSupervisorForm({
  teacherId,
  currentSupervisorId,
  supervisors,
}: {
  teacherId: string;
  currentSupervisorId: string | null;
  supervisors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [state, formAction] = React.useActionState<UserFormState | null, FormData>(
    assignTeacherSupervisorAction,
    null
  );
  const [removeState, setRemoveState] = React.useState<UserFormState | null>(null);
  const [removing, setRemoving] = React.useState(false);

  async function handleRemove() {
    setRemoving(true);
    const result = await removeTeacherSupervisorAction(teacherId);
    setRemoveState(result);
    setRemoving(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <FormFeedback state={state} />
      {removeState?.message && (
        <Alert variant={removeState.ok ? "default" : "destructive"} role={removeState.ok ? "status" : "alert"}>
          <AlertDescription>{removeState.message}</AlertDescription>
        </Alert>
      )}

      {supervisors.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          لا يوجد مشرفون تربويون نشطون في هذه المدرسة — أنشئ حساب مشرف أولًا ثم أسند له فروعًا.
        </p>
      ) : (
        <form action={formAction} className="space-y-3" noValidate>
          <input type="hidden" name="teacherId" value={teacherId} />
          <div className="space-y-1.5">
            <Label htmlFor="teacher-supervisor">المشرف التربوي الحالي</Label>
            <Select name="supervisorId" defaultValue={currentSupervisorId ?? "none"} required>
              <SelectTrigger id="teacher-supervisor" className="w-full">
                <SelectValue placeholder="اختر المشرف" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بدون مشرف</SelectItem>
                {supervisors.map((supervisor) => (
                  <SelectItem key={supervisor.id} value={supervisor.id}>
                    {supervisor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm">
              <UserCheck className="size-4" aria-hidden="true" />
              حفظ الإسناد
            </Button>
            {currentSupervisorId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRemove}
                disabled={removing}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {removing ? "جارٍ الإلغاء…" : "إلغاء الإسناد"}
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

/* -------------------------- Deputy scope --------------------------- */

export function DeputyScopeForm({
  deputyId,
  grants,
  branches,
}: {
  deputyId: string;
  /** branchId === null means a school-wide grant. */
  grants: { id: string; branchId: string | null }[];
  branches: BranchOption[];
}) {
  const router = useRouter();
  const schoolWide = grants.some((grant) => grant.branchId === null);
  const grantedBranchIds = grants
    .map((grant) => grant.branchId)
    .filter((id): id is string => id !== null);

  const [mode, setMode] = React.useState<"school" | "branches">(
    schoolWide ? "school" : "branches"
  );
  const [selected, setSelected] = React.useState<string[]>(grantedBranchIds);
  const [state, setState] = React.useState<UserFormState | null>(null);
  const [pending, setPending] = React.useState(false);

  async function handleSave() {
    setPending(true);
    const result = await setDeputyScopeAction(
      deputyId,
      mode,
      mode === "school" ? [] : selected
    );
    setState(result);
    setPending(false);
    router.refresh();
  }

  function toggleBranch(branchId: string) {
    setSelected((prev) =>
      prev.includes(branchId)
        ? prev.filter((id) => id !== branchId)
        : [...prev, branchId]
    );
  }

  return (
    <div className="space-y-4">
      <FormFeedback state={state} />

      <RadioGroup
        value={mode}
        onValueChange={(value) => setMode(value as "school" | "branches")}
        className="grid gap-2 sm:grid-cols-2"
      >
        <Label
          htmlFor="deputy-mode-school"
          className="flex cursor-pointer items-start gap-3 rounded-xl border bg-background/60 p-3 leading-tight"
        >
          <RadioGroupItem id="deputy-mode-school" value="school" className="mt-0.5" />
          <span>
            <span className="block text-sm font-bold">اطلاع على المدرسة كاملة</span>
            <span className="block text-xs text-muted-foreground">
              كل الفروع الحالية والمستقبلية — قراءة فقط
            </span>
          </span>
        </Label>
        <Label
          htmlFor="deputy-mode-branches"
          className="flex cursor-pointer items-start gap-3 rounded-xl border bg-background/60 p-3 leading-tight"
        >
          <RadioGroupItem id="deputy-mode-branches" value="branches" className="mt-0.5" />
          <span>
            <span className="block text-sm font-bold">فروع محددة</span>
            <span className="block text-xs text-muted-foreground">
              اختر الفروع المصرّح بها أدناه
            </span>
          </span>
        </Label>
      </RadioGroup>

      {mode === "branches" && (
        <ul className="grid gap-2 sm:grid-cols-2" role="list">
          {branches.map((branch) => (
            <li
              key={branch.id}
              className="flex items-center gap-3 rounded-xl border bg-background/60 p-3"
            >
              <Checkbox
                id={`deputy-branch-${branch.id}`}
                checked={selected.includes(branch.id)}
                onCheckedChange={() => toggleBranch(branch.id)}
                aria-label={`منح اطلاع فرع ${branch.nameAr}`}
              />
              <Label
                htmlFor={`deputy-branch-${branch.id}`}
                className="min-w-0 flex-1 cursor-pointer leading-tight"
              >
                <span className="block truncate text-sm font-bold">{branch.nameAr}</span>
                {branch.stage && (
                  <span className="block text-xs text-muted-foreground">
                    {branchStageLabel(branch.stage)}
                  </span>
                )}
              </Label>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        size="sm"
        onClick={handleSave}
        disabled={pending || (mode === "branches" && branches.length === 0)}
      >
        <Save className="size-4" aria-hidden="true" />
        {pending ? "جارٍ الحفظ…" : "حفظ نطاق الاطلاع"}
      </Button>
    </div>
  );
}
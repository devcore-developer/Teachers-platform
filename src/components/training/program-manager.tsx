"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { GraduationCap, Pencil, Plus } from "lucide-react";

import {
  createProgramAction,
  setProgramStatusAction,
  updateProgramAction,
  type TrainingFormState,
} from "@/app/actions/training";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/platform/empty-state";
import { SectionCard } from "@/components/platform/section-card";
import { StatusBadge } from "@/components/platform/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  contentStatusLabel,
  TRAINING_CATEGORIES,
  TRAINING_CATEGORY_LABELS,
} from "@/config/training";
import type { ManageProgramRow } from "@/lib/training/service";

/* ------------------------------------------------------------------ */
/* Program management: create (draft), edit metadata, publish/archive.  */
/* Scope is fixed at creation — office managers never see the platform  */
/* option and the service re-forces it server-side.                     */
/* ------------------------------------------------------------------ */

export type ProgramRow = Omit<ManageProgramRow, "updatedAt"> & {
  updatedAtLabel: string;
};

interface ProgramManagerProps {
  programs: ProgramRow[];
  schools: { id: string; nameAr: string }[];
  isSuperAdmin: boolean;
}

function ProgramFields({
  idPrefix,
  initial,
  state,
}: {
  idPrefix: string;
  initial?: ProgramRow;
  state: TrainingFormState | null;
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-name-ar`}>اسم البرنامج بالعربية *</Label>
          <Input
            id={`${idPrefix}-name-ar`}
            name="nameAr"
            required
            defaultValue={initial?.nameAr}
            placeholder="مثال: برنامج التطوير المهني الشامل"
          />
          {state?.fieldErrors?.nameAr && (
            <p className="text-xs font-semibold text-destructive">
              {state.fieldErrors.nameAr}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-name-en`}>الاسم بالإنجليزية</Label>
          <Input
            id={`${idPrefix}-name-en`}
            name="nameEn"
            dir="ltr"
            defaultValue={initial?.nameEn ?? ""}
            placeholder="Optional English name"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-desc-ar`}>الوصف بالعربية *</Label>
          <Textarea
            id={`${idPrefix}-desc-ar`}
            name="descriptionAr"
            required
            rows={3}
            defaultValue={initial?.descriptionAr}
            placeholder="ماذا يقدم هذا البرنامج للمعلمين؟"
          />
          {state?.fieldErrors?.descriptionAr && (
            <p className="text-xs font-semibold text-destructive">
              {state.fieldErrors.descriptionAr}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-desc-en`}>الوصف بالإنجليزية</Label>
          <Textarea
            id={`${idPrefix}-desc-en`}
            name="descriptionEn"
            dir="ltr"
            rows={3}
            defaultValue={initial?.descriptionEn ?? ""}
            placeholder="Optional English description"
          />
        </div>
      </div>

      <div className="space-y-1.5 md:max-w-sm">
        <Label htmlFor={`${idPrefix}-category`}>التصنيف *</Label>
        <Select
          name="category"
          defaultValue={initial?.category ?? undefined}
        >
          <SelectTrigger id={`${idPrefix}-category`} className="w-full">
            <SelectValue placeholder="اختر التصنيف" />
          </SelectTrigger>
          <SelectContent>
            {TRAINING_CATEGORIES.map((key) => (
              <SelectItem key={key} value={key}>
                {TRAINING_CATEGORY_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {state?.fieldErrors?.category && (
          <p className="text-xs font-semibold text-destructive">
            {state.fieldErrors.category}
          </p>
        )}
      </div>
    </>
  );
}

function CreateSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <Plus className="size-4" aria-hidden="true" />
      {pending ? "جارٍ الإنشاء…" : "إنشاء البرنامج (مسودة)"}
    </Button>
  );
}

function CreateProgramForm({
  isSuperAdmin,
  schools,
}: {
  isSuperAdmin: boolean;
  schools: { id: string; nameAr: string }[];
}) {
  const [state, formAction] = React.useActionState<
    TrainingFormState | null,
    FormData
  >(createProgramAction, null);
  const [scope, setScope] = React.useState<"school" | "platform">("school");
  const [schoolId, setSchoolId] = React.useState<string>("");

  return (
    <SectionCard
      title="إنشاء برنامج تدريبي جديد"
      description="يُنشأ البرنامج كمسودة — انشره بعد مراجعته ليظهر كخيار عند بناء الدورات."
    >
      <form action={formAction} className="space-y-4" noValidate>
        {state?.message && (
          <Alert
            variant={state.ok ? "default" : "destructive"}
            role={state.ok ? "status" : "alert"}
          >
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        <ProgramFields idPrefix="program-new" state={state} />

        {isSuperAdmin ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="program-new-scope">نطاق البرنامج *</Label>
              <Select
                value={scope}
                onValueChange={(value) =>
                  setScope(value as "platform" | "school")
                }
              >
                <SelectTrigger id="program-new-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="school">خاصة بمدرسة محددة</SelectItem>
                  <SelectItem value="platform">
                    مشترك على مستوى المنصة
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "school" && (
              <div className="space-y-1.5">
                <Label htmlFor="program-new-school">المدرسة المالكة *</Label>
                <Select
                  name="schoolId"
                  value={schoolId || undefined}
                  onValueChange={setSchoolId}
                >
                  <SelectTrigger id="program-new-school" className="w-full">
                    <SelectValue placeholder="اختر المدرسة" />
                  </SelectTrigger>
                  <SelectContent>
                    {schools.map((school) => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.nameAr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        ) : null}

        <CreateSubmitButton />
      </form>
    </SectionCard>
  );
}

function EditProgramDialog({
  program,
  onClose,
}: {
  program: ProgramRow;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = React.useActionState<
    TrainingFormState | null,
    FormData
  >(updateProgramAction, null);

  React.useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  const scope = program.schoolId === null ? "platform" : "school";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>تعديل البرنامج</DialogTitle>
          <DialogDescription>
            النطاق ({program.schoolName ?? "منصة مشتركة"}) ثابت بعد الإنشاء.
          </DialogDescription>
        </DialogHeader>

        {state?.message && !state.ok && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="schoolId" value={program.schoolId ?? ""} />

          <ProgramFields idPrefix={`program-${program.id}`} initial={program} state={state} />

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "جارٍ الحفظ…" : "حفظ التعديلات"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProgramManager({
  programs,
  schools,
  isSuperAdmin,
}: ProgramManagerProps) {
  const [editing, setEditing] = React.useState<ProgramRow | null>(null);

  return (
    <div className="space-y-6">
      <CreateProgramForm isSuperAdmin={isSuperAdmin} schools={schools} />

      <div className="overflow-hidden rounded-xl border bg-card">
        {programs.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="لا توجد برامج تدريبية بعد"
            description="أنشئ أول برنامج من النموذج أعلاه — ثم اربط به دورات من صفحة إدارة الدورات."
            className="rounded-none border-0 bg-transparent"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>البرنامج</TableHead>
                  <TableHead>النطاق</TableHead>
                  <TableHead>التصنيف</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الدورات</TableHead>
                  <TableHead>آخر تحديث</TableHead>
                  <TableHead aria-label="إجراءات" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {programs.map((program) => (
                  <TableRow key={program.id}>
                    <TableCell>
                      <p className="text-sm font-bold">{program.nameAr}</p>
                      {program.nameEn && (
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {program.nameEn}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {program.schoolName ?? (
                        <span className="font-semibold text-brand-700">
                          منصة مشتركة
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {TRAINING_CATEGORY_LABELS[
                        program.category as keyof typeof TRAINING_CATEGORY_LABELS
                      ] ?? program.category}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={
                          program.status === "PUBLISHED"
                            ? "success"
                            : program.status === "ARCHIVED"
                              ? "neutral"
                              : "warning"
                        }
                      >
                        {contentStatusLabel(program.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {program.coursesCount}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {program.updatedAtLabel}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditing(program)}
                          className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent"
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                          تعديل
                        </button>
                        {program.status !== "PUBLISHED" && (
                          <form action={setProgramStatusAction}>
                            <input
                              type="hidden"
                              name="programId"
                              value={program.id}
                            />
                            <input type="hidden" name="status" value="PUBLISHED" />
                            <button
                              type="submit"
                              className="rounded-lg border px-2.5 py-1.5 text-xs font-bold text-success transition-colors hover:bg-success-soft"
                            >
                              نشر
                            </button>
                          </form>
                        )}
                        {program.status !== "DRAFT" && (
                          <form action={setProgramStatusAction}>
                            <input
                              type="hidden"
                              name="programId"
                              value={program.id}
                            />
                            <input type="hidden" name="status" value="DRAFT" />
                            <button
                              type="submit"
                              className="rounded-lg border px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent"
                            >
                              مسودة
                            </button>
                          </form>
                        )}
                        {program.status !== "ARCHIVED" && (
                          <form action={setProgramStatusAction}>
                            <input
                              type="hidden"
                              name="programId"
                              value={program.id}
                            />
                            <input type="hidden" name="status" value="ARCHIVED" />
                            <button
                              type="submit"
                              className="rounded-lg border px-2.5 py-1.5 text-xs font-bold text-warning transition-colors hover:bg-warning-soft"
                            >
                              أرشفة
                            </button>
                          </form>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {editing && (
        <EditProgramDialog program={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
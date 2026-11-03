"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  School as SchoolIcon,
} from "lucide-react";

import {
  createBranchAction,
  setBranchActiveAction,
  updateBranchAction,
} from "@/app/actions/schools";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { StatusBadge } from "@/components/platform/status-badge";
import { EmptyState } from "@/components/platform/empty-state";
import { SectionCard } from "@/components/platform/section-card";
import { branchStageLabel, BRANCH_STAGES } from "@/lib/validation/schools";
import type { BranchListItem } from "@/lib/schools/dto";

interface BranchesManagerProps {
  schoolId: string;
  branches: BranchListItem[];
}

interface BranchDialogState {
  open: boolean;
  editing: BranchListItem | null;
}

/** Draft form values for the branch dialog (kept in local state). */
interface BranchFormValues {
  nameAr: string;
  nameEn: string;
  stage: string;
  isActive: boolean;
}

const emptyForm: BranchFormValues = {
  nameAr: "",
  nameEn: "",
  stage: "primary",
  isActive: true,
};

/**
 * Branch management inside the school details view: list, create, edit,
 * change stage and activate/deactivate. Every mutation runs through the
 * server actions, which re-validate the branch↔school relationship on
 * the server — a branch can never be attached to a different school.
 */
export function BranchesManager({ schoolId, branches }: BranchesManagerProps) {
  const { toast } = useToast();
  const [dialog, setDialog] = React.useState<BranchDialogState>({
    open: false,
    editing: null,
  });
  const [form, setForm] = React.useState<BranchFormValues>(emptyForm);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  function openCreate() {
    setForm(emptyForm);
    setFormError(null);
    setFieldErrors({});
    setDialog({ open: true, editing: null });
  }

  function openEdit(branch: BranchListItem) {
    setForm({
      nameAr: branch.nameAr,
      nameEn: branch.nameEn ?? "",
      stage: branch.stage,
      isActive: branch.isActive,
    });
    setFormError(null);
    setFieldErrors({});
    setDialog({ open: true, editing: branch });
  }

  function closeDialog() {
    setDialog({ open: false, editing: null });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData();
    formData.set("nameAr", form.nameAr);
    formData.set("nameEn", form.nameEn);
    formData.set("stage", form.stage);
    if (!dialog.editing) formData.set("isActive", form.isActive ? "on" : "off");
    if (dialog.editing) formData.set("branchId", dialog.editing.id);

    const result = dialog.editing
      ? await updateBranchAction(schoolId, formData)
      : await createBranchAction(schoolId, formData);

    setSaving(false);

    if (result?.ok) {
      toast({
        title: dialog.editing ? "تم تحديث الفرع" : "تم إضافة الفرع",
        description: `«${form.nameAr}» — ${branchStageLabel(form.stage)}`,
      });
      closeDialog();
    } else {
      setFormError(result?.message ?? "حدث خطأ غير متوقع — أعد المحاولة");
      if (result?.fieldErrors) setFieldErrors(result.fieldErrors);
    }
  }

  function handleToggle(branch: BranchListItem) {
    setTogglingId(branch.id);
    const next = !branch.isActive;
    // Optimistic-free approach: wait for the server result, then let
    // revalidation refresh the row state.
    (async () => {
      const result = await setBranchActiveAction(schoolId, branch.id, next);
      setTogglingId(null);
      if (result?.ok) {
        toast({
          title: next ? "تم تفعيل الفرع" : "تم إيقاف الفرع",
          description: `«${branch.nameAr}»`,
        });
      } else {
        toast({
          title: "تعذر تغيير حالة الفرع",
          description: result?.message ?? "حدث خطأ غير متوقع — أعد المحاولة",
          variant: "destructive",
        });
      }
    })();
  }

  return (
    <SectionCard
      title="فروع المدرسة"
      description="الفروع التعليمية التابعة لهذه المدرسة ومراحلها — أسماء الفروع فريدة داخل المدرسة."
      action={
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" aria-hidden="true" />
          إضافة فرع
        </Button>
      }
    >
      {branches.length === 0 ? (
        <EmptyState
          icon={SchoolIcon}
          title="لا توجد فروع بعد"
          description="أضف أول فرع لهذه المدرسة وحدّد مرحلته التعليمية: ابتدائية أو إعدادية أو ثانوية."
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              إضافة فرع
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="py-3 ps-4">الفرع</TableHead>
                  <TableHead className="py-3">المرحلة التعليمية</TableHead>
                  <TableHead className="py-3">الحالة</TableHead>
                  <TableHead className="py-3">أُضيف في</TableHead>
                  <TableHead className="py-3 pe-4 text-end">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((branch) => (
                  <TableRow key={branch.id}>
                    <TableCell className="py-3 ps-4">
                      <p className="text-sm font-bold text-foreground">{branch.nameAr}</p>
                      {branch.nameEn && (
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {branch.nameEn}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">
                        {branchStageLabel(branch.stage)}
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      {branch.isActive ? (
                        <StatusBadge tone="success">نشط</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">موقوف</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {branch.createdAtLabel}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 pe-4">
                      <div className="flex items-center justify-end gap-2">
                        <Switch
                          checked={branch.isActive}
                          onCheckedChange={() => handleToggle(branch)}
                          disabled={togglingId === branch.id}
                          aria-label={
                            branch.isActive
                              ? `إيقاف فرع ${branch.nameAr}`
                              : `تفعيل فرع ${branch.nameAr}`
                          }
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(branch)}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                          تعديل
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden" role="list" aria-label="قائمة الفروع">
            {branches.map((branch) => (
              <li key={branch.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-sm font-bold text-foreground">
                      {branch.nameAr}
                    </p>
                    {branch.nameEn && (
                      <p className="truncate text-xs text-muted-foreground" dir="ltr">
                        {branch.nameEn}
                      </p>
                    )}
                  </div>
                  {branch.isActive ? (
                    <StatusBadge tone="success">نشط</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">موقوف</StatusBadge>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-3">
                  <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">
                    {branchStageLabel(branch.stage)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={branch.isActive}
                      onCheckedChange={() => handleToggle(branch)}
                      disabled={togglingId === branch.id}
                      aria-label={branch.isActive ? `إيقاف فرع ${branch.nameAr}` : `تفعيل فرع ${branch.nameAr}`}
                    />
                    <Button variant="outline" size="sm" onClick={() => openEdit(branch)}>
                      <Pencil className="size-3.5" aria-hidden="true" />
                      تعديل
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialog.open} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader className="text-start">
            <DialogTitle>
              {dialog.editing ? `تعديل فرع «${dialog.editing.nameAr}»` : "إضافة فرع جديد"}
            </DialogTitle>
            <DialogDescription>
              الفروع تابعة دائماً للمدرسة الحالية — لا يمكن نقل فرع إلى مدرسة أخرى من هذه الواجهة.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <p
                className="rounded-lg border border-error/30 bg-error-soft px-3 py-2.5 text-xs font-semibold text-error"
                role="alert"
              >
                {formError}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="branch-nameAr">
                اسم الفرع بالعربية <span className="text-error">*</span>
              </Label>
              <Input
                id="branch-nameAr"
                value={form.nameAr}
                onChange={(event) => setForm((f) => ({ ...f, nameAr: event.target.value }))}
                placeholder="مثال: فرع المنطقة الأولى"
                required
                aria-invalid={Boolean(fieldErrors.nameAr)}
              />
              {fieldErrors.nameAr && (
                <p className="text-xs font-semibold text-error" role="alert">
                  {fieldErrors.nameAr}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="branch-nameEn">
                  الاسم بالإنجليزية
                  <span className="ms-1 text-xs font-normal text-muted-foreground">(اختياري)</span>
                </Label>
                <Input
                  id="branch-nameEn"
                  value={form.nameEn}
                  onChange={(event) => setForm((f) => ({ ...f, nameEn: event.target.value }))}
                  placeholder="First District Branch"
                  dir="ltr"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="branch-stage">المرحلة التعليمية</Label>
                <Select
                  value={form.stage}
                  onValueChange={(value) => setForm((f) => ({ ...f, stage: value }))}
                >
                  <SelectTrigger id="branch-stage" aria-label="المرحلة التعليمية">
                    <SelectValue placeholder="اختر المرحلة" />
                  </SelectTrigger>
                  <SelectContent>
                    {BRANCH_STAGES.map((stage) => (
                      <SelectItem key={stage} value={stage}>
                        {branchStageLabel(stage)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!dialog.editing && (
              <div className="flex items-center justify-between rounded-xl border bg-muted/40 p-3.5">
                <div className="space-y-0.5">
                  <Label htmlFor="branch-active" className="text-sm font-bold">
                    تفعيل الفرع بعد الإضافة
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    الفروع الموقوفة تظهر في القائمة لكنها غير جاهزة للتشغيل.
                  </p>
                </div>
                <Switch
                  id="branch-active"
                  checked={form.isActive}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
                  aria-label="تفعيل الفرع بعد الإضافة"
                />
              </div>
            )}

            <DialogFooter className="gap-2 sm:justify-start">
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {dialog.editing ? "حفظ التعديلات" : "إضافة الفرع"}
              </Button>
              <Button type="button" variant="outline" onClick={closeDialog}>
                إلغاء
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Back to directory */}
      <p className="mt-4 text-xs text-muted-foreground">
        <Link
          href="/schools"
          className="inline-flex items-center gap-1 font-semibold text-brand-600 transition-colors hover:text-brand-700"
        >
          <ChevronRight className="size-3.5" aria-hidden="true" />
          العودة إلى دليل المدارس
        </Link>
      </p>
    </SectionCard>
  );
}
"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Link2,
  Pencil,
  Plus,
  Trash2,
  Video,
  type LucideIcon,
} from "lucide-react";

import {
  createLessonAction,
  createSectionAction,
  deleteLessonAction,
  deleteSectionAction,
  moveLessonAction,
  moveSectionAction,
  updateLessonAction,
  updateSectionAction,
  uploadLessonFileAction,
  type TrainingFormState,
} from "@/app/actions/training";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { LESSON_TYPES, LESSON_TYPE_LABELS } from "@/config/training";
import type { CourseManageDetail } from "@/lib/training/service";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Course content builder — sections & lessons with real server-side    */
/* persistence: create/edit/delete, swap-based reordering, per-type     */
/* lesson fields and real file uploads through the storage adapter.     */
/* ------------------------------------------------------------------ */

type SectionRow = CourseManageDetail["sections"][number];
type LessonRow = SectionRow["lessons"][number];

interface ContentBuilderProps {
  courseId: string;
  courseStatus: string;
  sections: SectionRow[];
}

const LESSON_ICONS: Record<string, LucideIcon> = {
  TEXT: FileText,
  VIDEO: Video,
  EXTERNAL_VIDEO: Link2,
  RESOURCE: Download,
};

/* --------------------------- Section form -------------------------- */

function SectionForm({
  courseId,
  section,
  onDone,
}: {
  courseId: string;
  section?: SectionRow;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = React.useActionState<
    TrainingFormState | null,
    FormData
  >(section ? updateSectionAction : createSectionAction, null);

  React.useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="courseId" value={courseId} />
      {section && (
        <input type="hidden" name="sectionId" value={section.id} />
      )}

      {state?.message && !state.ok && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`section-title-${section?.id ?? "new"}`}>
            عنوان القسم *
          </Label>
          <Input
            id={`section-title-${section?.id ?? "new"}`}
            name="titleAr"
            required
            defaultValue={section?.titleAr}
            placeholder="مثال: الوحدة الأولى — المداخل النظرية"
          />
          {state?.fieldErrors?.titleAr && (
            <p className="text-xs font-semibold text-destructive">
              {state.fieldErrors.titleAr}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`section-desc-${section?.id ?? "new"}`}>
            وصف مختصر
          </Label>
          <Input
            id={`section-desc-${section?.id ?? "new"}`}
            name="description"
            defaultValue={section?.description ?? ""}
            placeholder="اختياري"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          <Plus className="size-4" aria-hidden="true" />
          {isPending ? "جارٍ الحفظ…" : section ? "حفظ القسم" : "إضافة القسم"}
        </Button>
        {section && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            إلغاء
          </Button>
        )}
      </div>
    </form>
  );
}

/* --------------------------- Move / delete ------------------------- */

function SectionMove({
  courseId,
  sectionId,
  direction,
  disabled,
}: {
  courseId: string;
  sectionId: string;
  direction: "up" | "down";
  disabled: boolean;
}) {
  return (
    <form action={moveSectionAction}>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={direction === "up" ? "تحريك القسم لأعلى" : "تحريك القسم لأسفل"}
        className="inline-flex size-8 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
      >
        {direction === "up" ? (
          <ChevronUp className="size-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

function LessonMove({
  courseId,
  lessonId,
  direction,
  disabled,
}: {
  courseId: string;
  lessonId: string;
  direction: "up" | "down";
  disabled: boolean;
}) {
  return (
    <form action={moveLessonAction}>
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="lessonId" value={lessonId} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={direction === "up" ? "تحريك الدرس لأعلى" : "تحريك الدرس لأسفل"}
        className="inline-flex size-7 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent disabled:opacity-40"
      >
        {direction === "up" ? (
          <ChevronUp className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

/* --------------------------- Delete confirm ------------------------ */

/**
 * A trash-icon trigger that opens a styled, centered confirmation
 * modal instead of the browser's native confirm() bar. The hidden
 * sibling form carries the server action; confirming submits it.
 */
function ConfirmDeleteForm({
  action,
  hidden,
  title,
  description,
  submitAriaLabel,
  buttonClassName,
  iconClassName,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
  title: string;
  description: string;
  submitAriaLabel: string;
  buttonClassName: string;
  iconClassName: string;
}) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [open, setOpen] = React.useState(false);
  const [shown, setShown] = React.useState(false);

  /* Transition-in + body scroll lock while the modal is open. */
  React.useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  /* Escape cancels. */
  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={submitAriaLabel}
        onClick={() => setOpen(true)}
        className={buttonClassName}
      >
        <Trash2 className={iconClassName} aria-hidden="true" />
      </button>

      {/* The real server-action form — submitted on confirm. */}
      <form ref={formRef} action={action} className="hidden">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      </form>

      {open && (
        <div
          className={cn(
            "fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-200",
            shown ? "opacity-100" : "opacity-0"
          )}
        >
          {/* Backdrop — click to cancel. */}
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]"
            aria-hidden="true"
            onMouseDown={() => setOpen(false)}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirm-title"
            className={cn(
              "relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 transition-all duration-200",
              shown
                ? "translate-y-0 scale-100 opacity-100"
                : "translate-y-3 scale-95 opacity-0"
            )}
          >
            {/* Headline */}
            <div className="flex flex-col items-center px-6 pb-4 pt-8 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg shadow-red-600/25 ring-4 ring-red-100">
                <Trash2 className="size-7" aria-hidden="true" />
              </div>
              <h2
                id="delete-confirm-title"
                className="mt-4 text-lg font-extrabold text-slate-900"
              >
                {title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {description}
              </p>
            </div>

            <p className="mx-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-[11px] font-semibold text-amber-800">
              هذا الإجراء نهائي ولا يمكن التراجع عنه.
            </p>

            {/* Actions */}
            <div className="mt-5 grid grid-cols-2 gap-3 px-6 pb-6">
              <button
                type="button"
                autoFocus
                onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  formRef.current?.requestSubmit();
                }}
                className="rounded-xl bg-destructive px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-destructive/90"
              >
                حذف نهائي
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* --------------------------- Lesson dialog ------------------------- */

function LessonDialog({
  courseId,
  sectionId,
  sectionTitle,
  lesson,
  onClose,
}: {
  courseId: string;
  sectionId: string;
  sectionTitle: string;
  lesson?: LessonRow;
  onClose: () => void;
}) {
  const [type, setType] = React.useState<string>(lesson?.type ?? "TEXT");
  const [attachment, setAttachment] = React.useState<{
    id?: string;
    name?: string;
  }>(
    lesson?.attachmentId
      ? { id: lesson.attachmentId, name: lesson.attachmentName ?? undefined }
      : {}
  );

  const [state, formAction, isPending] = React.useActionState<
    TrainingFormState | null,
    FormData
  >(lesson ? updateLessonAction : createLessonAction, null);

  const [uploadState, uploadFormAction] = React.useActionState<
    TrainingFormState | null,
    FormData
  >(uploadLessonFileAction, null);

  React.useEffect(() => {
    if (uploadState?.ok && uploadState.attachmentId) {
      setAttachment({
        id: uploadState.attachmentId,
        name: uploadState.attachmentName,
      });
    }
  }, [uploadState]);

  React.useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  const needsAttachment = type === "VIDEO" || type === "RESOURCE";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {lesson ? "تعديل الدرس" : "إضافة درس جديد"}
          </DialogTitle>
          <DialogDescription>
            القسم: {sectionTitle} — اختر نوع الدرس وستظهر حقوله المطلوبة.
          </DialogDescription>
        </DialogHeader>

        {state?.message && !state.ok && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        {/* Upload form — a sibling form so the lesson form stays valid. */}
        {needsAttachment && (
          <div className="rounded-xl border bg-muted/30 p-3">
            <form action={uploadFormAction} className="space-y-2">
              <input type="hidden" name="courseId" value={courseId} />
              <input type="hidden" name="lessonId" value={lesson?.id ?? ""} />
              <input type="hidden" name="kind" value={type} />
              <Label htmlFor="lesson-file" className="text-xs">
                {type === "VIDEO"
                  ? "ملف الفيديو (MP4 أو WebM — حتى 200 ميغابايت)"
                  : "ملف المورد (PDF، Word، صور، فيديو — حتى 25 ميغابايت)"}
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="lesson-file"
                  name="file"
                  type="file"
                  className="w-64"
                  required
                />
                <Button type="submit" size="sm" variant="outline">
                  {uploadState?.ok ? "تم الرفع — استبدال" : "رفع الملف"}
                </Button>
              </div>
            </form>
            {attachment.id ? (
              <p className="mt-2 text-xs font-semibold text-success">
                الملف الحالي: {attachment.name ?? attachment.id}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                لم يُرفع ملف بعد — يلزم رفع الملف قبل الحفظ.
              </p>
            )}
            {uploadState?.message && !uploadState.ok && (
              <p className="mt-2 text-xs font-semibold text-destructive">
                {uploadState.message}
              </p>
            )}
          </div>
        )}

        <form action={formAction} className="space-y-3" noValidate>
          <input type="hidden" name="courseId" value={courseId} />
          <input type="hidden" name="sectionId" value={sectionId} />
          {lesson && <input type="hidden" name="lessonId" value={lesson.id} />}
          {needsAttachment && (
            <input type="hidden" name="attachmentId" value={attachment.id ?? ""} />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lesson-title">عنوان الدرس *</Label>
              <Input
                id="lesson-title"
                name="titleAr"
                required
                defaultValue={lesson?.titleAr}
                placeholder="مثال: مقدمة في التعلم النشط"
              />
              {state?.fieldErrors?.titleAr && (
                <p className="text-xs font-semibold text-destructive">
                  {state.fieldErrors.titleAr}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lesson-type">نوع الدرس *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="lesson-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LESSON_TYPES.map((key) => (
                    <SelectItem key={key} value={key}>
                      {LESSON_TYPE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Keep the selected type inside the submitted form. */}
              <input type="hidden" name="type" value={type} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lesson-desc">وصف مختصر</Label>
            <Input
              id="lesson-desc"
              name="description"
              defaultValue={lesson?.description ?? ""}
              placeholder="اختياري"
            />
          </div>

          {type === "TEXT" && (
            <div className="space-y-1.5">
              <Label htmlFor="lesson-content">محتوى الدرس النصي *</Label>
              <Textarea
                id="lesson-content"
                name="content"
                rows={8}
                defaultValue={lesson?.content ?? ""}
                placeholder="اكتب محتوى الدرس كنص عادي — يُعرض بأمان دون أي HTML."
              />
              {state?.fieldErrors?.content && (
                <p className="text-xs font-semibold text-destructive">
                  {state.fieldErrors.content}
                </p>
              )}
            </div>
          )}

          {type === "EXTERNAL_VIDEO" && (
            <div className="space-y-1.5">
              <Label htmlFor="lesson-video-url">رابط الفيديو الخارجي *</Label>
              <Input
                id="lesson-video-url"
                name="videoUrl"
                dir="ltr"
                defaultValue={lesson?.videoUrl ?? ""}
                placeholder="https://www.youtube.com/watch?v=…"
              />
              <p className="text-[11px] text-muted-foreground">
                يُسمح فقط بروابط YouTube أو Vimeo عبر https — لا يُرفع أي
                ملف هنا.
              </p>
              {state?.fieldErrors?.videoUrl && (
                <p className="text-xs font-semibold text-destructive">
                  {state.fieldErrors.videoUrl}
                </p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              name="isPublished"
              defaultChecked={lesson?.isPublished ?? false}
              className="size-4 rounded border-input accent-brand-600"
            />
            درس منشور (مرئي للمعلمين في الدورة المنشورة)
          </label>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "جارٍ الحفظ…" : lesson ? "حفظ الدرس" : "إضافة الدرس"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Main builder -------------------------- */

export function ContentBuilder({
  courseId,
  courseStatus,
  sections,
}: ContentBuilderProps) {
  const [editingSectionId, setEditingSectionId] = React.useState<
    string | null
  >(null);
  const [addingSection, setAddingSection] = React.useState(false);
  const [dialog, setDialog] = React.useState<{
    sectionId: string;
    sectionTitle: string;
    lesson?: LessonRow;
  } | null>(null);

  return (
    <SectionCard
      title="محتوى الدورة"
      description="أقسام الدورة ودروسها بالترتيب — الترتيب يُحفظ فورًا في قاعدة البيانات، والدروس غير المنشورة تبقى مخفية عن المعلمين."
      action={
        <StatusBadge
          tone={courseStatus === "PUBLISHED" ? "success" : "neutral"}
        >
          {courseStatus === "PUBLISHED"
            ? "دورة منشورة"
            : "الدورة غير منشورة بعد"}
        </StatusBadge>
      }
    >
      {sections.length === 0 && !addingSection ? (
        <EmptyState
          icon={FileText}
          title="لا توجد أقسام بعد"
          description="ابدأ بإضافة أول قسم ثم أضف دروسه — لا يمكن نشر الدورة قبل وجود قسم ودرس واحد على الأقل."
          action={
            <Button size="sm" onClick={() => setAddingSection(true)}>
              <Plus className="size-4" aria-hidden="true" />
              إضافة أول قسم
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {sections.map((section, index) => (
            <div key={section.id} className="rounded-xl border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-100 text-xs font-extrabold text-brand-700">
                      {index + 1}
                    </span>
                    {section.titleAr}
                  </p>
                  {section.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {section.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="me-1 text-[11px] font-semibold text-muted-foreground">
                    {section.lessons.length} درس
                  </span>
                  <SectionMove
                    courseId={courseId}
                    sectionId={section.id}
                    direction="up"
                    disabled={index === 0}
                  />
                  <SectionMove
                    courseId={courseId}
                    sectionId={section.id}
                    direction="down"
                    disabled={index === sections.length - 1}
                  />
                  <button
                    type="button"
                    aria-label="تحرير القسم"
                    onClick={() =>
                      setEditingSectionId(
                        editingSectionId === section.id ? null : section.id
                      )
                    }
                    className="inline-flex size-8 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <ConfirmDeleteForm
                    action={deleteSectionAction}
                    hidden={{ courseId, sectionId: section.id }}
                    title="حذف القسم؟"
                    description={`سيتم حذف القسم «${section.titleAr}» وكل دروسه وملفاته نهائيًا.`}
                    submitAriaLabel="حذف القسم"
                    buttonClassName="inline-flex size-8 items-center justify-center rounded-lg border text-destructive transition-colors hover:bg-destructive/10"
                    iconClassName="size-4"
                  />
                </div>
              </div>

              {editingSectionId === section.id ? (
                <div className="border-b bg-muted/20 px-4 py-3">
                  <SectionForm
                    courseId={courseId}
                    section={section}
                    onDone={() => setEditingSectionId(null)}
                  />
                </div>
              ) : null}

              <div className="divide-y">
                {section.lessons.map((lesson, lessonIndex) => {
                  const Icon = LESSON_ICONS[lesson.type] ?? FileText;
                  return (
                    <div
                      key={lesson.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                          aria-hidden="true"
                        >
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {lesson.titleAr}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {LESSON_TYPE_LABELS[lesson.type as keyof typeof LESSON_TYPE_LABELS] ?? lesson.type}
                            {lesson.attachmentName
                              ? ` • ${lesson.attachmentName}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge
                          tone={lesson.isPublished ? "success" : "warning"}
                          withDot={false}
                        >
                          {lesson.isPublished ? "منشور" : "مسودة"}
                        </StatusBadge>
                        <LessonMove
                          courseId={courseId}
                          lessonId={lesson.id}
                          direction="up"
                          disabled={lessonIndex === 0}
                        />
                        <LessonMove
                          courseId={courseId}
                          lessonId={lesson.id}
                          direction="down"
                          disabled={lessonIndex === section.lessons.length - 1}
                        />
                        <button
                          type="button"
                          aria-label="تحرير الدرس"
                          onClick={() =>
                            setDialog({
                              sectionId: section.id,
                              sectionTitle: section.titleAr,
                              lesson,
                            })
                          }
                          className="inline-flex size-7 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent"
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </button>
                        <ConfirmDeleteForm
                          action={deleteLessonAction}
                          hidden={{ courseId, lessonId: lesson.id }}
                          title="حذف الدرس؟"
                          description={`سيتم حذف الدرس «${lesson.titleAr}» وملفاته نهائيًا.`}
                          submitAriaLabel="حذف الدرس"
                          buttonClassName="inline-flex size-7 items-center justify-center rounded-lg border text-destructive transition-colors hover:bg-destructive/10"
                          iconClassName="size-3.5"
                        />
                      </div>
                    </div>
                  );
                })}

                <div className="px-4 py-2.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDialog({
                        sectionId: section.id,
                        sectionTitle: section.titleAr,
                      })
                    }
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    إضافة درس إلى هذا القسم
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {addingSection ? (
            <div className="rounded-xl border border-dashed bg-muted/20 p-4">
              <SectionForm
                courseId={courseId}
                onDone={() => setAddingSection(false)}
              />
            </div>
          ) : (
            sections.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAddingSection(true)}
              >
                <Plus className="size-4" aria-hidden="true" />
                إضافة قسم جديد
              </Button>
            )
          )}
        </div>
      )}

      {dialog && (
        <LessonDialog
          courseId={courseId}
          sectionId={dialog.sectionId}
          sectionTitle={dialog.sectionTitle}
          lesson={dialog.lesson}
          onClose={() => setDialog(null)}
        />
      )}
    </SectionCard>
  );
}
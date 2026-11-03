"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Save, School } from "lucide-react";

import {
  createCourseAction,
  updateCourseAction,
  type TrainingFormState,
} from "@/app/actions/training";
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
import { SectionCard } from "@/components/platform/section-card";
import {
  COURSE_LEVELS,
  COURSE_LEVEL_LABELS,
  TRAINING_CATEGORIES,
  TRAINING_CATEGORY_LABELS,
} from "@/config/training";

/* ------------------------------------------------------------------ */
/* Course create/edit form. Scope (platform-wide vs school) is chosen   */
/* by SUPER_ADMIN only; office managers are fixed to their own school.  */
/* The service re-validates every relation server-side.                 */
/* ------------------------------------------------------------------ */

export interface CourseFormInitial {
  titleAr: string;
  titleEn: string | null;
  descriptionAr: string;
  descriptionEn: string | null;
  category: string;
  programId: string | null;
  level: string | null;
  estimatedHours: number | null;
  instructorId: string | null;
  schoolId: string | null;
}

interface CourseFormProps {
  mode: "create" | "edit";
  courseId?: string;
  initial?: CourseFormInitial;
  programOptions: { id: string; nameAr: string; platformWide: boolean }[];
  schools: { id: string; nameAr: string }[];
  instructors: { id: string; name: string; schoolId: string | null }[];
  showScope: boolean;
  defaultScope: "platform" | "school";
  fixedSchoolId?: string;
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="sm">
      <School className="size-4" aria-hidden="true" />
      {pending
        ? "جارٍ الحفظ…"
        : mode === "create"
          ? "إنشاء الدورة والانتقال لبناء المحتوى"
          : "حفظ التعديلات"}
    </Button>
  );
}

export function CourseForm({
  mode,
  courseId,
  initial,
  programOptions,
  schools,
  instructors,
  showScope,
  defaultScope,
  fixedSchoolId,
}: CourseFormProps) {
  const action = mode === "create" ? createCourseAction : updateCourseAction;
  const [state, formAction] = React.useActionState<
    TrainingFormState | null,
    FormData
  >(action, null);

  const [scope, setScope] = React.useState<"platform" | "school">(
    initial?.schoolId === null ? "platform" : defaultScope
  );
  const [schoolId, setSchoolId] = React.useState<string>(
    initial?.schoolId ?? fixedSchoolId ?? ""
  );
  const [instructorId, setInstructorId] = React.useState<string>(
    initial?.instructorId ?? "none"
  );

  const instructorOptions = React.useMemo(() => {
    if (!showScope) return instructors; // office manager: pre-scoped
    if (scope === "platform") return []; // platform courses: no school staff
    return instructors.filter((instructor) => instructor.schoolId === schoolId);
  }, [instructors, scope, schoolId, showScope]);

  React.useEffect(() => {
    setInstructorId("none");
  }, [schoolId, scope]);

  // Edit mode locks the creation scope (platform vs school) — derive it
  // from the initial record; create mode uses the (super-admin) choice.
  const effectiveScope = showScope
    ? scope
    : initial
      ? initial.schoolId === null
        ? "platform"
        : "school"
      : "school";

  return (
    <SectionCard
      title={mode === "create" ? "دورة تدريبية جديدة" : "بيانات الدورة"}
      description="الحقول العربية إلزامية — الإنجليزية والبرنامج والمستوى والمدة والمدرّب اختيارية. تُحفظ الدورة كمسودة ويمكنك بناء محتواها بعد الإنشاء."
    >
      <form action={formAction} className="space-y-4" noValidate>
        {state?.message && (
          <Alert variant={state.ok ? "default" : "destructive"} role={state.ok ? "status" : "alert"}>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        {mode === "edit" && courseId && (
          <input type="hidden" name="courseId" value={courseId} />
        )}
        {/* Scope never changes after creation — always submitted. */}
        <input type="hidden" name="scope" value={effectiveScope} />
        <input
          type="hidden"
          name="schoolId"
          value={effectiveScope === "platform" ? "" : schoolId}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="course-title-ar">العنوان بالعربية *</Label>
            <Input
              id="course-title-ar"
              name="titleAr"
              required
              defaultValue={initial?.titleAr}
              placeholder="مثال: استراتيجيات التعلم النشط"
            />
            {state?.fieldErrors?.titleAr && (
              <p className="text-xs font-semibold text-destructive">
                {state.fieldErrors.titleAr}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course-title-en">العنوان بالإنجليزية</Label>
            <Input
              id="course-title-en"
              name="titleEn"
              dir="ltr"
              defaultValue={initial?.titleEn ?? ""}
              placeholder="Optional English title"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="course-desc-ar">الوصف بالعربية *</Label>
            <Textarea
              id="course-desc-ar"
              name="descriptionAr"
              required
              rows={4}
              defaultValue={initial?.descriptionAr}
              placeholder="ماذا سيتعلم المعلم من هذه الدورة؟"
            />
            {state?.fieldErrors?.descriptionAr && (
              <p className="text-xs font-semibold text-destructive">
                {state.fieldErrors.descriptionAr}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course-desc-en">الوصف بالإنجليزية</Label>
            <Textarea
              id="course-desc-en"
              name="descriptionEn"
              dir="ltr"
              rows={4}
              defaultValue={initial?.descriptionEn ?? ""}
              placeholder="Optional English description"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="course-category">التصنيف *</Label>
            <Select name="category" defaultValue={initial?.category ?? undefined}>
              <SelectTrigger id="course-category" className="w-full">
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

          <div className="space-y-1.5">
            <Label htmlFor="course-program">البرنامج التدريبي</Label>
            <Select
              name="programId"
              defaultValue={initial?.programId ?? "none"}
            >
              <SelectTrigger id="course-program" className="w-full">
                <SelectValue placeholder="بدون برنامج" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بدون برنامج</SelectItem>
                {programOptions.map((program) => (
                  <SelectItem key={program.id} value={program.id}>
                    {program.nameAr}
                    {program.platformWide ? " — مشترك" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course-level">مستوى الصعوبة</Label>
            <Select name="level" defaultValue={initial?.level ?? "none"}>
              <SelectTrigger id="course-level" className="w-full">
                <SelectValue placeholder="غير محدد" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">غير محدد</SelectItem>
                {COURSE_LEVELS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {COURSE_LEVEL_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course-hours">المدة التقديرية (ساعات)</Label>
            <Input
              id="course-hours"
              name="estimatedHours"
              type="number"
              min={1}
              max={500}
              defaultValue={initial?.estimatedHours ?? ""}
              placeholder="مثال: 6"
            />
            {state?.fieldErrors?.estimatedHours && (
              <p className="text-xs font-semibold text-destructive">
                {state.fieldErrors.estimatedHours}
              </p>
            )}
          </div>
        </div>

        {showScope && mode === "create" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="course-scope">نطاق الدورة *</Label>
              <Select
                value={scope}
                onValueChange={(value) => setScope(value as "platform" | "school")}
              >
                <SelectTrigger id="course-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="school">خاصة بمدرسة محددة</SelectItem>
                  <SelectItem value="platform">
                    مشتركة على مستوى المنصة
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scope === "school" && (
              <div className="space-y-1.5">
                <Label htmlFor="course-school">المدرسة المالكة *</Label>
                <Select
                  value={schoolId || undefined}
                  onValueChange={(value) => setSchoolId(value)}
                >
                  <SelectTrigger id="course-school" className="w-full">
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

        {effectiveScope === "school" && schoolId ? (
          <div className="space-y-1.5 md:max-w-sm">
            <Label htmlFor="course-instructor">المدرّب المسؤول</Label>
            <Select
              name="instructorId"
              value={instructorId}
              onValueChange={setInstructorId}
            >
              <SelectTrigger id="course-instructor" className="w-full">
                <SelectValue placeholder="بدون مدرّب" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بدون مدرّب</SelectItem>
                {instructorOptions.map((instructor) => (
                  <SelectItem key={instructor.id} value={instructor.id}>
                    {instructor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state?.fieldErrors?.instructorId && (
              <p className="text-xs font-semibold text-destructive">
                {state.fieldErrors.instructorId}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            المدرّب متاح للدورات الخاصة بمدرسة محددة — يُختار من معلمي
            المدرسة أو مشرفيها التربويين.
          </p>
        )}

        <div className="flex items-center gap-3">
          <SubmitButton mode={mode} />
          {state?.ok && state.message && (
            <span className="text-xs font-semibold text-success">
              {state.message}
            </span>
          )}
        </div>
      </form>
    </SectionCard>
  );
}
"use client";

import * as React from "react";
import { Save } from "lucide-react";

import {
  createAssessmentAction,
  updateAssessmentAction,
  type AssessmentFormState,
} from "@/app/actions/assessment";
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

export interface CourseOption {
  id: string;
  titleAr: string;
  schoolId: string | null;
}

export interface SchoolOption {
  id: string;
  nameAr: string;
}

export interface AssessmentFormValues {
  titleAr: string;
  titleEn: string;
  instructionsAr: string;
  instructionsEn: string;
  courseId: string;
  passingScore: string;
  timeLimitMinutes: string;
  attemptLimit: string;
  availableFrom: string;
  availableUntil: string;
}

interface AssessmentFormProps {
  mode: "create" | "edit";
  assessmentId?: string;
  initialValues?: Partial<AssessmentFormValues>;
  courseOptions: CourseOption[];
  schoolOptions: SchoolOption[];
  isSuperAdmin: boolean;
  /** Tenancy (scope + school) is fixed after creation. */
  lockedTenancy?: { scope: "platform" | "school"; schoolName: string | null };
}

/** Convert an ISO/Date string to the datetime-local input format. */
function toDatetimeLocal(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const emptyValues: AssessmentFormValues = {
  titleAr: "",
  titleEn: "",
  instructionsAr: "",
  instructionsEn: "",
  courseId: "",
  passingScore: "",
  timeLimitMinutes: "",
  attemptLimit: "",
  availableFrom: "",
  availableUntil: "",
};

/**
 * Assessment settings form (create + edit). Tenancy fields are rendered
 * read-only in edit mode — the server ignores them there anyway.
 */
export function AssessmentForm({
  mode,
  assessmentId,
  initialValues,
  courseOptions,
  schoolOptions,
  isSuperAdmin,
  lockedTenancy,
}: AssessmentFormProps) {
  const [state, formAction] = React.useActionState<
    AssessmentFormState | null,
    FormData
  >(mode === "create" ? createAssessmentAction : updateAssessmentAction, null);

  const values = { ...emptyValues, ...initialValues };
  const [scope, setScope] = React.useState<"platform" | "school">(
    lockedTenancy?.scope ?? "school"
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {mode === "edit" && assessmentId && (
        <input type="hidden" name="assessmentId" value={assessmentId} />
      )}

      {state?.message && (
        <Alert
          variant={state.ok ? "default" : "destructive"}
          role={state.ok ? "status" : "alert"}
        >
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="titleAr">عنوان الاختبار (بالعربية) *</Label>
          <Input
            id="titleAr"
            name="titleAr"
            defaultValue={values.titleAr}
            required
            aria-invalid={Boolean(state?.fieldErrors?.titleAr)}
          />
          {state?.fieldErrors?.titleAr && (
            <p className="text-xs font-semibold text-destructive">
              {state.fieldErrors.titleAr}
            </p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="titleEn">العنوان بالإنجليزية (اختياري)</Label>
          <Input
            id="titleEn"
            name="titleEn"
            dir="ltr"
            defaultValue={values.titleEn}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="instructionsAr">تعليمات الاختبار (بالعربية) *</Label>
          <Textarea
            id="instructionsAr"
            name="instructionsAr"
            rows={4}
            defaultValue={values.instructionsAr}
            required
            aria-invalid={Boolean(state?.fieldErrors?.instructionsAr)}
          />
          {state?.fieldErrors?.instructionsAr && (
            <p className="text-xs font-semibold text-destructive">
              {state.fieldErrors.instructionsAr}
            </p>
          )}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="instructionsEn">التعليمات بالإنجليزية (اختياري)</Label>
          <Textarea
            id="instructionsEn"
            name="instructionsEn"
            dir="ltr"
            rows={3}
            defaultValue={values.instructionsEn}
          />
        </div>
      </div>

      {/* Tenancy */}
      {mode === "create" ? (
        isSuperAdmin ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>نطاق الاختبار *</Label>
              <Select
                name="scope"
                value={scope}
                onValueChange={(value) =>
                  setScope(value as "platform" | "school")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="platform">منصة مشتركة (لكل المدارس)</SelectItem>
                  <SelectItem value="school">مدرسة محددة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "school" && (
              <div className="space-y-1.5">
                <Label htmlFor="schoolId">المدرسة المالكة *</Label>
                <Select name="schoolId" defaultValue="none">
                  <SelectTrigger id="schoolId">
                    <SelectValue placeholder="اختر المدرسة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">اختر المدرسة</SelectItem>
                    {schoolOptions.map((school) => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.nameAr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {state?.fieldErrors?.schoolId && (
                  <p className="text-xs font-semibold text-destructive">
                    {state.fieldErrors.schoolId}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <input type="hidden" name="scope" value="school" />
        )
      ) : (
        lockedTenancy && (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            النطاق:{" "}
            {lockedTenancy.scope === "platform"
              ? "منصة مشتركة"
              : lockedTenancy.schoolName ?? "مدرسة"}{" "}
            — لا يمكن تغييره بعد الإنشاء.
          </p>
        )
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="courseId">الدورة المرتبطة (اختياري)</Label>
          <Select
            name="courseId"
            defaultValue={values.courseId || "none"}
          >
            <SelectTrigger id="courseId">
              <SelectValue placeholder="بدون ربط بدورة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">بدون ربط بدورة</SelectItem>
              {courseOptions.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {course.titleAr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            عند الربط: لا يستطيع المعلم بدء الاختبار إلا إذا كان مسجلًا في الدورة.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="passingScore">درجة النجاح (نقاط) *</Label>
          <Input
            id="passingScore"
            name="passingScore"
            type="number"
            min={1}
            dir="ltr"
            defaultValue={values.passingScore}
            required
            aria-invalid={Boolean(state?.fieldErrors?.passingScore)}
          />
          {state?.fieldErrors?.passingScore && (
            <p className="text-xs font-semibold text-destructive">
              {state.fieldErrors.passingScore}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="timeLimitMinutes">مدة الاختبار بالدقائق (اختياري)</Label>
          <Input
            id="timeLimitMinutes"
            name="timeLimitMinutes"
            type="number"
            min={5}
            max={300}
            dir="ltr"
            defaultValue={values.timeLimitMinutes}
            placeholder="بدون تحديد = اختبار غير مؤقت"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="attemptLimit">حد المحاولات (اختياري)</Label>
          <Input
            id="attemptLimit"
            name="attemptLimit"
            type="number"
            min={1}
            max={10}
            dir="ltr"
            defaultValue={values.attemptLimit}
            placeholder="بدون تحديد = محاولات غير محدودة"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="availableFrom">بداية التوافر (اختياري)</Label>
          <Input
            id="availableFrom"
            name="availableFrom"
            type="datetime-local"
            dir="ltr"
            defaultValue={toDatetimeLocal(values.availableFrom)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="availableUntil">نهاية التوافر (اختياري)</Label>
          <Input
            id="availableUntil"
            name="availableUntil"
            type="datetime-local"
            dir="ltr"
            defaultValue={toDatetimeLocal(values.availableUntil)}
          />
          {state?.fieldErrors?.availableUntil && (
            <p className="text-xs font-semibold text-destructive">
              {state.fieldErrors.availableUntil}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit">
          <Save className="size-4" aria-hidden="true" />
          {mode === "create" ? "إنشاء الاختبار (يبدأ كمسودة)" : "حفظ الإعدادات"}
        </Button>
      </div>
    </form>
  );
}
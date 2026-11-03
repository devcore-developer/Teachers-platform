"use client";

import * as React from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { AlertCircle, CheckCircle2, ImageIcon, Loader2 } from "lucide-react";

import { createSchoolAction, updateSchoolAction } from "@/app/actions/schools";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { slugify } from "@/lib/validation/schools";
import { schoolInitials, type SchoolListItem } from "@/lib/schools/dto";

interface SchoolFormProps {
  mode: "create" | "edit";
  initial?: SchoolListItem;
}

const PLATFORM_DEFAULT_COLOR = "#1D5BD6";

function SubmitButton({ mode }: { mode: SchoolFormProps["mode"] }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {mode === "create" ? "إنشاء المدرسة" : "حفظ التعديلات"}
    </Button>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-xs font-semibold text-error" role="alert">
      {message}
    </p>
  );
}

/**
 * Create/edit school form. All validation runs again on the server
 * (server action + Zod); field errors below mirror the server result.
 */
export function SchoolForm({ mode, initial }: SchoolFormProps) {
  const { toast } = useToast();
  const action = mode === "create" ? createSchoolAction : updateSchoolAction;
  const [state, formAction] = useActionState(action, null);

  const [nameEn, setNameEn] = React.useState(initial?.nameEn ?? "");
  const [slug, setSlug] = React.useState(initial?.slug ?? "");
  const [slugEdited, setSlugEdited] = React.useState(mode === "edit");
  const [logoUrl, setLogoUrl] = React.useState(initial?.logoUrl ?? "");
  const [logoBroken, setLogoBroken] = React.useState(false);
  const [brandColor, setBrandColor] = React.useState(
    initial?.brandColor ?? PLATFORM_DEFAULT_COLOR
  );
  const [isActive, setIsActive] = React.useState(initial?.isActive ?? true);

  // Edit mode: surface the success feedback (create mode redirects).
  React.useEffect(() => {
    if (state?.ok) {
      toast({
        title: "تم حفظ التعديلات",
        description: "تم تحديث بيانات المدرسة بنجاح.",
      });
    }
  }, [state, toast]);

  const fieldErrors = state && "fieldErrors" in state ? state.fieldErrors : undefined;
  const formMessage = state && "message" in state && !state.ok ? state.message : undefined;

  return (
    <form action={formAction} className="space-y-6">
      {mode === "edit" && <input type="hidden" name="id" value={initial?.id} />}

      {formMessage && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertDescription>{formMessage}</AlertDescription>
        </Alert>
      )}

      {/* Names */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="nameAr">
            اسم المدرسة بالعربية <span className="text-error">*</span>
          </Label>
          <Input
            id="nameAr"
            name="nameAr"
            defaultValue={initial?.nameAr}
            placeholder="مثال: مدرسة قرطبة النموذجية"
            required
            aria-invalid={Boolean(fieldErrors?.nameAr)}
            className={cn(fieldErrors?.nameAr && "border-error focus-visible:ring-error/30")}
          />
          <FieldError message={fieldErrors?.nameAr} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="nameEn">
            اسم المدرسة بالإنجليزية
            <span className="ms-1 text-xs font-normal text-muted-foreground">(اختياري)</span>
          </Label>
          <Input
            id="nameEn"
            name="nameEn"
            value={nameEn}
            onChange={(event) => {
              setNameEn(event.target.value);
              if (!slugEdited) setSlug(slugify(event.target.value));
            }}
            placeholder="Qurtuba Model School"
            dir="ltr"
            aria-invalid={Boolean(fieldErrors?.nameEn)}
            className={cn(fieldErrors?.nameEn && "border-error focus-visible:ring-error/30")}
          />
          <FieldError message={fieldErrors?.nameEn} />
        </div>
      </div>

      {/* Slug */}
      <div className="space-y-2">
        <Label htmlFor="slug">
          الرابط المختصر (Slug)
          <span className="ms-1 text-xs font-normal text-muted-foreground">
            — يُولَّد تلقائياً من الاسم الإنجليزي ويمكن تعديله
          </span>
        </Label>
        <Input
          id="slug"
          name="slug"
          value={slug}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(event.target.value);
          }}
          placeholder="qurtuba-school"
          dir="ltr"
          aria-invalid={Boolean(fieldErrors?.slug)}
          className={cn(
            "font-mono text-sm",
            fieldErrors?.slug && "border-error focus-visible:ring-error/30"
          )}
        />
        <FieldError message={fieldErrors?.slug} />
      </div>

      {/* Logo + brand color */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="logoUrl">
            رابط شعار المدرسة
            <span className="ms-1 text-xs font-normal text-muted-foreground">(اختياري)</span>
          </Label>
          <div className="flex items-center gap-3">
            {/* Preview + fallback */}
            {logoUrl && !logoBroken ? (
              <img
                src={logoUrl}
                alt="معاينة الشعار"
                className="size-12 shrink-0 rounded-xl border bg-card object-contain p-1"
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <span
                className="flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: brandColor }}
                aria-hidden="true"
              >
                {initial?.nameAr ? (
                  schoolInitials(initial.nameAr)
                ) : (
                  <ImageIcon className="size-5" />
                )}
              </span>
            )}
            <Input
              id="logoUrl"
              name="logoUrl"
              value={logoUrl}
              onChange={(event) => {
                setLogoUrl(event.target.value);
                setLogoBroken(false);
              }}
              placeholder="https://example.com/logo.png"
              dir="ltr"
              aria-invalid={Boolean(fieldErrors?.logoUrl)}
              className={cn(
                "flex-1 text-sm",
                fieldErrors?.logoUrl && "border-error focus-visible:ring-error/30"
              )}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            الصق رابط صورة الشعار (PNG/SVG). رفع الملفات مباشرة متاح في مرحلة لاحقة عند ربط نظام تخزين الملفات.
          </p>
          <FieldError message={fieldErrors?.logoUrl} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="brandColor">لون الهوية الأساسي</Label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : PLATFORM_DEFAULT_COLOR}
              onChange={(event) => setBrandColor(event.target.value)}
              className="size-10 shrink-0 cursor-pointer rounded-lg border bg-card p-1"
              aria-label="اختيار لون الهوية"
            />
            <Input
              id="brandColor"
              name="brandColor"
              value={brandColor}
              onChange={(event) => setBrandColor(event.target.value)}
              placeholder="#1D5BD6"
              dir="ltr"
              aria-invalid={Boolean(fieldErrors?.brandColor)}
              className={cn(
                "font-mono text-sm",
                fieldErrors?.brandColor && "border-error focus-visible:ring-error/30"
              )}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            الافتراضي أزرق المنصة ({PLATFORM_DEFAULT_COLOR}). يُستخدم للشعار البديل وعناصر هوية المدرسة.
          </p>
          <FieldError message={fieldErrors?.brandColor} />
        </div>
      </div>

      {/* Initial status (create mode only; editing uses the status toggle) */}
      {mode === "create" && (
        <div className="flex items-center justify-between rounded-xl border bg-card p-4">
          <div className="space-y-0.5">
            <Label htmlFor="isActive" className="text-sm font-bold">
              تفعيل المدرسة بعد الإنشاء
            </Label>
            <p className="text-xs text-muted-foreground">
              المدارس الموقوفة تظهر في الدليل لكنها غير جاهزة للتشغيل.
            </p>
          </div>
          {/* Hidden input feeds the server action (Radix Switch renders a button, not a checkbox) */}
          <input type="hidden" name="isActive" value={isActive ? "on" : "off"} />
          <Switch
            id="isActive"
            checked={isActive}
            onCheckedChange={setIsActive}
            aria-label="تفعيل المدرسة بعد الإنشاء"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 border-t pt-5">
        <SubmitButton mode={mode} />
        <Button variant="outline" asChild>
          <Link href={mode === "edit" ? `/schools/${initial?.id}` : "/schools"}>إلغاء</Link>
        </Button>
        {state?.ok && (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            تم الحفظ بنجاح
          </span>
        )}
      </div>
    </form>
  );
}
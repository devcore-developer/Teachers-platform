"use client";

import * as React from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ImageIcon,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react";

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

/** أقصى حجم مسموح به لملف الشعار — 200KB */
const MAX_LOGO_BYTES = 200 * 1024;

const ACCEPTED_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
];

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
 *
 * الشعار: رفع ملف حقيقي من الجهاز — الصورة تُقرأ في المتصفح وتتحول إلى
 * data URL وتُحفظ في حقل logoUrl الموجود بالفعل، بدون أي نظام تخزين
 * خارجي وبدون أي تغيير في الـ schema. معاينة فورية + استبدال + إزالة
 * + حالات تحميل وخطأ ونجاح، ويعمل في الإنشاء والتعديل.
 */
export function SchoolForm({ mode, initial }: SchoolFormProps) {
  const { toast } = useToast();
  const action = mode === "create" ? createSchoolAction : updateSchoolAction;
  const [state, formAction] = useActionState(action, null);

  const [nameEn, setNameEn] = React.useState(initial?.nameEn ?? "");
  const [slug, setSlug] = React.useState(initial?.slug ?? "");
  const [slugEdited, setSlugEdited] = React.useState(mode === "edit");
  const [logoValue, setLogoValue] = React.useState(initial?.logoUrl ?? "");
  const [logoPreview, setLogoPreview] = React.useState<string | null>(
    initial?.logoUrl ?? null
  );
  const [logoBroken, setLogoBroken] = React.useState(false);
  const [logoError, setLogoError] = React.useState<string | null>(null);
  const [logoLoading, setLogoLoading] = React.useState(false);
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

  const fieldErrors =
    state && "fieldErrors" in state ? state.fieldErrors : undefined;
  const formMessage =
    state && "message" in state && !state.ok ? state.message : undefined;

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // تصفير الحقل يسمح بإعادة اختيار نفس الملف بعد الإزالة أو الاستبدال
    event.target.value = "";
    setLogoError(null);
    setLogoBroken(false);
    if (!file) return;

    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setLogoError("صيغة غير مدعومة — المسموح: PNG / JPG / WebP / SVG / GIF.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(
        `حجم الصورة كبير جداً — الحد الأقصى ${Math.round(MAX_LOGO_BYTES / 1024)}KB.`
      );
      return;
    }

    setLogoLoading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("logo-read-failed"));
        reader.readAsDataURL(file);
      });
      setLogoValue(dataUrl);
      setLogoPreview(dataUrl);
      toast({
        title: "تم اختيار الشعار",
        description: "سيتم حفظه مع بقية بيانات المدرسة.",
      });
    } catch {
      setLogoError("تعذّر قراءة الملف — جرّب صورة أخرى.");
    } finally {
      setLogoLoading(false);
    }
  }

  function clearLogo() {
    setLogoValue("");
    setLogoPreview(null);
    setLogoBroken(false);
    setLogoError(null);
  }

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

      {/* Logo upload + brand color */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            شعار المدرسة
            <span className="ms-1 text-xs font-normal text-muted-foreground">(اختياري)</span>
          </Label>
          {/* القيمة الفعلية التي تصل إلى السيرفر داخل حقل logoUrl الموجود */}
          <input type="hidden" name="logoUrl" value={logoValue} />
          <div className="flex items-center gap-3">
            {logoPreview && !logoBroken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoPreview}
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
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <label
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-semibold",
                  logoLoading && "pointer-events-none opacity-60"
                )}
              >
                {logoLoading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UploadCloud className="size-4" aria-hidden="true" />
                )}
                {logoLoading
                  ? "جارٍ قراءة الصورة..."
                  : logoPreview
                    ? "استبدال الشعار"
                    : "اختيار صورة الشعار"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  className="sr-only"
                  onChange={handleLogoChange}
                  disabled={logoLoading}
                />
              </label>
              {logoPreview && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearLogo}
                  disabled={logoLoading}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  إزالة
                </Button>
              )}
            </div>
          </div>
          {logoError ? (
            <p className="text-xs font-semibold text-error" role="alert">
              {logoError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              PNG / JPG / WebP / SVG / GIF — الحد الأقصى 200KB. تُحفظ الصورة مع بيانات المدرسة عند الضغط على الحفظ.
            </p>
          )}
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
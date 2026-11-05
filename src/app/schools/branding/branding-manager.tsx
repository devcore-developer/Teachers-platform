"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImageUp, RotateCcw, Save, Trash2, Wand2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveSchoolBrandingAction,
  removeSchoolLogoAction,
  resetSchoolBrandingAction,
  uploadSchoolLogoAction,
  type BrandingActionState,
} from "@/app/actions/school-branding";
import {
  normalizeHex,
  rankColors,
  suggestPalette,
  type RgbPixel,
} from "@/lib/branding/colors";

/* ------------------------------------------------------------------ */
/* School branding manager (client).                                    */
/*                                                                      */
/* Logo upload with live preview + client-side dominant-color analysis  */
/* (canvas, zero dependencies) suggesting a harmonious palette the      */
/* admin can apply with ONE click or override per color. Colors are     */
/* editable with native pickers + HEX inputs, and a live preview        */
/* renders the identity BEFORE saving. Nothing touches the saved        */
/* school colors until an explicit save.                                */
/* ------------------------------------------------------------------ */

export interface BrandingManagerProps {
  initialBranding: {
    scope: "platform" | "school";
    schoolId: string | null;
    schoolName: string;
    slug: string;
    logoUrl: string | null;
    nameAr: string;
    colors: { primary: string; secondary: string; accent: string; neutral: string };
    tagline: string | null;
  };
  /** All active schools — SUPER_ADMIN picker only (empty otherwise). */
  schools: Array<{ id: string; nameAr: string }>;
  isSuperAdmin: boolean;
  /** False when an office manager account is not bound to a school. */
  hasOwnSchool: boolean;
}

type Palette = BrandingManagerProps["initialBranding"]["colors"];

const COLOR_FIELDS: Array<{
  key: keyof Palette;
  label: string;
  hint: string;
}> = [
  { key: "primary", label: "اللون الأساسي", hint: "الأزرار والروابط والنشاط — يولّد درجات العلامة كاملة" },
  { key: "secondary", label: "اللون الثانوي", hint: "لمسة التمييز الثانوية (البرامج والمخططات)" },
  { key: "accent", label: "لون التمييز", hint: "شارات وتحديدات ثانوية" },
  { key: "neutral", label: "اللون المساند", hint: "الشريط الجانبي والأسطح الداكنة — يُفضّل داكنًا لضمان التباين" },
];

function ColorField({
  label,
  hint,
  value,
  onChange,
  error,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (hex: string) => void;
  error?: string;
}) {
  const normalized = normalizeHex(value) ?? "#000000";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">{label}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        <div
          className="size-10 shrink-0 rounded-lg border shadow-xs"
          style={{ backgroundColor: normalized }}
          aria-hidden="true"
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="color"
          value={normalized}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="size-9 cursor-pointer rounded-lg border bg-card p-1"
          aria-label={`${label} — منتقي الألوان`}
        />
        <Input
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#1D5BD6"
          className="max-w-32 font-mono text-sm"
          aria-label={`${label} — قيمة HEX`}
          aria-invalid={Boolean(error)}
        />
      </div>
      {error && (
        <p className="mt-2 text-xs font-semibold text-destructive">{error}</p>
      )}
    </div>
  );
}

export function BrandingManager({
  initialBranding,
  schools,
  isSuperAdmin,
  hasOwnSchool,
}: BrandingManagerProps) {
  const router = useRouter();

  const [schoolId, setSchoolId] = React.useState(initialBranding.schoolId ?? "");
  const [nameAr, setNameAr] = React.useState(initialBranding.nameAr);
  const [tagline, setTagline] = React.useState(initialBranding.tagline ?? "");
  const [colors, setColors] = React.useState<Palette>(initialBranding.colors);
  const [logoUrl, setLogoUrl] = React.useState<string | null>(initialBranding.logoUrl);

  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);
  const [suggested, setSuggested] = React.useState<Palette | null>(null);
  const [analysisNote, setAnalysisNote] = React.useState<string | null>(null);

  const [saveState, setSaveState] = React.useState<BrandingActionState | null>(null);
  const [uploadState, setUploadState] = React.useState<BrandingActionState | null>(null);
  const [resetState, setResetState] = React.useState<BrandingActionState | null>(null);
  const [removeState, setRemoveState] = React.useState<BrandingActionState | null>(null);

  const fieldErrors: Record<string, string> = saveState?.fieldErrors ?? {};
  const activeLogo = logoPreview ?? logoUrl;

  /* ---------------- logo analysis (client canvas, no deps) --------- */

  async function analyzeLogoFile(file: File): Promise<void> {
    setSuggested(null);
    setAnalysisNote(null);
    try {
      const bitmapUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = bitmapUrl;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("image decode failed"));
      });

      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(image, 0, 0, size, size);
      URL.revokeObjectURL(bitmapUrl);

      const { data } = ctx.getImageData(0, 0, size, size);
      const pixels: RgbPixel[] = [];
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 24) continue; // transparent
        pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
      }
      if (pixels.length === 0) throw new Error("no opaque pixels");

      const palette = suggestPalette(rankColors(pixels));
      setSuggested(palette);
      setAnalysisNote("حلّلنا ألوان الشعار واقترحنا لوحة متناسقة — راجعها وعدّل ما تشاء قبل التطبيق.");
    } catch {
      setSuggested(null);
      setAnalysisNote("تعذر تحليل ألوان الشعار تلقائيًا — اختر الألوان يدويًا من المنتقيات بالأسفل.");
    }
  }

  function handleLogoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const okType = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
    if (!okType) {
      setUploadState({ ok: false, message: "الصيغ المدعومة: PNG أو JPG أو WEBP." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadState({ ok: false, message: "الحد الأقصى لحجم الشعار 2 ميجابايت." });
      return;
    }
    setUploadState(null);
    setLogoPreview(URL.createObjectURL(file));
    void analyzeLogoFile(file);
  }

  async function handleLogoUpload() {
    if (!logoPreview) return;
    const input = document.getElementById("branding-logo-input") as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      setUploadState({ ok: false, message: "اختر ملف الشعار أولًا." });
      return;
    }
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("logo", file);
    const state = await uploadSchoolLogoAction(null, formData);
    setUploadState(state);
    if (state.ok) {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
      setLogoUrl(state.logoUrl ?? null);
      router.refresh();
    }
  }

  async function handleRemoveLogo() {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    const state = await removeSchoolLogoAction(null, formData);
    setRemoveState(state);
    if (state.ok) {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
      setLogoUrl(null);
      router.refresh();
    }
  }

  /* ---------------- palette + save --------------------------------- */

  function applySuggested() {
    if (!suggested) return;
    setColors(suggested);
  }

  async function handleSave() {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("nameAr", nameAr);
    formData.set("tagline", tagline);
    formData.set("primary", colors.primary);
    formData.set("secondary", colors.secondary);
    formData.set("accent", colors.accent);
    formData.set("neutral", colors.neutral);
    const state = await saveSchoolBrandingAction(null, formData);
    setSaveState(state);
    if (state.ok) router.refresh();
  }

  async function handleReset() {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    const state = await resetSchoolBrandingAction(null, formData);
    setResetState(state);
    if (state.ok) {
      setColors({
        primary: "#1D5BD6",
        secondary: "#2AA5C0",
        accent: "#E8A13A",
        neutral: "#1E2A4A",
      });
      router.refresh();
    }
  }

  function handleSchoolChange(nextId: string) {
    setSchoolId(nextId);
    router.replace(`/schools/branding?school=${encodeURIComponent(nextId)}`);
  }

  /* ---------------- render ----------------------------------------- */

  if (isSuperAdmin && !schoolId) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-extrabold">هوية المدرسة</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            اختر المدرسة المراد إدارة هويتها البصرية.
          </p>
        </header>
        <div className="max-w-md space-y-3 rounded-2xl border bg-card p-6">
          <Label htmlFor="school-picker">المدرسة</Label>
          <select
            id="school-picker"
            value={schoolId}
            onChange={(e) => handleSchoolChange(e.target.value)}
            className="h-10 w-full rounded-lg border bg-card px-3 text-sm"
          >
            <option value="">— اختر مدرسة —</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.nameAr}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  const previewSubtitle = tagline.trim() || "منصة التنمية المهنية للمعلمين";
  const previewName = nameAr.trim() ? `منارة ${nameAr.trim()}` : "منارة";

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">هوية المدرسة</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            الشعار والاسم المعروض والألوان التي تظهر بها {previewName} على كل
            المنصة: تسجيل الدخول، لوحة المعلومات، الشهادات والتقارير — وتُطبق
            فورًا بعد الحفظ.
          </p>
        </div>
        {isSuperAdmin && schools.length > 0 && (
          <div className="w-full max-w-xs">
            <Label htmlFor="school-picker-top">المدرسة</Label>
            <select
              id="school-picker-top"
              value={schoolId}
              onChange={(e) => handleSchoolChange(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-lg border bg-card px-3 text-sm"
            >
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.nameAr}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      {!hasOwnSchool && !isSuperAdmin && (
        <Alert>
          <AlertDescription>
            حسابك غير مرتبط بمدرسة — تواصل مع مدير المنصة لربط حسابك بمدرسة
            قبل إدارة الهوية.
          </AlertDescription>
        </Alert>
      )}

      {saveState && !saveState.ok && saveState.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{saveState.message}</AlertDescription>
        </Alert>
      )}
      {saveState?.ok && saveState.message && (
        <div
          className="rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm font-semibold text-success"
          role="status"
        >
          {saveState.message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ---------------- identity form ---------------- */}
        <div className="space-y-6 lg:col-span-3">
          {/* Logo */}
          <section className="rounded-2xl border bg-card p-6">
            <h2 className="text-base font-extrabold">شعار المدرسة</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              PNG أو JPG أو WEBP — بحد أقصى 2 ميجابايت. يظهر في الشريط الجانبي
              وصفحات الدخول والشهادات.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <div className="flex size-20 items-center justify-center overflow-hidden rounded-2xl border bg-muted/50">
                {activeLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeLogo}
                    alt="معاينة شعار المدرسة"
                    className="size-full object-contain p-1.5"
                    draggable={false}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">لا شعار</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor="branding-logo-input"
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-semibold transition-colors hover:bg-accent"
                >
                  <ImageUp className="size-4" aria-hidden="true" />
                  اختر شعارًا
                </label>
                <input
                  id="branding-logo-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={handleLogoSelected}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleLogoUpload()}
                  disabled={!logoPreview}
                >
                  حفظ الشعار
                </Button>
                {logoUrl && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void handleRemoveLogo()}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    حذف الشعار
                  </Button>
                )}
              </div>
            </div>
            {uploadState && !uploadState.ok && uploadState.message && (
              <p className="mt-3 text-xs font-semibold text-destructive">{uploadState.message}</p>
            )}
            {uploadState?.ok && (
              <p className="mt-3 text-xs font-semibold text-success">{uploadState.message}</p>
            )}
            {removeState?.ok && (
              <p className="mt-3 text-xs font-semibold text-success">{removeState.message}</p>
            )}
          </section>

          {/* Suggested palette */}
          {suggested && (
            <section className="rounded-2xl border border-brand-200 bg-brand-50/60 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-1.5 text-base font-extrabold">
                    <Wand2 className="size-4 text-brand-600" aria-hidden="true" />
                    لوحة مقترحة من الشعار
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {analysisNote}
                  </p>
                </div>
                <Button type="button" size="sm" onClick={applySuggested}>
                  تطبيق المقترح
                </Button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(suggested) as Array<keyof Palette>).map((key) => (
                  <div key={key} className="rounded-xl border bg-card p-2 text-center">
                    <div
                      className="h-12 w-full rounded-lg border"
                      style={{ backgroundColor: suggested[key] }}
                      aria-hidden="true"
                    />
                    <p className="mt-1.5 font-mono text-[10px] text-muted-foreground" dir="ltr">
                      {suggested[key]}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                التطبيق لا يحفظ تلقائيًا — راجع الألوان في المعاينة ثم اضغط
                «حفظ الهوية».
              </p>
            </section>
          )}
          {!suggested && analysisNote && (
            <div className="rounded-2xl border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
              {analysisNote}
            </div>
          )}

          {/* Colors */}
          <section className="space-y-4">
            <h2 className="text-base font-extrabold">ألوان الهوية</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {COLOR_FIELDS.map((field) => (
                <ColorField
                  key={field.key}
                  label={field.label}
                  hint={field.hint}
                  value={colors[field.key]}
                  error={fieldErrors[field.key]}
                  onChange={(hex) =>
                    setColors((prev) => ({ ...prev, [field.key]: hex }))
                  }
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              درجات العلامة (الفاتحة للداكنة) تُشتق تلقائيًا من اللون الأساسي
              لضمان تباين مقروء في كل الواجهات.
            </p>
          </section>

          {/* Text identity */}
          <section className="grid gap-4 rounded-2xl border bg-card p-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="branding-name">اسم المدرسة المعروض</Label>
              <Input
                id="branding-name"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                maxLength={80}
                required
                aria-invalid={Boolean(fieldErrors.nameAr)}
              />
              {fieldErrors.nameAr && (
                <p className="text-xs font-semibold text-destructive">{fieldErrors.nameAr}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                يظهر باسم «منارة {nameAr.trim() || "…"}» في كل الواجهات.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branding-tagline">وصف تحت الاسم (اختياري)</Label>
              <Input
                id="branding-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                maxLength={120}
                placeholder="منصة التنمية المهنية للمعلمين"
              />
              {fieldErrors.tagline && (
                <p className="text-xs font-semibold text-destructive">{fieldErrors.tagline}</p>
              )}
            </div>
          </section>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void handleSave()}>
              <Save className="size-4" aria-hidden="true" />
              حفظ الهوية
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleReset()}
              className="gap-1.5"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              استعادة الألوان الافتراضية
            </Button>
            {resetState?.ok && (
              <span className="text-xs font-semibold text-success">{resetState.message}</span>
            )}
          </div>
        </div>

        {/* ---------------- live preview ---------------- */}
        <aside className="lg:col-span-2">
          <div className="sticky top-24 space-y-4">
            <h2 className="text-base font-extrabold">معاينة حية</h2>

            {/* Sidebar-style preview */}
            <div
              className="overflow-hidden rounded-2xl shadow-md"
              style={{ backgroundColor: normalizeHex(colors.neutral) ?? "#1E2A4A" }}
            >
              <div
                className="flex h-16 items-center gap-3 border-b px-5"
                style={{
                  borderColor: "rgba(255,255,255,0.12)",
                }}
              >
                {activeLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeLogo}
                    alt=""
                    className="size-10 rounded-xl bg-white object-contain p-0.5"
                    draggable={false}
                  />
                ) : (
                  <div
                    className="flex size-10 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
                    aria-hidden="true"
                  >
                    م
                  </div>
                )}
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-base font-extrabold text-white">
                    {previewName}
                  </p>
                  <p className="truncate text-xs text-white/70">{previewSubtitle}</p>
                </div>
              </div>
              <div className="space-y-1 p-3">
                {["الرئيسية", "الأكاديمية التدريبية", "التقارير"].map((label, index) => (
                  <div
                    key={label}
                    className="rounded-lg px-3 py-2 text-sm font-semibold"
                    style={
                      index === 0
                        ? {
                            background: `linear-gradient(to left, ${normalizeHex(colors.primary) ?? "#1D5BD6"}, ${normalizeHex(colors.secondary) ?? "#2AA5C0"})`,
                            color: "#FFFFFF",
                          }
                        : { color: "rgba(255,255,255,0.75)" }
                    }
                  >
                    {label}
                  </div>
                ))}
              </div>
              <div
                className="border-t px-5 py-3 text-center text-[11px] text-white/40"
                style={{ borderColor: "rgba(255,255,255,0.12)" }}
              >
                {previewName} · منارة — مكتب التطوير التربوي
              </div>
            </div>

            {/* Light-surface preview */}
            <div className="rounded-2xl border bg-card p-5">
              <p className="text-xs font-bold text-muted-foreground">عناصر الواجهة</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-lg px-3.5 py-2 text-xs font-bold text-white shadow-sm"
                  style={{ backgroundColor: normalizeHex(colors.primary) ?? "#1D5BD6" }}
                >
                  زر أساسي
                </span>
                <span
                  className="rounded-lg px-3 py-2 text-xs font-bold"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${normalizeHex(colors.secondary) ?? "#2AA5C0"} 16%, white)`,
                    color: normalizeHex(colors.primary) ?? "#1D5BD6",
                  }}
                >
                  شارة ثانوية
                </span>
                <span
                  className="size-6 rounded-md border"
                  style={{ backgroundColor: normalizeHex(colors.accent) ?? "#E8A13A" }}
                  title="لون التمييز"
                  aria-hidden="true"
                />
                <span className="text-xs font-semibold" style={{ color: normalizeHex(colors.primary) ?? "#1D5BD6" }}>
                  نص برابط بلون الهوية
                </span>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                هذه معاينة قبل الحفظ — بعد الحفظ تُطبق نفس الألوان فعليًا على كل
                صفحات المنصة عبر متغيرات CSS.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
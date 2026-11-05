/* ------------------------------------------------------------------ */
/* Pure color utilities for dynamic school branding.                    */
/*                                                                      */
/* ZERO dependencies and ZERO server imports — this module is imported  */
/* by server code (src/lib/branding.ts) AND by client components        */
/* (the branding manager) so both sides produce identical ramps.        */
/*                                                                      */
/* The design system in globals.css resolves every `brand-*` Tailwind   */
/* utility through runtime CSS variables (--brand-50 … --brand-900,     */
/* --brand-cyan, --brand-cyan-soft). We generate those variables from   */
/* ONE primary hex color, following the lightness/saturation profile    */
/* of the hand-tuned platform palette.                                  */
/* ------------------------------------------------------------------ */

export type BrandRampKey = "50" | "100" | "200" | "300" | "500" | "600" | "700" | "800" | "900";

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
}

/** Normalize "#abc" / "#aabbcc" / "aabbcc" to "#AABBCC", or null. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    v = v
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
  return `#${v.toUpperCase()}`;
}

export function hexToHsl(hex: string): Hsl {
  const norm = normalizeHex(hex) ?? "#000000";
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      default:
        h = ((r - g) / d + 4) * 60;
    }
  }
  return { h, s: s * 100, l: l * 100 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;

  if (ss === 0) {
    const gray = Math.round(ll * 255);
    const channel = gray.toString(16).padStart(2, "0");
    return `#${channel}${channel}${channel}`.toUpperCase();
  }

  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const r = Math.round(hueToRgb(p, q, hh / 360 + 1 / 3) * 255);
  const g = Math.round(hueToRgb(p, q, hh / 360) * 255);
  const b = Math.round(hueToRgb(p, q, hh / 360 - 1 / 3) * 255);
  return (
    "#" +
    [r, g, b]
      .map((c) => clamp(c, 0, 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

/**
 * The full brand ramp from a single primary hex, following the
 * lightness profile of the hand-tuned platform tokens in globals.css
 * (50≈96.5%, 100≈92.5%, 200≈89.5%, 300≈83%, 500≈60%, 600=primary,
 * 700≈47%, 800≈39.5%, 900≈33%) with saturation tapering towards the
 * extremes exactly like the oklch chroma taper there.
 */
export function buildBrandRamp(primaryHex: string): Record<BrandRampKey, string> {
  const { h, s } = hexToHsl(primaryHex);
  const steps: Array<[BrandRampKey, number | null, number]> = [
    ["50", 96.5, 0.3],
    ["100", 92.5, 0.55],
    ["200", 89.5, 0.78],
    ["300", 83, 0.9],
    ["500", 60, 1.0],
    ["600", null, 1.0], // the primary itself
    ["700", 47, 0.97],
    ["800", 39.5, 0.85],
    ["900", 33, 0.62],
  ];
  const ramp = {} as Record<BrandRampKey, string>;
  for (const [key, lightness, satFactor] of steps) {
    ramp[key] =
      key === "600"
        ? normalizeHex(primaryHex) ?? hslToHex(h, s, 53.5)
        : hslToHex(h, clamp(s * satFactor, 0, 100), lightness ?? 53.5);
  }
  return ramp;
}

/** A soft surface tint for any supporting color (mirrors brand-cyan-soft). */
export function softTint(hex: string): string {
  const { h, s } = hexToHsl(hex);
  return hslToHex(h, clamp(s * 0.35, 0, 100), 95.5);
}

/** Lighten (positive) / darken (negative) by lightness percentage points. */
export function adjustLightness(hex: string, delta: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, clamp(l + delta, 0, 100));
}

/** Relative luminance (WCAG). */
export function relativeLuminance(hex: string): number {
  const norm = normalizeHex(hex) ?? "#000000";
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(parseInt(norm.slice(1, 3), 16)) +
    0.7152 * channel(parseInt(norm.slice(3, 5), 16)) +
    0.0722 * channel(parseInt(norm.slice(5, 7), 16))
  );
}

/** Contrast ratio (WCAG) between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Readable foreground (white or near-black ink) for a background hex. */
export function readableForeground(hex: string): string {
  return contrastRatio(hex, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#0F172A";
}

/** Hue distance (0..180) between two hex colors. */
export function hueDistance(a: string, b: string): number {
  const da = hexToHsl(a).h;
  const db = hexToHsl(b).h;
  const diff = Math.abs(da - db) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/* ------------------------------------------------------------------ */
/* Logo dominant-color extraction (client-side canvas helpers).         */
/* ------------------------------------------------------------------ */

export interface RgbPixel {
  r: number;
  g: number;
  b: number;
}

/** Quantize a pixel into a 4-bit-per-channel bucket key. */
export function quantizeKey({ r, g, b }: RgbPixel): string {
  const key = (v: number) => Math.round(v / 17); // 0..15
  return `${key(r)}-${key(g)}-${key(b)}`;
}

export interface ColorCandidate {
  hex: string;
  count: number;
  hsl: Hsl;
}

/**
 * Reduce sampled pixels into ranked color candidates. Transparent and
 * near-white/near-black background pixels are heavily down-weighted so
 * logo artwork dominates over its background.
 */
export function rankColors(pixels: RgbPixel[]): ColorCandidate[] {
  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
  for (const p of pixels) {
    const key = quantizeKey(p);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += p.r;
      bucket.g += p.g;
      bucket.b += p.b;
      bucket.count += 1;
    } else {
      buckets.set(key, { r: p.r, g: p.g, b: p.b, count: 1 });
    }
  }

  const candidates: ColorCandidate[] = [];
  for (const bucket of buckets.values()) {
    const rgb = {
      r: Math.round(bucket.r / bucket.count),
      g: Math.round(bucket.g / bucket.count),
      b: Math.round(bucket.b / bucket.count),
    };
    const hex =
      "#" +
      [rgb.r, rgb.g, rgb.b]
        .map((c) => clamp(c, 0, 255).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    const hsl = hexToHsl(hex);
    // Down-weight near-white / near-black / fully gray background pixels.
    let weight = bucket.count;
    if (hsl.l >= 94 || hsl.l <= 6) weight = Math.round(weight * 0.05);
    else if (hsl.s <= 8) weight = Math.round(weight * 0.35);
    candidates.push({ hex, count: weight, hsl });
  }

  candidates.sort((a, b) => b.count - a.count);
  return candidates;
}

/**
 * Derive a harmonious suggested palette (primary / secondary / accent /
 * neutral) from ranked logo colors. Deterministic, dependency-free.
 */
export function suggestPalette(candidates: ColorCandidate[]): {
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
} {
  const meaningful = candidates.filter((c) => c.count > 0);
  const pool = meaningful.length > 0 ? meaningful : candidates;

  // Primary: the most weighted color with real chroma (fallback: first).
  const primary =
    pool.find((c) => c.hsl.s >= 18 && c.hsl.l >= 20 && c.hsl.l <= 80)?.hex ??
    pool[0]?.hex ??
    "#1D5BD6";

  const primaryHue = hexToHsl(primary).h;

  // Secondary: a distinct hue from the primary (>= 45 degrees apart).
  const secondary =
    pool.find(
      (c) => c.hex !== primary && c.hsl.s >= 15 && hueDistance(c.hex, primary) >= 45
    )?.hex ?? hslToHex(primaryHue + 28, 55, 52);

  // Accent: the most vivid remaining hue (or a shifted derivation).
  const vivid = [...pool]
    .filter((c) => c.hex !== primary && c.hex !== secondary)
    .sort((a, b) => b.hsl.s * Math.log2(b.count + 2) - a.hsl.s * Math.log2(a.count + 2))[0];
  const accent =
    vivid && vivid.hsl.s >= 25 && hueDistance(vivid.hex, primary) >= 25
      ? vivid.hex
      : hslToHex(primaryHue + 180, 62, 55);

  // Neutral: the darkest weighted color (school "deep surface" tone).
  const dark = [...pool].sort((a, b) => a.hsl.l - b.hsl.l)[0];
  const neutral =
    dark && dark.hsl.l <= 45
      ? dark.hex
      : hslToHex(primaryHue, clamp(hexToHsl(primary).s * 0.55, 0, 100), 22);

  return {
    primary: normalizeHex(primary) ?? "#1D5BD6",
    secondary: normalizeHex(secondary) ?? "#2AA5C0",
    accent: normalizeHex(accent) ?? "#E8A13A",
    neutral: normalizeHex(neutral) ?? "#1E2A4A",
  };
}
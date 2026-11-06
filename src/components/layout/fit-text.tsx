"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * FitText — single-line label that ALWAYS fits its container.
 *
 * Contract: the text is rendered on ONE line (white-space: nowrap),
 * sized to the actual available width of its container — never wider.
 * The font shrinks proportionally down to a readable floor; only a
 * name too long for the floor falls back to ellipsis + full-name
 * tooltip (never the primary mechanism).
 *
 * Why the previous attempt could still overflow:
 * the measurement trusted `offsetWidth` (integer-rounded) and the
 * container chain relied on flex intrinsic sizing. This version:
 *  1. Measures with getBoundingClientRect() (sub-pixel precision).
 *  2. Pins the box with inline minWidth:0 / maxWidth:100% so NO parent
 *     flex context can inflate it beyond the real available width.
 *  3. Re-measures on: mount (pre-paint), text change, container resize
 *     (ResizeObserver), window resize, web-font load, and a double
 *     requestAnimationFrame follow-up that catches late layout shifts
 *     (scrollbars, font swap, drawer open transitions).
 *
 * The hidden probe span renders the same text with the same font
 * classes at a fixed 100px reference size; required font size is
 * simply availableWidth / (probeWidth / 100), clamped to
 * [minPx, maxPx]. RTL-safe (pure width math) and SSR-safe (first
 * render matches the server output; the first adjustment happens in a
 * layout effect before paint, so no flash of overflowing text).
 */

const MEASURE_PX = 100;
/** 0.5% slack so sub-pixel rounding never triggers the ellipsis. */
const FIT_SAFETY = 0.995;

/** useLayoutEffect that silently no-ops during server rendering. */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

interface FitTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Largest allowed size in px — short names keep this size. */
  maxPx: number;
  /** Readable floor in px — below this the label truncates instead. */
  minPx?: number;
  /** The label text itself — a single string by design. */
  children: string;
}

export function FitText({
  maxPx,
  minPx = 9,
  children,
  className,
  title,
  ...rest
}: FitTextProps) {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const probeRef = React.useRef<HTMLSpanElement | null>(null);
  const [fontPx, setFontPx] = React.useState(maxPx);

  const recompute = React.useCallback(() => {
    const box = boxRef.current;
    const probe = probeRef.current;
    if (!box || !probe) return;

    // Sub-pixel precise available width (clientWidth is rounded).
    const available = box.getBoundingClientRect().width;
    if (available <= 0) return;

    // The probe is absolutely positioned: its rect width is the full
    // single-line width of the text at the reference size.
    const natural = probe.getBoundingClientRect().width;
    if (natural <= 0) return;

    const exact = ((available * FIT_SAFETY) / natural) * MEASURE_PX;
    const next = Math.min(maxPx, Math.max(minPx, exact));
    setFontPx((current) => (Math.abs(current - next) > 0.1 ? next : current));
  }, [maxPx, minPx]);

  // 1) Measure BEFORE paint on mount and whenever the text changes.
  useIsomorphicLayoutEffect(() => {
    recompute();
    // 2) Follow-up one frame later: fonts may have swapped and the
    // flex layout may have settled only after the first pass.
    const raf = requestAnimationFrame(() => {
      recompute();
      requestAnimationFrame(recompute);
    });
    return () => cancelAnimationFrame(raf);
  }, [recompute, children]);

  // 3) Track the CONTAINER (sidebar resize, drawer opening, zoom).
  React.useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(box);
    return () => observer.disconnect();
  }, [recompute]);

  // 4) Window resize fallback (covers embedded webviews without RO).
  React.useEffect(() => {
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [recompute]);

  // 5) Re-measure once the real web font replaces the fallback face.
  React.useEffect(() => {
    const fonts = (
      document as Document & { fonts?: { ready: Promise<unknown> } }
    ).fonts;
    if (!fonts) return;
    fonts.ready
      .then(() => recompute())
      .catch(() => undefined);
  }, [recompute]);

  // Only at the readable floor may the ellipsis appear.
  const clamped = fontPx <= minPx + 0.05;

  return (
    <div
      ref={boxRef}
      title={title}
      className="relative min-w-0 max-w-full overflow-hidden"
      style={{ minWidth: 0, maxWidth: "100%" }}
    >
      {/* Hidden single-line probe at the reference size — removed from
          flow, invisible, ignored by assistive tech and pointers. */}
      <span
        ref={probeRef}
        aria-hidden="true"
        className={cn(
          className,
          "invisible absolute start-0 top-0 whitespace-pre"
        )}
        style={{
          fontSize: `${MEASURE_PX}px`,
          pointerEvents: "none",
        }}
      >
        {children}
      </span>
      {/* Visible label — always one line; ellipsis only at the floor. */}
      <span
        className={cn(className, "block overflow-hidden whitespace-nowrap")}
        style={{
          fontSize: `${fontPx}px`,
          ...(clamped ? { textOverflow: "ellipsis" } : {}),
        }}
        {...rest}
      >
        {children}
      </span>
    </div>
  );
}